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
fn unchanged_repositories_keep_their_graph_and_changes_still_refresh_it() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "main");
    std::fs::write(root.join("file.txt"), "base\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "Initial"]);
    let view_state = with_avatar(RepositoryView::new(
        root.to_string_lossy().into_owned(),
        Value::Null,
        "vscode-black".into(),
        0,
    ));
    let mut rt = harness(view_state, (800., 600.));
    let idle = |s: &Workspace| !s.repository_views.values().next().unwrap().loading;
    run_until(&mut rt, idle);
    update(&mut rt, |view, _| {
        view.graph.commits[0].message = "retained".into();
        view.refresh();
    });
    run_until(&mut rt, idle);
    assert_eq!(repo(&rt).graph.commits[0].message, "retained");
    std::fs::write(root.join("file.txt"), "changed\n").unwrap();
    update(&mut rt, |view, _| view.refresh());
    run_until(&mut rt, idle);
    let view = repo(&rt);
    assert_ne!(view.graph.commits[0].message, "retained");
    assert_eq!(view.status.as_ref().unwrap().files.len(), 1);
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

fn current(s: &Workspace) -> &RepositoryView {
    &s.repository_views[s.repository_view.as_ref().unwrap()]
}

/// A project with two committed repositories and one focused chat, as the full window.
fn repository_workspace(root: &std::path::Path) -> (rune::Runtime<Workspace>, String, String) {
    let mut paths = Vec::new();
    for name in ["first", "second"] {
        let path = root.join(name);
        std::fs::create_dir_all(&path).unwrap();
        let path = path.canonicalize().unwrap();
        init_repo(&path, "main");
        for i in 0..3 {
            std::fs::write(path.join("file.txt"), format!("{i}\n")).unwrap();
            git(&path, &["add", "."]);
            git(&path, &["commit", "-m", &format!("Commit {i}")]);
        }
        paths.push(path.to_string_lossy().into_owned());
    }
    let mut state = Workspace::empty();
    state.projects[0].repositories = vec![
        ("first".into(), paths[0].clone()),
        ("second".into(), paths[1].clone()),
    ];
    state.conversations[0].input.focus();
    let mut rt = crate::task::testing::view_runtime(state, (1400., 800.));
    rt.on_key = Some(crate::on_key);
    frames(&mut rt, 2);
    (rt, paths[0].clone(), paths[1].clone())
}

fn wait_for_graph(rt: &mut rune::Runtime<Workspace>) {
    run_until(rt, |s| {
        s.repository_view
            .as_ref()
            .and_then(|path| s.repository_views.get(path))
            .is_some_and(|view| !view.loading && !view.graph.commits.is_empty())
    });
    frames(rt, 3);
}

#[test]
fn arrow_keys_move_from_chat_into_the_graph_and_back_in_its_current_mode() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let (mut rt, first, _) = repository_workspace(directory.path());
    rt.state.repository_expanded = true;
    let arrow = |rt: &mut rune::Runtime<Workspace>, key: Key| press(rt, key, Mods::default());
    // → with text in the composer moves the caret, not the view.
    rt.state.conversations[0].input.set_content("draft");
    arrow(&mut rt, Key::Right);
    assert!(!rt.state.repository);
    rt.state.conversations[0].input.clear();
    arrow(&mut rt, Key::Right);
    assert!(rt.state.repository);
    assert!(
        rt.state.repository_expanded,
        "the graph keeps its full-screen mode"
    );
    assert_eq!(rt.state.repository_view.as_deref(), Some(first.as_str()));
    assert!(current(&rt.state).expanded);
    assert!(!rt.state.conversations[0].input.is_focused());
    wait_for_graph(&mut rt);
    arrow(&mut rt, Key::Down);
    assert!(
        current(&rt.state).selected_item.is_some(),
        "↓ moves through the graph"
    );
    arrow(&mut rt, Key::Right);
    assert_eq!(current(&rt.state).keyboard_scope, "sidebar");
    arrow(&mut rt, Key::Left);
    assert_eq!(current(&rt.state).keyboard_scope, "graph");
    assert!(rt.state.repository);
    arrow(&mut rt, Key::Left);
    assert!(!rt.state.repository, "← on the graph returns to the chats");
    assert!(rt.state.repository_expanded);
    assert!(rt.state.conversations[0].input.is_focused());
    assert!(rect(&rt, "sidebar-chat-0").is_some());
}

#[test]
fn full_screen_follows_every_repository_and_choosing_a_chat_returns_to_it() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let (mut rt, first, second) = repository_workspace(directory.path());
    click(&mut rt, "repo-0");
    assert!(rt.state.repository);
    assert_eq!(rt.state.repository_view.as_deref(), Some(first.as_str()));
    wait_for_graph(&mut rt);
    click(&mut rt, "expand-git");
    assert!(rt.state.repository_expanded);
    click(&mut rt, "repo-1");
    assert_eq!(rt.state.repository_view.as_deref(), Some(second.as_str()));
    assert!(
        current(&rt.state).expanded,
        "the other repository opens full screen too"
    );
    click(&mut rt, "sidebar-chat-0");
    assert!(
        !rt.state.repository,
        "choosing a chat leaves the full-screen graph"
    );
    click(&mut rt, "repo-0");
    assert!(current(&rt.state).expanded);
    wait_for_graph(&mut rt);
    click(&mut rt, "expand-git");
    assert!(!rt.state.repository_expanded);
    click(&mut rt, "repo-1");
    assert!(!current(&rt.state).expanded);
    // Beside the chats, choosing a chat keeps the graph open.
    click(&mut rt, "sidebar-chat-0");
    assert!(rt.state.repository);
}

#[test]
fn renamed_files_show_where_they_came_from_in_the_diff_header() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "main");
    std::fs::write(root.join("old.sql"), "select 1;\nselect 2;\nselect 3;\n").unwrap();
    std::fs::write(root.join("kept.sql"), "select 4;\n").unwrap();
    std::fs::write(root.join("moved.sql"), "select 6;\nselect 7;\nselect 8;\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "Initial"]);
    git(&root, &["mv", "old.sql", "new.sql"]);
    // An unstaged rename: the file was simply moved on disk.
    std::fs::rename(root.join("moved.sql"), root.join("arrived.sql")).unwrap();
    std::fs::write(root.join("kept.sql"), "select 5;\n").unwrap();
    let path = root.to_string_lossy().into_owned();
    let mut view_state = with_avatar(idle_view(&root));
    view_state.status = inferay_native_diff::get_git_status(&path);
    view_state.graph = inferay_native_diff::get_git_graph_snapshot_with_query(
        &path,
        200,
        inferay_native_diff::prepare_git_graph(&path),
        "",
    );
    let mut rt = harness(view_state, (1000., 600.));
    let text = |rt: &rune::Runtime<Workspace>, key: &str| {
        rt.elements()
            .into_iter()
            .find(|e| !e.exiting && e.key.as_deref() == Some(key))
            .and_then(|e| e.text)
    };
    let label = |rt: &rune::Runtime<Workspace>, wanted: &str| {
        rt.elements()
            .into_iter()
            .any(|e| e.label.as_deref() == Some(wanted))
    };
    update(&mut rt, |view, tx| {
        view.open_file("new.sql".into(), true, tx)
    });
    assert_eq!(text(&rt, "diff-original-path").as_deref(), Some("old.sql"));
    assert_eq!(text(&rt, "diff-path").as_deref(), Some("new.sql"));
    assert!(label(&rt, "Renamed: old.sql → new.sql"));
    update(&mut rt, |view, tx| {
        view.open_file("arrived.sql".into(), false, tx)
    });
    assert_eq!(
        text(&rt, "diff-original-path").as_deref(),
        Some("moved.sql")
    );
    assert_eq!(text(&rt, "diff-path").as_deref(), Some("arrived.sql"));
    update(&mut rt, |view, tx| {
        view.open_file("kept.sql".into(), false, tx)
    });
    assert_eq!(text(&rt, "diff-path").as_deref(), Some("kept.sql"));
    assert!(text(&rt, "diff-original-path").is_none());

    // The same rename, viewed from history.
    run_until_idle(&mut rt);
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "-qm", "Rename the query"]);
    update(&mut rt, |view, _| {
        view.status = inferay_native_diff::get_git_status(&path);
        view.graph = inferay_native_diff::get_git_graph_snapshot_with_query(
            &path,
            200,
            inferay_native_diff::prepare_git_graph(&path),
            "",
        );
        let index = view
            .graph
            .commits
            .iter()
            .position(|commit| commit.message == "Rename the query")
            .unwrap();
        view.select_commit(index);
    });
    run_until(&mut rt, |s| {
        s.repository_views
            .values()
            .next()
            .unwrap()
            .details
            .is_some()
    });
    update(&mut rt, |view, tx| {
        view.open_file("new.sql".into(), false, tx)
    });
    assert_eq!(text(&rt, "diff-original-path").as_deref(), Some("old.sql"));
    assert_eq!(text(&rt, "diff-path").as_deref(), Some("new.sql"));
}

#[test]
fn the_graph_starts_on_the_current_row_and_keys_keep_working_after_clicks() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let (mut rt, first, second) = repository_workspace(directory.path());
    std::fs::write(
        std::path::Path::new(&first).join("file.txt"),
        "work in progress\n",
    )
    .unwrap();
    let arrow = |rt: &mut rune::Runtime<Workspace>, key: Key| press(rt, key, Mods::default());
    let selected = |rt: &rune::Runtime<Workspace>| current(&rt.state).selected_item.clone();
    let head = |path: &str| git(std::path::Path::new(path), &["rev-parse", "HEAD"]);

    // → from the chat starts on this checkout's work in progress.
    arrow(&mut rt, Key::Right);
    wait_for_graph(&mut rt);
    assert_eq!(selected(&rt).as_deref(), Some("wip"));
    arrow(&mut rt, Key::Down);
    assert_eq!(
        selected(&rt),
        Some(head(&first)),
        "↓ moves from work in progress to HEAD"
    );

    // A clean repository opened from the sidebar starts on HEAD, and keys work at once.
    click(&mut rt, "repo-1");
    wait_for_graph(&mut rt);
    assert_eq!(selected(&rt), Some(head(&second)));
    arrow(&mut rt, Key::Down);
    let below = selected(&rt);
    assert!(below.is_some() && below != Some(head(&second)));

    // A focused toolbar button does not take the arrow keys away from the graph.
    click(&mut rt, "expand-git");
    arrow(&mut rt, Key::Up);
    assert_eq!(selected(&rt), Some(head(&second)));

    // ← closes to the chat, → reopens on the same row, and keys still move.
    arrow(&mut rt, Key::Left);
    assert!(!rt.state.repository);
    arrow(&mut rt, Key::Right);
    assert!(rt.state.repository);
    assert_eq!(selected(&rt), Some(head(&second)));
    arrow(&mut rt, Key::Down);
    assert_eq!(selected(&rt), below);
}
