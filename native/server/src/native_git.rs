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

#[derive(Debug, Serialize, PartialEq, Eq)]
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
