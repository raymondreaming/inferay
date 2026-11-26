use super::*;
use crate::task::testing::serial;
use crate::ui::SEMIBOLD;
use crate::workspace::Workspace;
use rune::{Cx, Env, Key, KeyEvent, Mods, Runtime, col};
use std::cell::RefCell;

thread_local! {
    static SHOWN: RefCell<Option<(RichText, &'static str)>> = const { RefCell::new(None) };
}

fn view(_: &Workspace, _: &mut Cx<Workspace>) -> El {
    crate::zoom::apply(crate::zoom::Zoom::default());
    SHOWN.with_borrow(|shown| {
        let (rich, id) = shown.as_ref().expect("a rich text to show");
        col()
            .w_full()
            .h_full()
            .instant_changes()
            .child(rich.render(id))
    })
}

pub(crate) fn rect<S: 'static>(rt: &Runtime<S>, key: &str) -> Option<[f32; 4]> {
    rt.elements()
        .into_iter()
        .find(|e| !e.exiting && e.key.as_deref() == Some(key))
        .map(|e| e.rect)
}

fn show(
    rich: RichText,
    id: &'static str,
    size: (f32, f32),
) -> (Runtime<Workspace>, rune::clipboard::MemoryClipboard) {
    SHOWN.with_borrow_mut(|shown| *shown = Some((rich, id)));
    let mut rt = Runtime::new(Workspace::empty(), view, size, Env::new(false, 1.));
    let clipboard = rune::clipboard::memory();
    rt.use_clipboard(&clipboard);
    rt.frame(1. / 60.);
    rt.frame(1. / 60.);
    (rt, clipboard)
}

fn click(rt: &mut Runtime<Workspace>, key: &str) {
    let r = rect(rt, key).unwrap_or_else(|| panic!("no element {key}"));
    let (x, y) = (r[0] + r[2] / 2., r[1] + r[3] / 2.);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(1. / 60.);
}

fn command(rt: &mut Runtime<Workspace>, c: char) {
    rt.key(KeyEvent {
        key: Key::Command(c),
        mods: Mods {
            cmd: true,
            ..Mods::default()
        },
    });
    rt.frame(1. / 60.);
}

#[test]
fn wide_tables_scroll_inside_the_message() {
    let _serial = serial();
    let (mut rt, _) = show(
        RichText::prepare(
            "| Identifier | Description | Requirements | Measurements | Observations | Recommendation |\n| --- | --- | --- | --- | --- | --- |\n| A | Wrapped | Wrapped | Wrapped | Wrapped | Wrapped |",
            "vscode-black",
        ),
        "table",
        (320., 240.),
    );
    let viewport = rect(&rt, "chat-table").unwrap();
    assert!(viewport[2] <= 320.);
    let before = rect(&rt, "chat-table-cell-0-0").unwrap();
    assert!(before[2] < 180.);
    rt.wheel_xy(
        viewport[0] + viewport[2] / 2.,
        viewport[1] + viewport[3] / 2.,
        -120.,
        0.,
    );
    for _ in 0..30 {
        rt.frame(1. / 60.);
    }
    assert!(rect(&rt, "chat-table-cell-0-0").unwrap()[0] < before[0]);
    assert_eq!(rect(&rt, "chat-table").unwrap(), viewport);
}

#[test]
fn prepared_markdown_selection_copies_visible_unicode_text() {
    let _serial = serial();
    let (mut rt, clipboard) = show(
        RichText::prepare("**Hello café** [🦀](https://example.com)", "vscode-black"),
        "message",
        (400., 200.),
    );
    click(&mut rt, "inline-message-0");
    command(&mut rt, 'a');
    command(&mut rt, 'c');
    assert_eq!(
        clipboard.text().as_deref().map(String::as_str),
        Some("Hello café 🦀")
    );
}

#[test]
fn tool_details_use_one_card_and_copy_without_nested_labels() {
    let _serial = serial();
    let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
    buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"tool","name":"exec_command","input":{"cmd":"echo café"},"output":"café 🌳","done":true}));
    let rich = RichText::message(&buffer.messages()[0], "vscode-black");
    let (mut rt, clipboard) = show(rich, "tool", (600., 400.));
    assert!(rect(&rt, "tool-details-tool").is_some());
    assert!(rect(&rt, "code-card-tool-0").is_none());
    assert!(rect(&rt, "code-card-tool-1").is_none());
    click(&mut rt, "tool-details-copy");
    assert_eq!(
        clipboard.text().as_deref().map(String::as_str),
        Some("echo café\n\ncafé 🌳")
    );
}

#[test]
fn restored_tools_show_commands_outputs_and_edit_payloads() {
    let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
    buffer.replace_messages(vec![
        serde_json::from_value(serde_json::json!({"id":"command", "role":"tool", "toolName":"exec", "content":"{\"cmd\":\"cargo test\"}\n\npassed 🌳"})).unwrap(),
        serde_json::from_value(serde_json::json!({"id":"edit", "role":"tool", "toolName":"Edit", "content":"{\"file_path\":\"main.rs\",\"old_string\":\"old\",\"new_string\":\"new\"}"})).unwrap(),
    ]);
    let message = &buffer.messages()[0];
    assert_ne!(
        message
            .render
            .as_ref()
            .unwrap()
            .display
            .as_ref()
            .unwrap()
            .label,
        "exec"
    );
    let rich = RichText::message(message, "vscode-black");
    let Block::Code { text, lang, .. } = &rich.blocks[0] else {
        panic!("tool code block")
    };
    assert_eq!(text.content(), "cargo test");
    assert_eq!(lang, "sh");
    let Block::Code { text, lang, .. } = &rich.blocks[1] else {
        panic!("separate output")
    };
    assert_eq!(text.content(), "passed 🌳");
    assert_eq!(lang, "text");
    assert_eq!(
        buffer.messages()[1]
            .render
            .as_ref()
            .unwrap()
            .edit
            .as_ref()
            .unwrap()
            .file_path,
        "main.rs"
    );
    let raw = serde_json::from_value(
        serde_json::json!({"id":"raw", "role":"tool", "content":"output\n````\nmore"}),
    )
    .unwrap();
    let rich = RichText::message(&raw, "vscode-black");
    let Block::Code { text, .. } = &rich.blocks[0] else {
        panic!("literal tool output")
    };
    assert_eq!(text.content(), "output\n````\nmore");
}

#[test]
fn tool_cards_highlight_source_json_and_shell_and_follow_theme_changes() {
    let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
    for event in [
        serde_json::json!({"type":"inferay.tool","id":"read","name":"Read","input":{"file_path":"/src/App.tsx"},"output":"const title = \"café 🌳\";\nexport default function App() { return <h1>{title}</h1>; }","done":true}),
        serde_json::json!({"type":"inferay.tool","id":"shell","name":"exec_command","input":{"cmd":"echo \"café\"","cwd":"/tmp"},"output":"{\"ok\":true,\"count\":2}","done":true}),
    ] {
        buffer.apply_event(&event);
    }
    for message in buffer.messages() {
        let rich = RichText::message(message, "vscode-black");
        let recolored = rich.retheme("contrast");
        for (before, after) in rich.blocks.iter().zip(&recolored.blocks) {
            let Block::Code { lang, text, .. } = before else {
                panic!("tool card")
            };
            let Block::Code { text: changed, .. } = after else {
                panic!("recolored tool card")
            };
            assert_eq!(text.content(), changed.content());
            assert_eq!(
                text.highlights(),
                crate::syntax::highlights(text.content(), lang, "vscode-black")
            );
            assert_eq!(
                changed.highlights(),
                crate::syntax::highlights(text.content(), lang, "contrast")
            );
            if lang != "text" {
                assert!(!text.highlights().is_empty(), "{lang}");
                assert_ne!(text.highlights(), changed.highlights(), "{lang}");
            }
            if message.id == "read" && lang != "json" {
                assert_eq!(lang, "/src/App.tsx");
            }
        }
    }
}

#[test]
fn command_logs_stay_literal_and_progress_notes_render_markdown() {
    let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
    buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"logs","name":"exec_command","input":{"cmd":"git diff --cached App.tsx; echo finished"},"output":"Formatted 670 files.\ncreate mode 100644 App.tsx","done":true}));
    let rich = RichText::message(&buffer.messages()[0], "vscode-black");
    let Block::Code { lang, text, .. } = &rich.blocks[1] else {
        panic!("terminal output")
    };
    assert_eq!(lang, "text");
    assert!(text.highlights().is_empty());
    let note = serde_json::from_value(
        serde_json::json!({"id":"note","role":"system","content":"**Checking file status**"}),
    )
    .unwrap();
    let rich = RichText::message(&note, "vscode-black");
    let Block::Text { text, .. } = &rich.blocks[0] else {
        panic!("Markdown progress note")
    };
    assert_eq!(text.content(), "Checking file status");
    assert!(
        text.highlights()
            .iter()
            .any(|(_, s)| s.weight == Some(SEMIBOLD))
    );
}

#[test]
fn completion_filler_is_hidden_without_discarding_substantive_results() {
    for (output, count) in [
        ("completed", 1),
        (" Completed\n", 1),
        ("completed 3 files", 2),
        ("{\"status\":\"completed\"}", 2),
    ] {
        let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
        buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"hook","name":"stop hook","input":{"event":"stop"},"output":output,"done":true}));
        let rich = RichText::message(&buffer.messages()[0], "vscode-black");
        assert_eq!(rich.blocks.len(), count, "{output}");
    }
}

#[test]
fn preserves_rich_blocks_and_unicode_syntax_ranges() {
    let rich = RichText::prepare(
        "**Bold** and [link](https://example.com)\n\n- one\n- two\n\n```rust\nlet emoji = \"😀\";\n```",
        "vscode-black",
    );
    assert!(
        rich.blocks
            .iter()
            .any(|block| matches!(block, Block::List(_)))
    );
    let Block::Code { text, .. } = rich
        .blocks
        .iter()
        .find(|block| matches!(block, Block::Code { .. }))
        .unwrap()
    else {
        unreachable!()
    };
    assert_eq!(text.content(), "let emoji = \"😀\";");
}

#[test]
fn combined_runs_layer_word_changes_over_syntax() {
    let base = vec![(
        0..3,
        crate::syntax::Paint {
            color: Some(rgb(0xff0000)),
            ..Default::default()
        },
    )];
    let layer = vec![(
        2..5,
        crate::syntax::Paint {
            background: Some(rgb(0x00ff00)),
            ..Default::default()
        },
    )];
    let runs = combine(base, layer);
    assert_eq!(
        runs.iter().map(|(r, _)| r.clone()).collect::<Vec<_>>(),
        vec![0..2, 2..3, 3..5]
    );
    assert_eq!(runs[1].1.color, Some(rgb(0xff0000)));
    assert_eq!(runs[1].1.background, Some(rgb(0x00ff00)));
    assert_eq!(runs[2].1.color, None);
}

use crate::colors::rgb;

fn table_cells(rt: &Runtime<Workspace>, row: usize, columns: usize) -> Vec<[f32; 4]> {
    (0..columns)
        .map(|c| rect(rt, &format!("chat-table-cell-{row}-{c}")).unwrap())
        .collect()
}

#[test]
fn narrow_tables_fill_the_message_width() {
    let _serial = serial();
    let (rt, _) = show(
        RichText::prepare(
            "| Share | What |\n| --- | --- |\n| 12% | Rebuilding the whole app shell |\n| 7% | Recomputing the sidebar scope |",
            "vscode-black",
        ),
        "table",
        (600., 300.),
    );
    let table = rect(&rt, "chat-table").unwrap();
    for row in 0..3 {
        let cells = table_cells(&rt, row, 2);
        let right = cells[1][0] + cells[1][2];
        assert!(
            (table[0] + table[2] - right).abs() <= 2.,
            "row {row} ends at {right}, table at {}",
            table[0] + table[2]
        );
    }
}

#[test]
fn wide_tables_wrap_every_column_inside_the_message() {
    let _serial = serial();
    let (rt, _) = show(
        RichText::prepare(
            "| Area | Finding | Verdict |\n| --- | --- | --- |\n| Startup | About 3 s to settled; about 1 s of that is main-thread work, mostly SwiftUI building and drawing the first frame | Fair; could be faster with deferred work |\n| Memory peak at launch | About 450 MB, every launch, settling to 220-245 MB | Worth fixing: spikes once |",
            "vscode-black",
        ),
        "table",
        (560., 400.),
    );
    let table = rect(&rt, "chat-table").unwrap();
    let line = rect(&rt, "chat-table-cell-0-2").unwrap()[3];
    for row in 0..3 {
        let cells = table_cells(&rt, row, 3);
        let right = cells[2][0] + cells[2][2];
        assert!(
            (table[0] + table[2] - right).abs() <= 2.,
            "row {row}: the last column must end at the table edge, not past it"
        );
    }
    // Rows lay out separately but keep shared column edges.
    let header = table_cells(&rt, 0, 3);
    for row in 1..3 {
        for (cell, top) in table_cells(&rt, row, 3).iter().zip(&header) {
            assert!((cell[0] - top[0]).abs() < 0.5 && (cell[2] - top[2]).abs() < 0.5);
        }
    }
    // The long verdicts wrap within their column instead of running off the edge.
    assert!(rect(&rt, "chat-table-cell-1-2").unwrap()[3] > line);
}
