use crate::{array, flag, number, string};
use serde_json::{Value, json};

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum ComposerConfigKind {
    Provider,
    Model,
    Reasoning,
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct ComposerConfigOption {
    id: String,
    label: String,
}
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ComposerConfigControl {
    id: ComposerConfigKind,
    title: String,
    label: String,
    tooltip: String,
    value: String,
    agent_kind: Option<inferay_core::provider_config::WorkspaceAgentKind>,
    options: Vec<ComposerConfigOption>,
}

/// Project the supplied runtime catalog; providers with no choices omit the control.
pub fn config_controls(input: &Value) -> Vec<ComposerConfigControl> {
    let definition = &input["definition"];
    [
        (
            ComposerConfigKind::Provider,
            "Provider",
            &input["agentKind"],
            &input["agentKindOptions"],
        ),
        (
            ComposerConfigKind::Model,
            "Model",
            &input["model"],
            &definition["models"],
        ),
        (
            ComposerConfigKind::Reasoning,
            "Reasoning",
            &input["reasoningLevel"],
            &definition["reasoningLevels"],
        ),
    ]
    .into_iter()
    .filter_map(|(id, title, value, options)| {
        let provider = matches!(id, ComposerConfigKind::Provider);
        if !provider && array(options).is_empty() {
            return None;
        }
        let selected = array(options).iter().find(|option| option["id"] == *value);
        let full_label = selected
            .map(|option| string(&option["label"]))
            .filter(|label| !label.is_empty())
            .unwrap_or(string(value));
        let full_label = if matches!(id, ComposerConfigKind::Model) && full_label.is_empty() {
            "No model"
        } else {
            full_label
        };
        let label = if provider {
            string(&definition["label"])
        } else if matches!(id, ComposerConfigKind::Model) {
            selected
                .map(|option| string(&option["shortLabel"]))
                .filter(|label| !label.is_empty())
                .unwrap_or(full_label)
        } else {
            full_label
        };
        Some(ComposerConfigControl {
            tooltip: if matches!(id, ComposerConfigKind::Model) {
                full_label
            } else {
                title
            }
            .into(),
            id,
            title: title.into(),
            label: label.into(),
            value: string(value).into(),
            agent_kind: if provider {
                serde_json::from_value(value.clone()).ok()
            } else {
                None
            },
            options: array(options)
                .iter()
                .map(|option| ComposerConfigOption {
                    id: string(&option["id"]).into(),
                    label: string(&option["label"]).into(),
                })
                .collect(),
        })
    })
    .collect()
}

// Browser selection offsets are UTF-16 code units, not UTF-8 byte positions.
fn units(value: &Value) -> Vec<u16> {
    string(value).encode_utf16().collect()
}
fn whitespace(c: u16) -> bool {
    char::from_u32(c as u32).is_some_and(|c| c.is_whitespace() || c == '\u{feff}')
}
fn ascii_letter(c: u16) -> bool {
    (b'a' as u16..=b'z' as u16).contains(&c) || (b'A' as u16..=b'Z' as u16).contains(&c)
}
fn command_char(c: u16) -> bool {
    ascii_letter(c)
        || (b'0' as u16..=b'9' as u16).contains(&c)
        || c == b'_' as u16
        || c == b'-' as u16
}
fn has_command(commands: &Value, name: &str) -> bool {
    array(commands)
        .iter()
        .any(|c| string(c).eq_ignore_ascii_case(name))
}
fn trigger(i: &Value) -> Value {
    let text = units(&i["value"]);
    let cursor = (number(&i["cursorPos"]) as usize).min(text.len());
    let trigger = string(&i["trigger"])
        .encode_utf16()
        .next()
        .unwrap_or_default();
    for index in (0..cursor).rev() {
        if text[index] == trigger {
            return if index == 0 || whitespace(text[index - 1]) {
                json!({"index":index,"query":String::from_utf16_lossy(&text[index+1..cursor])})
            } else {
                Value::Null
            };
        }
        if whitespace(text[index]) {
            break;
        }
    }
    Value::Null
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct CompletionMenuState {
    show: bool,
    selected_idx: usize,
    query: String,
    index: i64,
}

/// Input opens a fresh completion at the browser cursor; hiding retains context.
pub fn menu_input(i: &Value) -> Value {
    let previous = &i["state"];
    let found = trigger(i);
    let next = if found.is_null() {
        let mut hidden = previous.clone();
        hidden["show"] = json!(false);
        hidden
    } else {
        json!(CompletionMenuState {
            show: true,
            selected_idx: 0,
            query: string(&found["query"]).into(),
            index: number(&found["index"]) as i64,
        })
    };
    if next == *previous { Value::Null } else { next }
}

pub fn menu_commands(i: &Value) -> Value {
    let state = &i["state"];
    if !flag(&state["show"]) || number(&state["index"]) < 0. {
        return json!([]);
    }
    let query = string(&state["query"]).to_lowercase();
    json!(
        array(&i["commands"])
            .iter()
            .enumerate()
            .filter_map(|(index, command)| {
                string(&command["name"])
                    .to_lowercase()
                    .starts_with(&query)
                    .then_some(index)
            })
            .collect::<Vec<_>>()
    )
}

fn completion(i: &Value) -> Value {
    let text = units(&i["input"]);
    let cursor = (number(&i["cursorPos"]) as usize).min(text.len());
    let index = (number(&i["triggerIndex"]) as usize).min(text.len());
    let replacement = string(&i["replacement"]);
    let after = String::from_utf16_lossy(&text[cursor..]);
    json!({"nextValue":format!("{}{replacement}{}",String::from_utf16_lossy(&text[..index]),if after.is_empty(){" "}else{&after}),
        "nextCursor":index + replacement.encode_utf16().count() + usize::from(after.is_empty())})
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct DecoratedTextSegment {
    text: String,
    highlighted: bool,
}

pub fn decorated_segments(i: &Value) -> Vec<DecoratedTextSegment> {
    let text = units(&i["text"]);
    let mut segments = Vec::new();
    let mut push = |start, end, highlighted| {
        if start < end {
            segments.push(DecoratedTextSegment {
                text: String::from_utf16_lossy(&text[start..end]),
                highlighted,
            });
        }
    };
    let mut last_end = 0;
    let mut index = 0;
    while index < text.len() {
        if index > 0 && !whitespace(text[index - 1]) {
            index += 1;
            continue;
        }
        let start = index;
        let highlighted = if text[index] == b'/' as u16
            && text.get(index + 1).is_some_and(|c| ascii_letter(*c))
        {
            index += 2;
            while index < text.len() && command_char(text[index]) {
                index += 1;
            }
            has_command(
                &i["commands"],
                &String::from_utf16_lossy(&text[start + 1..index]),
            )
        } else if text[index] == b'@' as u16 && text.get(index + 1).is_some_and(|c| !whitespace(*c))
        {
            index += 2;
            while index < text.len() && !whitespace(text[index]) {
                index += 1;
            }
            true
        } else {
            index += 1;
            false
        };
        if highlighted {
            push(last_end, start, false);
            push(start, index, true);
            last_end = index;
        }
    }
    push(last_end, text.len(), false);
    segments
}
pub fn ask_answer(i: &Value) -> Value {
    let mut parts = Vec::new();
    for (index, question) in array(&i["questions"]).iter().enumerate() {
        let selected = &i["selections"][index.to_string()];
        if array(selected).is_empty() {
            continue;
        }
        let mut indexes: Vec<_> = array(selected).iter().filter_map(Value::as_u64).collect();
        indexes.sort_unstable();
        let labels = indexes
            .iter()
            .filter_map(|n| question["options"][*n as usize]["label"].as_str())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        let header = string(&question["header"]);
        parts.push(if header.is_empty() {
            labels
        } else {
            format!("**{header}**: {labels}")
        });
    }
    json!(parts.join("\n"))
}
pub fn user_message(i: &Value) -> Value {
    let message = &i["message"];
    if message["role"] != "user" {
        return Value::Null;
    }
    let text = string(&message["content"]);
    if let Some(tail) = text.strip_prefix('/') {
        let end = tail.bytes().take_while(|c| command_char(*c as u16)).count();
        if end > 0
            && (end == tail.len() || tail[end..].chars().next().is_some_and(char::is_whitespace))
            && has_command(&i["commands"], &tail[..end])
        {
            return Value::Null;
        }
    }
    json!({"content":message["content"],"imagePaths":if message["images"].is_array(){message["images"].clone()}else{json!([])}})
}
pub fn merge_queue(i: &Value) -> Value {
    let persisted = array(&i["persisted"]);
    let ids: std::collections::HashSet<_> = persisted.iter().map(|m| string(&m["id"])).collect();
    json!(
        persisted
            .iter()
            .chain(
                array(&i["current"])
                    .iter()
                    .filter(|m| flag(&m["transient"]) && !ids.contains(string(&m["id"])))
            )
            .collect::<Vec<_>>()
    )
}

pub fn update_queue(i: &Value, stage: bool) -> Value {
    let id = if stage { &i["message"]["id"] } else { &i["id"] };
    let mut queue: Vec<_> = array(&i["current"])
        .iter()
        .filter(|message| message["id"] != *id)
        .cloned()
        .collect();
    if stage {
        let mut message = i["message"].clone();
        message["transient"] = json!(true);
        queue.push(message);
    }
    json!(queue)
}

fn local_content(content: &str) -> String {
    let units: Vec<_> = content.encode_utf16().collect();
    if units.len() > 256_000 {
        format!(
            "{}\n\n[… pending message truncated for display …]",
            String::from_utf16_lossy(&units[..256_000])
        )
    } else {
        content.to_owned()
    }
}

pub fn system_notice(i: &Value) -> Value {
    let content = local_content(string(&i["content"]));
    let previous = &i["previous"];
    if !content.is_empty()
        && previous["role"] == "system"
        && !flag(&previous["isStreaming"])
        && previous["content"] == content
    {
        return Value::Null;
    }
    let mut message = json!({"id":i["id"],"role":"system","localOnly":true,"content":content});
    if !i["render"].is_null() {
        message["render"] = i["render"].clone();
    }
    message
}

// Prepare one user intent for transport and immediate display. Offsets and the
// display cap use UTF-16 because the renderer edits browser strings.
pub fn prepare_send(i: &Value) -> Value {
    let text = string(&i["text"]).trim_matches(|c| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' |
        '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
    });
    let images = array(&i["images"]);
    if text.is_empty() && images.is_empty() {
        return Value::Null;
    }
    let display = if text.is_empty() && flag(&i["expandCommands"]) {
        format!("Attached image{}", if images.len() > 1 { "s" } else { "" })
    } else {
        text.to_owned()
    };
    let mut request = json!({"type":"chat:send", "paneId":i["paneId"],
        "agentKind":i["agentKind"], "text":text, "displayText":display,
        "images":images, "expandCommands":flag(&i["expandCommands"])});
    for field in ["cwd", "referencePaths"] {
        if !i[field].is_null() {
            request[field] = i[field].clone();
        }
    }
    let optimistic = if flag(&i["isLoading"]) {
        Value::Null
    } else {
        request["messageId"] = i["id"].clone();
        let content = local_content(&display);
        json!({"id":i["id"],"role":"user","optimistic":true,"content":content,"images":images})
    };
    let command = text
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let starts_run = !flag(&i["isLoading"])
        && !matches!(command.as_str(), "/help" | "/clear" | "/exit" | "/btw");
    json!({"request":request,"optimistic":optimistic,"startsRun":starts_run})
}

#[cfg(test)]
mod send_tests {
    use super::*;

    #[test]
    fn completion_menu_resets_selection_for_input_and_retains_hidden_context() {
        let previous = json!({"show":true,"selectedIdx":2,"query":"r","index":3});
        let state =
            menu_input(&json!({"state":previous,"value":"😀 /re","cursorPos":6,"trigger":"/"}));
        assert_eq!(
            state,
            json!({"show":true,"selectedIdx":0,"query":"re","index":3})
        );
        assert!(
            menu_input(&json!({"state":state,"value":"😀 /re","cursorPos":6,"trigger":"/"}))
                .is_null()
        );
        let hidden =
            menu_input(&json!({"state":previous,"value":"plain","cursorPos":5,"trigger":"/"}));
        assert_eq!(
            hidden,
            json!({"show":false,"selectedIdx":2,"query":"r","index":3})
        );
    }

    #[test]
    fn command_menu_filters_case_insensitively_in_source_order() {
        let input = json!({"state":{"show":true,"index":0,"query":"Re"},"commands":[{"name":"review"},{"name":"help"},{"name":"RESET"}]});
        assert_eq!(menu_commands(&input), json!([0, 2]));
        let mut hidden = input;
        hidden["state"]["show"] = json!(false);
        assert_eq!(menu_commands(&hidden), json!([]));
    }

    #[test]
    fn system_notices_suppress_only_completed_nonempty_duplicates() {
        let previous = json!({"role":"system","content":"Stopped"});
        assert!(system_notice(&json!({"content":"Stopped","previous":previous})).is_null());
        let notice = system_notice(
            &json!({"id":"notice","content":"Stopped","render":{"kind":"notice"},
            "previous":{"role":"system","content":"Stopped","isStreaming":true}}),
        );
        assert_eq!(notice["role"], "system");
        assert_eq!(notice["localOnly"], true);
        assert_eq!(notice["render"]["kind"], "notice");
        assert!(
            !system_notice(&json!({"content":"","previous":{"role":"system","content":""}}))
                .is_null()
        );
    }

    #[test]
    fn send_intent_preserves_request_and_optimistic_semantics() {
        let context = json!({"id":"local-1", "paneId":"pane", "agentKind":"codex",
            "cwd":"/repo", "referencePaths":["/reference"], "text":" \u{feff}hello\n "});
        let prepared = prepare_send(&context);
        assert_eq!(prepared["request"]["text"], "hello");
        assert_eq!(prepared["request"]["cwd"], "/repo");
        assert_eq!(prepared["request"]["messageId"], "local-1");
        assert_eq!(prepared["optimistic"]["content"], "hello");
        assert_eq!(prepare_send(&json!({"text":" \u{feff}\n"})), Value::Null);
        let image = prepare_send(
            &json!({"text":"", "images":["a.png","b.png"], "expandCommands":true, "isLoading":true}),
        );
        assert_eq!(image["request"]["displayText"], "Attached images");
        assert!(image["request"].get("messageId").is_none());
        assert!(image["optimistic"].is_null());
        assert_eq!(image["request"]["images"], json!(["a.png", "b.png"]));
        // U+0085 is not ECMAScript whitespace.
        assert_eq!(
            prepare_send(&json!({"text":"\u{0085}"}))["request"]["text"],
            "\u{0085}"
        );
        let long = "😀".repeat(128_001);
        let model = prepare_send(&json!({"text":long}));
        assert_eq!(model["request"]["text"], long);
        assert!(
            model["optimistic"]["content"]
                .as_str()
                .unwrap()
                .ends_with("[… pending message truncated for display …]")
        );
    }
}

/// Both file and command picks replace the active trigger through the same operation.
pub fn select_completion(input: &Value) -> Value {
    let Some(item) = array(&input["items"]).get(number(&input["index"]) as usize) else {
        return Value::Null;
    };
    let command = input["kind"] == "command";
    let replacement = format!(
        "{}{}",
        if command { "/" } else { "@" },
        string(&item[if command { "name" } else { "path" }])
    );
    completion(
        &json!({"input":input["input"],"cursorPos":input["cursorPos"],"triggerIndex":input["menu"]["index"],"replacement":replacement}),
    )
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum CompletionMenuKind {
    File,
    Command,
}
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatKeyAction {
    Move {
        menu: CompletionMenuKind,
        delta: i32,
        count: usize,
    },
    Select {
        menu: CompletionMenuKind,
        index: usize,
    },
    Hide {
        menu: CompletionMenuKind,
    },
    Send,
    Consume,
}
/// Route both completion menus and send shortcuts without touching browser events.
pub fn input_key(input: &Value) -> Option<ChatKeyAction> {
    if flag(&input["composing"]) || input["keyCode"] == 229 {
        return None;
    }
    let key = string(&input["key"]);
    for (menu, state, count) in [
        (
            CompletionMenuKind::File,
            &input["file"],
            number(&input["files"]) as usize,
        ),
        (
            CompletionMenuKind::Command,
            &input["command"],
            number(&input["commands"]) as usize,
        ),
    ] {
        if !flag(&state["show"]) || count == 0 {
            continue;
        }
        match key {
            "ArrowDown" | "ArrowUp" => {
                return Some(ChatKeyAction::Move {
                    menu,
                    delta: if key == "ArrowDown" { 1 } else { -1 },
                    count,
                });
            }
            "Tab" | "Enter" if key == "Tab" || !flag(&input["shift"]) => {
                return Some(ChatKeyAction::Select {
                    menu,
                    index: number(&state["selectedIdx"]) as usize,
                });
            }
            "Escape" => return Some(ChatKeyAction::Hide { menu }),
            _ => {}
        }
    }
    (key == "Enter" && !flag(&input["shift"])).then(|| {
        if flag(&input["repeat"]) {
            ChatKeyAction::Consume
        } else {
            ChatKeyAction::Send
        }
    })
}
pub fn menu_step(input: &Value) -> Value {
    let mut state = input["state"].clone();
    let count = input["count"].as_i64().unwrap_or(0);
    if count > 0 {
        state["selectedIdx"] = json!(
            (number(&state["selectedIdx"]) as i64 + input["delta"].as_i64().unwrap_or(0))
                .rem_euclid(count)
        );
    }
    state
}
