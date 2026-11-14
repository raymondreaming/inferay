use crate::backend::RUNTIME;
use inferay_core::chat_protocol::ChatMessageBuffer;
use serde_json::json;

fn transcript(first: bool) -> Vec<serde_json::Value> {
    let mut buffer = ChatMessageBuffer::default();
    buffer.replace_messages(vec![
        serde_json::from_value(json!({"id":"u1","role":"user","content":"Can you review the diff renderer and tidy the tables?"})).unwrap(),
    ]);
    buffer.apply_event(&json!({"type":"inferay.progress","id":"codex-summary:one","text":"**Inspecting the renderer**"}));
    buffer.apply_event(&json!({"type":"inferay.tool","id":"read-1","name":"Read","input":{"file_path":"src/diff.rs"},"output":"fn render() {}","done":true}));
    buffer.apply_event(&json!({"type":"inferay.tool","id":"exec-1","name":"exec_command","input":{"cmd":"cargo test -p diff"},"output":"test result: ok. 12 passed","done":true}));
    buffer.apply_event(&json!({"type":"inferay.progress","id":"codex-summary:two","text":"**Checking table layout**"}));
    buffer.apply_event(&json!({"type":"inferay.tool","id":"grep-1","name":"Grep","input":{"pattern":"Table","path":"src"},"output":"src/table.rs:12","done":true}));
    let mut messages: Vec<serde_json::Value> = buffer
        .messages()
        .iter()
        .map(|m| serde_json::to_value(m).unwrap())
        .collect();
    let answer = if first {
        "## Summary\n\nThe renderer now keeps **syntax colours** and `word-level` highlights together. See [the guide](https://example.com/guide).\n\n- Split and unified views share data\n- Large files stay *bounded*\n  - nested item with `code`\n\n1. First step\n2. Second step\n\n```rust\nfn main() {\n    let total: u32 = (1..=10).sum();\n    println!(\"{total}\");\n}\n```\n\n| Area | Before | After |\n| --- | ---: | :---: |\n| Diff | 42 ms | 9 ms |\n| Graph | 18 ms | 6 ms |\n\n> Quoted note about behaviour.\n\nFinal paragraph with a long line that should wrap across the 624 point column so we can compare wrapping exactly between both renderers."
    } else {
        "Short answer in the second chat.\n\nIt has two paragraphs."
    };
    messages.push(json!({"id":"a1","role":"assistant","content":answer}));
    messages.push(
        json!({"id":"u2","role":"user","content":"Thanks! One more question about the minimap."}),
    );
    messages.push(json!({"id":"a2","role":"assistant","content":"The minimap marks every changed region and shows the viewport."}));
    messages
}

#[test]
#[ignore = "writes a visual comparison profile to INFERAY_FIXTURE_DIR"]
fn build_visual_fixture() {
    let root = std::path::PathBuf::from(
        std::env::var("INFERAY_FIXTURE_DIR").expect("INFERAY_FIXTURE_DIR"),
    );
    std::fs::create_dir_all(&root).unwrap();
    let mut workspace = inferay_core::agent_state::Workspace::new("codex");
    let first = workspace.selected_pane_id().unwrap().to_owned();
    workspace
        .apply_action(
            &inferay_core::workspace_action::AgentWorkspaceAction::AddPane {
                group_id: None,
                agent_kind: None,
                cwd: None,
                reference_paths: None,
            },
            "codex",
        )
        .unwrap();
    let second = workspace.selected_pane_id().unwrap().to_owned();
    let mut state = serde_json::to_value(&workspace).unwrap();
    state["groups"][0]["panes"][0]["summary"] = "Review diff renderer".into();
    state["groups"][0]["panes"][1]["summary"] = "Minimap question".into();
    std::fs::write(root.join("agent-state.json"), state.to_string()).unwrap();
    let store = inferay_server::chat_persistence::ChatPersistence::new(root.clone());
    RUNTIME.block_on(store.read_transcript("init"));
    let db = rusqlite::Connection::open(root.join("chat.sqlite3")).unwrap();
    for (pane, first_chat) in [(&first, true), (&second, false)] {
        db.execute(
            "INSERT INTO transcripts(pane,epoch,revision) VALUES(?1,'fixture-epoch','1')",
            rusqlite::params![pane],
        )
        .unwrap();
        for (position, message) in transcript(first_chat).iter().enumerate() {
            db.execute(
                "INSERT INTO transcript_messages(pane,position,body) VALUES(?1,?2,?3)",
                rusqlite::params![pane, position as i64, message.to_string()],
            )
            .unwrap();
        }
    }
}

#[test]
#[ignore = "reads INFERAY_FIXTURE_DIR"]
fn read_visual_fixture() {
    let root = std::path::PathBuf::from(std::env::var("INFERAY_FIXTURE_DIR").unwrap());
    let session = crate::session::load(&root).unwrap();
    for project in &session.projects {
        eprintln!(
            "project {:?} panes {:?}",
            project.name,
            project
                .panes
                .iter()
                .map(|p| p.id.clone())
                .collect::<Vec<_>>()
        );
        for pane in &project.panes {
            let (total, messages) = crate::session::transcript(&root, &pane.id, 200).unwrap();
            eprintln!("  {} total {total} messages {}", pane.id, messages.len());
        }
    }
}
