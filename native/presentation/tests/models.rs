mod support;
use inferay_presentation::panels;
use serde_json::{Value, json};
use support::project;

#[test]
fn added_and_deleted_files_use_full_width_but_modified_files_stay_split() {
    use inferay_core::repository::GitHunkDiff;
    for (is_new, patch, full_width) in [
        (true, "", true),
        (false, "--- a/file.ts\n+++ /dev/null\n", true),
        (false, "--- a/file.ts\n+++ b/file.ts\n", false),
    ] {
        let diff = GitHunkDiff {
            is_new,
            raw_patch: Some(patch.into()),
            ..Default::default()
        };
        let viewer =
            serde_json::to_value(inferay_presentation::diff::viewer(&diff, "file.ts", 0)).unwrap();
        assert_eq!(viewer["fullWidth"], full_width);
    }
}

#[test]
fn panel_transitions_preserve_historical_context_and_validate_commands() {
    use panels::{MainView, PanelAction, PanelSession, SelectionIntent};
    let mut session = PanelSession::read(&Value::Null);
    session.apply(
        PanelAction::OpenGraph {
            cwd: "/repo".into(),
            reset: None,
        },
        10,
    );
    session.apply(
        PanelAction::SelectGraph {
            id: Some("a".into()),
            ordered_ids: vec![],
            intent: None,
        },
        11,
    );
    session.apply(
        PanelAction::SelectGraph {
            id: Some("c".into()),
            ordered_ids: ["a", "b", "c"].map(str::to_owned).into(),
            intent: Some(SelectionIntent {
                range: true,
                additive: false,
            }),
        },
        12,
    );
    assert_eq!(session.selected_commit_ids, ["a", "b", "c"]);
    session.apply(
        PanelAction::CommitFile {
            cwd: "/repo".into(),
            path: "a.rs".into(),
            commit_hash: "a".into(),
            commit_parent: None,
        },
        13,
    );
    assert!(session.presentation().historical_diff);
    assert!(session.presentation().graph_drill_in);
    assert!(json!(session).get("historicalDiff").is_none());
    session.apply(PanelAction::DismissDiff, 14);
    assert_eq!(session.main_view_mode, MainView::Graph);
    assert!(!session.presentation().historical_diff);
    assert!(
        project(
            "panelPreview",
            &json!({"session":session,
        "action":{"type":"commitFile","path":"a.rs"},"now":15})
        )
        .is_err()
    );
}

#[test]
fn saved_panels_migrate_diff_sources_and_restore_valid_documents() {
    let saved = json!({
        "mainViewMode":"graph", "selectedCommitHash":"a",
        "selectedFile":{"path":"a.rs","staged":false}, "selectedFileCommitHash":"old",
        "fileRequest":{"path":"a.rs"},
        "detachedFilePanels":[{"id":"old-panel","cwd":"/repo","path":"a.rs","initialFile":{"content":"discard"}}, {"id":2}],
        "documentSessions":{"old-panel":{"cwd":"/repo","activePath":"a.rs","paths":["a.rs","b.rs"]}},
        "historicalDiff":true
    });
    let mut session = panels::PanelSession::read(&saved);
    assert!(session.repository_initialized && session.graph_visible && session.sidebar_visible);
    assert_eq!(session.selected_commit_ids, ["a"]);
    assert_eq!(session.detached_file_panels.len(), 1);
    assert_eq!(session.file_request.as_ref().unwrap().token, 0);
    assert_eq!(
        session.document_sessions["old-panel"].paths,
        ["a.rs", "b.rs"]
    );
    assert!(
        matches!(session.selected_file.as_ref().unwrap().source, panels::DiffSource::Commit { ref commit_hash, .. } if commit_hash == "old")
    );
    assert!(!session.presentation().historical_diff);
    session.apply(
        panels::PanelAction::CloseFile {
            id: "old-panel".into(),
        },
        1,
    );
    assert!(session.detached_file_panels.is_empty());
    assert_eq!(panels::PanelSession::read(&json!(session)), session);
}
