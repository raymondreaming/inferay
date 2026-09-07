//! File order and directory structure are prepared once with repository responses.
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Default)]
struct Node {
    children: BTreeMap<String, Node>,
    file: bool,
}

pub(super) fn prepare(mut value: Value) -> Value {
    match &mut value {
        Value::Array(values) => {
            for value in values {
                *value = prepare(value.take());
            }
        }
        Value::Object(object) => {
            if let Some(files) = object.get("files").and_then(Value::as_array) {
                let mut paths = files
                    .iter()
                    .filter_map(|file| file["path"].as_str())
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                paths.sort();
                paths.dedup();
                let mut root = Node::default();
                for path in &paths {
                    let mut node = &mut root;
                    // Bound recursive wire/render depth. Deeper tails remain a single
                    // leaf label; its full path and navigation identity are unchanged.
                    for part in path.splitn(32, '/') {
                        node = node.children.entry(part.into()).or_default();
                    }
                    node.file = true;
                }
                let mut tree_order = Vec::new();
                let tree = children(&root, "", &mut tree_order);
                let mut groups = json!({"staged":[], "modified":[], "untracked":[]});
                for file in files {
                    let group = if file["staged"] == true {
                        "staged"
                    } else if file["status"] == "?" {
                        "untracked"
                    } else {
                        "modified"
                    };
                    groups[group].as_array_mut().unwrap().push(file.clone());
                }
                object.insert("fileGroups".into(), groups);
                object.insert(
                    "filePresentation".into(),
                    json!({"pathOrder":paths, "treeOrder":tree_order, "tree":tree}),
                );
            }
            for key in ["details", "status", "worktrees"] {
                if let Some(child) = object.get_mut(key) {
                    *child = prepare(child.take());
                }
            }
        }
        _ => {}
    }
    value
}

pub(super) fn prepare_graph(
    value: Value,
    hidden: &[String],
    solo: &[String],
    pinned: &[String],
) -> Value {
    let mut value = prepare(value);
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    let commits = object["commits"].as_array().cloned().unwrap_or_default();
    let refs = commits
        .iter()
        .flat_map(|commit| commit["refs"].as_array().into_iter().flatten())
        .filter_map(|reference| {
            Some((
                reference["fullName"].as_str()?.to_owned(),
                reference.clone(),
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let containing = commits
        .iter()
        .filter_map(|commit| {
            let name = commit["navigation"]["containingBranch"].as_str()?;
            Some((commit["id"].as_str()?.to_owned(), refs.get(name)?.clone()))
        })
        .collect::<BTreeMap<_, _>>();
    let ancestry = object["ancestry"].as_object();
    let mut reachable = std::collections::BTreeSet::new();
    for name in solo {
        for range in ancestry
            .and_then(|map| map.get(name))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some((start, end)) = range
                .as_array()
                .and_then(|r| Some((r.first()?.as_u64()? as usize, r.get(1)?.as_u64()? as usize)))
            else {
                continue;
            };
            for commit in commits.iter().take(end.saturating_add(1)).skip(start) {
                if let Some(id) = commit["id"].as_str() {
                    reachable.insert(id.to_owned());
                }
            }
        }
    }
    let pinned_columns = pinned
        .iter()
        .filter_map(|name| {
            let target = refs.get(name)?["target"].as_str()?;
            commits
                .iter()
                .find(|commit| commit["hash"] == target || commit["id"] == target)?["column"]
                .as_u64()
        })
        .collect::<Vec<_>>();
    let default_remote = refs.values().find_map(|reference| {
        (reference["kind"] == "remoteBranch").then(|| reference["remoteName"].clone())
    });
    object.insert("presentation".into(), json!({
        "containingBranches": containing,
        "defaultRemoteName": default_remote,
        "hiddenRefDetails": hidden.iter().filter_map(|name| refs.get(name)).collect::<Vec<_>>(),
        "hiddenRefNames": hidden,
        "pinnedColumns": pinned_columns,
        "pinnedRefNames": pinned,
        "reachableHistory": reachable,
        "selectableItems": commits.iter().filter_map(|commit| commit["id"].as_str()).collect::<Vec<_>>(),
    }));
    value
}

fn children(node: &Node, parent: &str, order: &mut Vec<String>) -> Vec<Value> {
    node.children
        .iter()
        .map(|(name, child)| {
            let path = if parent.is_empty() {
                name.clone()
            } else {
                format!("{parent}/{name}")
            };
            let start = order.len();
            let descendants = if child.file {
                order.push(path.clone());
                Vec::new()
            } else {
                children(child, &path, order)
            };
            json!({"name":name,"path":path,"children":descendants,"fileRange":[start,order.len()]})
        })
        .collect()
}
