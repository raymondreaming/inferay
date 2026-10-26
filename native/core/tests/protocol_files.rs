use inferay_core::agent_protocol::{
    AgentProtocolContext, CodexProtocolState, ProtocolEmission, ProtocolFiles,
};
use serde_json::json;
use std::path::PathBuf;

#[test]
fn protocol_diffs_use_supplied_snapshots_without_reading_files() {
    let mut state = CodexProtocolState::default();
    let mut context = AgentProtocolContext::new("/repo");
    let path = PathBuf::from("/repo/file.rs");
    let params = json!({"item":{"type":"fileChange","changes":[{"path":"file.rs"}]}});
    let mut files = ProtocolFiles {
        roots: vec![PathBuf::from("/repo")],
        snapshots: [(path.clone(), Some("before".into()))].into(),
    };
    assert_eq!(
        state.snapshot_paths_for_notification(&context, "item/started", &params, &files.roots),
        std::slice::from_ref(&path)
    );
    state.handle_notification(&mut context, "item/started", &params, &files);
    context.take_emissions();
    files.snapshots.insert(path.clone(), Some("after".into()));
    // Some providers omit paths on completion; use the paths recorded at start.
    let complete = json!({"item":{"type":"fileChange"}});
    assert_eq!(
        state.snapshot_paths_for_notification(&context, "item/completed", &complete, &files.roots),
        std::slice::from_ref(&path)
    );
    state.handle_notification(&mut context, "item/completed", &complete, &files);
    let emissions = context.take_emissions();
    assert!(emissions.iter().any(|event| matches!(event, ProtocolEmission::Chat(value)
        if value["content_block"]["name"] == "Edit"
        && value["content_block"]["input"] == json!({"file_path":"file.rs","old_string":"before","new_string":"after"}))));
    assert!(emissions.contains(&ProtocolEmission::FileChange(vec![path])));
}

#[test]
fn protocol_snapshot_requests_stay_inside_supplied_roots() {
    let state = CodexProtocolState::default();
    let context = AgentProtocolContext::new("/repo");
    let roots = vec![PathBuf::from("/repo"), PathBuf::from("/reference")];
    let params = json!({"item":{"type":"fileChange","changes":[
        {"path":"../outside"}, {"path":"file.rs"}, {"path":"file.rs"}, {"path":"/reference/file.rs"}
    ]}});
    assert_eq!(
        state.snapshot_paths_for_notification(&context, "item/started", &params, &roots),
        [
            PathBuf::from("/repo/file.rs"),
            PathBuf::from("/reference/file.rs")
        ]
    );
    assert!(
        state
            .snapshot_paths_for_notification(
                &context,
                "item/agentMessage/delta",
                &json!({"delta":"text"}),
                &roots
            )
            .is_empty()
    );
}

#[test]
fn claude_retains_tool_results_without_echoing_user_prompts() {
    let mut state = inferay_core::agent_protocol::ClaudeProtocolState::default();
    let mut context = AgentProtocolContext::new("/run");
    state.handle_event(
        &mut context,
        &json!({"type":"user","message":{"content":[{"type":"text","text":"Original prompt"}]}}),
    );
    assert!(context.take_emissions().is_empty());
    let result = json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"probe","is_error":true,"content":"operation not permitted"}]}});
    state.handle_event(&mut context, &result);
    assert_eq!(
        context.take_emissions(),
        vec![ProtocolEmission::Chat(result)]
    );
}

#[test]
fn codex_code_mode_results_survive_without_command_items() {
    let mut state = CodexProtocolState::default();
    let mut context = AgentProtocolContext::new("/run");
    state.handle_notification(&mut context, "rawResponseItem/completed", &json!({"item":{"type":"custom_tool_call_output","call_id":"probe","output":"operation not permitted"}}), &ProtocolFiles::default());
    let emissions = context.take_emissions();
    assert!(
        emissions
            .iter()
            .any(|event| matches!(event, ProtocolEmission::Chat(value)
        if value.pointer("/message/content/0/content") == Some(&json!("operation not permitted"))))
    );
}

#[test]
fn codex_usage_notifications_preserve_cumulative_snapshots() {
    let mut state = CodexProtocolState::default();
    let mut context = AgentProtocolContext::new("/fixture");
    for input in [10, 30] {
        let usage = serde_json::json!({"total":{"inputTokens":input,"outputTokens":4,"cachedInputTokens":2,"reasoningOutputTokens":1,"totalTokens":input+4},"last":{"inputTokens":10,"outputTokens":2}});
        state.handle_notification(
            &mut context,
            "thread/tokenUsage/updated",
            &serde_json::json!({"threadId":"thread","turnId":"turn","tokenUsage":usage}),
            &ProtocolFiles::default(),
        );
        let emissions = context.take_emissions();
        assert_eq!(emissions.len(), 1);
        let ProtocolEmission::Chat(event) = &emissions[0] else {
            panic!("Missing usage emission");
        };
        assert_eq!(event["type"], "inferay.usage");
        assert_eq!(event["usage"], usage);
    }
}

#[test]
fn codex_thread_names_follow_the_active_session() {
    use inferay_core::agent_protocol::{
        AgentProtocolContext, CodexProtocolState, ProtocolEmission, ProtocolFiles,
    };
    let mut state = CodexProtocolState::default();
    let mut context = AgentProtocolContext::new("/repo");
    context.session_id = Some("current".into());
    for (id, title) in [
        ("other", "Wrong title"),
        ("current", "  "),
        ("current", "Fix repository picker"),
    ] {
        state.handle_notification(
            &mut context,
            "thread/name/updated",
            &serde_json::json!({"threadId":id,"threadName":title}),
            &ProtocolFiles::default(),
        );
    }
    assert_eq!(
        context.emissions,
        vec![ProtocolEmission::Title("Fix repository picker".into())]
    );
}

#[test]
fn codex_connector_calls_are_visible_before_completion_and_keep_their_results() {
    use inferay_core::chat_protocol::ChatMessageBuffer;
    let mut state = CodexProtocolState::default();
    let mut context = AgentProtocolContext::new("/repo");
    let mut transcript = ChatMessageBuffer::default();
    let a = json!({"id":"a","type":"mcpToolCall","server":"github","tool":"list_issues","arguments":{"repo":"example"}});
    let b = json!({"id":"b","type":"dynamicToolCall","tool":"inspect_project","arguments":{}});
    for item in [&a, &b] {
        state.handle_notification(&mut context, "item/started", &json!({"item":item}), &ProtocolFiles::default());
        for emission in context.take_emissions() {
            if let ProtocolEmission::Chat(event) = emission { transcript.apply_event(&event); }
        }
    }
    assert_eq!(transcript.messages().len(), 2);
    assert!(transcript.messages().iter().all(|m| m.is_streaming == Some(true)));
    assert_eq!(transcript.messages()[0].render.as_ref().unwrap().display.as_ref().unwrap().source.as_ref().unwrap().server_id, "github");
    let mut completed = a;
    completed["result"] = json!({"content":[{"type":"text","text":"Found three issues"}],"structuredContent":{"count":3}});
    state.handle_notification(&mut context, "item/completed", &json!({"item":completed}), &ProtocolFiles::default());
    for emission in context.take_emissions() {
        if let ProtocolEmission::Chat(event) = emission { transcript.apply_event(&event); }
    }
    assert_eq!(transcript.messages().len(), 2);
    assert_eq!(transcript.messages()[0].is_streaming, Some(false));
    assert!(transcript.messages()[0].content.contains("Found three issues"));
    assert!(transcript.messages()[0].content.contains("\"count\": 3"));
    assert_eq!(transcript.messages()[1].is_streaming, Some(true));
    assert!(transcript.messages()[0].render.as_ref().unwrap().continues_after);
}
