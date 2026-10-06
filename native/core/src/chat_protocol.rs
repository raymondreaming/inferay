use crate::{utf16_length as javascript_length, utf16_slice as javascript_slice};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

use crate::prompts::cards::ChatSkillPart;
use crate::prompts::{SkillProposal, SkillRead};
use crate::tool_presentation::{
    AskUserQuestion, McpElicitation, ToolDisplayInfo, ToolOutputSummary,
};

pub const CHAT_MESSAGE_RETAIN_LIMIT: usize = 5_000;
pub const CHAT_MESSAGE_CHAR_LIMIT: usize = 1_000_000;
pub const CHAT_SINGLE_MESSAGE_CHAR_LIMIT: usize = 256_000;
pub const CHAT_TRUNCATION_MARKER: &str =
    "\n\n[… content truncated to keep Inferay responsive …]\n\n";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatTranscriptMessage {
    pub id: String,
    #[ts(type = "'user' | 'assistant' | 'tool' | 'system' | 'btw'")]
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub images: Option<Vec<String>>,
    #[serde(rename = "toolName", skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool_name: Option<String>,
    #[serde(rename = "isStreaming", skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub btw_question: Option<String>,
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub render: Option<NativeChatRender>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeChatRender {
    #[ts(type = "1")]
    pub version: u8,
    pub kind: ChatRenderKind,
    pub group_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group_end: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group_leader: Option<bool>,
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub continues_after: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub row_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub edit: Option<ChatEdit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub output_start: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display: Option<ToolDisplayInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<ToolOutputSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub questions: Option<Vec<AskUserQuestion>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub elicitation: Option<McpElicitation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub command: Option<CommandCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub goal: Option<GoalCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub subagent: Option<SubagentCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub adaptive: Option<AdaptiveCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skill_proposal: Option<SkillProposal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skill_read: Option<SkillRead>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skill_parts: Option<Vec<ChatSkillPart>>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum ChatRenderKind {
    #[default]
    Message,
    EditGroup,
    ToolGroup,
}

#[derive(Clone, Debug, PartialEq, Serialize, ts_rs::TS)]
pub struct ChatEdit {
    pub file_path: String,
    pub old_string: String,
    pub new_string: String,
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
            btw_question: None,
            render: None,
        }
    }
}

struct PublishedMessage {
    id: String,
    content_bytes: usize,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePatch<'a> {
    id: &'a str,
    #[ts(type = "'user' | 'assistant' | 'tool' | 'system' | 'btw'")]
    role: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    content: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    images: Option<&'a Vec<String>>,
    #[serde(rename = "toolName", skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    tool_name: Option<&'a String>,
    #[serde(rename = "isStreaming", skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    is_streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    btw_question: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    render: Option<&'a NativeChatRender>,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatTranscriptChange<'a> {
    message: ChatMessagePatch<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    append_content: Option<&'a str>,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatTranscriptUpdate<'a> {
    version: u8,
    epoch: &'a str,
    base_revision: u64,
    revision: u64,
    reset: bool,
    start: usize,
    delete_count: usize,
    messages: Vec<ChatTranscriptChange<'a>>,
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
                message.btw_question = event["question"].as_str().map(str::to_owned);
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
                message.render = None;
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
            _ => return,
        }
        self.trim();
        self.prepare_render_model();
    }

    pub fn finalize(&mut self) {
        let mut first_changed = None;
        for (index, message) in self.messages.iter_mut().enumerate() {
            if message.is_streaming == Some(true) {
                message.render = None;
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
                message.render = None;
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
            let cached = self.messages[index].render.take();
            let message = &self.messages[index];
            let mut render = if message.role == "tool"
                && cached
                    .as_ref()
                    .is_some_and(|render| render.display.is_some())
            {
                cached.unwrap()
            } else {
                let mut render = NativeChatRender {
                    version: 1,
                    ..Default::default()
                };
                if message.role == "system" {
                    if let Ok(value) = serde_json::from_str::<Value>(&message.content) {
                        prepare_system_card(&value, &mut render);
                        render.skill_proposal = crate::prompts::cards::chat_skill_proposal(&value);
                        render.skill_read = crate::prompts::cards::chat_skill_read(&value);
                    }
                    if let Some(name) = message
                        .content
                        .strip_prefix("Running /")
                        .and_then(|rest| rest.strip_suffix("..."))
                        && !name.is_empty()
                        && !name.contains(['\n', '\r'])
                    {
                        prepare_system_card(
                            &serde_json::json!({"type":"inferay.command", "name":name}),
                            &mut render,
                        );
                    }
                } else if message.role == "assistant"
                    && let Some(parts) = crate::prompts::cards::chat_skill_parts(
                        &message.content,
                        message.is_streaming == Some(true),
                    )
                {
                    render.skill_parts = Some(parts);
                }
                if message.role == "tool" {
                    let input = parse_tool_envelope(&message.content);
                    let value = input.as_ref().map_or(&Value::Null, |(value, _)| value);
                    render.display = Some(crate::tool_presentation::display(
                        message.tool_name.as_deref(),
                        value,
                    ));
                    render.summary = crate::tool_presentation::summary(value);
                    if message.is_streaming != Some(true) {
                        render.questions = crate::tool_presentation::questions(value);
                        render.elicitation = crate::tool_presentation::elicitation(value);
                    }
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
                            render.file_path = Some(path.to_owned());
                            render.edit = Some(ChatEdit {
                                file_path: path.to_owned(),
                                old_string: input["old_string"].as_str().unwrap().to_owned(),
                                new_string: input["new_string"].as_str().unwrap().to_owned(),
                            });
                        }
                        let output = message.content[end..].trim_start();
                        let start = message.content.len() - output.len();
                        render.output_start = Some(crate::utf16_length(&message.content[..start]));
                    }
                }
                render
            };
            let kind = if render.file_path.is_some() {
                ChatRenderKind::EditGroup
            } else if message.role == "tool"
                && !matches!(
                    message.tool_name.as_deref(),
                    Some("Edit" | "AskUserQuestion")
                )
            {
                ChatRenderKind::ToolGroup
            } else {
                ChatRenderKind::Message
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
                if let Some(previous_render) = previous.render.as_ref()
                    && kind != ChatRenderKind::Message
                    && previous_render.kind == kind
                    && previous_render.file_path == render.file_path
                {
                    group_id.clone_from(&previous_render.group_id);
                }
            }
            render.kind = kind.clone();
            render.group_id = group_id;
            render.hidden = hidden;
            render.continues_after = Some(false);
            render.group_end = Some(index + 1);
            render.group_leader = Some(render.group_id == message.id);
            render.row_id = Some(if kind == ChatRenderKind::EditGroup {
                format!("edit-group:{}", render.group_id)
            } else if kind == ChatRenderKind::ToolGroup {
                format!("tool-group:{}", message.id)
            } else {
                message.id.clone()
            });
            self.messages[index].render = Some(render);
            if kind != ChatRenderKind::Message
                && self.messages[index].render.as_ref().unwrap().group_id != self.messages[index].id
            {
                let group_id = self.messages[index]
                    .render
                    .as_ref()
                    .unwrap()
                    .group_id
                    .clone();
                let member = |&candidate: &usize| {
                    self.messages[candidate].render.as_ref().unwrap().group_id == group_id
                        && !self.messages[candidate].render.as_ref().unwrap().hidden
                };
                let leader = if kind == ChatRenderKind::EditGroup {
                    (0..index).find(member)
                } else {
                    (0..index).rev().find(member)
                };
                if let Some(leader) = leader {
                    if kind == ChatRenderKind::EditGroup {
                        self.messages[leader].render.as_mut().unwrap().group_end = Some(index + 1);
                    } else if !hidden {
                        self.messages[leader]
                            .render
                            .as_mut()
                            .unwrap()
                            .continues_after = Some(true);
                    }
                    self.mark_changed(leader);
                }
            }
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
                images: message.images.as_ref(),
                tool_name: message.tool_name.as_ref(),
                is_streaming: message.is_streaming,
                btw_question: message.btw_question.as_ref(),
                render: message.render.as_ref(),
            };
            changes.push(ChatTranscriptChange {
                message: patch,
                append_content: append,
            });
        }
        let update = serde_json::to_value(ChatTranscriptUpdate {
            version: 1,
            epoch: self.epoch(),
            base_revision: self.published_revision,
            revision: self.revision,
            reset,
            start,
            delete_count: self.published.len().saturating_sub(start),
            messages: changes,
        })
        .expect("transcript update serialization");
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
        message.render = None;
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
            message.render = None;
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
            if message.role == "user"
                && message.images.as_ref().is_none_or(Vec::is_empty)
                && let Some((visible, paths)) = message
                    .content
                    .split_once("Here are the images at these paths:\n")
            {
                message.images = Some(
                    paths
                        .split('\n')
                        .filter(|path| !path.trim().is_empty() && path.contains("/.tmp/"))
                        .map(str::to_owned)
                        .collect(),
                );
                message.content = visible.trim().to_owned();
            }
            let mut chars = javascript_length(&message.content);
            if chars > CHAT_SINGLE_MESSAGE_CHAR_LIMIT {
                message.content =
                    truncate_chat_content(&message.content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
                self.replaced_content.insert(message.id.clone());
                message.render = None;
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
    // Both a short tail and a marked truncation share the same append boundary.
    let tail = |count: usize| {
        if delta_length >= count {
            javascript_slice(delta, delta_length - count, delta_length)
        } else {
            format!(
                "{}{}",
                javascript_slice(
                    current,
                    current_length.saturating_sub(count - delta_length),
                    current_length
                ),
                delta
            )
        }
    };
    let marker_length = javascript_length(CHAT_TRUNCATION_MARKER);
    if max_chars <= marker_length {
        return tail(max_chars);
    }
    let prefix = javascript_slice(current, 0, (max_chars / 4).min(max_chars - marker_length));
    let suffix = tail(max_chars - marker_length - javascript_length(&prefix));
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

#[derive(Clone, Debug, PartialEq, Serialize, ts_rs::TS)]
pub struct CommandCard {
    label: String,
    description: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum GoalCardStatus {
    Active,
    Paused,
    Complete,
    Cleared,
    Empty,
}
#[derive(Clone, Debug, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GoalCard {
    status: GoalCardStatus,
    title: String,
    objective: Option<String>,
    turns_label: Option<String>,
    detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum SubagentCardStatus {
    On,
    Off,
    Running,
    Completed,
    Failed,
    Cancelled,
    Status,
    Help,
}

#[derive(Clone, Debug, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SubagentCard {
    status: SubagentCardStatus,
    title: String,
    profile: Option<String>,
    worker_id: Option<String>,
    detail: Option<String>,
    active_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveCard {
    title: String,
    model: String,
    tier: String,
    sticky: bool,
    detail: Option<String>,
}

fn prepare_system_card(value: &Value, render: &mut NativeChatRender) {
    match value["type"].as_str() {
        Some("inferay.command")
            if value["name"]
                .as_str()
                .is_some_and(|name| !name.trim().is_empty()) =>
        {
            let name = value["name"].as_str().unwrap();
            let args = value["args"].as_str().filter(|args| !args.is_empty());
            render.command = Some(CommandCard {
                label: args.map_or_else(|| format!("/{name}"), |args| format!("/{name} {args}")),
                description: value["description"].as_str().map(str::to_owned),
            });
        }
        Some("inferay.goal") => {
            let Ok(status) = serde_json::from_value::<GoalCardStatus>(value["status"].clone())
            else {
                return;
            };
            let title = match status {
                GoalCardStatus::Active => "Pursuing Goal",
                GoalCardStatus::Paused => "Goal Paused",
                GoalCardStatus::Complete => "Goal Achieved",
                GoalCardStatus::Cleared => "Goal Cleared",
                GoalCardStatus::Empty => "No Active Goal",
            };
            render.goal = Some(GoalCard {
                status,
                title: title.into(),
                objective: value["objective"].as_str().map(str::to_owned),
                detail: value["detail"].as_str().map(str::to_owned),
                turns_label: value["turns"]
                    .as_f64()
                    .map(|turns| format!("{turns} turn{}", if turns == 1. { "" } else { "s" })),
            });
        }
        Some("inferay.subagent") => {
            let Ok(status) = serde_json::from_value::<SubagentCardStatus>(value["status"].clone())
            else {
                return;
            };
            let title = match status {
                SubagentCardStatus::On => "Subagents Enabled",
                SubagentCardStatus::Off => "Subagents Disabled",
                SubagentCardStatus::Running => "Subagent Running",
                SubagentCardStatus::Completed => "Subagent Completed",
                SubagentCardStatus::Failed => "Subagent Failed",
                SubagentCardStatus::Cancelled => "Subagent Cancelled",
                SubagentCardStatus::Status => "Subagents",
                SubagentCardStatus::Help => "/agents help",
            };
            render.subagent = Some(SubagentCard {
                status,
                title: title.into(),
                profile: value["profile"].as_str().map(str::to_owned),
                worker_id: value["id"].as_str().map(str::to_owned),
                detail: value["detail"].as_str().map(str::to_owned),
                active_label: value["active"].as_u64().map(|count| {
                    format!("{count} active worker{}", if count == 1 { "" } else { "s" })
                }),
            });
        }
        Some("inferay.adaptive") => {
            let model = value["model"].as_str().unwrap_or("unknown");
            let tier = value["tier"].as_str().unwrap_or("standard");
            let sticky = value["sticky"].as_bool().unwrap_or(false);
            render.adaptive = Some(AdaptiveCard {
                title: if sticky {
                    "Adaptive (cached route)".into()
                } else {
                    "Adaptive route".into()
                },
                model: model.into(),
                tier: tier.into(),
                sticky,
                detail: value["detail"].as_str().map(str::to_owned),
            });
        }
        _ => {}
    }
}

#[cfg(test)]
mod output_reference_tests {
    use super::*;

    #[test]
    fn truncation_preserves_utf16_limits_and_stream_append_boundaries() {
        let current = "a🌳b".repeat(80);
        for delta in ["", "x", "🌳", &"🌳x".repeat(120)] {
            let combined: Vec<_> = current.encode_utf16().chain(delta.encode_utf16()).collect();
            for limit in 0..=combined.len() + 1 {
                let actual = if delta.is_empty() {
                    truncate_chat_content(&current, limit)
                } else {
                    append_bounded_chat_content(&current, delta, limit)
                };
                assert!(javascript_length(&actual) <= limit, "limit={limit}");
                if limit >= combined.len() {
                    assert_eq!(actual, format!("{current}{delta}"));
                } else if limit <= javascript_length(CHAT_TRUNCATION_MARKER) {
                    assert_eq!(
                        actual,
                        String::from_utf16_lossy(&combined[combined.len() - limit..])
                    );
                } else {
                    assert!(actual.contains(CHAT_TRUNCATION_MARKER));
                }
            }
        }
        assert_eq!(append_bounded_chat_content("unchanged", "", 0), "unchanged");
        assert_eq!(javascript_slice("a🌳b", 2, 3), "�");
        assert_eq!(javascript_slice("a🌳b", 1, 3), "🌳");
        assert_eq!(javascript_slice("a🌳b", 3, usize::MAX), "b");
        assert_eq!(javascript_slice("a🌳b", 7, 9), "");
        assert_eq!(javascript_slice("a🌳b", 3, 1), "");
    }

    #[test]
    fn tool_output_uses_utf16_reference_instead_of_duplicate_text() {
        let content = format!(
            "{{\"command\":\"echo 🌳\"}}\n\n{}",
            "output 🌳\n".repeat(10_000)
        );
        let message: ChatTranscriptMessage = serde_json::from_value(serde_json::json!({
            "id":"tool", "role":"tool", "toolName":"exec", "content":content
        }))
        .unwrap();
        let mut buffer = ChatMessageBuffer::default();
        buffer.replace_messages(vec![message]);
        let message = &buffer.messages()[0];
        let render = message.render.as_ref().unwrap();
        let serialized = serde_json::to_value(render).unwrap();
        assert!(serialized.get("trailingOutput").is_none());
        let start = render.output_start.unwrap();
        assert_eq!(
            crate::utf16_slice(
                &message.content,
                start,
                crate::utf16_length(&message.content)
            ),
            "output 🌳\n".repeat(10_000)
        );
        assert!(serde_json::to_vec(render).unwrap().len() < 1000);
        // Restoring the saved transcript rebuilds this reference from its source.
        let saved = buffer.messages().to_vec();
        buffer.replace_messages(saved);
        assert_eq!(
            buffer.messages()[0].render.as_ref().unwrap().output_start,
            Some(start)
        );
    }
}
