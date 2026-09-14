//! Pure dock layout shared by the renderer preview and native persistence.
use crate::{flag, number, string};
use serde_json::{Value, json};

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DockPointerTarget {
    id: String,
    #[ts(type = "'center' | 'left' | 'right' | 'top' | 'bottom'")]
    edge: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    row_index: Option<usize>,
}

pub fn pointer_target(input: &Value) -> Option<DockPointerTarget> {
    if input["mode"] != "rows"
        && number(&input["panelCount"]) > if flag(&input["insert"]) { 0. } else { 1. }
    {
        let edge = hit(&json!({"x":input["x"],"y":input["y"],"rect":input["root"],"outer":true}));
        if let Some(edge) = edge.as_str() {
            return Some(DockPointerTarget {
                id: "__workspace-root__".into(),
                edge: edge.into(),
                row_index: None,
            });
        }
    }
    if let Some(id) = input["rowId"].as_str() {
        return input["rowIndex"].as_u64().map(|index| DockPointerTarget {
            id: id.into(),
            edge: "center".into(),
            row_index: Some(index as usize),
        });
    }
    let id = input["cellId"].as_str().filter(|id| !id.is_empty())?;
    if !flag(&input["insert"]) && input["source"] == id {
        return None;
    }
    Some(DockPointerTarget {
        id: id.into(),
        edge: string(&hit(
            &json!({"x":input["x"],"y":input["y"],"rect":input["cell"]}),
        ))
        .into(),
        row_index: None,
    })
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct DockWheel {
    capture: bool,
    horizontal: bool,
    delta: f64,
}

pub fn wheel(input: &Value) -> DockWheel {
    let dx = number(&input["deltaX"]);
    let dy = number(&input["deltaY"]);
    let rows = input["mode"] == "rows";
    let mut result = DockWheel {
        capture: false,
        horizontal: rows,
        delta: 0.,
    };
    if rows {
        result.capture = flag(&input["shift"]) || dx.abs() > 0. && dx.abs() >= dy.abs();
        if result.capture && !flag(&input["selected"]) {
            result.delta = if flag(&input["shift"]) { dy } else { dx };
        }
    } else if input["mode"] == "grid" && dy != 0. {
        let inner = &input["inner"];
        let can_scroll = if dy < 0. {
            number(&inner["offset"]) > 0.
        } else {
            number(&inner["offset"]) + number(&inner["size"]) < number(&inner["extent"]) - 1.
        };
        result.capture = !flag(&input["selected"]) || inner.is_null() || !can_scroll;
        if result.capture {
            result.delta = dy;
        }
    }
    result
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DockCanvas {
    min_height: String,
    width: String,
    sparse: bool,
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct DockSaved {
    tree: Option<Tree>,
    preset: (Option<String>, usize),
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct DockLayout {
    canvas: DockCanvas,
    tree: Option<Tree>,
    saved: DockSaved,
}

pub fn responsive_columns(input: &Value) -> Value {
    json!(
        (number(&input["width"]) / 300.)
            .floor()
            .min(number(&input["columns"]))
            .clamp(1., 4.)
    )
}

pub fn resize_preview(body: &Value) -> Result<Value, String> {
    let mut tree: Tree =
        serde_json::from_value(body["tree"].clone()).map_err(|error| error.to_string())?;
    let path = body["path"].as_array().ok_or("resize path is required")?;
    let ratio = body["ratio"].as_f64().ok_or("resize ratio is required")?;
    tree.resize(path, ratio);
    serde_json::to_value(tree).map_err(|error| error.to_string())
}

#[derive(Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(rename = "DockTree")]
pub enum Tree {
    Empty {
        columns: usize,
    },
    Panel {
        id: String,
    },
    Split {
        #[ts(type = "'horizontal' | 'vertical'")]
        direction: String,
        ratio: f64,
        first: Box<Tree>,
        second: Box<Tree>,
    },
}
impl Tree {
    fn span(&self, axis: &str) -> usize {
        match self {
            Self::Empty { columns } => {
                if axis == "horizontal" {
                    *columns
                } else {
                    1
                }
            }
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
            Self::Empty { .. } => vec![],
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
            Self::Empty { .. } => None,
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
    // Empty cells belong only to the displayed grid. Keep incomplete rows at
    // the selected column width without creating or persisting fake panels.
    fn pad_rows(self, columns: usize) -> Self {
        match self {
            Self::Split {
                direction,
                ratio,
                first,
                second,
            } if direction == "vertical" => Self::Split {
                direction,
                ratio,
                first: Box::new(first.pad_rows(columns)),
                second: Box::new(second.pad_rows(columns)),
            },
            row => {
                let occupied = row.span("horizontal");
                if occupied < columns {
                    Self::split(
                        "horizontal",
                        row,
                        Self::Empty {
                            columns: columns - occupied,
                        },
                        Some(occupied as f64 / columns as f64),
                    )
                } else {
                    row
                }
            }
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

pub fn project(body: &Value) -> Result<Value, String> {
    let ids = body["ids"].as_array().ok_or("panel ids are required")?;
    if ids.len() > 512 || ids.iter().any(|id| !id.is_string()) {
        return Err("Invalid dock panels".into());
    }
    let mut ids = ids
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut seen = std::collections::HashSet::new();
    ids.retain(|id| seen.insert(id.clone()));
    let columns = body["columns"].as_u64().unwrap_or(1).clamp(1, 4) as usize;
    let grid = body["mode"] == "grid";
    let display_columns = if grid {
        body["visibleColumns"]
            .as_u64()
            .unwrap_or(columns as u64)
            .clamp(1, columns as u64) as usize
    } else {
        columns
    };
    let display_columns = display_columns.min(if grid { ids.len().max(1) } else { columns });
    let preset = (body["mode"].as_str().map(str::to_owned), columns);
    let saved = body.get("saved").filter(|value| value.is_object());
    let legacy = body.get("legacy").filter(|value| value.is_object());
    let stored = saved.map(|s| &s["tree"]).or(legacy);
    let tree = stored.and_then(|v| serde_json::from_value::<Tree>(v.clone()).ok());
    let reset = body["mode"] == "grid" && saved.is_some_and(|s| s["preset"] != json!(preset));
    let mut tree = if reset {
        build(&ids, columns)
    } else {
        reconcile(tree, &ids, columns)
    };
    let action = &body["action"];
    if action.is_object() {
        tree = tree.map(|t| {
            let t = t.constrain(display_columns);
            if grid { t.pad_rows(display_columns) } else { t }
        });
        if action["type"] == "resize" {
            if let (Some(tree), Some(path), Some(ratio)) = (
                &mut tree,
                action["path"].as_array(),
                action["ratio"].as_f64(),
            ) {
                tree.resize(path, ratio);
            }
        } else if action["type"] == "place" {
            let source = action["source"].as_str().ok_or("source is required")?;
            let target = action["target"].as_str().ok_or("target is required")?;
            let edge = action["edge"].as_str().ok_or("edge is required")?;
            if !matches!(edge, "center" | "left" | "right" | "top" | "bottom") {
                return Err("Invalid dock edge".into());
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
    // Display padding must never enter persisted geometry.
    tree = tree.and_then(|t| t.map(&|id| Some(Tree::Panel { id }), true));
    let saved = DockSaved {
        tree: tree.clone(),
        preset,
    };
    let tree = tree.map(|tree| {
        let tree = tree.constrain(display_columns);
        if grid {
            tree.pad_rows(display_columns)
        } else {
            tree
        }
    });
    let horizontal = tree.as_ref().map_or(1, |tree| tree.span("horizontal"));
    let vertical = tree.as_ref().map_or(1, |tree| tree.span("vertical"));
    let canvas = DockCanvas {
        min_height: format!(
            "max({}%, {}px)",
            (vertical as f64 / number(&body["rows"]).max(1.) * 100.).max(100.),
            vertical * 340
        ),
        width: format!(
            "{}%",
            if grid && tree.is_some() {
                horizontal as f64 / display_columns as f64 * 100.
            } else {
                100.
            }
        ),
        sparse: grid && tree.is_some() && horizontal < display_columns,
    };
    Ok(json!(DockLayout {
        saved,
        tree,
        canvas,
    }))
}

/// Resolve a pointer against measured bounds; event/DOM access stays in the renderer.
fn hit(body: &Value) -> Value {
    let number = |key: &str| body["rect"][key].as_f64().unwrap_or_default();
    let x = body["x"].as_f64().unwrap_or_default() - number("left");
    let y = body["y"].as_f64().unwrap_or_default() - number("top");
    let width = number("width");
    let height = number("height");
    let outer = body["outer"] == true;
    let (x, y, right, bottom) = if outer {
        (x, y, width - x, height - y)
    } else {
        let x = x / width.max(1.);
        let y = y / height.max(1.);
        (x, y, 1. - x, 1. - y)
    };
    let (edge, distance) = [
        ("left", x),
        ("right", right),
        ("top", y),
        ("bottom", bottom),
    ]
    .into_iter()
    .reduce(|a, b| if b.1 < a.1 { b } else { a })
    .expect("four edges");
    if outer {
        let band = (width.min(height) * 0.1).clamp(28., 72.);
        if distance >= 0. && distance <= band {
            json!(edge)
        } else {
            Value::Null
        }
    } else {
        json!(if distance > 0.28 { "center" } else { edge })
    }
}
