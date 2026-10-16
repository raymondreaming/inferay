//! Git comparison admission, fingerprinted diffs and graph transport updates.

use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use crate::render_jobs;
use inferay_core::path_security::AllowedPaths;
use inferay_native_diff::{compact_git_hunk_diff, get_git_hunk_diff};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// A graph update against an exact cached representation. Unchanged root fields
/// and commit prefixes/suffixes retain their browser object identities.
#[derive(Serialize, ts_rs::TS)]
pub struct GraphDelta<'a> {
    #[ts(type = "Partial<import('./GraphData.ts').GraphData>")]
    fields: std::collections::BTreeMap<&'a str, &'a serde_json::value::RawValue>,
    #[ts(type = "Array<keyof import('./GraphData.ts').GraphData>")]
    removed: Vec<&'a str>,
    commits: Option<GraphCommitSplice<'a>>,
}
#[derive(Serialize, ts_rs::TS)]
pub struct GraphCommitSplice<'a> {
    start: usize,
    delete: usize,
    #[ts(as = "Vec<inferay_core::repository::GraphCommit>")]
    items: Vec<&'a serde_json::value::RawValue>,
}

/// Parse each commit once while retaining borrowed JSON for every other field.
struct GraphParts<'a> {
    fields: std::collections::BTreeMap<&'a str, &'a serde_json::value::RawValue>,
    commits: Vec<&'a serde_json::value::RawValue>,
}
impl<'de> Deserialize<'de> for GraphParts<'de> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct PartsVisitor;
        impl<'de> serde::de::Visitor<'de> for PartsVisitor {
            type Value = GraphParts<'de>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a graph snapshot")
            }
            fn visit_map<M: serde::de::MapAccess<'de>>(
                self,
                mut map: M,
            ) -> Result<Self::Value, M::Error> {
                let mut fields = std::collections::BTreeMap::new();
                let mut commits = None;
                while let Some(key) = map.next_key::<&str>()? {
                    if key == "commits" {
                        commits = Some(map.next_value()?);
                    } else {
                        fields.insert(key, map.next_value()?);
                    }
                }
                Ok(GraphParts {
                    fields,
                    commits: commits.ok_or_else(|| serde::de::Error::missing_field("commits"))?,
                })
            }
        }
        deserializer.deserialize_map(PartsVisitor)
    }
}

pub(crate) fn graph_delta(before: &[u8], after: &[u8]) -> Option<Vec<u8>> {
    use std::collections::BTreeMap;
    // Small responses do not warrant another parsing pass.
    if after.len() < 64 * 1024 {
        return None;
    }
    let old: GraphParts = serde_json::from_slice(before).ok()?;
    let new: GraphParts = serde_json::from_slice(after).ok()?;
    let fields: BTreeMap<_, _> = new
        .fields
        .iter()
        .filter(|(key, value)| {
            old.fields
                .get(**key)
                .is_none_or(|previous| previous.get() != value.get())
        })
        .map(|(&key, &value)| (key, value))
        .collect();
    let removed = old
        .fields
        .keys()
        .filter(|key| !new.fields.contains_key(**key))
        .copied()
        .collect();
    let before = old.commits;
    let commits = new.commits;
    let start = before
        .iter()
        .zip(&commits)
        .take_while(|(a, b)| a.get() == b.get())
        .count();
    let commits = if start == before.len() && start == commits.len() {
        None
    } else {
        let suffix = before[start..]
            .iter()
            .rev()
            .zip(commits[start..].iter().rev())
            .take_while(|(a, b)| a.get() == b.get())
            .count();
        Some(GraphCommitSplice {
            start,
            delete: before.len() - start - suffix,
            items: commits[start..commits.len() - suffix].to_vec(),
        })
    };
    let delta = serde_json::to_vec(&GraphDelta {
        fields,
        removed,
        commits,
    })
    .ok()?;
    (delta.len() < after.len() * 4 / 5).then_some(delta)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct FileStamp {
    len: u64,
    modified_nanos: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct DiffFingerprint {
    file: Option<FileStamp>,
    parent: Option<FileStamp>,
    index: Option<FileStamp>,
    head: Option<FileStamp>,
    refs: Option<FileStamp>,
    packed_refs: Option<FileStamp>,
    config: Option<FileStamp>,
}

/// Selection facts from the revisioned native graph, including off-page selections.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonSelection {
    pub id: String,
    pub hash: String,
    pub item_kind: String,
    pub history_order: Option<usize>,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonPlan {
    pub cwd: String,
    pub from: String,
    pub to: String,
}

pub fn plan_comparison(cwd: &str, items: &[ComparisonSelection]) -> Option<ComparisonPlan> {
    let mut seen = std::collections::HashSet::new();
    let mut commits = Vec::new();
    let mut worktree = None;
    for item in items {
        if !seen.insert(&item.id) {
            continue;
        }
        match item.item_kind.as_str() {
            "worktreeWip" => {
                if worktree.is_some() {
                    return None;
                }
                worktree = Some(item.worktree_path.as_deref()?);
            }
            "commit" | "stash" => {
                let order = item.history_order?;
                commits.push((order, item.hash.as_str()));
            }
            _ => return None,
        }
    }
    if commits.len() < if worktree.is_some() { 1 } else { 2 } {
        return None;
    }
    commits.sort_by_key(|(order, _)| *order);
    let from = commits.last()?.1;
    let to = if worktree.is_some() {
        "WORKTREE"
    } else {
        commits.first()?.1
    };
    if from == to {
        return None;
    }
    Some(ComparisonPlan {
        cwd: worktree.unwrap_or(cwd).into(),
        from: from.into(),
        to: to.into(),
    })
}

pub(crate) async fn full_diff(
    allowed_paths: AllowedPaths,
    cwd: String,
    file: String,
    staged: bool,
    review: bool,
) -> Result<(Option<render_jobs::Rendered>, bool), String> {
    let (root, path) = (cwd.clone(), file.clone());
    let fingerprint = render_jobs::run(move || diff_fingerprint(&root, &path)).await?;
    // Include the allowed roots because response caches are shared across server instances.
    let key = format!(
        "full-diff:{:?}",
        (&allowed_paths, &cwd, &file, staged, review, fingerprint)
    );
    let (root, path) = (cwd.clone(), file.clone());
    render_jobs::cached_if(
        key,
        Duration::from_secs(2),
        move || {
            let mut diff = get_git_hunk_diff(&allowed_paths, &cwd, &file, staged);
            // Mutable image URLs must change with their source, even when the
            // diff has no textual patch (for example, an untracked image).
            if diff.is_image == Some(true) {
                for image in [&mut diff.old_image, &mut diff.new_image]
                    .into_iter()
                    .flatten()
                {
                    let mut hash = std::hash::DefaultHasher::new();
                    if image.starts_with("/api/file?") {
                        fingerprint.file.hash(&mut hash);
                    } else {
                        (
                            fingerprint.index,
                            fingerprint.head,
                            fingerprint.refs,
                            fingerprint.packed_refs,
                        )
                            .hash(&mut hash);
                    }
                    image.push_str(&format!("&version={:x}", hash.finish()));
                }
            }
            let changed = diff.is_new
                || diff
                    .raw_patch
                    .as_deref()
                    .is_some_and(|patch| !patch.trim().is_empty())
                || diff.merge_conflict_content.is_some();
            changed.then(|| {
                render_jobs::diff_bytes(
                    if review {
                        compact_git_hunk_diff(diff)
                    } else {
                        diff
                    },
                    &file,
                )
            })
        },
        move || fingerprint == diff_fingerprint(&root, &path),
    )
    .await
}

fn file_stamp(path: PathBuf) -> Option<FileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified_nanos = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(FileStamp {
        len: metadata.len(),
        modified_nanos,
    })
}

fn git_directories(root: &std::path::Path) -> (PathBuf, PathBuf) {
    let marker = root.join(".git");
    let git_dir = if marker.is_file() {
        std::fs::read_to_string(&marker)
            .ok()
            .and_then(|text| {
                text.trim()
                    .strip_prefix("gitdir: ")
                    .map(|path| root.join(path))
            })
            .unwrap_or(marker)
    } else {
        marker
    };
    let common = std::fs::read_to_string(git_dir.join("commondir"))
        .map(|path| git_dir.join(path.trim()))
        .unwrap_or_else(|_| git_dir.clone());
    (git_dir, common)
}

fn diff_fingerprint(cwd: &str, file: &str) -> DiffFingerprint {
    let root = PathBuf::from(cwd);
    let path = root.join(file);
    let (git_dir, common) = git_directories(&root);
    let head_ref = std::fs::read_to_string(git_dir.join("HEAD"))
        .ok()
        .and_then(|head| {
            head.trim()
                .strip_prefix("ref: ")
                .map(|name| common.join(name))
        });
    DiffFingerprint {
        file: file_stamp(path.clone()),
        parent: path.parent().map(PathBuf::from).and_then(file_stamp),
        index: file_stamp(git_dir.join("index")),
        head: file_stamp(git_dir.join("HEAD")),
        refs: head_ref.and_then(file_stamp),
        packed_refs: file_stamp(common.join("packed-refs")),
        config: file_stamp(common.join("config")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn graph_delta_reconstructs_history_and_optional_field_changes() {
        let before = json!({"commits":[{"id":"a"},{"id":"b"},{"id":"c"}],
            "revision":"old", "stateError":"old error", "padding":"x".repeat(70000)});
        for commits in [
            json!([{"id":"a"},{"id":"b"},{"id":"c"}]),
            json!([{"id":"wip"},{"id":"a"},{"id":"b"},{"id":"c"}]),
            json!([{"id":"a"},{"id":"updated"},{"id":"c"}]),
            json!([{"id":"a"},{"id":"b"}]),
            json!([]),
            json!([{ "id": "a", "body": "quote\" \n 🦀" }, { "id": "b" }, { "id": "c" }]),
        ] {
            let mut after = before.clone();
            after["commits"] = commits;
            after["revision"] = json!("new");
            after.as_object_mut().unwrap().remove("stateError");
            let delta: Value = serde_json::from_slice(
                &graph_delta(
                    &serde_json::to_vec(&before).unwrap(),
                    &serde_json::to_vec(&after).unwrap(),
                )
                .unwrap(),
            )
            .unwrap();
            assert_eq!(delta["removed"], json!(["stateError"]));
            assert!(delta["fields"].get("padding").is_none());
            let mut restored = before.clone();
            restored
                .as_object_mut()
                .unwrap()
                .extend(delta["fields"].as_object().unwrap().clone());
            for key in delta["removed"].as_array().unwrap() {
                restored
                    .as_object_mut()
                    .unwrap()
                    .remove(key.as_str().unwrap());
            }
            if !delta["commits"].is_null() {
                let splice = &delta["commits"];
                let start = splice["start"].as_u64().unwrap() as usize;
                let delete = splice["delete"].as_u64().unwrap() as usize;
                restored["commits"].as_array_mut().unwrap().splice(
                    start..start + delete,
                    splice["items"].as_array().unwrap().iter().cloned(),
                );
            }
            assert_eq!(restored, after);
        }
        assert!(graph_delta(b"{}", b"{}").is_none());
        let unrelated = json!({"padding":"y".repeat(70000)});
        assert!(
            graph_delta(
                &serde_json::to_vec(&before).unwrap(),
                &serde_json::to_vec(&unrelated).unwrap()
            )
            .is_none()
        );
        assert!(graph_delta(b"invalid", &serde_json::to_vec(&before).unwrap()).is_none());
    }
}
