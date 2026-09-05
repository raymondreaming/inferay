use inferay_native_diff::{get_git_graph_snapshot, prepare_edit_diff, prepare_git_graph};
use std::process::Command;
#[test]
fn huge_single_edit_has_exact_counts_without_a_quadratic_table() {
    let before = (0..10_000)
        .map(|i| format!("line{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let after = before.replace("line5000\n", "changed\n");
    let diff = prepare_edit_diff(&before, &after, &[]).unwrap();
    let value = serde_json::to_value(diff).unwrap();
    let lines = value["hunks"][0]["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["text"], "line5000");
    assert_eq!(lines[1]["text"], "changed");
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
    let diff = prepare_edit_diff(&before, &after, &[]).unwrap();
    let value = serde_json::to_value(diff).unwrap();
    let lines = value["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|hunk| hunk["lines"].as_array().unwrap())
        .collect::<Vec<_>>();
    for (kind, expected) in [("removed", before), ("added", after)] {
        let actual = lines
            .iter()
            .filter(|line| line["type"] == kind)
            .map(|line| line["text"].as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(actual, expected);
    }
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
