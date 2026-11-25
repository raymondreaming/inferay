use super::*;
use crate::task::testing::serial;
use inferay_core::chat_protocol::{ChatMessageBuffer, ChatTranscriptMessage};
use inferay_core::chat_status::ChatRunStatus;
use rune::{Cx, Env, Mods, Runtime};
use serde_json::json;

fn view(s: &Workspace, _: &mut Cx<Workspace>) -> El {
    crate::zoom::apply(s.zoom);
    col()
        .w_full()
        .h_full()
        .instant_changes()
        .child(s.transcript(0))
}

fn runtime(state: Workspace, size: (f32, f32)) -> Runtime<Workspace> {
    let mut rt = Runtime::new(state, view, size, Env::new(false, 1.));
    settle(&mut rt);
    rt
}

fn settle(rt: &mut Runtime<Workspace>) {
    for _ in 0..4 {
        rt.frame(1. / 60.);
    }
}

fn rect(rt: &Runtime<Workspace>, key: &str) -> Option<[f32; 4]> {
    rt.elements()
        .into_iter()
        .find(|e| {
            !e.exiting
                && (e.key.as_deref() == Some(key) || (key.contains('/') && e.path.ends_with(key)))
        })
        .map(|e| e.rect)
}

fn bounds(rt: &Runtime<Workspace>, key: &str) -> [f32; 4] {
    rect(rt, key).unwrap_or_else(|| panic!("no element {key}"))
}

fn center(r: [f32; 4]) -> (f32, f32) {
    (r[0] + r[2] / 2., r[1] + r[3] / 2.)
}

fn click(rt: &mut Runtime<Workspace>, key: &str) {
    let (x, y) = center(bounds(rt, key));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    settle(rt);
}

fn press(rt: &mut Runtime<Workspace>, key: rune::Key) {
    rt.key(rune::KeyEvent {
        key,
        mods: Mods::default(),
    });
    settle(rt);
}

fn publish(state: &mut Workspace, messages: &[ChatTranscriptMessage]) {
    state.conversations[0].transcript.publish(
        crate::transcript::PreparedTranscript::prepare(
            0,
            messages.iter().cloned().map(std::sync::Arc::new),
            "vscode-black",
        ),
        None,
    );
}

fn workspace() -> Workspace {
    let mut state = Workspace::empty();
    state.status.clear();
    state.conversations[0].loaded = true;
    state
}

fn messages(values: impl IntoIterator<Item = serde_json::Value>) -> Vec<ChatTranscriptMessage> {
    let mut buffer = ChatMessageBuffer::default();
    buffer.replace_messages(
        values
            .into_iter()
            .map(|v| serde_json::from_value(v).unwrap())
            .collect(),
    );
    buffer.messages().to_vec()
}

fn set_zoom(rt: &mut Runtime<Workspace>, zoom: &str) {
    let zoom = crate::zoom::Zoom::restore(Some(zoom));
    rt.update(move |s, _| s.zoom = zoom);
    settle(rt);
}

fn attachment_photos() -> (tempfile::TempDir, Vec<std::path::PathBuf>) {
    let directory = tempfile::tempdir().unwrap();
    let paths = [("portrait.png", 16, 512), ("landscape.png", 512, 16)]
        .into_iter()
        .map(|(name, width, height)| {
            let path = directory.path().join(name);
            image::RgbaImage::from_pixel(width, height, image::Rgba([145, 120, 190, 255]))
                .save(&path)
                .unwrap();
            path
        })
        .collect();
    (directory, paths)
}

#[test]
fn sent_photos_reserve_space_above_text_before_and_after_loading() {
    let _serial = serial();
    let (_directory, photos) = attachment_photos();
    let mut state = workspace();
    publish(
        &mut state,
        &messages([
            json!({"id":"photos", "role":"user", "images":photos, "content":"This text stays below the photos.\n".repeat(6)}),
            json!({"id":"reply", "role":"assistant", "content":"A reply follows the complete message."}),
            json!({"id":"plain", "role":"user", "content":"This ordinary message must use the available width."}),
        ]),
    );
    let mut rt = runtime(state, (900., 1000.));
    for zoom in ["50", "100", "200"] {
        set_zoom(&mut rt, zoom);
        for _ in 0..2 {
            let images = bounds(&rt, "user-images-photos");
            let text = bounds(&rt, "user-message-text-photos");
            let bubble = bounds(&rt, "user-bubble-photos");
            let scale = zoom.parse::<f32>().unwrap() / 100.;
            let plain = bounds(&rt, "user-bubble-plain");
            assert!(
                plain[2] >= 100. * scale,
                "text-only bubble collapsed at {zoom}%: {plain:?}"
            );
            assert!(text[1] >= images[1] + images[3] + 8. * scale - 1.);
            assert!(bubble[1] + bubble[3] >= text[1] + text[3]);
            for key in ["sent-photo-photos-0", "sent-photo-photos-1"] {
                let photo = bounds(&rt, key);
                assert!((photo[3] - 124. * scale).abs() < 1., "{key} {photo:?}");
                assert!(photo[0] + photo[2] <= images[0] + images[2] + 1.);
                assert!(photo[1] + photo[3] <= images[1] + images[3] + 1.);
            }
            assert!(bounds(&rt, &row_key(0, "reply"))[1] >= bubble[1] + bubble[3]);
            for path in &photos {
                let _ = crate::workspace::attachments::image(path).wait();
            }
            settle(&mut rt);
        }
    }
}

#[test]
fn progress_steps_nest_tools_and_keep_reopened_history_visible() {
    let _serial = serial();
    let mut state = workspace();
    let mut buffer = ChatMessageBuffer::default();
    buffer.apply_event(&json!({"type":"inferay.progress","id":"codex-summary:first","text":"**Inspecting field options**"}));
    buffer.apply_event(&json!({"type":"inferay.tool","id":"read","name":"Read","input":{"file_path":"schema.ts"},"output":"fields","done":true}));
    buffer.apply_event(&json!({"type":"inferay.progress","id":"codex-summary:second","text":"**Testing validation coverage**"}));
    buffer.apply_event(&json!({"type":"inferay.tool","id":"test","name":"exec_command","input":{"cmd":"cargo test"},"output":"passed","done":true}));
    state.conversations[0].run.begin(1);
    publish(&mut state, buffer.messages());
    let mut rt = runtime(state, (1100., 900.));
    assert!(rect(&rt, "tool-dot-read").is_none());
    let parent = bounds(&rt, "step-dot-codex-summary:second");
    let child = bounds(&rt, "tool-dot-test");
    assert!(child[0] > parent[0] + parent[2]);
    click(&mut rt, "step-header-codex-summary:first");
    assert!(rect(&rt, "tool-dot-read").is_some());
    press(&mut rt, rune::Key::Enter);
    assert!(rect(&rt, "tool-dot-read").is_none());
    press(&mut rt, rune::Key::Text(" ".into()));
    assert!(rect(&rt, "tool-dot-read").is_some());
    rt.update(|s, _| s.conversations[0].run = ChatRunStatus::default());
    settle(&mut rt);
    assert!(rect(&rt, "tool-dot-read").is_none());
    click(&mut rt, "activity-header-codex-summary:first");
    for zoom in ["100", "200"] {
        set_zoom(&mut rt, zoom);
        assert!(rect(&rt, "tool-dot-read").is_some());
        assert!(rect(&rt, "tool-dot-test").is_none());
        let parent = bounds(&rt, "step-dot-codex-summary:first");
        let child = bounds(&rt, "tool-dot-read");
        let line = bounds(&rt, "step-line-codex-summary:first");
        assert!(child[0] > parent[0] + parent[2]);
        assert!(
            (line[1] - (parent[1] + parent[3] / 2.)).abs() < 2.,
            "{line:?} {parent:?}"
        );
    }
}

#[test]
fn lifecycle_hooks_have_no_rows_or_details_even_if_previously_expanded() {
    let _serial = serial();
    let mut state = workspace();
    let events = [
        "sessionStart",
        "userPromptSubmit",
        "preToolUse",
        "postToolUse",
        "stop",
    ];
    for event in events {
        state.expanded.insert(format!("hook:turn:{event}"));
    }
    let mut buffer = ChatMessageBuffer::default();
    buffer.replace_messages(vec![
        serde_json::from_value(
            json!({"id":"answer","role":"assistant","content":"The answer remains visible."}),
        )
        .unwrap(),
    ]);
    for event in events {
        buffer.apply_event(&json!({"type":"inferay.tool","id":format!("hook:turn:{event}"),"name":format!("{event} hook"),"input":{"event":event},"output":"completed","done":true}));
    }
    publish(&mut state, buffer.messages());
    let rt = runtime(state, (900., 700.));
    assert!(rect(&rt, "tool-timeline-row").is_none());
    let transcript = &rt.state.conversations[0].transcript;
    assert_eq!(transcript.rows().len(), 6);
    assert_eq!(transcript.last_visible(), Some(0));
    for event in events {
        if let Some(row) = rect(&rt, &row_key(0, &format!("hook:turn:{event}"))) {
            assert_eq!(row[3], 0.);
        }
    }
}

#[test]
fn tool_connectors_join_dot_centers_across_hidden_and_expanded_rows() {
    let _serial = serial();
    let mut state = workspace();
    let list = messages([
        json!({"id":"first","role":"tool","toolName":"exec_command","content":"{\"cmd\":\"echo one\"}\none"}),
        json!({"id":"hidden","role":"tool","toolName":"exec_command","content":"{\"cmd\":\"echo one\"}\none"}),
        json!({"id":"second","role":"tool","toolName":"Read","content":"{\"file_path\":\"main.rs\"}\nlet value = 1;"}),
        json!({"id":"note","role":"system","content":"**Next step**"}),
        json!({"id":"separate","role":"tool","toolName":"Read","content":"{\"file_path\":\"other.rs\"}\nlet value = 2;"}),
    ]);
    assert!(list[1].render.as_ref().unwrap().hidden);
    publish(&mut state, &list);
    state.conversations[0].transcript.toggle_activity(0, false);
    let mut rt = runtime(state, (1100., 1000.));
    for zoom in ["100", "200"] {
        for expanded in [false, true] {
            set_zoom(&mut rt, zoom);
            rt.update(move |s, _| {
                if expanded {
                    s.expanded.insert("first".into());
                } else {
                    s.expanded.remove("first");
                }
            });
            settle(&mut rt);
            let first = center(bounds(&rt, "tool-dot-first"));
            let second = center(bounds(&rt, "tool-dot-second"));
            let outgoing = bounds(&rt, "tool-line-after-first");
            let incoming = bounds(&rt, "tool-line-before-second");
            assert!((first.0 - second.0).abs() < 1.);
            assert!((center(outgoing).0 - first.0).abs() < 1.);
            assert!((outgoing[1] - first.1).abs() < 1.);
            assert!((outgoing[1] + outgoing[3] - incoming[1]).abs() < 1.);
            assert!((incoming[1] + incoming[3] - second.1).abs() < 1.);
            assert!(rect(&rt, "tool-line-before-first").is_none());
            assert!(rect(&rt, "tool-dot-hidden").is_none());
            assert!(rect(&rt, "tool-line-after-second").is_none());
            assert!(rect(&rt, "tool-line-before-separate").is_none());
        }
    }
}

#[test]
fn timeline_connects_tools_steps_and_nested_edits_across_invisible_rows() {
    let _serial = serial();
    let mut state = workspace();
    publish(
        &mut state,
        &messages([
            json!({"id":"lead","role":"tool","toolName":"Read","content":"{\"file_path\":\"main.rs\"}\nsource"}),
            json!({"id":"hook:pre","role":"tool","toolName":"preToolUse hook","content":"{}"}),
            json!({"id":"codex-summary:one","role":"system","content":"Inspecting fields"}),
            json!({"id":"empty","role":"assistant","content":""}),
            json!({"id":"codex-summary:two","role":"system","content":"Updating fields"}),
            json!({"id":"nested-read","role":"tool","toolName":"Read","content":"{\"file_path\":\"schema.rs\"}\nfields"}),
            json!({"id":"nested-edit","role":"tool","toolName":"Edit","content":"{\"file_path\":\"schema.rs\",\"old_string\":\"old\",\"new_string\":\"new\"}"}),
            json!({"id":"hook:post","role":"tool","toolName":"postToolUse hook","content":"{}"}),
            json!({"id":"codex-summary:three","role":"system","content":"Checking changes"}),
            json!({"id":"answer","role":"assistant","content":"The final answer stays separate."}),
            json!({"id":"separate","role":"tool","toolName":"Read","content":"{\"file_path\":\"next.rs\"}"}),
        ]),
    );
    state.conversations[0].transcript.toggle_step(4, false);
    state.conversations[0].transcript.toggle_activity(0, false);
    let mut rt = runtime(state, (1100., 1400.));
    for zoom in ["50", "100", "200"] {
        for expanded in [false, true] {
            set_zoom(&mut rt, zoom);
            rt.update(move |s, _| {
                if expanded {
                    s.expanded.insert("lead".into());
                } else {
                    s.expanded.remove("lead");
                }
            });
            settle(&mut rt);
            for (outgoing, incoming) in [
                ("tool-line-after-lead", "step-line-before-codex-summary:one"),
                (
                    "step-line-codex-summary:one",
                    "step-line-before-codex-summary:two",
                ),
                ("step-line-codex-summary:two", "step-line-nested-read"),
                ("step-line-nested-read", "step-line-nested-edit"),
                (
                    "step-line-nested-edit",
                    "step-line-before-codex-summary:three",
                ),
                (
                    "tool-line-after-nested-read",
                    "tool-line-before-nested-edit",
                ),
            ] {
                let out = bounds(&rt, outgoing);
                let inc = bounds(&rt, incoming);
                assert!(
                    (center(out).0 - center(inc).0).abs() < 1.,
                    "{outgoing} {incoming} at {zoom}"
                );
                assert!(
                    (out[1] + out[3] - inc[1]).abs() < 1.,
                    "{outgoing} {out:?} {incoming} {inc:?} at {zoom}"
                );
            }
            assert!(rect(&rt, "step-line-codex-summary:three").is_none());
            assert!(rect(&rt, "tool-line-before-separate").is_none());
            assert_eq!(bounds(&rt, &row_key(0, "empty"))[3], 0.);
            assert_eq!(
                rt.state.conversations[0].transcript.step(4).unwrap().tools,
                2
            );
        }
    }
}

#[test]
fn connector_timeline_is_visible_while_running_and_expands() {
    let _serial = serial();
    let mut state = workspace();
    let mut buffer = ChatMessageBuffer::default();
    buffer.apply_event(&json!({"type":"inferay.tool","id":"live-tool","name":"mcp__github__list_issues","input":{"repo":"example"},"done":false}));
    state.conversations[0].run.is_loading = true;
    state.conversations[0].run.status = "tool:mcp__github__list_issues".into();
    publish(&mut state, buffer.messages());
    let mut rt = runtime(state, (800., 560.));
    let row = bounds(&rt, "tool-timeline-row");
    assert!(row[3] >= 24. && row[3] <= 30.);
    assert!(rect(&rt, "tool-source").is_some());
    assert!(rect(&rt, "tool-details-live-tool").is_none());
    click(&mut rt, "tool-timeline-row");
    assert!(rt.state.expanded.contains("live-tool"));
    assert!(rect(&rt, "tool-details-live-tool").is_some());
    click(&mut rt, "tool-timeline-row");
    assert!(rect(&rt, "tool-details-live-tool").is_none());
    rt.update(|s, _| {
        let mut buffer = ChatMessageBuffer::default();
        buffer.apply_event(&json!({"type":"inferay.tool","id":"live-tool","name":"mcp__github__list_issues","input":{"repo":"example"},"output":"result line\n".repeat(3),"done":true}));
        publish(s, buffer.messages());
    });
    settle(&mut rt);
    assert!(rect(&rt, "tool-details-live-tool").is_none());
    assert!(bounds(&rt, "tool-timeline-row")[3] <= 30.);
    click(&mut rt, "tool-timeline-row");
    assert!(rect(&rt, "tool-details-live-tool").is_some());
}

#[test]
fn restored_edit_details_are_closed_until_clicked() {
    let _serial = serial();
    let mut state = workspace();
    publish(
        &mut state,
        &messages([
            json!({"id":"edit", "role":"tool", "toolName":"Edit", "content":"{\"file_path\":\"main.rs\",\"old_string\":\"old\",\"new_string\":\"new\"}"}),
        ]),
    );
    let mut rt = runtime(state, (800., 560.));
    assert!(rect(&rt, "tool-edit-card").is_none());
    assert!(rect(&rt, "tool-timeline-row").is_none());
    click(&mut rt, "activity-header-edit");
    assert!(rect(&rt, "tool-edit-card").is_none());
    click(&mut rt, "tool-timeline-row");
    assert!(rect(&rt, "tool-edit-card").is_some());
}

#[test]
fn latest_message_button_appears_only_away_from_the_tail() {
    let _serial = serial();
    let mut state = workspace();
    publish(&mut state, &(0..200)
        .map(|i| serde_json::from_value(json!({"id":format!("row-{i}"),"role":"assistant","content":"A long conversation keeps its composer visible.\n\nThis paragraph wraps as the pane becomes narrower."})).unwrap())
        .collect::<Vec<_>>());
    let mut rt = runtime(state, (800., 560.));
    assert!(rect(&rt, "latest-message").is_none());
    assert!(rect(&rt, &row_key(0, "row-199")).is_some());
    assert!(rect(&rt, &row_key(0, "row-0")).is_none());
    rt.update(|_, tx| tx.scroll_to_y(transcript_key(0), 0.));
    settle(&mut rt);
    assert!(rect(&rt, &row_key(0, "row-0")).is_some());
    let latest = bounds(&rt, "latest-message");
    let pane = bounds(&rt, "transcript-pane-0");
    assert!((pane[0] + pane[2] - (latest[0] + latest[2]) - 8.).abs() < 1.);
    click(&mut rt, "latest-message");
    for _ in 0..60 {
        rt.frame(1. / 60.);
    }
    assert!(rect(&rt, "latest-message").is_none());
    assert!(rect(&rt, &row_key(0, "row-199")).is_some());
}

#[test]
fn first_live_messages_are_visible_after_an_empty_transcript() {
    let _serial = serial();
    let mut rt = runtime(workspace(), (1024., 768.));
    assert!(rect(&rt, &transcript_key(0)).is_some());
    rt.update(|s, _| {
        publish(
            s,
            &messages([json!({"id":"help", "role":"system", "content":"Available commands"})]),
        )
    });
    settle(&mut rt);
    assert!(bounds(&rt, &transcript_key(0))[3] > 100.);
    assert!(rect(&rt, &row_key(0, "help")).is_some());
}

#[test]
fn history_rail_outlines_turns_and_jumps_to_earlier_prompts() {
    let _serial = serial();
    let mut state = workspace();
    let rows = messages((0..30).flat_map(|i| {
        [
            json!({"id":format!("prompt-{i}"),"role":"user","content":format!("Prompt number {i}\nMore detail")}),
            json!({"id":format!("read-{i}"),"role":"tool","toolName":"Read","content":"source"}),
            json!({"id":format!("answer-{i}"),"role":"assistant","content":format!("## Answer {i}\n\nA paragraph long enough to take real vertical space in the transcript.")}),
        ]
    }));
    publish(&mut state, &rows);
    let mut rt = runtime(state, (800., 560.));
    assert!(rect(&rt, &row_key(0, "prompt-0")).is_none());
    assert!(rect(&rt, "history-outline-0").is_none());
    let (x, y) = center(bounds(&rt, "history-tick-59"));
    rt.pointer_move(x, y);
    for _ in 0..30 {
        rt.frame(1. / 60.);
    }
    assert!(rect(&rt, "history-outline-0").is_some());
    let labels: Vec<_> = rt
        .elements()
        .into_iter()
        .filter_map(|e| e.label.clone())
        .collect();
    assert!(
        labels
            .iter()
            .any(|label| label == "Prompt: Prompt number 0")
    );
    assert!(labels.iter().any(|label| label == "Answer: Answer 29"));
    assert!(
        rt.elements()
            .into_iter()
            .any(|e| e.text.as_deref() == Some("30 turns"))
    );
    assert!(
        rt.elements()
            .into_iter()
            .any(|e| e.text.as_deref() == Some("· 30 steps"))
    );
    rt.update(|_, tx| tx.scroll_to_y("history-outline-0", 0.));
    settle(&mut rt);
    click(&mut rt, "history-entry-0-0");
    for _ in 0..90 {
        rt.frame(1. / 60.);
    }
    assert!(rect(&rt, &row_key(0, "prompt-0")).is_some());
    assert_eq!(rt.state.conversations[0].history_at, 0);
    rt.pointer_move(700., 300.);
    for _ in 0..30 {
        rt.frame(1. / 60.);
    }
    assert!(rect(&rt, "history-outline-0").is_none());
}
