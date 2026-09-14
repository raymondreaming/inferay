use inferay_core::chat_protocol::{ChatMessageBuffer, ChatTranscriptMessage};
use serde_json::{Value, json};

fn rendered(content: String) -> Value {
    let message: ChatTranscriptMessage = serde_json::from_value(json!({
        "id":"system", "role":"system", "content":content
    }))
    .unwrap();
    let mut buffer = ChatMessageBuffer::default();
    buffer.replace_messages(vec![message]);
    serde_json::to_value(buffer.messages()[0].render.as_ref().unwrap()).unwrap()
}

#[test]
fn goal_cards_supply_status_and_turn_labels_without_renderer_formatting() {
    for (status, title) in [
        ("active", "Pursuing Goal"),
        ("paused", "Goal Paused"),
        ("complete", "Goal Achieved"),
        ("cleared", "Goal Cleared"),
        ("empty", "No Active Goal"),
    ] {
        let render =
            rendered(json!({"type":"inferay.goal", "status":status, "turns":1}).to_string());
        assert_eq!(render["goal"]["title"], title);
        assert_eq!(render["goal"]["turnsLabel"], "1 turn");
        assert_eq!(render["goal"]["status"], status);
    }
    let render = rendered(json!({"type":"inferay.goal", "status":"active", "turns":2}).to_string());
    assert_eq!(render["goal"]["turnsLabel"], "2 turns");
    let render = rendered(json!({"type":"inferay.goal", "status":"active"}).to_string());
    assert!(render["goal"]["turnsLabel"].is_null());
    assert!(
        rendered(json!({"type":"inferay.goal", "status":"invalid"}).to_string())["goal"].is_null()
    );
}

#[test]
fn command_cards_format_structured_and_legacy_commands_consistently() {
    let render = rendered(json!({"type":"inferay.command", "name":"review", "args":"main", "description":"Review changes"}).to_string());
    assert_eq!(render["command"]["label"], "/review main");
    assert_eq!(render["command"]["description"], "Review changes");
    assert_eq!(
        rendered("Running /review main...".into())["command"]["label"],
        "/review main"
    );
    assert_eq!(
        rendered(json!({"type":"inferay.command", "name":"review", "args":""}).to_string())["command"]
            ["label"],
        "/review"
    );
    assert!(
        rendered(json!({"type":"inferay.command", "name":" "}).to_string())["command"].is_null()
    );
}
