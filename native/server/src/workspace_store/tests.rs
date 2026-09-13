use super::*;
use serde_json::json;
use uuid::Uuid;

fn action(value: Value) -> AgentWorkspaceAction {
    serde_json::from_value(value).unwrap()
}

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

fn deletion_workspace(groups: Value, selected: &str) -> Workspace {
    serde_json::from_value(json!({
        "groups": groups, "selectedGroupId": selected,
        "themeId":"default", "fontSize":13, "fontFamily":"SF Mono", "opacity":1
    }))
    .unwrap()
}

fn repository_group(id: &str, cwd: &str) -> Value {
    json!({"id":id,"name":id,"selectedPaneId":format!("{id}-chat"),"columns":1,"rows":1,
            "panes":[{"id":format!("{id}-chat"),"title":id,"agentKind":"codex","cwd":cwd}]})
}

#[test]
fn repository_order_persists_without_reordering_chats_or_selection() {
    let workspace = deletion_workspace(
        json!([
            repository_group("a", "/a"),
            repository_group("b", "/b"),
            repository_group("c", "/c/"),
            repository_group("other", "/a")
        ]),
        "b",
    );
    let path = std::env::temp_dir().join(format!("repository-order-{}.json", Uuid::new_v4()));
    let store = AgentStateStore::new(path.clone());
    let initial = store.save(&workspace).unwrap();
    store
        .apply_workspace_action(
            &AgentWorkspaceAction::ReorderRepository {
                cwd: "/c/".into(),
                before_cwd: Some("/a".into()),
            },
            "codex",
        )
        .unwrap();
    let result = AgentStateStore::new(path.clone()).read().unwrap();
    std::fs::remove_file(path).unwrap();
    assert_eq!(result["repositoryOrder"], json!(["/c", "/a", "/b"]));
    assert_eq!(result["groups"], initial["groups"]);
    assert_eq!(result["repositories"]["activePath"], "/b");
    assert_eq!(result["repositories"]["workspaces"][0]["cwd"], "/c");
    assert_eq!(
        result["repositories"]["workspaces"][1]["entries"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn typed_actions_keep_defaults_metadata_and_persistence_consistent() {
    let path =
        std::env::temp_dir().join(format!("workspace-actions-{}.json", uuid::Uuid::new_v4()));
    let store = AgentStateStore::new(path.clone());
    let state = store.initialize("claude").unwrap();
    let group = state["selectedGroupId"].as_str().unwrap();
    let pane = state["groups"][0]["selectedPaneId"].as_str().unwrap();
    store
        .set_pane_summary(pane, Some("A title".into()))
        .unwrap();
    store
        .set_pane_provider_session(pane, Some("session".into()))
        .unwrap();
    let state = store
        .apply_workspace_action(
            &action(json!({
                "type":"setPaneAgentKind","groupId":group,"paneId":pane,"agentKind":"codex"
            })),
            "claude",
        )
        .unwrap();
    assert_eq!(state["groups"][0]["panes"][0]["agentKind"], "codex");
    assert!(state["groups"][0]["panes"][0]["providerSessionId"].is_null());
    assert_eq!(state["groups"][0]["panes"][0]["summary"], "A title");
    assert!(
        store
            .apply_workspace_action(
                &action(json!({
                    "type":"setGridDimensions","groupId":group,"columns":0
                })),
                "claude"
            )
            .is_err()
    );
    assert_eq!(store.read().unwrap(), state);
    let state = store
        .apply_workspace_action(
            &action(json!({
                "type":"removePane","groupId":group,"paneId":pane
            })),
            "claude",
        )
        .unwrap();
    assert_eq!(state["groups"][0]["panes"][0]["agentKind"], "claude");
    assert_eq!(store.read().unwrap(), state);
    std::fs::remove_file(path).unwrap();
}
