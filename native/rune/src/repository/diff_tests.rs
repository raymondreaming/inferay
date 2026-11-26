use super::super::testing::*;
use super::*;
use rune::{Key, Mods};

fn status(files: Value) -> Option<GitStatusResult> {
    Some(
        serde_json::from_value(json!({"cwd":"", "name":"", "branch":"main", "upstream":null, "ahead":0, "behind":0, "files":files}))
            .unwrap(),
    )
}

#[test]
fn svg_previews_load_authenticated_before_and_after_images() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let root = profile.path().join("projects").join("image-fixture");
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    init_repo(&root, "main");
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>"#;
    std::fs::write(root.join("icon.svg"), svg).unwrap();
    git(&root, &["add", "icon.svg"]);
    git(&root, &["commit", "-m", "Add icon"]);
    std::fs::write(root.join("icon.svg"), svg.replace("red", "blue")).unwrap();
    let backend = crate::backend::RUNTIME
        .block_on(crate::backend::Backend::connect(profile.path().into()))
        .unwrap();
    let cwd = root.to_string_lossy().into_owned();
    let allowed = AllowedPaths::new(&root, &root, &root).unwrap();
    let diff = inferay_native_diff::get_git_hunk_diff(&allowed, &cwd, "icon.svg", false);
    let mut view = idle_view(&root);
    view.backend.set(backend).ok().unwrap();
    view.show_diff = true;
    view.file = Some("icon.svg".into());
    let mut rt = harness(view, (900., 600.));
    update(&mut rt, |view, tx| {
        view.show_prepared_diff(
            Arc::new(PreparedDiff::new(diff, "icon.svg", "vscode-black")),
            tx,
        )
    });
    run_until(&mut rt, |s| {
        s.repository_views
            .values()
            .next()
            .unwrap()
            .diff_images
            .iter()
            .all(|image| image.is_some())
    });
    for image in &repo(&rt).diff_images {
        let pixels = image.as_ref().unwrap().as_ref().unwrap();
        assert_eq!(pixels.size(), (20, 20));
    }
    frames(&mut rt, 2);
    assert!(rect(&rt, "diff-images").is_some());
    assert!(rect(&rt, "diff-image-1").is_some());
}

fn segmented_view(root: &std::path::Path) -> RepositoryView {
    let mut view = idle_view(root);
    view.show_diff = true;
    view.changes = false;
    view.file = Some("file.rs".into());
    view.diff = Some(Arc::new(PreparedDiff::new(
        GitHunkDiff {
            old_lines: vec![GitDiffLine {
                number: Some(1),
                content: "old ".repeat(200),
                line_type: GitDiffLineType::Remove,
            }],
            new_lines: vec![
                GitDiffLine {
                    number: Some(1),
                    content: "new".into(),
                    line_type: GitDiffLineType::Add,
                },
                GitDiffLine {
                    number: None,
                    content: String::new(),
                    line_type: GitDiffLineType::Spacer,
                },
                GitDiffLine {
                    number: Some(2),
                    content: "unchanged".into(),
                    line_type: GitDiffLineType::Context,
                },
            ],
            ..Default::default()
        },
        "file.rs",
        "vscode-black",
    )));
    view
}

#[test]
fn segmented_diff_modes_and_file_view_reuse_full_contents() {
    let _serial = serial();
    let root = tempfile::tempdir().unwrap();
    let mut rt = harness(segmented_view(root.path()), (900., 500.));
    let pane = rect(&rt, "diff-code-0-0").unwrap();
    rt.wheel_xy(pane[0] + pane[2] / 2., pane[1] + pane[3] / 2., -120., 0.);
    frames(&mut rt, 2);
    assert!(repo(&rt).diff_horizontal[0].get()[0] < 0.);
    assert_eq!(repo(&rt).diff_horizontal[1].get()[0], 0.);
    assert_eq!(rect(&rt, "diff-code-0-0").unwrap(), pane);
    let retained = repo(&rt).diff.clone().unwrap();
    click(&mut rt, "diff-unified");
    assert!(!repo(&rt).split_diff && !repo(&rt).file_view);
    click(&mut rt, "diff-file");
    assert!(repo(&rt).file_view);
    assert!(Arc::ptr_eq(&retained, repo(&rt).diff.as_ref().unwrap()));
    assert!(
        rect(&rt, "diff-row-1").is_some(),
        "whole file includes unchanged lines"
    );
    assert!(
        rect(&rt, "diff-row-2").is_none(),
        "alignment spacers are excluded"
    );
    assert!(rect(&rt, "diff-minimap").is_none());
    click(&mut rt, "diff-split");
    assert!(repo(&rt).split_diff && !repo(&rt).file_view);
    for code in ["A", "D", "?", "??", "M"] {
        update(&mut rt, |s, _| {
            s.status = status(json!([{"path":"file.rs", "status":code, "staged":false}]));
        });
        assert!(repo(&rt).split_diff);
        assert_eq!(repo(&rt).effective_split_diff(), code == "M");
        assert_eq!(rect(&rt, "diff-code-1-0").is_some(), code == "M");
    }
    update(&mut rt, |s, _| {
        s.file_view = true;
        s.diff = Some(Arc::new(PreparedDiff::new(
            GitHunkDiff {
                old_lines: retained.diff.old_lines.clone(),
                ..Default::default()
            },
            "file.rs",
            "vscode-black",
        )));
    });
    assert!(rect(&rt, "diff-row-0").is_none());
    update(&mut rt, |s, _| {
        s.diff = Some(retained.clone());
        s.selected_staged = true;
        s.status = status(json!([
            {"path":"file.rs", "status":"D", "staged":false},
            {"path":"file.rs", "status":"M", "staged":true}
        ]));
    });
    assert!(rect(&rt, "diff-row-1").is_some());
    update(&mut rt, |s, _| s.selected_staged = false);
    assert!(
        rect(&rt, "diff-row-0").is_some(),
        "deleted file shows its previous contents"
    );
    assert!(rect(&rt, "diff-row-1").is_none());
}

#[test]
#[ignore = "release diagnostic; read-only local repository"]
fn profile_diff_open() {
    use std::time::Instant;
    assert!(!std::hint::black_box(cfg!(debug_assertions)));
    let cwd = std::env::var("INFERAY_DIFF_PROFILE_CWD").unwrap();
    let revision = std::env::var("INFERAY_DIFF_PROFILE_COMMIT").unwrap_or_else(|_| "HEAD".into());
    let details =
        inferay_native_diff::get_git_commit_details_for_parent(&cwd, &revision, None).unwrap();
    for file in details.files.iter().take(6) {
        let started = Instant::now();
        let diff = inferay_native_diff::get_git_commit_hunk_diff_for_parent(
            &cwd,
            &details.hash,
            None,
            &file.path,
            false,
        )
        .unwrap();
        let read = started.elapsed();
        let prepared = PreparedDiff::plain(diff, &file.path, "vscode-black");
        println!(
            "{}",
            json!({"file":file.path,"git_ms":read.as_secs_f64()*1000.,"prepare_ms":(started.elapsed()-read).as_secs_f64()*1000.,"rows":prepared.diff.old_lines.len().max(prepared.diff.new_lines.len())})
        );
    }
}

#[test]
fn revisiting_cached_commits_publishes_immediately_without_a_git_job() {
    let _serial = serial();
    let mut view = RepositoryView::new(
        "/not-a-repository".into(),
        json!({}),
        "vscode-black".into(),
        0,
    );
    view.task = None;
    view.selected = Some("0123456789012345678901234567890123456789".into());
    for path in ["a.rs", "b.rs"] {
        let prepared = Arc::new(PreparedDiff::new(
            GitHunkDiff::default(),
            path,
            "vscode-black",
        ));
        let key = view.diff_key(path.into(), false);
        view.diff_cache.lock().unwrap().put(key, prepared);
    }
    let mut rt = harness(view, (800., 500.));
    for path in ["a.rs", "b.rs", "a.rs"] {
        update(&mut rt, |view, tx| {
            view.open_file(path.into(), false, tx);
            assert_eq!(view.diff.as_ref().unwrap().path, path);
            assert!(view.diff.as_ref().unwrap().colored);
            assert!(view.diff_task.is_none());
            assert!(view.theme_task.is_none());
        });
    }
}

#[test]
fn space_wraps_changes_and_minimap_clicks_scroll_the_same_view() {
    let _serial = serial();
    let root = tempfile::tempdir().unwrap();
    let mut view = RepositoryView::new(
        root.path().to_string_lossy().into(),
        json!({}),
        "vscode-black".into(),
        crate::colors::CANVAS,
    );
    view.task = None;
    view.loading = false;
    view.show_diff = true;
    view.history = false;
    view.changes = false;
    view.file = Some("file.rs".into());
    view.keyboard_scope = "diff";
    let old: Vec<_> = (0..180)
        .map(|i| GitDiffLine {
            number: Some(i + 1),
            content: format!("let value = {i};"),
            line_type: if [20, 80, 160].contains(&i) {
                GitDiffLineType::Remove
            } else {
                GitDiffLineType::Context
            },
        })
        .collect();
    let new = old
        .iter()
        .map(|line| GitDiffLine {
            line_type: if line.line_type == GitDiffLineType::Remove {
                GitDiffLineType::Add
            } else {
                line.line_type
            },
            ..line.clone()
        })
        .collect();
    view.diff = Some(Arc::new(PreparedDiff::new(
        GitHunkDiff {
            old_lines: old,
            new_lines: new,
            ..Default::default()
        },
        "file.rs",
        "vscode-black",
    )));
    let mut rt = harness(view, (800., 500.));
    update(&mut rt, |view, tx| view.jump_diff_change(0, tx));
    frames(&mut rt, 2);
    click(&mut rt, "diff-row-20");
    for (shift, expected, row) in [
        (false, 1, 80),
        (false, 2, 160),
        (false, 0, 20),
        (true, 2, 160),
    ] {
        press(
            &mut rt,
            Key::Text(" ".into()),
            Mods {
                shift,
                ..Mods::default()
            },
        );
        assert_eq!(repo(&rt).diff_change, Some(expected));
        let lines = rect(&rt, "diff-lines").unwrap();
        let target = rect(&rt, &format!("diff-row-{row}")).expect("changed row is mounted");
        assert!(
            target[1] >= lines[1] && target[1] + target[3] <= lines[1] + lines[3],
            "row {row} is visible"
        );
    }
    let rail = rect(&rt, "diff-minimap").unwrap();
    click_at(&mut rt, (rail[0] + rail[2] / 2., rail[1] + rail[3] * 0.25));
    frames(&mut rt, 2);
    {
        let view = repo(&rt);
        assert!(view.diff_change.is_none());
        let [offset, max, _, _] = view.diff_scroll.get();
        assert!(offset > 0.);
        assert!(offset < max * 0.6);
        assert!(view.minimap_drag.is_none());
    }
    update(&mut rt, |view, tx| {
        view.split_diff = false;
        view.diff_change = None;
        view.jump_diff_change(0, tx);
    });
    press(&mut rt, Key::Text(" ".into()), Mods::default());
    assert_eq!(repo(&rt).diff_change, Some(1));
}

#[test]
fn long_file_lists_mount_visible_rows_and_keys_reach_the_last_file() {
    let _serial = serial();
    let mut view = RepositoryView::new(
        "/not-a-repository".into(),
        json!({}),
        "vscode-black".into(),
        crate::colors::CANVAS,
    );
    view.task = None;
    view.loading = false;
    view.selected = Some("0123456789012345678901234567890123456789".into());
    view.details = Some(
        serde_json::from_value(json!({
            "hash": "0123456789012345678901234567890123456789",
            "message": "", "body": "", "author": "", "authorEmail": "", "authoredAt": "",
            "files": (0..300).map(|i| json!({"path": format!("src/file_{i:03}.rs"), "status": "M", "additions": 1, "deletions": 0})).collect::<Vec<_>>(),
        }))
        .unwrap(),
    );
    view.history = false;
    view.changes = true;
    let mut rt = harness(view, (900., 600.));
    assert!(rect(&rt, "changed-file-false-0").is_some());
    assert!(rect(&rt, "changed-file-false-299").is_none());
    update(&mut rt, |view, tx| {
        view.file = Some("src/file_298.rs".into());
        view.navigate_file(1, tx);
    });
    frames(&mut rt, 2);
    assert_eq!(repo(&rt).file.as_deref(), Some("src/file_299.rs"));
    let list = rect(&rt, "changed-files-0").unwrap();
    let last = rect(&rt, "changed-file-false-299").expect("the last file is mounted");
    assert!(last[1] >= list[1] && last[1] + last[3] <= list[1] + list[3] + 0.5);
    assert!(rect(&rt, "changed-file-false-0").is_none());
}

#[test]
fn rows_near_the_first_change_are_colored_before_the_whole_diff() {
    let _serial = serial();
    let lines: Vec<_> = (0..1000)
        .map(|i| GitDiffLine {
            number: Some(i + 1),
            content: format!("let value_{i} = {i};"),
            line_type: if i == 10 {
                GitDiffLineType::Remove
            } else {
                GitDiffLineType::Context
            },
        })
        .collect();
    let diff = GitHunkDiff {
        old_lines: lines.clone(),
        new_lines: lines,
        ..Default::default()
    };
    let mut view = RepositoryView::new(
        "/not-a-repository".into(),
        json!({}),
        "vscode-black".into(),
        crate::colors::CANVAS,
    );
    view.task = None;
    view.file = Some("file.rs".into());
    let mut rt = crate::task::testing::runtime(Workspace::empty());
    rt.state.repository_views.insert(view.path.clone(), view);
    let path = "/not-a-repository".to_owned();
    rt.update(|s, tx| {
        let view = s.repository_views.get_mut(&path).unwrap();
        view.show_prepared_diff(
            Arc::new(PreparedDiff::plain(diff, "file.rs", "vscode-black")),
            tx,
        );
    });
    let mut updates = Vec::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while updates.len() < 2 {
        assert!(std::time::Instant::now() < deadline);
        updates.extend(crate::task::headless::drain());
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let mut updates = updates.into_iter();
    rt.update(updates.next().unwrap());
    rt.frame(1. / 60.);
    let early = rt.state.repository_views[&path].diff.clone().unwrap();
    assert!(!early.colored);
    assert_eq!(early.old.len(), 210);
    assert!(!early.old[10].is_empty());
    rt.update(updates.next().unwrap());
    rt.frame(1. / 60.);
    let full = rt.state.repository_views[&path].diff.clone().unwrap();
    assert!(full.colored);
    assert_eq!(full.old.len(), 1000);
    assert_eq!(full.old[..210], early.old[..]);
}

#[test]
fn collapsed_tree_folders_count_their_edited_added_and_removed_files() {
    let _serial = serial();
    let mut view = RepositoryView::new(
        "/not-a-repository".into(),
        json!({}),
        "vscode-black".into(),
        crate::colors::CANVAS,
    );
    view.task = None;
    view.loading = false;
    view.selected = Some("0123456789012345678901234567890123456789".into());
    view.details = Some(
        serde_json::from_value(json!({
            "hash": "0123456789012345678901234567890123456789",
            "message": "", "body": "", "author": "", "authorEmail": "", "authoredAt": "",
            "files": [
                {"path":"src/app/main.rs","status":"M","additions":1,"deletions":1},
                {"path":"src/app/new.rs","status":"A","additions":3,"deletions":0},
                {"path":"src/lib.rs","status":"M","additions":1,"deletions":0},
                {"path":"src/old.rs","status":"D","additions":0,"deletions":4},
                {"path":"docs/guide.md","status":"A","additions":2,"deletions":0},
            ],
        }))
        .unwrap(),
    );
    view.history = false;
    view.changes = true;
    view.tree_files = true;
    let mut rt = harness(view, (900., 600.));
    let counts = |rt: &rune::Runtime<Workspace>, directory: &str| -> Vec<String> {
        let key = format!("directory-false-{directory}");
        rt.elements()
            .into_iter()
            .filter(|e| e.path.contains(&key) && e.key.as_deref() != Some(key.as_str()))
            .filter_map(|e| e.text)
            .filter(|text| text.chars().all(|c| c.is_ascii_digit()) && !text.is_empty())
            .collect()
    };
    assert!(
        counts(&rt, "src").is_empty(),
        "an open folder lists its files instead"
    );
    click(&mut rt, "directory-false-src");
    frames(&mut rt, 2);
    assert_eq!(counts(&rt, "src"), ["2", "1", "1"]);
    click(&mut rt, "directory-false-docs");
    frames(&mut rt, 2);
    assert_eq!(
        counts(&rt, "docs"),
        ["1"],
        "only kinds that changed are shown"
    );
}
