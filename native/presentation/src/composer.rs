use crate::{array, flag, number, string};
use serde_json::{Value, json};

// Browser selection offsets are UTF-16 code units, not UTF-8 byte positions.
fn units(value: &Value) -> Vec<u16> {
    string(value).encode_utf16().collect()
}
fn whitespace(c: u16) -> bool {
    char::from_u32(c as u32).is_some_and(|c| c.is_whitespace() || c == '\u{feff}')
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

#[derive(Default, serde::Serialize, ts_rs::TS)]
pub struct LinkMetadata {
    pub title: Option<String>,
    pub icon: Option<String>,
}

pub fn user_message(i: &Value) -> Value {
    let message = &i["message"];
    if message["role"] != "user" {
        return Value::Null;
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

#[cfg(test)]
mod decoration_tests {
    use super::*;

    #[test]
    fn skills_never_hide_the_message_or_its_trailing_text() {
        for text in [
            "/debug",
            "/debug please inspect this",
            "Please /debug this issue",
        ] {
            let result = user_message(
                &json!({"message":{"role":"user","content":text},"commands":["debug"]}),
            );
            assert_eq!(result["content"], text);
        }
    }
}
