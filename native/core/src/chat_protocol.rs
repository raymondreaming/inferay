use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const CHAT_MESSAGE_RETAIN_LIMIT: usize = 5_000;
pub const CHAT_MESSAGE_CHAR_LIMIT: usize = 1_000_000;
pub const CHAT_SINGLE_MESSAGE_CHAR_LIMIT: usize = 256_000;
pub const CHAT_TRUNCATION_MARKER: &str =
    "\n\n[… content truncated to keep Inferay responsive …]\n\n";

static SERVER_MESSAGE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChatTranscriptMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(rename = "toolName", skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(rename = "isStreaming", skip_serializing_if = "Option::is_none")]
    pub is_streaming: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl ChatTranscriptMessage {
    fn new(role: &str, content: &str) -> Self {
        Self {
            id: format!("s{}", SERVER_MESSAGE_ID.fetch_add(1, Ordering::Relaxed) + 1),
            role: role.to_string(),
            content: truncate_chat_content(content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT),
            images: None,
            tool_name: None,
            is_streaming: None,
            extra: Map::new(),
        }
    }
}

#[derive(Default)]
pub struct ChatMessageBuffer {
    messages: Vec<ChatTranscriptMessage>,
    current_assistant_index: Option<usize>,
    last_assistant_index: Option<usize>,
    current_tool_index: Option<usize>,
    has_streamed: bool,
    revision: u64,
}

impl ChatMessageBuffer {
    pub fn push_user(&mut self, text: &str, images: Option<Vec<String>>) {
        let mut message = ChatTranscriptMessage::new("user", text);
        message.images = images.filter(|images| !images.is_empty());
        self.push(message);
    }

    pub fn push_system(&mut self, text: &str) {
        self.push(ChatTranscriptMessage::new("system", text));
    }

    pub fn apply_event(&mut self, event: &Value) {
        let Some(event_type) = event.get("type").and_then(Value::as_str) else {
            return;
        };
        if !matches!(
            event_type,
            "assistant"
                | "content_block_start"
                | "content_block_delta"
                | "content_block_stop"
                | "result"
        ) {
            return;
        }
        match event_type {
            "assistant" => self.apply_assistant_event(event),
            "content_block_start" => self.apply_block_start(event),
            "content_block_delta" => self.apply_block_delta(event),
            "content_block_stop" => {
                self.patch_streaming(self.current_assistant_index, false);
                self.patch_streaming(self.current_tool_index, false);
                self.current_assistant_index = None;
                self.current_tool_index = None;
            }
            "result" => self.apply_result(event),
            _ => unreachable!(),
        }
        self.trim();
    }

    pub fn finalize(&mut self) {
        let mut changed = false;
        for message in &mut self.messages {
            if message.is_streaming == Some(true) {
                changed = true;
            }
            message.is_streaming = Some(false);
        }
        self.current_assistant_index = None;
        self.last_assistant_index = None;
        self.current_tool_index = None;
        self.has_streamed = false;
        if changed {
            self.revision += 1;
        }
        self.trim();
    }

    pub fn replace_messages(&mut self, messages: Vec<ChatTranscriptMessage>) {
        self.messages = messages
            .into_iter()
            .map(|mut message| {
                message.is_streaming = Some(false);
                message
            })
            .collect();
        self.current_assistant_index = None;
        self.last_assistant_index = None;
        self.current_tool_index = None;
        self.has_streamed = false;
        self.revision += 1;
        self.trim();
    }

    pub fn replace_in_assistant_messages(&mut self, mut replacer: impl FnMut(&str) -> String) {
        for message in &mut self.messages {
            if message.role != "assistant" {
                continue;
            }
            let next = replacer(&message.content);
            if next == message.content {
                continue;
            }
            message.content = truncate_chat_content(&next, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
            self.revision += 1;
        }
    }

    pub fn messages(&self) -> &[ChatTranscriptMessage] {
        &self.messages
    }

    pub fn into_messages(self) -> Vec<ChatTranscriptMessage> {
        self.messages
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn streaming(&self) -> bool {
        self.current_assistant_index.is_some() || self.current_tool_index.is_some()
    }

    fn apply_assistant_event(&mut self, event: &Value) {
        let Some(message) = event.get("message") else {
            return;
        };
        let Some(content) = message.get("content").and_then(Value::as_array) else {
            return;
        };
        if self.has_streamed {
            return;
        }
        let is_streaming = !javascript_truthy(message.get("stop_reason").unwrap_or(&Value::Null));
        for block in content {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let Some(text) = block.get("text").and_then(Value::as_str) else {
                        continue;
                    };
                    if text.is_empty() {
                        continue;
                    }
                    if let Some(index) = self.current_assistant_index
                        && let Some(message) = self.messages.get_mut(index)
                    {
                        message.content =
                            truncate_chat_content(text, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
                        message.is_streaming = Some(is_streaming);
                        self.revision += 1;
                        self.last_assistant_index = self.current_assistant_index;
                    } else {
                        self.append_assistant(text, is_streaming);
                    }
                }
                Some("tool_use") => {
                    let name = block
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    self.append_tool(name, &stringify_tool_input(block.get("input")));
                }
                _ => {}
            }
        }
    }

    fn apply_block_start(&mut self, event: &Value) {
        self.has_streamed = true;
        let Some(block) = event.get("content_block") else {
            return;
        };
        match block.get("type").and_then(Value::as_str) {
            Some("text") => self.append_assistant(
                block
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                true,
            ),
            Some("tool_use") => {
                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.append_tool(name, &stringify_tool_input(block.get("input")));
            }
            _ => {}
        }
    }

    fn apply_block_delta(&mut self, event: &Value) {
        let Some(delta) = event.get("delta") else {
            return;
        };
        match delta.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                let Some(text) = delta.get("text").and_then(Value::as_str) else {
                    return;
                };
                if text.is_empty() {
                    return;
                }
                let Some(index) = self.current_assistant_index else {
                    return;
                };
                let Some(message) = self.messages.get_mut(index) else {
                    return;
                };
                message.content = append_bounded_chat_content(
                    &message.content,
                    text,
                    CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                );
                self.revision += 1;
            }
            Some("input_json_delta") => {
                let Some(text) = delta.get("partial_json").and_then(Value::as_str) else {
                    return;
                };
                if text.is_empty() {
                    return;
                }
                let Some(index) = self.current_tool_index else {
                    return;
                };
                let Some(message) = self.messages.get_mut(index) else {
                    return;
                };
                message.content = append_bounded_chat_content(
                    &message.content,
                    text,
                    CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                );
                self.revision += 1;
            }
            _ => {}
        }
    }

    fn apply_result(&mut self, event: &Value) {
        let Some(result) = event.get("result").and_then(Value::as_str) else {
            return;
        };
        if result.is_empty() {
            return;
        }
        let assistant_index = self
            .current_assistant_index
            .or(self.last_assistant_index)
            .filter(|index| *index < self.messages.len());
        if let Some(index) = assistant_index {
            let message = &mut self.messages[index];
            message.content = truncate_chat_content(result, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
            message.is_streaming = Some(false);
            self.revision += 1;
            self.current_assistant_index = None;
            self.last_assistant_index = None;
        } else {
            self.push(ChatTranscriptMessage::new("assistant", result));
        }
    }

    fn append_assistant(&mut self, content: &str, is_streaming: bool) {
        self.current_assistant_index = Some(self.messages.len());
        self.last_assistant_index = self.current_assistant_index;
        let mut message = ChatTranscriptMessage::new("assistant", content);
        message.is_streaming = Some(is_streaming);
        self.push(message);
    }

    fn append_tool(&mut self, name: &str, content: &str) {
        self.current_assistant_index = None;
        self.current_tool_index = Some(self.messages.len());
        let mut message = ChatTranscriptMessage::new("tool", content);
        message.tool_name = Some(name.to_string());
        message.is_streaming = Some(true);
        self.push(message);
    }

    fn patch_streaming(&mut self, index: Option<usize>, value: bool) -> bool {
        let Some(index) = index else { return false };
        let Some(message) = self.messages.get_mut(index) else {
            return false;
        };
        message.is_streaming = Some(value);
        self.revision += 1;
        true
    }

    fn push(&mut self, message: ChatTranscriptMessage) {
        self.messages.push(message);
        self.revision += 1;
        self.trim();
    }

    fn trim(&mut self) {
        let previous_length = self.messages.len();
        trim_messages(&mut self.messages);
        let dropped = previous_length - self.messages.len();
        if dropped == 0 {
            return;
        }
        self.revision += 1;
        self.current_assistant_index = adjusted_index(self.current_assistant_index, dropped);
        self.last_assistant_index = adjusted_index(self.last_assistant_index, dropped);
        self.current_tool_index = adjusted_index(self.current_tool_index, dropped);
    }
}

pub fn is_valid_chat_transcript(value: &Value) -> bool {
    value.as_array().is_some_and(|messages| {
        messages.iter().all(|message| {
            let Some(message) = message.as_object() else {
                return false;
            };
            message.get("id").is_some_and(Value::is_string)
                && message
                    .get("role")
                    .and_then(Value::as_str)
                    .is_some_and(|role| matches!(role, "user" | "assistant" | "tool" | "system"))
                && message.get("content").is_some_and(Value::is_string)
                && message.get("images").is_none_or(|images| {
                    images
                        .as_array()
                        .is_some_and(|images| images.iter().all(Value::is_string))
                })
        })
    })
}

pub fn parse_chat_transcript(value: Value) -> Option<Vec<ChatTranscriptMessage>> {
    if !is_valid_chat_transcript(&value) {
        return None;
    }
    let mut messages = serde_json::from_value::<Vec<ChatTranscriptMessage>>(value).ok()?;
    trim_messages(&mut messages);
    Some(messages)
}

pub fn trim_messages(messages: &mut Vec<ChatTranscriptMessage>) {
    if messages.len() > CHAT_MESSAGE_RETAIN_LIMIT {
        messages.drain(..messages.len() - CHAT_MESSAGE_RETAIN_LIMIT);
    }
    for message in messages.iter_mut() {
        message.content = truncate_chat_content(&message.content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
    }
    let mut total_chars = messages
        .iter()
        .map(|message| javascript_length(&message.content))
        .sum::<usize>();
    let mut dropped = 0;
    while total_chars > CHAT_MESSAGE_CHAR_LIMIT && messages.len() - dropped > 1 {
        total_chars -= javascript_length(&messages[dropped].content);
        dropped += 1;
    }
    if dropped > 0 {
        messages.drain(..dropped);
    }
}

pub fn truncate_chat_content(content: &str, max_chars: usize) -> String {
    let length = javascript_length(content);
    if length <= max_chars {
        return content.to_string();
    }
    let marker_length = javascript_length(CHAT_TRUNCATION_MARKER);
    if max_chars <= marker_length {
        return javascript_slice(content, length.saturating_sub(max_chars), length);
    }
    let prefix_length = (max_chars / 4).min(max_chars - marker_length);
    let suffix_length = max_chars - marker_length - prefix_length;
    if suffix_length == 0 {
        return javascript_slice(
            &format!(
                "{}{}",
                javascript_slice(content, 0, prefix_length),
                CHAT_TRUNCATION_MARKER
            ),
            0,
            max_chars,
        );
    }
    format!(
        "{}{}{}",
        javascript_slice(content, 0, prefix_length),
        CHAT_TRUNCATION_MARKER,
        javascript_slice(content, length - suffix_length, length)
    )
}

pub fn append_bounded_chat_content(current: &str, delta: &str, max_chars: usize) -> String {
    if delta.is_empty() {
        return current.to_string();
    }
    let current_length = javascript_length(current);
    let delta_length = javascript_length(delta);
    if current_length + delta_length <= max_chars {
        return format!("{current}{delta}");
    }
    let marker_length = javascript_length(CHAT_TRUNCATION_MARKER);
    if max_chars <= marker_length {
        if delta_length >= max_chars {
            return javascript_slice(delta, delta_length - max_chars, delta_length);
        }
        let combined = format!(
            "{}{}",
            javascript_slice(
                current,
                current_length.saturating_sub(max_chars - delta_length),
                current_length
            ),
            delta
        );
        let combined_length = javascript_length(&combined);
        return javascript_slice(
            &combined,
            combined_length.saturating_sub(max_chars),
            combined_length,
        );
    }
    let prefix_length = (max_chars / 4).min(max_chars - marker_length);
    let prefix = javascript_slice(current, 0, prefix_length);
    let suffix_length = max_chars - marker_length - javascript_length(&prefix);
    if suffix_length == 0 {
        return javascript_slice(&format!("{prefix}{CHAT_TRUNCATION_MARKER}"), 0, max_chars);
    }
    let suffix = if delta_length >= suffix_length {
        javascript_slice(delta, delta_length - suffix_length, delta_length)
    } else {
        format!(
            "{}{}",
            javascript_slice(
                current,
                current_length.saturating_sub(suffix_length - delta_length),
                current_length
            ),
            delta
        )
    };
    format!("{prefix}{CHAT_TRUNCATION_MARKER}{suffix}")
}

fn stringify_tool_input(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(value)) => value.clone(),
        Some(value) => serde_json::to_string_pretty(value).unwrap_or_default(),
    }
}

fn adjusted_index(index: Option<usize>, dropped: usize) -> Option<usize> {
    index.and_then(|index| index.checked_sub(dropped))
}

fn javascript_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

pub fn javascript_length(value: &str) -> usize {
    value.encode_utf16().count()
}

pub fn javascript_slice(value: &str, start: usize, end: usize) -> String {
    let units = value.encode_utf16().collect::<Vec<_>>();
    String::from_utf16_lossy(&units[start.min(units.len())..end.min(units.len())])
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn applies_streamed_text_and_final_results_like_the_typescript_buffer() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.push_user("hello", None);
        buffer.apply_event(&json!({
            "type": "content_block_start",
            "content_block": { "type": "text", "text": "draft " }
        }));
        buffer.apply_event(&json!({
            "type": "content_block_delta",
            "delta": { "type": "text_delta", "text": "answer" }
        }));
        buffer.apply_event(&json!({ "type": "content_block_stop" }));
        buffer.apply_event(&json!({ "type": "result", "result": "final answer" }));

        assert_eq!(buffer.messages().len(), 2);
        assert_eq!(buffer.messages()[1].role, "assistant");
        assert_eq!(buffer.messages()[1].content, "final answer");
        assert_eq!(buffer.messages()[1].is_streaming, Some(false));
        assert!(!buffer.streaming());
    }

    #[test]
    fn preserves_complete_tool_input_and_streamed_tool_deltas() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.apply_event(&json!({
            "type": "content_block_start",
            "content_block": {
                "type": "tool_use",
                "name": "Edit",
                "input": { "file_path": "src/app.ts", "old_string": "1", "new_string": "2" }
            }
        }));
        assert_eq!(
            buffer.messages()[0].content,
            "{\n  \"file_path\": \"src/app.ts\",\n  \"old_string\": \"1\",\n  \"new_string\": \"2\"\n}"
        );
        buffer.apply_event(&json!({
            "type": "content_block_delta",
            "delta": { "type": "input_json_delta", "partial_json": "tail" }
        }));
        buffer.apply_event(&json!({ "type": "content_block_stop" }));
        assert!(buffer.messages()[0].content.ends_with("tail"));
        assert_eq!(buffer.messages()[0].tool_name.as_deref(), Some("Edit"));
        assert_eq!(buffer.messages()[0].is_streaming, Some(false));
    }

    #[test]
    fn ignores_assistant_replays_after_streaming_has_started() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.apply_event(&json!({
            "type": "content_block_start",
            "content_block": { "type": "text", "text": "streamed" }
        }));
        buffer.apply_event(&json!({
            "type": "assistant",
            "message": { "content": [{ "type": "text", "text": "duplicate" }] }
        }));
        assert_eq!(buffer.messages()[0].content, "streamed");
    }

    #[test]
    fn bounds_content_by_javascript_utf16_units() {
        assert_eq!(javascript_length("a😀b"), 4);
        let marker_length = javascript_length(CHAT_TRUNCATION_MARKER);
        let content = "x".repeat(300_000);
        let truncated = truncate_chat_content(&content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
        assert_eq!(
            javascript_length(&truncated),
            CHAT_SINGLE_MESSAGE_CHAR_LIMIT
        );
        assert!(truncated.contains(CHAT_TRUNCATION_MARKER));
        assert!(marker_length < CHAT_SINGLE_MESSAGE_CHAR_LIMIT);

        let appended = append_bounded_chat_content(
            &"a".repeat(250_000),
            &"b".repeat(20_000),
            CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
        );
        assert_eq!(javascript_length(&appended), CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
        assert!(appended.starts_with('a'));
        assert!(appended.ends_with('b'));
    }

    #[test]
    fn validates_and_trims_persisted_transcripts() {
        assert!(is_valid_chat_transcript(&json!([
            { "id": "1", "role": "user", "content": "hello" },
            { "id": "2", "role": "assistant", "content": "world", "images": [] }
        ])));
        assert!(!is_valid_chat_transcript(&json!([
            { "id": "1", "role": "btw", "content": "invalid persisted role" }
        ])));

        let messages = (0..5_010)
            .map(|index| ChatTranscriptMessage::new("assistant", &index.to_string()))
            .collect::<Vec<_>>();
        let mut buffer = ChatMessageBuffer::default();
        buffer.replace_messages(messages);
        assert_eq!(buffer.messages().len(), CHAT_MESSAGE_RETAIN_LIMIT);
        assert_eq!(buffer.messages()[0].content, "10");
    }
}
