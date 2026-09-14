use super::*;

#[test]
fn invalid_saved_workspaces_are_reported_without_being_overwritten() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.json");
    let store = AgentStateStore::new(path.clone());
    assert_eq!(store.read().unwrap(), Value::Null);
    assert!(store.active_cwds().unwrap().is_empty());
    assert!(store.pane("missing").unwrap().is_none());
    for invalid in [b"not json".as_slice(), b"{\"groups\":[]}"] {
        std::fs::write(&path, invalid).unwrap();
        assert!(store.initialize("codex").is_err());
        assert!(
            store
                .apply_workspace_action(&AgentWorkspaceAction::AddWorkspace, "codex")
                .is_err()
        );
        assert_eq!(std::fs::read(&path).unwrap(), invalid);
    }
}

#[test]
fn pending_directory_consumption_survives_reopening_the_store() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.json");
    let store = AgentStateStore::new(path.clone());
    let state = store.initialize("codex").unwrap();
    let id = state["groups"][0]["selectedPaneId"].as_str().unwrap();
    store
        .set_pending_workspace(id, vec!["/repo".into(), "/reference".into()])
        .unwrap();
    let reopened = AgentStateStore::new(path.clone());
    assert!(reopened.pane(id).unwrap().unwrap().cwd.is_none());
    assert_eq!(
        reopened.consume_pending_workspace(id).unwrap(),
        Some(("/repo".into(), vec!["/reference".into()]))
    );
    let reopened = AgentStateStore::new(path);
    assert!(reopened.consume_pending_workspace(id).unwrap().is_none());
    assert_eq!(reopened.active_cwds().unwrap(), ["/repo"]);
    assert_eq!(
        reopened.pane(id).unwrap().unwrap().reference_paths,
        ["/reference"]
    );
}
