//! Git comparison admission and fingerprinted full-diff response preparation.

use std::path::PathBuf;

use crate::render_jobs;
use axum::body::Bytes;
use inferay_core::path_security::AllowedPaths;
use inferay_native_diff::{compact_git_hunk_diff, get_git_hunk_diff};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified_nanos: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

pub async fn full_diff(
    allowed_paths: AllowedPaths,
    cwd: String,
    file: String,
    staged: bool,
    review: bool,
) -> Result<Option<Bytes>, String> {
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
            let diff = get_git_hunk_diff(&allowed_paths, &cwd, &file, staged);
            let changed = diff.is_new
                || diff
                    .raw_patch
                    .as_deref()
                    .is_some_and(|patch| !patch.trim().is_empty())
                || diff.merge_conflict_content.is_some();
            changed.then(|| {
                render_jobs::diff_bytes(if review {
                    compact_git_hunk_diff(diff)
                } else {
                    diff
                })
            })
        },
        move || fingerprint == diff_fingerprint(&root, &path),
    )
    .await
    .map(|(body, _)| body)
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

/// Graph preferences decorate the typed snapshot at the HTTP boundary.
pub(super) fn graph_response(
    snapshot: inferay_native_diff::GitGraphSnapshot,
    hidden: &[String],
    solo: &[String],
    pinned: &[String],
) -> serde_json::Value {
    use inferay_native_diff::GitGraphRefKind;
    use serde_json::json;
    use std::collections::{BTreeMap, BTreeSet};
    let commits = &snapshot.commits;
    let refs = commits
        .iter()
        .flat_map(|commit| &commit.refs)
        .map(|reference| (reference.full_name.as_str(), reference))
        .collect::<BTreeMap<_, _>>();
    let containing = commits
        .iter()
        .filter_map(|commit| {
            Some((
                commit.id.as_str(),
                *refs.get(commit.navigation.containing_branch.as_deref()?)?,
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let mut reachable = BTreeSet::new();
    for name in solo {
        for [start, end] in snapshot.ancestry.get(name).into_iter().flatten() {
            reachable.extend(
                commits
                    .iter()
                    .take(end.saturating_add(1))
                    .skip(*start)
                    .map(|commit| &commit.id),
            );
        }
    }
    let pinned_columns = pinned
        .iter()
        .filter_map(|name| {
            let target = &refs.get(name.as_str())?.target;
            commits
                .iter()
                .find(|commit| &commit.hash == target || &commit.id == target)
                .map(|commit| commit.column)
        })
        .collect::<Vec<_>>();
    let presentation = json!({
        "containingBranches": containing,
        "defaultRemoteName": refs.values().find(|reference| reference.kind == GitGraphRefKind::RemoteBranch).and_then(|reference| reference.remote_name.as_deref()),
        "hiddenRefDetails": hidden.iter().filter_map(|name| refs.get(name.as_str())).collect::<Vec<_>>(),
        "hiddenRefNames": hidden,
        "pinnedColumns": pinned_columns,
        "pinnedRefNames": pinned,
        "reachableHistory": reachable,
        "selectableItems": commits.iter().map(|commit| &commit.id).collect::<Vec<_>>(),
    });
    let mut response = json!(snapshot);
    response["presentation"] = presentation;
    response["actions"] = crate::git_actions::CATALOG.clone();
    response
}

#[cfg(test)]
mod graph_response_tests {
    use super::*;
    use inferay_native_diff::*;
    use serde_json::json;

    #[test]
    fn graph_preferences_preserve_branch_identity_reachability_and_pinned_columns() {
        let reference: GitGraphRef =
            serde_json::from_value(json!({"fullName":"refs/remotes/origin/main",
            "displayName":"origin/main", "label":"main", "kind":"remoteBranch", "target":"tip",
            "remoteName":"origin", "isHead":false}))
            .unwrap();
        let snapshot = GitGraphSnapshot {
            commits: vec![
                GraphCommit {
                    id: "tip".into(),
                    hash: "tip".into(),
                    column: 2,
                    refs: vec![reference.clone()],
                    navigation: GraphNavigation {
                        containing_branch: Some(reference.full_name.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                GraphCommit {
                    id: "base".into(),
                    hash: "base".into(),
                    ..Default::default()
                },
            ],
            rows: vec![],
            has_more: false,
            worktrees: vec![],
            stashes: vec![],
            revision: "fixture".into(),
            ancestry: [(reference.full_name.clone(), vec![[0, 1]])].into(),
            operation: GitRepositoryOperationState {
                kind: GitRepositoryOperationKind::Idle,
                phase: GitRepositoryOperationPhase::Idle,
                conflicts: vec![],
            },
            state: GitRepositorySnapshotState::Ready,
            state_error: None,
        };
        let refs = vec![reference.full_name.clone(), "missing".into()];
        let response = graph_response(snapshot.clone(), &refs, &refs, &refs);
        assert_eq!(
            response["presentation"],
            json!({
                "containingBranches":{"tip":reference}, "defaultRemoteName":"origin",
                "hiddenRefDetails":[reference], "hiddenRefNames":refs,
                "pinnedColumns":[2], "pinnedRefNames":refs, "reachableHistory":["base","tip"],
                "selectableItems":["tip","base"],
            })
        );
        assert_eq!(response["commits"], json!(snapshot.commits));
        assert_eq!(response["actions"], crate::git_actions::CATALOG.clone());
    }
}
