use inferay_core::agent_context::{AgentContextState, AgentContextUpdate};

fn update(scope: &str, instructions: &str, mode: Option<&str>) -> AgentContextUpdate {
    AgentContextUpdate {
        scope: scope.into(),
        cwd: Some("/repo".into()),
        pane_id: Some("pane".into()),
        instructions: instructions.into(),
        mode: mode.map(String::from),
    }
}

#[test]
fn context_layers_compose_and_clear_without_a_store() {
    let mut state = AgentContextState::default();
    state
        .update(update("global", " Global ", None), 10)
        .unwrap();
    state
        .update(update("project", "Project", Some("replace")), 20)
        .unwrap();
    state.update(update("chat", "Chat", None), 30).unwrap();
    let context = state.clone().resolve(Some("/repo"), Some("pane"));
    assert_eq!(context.effective_instructions, "Project\n\nChat");
    assert_eq!(context.global.instructions, "Global");
    assert_eq!(context.chat.unwrap().updated_at, 30);
    state.update(update("project", " ", None), 40).unwrap();
    let context = state.resolve(Some("/repo"), Some("pane"));
    assert_eq!(context.effective_instructions, "Global\n\nChat");
    assert!(context.project.is_none());
}

#[test]
fn invalid_context_targets_do_not_change_state() {
    let mut state = AgentContextState::default();
    let before = serde_json::to_value(&state).unwrap();
    let mut missing_project = update("project", "Project", None);
    missing_project.cwd = None;
    let mut missing_chat = update("chat", "Chat", None);
    missing_chat.pane_id = None;
    for invalid in [
        missing_project,
        missing_chat,
        update("unknown", "Text", None),
    ] {
        assert!(state.update(invalid, 1).is_err());
        assert_eq!(serde_json::to_value(&state).unwrap(), before);
    }
}
