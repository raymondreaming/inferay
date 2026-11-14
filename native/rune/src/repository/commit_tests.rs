use super::super::testing::*;
use super::*;
use rune::{Key, Mods};

#[test]
fn composer_commits_staged_files_and_preloads_amend() {
    let _serial = serial();
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    init_repo(&root, "main");
    std::fs::write(root.join("file.txt"), "staged").unwrap();
    git(&root, &["add", "file.txt"]);
    let cwd = root.to_string_lossy().into_owned();
    let mut view = RepositoryView::new(cwd.clone(), Value::Null, "vscode-black".into(), 0);
    view.changes = true;
    let mut rt = harness(view, (900., 600.));
    run_until(&mut rt, |s| {
        !s.repository_views.values().next().unwrap().loading
    });
    frames(&mut rt, 2);
    assert!(rect(&rt, "commit-composer").is_some());
    let empty_height = rect(&rt, "commit-input-shell").unwrap()[3];
    assert_eq!(rect(&rt, "commit-message-input").unwrap()[3], 30.);
    assert!(!repo(&rt).commit_drafts.borrow()[&cwd].input.is_focused());
    click(&mut rt, "commit-message");
    assert!(
        repo(&rt).commit_drafts.borrow()[&cwd].input.is_focused(),
        "the beam lights while focused"
    );
    type_text(&mut rt, "Commit through composer");
    assert_eq!(
        repo(&rt).draft_content(&cwd).as_deref(),
        Some("Commit through composer")
    );
    press(&mut rt, Key::Enter, Mods::default());
    press(&mut rt, Key::Enter, Mods::default());
    type_text(&mut rt, "Details");
    assert_eq!(
        repo(&rt).draft_content(&cwd).as_deref(),
        Some("Commit through composer\n\nDetails")
    );
    assert!(
        !repo(&rt).mutating,
        "Enter edits the draft instead of committing"
    );
    assert!(
        !repo(&rt).show_diff,
        "Editor keys must not activate repository navigation"
    );
    for width in [320., 900.] {
        rt.set_viewport((width, 600.), 1.);
        frames(&mut rt, 4);
        let shell = rect(&rt, "commit-input-shell").unwrap();
        assert!(
            shell[3] > empty_height,
            "Multiline messages grow beyond the one-line composer"
        );
        let options = rect(&rt, "commit-input-options").unwrap();
        let submit = rect(&rt, "commit-staged").unwrap();
        assert!(options[1] >= shell[1] && options[1] + options[3] <= shell[1] + shell[3]);
        assert!(submit[0] >= shell[0] && submit[0] + submit[2] <= shell[0] + shell[2]);
    }
    update(&mut rt, |s, tx| {
        s.commit_drafts
            .get_mut()
            .get_mut(&cwd)
            .unwrap()
            .input
            .edit
            .focused = false;
        tx.focus("repository", false);
        s.commit_generating = true;
    });
    assert!(
        repo(&rt).commit_generating,
        "Generation lights the border even without editor focus"
    );
    update(&mut rt, |s, _| s.commit_generating = false);
    click(&mut rt, "commit-staged");
    run_until(&mut rt, |s| {
        let view = s.repository_views.values().next().unwrap();
        !view.mutating && !view.loading
    });
    assert_eq!(
        git(&root, &["log", "-1", "--format=%s"]),
        "Commit through composer"
    );
    assert!(repo(&rt).draft_content(&cwd).unwrap().is_empty());
    click(&mut rt, "amend-commit");
    run_until(&mut rt, |s| {
        s.repository_views
            .values()
            .next()
            .unwrap()
            .draft_content(&s.repository_views.values().next().unwrap().path)
            == Some("Commit through composer\n\nDetails".into())
    });
    update(&mut rt, |s, _| {
        s.commit_drafts
            .get_mut()
            .get_mut(&cwd)
            .unwrap()
            .input
            .set_content("Amend through composer");
        s.submit_commit();
    });
    run_until(&mut rt, |s| {
        let view = s.repository_views.values().next().unwrap();
        !view.mutating && !view.loading
    });
    assert_eq!(git(&root, &["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(
        git(&root, &["log", "-1", "--format=%s"]),
        "Amend through composer"
    );
}
