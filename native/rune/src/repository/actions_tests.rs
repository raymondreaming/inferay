use super::super::testing::*;
use super::*;

fn settled(s: &Workspace) -> bool {
    let view = s.repository_views.values().next().unwrap();
    !view.mutating && !view.loading
}

#[test]
fn branch_prompt_and_remote_deletion_use_named_targets() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "main");
    git(&root, &["commit", "--allow-empty", "-m", "Base"]);
    git(&root, &["init", "--bare", remote.path().to_str().unwrap()]);
    git(
        &root,
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    );
    let view = with_avatar(RepositoryView::new(
        root.to_string_lossy().into_owned(),
        Value::Null,
        "vscode-black".into(),
        0,
    ));
    let mut rt = harness(view, (1000., 600.));
    run_until(&mut rt, settled);
    update(&mut rt, |s, _| {
        s.request_git_action("createBranch", "HEAD".into(), None)
    });
    assert!(repo(&rt).git_prompt.as_ref().unwrap().input.is_focused());
    type_text(&mut rt, "topic");
    assert_eq!(
        repo(&rt).git_prompt.as_ref().unwrap().input.content(),
        "topic"
    );
    assert!(
        !git(&root, &["branch", "--list"]).contains("topic"),
        "prompt does not execute before confirmation"
    );
    click(&mut rt, "confirm-git-action");
    run_until(&mut rt, settled);
    assert!(git(&root, &["branch", "--list"]).contains("topic"));
    assert_eq!(git(&root, &["branch", "--show-current"]), "main");
    update(&mut rt, |s, _| {
        s.run_graph_action("pushSetUpstream", "topic".into(), "origin".into(), None)
    });
    run_until(&mut rt, settled);
    assert!(git(&root, &["ls-remote", "origin", "refs/heads/topic"]).contains("refs/heads/topic"));
    update(&mut rt, |s, _| {
        s.run_graph_action(
            "deleteBranch",
            "topic".into(),
            String::new(),
            Some("refs/remotes/origin/topic".into()),
        )
    });
    run_until(&mut rt, settled);
    assert!(!git(&root, &["branch", "--list"]).contains("topic"));
    assert!(git(&root, &["ls-remote", "origin", "refs/heads/topic"]).is_empty());
    update(&mut rt, |s, _| {
        s.run_graph_action("deleteBranch", "main".into(), String::new(), None)
    });
    run_until(&mut rt, settled);
    assert!(
        repo(&rt)
            .error
            .as_deref()
            .unwrap()
            .contains("checked-out branch")
    );
    assert_eq!(git(&root, &["branch", "--show-current"]), "main");
}

#[test]
fn git_menu_lists_commit_and_branch_actions_and_copies() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    init_repo(&root, "main");
    git(&root, &["commit", "--allow-empty", "-m", "Base"]);
    let view = with_avatar(RepositoryView::new(
        root.to_string_lossy().into_owned(),
        Value::Null,
        "vscode-black".into(),
        0,
    ));
    let mut rt = harness(view, (1200., 700.));
    run_until(&mut rt, settled);
    frames(&mut rt, 2);
    let main = center(&rt, "branch-label-refs/heads/main");
    rt.pointer_move(main.0, main.1);
    rt.frame(1. / 60.);
    rt.secondary_down(main.0, main.1);
    rt.secondary_up(main.0, main.1);
    frames(&mut rt, 3);
    let menu = rect(&rt, "git-context-menu").expect("context menu");
    assert!((menu[0] - main.0).abs() < 0.5 && (menu[1] - main.1).abs() < 0.5);
    assert!(rect(&rt, "git-menu-checkout-5").is_some());
    assert!(rect(&rt, "git-menu-createBranch-0").is_some());
    let delete = (0..20)
        .find_map(|i| rt.presented(&format!("git-menu-deleteBranch-{i}")))
        .expect("delete entry");
    assert!(
        (delete.1 - 0.4).abs() < 0.01,
        "the checked-out branch cannot be deleted"
    );
    click(&mut rt, "git-menu-copy-4");
    assert!(repo(&rt).git_menu.is_none());
}
