use inferay_core::{agent_state::Workspace, workspace_action::AgentWorkspaceAction};
use serde_json::{Value, json};

fn action(value: Value) -> AgentWorkspaceAction {
    serde_json::from_value(value).unwrap()
}

#[test]
fn workspace_wire_contract_preserves_optional_fields_and_nullable_directory() {
    for value in [
        json!({"type":"addPane"}),
        json!({"type":"addPane","agentKind":"claude","cwd":"/repo","referencePaths":["/other"]}),
        json!({"type":"directorySelected","groupId":"g","paneId":"p","path":null}),
        json!({"type":"reorderRepository","cwd":"/repo","beforeCwd":null}),
        json!({"type":"setGridDimensions","groupId":"g","columns":2}),
    ] {
        assert_eq!(serde_json::to_value(action(value.clone())).unwrap(), value);
    }
}

#[test]
fn workspace_wire_contract_rejects_malformed_and_server_only_actions() {
    for value in [
        json!({"type":"selectPane","groupId":"g"}),
        json!({"type":"addPane","agentKind":"unknown"}),
        json!({"type":"reorderPanes","groupId":"g","fromIndex":-1,"toIndex":0}),
        json!({"type":"setGridDimensions","groupId":"g","rows":1.5}),
        json!({"type":"setPaneSummary","paneId":"p","summary":"title"}),
        json!({"type":"setPaneProviderSession","paneId":"p","providerSessionId":null}),
    ] {
        assert!(serde_json::from_value::<AgentWorkspaceAction>(value).is_err());
    }
}

#[test]
fn directory_selection_transitions_do_not_need_a_store_or_server() {
    let mut state: Workspace = serde_json::from_value(json!({
        "groups": [{"id":"g","name":"Workspace","selectedPaneId":"p","columns":1,"rows":1,
            "panes":[{"id":"p","title":"Chat","agentKind":"codex","cwd":"/old",
                "pendingCwd":true,"referencePaths":["/old-reference"],"pendingWorkspacePaths":["/pending"]}]}],
        "selectedGroupId":"g","themeId":"default","fontSize":13,"fontFamily":"SF Mono","opacity":1
    })).unwrap();
    state.apply_action(&action(json!({
        "type":"directorySelected","groupId":"g","paneId":"p","path":"/new","referencePaths":["/reference"]
    })), "codex").unwrap();
    let value = serde_json::to_value(&state).unwrap();
    let pane = &value["groups"][0]["panes"][0];
    assert_eq!(pane["cwd"], "/new");
    assert_eq!(pane["referencePaths"], json!(["/reference"]));
    assert_eq!(pane["pendingCwd"], false);
    assert!(pane.get("pendingWorkspacePaths").is_none());
    state
        .apply_action(
            &action(json!({
                "type":"directorySelected","groupId":"g","paneId":"p","path":null
            })),
            "codex",
        )
        .unwrap();
    let value = serde_json::to_value(&state).unwrap();
    let pane = &value["groups"][0]["panes"][0];
    assert!(pane.get("cwd").is_none());
    assert_eq!(pane["referencePaths"], json!([]));
}

#[test]
fn staged_directories_are_consumed_once_by_the_model() {
    let mut state = Workspace::new("codex");
    let view = state.presentation().unwrap();
    let pane_id = view["groups"][0]["selectedPaneId"].as_str().unwrap();
    state
        .set_pending_workspace(
            pane_id,
            vec!["".into(), "/repo".into(), "/reference".into()],
        )
        .unwrap();
    assert!(state.pane(pane_id).unwrap().cwd.is_none());
    assert_eq!(
        state.consume_pending_workspace(pane_id).unwrap(),
        Some(("/repo".into(), vec!["/reference".into()]))
    );
    assert!(state.consume_pending_workspace(pane_id).unwrap().is_none());
    assert_eq!(state.active_cwds(), ["/repo"]);
    state
        .set_pending_workspace(pane_id, vec!["/replacement".into()])
        .unwrap();
    assert!(state.consume_pending_workspace(pane_id).unwrap().is_none());
    assert_eq!(state.pane(pane_id).unwrap().cwd.as_deref(), Some("/repo"));
}
