//! Native dock ownership; the renderer previews divider movement locally.
use super::*;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Tree {
    Panel {
        id: String,
    },
    Split {
        direction: String,
        ratio: f64,
        first: Box<Tree>,
        second: Box<Tree>,
    },
}
impl Tree {
    fn span(&self, axis: &str) -> usize {
        match self {
            Self::Panel { .. } => 1,
            Self::Split {
                direction,
                first,
                second,
                ..
            } => {
                let (a, b) = (first.span(axis), second.span(axis));
                if direction == axis { a + b } else { a.max(b) }
            }
        }
    }
    fn ids(&self) -> Vec<String> {
        match self {
            Self::Panel { id } => vec![id.clone()],
            Self::Split { first, second, .. } => [first.ids(), second.ids()].concat(),
        }
    }
    fn split(direction: &str, first: Self, second: Self, ratio: Option<f64>) -> Self {
        let ratio = ratio.unwrap_or_else(|| {
            first.span(direction) as f64 / (first.span(direction) + second.span(direction)) as f64
        });
        Self::Split {
            direction: direction.into(),
            ratio: ratio.clamp(0.14, 0.86),
            first: Box::new(first),
            second: Box::new(second),
        }
    }
    fn map(self, visit: &impl Fn(String) -> Option<Self>, preserve: bool) -> Option<Self> {
        match self {
            Self::Panel { id } => visit(id),
            Self::Split {
                direction,
                ratio,
                first,
                second,
            } => match (first.map(visit, preserve), second.map(visit, preserve)) {
                (Some(a), Some(b)) => {
                    Some(Self::split(&direction, a, b, preserve.then_some(ratio)))
                }
                (a, b) => a.or(b),
            },
        }
    }
    fn beside(self, id: String, edge: &str) -> Self {
        let direction = if matches!(edge, "top" | "bottom") {
            "vertical"
        } else {
            "horizontal"
        };
        let panel = Self::Panel { id };
        if matches!(edge, "left" | "top") {
            Self::split(direction, panel, self, None)
        } else {
            Self::split(direction, self, panel, None)
        }
    }
    fn constrain(self, columns: usize) -> Self {
        if self.span("horizontal") <= columns {
            self
        } else {
            build(&self.ids(), columns).expect("nonempty tree")
        }
    }
    fn append(mut self, id: String, columns: usize) -> Self {
        fn last(node: &mut Tree, id: &str, columns: usize) -> bool {
            if let Tree::Split {
                direction, second, ..
            } = node
                && direction == "vertical"
            {
                return last(second, id, columns);
            }
            if node.span("horizontal") >= columns {
                return false;
            }
            *node = node.clone().beside(id.into(), "right");
            true
        }
        if last(&mut self, &id, columns) {
            self
        } else {
            self.beside(id, "bottom")
        }
    }
    fn resize(&mut self, path: &[Value], ratio: f64) {
        if let Self::Split {
            ratio: current,
            first,
            second,
            ..
        } = self
        {
            match path.split_first() {
                None => *current = ratio.clamp(0.14, 0.86),
                Some((branch, rest)) => {
                    if branch == "first" { first } else { second }.resize(rest, ratio)
                }
            }
        }
    }
}
fn build(ids: &[String], columns: usize) -> Option<Tree> {
    ids.chunks(columns)
        .filter_map(|row| {
            row.iter()
                .cloned()
                .map(|id| Tree::Panel { id })
                .reduce(|a, b| Tree::split("horizontal", a, b, None))
        })
        .reduce(|a, b| Tree::split("vertical", a, b, None))
}
fn reconcile(tree: Option<Tree>, ids: &[String], columns: usize) -> Option<Tree> {
    let mut tree = tree
        .and_then(|tree| tree.map(&|id| ids.contains(&id).then_some(Tree::Panel { id }), true))
        .map(|t| t.constrain(columns));
    let present = tree.as_ref().map(Tree::ids).unwrap_or_default();
    for id in ids.iter().filter(|id| !present.contains(id)) {
        tree = Some(match tree {
            Some(tree) => tree.append(id.clone(), columns),
            None => Tree::Panel { id: id.clone() },
        });
    }
    tree
}

pub(super) async fn handle(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let workspace = required(body["workspaceId"].as_str(), "workspaceId is required")?;
    let ids = required(body["ids"].as_array(), "panel ids are required")?;
    if ids.len() > 512 || ids.iter().any(|id| !id.is_string()) {
        return Err(api_error(StatusCode::BAD_REQUEST, "Invalid dock panels"));
    }
    let mut ids = ids
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut seen = std::collections::HashSet::new();
    ids.retain(|id| seen.insert(id.clone()));
    let columns = body["columns"].as_u64().unwrap_or(1).clamp(1, 4) as usize;
    let display_columns = if body["mode"] == "grid" {
        body["visibleColumns"]
            .as_u64()
            .unwrap_or(columns as u64)
            .clamp(1, columns as u64) as usize
    } else {
        columns
    };
    let preset = json!([body["mode"], columns]);
    let _guard = state.client_storage_write.lock().await;
    let mut entries = read_client_storage(&state.client_storage_path).await?;
    let key = format!("native-workspace-dock:{workspace}");
    let saved = entries
        .get(&key)
        .and_then(Value::as_str)
        .and_then(|s| serde_json::from_str::<Value>(s).ok());
    let legacy = entries
        .get(&format!("agent-workspace-dock:{workspace}"))
        .and_then(Value::as_str)
        .and_then(|s| serde_json::from_str::<Value>(s).ok());
    let stored = saved.as_ref().map(|s| &s["tree"]).or(legacy.as_ref());
    let tree = stored.and_then(|v| serde_json::from_value::<Tree>(v.clone()).ok());
    let reset = body["mode"] == "grid" && saved.as_ref().is_some_and(|s| s["preset"] != preset);
    let mut tree = if reset {
        build(&ids, columns)
    } else {
        reconcile(tree, &ids, columns)
    };
    let action = &body["action"];
    if action.is_object() {
        tree = tree.map(|t| t.constrain(display_columns));
        if action["type"] == "resize" {
            if let (Some(tree), Some(path), Some(ratio)) = (
                &mut tree,
                action["path"].as_array(),
                action["ratio"].as_f64(),
            ) {
                tree.resize(path, ratio);
            }
        } else if action["type"] == "place" {
            let source = required(action["source"].as_str(), "source is required")?;
            let target = required(action["target"].as_str(), "target is required")?;
            let edge = required(action["edge"].as_str(), "edge is required")?;
            if !matches!(edge, "center" | "left" | "right" | "top" | "bottom") {
                return Err(api_error(StatusCode::BAD_REQUEST, "Invalid dock edge"));
            }
            if let Some(current) = tree.take() {
                let present = current.ids();
                let insert = action["insert"] == true;
                let outer = action["outer"] == true;
                tree = if (!insert && outer && present.len() < 2)
                    || source == target
                    || (!outer && !present.iter().any(|id| id == target))
                    || present.iter().any(|id| id == source) == insert
                {
                    Some(current)
                } else if !insert && !outer && edge == "center" {
                    current.map(
                        &|id| {
                            Some(Tree::Panel {
                                id: if id == source {
                                    target.into()
                                } else if id == target {
                                    source.into()
                                } else {
                                    id
                                },
                            })
                        },
                        true,
                    )
                } else {
                    let rest = if insert {
                        Some(current)
                    } else {
                        current.map(&|id| (id != source).then_some(Tree::Panel { id }), false)
                    };
                    rest.map(|t| {
                        if outer {
                            t.beside(source.into(), edge)
                        } else {
                            t.map(
                                &|id| {
                                    Some(if id == target {
                                        Tree::Panel { id }.beside(source.into(), edge)
                                    } else {
                                        Tree::Panel { id }
                                    })
                                },
                                false,
                            )
                            .expect("target exists")
                        }
                    })
                };
            }
            tree = tree.map(|t| t.constrain(display_columns));
        }
    }
    let value = Value::String(json!({"tree":tree,"preset":preset}).to_string());
    if entries.get(&key) != Some(&value) {
        entries.insert(key, value);
        write_json_object(&state.client_storage_path, &entries).await?;
    }
    let tree = tree.map(|t| t.constrain(display_columns));
    Ok(
        json!({"horizontal":tree.as_ref().map_or(1,|t| t.span("horizontal")),
        "vertical":tree.as_ref().map_or(1,|t| t.span("vertical")), "tree":tree}),
    )
}
