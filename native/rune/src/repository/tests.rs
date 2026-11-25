use super::testing::*;
use super::*;
use rune::{Key, Mods};

fn wip_status(files: Value) -> GitStatusResult {
    serde_json::from_value(json!({"cwd":"", "name":"", "branch":"main", "upstream":null, "ahead":0, "behind":0, "files":files})).unwrap()
}

#[test]
fn graph_columns_resize_toggle_and_fill_viewport() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view = idle_view(directory.path());
    view.changes = false;
    let mut rt = harness(view, (1400., 700.));
    let (x, y) = center(&rt, "resize-column-date");
    rt.pointer_move(x, y);
    rt.frame(1. / 60.);
    rt.pointer_down(x, y);
    rt.frame(1. / 60.);
    rt.pointer_move(x + 25., y);
    rt.frame(1. / 60.);
    rt.pointer_move(x + 50., y);
    rt.frame(1. / 60.);
    rt.pointer_up(x + 50., y);
    frames(&mut rt, 2);
    assert_eq!(repo(&rt).preferences["widths"]["date"], 182.);
    assert!(repo(&rt).column_resize.is_none());
    assert_eq!(
        rt.state.repository_graph_preferences[&repo(&rt).path]["widths"]["date"],
        182.
    );
    click(&mut rt, "graph-columns");
    click(&mut rt, "column-date");
    assert_eq!(repo(&rt).preferences["columns"]["date"], false);
    frames(&mut rt, 2);
    assert!(rect(&rt, "resize-column-date").is_none());
    let s = repo(&rt);
    let mut input = s.preferences.clone();
    input["availableWidth"] = json!(s.viewport_width());
    input["toolsWidth"] = json!(0);
    input["stretch"] = json!(true);
    let layout = inferay_presentation::graph::layout(&input);
    let total: f64 = layout["visibleOrder"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            layout["columnWidths"][c.as_str().unwrap()]
                .as_f64()
                .unwrap()
        })
        .sum();
    assert!((total - s.viewport_width() as f64).abs() < 1.);
    assert!(layout["columnWidths"]["message"].as_f64().unwrap() > 340.);
    assert!((rect(&rt, "graph-header").unwrap()[2] - s.viewport_width()).abs() < 1.);
}

#[test]
fn graph_resize_clamps_horizontal_offset_before_rendering_header() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut rt = harness(
        RepositoryView::new(
            directory.path().to_string_lossy().into_owned(),
            Value::Null,
            "vscode-black".into(),
            0,
        ),
        (600., 700.),
    );
    run_until(&mut rt, |s| {
        !s.repository_views.values().next().unwrap().loading
    });
    for (width, expanded, single_chat_column) in [
        (600., false, false),
        (800., false, false),
        (899., false, true),
        (901., false, true),
        (600., true, false),
        (901., true, false),
        (1800., true, false),
        (700., false, false),
        (2000., true, false),
    ] {
        update(&mut rt, |s, tx| {
            s.expanded = expanded;
            s.single_chat_column = single_chat_column;
            s.changes = true;
            tx.scroll_to_x("graph-scroll-x", 1000.);
        });
        rt.set_viewport((width, 700.), 1.);
        frames(&mut rt, 4);
        let unstaged = rect(&rt, "unstaged-files").unwrap();
        let staged = rect(&rt, "staged-files").unwrap();
        let on_right = (expanded || single_chat_column) && width >= 900.;
        let panel = rect(&rt, "git-changes-panel").unwrap();
        let graph = rect(&rt, "graph-header").unwrap();
        let table = rect(&rt, "history-table").unwrap();
        if on_right {
            assert!(panel[0] >= graph[0] + width - 341., "{width}");
            assert_eq!(unstaged[0], staged[0]);
            assert!(staged[1] >= unstaged[1] + unstaged[3]);
        } else {
            assert!(panel[1] >= graph[1] + graph[3]);
            assert_eq!(panel[2], width - 1.);
            assert_eq!(unstaged[1], staged[1]);
            assert!(staged[0] >= unstaged[0] + unstaged[2]);
        }
        let viewport = repo(&rt).viewport_width();
        assert!(
            (table[2] - viewport).abs() < 1.,
            "{width}: table {} viewport {viewport}",
            table[2]
        );
        assert!(
            graph[0] + graph[2] >= table[0] + table[2] - 0.5,
            "resize must not leave blank space at the right edge"
        );
        assert!(graph[0] >= table[0] - (graph[2] - table[2]).max(0.) - 0.5);
        if expanded && graph[2] <= table[2] + 0.5 {
            assert!((graph[0] - table[0]).abs() < 0.5);
        }
    }
}

#[test]
fn git_toolbar_menu_uses_the_button_anchor() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut rt = harness(idle_view(directory.path()), (1000., 700.));
    let button = rect(&rt, "git-operations").unwrap();
    let mut origin = None;
    for x in [button[0] + 3., button[0] + button[2] - 3.] {
        click_at(&mut rt, (x, button[1] + button[3] / 2.));
        let popup = rect(&rt, "git-context-menu").expect("menu opens");
        assert!((popup[0] - button[0].min(1000. - popup[2])).abs() < 0.5);
        assert!((popup[1] - (button[1] + button[3])).abs() < 0.5);
        if let Some(origin) = origin {
            assert_eq!([popup[0], popup[1]], origin);
        }
        origin = Some([popup[0], popup[1]]);
        assert!(matches!(
            repo(&rt).git_menu,
            Some((MenuAnchor::Button, _, _))
        ));
        update(&mut rt, |s, _| s.git_menu = None);
    }
}

#[test]
fn history_loads_more_when_scrolled_near_the_end() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view_state = idle_view(directory.path());
    view_state.error = None;
    view_state.changes = false;
    view_state.limit = 240;
    view_state.graph.commits = (0..240)
        .map(|i| GraphCommit {
            id: format!("commit-{i}"),
            message: format!("Commit {i}"),
            ..Default::default()
        })
        .collect();
    view_state.graph.has_more = true;
    let mut rt = harness(view_state, (1000., 500.));
    assert_eq!(repo(&rt).limit, 240);
    update(&mut rt, |_, tx| tx.scroll_into_view("commit-commit-230"));
    frames(&mut rt, 4);
    assert_eq!(repo(&rt).limit, 440);
}

#[test]
fn refresh_observes_external_checkout_with_unchanged_file_counts() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "main");
    std::fs::write(root.join("file.txt"), "base\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "Initial"]);
    git(&root, &["switch", "--detach"]);
    std::fs::write(root.join("file.txt"), "changed\n").unwrap();
    let view_state = with_avatar(RepositoryView::new(
        root.to_string_lossy().into_owned(),
        Value::Null,
        "vscode-black".into(),
        0,
    ));
    let mut rt = harness(view_state, (800., 600.));
    run_until(&mut rt, |s| {
        !s.repository_views.values().next().unwrap().loading
    });
    let summary = {
        let view = repo(&rt);
        assert_eq!(view.status.as_ref().unwrap().branch, "HEAD");
        assert!(
            view.graph
                .worktrees
                .iter()
                .find(|tree| tree.is_current)
                .unwrap()
                .branch
                .is_none()
        );
        view.status.as_ref().unwrap().change_summary()
    };
    git(&root, &["switch", "main"]);
    update(&mut rt, |s, _| s.refresh());
    run_until(&mut rt, |s| {
        !s.repository_views.values().next().unwrap().loading
    });
    let view = repo(&rt);
    assert_eq!(view.status.as_ref().unwrap().branch, "main");
    assert_eq!(view.status.as_ref().unwrap().change_summary(), summary);
    assert_eq!(
        view.graph
            .worktrees
            .iter()
            .find(|tree| tree.is_current)
            .unwrap()
            .branch
            .as_deref(),
        Some("main")
    );
    assert!(
        view.graph
            .commits
            .iter()
            .any(|commit| commit.item_kind == GitGraphItemKind::WorktreeWip)
    );
}

#[test]
fn repository_geometry_uses_global_zoom_and_logical_viewport_width() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut rt = harness(idle_view(directory.path()), (600., 600.));
    let before = rect(&rt, "repository-toolbar").unwrap();
    crate::zoom::apply(crate::zoom::Zoom::restore(Some("150")));
    rt.update(|_, _| {});
    frames(&mut rt, 4);
    let after = rect(&rt, "repository-toolbar").unwrap();
    let available = repo(&rt).available_width();
    crate::zoom::apply(crate::zoom::Zoom::default());
    assert!(
        (after[3] - before[3] * 1.5).abs() < 0.5,
        "{} {}",
        after[3],
        before[3]
    );
    let expected = (after[2] - 1.) / 1.5;
    assert!((available - expected).abs() < 1.);
}

#[test]
fn recoloring_shares_source_and_unified_patch_without_rereading_git() {
    let line = GitDiffLine {
        number: Some(1),
        content: "const value = 1;".into(),
        line_type: GitDiffLineType::Context,
    };
    let prepared = PreparedDiff::new(
        GitHunkDiff {
            old_lines: vec![line.clone()],
            new_lines: vec![line],
            raw_patch: Some(" const value = 1;".into()),
            ..Default::default()
        },
        "example.js",
        "vscode-black",
    );
    let recolored = prepared.retheme("vitesse");
    assert!(Arc::ptr_eq(&prepared.diff, &recolored.diff));
    assert!(Arc::ptr_eq(&prepared.inline, &recolored.inline));
    assert_ne!(prepared.new, recolored.new);
}

#[test]
fn latest_theme_recolors_retained_diff_without_resetting_file_selection() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let source = Arc::new(PreparedDiff::new(
        GitHunkDiff::default(),
        "example.rs",
        "vscode-black",
    ));
    let mut view_state = idle_view(directory.path());
    view_state.file = Some("example.rs".into());
    view_state.diff = Some(source.clone());
    view_state.set_syntax_theme("slack".into());
    view_state.set_syntax_theme("vitesse".into());
    let mut rt = harness(view_state, (600., 600.));
    run_until(&mut rt, |s| {
        s.repository_views
            .values()
            .next()
            .unwrap()
            .theme_task
            .is_none()
    });
    let view = repo(&rt);
    assert_eq!(view.file.as_deref(), Some("example.rs"));
    let current = view.diff.as_ref().unwrap();
    assert_eq!(current.theme, "vitesse");
    assert!(Arc::ptr_eq(&source.diff, &current.diff));
}

#[test]
fn repository_menu_removes_the_chosen_path_without_selecting_it() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view_state = idle_view(directory.path());
    let path = view_state.path.clone();
    view_state.repositories = vec![
        ("Same name".into(), "/first".into()),
        ("Same name".into(), "/second".into()),
    ];
    view_state.repository_menu = true;
    let mut rt = harness(view_state, (600., 600.));
    rt.state.projects[0].id = Some("project".into());
    rt.state.projects[0].repositories = vec![
        ("Same name".into(), "/first".into()),
        ("Same name".into(), "/second".into()),
        ("Current".into(), path.clone()),
    ];
    rt.state.projects[0].selected_repository = Some(path.clone());
    click(&mut rt, "remove-workspace-repository-1");
    assert!(rt.state.closed_repositories["project"].contains("/second"));
    assert!(!rt.state.closed_repositories["project"].contains("/first"));
    assert_eq!(rt.state.repository_view.as_deref(), Some(path.as_str()));
    assert!(!repo(&rt).repository_menu);
}

#[test]
fn repository_menu_overlays_without_moving_toolbar() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view_state = idle_view(directory.path());
    view_state.repositories = vec![
        ("First".into(), "/first".into()),
        ("Second".into(), "/second".into()),
    ];
    let mut rt = harness(view_state, (600., 600.));
    let toolbar = rect(&rt, "repository-toolbar").unwrap();
    update(&mut rt, |s, _| s.repository_menu = true);
    assert_eq!(rect(&rt, "repository-toolbar").unwrap(), toolbar);
    let menu = rect(&rt, "repository-menu").unwrap();
    assert!((menu[1] - (toolbar[1] + toolbar[3])).abs() < 0.5);
    assert!(menu[3] > 80.);
    click_at(&mut rt, (500., 500.));
    assert!(!repo(&rt).repository_menu);
}

#[test]
fn keyboard_returns_to_graph_and_reopens_selected_file() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view_state = idle_view(directory.path());
    view_state.graph.commits = vec![GraphCommit {
        id: "wip".into(),
        item_kind: GitGraphItemKind::WorktreeWip,
        ..Default::default()
    }];
    view_state.presentation = json!({"selectableItems":["wip"]});
    view_state.status = Some(wip_status(json!([
        {"path":"a.rs","status":"M","staged":false},
        {"path":"b.rs","status":"M","staged":false}
    ])));
    let mut rt = harness(view_state, (900., 600.));
    update(&mut rt, |_, tx| tx.focus("repository", false));
    let key = |rt: &mut rune::Runtime<Workspace>, key: Key| press(rt, key, Mods::default());
    key(&mut rt, Key::Down);
    assert_eq!(repo(&rt).selected_item.as_deref(), Some("wip"));
    key(&mut rt, Key::Right);
    assert!(repo(&rt).show_diff);
    assert_eq!(repo(&rt).file.as_deref(), Some("a.rs"));
    key(&mut rt, Key::Down);
    assert_eq!(repo(&rt).file.as_deref(), Some("b.rs"));
    key(&mut rt, Key::Up);
    assert_eq!(repo(&rt).file.as_deref(), Some("a.rs"));
    key(&mut rt, Key::Left);
    assert!(!repo(&rt).show_diff);
    assert_eq!(repo(&rt).selected_item.as_deref(), Some("wip"));
    assert_eq!(repo(&rt).file.as_deref(), Some("a.rs"));
    key(&mut rt, Key::Right);
    assert!(repo(&rt).show_diff);
    assert_eq!(repo(&rt).file.as_deref(), Some("a.rs"));
}

#[test]
fn keys_reach_the_repository_after_focus_leaves_for_nothing() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view_state = idle_view(directory.path());
    view_state.graph.commits = vec![GraphCommit {
        id: "wip".into(),
        item_kind: GitGraphItemKind::WorktreeWip,
        ..Default::default()
    }];
    view_state.presentation = json!({"selectableItems":["wip"]});
    view_state.keyboard_active = true;
    let mut rt = harness(view_state, (900., 600.));
    press(&mut rt, Key::Down, Mods::default());
    assert_eq!(repo(&rt).selected_item.as_deref(), Some("wip"));
}

#[test]
fn enter_toggles_staging_in_the_selected_worktree() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap().join("main");
    let other = directory.path().canonicalize().unwrap().join("other");
    std::fs::create_dir(&root).unwrap();
    init_repo(&root, "main");
    std::fs::write(root.join("file.txt"), "base\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "Initial"]);
    git(
        &root,
        &["worktree", "add", "-b", "other", other.to_str().unwrap()],
    );
    std::fs::write(root.join("main.txt"), "main only\n").unwrap();
    std::fs::write(other.join("file.txt"), "other staged\n").unwrap();
    git(&other, &["add", "file.txt"]);
    std::fs::write(other.join("file.txt"), "other unstaged\n").unwrap();
    let root = root.to_string_lossy().into_owned();
    let other = other.to_string_lossy().into_owned();
    let mut view_state = with_avatar(idle_view(std::path::Path::new(&root)));
    view_state.history = false;
    view_state.status = inferay_native_diff::get_git_status(&root);
    view_state.graph = inferay_native_diff::get_git_graph_snapshot_with_query(
        &root,
        200,
        inferay_native_diff::prepare_git_graph(&root),
        "",
    );
    let mut rt = harness(view_state, (900., 600.));
    update(&mut rt, |view, tx| {
        let index = view
            .graph
            .commits
            .iter()
            .position(|c| {
                c.item_kind == GitGraphItemKind::WorktreeWip
                    && c.worktree_path.as_deref() == Some(&other)
            })
            .unwrap();
        view.select_commit(index);
        assert_eq!(view.path, root);
        assert_eq!(view.selected_worktree.as_deref(), Some(other.as_str()));
        let entries = view.file_entries();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|f| f.0 == "file.txt"));
        assert!(entries.iter().any(|f| f.4));
        assert!(entries.iter().any(|f| !f.4));
        view.keyboard_scope = "sidebar";
        view.open_file("file.txt".into(), false, tx);
        tx.focus("repository", false);
    });
    press(&mut rt, Key::Enter, Mods::default());
    run_until(&mut rt, |s| {
        let view = s.repository_views.values().next().unwrap();
        !view.mutating && view.file_entries().len() == 1
    });
    {
        let view = repo(&rt);
        assert!(view.error.is_none(), "{:?}", view.error);
        assert_eq!(view.path, root);
        assert!(view.file_entries()[0].4);
        assert_eq!(view.file.as_deref(), Some("file.txt"));
        assert!(view.selected_staged);
    }
    run_until_idle(&mut rt);
    rt.repeat_key(plain(Key::Enter));
    frames(&mut rt, 2);
    assert!(!repo(&rt).mutating);
    press(&mut rt, Key::Enter, Mods::default());
    run_until(&mut rt, |s| {
        let view = s.repository_views.values().next().unwrap();
        !view.mutating && !view.file_entries()[0].4 && !view.selected_staged
    });
    let view = repo(&rt);
    assert!(view.error.is_none(), "{:?}", view.error);
    assert_eq!(view.file_entries().len(), 1);
    assert_eq!(view.file.as_deref(), Some("file.txt"));
    assert_eq!(view.path, root);
    assert!(!inferay_native_diff::get_git_status(&root).unwrap().files[0].staged);
    assert_eq!(
        std::fs::read_to_string(std::path::Path::new(&other).join("file.txt")).unwrap(),
        "other unstaged\n"
    );
}

#[test]
fn diff_highlights_keep_multiline_context_and_utf8_row_ranges() {
    let lines = [
        "@@ -1,3 +1,3 @@",
        "/* comment",
        "😀 comment */",
        "const value = 1;",
    ]
    .into_iter()
    .enumerate()
    .map(|(index, content)| GitDiffLine {
        number: Some(index),
        content: content.into(),
        line_type: if index == 0 {
            GitDiffLineType::Hunk
        } else {
            GitDiffLineType::Context
        },
    })
    .collect::<Vec<_>>();
    let prepared = PreparedDiff::new(
        GitHunkDiff {
            old_lines: lines.clone(),
            new_lines: lines,
            ..Default::default()
        },
        "example.ts",
        "vscode-black",
    );
    assert!(prepared.old[0].is_empty());
    for (line, runs) in prepared.diff.new_lines.iter().zip(prepared.new.iter()) {
        for (range, _) in runs {
            assert!(line.content.get(range.clone()).is_some());
        }
    }
    assert!(
        prepared.new[2]
            .iter()
            .any(|(_, style)| style.color == Some(crate::colors::rgb(0x777777)) && style.italic)
    );
    assert!(
        prepared.new[3]
            .iter()
            .any(|(_, style)| style.color == Some(crate::colors::rgb(0x569cd6)))
    );
}

#[test]
fn keyboard_scrolling_under_a_resting_pointer_lights_only_the_selection() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view_state = idle_view(directory.path());
    view_state.error = None;
    view_state.changes = false;
    view_state.graph.commits = (0..120)
        .map(|i| GraphCommit {
            id: format!("commit-{i}"),
            message: format!("Commit {i}"),
            ..Default::default()
        })
        .collect();
    view_state.presentation =
        json!({"selectableItems": (0..120).map(|i| format!("commit-{i}")).collect::<Vec<_>>()});
    let mut rt = harness(view_state, (1000., 500.));
    let lit = |rt: &rune::Runtime<Workspace>| {
        let mut rows: Vec<_> = rt
            .elements()
            .into_iter()
            .filter(|e| !e.exiting && e.fill.a > 0.3 && (e.rect[3] - 23.).abs() < 1.)
            .filter_map(|e| {
                e.path
                    .split('/')
                    .find_map(|part| part.strip_prefix("commit-commit-").map(str::to_owned))
            })
            .collect();
        rows.sort();
        rows
    };
    let (x, y) = center(&rt, "commit-commit-5");
    rt.pointer_move(x, y);
    frames(&mut rt, 3);
    assert_eq!(lit(&rt), ["5"]);
    update(&mut rt, |_, tx| tx.focus("repository", false));
    for _ in 0..60 {
        rt.key(plain(Key::Down));
        rt.frame(1. / 120.);
    }
    frames(&mut rt, 10);
    assert_eq!(repo(&rt).selected_item.as_deref(), Some("commit-59"));
    assert_eq!(lit(&rt), ["59"]);
    rt.pointer_move(x, y + 2.);
    frames(&mut rt, 3);
    assert_eq!(lit(&rt).len(), 2);
}
