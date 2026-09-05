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
