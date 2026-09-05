use inferay_native_diff::{
    execute_request, get_git_graph_snapshot, prepare_git_graph, NativeRequest, NativeResponse,
};
use std::process::Command;
#[test]
fn huge_single_edit_has_exact_counts_without_a_quadratic_table() {
    let before = (0..100_000)
        .map(|i| format!("line{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let after = before.replace("line50000\n", "changed\n");
    let NativeResponse::Diff { diff } = execute_request(NativeRequest::Diff { before, after })
    else {
        panic!()
    };
    assert_eq!(diff.stats.added, 1);
    assert_eq!(diff.stats.removed, 1);
    assert_eq!(diff.stats.unchanged, 99_999);
}
#[test]
fn huge_unrelated_diff_is_lossless_with_bounded_work() {
    let before = (0..5000)
        .map(|i| format!("old{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let after = (0..5000)
        .map(|i| format!("new{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let NativeResponse::Diff { diff } = execute_request(NativeRequest::Diff { before, after })
    else {
        panic!()
    };
    assert_eq!(diff.stats.added, 5000);
    assert_eq!(diff.stats.removed, 5000);
}
#[test]
fn graph_input_revision_changes_on_reediting_modified_files() {
    let repo = tempfile::tempdir().unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.name", "Test"],
        vec!["config", "user.email", "test@example.com"],
    ] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(repo.path())
            .status()
            .unwrap()
            .success());
    }
    let file = repo.path().join("file.txt");
    std::fs::write(&file, "initial\n").unwrap();
    for args in [vec!["add", "file.txt"], vec!["commit", "-qm", "initial"]] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(repo.path())
            .status()
            .unwrap()
            .success());
    }
    let cwd = repo.path().to_str().unwrap();
    std::fs::write(&file, "first edit\n").unwrap();
    let first = prepare_git_graph(cwd);
    std::fs::write(&file, "second larger edit\n").unwrap();
    let second = prepare_git_graph(cwd);
    assert_ne!(first.revision, second.revision);
    let snapshot = get_git_graph_snapshot(cwd, 100);
    assert!(!snapshot.commits.is_empty());
}
