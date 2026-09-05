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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_deterministic_ordinal_order_for_case_unicode_and_punctuation() {
        let value = prepare(
            json!({"details":{"files":[{"path":"é.rs"},{"path":"a.rs"},{"path":"Z.rs"},{"path":"_a.rs"},{"path":".gitignore"}]}}),
        );
        assert_eq!(
            value["details"]["filePresentation"]["pathOrder"],
            json!([".gitignore", "Z.rs", "_a.rs", "a.rs", "é.rs"])
        );
    }

    #[test]
    fn deep_shared_directories_have_bounded_payload_and_preserve_full_paths() {
        let prefix = std::iter::repeat_n("directory", 80)
            .collect::<Vec<_>>()
            .join("/");
        let paths = (0..128)
            .map(|index| format!("{prefix}/{index:03}.rs"))
            .collect::<Vec<_>>();
        let path_bytes: usize = paths.iter().map(String::len).sum();
        let result = prepare(
            json!({"files":paths.iter().map(|path| json!({"path":path})).collect::<Vec<_>>()}),
        );
        let presentation = &result["filePresentation"];
        assert_eq!(presentation["treeOrder"], json!(paths));
        assert_eq!(presentation["tree"][0]["fileRange"], json!([0, 128]));
        let serialized = serde_json::to_vec(presentation).unwrap();
        assert!(serialized.len() < path_bytes * 5 + 20_000);
        assert!(!String::from_utf8(serialized).unwrap().contains("filePaths"));
    }

    #[test]
    fn prepares_distinct_path_and_tree_order_without_duplicate_staged_paths() {
        let result = prepare(
            json!({"files":[{"path":"src/a.rs"},{"path":"src-a.rs"},{"path":"src/a.rs"},{"path":"src/nested/b.rs"}]}),
        );
        assert_eq!(
            result["filePresentation"]["pathOrder"],
            json!(["src-a.rs", "src/a.rs", "src/nested/b.rs"])
        );
        assert_eq!(
            result["filePresentation"]["treeOrder"],
            json!(["src/a.rs", "src/nested/b.rs", "src-a.rs"])
        );
        assert_eq!(
            result["filePresentation"]["tree"][0]["fileRange"],
            json!([0, 2])
        );
    }
}
