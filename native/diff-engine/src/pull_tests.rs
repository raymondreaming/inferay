use super::*;

fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

fn fixture(rebase: bool) -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let remote = root.path().join("remote");
    let local = root.path().join("local");
    std::fs::create_dir(&remote).unwrap();
    git(&remote, &["init", "-b", "main"]);
    git(&remote, &["config", "user.name", "Fixture"]);
    git(
        &remote,
        &["config", "user.email", "fixture@example.invalid"],
    );
    git(&remote, &["config", "commit.gpgsign", "false"]);
    std::fs::write(
        remote.join("shared.txt"),
        "base\n1\n2\n3\n4\n5\n6\n7\n8\n9\nend\n",
    )
    .unwrap();
    std::fs::write(remote.join("staged.txt"), "base\n").unwrap();
    git(&remote, &["add", "."]);
    git(&remote, &["commit", "-m", "base"]);
    git(
        root.path(),
        &["clone", remote.to_str().unwrap(), local.to_str().unwrap()],
    );
    git(&local, &["config", "user.name", "Fixture"]);
    git(&local, &["config", "user.email", "fixture@example.invalid"]);
    git(&local, &["config", "commit.gpgsign", "false"]);
    git(
        &local,
        &[
            "config",
            "pull.rebase",
            if rebase { "true" } else { "false" },
        ],
    );
    (root, remote, local)
}

fn pull(local: &Path) -> GitOperationResult {
    perform_git_graph_action_with_targets(local.to_str().unwrap(), "pull", None, &[], None, None)
}

#[test]
fn pull_reapplies_nonoverlapping_wip_above_updated_head() {
    for rebase in [false, true] {
        let (_root, remote, local) = fixture(rebase);
        // An existing user stash must not be consumed by automatic restoration.
        std::fs::write(local.join("staged.txt"), "saved stash\n").unwrap();
        git(&local, &["stash", "push", "-m", "existing"]);
        let stash = git(&local, &["rev-parse", "refs/stash"]);
        let remote_text = "upstream\n1\n2\n3\n4\n5\n6\n7\n8\n9\nend\n";
        std::fs::write(remote.join("shared.txt"), remote_text).unwrap();
        git(&remote, &["commit", "-am", "upstream"]);
        std::fs::write(
            local.join("shared.txt"),
            "base\n1\n2\n3\n4\n5\n6\n7\n8\n9\nlocal\n",
        )
        .unwrap();
        std::fs::write(local.join("staged.txt"), "staged WIP\n").unwrap();
        git(&local, &["add", "staged.txt"]);
        std::fs::write(local.join("untracked.txt"), "untracked WIP\n").unwrap();
        let result = pull(&local);
        assert!(result.ok, "{result:?}");
        assert_eq!(result.outcome, GitOperationOutcome::Completed);
        assert_eq!(
            git(&local, &["rev-parse", "HEAD"]),
            git(&remote, &["rev-parse", "HEAD"])
        );
        assert_eq!(
            std::fs::read_to_string(local.join("shared.txt")).unwrap(),
            remote_text.replace("end", "local")
        );
        assert_eq!(
            std::fs::read_to_string(local.join("staged.txt")).unwrap(),
            "staged WIP\n"
        );
        assert_eq!(
            std::fs::read_to_string(local.join("untracked.txt")).unwrap(),
            "untracked WIP\n"
        );
        assert_eq!(git(&local, &["rev-parse", "refs/stash"]), stash);
        let cwd = local.to_str().unwrap();
        let snapshot = get_git_graph_snapshot_with_query(cwd, 100, prepare_git_graph(cwd), "");
        assert_eq!(snapshot.commits[0].id, "wip");
        assert_eq!(snapshot.commits[0].parents, [result.head.unwrap()]);
        assert_eq!(
            snapshot.commits[0].change_summary.as_ref().unwrap().files,
            3
        );
    }
}

#[test]
fn pull_reports_autostash_conflicts_and_keeps_recovery_stash() {
    for rebase in [false, true] {
        let (_root, remote, local) = fixture(rebase);
        std::fs::write(remote.join("shared.txt"), "upstream\n").unwrap();
        git(&remote, &["commit", "-am", "upstream"]);
        std::fs::write(local.join("shared.txt"), "local WIP\n").unwrap();
        let result = pull(&local);
        assert!(!result.ok, "{result:?}");
        assert_eq!(result.outcome, GitOperationOutcome::Conflicted);
        assert_eq!(result.error_kind, Some(GitOperationErrorKind::Conflict));
        assert_eq!(result.conflicts, ["shared.txt"]);
        assert_eq!(git(&local, &["show", "refs/stash:shared.txt"]), "local WIP");
        assert_eq!(
            git(&local, &["rev-parse", "HEAD"]),
            git(&remote, &["rev-parse", "HEAD"])
        );
    }
}

#[test]
fn pull_protects_untracked_collisions_and_restores_tracked_wip() {
    let (_root, remote, local) = fixture(false);
    let head = git(&local, &["rev-parse", "HEAD"]);
    std::fs::write(remote.join("new.txt"), "upstream\n").unwrap();
    git(&remote, &["add", "new.txt"]);
    git(&remote, &["commit", "-m", "new file"]);
    std::fs::write(local.join("new.txt"), "untracked WIP\n").unwrap();
    std::fs::write(local.join("shared.txt"), "tracked WIP\n").unwrap();
    let result = pull(&local);
    assert!(!result.ok);
    assert_eq!(git(&local, &["rev-parse", "HEAD"]), head);
    assert_eq!(
        std::fs::read_to_string(local.join("new.txt")).unwrap(),
        "untracked WIP\n"
    );
    assert_eq!(
        std::fs::read_to_string(local.join("shared.txt")).unwrap(),
        "tracked WIP\n"
    );
}
