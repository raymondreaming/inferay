use super::super::testing::*;
use super::*;

fn loaded(root: &std::path::Path) -> rune::Runtime<Workspace> {
    let mut view = with_avatar(RepositoryView::new(
        root.to_string_lossy().into_owned(),
        Value::Null,
        "vscode-black".into(),
        0,
    ));
    view.changes = false;
    let mut rt = harness(view, (1400., 700.));
    run_until(&mut rt, |s| {
        !s.repository_views.values().next().unwrap().loading
    });
    frames(&mut rt, 3);
    rt
}

fn drag(rt: &mut rune::Runtime<Workspace>, from: (f32, f32), to: (f32, f32)) {
    rt.pointer_move(from.0, from.1);
    rt.frame(1. / 60.);
    rt.pointer_down(from.0, from.1);
    rt.frame(1. / 60.);
    rt.pointer_move(from.0 + 12., from.1);
    frames(rt, 2);
    assert!(
        repo(rt)
            .branch_drag
            .as_ref()
            .is_some_and(|drag| drag.active),
        "branch drag did not start"
    );
    rt.pointer_move(to.0, to.1);
    frames(rt, 2);
    rt.pointer_up(to.0, to.1);
    frames(rt, 2);
}

#[test]
fn branch_double_click_and_drag_open_real_operations() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "main");
    std::fs::write(root.join("file.txt"), "base\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "Base"]);
    git(&root, &["switch", "-c", "feature"]);
    std::fs::write(root.join("file.txt"), "next\n").unwrap();
    git(&root, &["commit", "-am", "Feature"]);
    git(&root, &["switch", "main"]);
    let mut rt = loaded(&root);
    let feature = center(&rt, "branch-label-refs/heads/feature");
    click_at(&mut rt, feature);
    assert_eq!(git(&root, &["branch", "--show-current"]), "main");
    rt.pointer_down(feature.0, feature.1);
    rt.frame(1. / 60.);
    rt.pointer_up(feature.0, feature.1);
    frames(&mut rt, 2);
    run_until(&mut rt, |s| {
        let view = s.repository_views.values().next().unwrap();
        !view.mutating && !view.loading
    });
    assert_eq!(git(&root, &["branch", "--show-current"]), "feature");
    assert_eq!(repo(&rt).status.as_ref().unwrap().branch, "feature");
    frames(&mut rt, 3);
    let feature = center(&rt, "branch-label-refs/heads/feature");
    let main = center(&rt, "branch-label-refs/heads/main");
    rt.pointer_move(feature.0, feature.1);
    rt.frame(1. / 60.);
    rt.pointer_down(feature.0, feature.1);
    rt.frame(1. / 60.);
    rt.pointer_move(feature.0 + 12., feature.1);
    frames(&mut rt, 2);
    assert!(
        repo(&rt)
            .branch_drag
            .as_ref()
            .is_some_and(|drag| drag.active)
    );
    let ghost = rect(&rt, "dragged-branch-badge").expect("drag shows the badge");
    let source = rect(&rt, "branch-label-refs/heads/feature").unwrap();
    assert_eq!(
        [ghost[2], ghost[3]],
        [source[2], source[3]],
        "dragging must preserve the badge geometry"
    );
    rt.pointer_move(main.0, main.1);
    frames(&mut rt, 2);
    rt.pointer_up(main.0, main.1);
    frames(&mut rt, 2);
    run_until(&mut rt, |s| {
        s.repository_views
            .values()
            .next()
            .unwrap()
            .branch_menu
            .is_some()
    });
    {
        let menu = repo(&rt).branch_menu.as_ref().unwrap();
        assert_eq!((&*menu.source, &*menu.target), ("feature", "main"));
        assert!(menu.can_merge && menu.can_fast_forward && menu.can_rebase);
    }
    assert_eq!(
        git(&root, &["branch", "--show-current"]),
        "feature",
        "drop alone does not mutate Git"
    );
    frames(&mut rt, 3);
    assert!(rect(&rt, "branch-operation-menu").is_some());
    click(&mut rt, "branch-operation-fastForward");
    run_until(&mut rt, |s| {
        let view = s.repository_views.values().next().unwrap();
        !view.mutating && !view.loading
    });
    assert_eq!(git(&root, &["branch", "--show-current"]), "main");
    assert_eq!(
        git(&root, &["rev-parse", "main"]),
        git(&root, &["rev-parse", "feature"])
    );
    frames(&mut rt, 3);
    let main = center(&rt, "branch-label-refs/heads/main");
    rt.pointer_move(main.0, main.1);
    rt.frame(1. / 60.);
    rt.secondary_down(main.0, main.1);
    rt.secondary_up(main.0, main.1);
    frames(&mut rt, 2);
    assert!(
        repo(&rt)
            .git_menu
            .as_ref()
            .unwrap()
            .2
            .iter()
            .any(|r| r.full_name == "refs/heads/main")
    );
}

#[test]
fn unchecked_local_and_remote_branches_can_be_dragged() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "target");
    git(&root, &["commit", "--allow-empty", "-m", "Base"]);
    git(&root, &["remote", "add", "origin", root.to_str().unwrap()]);
    git(
        &root,
        &["update-ref", "refs/remotes/origin/remote-target", "HEAD"],
    );
    git(&root, &["checkout", "-b", "source"]);
    git(&root, &["commit", "--allow-empty", "-m", "Source"]);
    git(
        &root,
        &["update-ref", "refs/remotes/origin/remote-source", "HEAD"],
    );
    git(&root, &["checkout", "-b", "unrelated", "target"]);
    git(&root, &["commit", "--allow-empty", "-m", "Unrelated"]);
    let mut rt = loaded(&root);
    for (source, target) in [
        ("refs/heads/source", "refs/heads/target"),
        ("refs/heads/source", "refs/heads/unrelated"),
        ("refs/remotes/origin/remote-source", "refs/heads/unrelated"),
        ("refs/remotes/origin/remote-source", "refs/heads/target"),
        ("refs/heads/source", "refs/remotes/origin/remote-target"),
        (
            "refs/remotes/origin/remote-source",
            "refs/remotes/origin/remote-target",
        ),
    ] {
        update(&mut rt, |s, _| {
            s.branch_menu = None;
            s.preferences["hiddenRefs"] = json!(
                [
                    "refs/heads/source",
                    "refs/heads/target",
                    "refs/remotes/origin/remote-source",
                    "refs/remotes/origin/remote-target"
                ]
                .into_iter()
                .filter(|name| *name != source && *name != target)
                .collect::<Vec<_>>()
            );
        });
        frames(&mut rt, 2);
        let from = center(&rt, &format!("branch-label-{source}"));
        let to = center(&rt, &format!("branch-label-{target}"));
        drag(&mut rt, from, to);
        run_until(&mut rt, |s| {
            s.repository_views
                .values()
                .next()
                .unwrap()
                .branch_menu
                .is_some()
        });
        let menu = repo(&rt)
            .branch_menu
            .as_ref()
            .expect("drop must open a menu");
        assert_eq!(menu.source, source.trim_start_matches("refs/heads/"));
        assert_eq!(menu.target, target.trim_start_matches("refs/heads/"));
        assert!(menu.can_merge && menu.can_rebase);
        assert_eq!(menu.can_fast_forward, target != "refs/heads/unrelated");
        assert_eq!(git(&root, &["branch", "--show-current"]), "unrelated");
    }
    frames(&mut rt, 2);
    click(&mut rt, "branch-operation-fastForward");
    run_until(&mut rt, |s| {
        let view = s.repository_views.values().next().unwrap();
        !view.mutating && !view.loading
    });
    assert_eq!(git(&root, &["branch", "--show-current"]), "remote-target");
    assert_eq!(
        git(&root, &["rev-parse", "remote-target"]),
        git(&root, &["rev-parse", "source"])
    );
    assert_eq!(
        git(&root, &["rev-parse", "refs/remotes/origin/remote-target"]),
        git(&root, &["rev-parse", "target"])
    );
    assert_eq!(
        git(&root, &["rev-parse", "--abbrev-ref", "@{upstream}"]),
        "origin/remote-target"
    );
}

#[test]
fn preserves_shared_paths_pinned_lanes_and_each_node_shape() {
    let commits = vec![
        GraphCommit {
            column: 0,
            item_kind: GitGraphItemKind::WorktreeWip,
            ..Default::default()
        },
        GraphCommit {
            column: 1,
            item_kind: GitGraphItemKind::Stash,
            ..Default::default()
        },
        GraphCommit {
            column: 0,
            parents: vec!["a".into(), "b".into()],
            ..Default::default()
        },
        GraphCommit {
            column: 1,
            parents: vec!["a".into()],
            ..Default::default()
        },
    ];
    let rows: Vec<_> = (0..4)
        .map(|row| GraphRow {
            row,
            rails: vec![GraphRail {
                dashed: row == 0,
                column: 0,
                color_index: 0,
                starts_at_node: row == 0,
                ends_at_node: false,
            }],
            transitions: if row == 2 {
                vec![GraphTransition {
                    dashed: false,
                    from_column: 0,
                    to_column: 1,
                    color_index: 1,
                }]
            } else {
                vec![]
            },
            convergences: if row == 3 {
                vec![GraphTransition {
                    dashed: false,
                    from_column: 0,
                    to_column: 1,
                    color_index: 1,
                }]
            } else {
                vec![]
            },
            truncated_edges: vec![],
        })
        .collect();
    let graph = GitGraphSnapshot {
        commits,
        rows,
        ..Default::default()
    };
    let display = json!([1, 0]);
    let pictures = graph_images::images(&graph, &display, 0x0d0d0d, &[]);
    let refreshed = graph_images::images(&graph, &display, 0x0d0d0d, &pictures);
    assert!(
        pictures
            .iter()
            .zip(&refreshed)
            .all(|(a, b)| Arc::ptr_eq(a, b))
    );
    assert!(
        pictures
            .iter()
            .all(|p| p.pixels.size() == (((27 + 3 * 18) * 4) as u32, 92))
    );
    let svg: Vec<_> = pictures.iter().map(|p| p.svg.as_str()).collect();
    assert!(svg[0].contains("cx=\"45\" cy=\"11.5\" r=\"8.5\""));
    assert!(svg[0].contains("stroke-dasharray=\"1 2\" stroke-width=\"1\""));
    assert!(svg[0].contains("pathLength=\"54\""));
    assert!(svg[1].contains("width=\"17\" height=\"17\" rx=\"3\""));
    assert!(svg[2].contains("cx=\"45\" cy=\"57.5\" r=\"5\""));
    assert!(svg[3].contains("cx=\"27\" cy=\"80.5\" r=\"8.5\""));
    let shared = serde_json::to_value(inferay_presentation::graph::lines(&json!({
        "rows": graph.rows, "displayColumns": display, "colors": crate::colors::GRAPH_LANES,
    })))
    .unwrap();
    let transition = shared["transitions"][0]["path"].as_str().unwrap();
    let convergence = shared["convergences"][0]["path"].as_str().unwrap();
    assert!(svg[2].contains(transition));
    assert!(svg[3].contains(transition));
    assert!(svg[3].contains(convergence));
}

#[test]
fn clicking_another_row_leaves_no_fading_fill_in_the_previous_graph_cell() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "main");
    for i in 0..6 {
        std::fs::write(root.join("file.txt"), format!("{i}\n")).unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", &format!("Commit {i}")]);
    }
    let mut rt = loaded(&root);
    let rows: Vec<String> = rt
        .elements()
        .into_iter()
        .filter_map(|e| e.key)
        .filter(|key| key.starts_with("commit-") && key != "commit-rows" && key != "commit-history")
        .collect();
    let (previous, next) = (rows[2].clone(), rows[4].clone());
    click(&mut rt, &previous);
    let (from, to) = (center(&rt, &previous), center(&rt, &next));
    for step in 1..=4 {
        rt.pointer_move(from.0, from.1 + (to.1 - from.1) * step as f32 / 4.);
        rt.frame(1. / 60.);
    }
    rt.pointer_down(to.0, to.1);
    rt.frame(1. / 60.);
    rt.pointer_up(to.0, to.1);
    rt.frame(1. / 60.);
    let lingering: Vec<_> = rt
        .elements()
        .into_iter()
        .filter(|e| !e.exiting && e.path.contains(&previous) && e.fill.a > 0.01)
        .map(|e| (e.path, e.rect, e.fill.a))
        .collect();
    assert!(
        lingering.is_empty(),
        "previous row still painted: {lingering:?}"
    );
}
