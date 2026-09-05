use crate::{utf16_length as javascript_length, utf16_slice as javascript_slice};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub const CHAT_MESSAGE_RETAIN_LIMIT: usize = 5_000;
pub const CHAT_MESSAGE_CHAR_LIMIT: usize = 1_000_000;
pub const CHAT_SINGLE_MESSAGE_CHAR_LIMIT: usize = 256_000;
pub const CHAT_TRUNCATION_MARKER: &str =
    "\n\n[… content truncated to keep Inferay responsive …]\n\n";

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
            id: format!("s{}", uuid::Uuid::new_v4()),
            role: role.to_string(),
            content: truncate_chat_content(content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT),
            images: None,
            tool_name: None,
            is_streaming: None,
            extra: Map::new(),
        }
    }
}

struct PublishedMessage {
    id: String,
    content_bytes: usize,
}

#[derive(Serialize)]
struct ChatMessagePatch<'a> {
    id: &'a str,
    role: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: &'a Option<Vec<String>>,
    #[serde(rename = "toolName", skip_serializing_if = "Option::is_none")]
    tool_name: &'a Option<String>,
    #[serde(rename = "isStreaming", skip_serializing_if = "Option::is_none")]
    is_streaming: Option<bool>,
    #[serde(flatten)]
    extra: &'a Map<String, Value>,
}

struct ChatEpoch(String);
impl Default for ChatEpoch {
    fn default() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }
}

#[derive(Default)]
pub struct ChatMessageBuffer {
    epoch: ChatEpoch,
    messages: Vec<ChatTranscriptMessage>,
    current_assistant_index: Option<usize>,
    last_assistant_index: Option<usize>,
    current_tool_index: Option<usize>,
    has_streamed: bool,
    revision: u64,
    dirty_start: Option<usize>,
    render_dirty_start: Option<usize>,
    published_revision: u64,
    published: Vec<PublishedMessage>,
    replaced_content: HashSet<String>,
    reset_pending: bool,
    message_chars: Vec<usize>,
    total_chars: usize,
}

impl ChatMessageBuffer {
    pub fn push_user(&mut self, text: &str, images: Option<Vec<String>>) {
        let mut message = ChatTranscriptMessage::new("user", text);
        message.images = images.filter(|images| !images.is_empty());
        self.push(message);
    }

    pub fn push_user_with_id(
        &mut self,
        id: impl Into<String>,
        text: &str,
        images: Option<Vec<String>>,
    ) {
        let mut message = ChatTranscriptMessage::new("user", text);
        message.id = id.into();
        message.images = images.filter(|images| !images.is_empty());
        self.push(message);
    }

    pub fn push_system(&mut self, text: &str) {
        self.push(ChatTranscriptMessage::new("system", text));
    }

    /// Side questions share transcript transport and retention, but never alter
    /// the main provider's assistant/tool cursors.
    pub fn apply_btw_event(&mut self, id: &str, event: &Value) {
        match event["type"].as_str() {
            Some("chat:btw:start") => {
                let mut message = ChatTranscriptMessage::new("btw", "");
                message.id = id.into();
                message.is_streaming = Some(true);
                message
                    .extra
                    .insert("btwQuestion".into(), event["question"].clone());
                self.push(message);
            }
            Some(kind @ ("chat:btw:delta" | "chat:btw:done")) => {
                let Some(index) = self.messages.iter().position(|message| message.id == id) else {
                    return;
                };
                let message = &mut self.messages[index];
                let done = kind == "chat:btw:done";
                message.content = if done {
                    truncate_chat_content(
                        event["answer"].as_str().unwrap_or_default(),
                        CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                    )
                } else {
                    append_bounded_chat_content(
                        &message.content,
                        event["text"].as_str().unwrap_or_default(),
                        CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                    )
                };
                message.is_streaming = Some(!done);
                message.extra.remove("render");
                self.mark_changed(index);
                self.trim();
                self.prepare_render_model();
            }
            _ => {}
        }
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
        self.prepare_render_model();
    }

    pub fn finalize(&mut self) {
        let mut first_changed = None;
        for (index, message) in self.messages.iter_mut().enumerate() {
            if message.is_streaming == Some(true) {
                message.extra.remove("render");
                first_changed.get_or_insert(index);
            }
            message.is_streaming = Some(false);
        }
        self.current_assistant_index = None;
        self.last_assistant_index = None;
        self.current_tool_index = None;
        self.has_streamed = false;
        if let Some(index) = first_changed {
            self.mark_changed(index);
        }
        self.trim();
        self.prepare_render_model();
    }

    pub fn replace_messages(&mut self, messages: Vec<ChatTranscriptMessage>) {
        self.mark_changed(0);
        self.reset_pending = true;
        self.messages = messages
            .into_iter()
            .map(|mut message| {
                message.is_streaming = Some(false);
                message.extra.remove("render");
                message
            })
            .collect();
        self.current_assistant_index = None;
        self.last_assistant_index = None;
        self.current_tool_index = None;
        self.has_streamed = false;
        self.trim();
        self.prepare_render_model();
    }

    pub fn replace_in_assistant_messages(&mut self, mut replacer: impl FnMut(&str) -> String) {
        for index in 0..self.messages.len() {
            let message = &mut self.messages[index];
            if message.role != "assistant" {
                continue;
            }
            let next = replacer(&message.content);
            if next == message.content {
                continue;
            }
            self.replaced_content.insert(message.id.clone());
            message.content = truncate_chat_content(&next, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
            self.mark_changed(index);
        }
        self.trim();
        self.prepare_render_model();
    }

    /// Semantic descriptors are derived only for the changed suffix. Pixel/layout
    /// state never enters the transcript or its persisted representation.
    fn prepare_render_model(&mut self) {
        let Some(start) = self.render_dirty_start.take() else {
            return;
        };
        for index in start..self.messages.len() {
            let cached = self.messages[index].extra.remove("render");
            let message = &self.messages[index];
            let mut render = if message.role == "tool"
                && cached.as_ref().is_some_and(|r| r.get("display").is_some())
            {
                cached.unwrap()
            } else {
                let mut render = serde_json::json!({"version":1,"toolInput":null});
                if message.role == "system" {
                    if let Ok(value) = serde_json::from_str::<Value>(&message.content) {
                        prepare_system_card(&value, &mut render);
                        if let Some(proposal) = crate::prompts::chat_skill_proposal(&value) {
                            render["skillProposal"] = proposal;
                        }
                        if let Some(skill) = crate::prompts::chat_skill_read(&value) {
                            render["skillRead"] = skill;
                        }
                    }
                    if let Some(name) = message
                        .content
                        .strip_prefix("Running /")
                        .and_then(|rest| rest.strip_suffix("..."))
                        && !name.is_empty()
                        && !name.contains(['\n', '\r'])
                    {
                        render["command"] =
                            serde_json::json!({"type":"inferay.command", "name":name});
                    }
                } else if message.role == "assistant"
                    && let Some(parts) = crate::prompts::chat_skill_parts(
                        &message.content,
                        message.is_streaming == Some(true),
                    )
                {
                    render["skillParts"] = parts;
                }
                if message.role == "tool" {
                    let input = parse_tool_envelope(&message.content);
                    let value = input.as_ref().map_or(&Value::Null, |(value, _)| value);
                    render["display"] = serde_json::to_value(crate::tool_presentation::display(
                        message.tool_name.as_deref(),
                        value,
                    ))
                    .expect("tool display serialization");
                    render["summary"] =
                        serde_json::to_value(crate::tool_presentation::summary(value))
                            .expect("tool summary serialization");
                    render["questions"] =
                        serde_json::to_value(if message.is_streaming == Some(true) {
                            None
                        } else {
                            crate::tool_presentation::questions(value)
                        })
                        .expect("question serialization");
                    // Complete commands can be described while executing. Editing and
                    // input consumers still wait for the authoritative settled input.
                    if message.is_streaming != Some(true)
                        && let Some((input, end)) = input
                    {
                        if message.tool_name.as_deref() == Some("Edit")
                            && input.get("old_string").is_some_and(Value::is_string)
                            && input.get("new_string").is_some_and(Value::is_string)
                            && let Some(path) = input.get("file_path").and_then(Value::as_str)
                        {
                            render["filePath"] = Value::String(path.to_owned());
                        }
                        render["toolInput"] = input;
                        render["trailingOutput"] =
                            Value::String(message.content[end..].trim_start().to_owned());
                    }
                }
                render
            };
            let file_path = render.get("filePath").and_then(Value::as_str);
            let kind = if file_path.is_some() {
                "edit-group"
            } else if message.role == "tool"
                && !matches!(
                    message.tool_name.as_deref(),
                    Some("Edit" | "AskUserQuestion")
                )
            {
                "tool-group"
            } else {
                "message"
            };
            let mut group_id = message.id.clone();
            let mut hidden = false;
            if let Some(previous) = index
                .checked_sub(1)
                .and_then(|index| self.messages.get(index))
            {
                hidden = previous.role == message.role
                    && previous.tool_name == message.tool_name
                    && previous.content == message.content;
                if let Some(render) = previous.extra.get("render")
                    && kind != "message"
                    && render["kind"] == kind
                    && render.get("filePath").and_then(Value::as_str) == file_path
                    && let Some(id) = render["groupId"].as_str()
                {
                    group_id = id.to_owned();
                }
            }
            render["kind"] = Value::String(kind.into());
            render["groupId"] = Value::String(group_id);
            render["hidden"] = Value::Bool(hidden);
            self.messages[index]
                .extra
                .insert("render".to_owned(), render);
        }
    }

    /// A revisioned suffix splice. Streaming content uses append deltas rather
    /// than retransmitting the growing message or the entire transcript.
    pub fn take_update(&mut self) -> Option<Value> {
        if self.published_revision == self.revision {
            return None;
        }
        let reset = self.reset_pending || self.published.is_empty();
        let start = if reset {
            0
        } else {
            self.dirty_start
                .unwrap_or(self.messages.len())
                .min(self.published.len())
        };
        let mut changes = Vec::with_capacity(self.messages.len().saturating_sub(start));
        for (index, message) in self.messages.iter().enumerate().skip(start) {
            let append = if !reset && !self.replaced_content.contains(&message.id) {
                self.published
                    .get(index)
                    .filter(|old| old.id == message.id)
                    .and_then(|old| message.content.get(old.content_bytes..))
            } else {
                None
            };
            let patch = ChatMessagePatch {
                id: &message.id,
                role: &message.role,
                content: append.is_none().then_some(message.content.as_str()),
                images: &message.images,
                tool_name: &message.tool_name,
                is_streaming: message.is_streaming,
                extra: &message.extra,
            };
            let mut change = serde_json::json!({"message":patch});
            if let Some(append) = append {
                change["appendContent"] = Value::String(append.to_owned());
            }
            changes.push(change);
        }
        let update = serde_json::json!({"version":1,"epoch":self.epoch(),"baseRevision":self.published_revision,"revision":self.revision,"reset":reset,"start":start,"deleteCount":self.published.len().saturating_sub(start),"messages":changes});
        self.published.truncate(start);
        self.published.extend(
            self.messages[start..]
                .iter()
                .map(|message| PublishedMessage {
                    id: message.id.clone(),
                    content_bytes: message.content.len(),
                }),
        );
        self.replaced_content.clear();
        self.published_revision = self.revision;
        self.dirty_start = None;
        self.reset_pending = false;
        Some(update)
    }

    pub fn messages(&self) -> &[ChatTranscriptMessage] {
        &self.messages
    }

    pub fn epoch(&self) -> &str {
        &self.epoch.0
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
                        self.replaced_content.insert(message.id.clone());
                        message.content =
                            truncate_chat_content(text, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
                        message.is_streaming = Some(is_streaming);
                        self.mark_changed(index);
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
        let (index, field, tool_input) = match delta["type"].as_str() {
            Some("text_delta") => (self.current_assistant_index, "text", false),
            Some("input_json_delta") => (self.current_tool_index, "partial_json", true),
            _ => return,
        };
        let Some(text) = delta[field].as_str().filter(|text| !text.is_empty()) else {
            return;
        };
        let Some(index) = index else { return };
        let Some(message) = self.messages.get_mut(index) else {
            return;
        };
        // Claude's initial empty object is a placeholder for streamed tool input.
        let prefix = if tool_input && message.content == "{}" {
            ""
        } else {
            &message.content
        };
        let next = append_bounded_chat_content(prefix, text, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
        if !next.starts_with(&message.content) {
            self.replaced_content.insert(message.id.clone());
        }
        message.content = next;
        message.extra.remove("render");
        self.mark_changed(index);
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
            self.replaced_content.insert(message.id.clone());
            message.content = truncate_chat_content(result, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
            message.is_streaming = Some(false);
            self.mark_changed(index);
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

    fn patch_streaming(&mut self, index: Option<usize>, value: bool) {
        let Some(index) = index else { return };
        let Some(message) = self.messages.get_mut(index) else {
            return;
        };
        if message.is_streaming != Some(value) {
            message.extra.remove("render");
        }
        message.is_streaming = Some(value);
        self.mark_changed(index);
    }

    fn mark_changed(&mut self, index: usize) {
        self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
        self.render_dirty_start = Some(
            self.render_dirty_start
                .map_or(index, |start| start.min(index)),
        );
        self.revision += 1;
    }

    fn push(&mut self, message: ChatTranscriptMessage) {
        self.mark_changed(self.messages.len());
        self.messages.push(message);
        self.trim();
        self.prepare_render_model();
    }

    fn trim(&mut self) {
        let start = self
            .dirty_start
            .unwrap_or(self.messages.len())
            .min(self.message_chars.len());
        self.total_chars -= self.message_chars[start..].iter().sum::<usize>();
        self.message_chars.truncate(start);
        for message in &mut self.messages[start..] {
            let mut chars = javascript_length(&message.content);
            if chars > CHAT_SINGLE_MESSAGE_CHAR_LIMIT {
                message.content =
                    truncate_chat_content(&message.content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
                self.replaced_content.insert(message.id.clone());
                message.extra.remove("render");
                chars = javascript_length(&message.content);
            }
            self.message_chars.push(chars);
            self.total_chars += chars;
        }
        let mut dropped = self
            .messages
            .len()
            .saturating_sub(CHAT_MESSAGE_RETAIN_LIMIT);
        self.total_chars -= self.message_chars[..dropped].iter().sum::<usize>();
        while self.total_chars > CHAT_MESSAGE_CHAR_LIMIT && self.messages.len() - dropped > 1 {
            self.total_chars -= self.message_chars[dropped];
            dropped += 1;
        }
        if dropped == 0 {
            return;
        }
        self.messages.drain(..dropped);
        self.message_chars.drain(..dropped);
        self.mark_changed(0);
        self.reset_pending = true;
        self.current_assistant_index = adjusted_index(self.current_assistant_index, dropped);
        self.last_assistant_index = adjusted_index(self.last_assistant_index, dropped);
        self.current_tool_index = adjusted_index(self.current_tool_index, dropped);
    }
}

fn parse_tool_envelope(content: &str) -> Option<(Value, usize)> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with('{') {
        return None;
    }
    let prefix = content.len() - trimmed.len();
    let mut stream = serde_json::Deserializer::from_str(trimmed).into_iter::<Value>();
    let value = stream.next()?.ok()?;
    value
        .is_object()
        .then(|| (value, prefix + stream.byte_offset()))
}

pub fn trim_messages(messages: &mut Vec<ChatTranscriptMessage>) {
    if messages.len() > CHAT_MESSAGE_RETAIN_LIMIT {
        messages.drain(..messages.len() - CHAT_MESSAGE_RETAIN_LIMIT);
    }
    for message in messages.iter_mut() {
        if javascript_length(&message.content) > CHAT_SINGLE_MESSAGE_CHAR_LIMIT {
            message.content =
                truncate_chat_content(&message.content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
        }
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
    bounded_chat_content(content, "", max_chars)
}

pub fn append_bounded_chat_content(current: &str, delta: &str, max_chars: usize) -> String {
    if delta.is_empty() {
        return current.to_string();
    }
    bounded_chat_content(current, delta, max_chars)
}

fn bounded_chat_content(current: &str, delta: &str, max_chars: usize) -> String {
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

fn prepare_system_card(value: &Value, render: &mut Value) {
    let (key, fields) = match value["type"].as_str() {
        Some("inferay.command")
            if value["name"]
                .as_str()
                .is_some_and(|name| !name.trim().is_empty()) =>
        {
            ("command", &["name", "description", "args"][..])
        }
        Some("inferay.goal")
            if matches!(
                value["status"].as_str(),
                Some("active" | "paused" | "complete" | "cleared" | "empty")
            ) =>
        {
            ("goal", &["status", "objective", "detail"][..])
        }
        _ => return,
    };
    let mut card = serde_json::Map::new();
    card.insert("type".into(), value["type"].clone());
    for field in fields {
        if value[field].is_string() {
            card.insert((*field).into(), value[field].clone());
        }
    }
    if key == "goal" && value["turns"].is_number() {
        card.insert("turns".into(), value["turns"].clone());
    }
    render[key] = Value::Object(card);
}
