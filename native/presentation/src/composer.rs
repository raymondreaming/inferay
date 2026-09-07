use crate::{array, flag, number, string};
use serde_json::{Value, json};

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
pub fn trigger(i: &Value) -> Value {
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
pub fn completion(i: &Value) -> Value {
    let text = units(&i["input"]);
    let cursor = (number(&i["cursorPos"]) as usize).min(text.len());
    let index = (number(&i["triggerIndex"]) as usize).min(text.len());
    let replacement = string(&i["replacement"]);
    let after = String::from_utf16_lossy(&text[cursor..]);
    json!({"nextValue":format!("{}{replacement}{}",String::from_utf16_lossy(&text[..index]),if after.is_empty(){" "}else{&after}),
        "nextCursor":index + replacement.encode_utf16().count() + usize::from(after.is_empty())})
}
pub fn decorated_tokens(i: &Value) -> Value {
    let text = units(&i["text"]);
    let mut ranges = Vec::new();
    let mut index = 0;
    while index < text.len() {
        if index > 0 && !whitespace(text[index - 1]) {
            index += 1;
            continue;
        }
        let start = index;
        if text[index] == b'/' as u16 && text.get(index + 1).is_some_and(|c| ascii_letter(*c)) {
            index += 2;
            while index < text.len() && command_char(text[index]) {
                index += 1;
            }
            if has_command(
                &i["commands"],
                &String::from_utf16_lossy(&text[start + 1..index]),
            ) {
                ranges.push(json!({"start":start,"end":index}));
            }
        } else if text[index] == b'@' as u16 && text.get(index + 1).is_some_and(|c| !whitespace(*c))
        {
            index += 2;
            while index < text.len() && !whitespace(text[index]) {
                index += 1;
            }
            ranges.push(json!({"start":start,"end":index}));
        } else {
            index += 1;
        }
    }
    json!(ranges)
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
