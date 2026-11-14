use super::*;

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
    git(root.path(), &["config", "commit.gpgsign", "false"]);
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
        let inline = inferay_native_diff::prepare_inline_lines(&diff.old_lines, &diff.new_lines);
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
