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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::run_git as git;

    #[test]
    fn comparison_plan_orders_native_history_and_rejects_ambiguous_worktrees() {
        let item = |id: &str, order: usize| ComparisonSelection {
            id: id.into(),
            hash: id.into(),
            item_kind: "commit".into(),
            history_order: Some(order),
            worktree_path: None,
        };
        let wip = |id: &str| ComparisonSelection {
            id: id.into(),
            hash: String::new(),
            item_kind: "worktreeWip".into(),
            history_order: None,
            worktree_path: Some("/repo/linked".into()),
        };
        let plan = plan_comparison(
            "/repo",
            &[item("older", 900), item("newer", 2), item("older", 900)],
        )
        .unwrap();
        assert_eq!(plan.from, "older");
        assert_eq!(plan.to, "newer");
        let plan = plan_comparison("/repo", &[wip("wip"), item("older", 900)]).unwrap();
        assert_eq!(plan.cwd, "/repo/linked");
        assert_eq!(plan.to, "WORKTREE");
        assert!(plan_comparison("/repo", &[wip("a"), wip("b"), item("older", 900)]).is_none());
        assert!(plan_comparison("/repo", &[item("same", 1), item("same", 1)]).is_none());
        let mut missing = item("missing", 0);
        missing.history_order = None;
        assert!(plan_comparison("/repo", &[missing, item("older", 900)]).is_none());
    }

    #[tokio::test]
    async fn full_diff_cache_reuses_and_invalidates_by_repository_fingerprint() {
        let repository = tempfile::tempdir().unwrap();
        git(repository.path(), &["init", "-q"]);
        git(
            repository.path(),
            &["config", "user.email", "test@example.com"],
        );
        git(repository.path(), &["config", "user.name", "Test User"]);
        std::fs::write(
            repository.path().join("app.ts"),
            "export const value = 1;\n",
        )
        .unwrap();
        git(repository.path(), &["add", "app.ts"]);
        git(repository.path(), &["commit", "-qm", "initial"]);
        std::fs::write(
            repository.path().join("app.ts"),
            "export const value = 22;\n",
        )
        .unwrap();

        let allowed =
            AllowedPaths::new(repository.path(), repository.path().canonicalize().unwrap())
                .unwrap();
        let cwd = repository.path().to_string_lossy();
        let fetch = || {
            full_diff(
                allowed.clone(),
                cwd.to_string(),
                "app.ts".into(),
                false,
                true,
            )
        };
        let first = fetch().await.unwrap().unwrap();
        let second = fetch().await.unwrap().unwrap();
        assert_eq!(first, second);
        assert_eq!(
            first.as_ptr(),
            second.as_ptr(),
            "cache hits share prepared response bytes"
        );

        let broader = AllowedPaths::new(
            repository.path(),
            repository.path().canonicalize().unwrap().parent().unwrap(),
        )
        .unwrap();
        let scoped = full_diff(broader, cwd.to_string(), "app.ts".into(), false, true)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first, scoped);
        assert_ne!(
            first.as_ptr(),
            scoped.as_ptr(),
            "different allowed roots cannot share a cached response"
        );

        std::fs::write(
            repository.path().join("app.ts"),
            "export const value = 333;\n",
        )
        .unwrap();
        let refreshed = fetch().await.unwrap().unwrap();
        assert_ne!(second, refreshed);
        let diff: serde_json::Value = serde_json::from_slice(&refreshed).unwrap();
        assert!(diff["compactLines"].as_array().unwrap().iter().any(|line| {
            line["content"]
                .as_str()
                .unwrap()
                .contains("export const value = 333;")
        }));
    }
}
