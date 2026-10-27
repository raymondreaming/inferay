//! Retain prepared files, validate mutable Git inputs, and bound retained memory.
use super::*;
use std::{collections::VecDeque, sync::Mutex};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Key {
    pub cwd: String,
    pub commit: Option<String>,
    pub path: String,
    pub staged: bool,
}

#[derive(Default)]
pub(super) struct DiffCache {
    entries: VecDeque<(Key, Arc<PreparedDiff>, usize)>,
    bytes: usize,
}

impl DiffCache {
    pub fn get(&mut self, key: &Key) -> Option<Arc<PreparedDiff>> {
        let index = self.entries.iter().position(|entry| &entry.0 == key)?;
        let entry = self.entries.remove(index)?;
        let data = entry.1.clone();
        self.entries.push_back(entry);
        Some(data)
    }

    pub fn put(&mut self, key: Key, data: Arc<PreparedDiff>) {
        if let Some(index) = self.entries.iter().position(|entry| entry.0 == key) {
            self.bytes -= self.entries.remove(index).unwrap().2;
        }
        let bytes = data.bytes();
        const BUDGET: usize = 24 * 1024 * 1024;
        if bytes > BUDGET {
            return;
        }
        while self.entries.len() >= 8 || self.bytes + bytes > BUDGET {
            let Some((_, _, bytes)) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= bytes;
        }
        self.bytes += bytes;
        self.entries.push_back((key, data, bytes));
    }

    /// Historical keys are immutable full commit hashes. Mutable working-tree
    /// inputs are re-read by Git before reuse, including the index and renames.
    pub fn load(cache: &Mutex<Self>, key: &Key, theme: &str) -> Option<Arc<PreparedDiff>> {
        let retained = cache.lock().unwrap().get(key);
        if key.commit.is_some() && retained.is_some() {
            return retained;
        }
        let diff = if let Some(hash) = &key.commit {
            inferay_native_diff::get_git_commit_hunk_diff_for_parent(
                &key.cwd, hash, None, &key.path, false,
            )?
        } else {
            let allowed = AllowedPaths::new(&key.cwd, &key.cwd, &key.cwd).ok()?;
            inferay_native_diff::get_git_hunk_diff(&allowed, &key.cwd, &key.path, key.staged)
        };
        if let Some(data) = retained.filter(|data| *data.diff == diff) {
            return Some(data);
        }
        let data = Arc::new(PreparedDiff::plain(diff, &key.path, theme));
        cache.lock().unwrap().put(key.clone(), data.clone());
        Some(data)
    }

    pub fn publish_colors(&mut self, key: Key, data: Arc<PreparedDiff>) {
        if self
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(&current.diff, &data.diff))
        {
            self.put(key, data);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn git(root: &std::path::Path, args: &[&str]) {
        let output = inferay_native_diff::git_command()
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn fixture() -> (tempfile::TempDir, Key) {
        let root = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "-q"]);
        git(root.path(), &["config", "user.name", "Diff test"]);
        git(
            root.path(),
            &["config", "user.email", "diff@example.invalid"],
        );
        std::fs::write(root.path().join("file.ts"), "const value = 1;\n").unwrap();
        git(root.path(), &["add", "file.ts"]);
        git(root.path(), &["commit", "-qm", "base"]);
        let key = Key {
            cwd: root.path().canonicalize().unwrap().to_string_lossy().into(),
            commit: None,
            path: "file.ts".into(),
            staged: false,
        };
        (root, key)
    }

    #[test]
    #[ignore = "paired release benchmark"]
    fn benchmark_diff_navigation() {
        use std::hint::black_box;
        let (root, key) = fixture();
        let before: String = (0..300)
            .map(|i| format!("export const value_{i}: string = \"before {i}\";\n"))
            .collect();
        std::fs::write(root.path().join("file.ts"), &before).unwrap();
        git(root.path(), &["add", "file.ts"]);
        git(root.path(), &["commit", "-qm", "source"]);
        std::fs::write(
            root.path().join("file.ts"),
            before.replace("before 150", "after 150"),
        )
        .unwrap();
        let cache = Mutex::new(DiffCache::default());
        let allowed = AllowedPaths::new(&key.cwd, &key.cwd, &key.cwd).unwrap();
        let previous = |diff: GitHunkDiff| {
            // The regressed path parsed old, new, and a third mixed inline document before publication.
            let inline =
                inferay_native_diff::prepare_inline_lines(&diff.old_lines, &diff.new_lines);
            let spans = PreparedDiff::classify(&inline, &key.path, "vscode-black");
            black_box(PreparedDiff::new(diff, &key.path, "vscode-black"));
            black_box(spans);
        };
        crate::performance::compare("diff_first_visible_300_rows", |candidate| {
            let diff = inferay_native_diff::get_git_hunk_diff(&allowed, &key.cwd, &key.path, false);
            if candidate {
                black_box(PreparedDiff::plain(diff, &key.path, "vscode-black"));
            } else {
                previous(diff);
            }
        });
        let plain = DiffCache::load(&cache, &key, "vscode-black").unwrap();
        let colored = Arc::new(plain.retheme("vscode-black"));
        cache
            .lock()
            .unwrap()
            .publish_colors(key.clone(), colored.clone());
        assert!(Arc::ptr_eq(
            &DiffCache::load(&cache, &key, "vscode-black").unwrap(),
            &colored
        ));
        crate::performance::compare("diff_repeat_worktree_validated_300_rows", |candidate| {
            if candidate {
                black_box(DiffCache::load(&cache, &key, "vscode-black").unwrap());
            } else {
                previous(inferay_native_diff::get_git_hunk_diff(
                    &allowed, &key.cwd, &key.path, false,
                ));
            }
        });
        let details =
            inferay_native_diff::get_git_commit_details_for_parent(&key.cwd, "HEAD", None).unwrap();
        let historical = Key {
            commit: Some(details.hash),
            ..key.clone()
        };
        let plain = DiffCache::load(&cache, &historical, "vscode-black").unwrap();
        cache
            .lock()
            .unwrap()
            .publish_colors(historical.clone(), Arc::new(plain.retheme("vscode-black")));
        crate::performance::compare("diff_repeat_commit_300_rows", |candidate| {
            if candidate {
                black_box(cache.lock().unwrap().get(&historical).unwrap());
            } else {
                previous(
                    inferay_native_diff::get_git_commit_hunk_diff_for_parent(
                        &key.cwd,
                        historical.commit.as_ref().unwrap(),
                        None,
                        &key.path,
                        false,
                    )
                    .unwrap(),
                );
            }
        });
    }

    #[test]
    fn cached_worktree_revalidates_same_size_edits_and_index_changes() {
        let (root, mut key) = fixture();
        let cache = Mutex::new(DiffCache::default());
        std::fs::write(root.path().join("file.ts"), "const value = 2;\n").unwrap();
        let plain = DiffCache::load(&cache, &key, "vscode-black").unwrap();
        assert_eq!(plain.diff.new_lines[0].content, "const value = 2;");
        assert!(!plain.colored && plain.old.is_empty() && plain.new.is_empty());
        let colored = Arc::new(plain.retheme("vscode-black"));
        cache
            .lock()
            .unwrap()
            .publish_colors(key.clone(), colored.clone());
        let reused = DiffCache::load(&cache, &key, "vscode-black").unwrap();
        assert!(Arc::ptr_eq(&colored, &reused));
        std::fs::write(root.path().join("file.ts"), "const value = 3;\n").unwrap();
        let changed = DiffCache::load(&cache, &key, "vscode-black").unwrap();
        assert!(!Arc::ptr_eq(&changed.diff, &reused.diff));
        assert_eq!(changed.diff.new_lines[0].content, "const value = 3;");
        // A slow recolor must not put an older version back into the cache.
        cache.lock().unwrap().publish_colors(key.clone(), colored);
        assert!(Arc::ptr_eq(
            &cache.lock().unwrap().get(&key).unwrap(),
            &changed
        ));
        git(root.path(), &["add", "file.ts"]);
        let unstaged = DiffCache::load(&cache, &key, "vscode-black").unwrap();
        assert!(
            unstaged
                .diff
                .new_lines
                .iter()
                .all(|line| line.line_type == GitDiffLineType::Context)
        );
        key.staged = true;
        let staged = DiffCache::load(&cache, &key, "vscode-black").unwrap();
        assert_eq!(staged.diff.old_lines[0].content, "const value = 1;");
        assert_eq!(staged.diff.new_lines[0].content, "const value = 3;");
        git(root.path(), &["commit", "-qm", "new baseline"]);
        let committed = DiffCache::load(&cache, &key, "vscode-black").unwrap();
        assert_ne!(*staged.diff, *committed.diff);
    }

    #[test]
    fn cache_is_bounded_and_keys_separate_repositories_and_revisions() {
        let mut cache = DiffCache::default();
        let mut key = Key {
            cwd: "/repo".into(),
            commit: Some("immutable".into()),
            path: "file.rs".into(),
            staged: false,
        };
        let data = Arc::new(PreparedDiff::plain(
            GitHunkDiff::default(),
            "file.rs",
            "vscode-black",
        ));
        for index in 0..10 {
            key.path = format!("{index}.rs");
            cache.put(key.clone(), data.clone());
        }
        assert_eq!(cache.entries.len(), 8);
        assert!(cache.bytes <= 24 * 1024 * 1024);
        key.path = "0.rs".into();
        assert!(cache.get(&key).is_none());
        key.path = "9.rs".into();
        assert!(cache.get(&key).is_some());
        for other in [
            Key {
                cwd: "/other".into(),
                ..key.clone()
            },
            Key {
                commit: Some("different".into()),
                ..key.clone()
            },
            Key {
                staged: true,
                ..key.clone()
            },
        ] {
            assert!(cache.get(&other).is_none());
        }
        let oversized = PreparedDiff::plain(
            GitHunkDiff {
                raw_patch: Some("x".repeat(25 * 1024 * 1024)),
                ..Default::default()
            },
            "9.rs",
            "vscode-black",
        );
        cache.put(key.clone(), Arc::new(oversized));
        assert!(cache.get(&key).is_none());
        assert!(cache.bytes <= 24 * 1024 * 1024);
    }
}
