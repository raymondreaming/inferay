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
        let mut changed = false;
        for (index, message) in self.messages.iter_mut().enumerate() {
            if message.is_streaming == Some(true) {
                message.extra.remove("render");
                changed = true;
                self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
                self.render_dirty_start = Some(
                    self.render_dirty_start
                        .map_or(index, |start| start.min(index)),
                );
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
        self.prepare_render_model();
    }

    pub fn replace_messages(&mut self, messages: Vec<ChatTranscriptMessage>) {
        self.dirty_start = Some(0);
        self.render_dirty_start = Some(0);
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
        self.revision += 1;
        self.trim();
        self.prepare_render_model();
    }

    pub fn replace_in_assistant_messages(&mut self, mut replacer: impl FnMut(&str) -> String) {
        for (index, message) in self.messages.iter_mut().enumerate() {
            if message.role != "assistant" {
                continue;
            }
            let next = replacer(&message.content);
            if next == message.content {
                continue;
            }
            self.replaced_content.insert(message.id.clone());
            message.content = truncate_chat_content(&next, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
            self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
            self.render_dirty_start = Some(
                self.render_dirty_start
                    .map_or(index, |start| start.min(index)),
            );
            self.revision += 1;
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

    pub fn into_messages(self) -> Vec<ChatTranscriptMessage> {
        self.messages
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
                        self.dirty_start =
                            Some(self.dirty_start.map_or(index, |start| start.min(index)));
                        self.render_dirty_start = Some(
                            self.render_dirty_start
                                .map_or(index, |start| start.min(index)),
                        );
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
                let next_content = append_bounded_chat_content(
                    &message.content,
                    text,
                    CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                );
                if !next_content.starts_with(&message.content) {
                    self.replaced_content.insert(message.id.clone());
                }
                message.content = next_content;
                message.extra.remove("render");
                self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
                self.render_dirty_start = Some(
                    self.render_dirty_start
                        .map_or(index, |start| start.min(index)),
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
                let next_content = append_bounded_chat_content(
                    &message.content,
                    text,
                    CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                );
                if !next_content.starts_with(&message.content) {
                    self.replaced_content.insert(message.id.clone());
                }
                message.content = next_content;
                message.extra.remove("render");
                self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
                self.render_dirty_start = Some(
                    self.render_dirty_start
                        .map_or(index, |start| start.min(index)),
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
            self.replaced_content.insert(message.id.clone());
            message.content = truncate_chat_content(result, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
            message.is_streaming = Some(false);
            self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
            self.render_dirty_start = Some(
                self.render_dirty_start
                    .map_or(index, |start| start.min(index)),
            );
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
        if message.is_streaming != Some(value) {
            message.extra.remove("render");
        }
        message.is_streaming = Some(value);
        self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
        self.render_dirty_start = Some(
            self.render_dirty_start
                .map_or(index, |start| start.min(index)),
        );
        self.revision += 1;
        true
    }

    fn push(&mut self, message: ChatTranscriptMessage) {
        let index = self.messages.len();
        self.dirty_start = Some(self.dirty_start.map_or(index, |start| start.min(index)));
        self.render_dirty_start = Some(
            self.render_dirty_start
                .map_or(index, |start| start.min(index)),
        );
        self.messages.push(message);
        self.revision += 1;
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
        self.dirty_start = Some(0);
        self.render_dirty_start = Some(0);
        self.reset_pending = true;
        self.revision += 1;
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn restored_system_messages_prepare_command_and_every_goal_status() {
        let mut buffer = ChatMessageBuffer::default();
        let mut messages = vec![
            json!({"id":"command", "role":"system", "content":json!({"type":"inferay.command", "name":"commit", "description":"Commit changes", "args":"fix picker"}).to_string()}),
            json!({"id":"legacy", "role":"system", "content":"Running /review..."}),
            json!({"id":"invalid", "role":"system", "content":json!({"type":"inferay.command", "name":" "}).to_string()}),
            json!({"id":"invalid-goal", "role":"system", "content":json!({"type":"inferay.goal", "status":"bogus"}).to_string()}),
        ];
        for status in ["active", "paused", "complete", "cleared", "empty"] {
            messages.push(json!({"id":status, "role":"system", "content":json!({"type":"inferay.goal", "status":status, "objective":"Ship feature", "turns":2, "detail":"Progress"}).to_string()}));
        }
        buffer.replace_messages(serde_json::from_value(Value::Array(messages)).unwrap());
        assert_eq!(
            buffer.messages()[0].extra["render"]["command"]["args"],
            "fix picker"
        );
        assert_eq!(
            buffer.messages()[1].extra["render"]["command"]["name"],
            "review"
        );
        assert!(
            buffer.messages()[2].extra["render"]
                .get("command")
                .is_none()
        );
        assert!(buffer.messages()[3].extra["render"].get("goal").is_none());
        for (message, status) in buffer.messages()[4..]
            .iter()
            .zip(["active", "paused", "complete", "cleared", "empty"])
        {
            assert_eq!(message.extra["render"]["goal"]["status"], status);
            assert_eq!(message.extra["render"]["goal"]["turns"], 2);
        }
    }

    #[test]
    fn native_updates_append_only_changed_content_and_replace_final_result() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.push_user("hello", None);
        let initial = buffer.take_update().unwrap();
        assert_eq!(initial["reset"], true);
        buffer.apply_event(
            &json!({"type":"content_block_start","content_block":{"type":"text","text":"draft"}}),
        );
        let start = buffer.take_update().unwrap();
        assert_eq!(start["start"], 1);
        let id = start["messages"][0]["message"]["id"].clone();
        buffer.apply_event(
            &json!({"type":"content_block_delta","delta":{"type":"text_delta","text":" 😀"}}),
        );
        let delta = buffer.take_update().unwrap();
        assert_eq!(delta["baseRevision"], start["revision"]);
        assert_eq!(delta["messages"][0]["appendContent"], " 😀");
        assert!(delta["messages"][0]["message"].get("content").is_none());
        buffer.apply_event(&json!({"type":"result","result":"final"}));
        let result = buffer.take_update().unwrap();
        assert_eq!(result["messages"][0]["message"]["id"], id);
        assert_eq!(result["messages"][0]["message"]["content"], "final");
        assert!(result["messages"][0].get("appendContent").is_none());
        assert!(buffer.take_update().is_none());
    }

    #[test]
    fn native_updates_reset_after_retention_and_replace_truncated_content() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.replace_messages(
            (0..CHAT_MESSAGE_RETAIN_LIMIT)
                .map(|_| ChatTranscriptMessage::new("user", "small"))
                .collect(),
        );
        buffer.take_update();
        buffer.push_user("retained", None);
        let reset = buffer.take_update().unwrap();
        assert_eq!(reset["reset"], true);
        assert_eq!(
            reset["messages"].as_array().unwrap().len(),
            CHAT_MESSAGE_RETAIN_LIMIT
        );
        assert_eq!(
            buffer.total_chars,
            buffer
                .messages()
                .iter()
                .map(|message| javascript_length(&message.content))
                .sum::<usize>()
        );
        buffer.apply_event(&json!({"type":"content_block_start","content_block":{"type":"text","text":"x".repeat(CHAT_SINGLE_MESSAGE_CHAR_LIMIT)}}));
        buffer.take_update();
        buffer.apply_event(
            &json!({"type":"content_block_delta","delta":{"type":"text_delta","text":"end"}}),
        );
        let replacement = buffer.take_update().unwrap();
        assert!(replacement["messages"][0].get("appendContent").is_none());
        assert!(
            replacement["messages"][0]["message"]["content"]
                .as_str()
                .unwrap()
                .ends_with("end")
        );
        assert_eq!(
            buffer.total_chars,
            buffer
                .messages()
                .iter()
                .map(|message| javascript_length(&message.content))
                .sum::<usize>()
        );
    }

    #[test]
    fn tool_presentation_preserves_incremental_output_and_streamed_commands() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.append_tool("exec", &"raw output ".repeat(9_000));
        buffer.take_update();
        buffer.apply_event(&json!({"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"tail"}}));
        let update = buffer.take_update().unwrap();
        assert_eq!(update["messages"][0]["appendContent"], "tail");
        assert!(update["messages"][0]["message"].get("content").is_none());
        assert!(update["messages"][0]["message"]["render"]["summary"].is_null());
        assert!(serde_json::to_vec(&update).unwrap().len() < 1_000);
        buffer.append_tool(
            "exec",
            r#"{"command":"cargo test --workspace --all-targets --all-features --locked"}"#,
        );
        let render = &buffer.messages().last().unwrap().extra["render"];
        assert_eq!(render["display"]["label"], "Running Rust tests");
        assert!(render["toolInput"].is_null());
        assert!(render["questions"].is_null());
        buffer.patch_streaming(buffer.current_tool_index, false);
        buffer.prepare_render_model();
        assert!(buffer.messages().last().unwrap().extra["render"]["toolInput"].is_object());
        assert!(buffer.render_dirty_start.is_none());
    }

    #[test]
    fn native_groups_parse_complete_tool_envelopes_and_restore_legacy_messages() {
        let messages = vec![
            json!({"id":"a","role":"tool","toolName":"Edit","content":"{\"file_path\":\"a.rs\",\"old_string\":\"}\",\"new_string\":\"{\"}\noutput"}),
            json!({"id":"b","role":"tool","toolName":"Edit","content":"{\"file_path\":\"a.rs\",\"old_string\":\"{\",\"new_string\":\"new\"}"}),
            json!({"id":"c","role":"tool","toolName":"Read","content":"{\"file_path\":\"a.rs\"}"}),
            json!({"id":"d","role":"tool","toolName":"Read","content":"{\"file_path\":\"a.rs\"}"}),
        ];
        let mut buffer = ChatMessageBuffer::default();
        buffer.replace_messages(serde_json::from_value(json!(messages)).unwrap());
        assert_eq!(
            buffer.messages()[0].extra["render"]["trailingOutput"],
            "output"
        );
        assert_eq!(
            buffer.messages()[0].extra["render"]["toolInput"]["old_string"],
            "}"
        );
        assert_eq!(buffer.messages()[1].extra["render"]["groupId"], "a");
        assert_eq!(buffer.messages()[2].extra["render"]["kind"], "tool-group");
        assert_eq!(buffer.messages()[3].extra["render"]["hidden"], true);
        assert_eq!(buffer.take_update().unwrap()["reset"], true);
    }

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
