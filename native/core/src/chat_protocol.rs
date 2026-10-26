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
    #[serde(skip)]
    #[ts(skip)]
    group_start: usize,
    // First visible edit or most recent visible tool in this group.
    #[serde(skip)]
    #[ts(skip)]
    group_anchor: Option<usize>,
    pub group_end: usize,
    pub group_leader: bool,
    pub hidden: bool,
    pub continues_after: bool,
    pub row_id: String,
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
    // Rare approval payloads must not enlarge every ordinary transcript row.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skill_proposal: Option<Box<SkillProposal>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub automation_proposal: Option<Box<crate::projects::LegacyAutomationProposal>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub automation_definition_proposal: Option<Box<crate::project_files::ProjectFileCommand>>,
    pub plugin_proposal: Option<Box<crate::project_files::ProjectFileCommand>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skill_read: Option<Box<SkillRead>>,
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
                let append = if done {
                    message.content = truncate_chat_content(
                        event["answer"].as_str().unwrap_or_default(),
                        CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                    );
                    false
                } else {
                    append_bounded_chat_content(
                        &mut message.content,
                        event["text"].as_str().unwrap_or_default(),
                        CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                    )
                };
                if !append {
                    self.replaced_content.insert(message.id.clone());
                }
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
            "inferay.progress" => {
                let Some(id) = event["id"].as_str().filter(|id| !id.is_empty()) else {
                    return;
                };
                let replacement = event["text"].as_str();
                let delta = event["delta"].as_str().unwrap_or_default();
                if let Some(index) = self.messages.iter().position(|message| message.id == id) {
                    let message = &mut self.messages[index];
                    if let Some(text) = replacement {
                        message.content =
                            truncate_chat_content(text, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
                    } else {
                        append_bounded_chat_content(
                            &mut message.content,
                            delta,
                            CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                        );
                    }
                    message.render = None;
                    self.replaced_content.insert(id.to_owned());
                    self.mark_changed(index);
                } else if replacement.is_some() || !delta.is_empty() {
                    let mut message = ChatTranscriptMessage::new(
                        "system",
                        &truncate_chat_content(
                            replacement.unwrap_or(delta),
                            CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                        ),
                    );
                    message.id = id.to_owned();
                    self.push(message);
                }
            }
            "inferay.tool" => {
                let Some(id) = event["id"].as_str().filter(|id| !id.is_empty()) else {
                    return;
                };
                let done = event["done"] == true;
                let mut content = stringify_tool_input(event.get("input"));
                if done && !event["output"].is_null() {
                    content.push('\n');
                    let output = &event["output"];
                    let parts = output
                        .get("content")
                        .and_then(Value::as_array)
                        .or_else(|| output.as_array());
                    if let Some(parts) = parts {
                        for part in parts {
                            if let Some(text) = part["text"].as_str() {
                                content.push_str(text);
                                content.push('\n');
                            } else {
                                if part["type"] == "image" || part["type"] == "inputImage" {
                                    content.push_str("[Image result]\n");
                                } else {
                                    content.push_str(
                                        &serde_json::to_string_pretty(part).unwrap_or_default(),
                                    );
                                    content.push('\n');
                                }
                            }
                        }
                        if !output["structuredContent"].is_null() {
                            content.push_str(
                                &serde_json::to_string_pretty(&output["structuredContent"])
                                    .unwrap_or_default(),
                            );
                        }
                    } else if let Some(text) = output.as_str() {
                        content.push_str(text);
                    } else {
                        content.push_str(&serde_json::to_string_pretty(output).unwrap_or_default());
                    }
                }
                let content = truncate_chat_content(&content, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
                if let Some(index) = self.messages.iter().position(|message| message.id == id) {
                    let message = &mut self.messages[index];
                    message.content = content;
                    message.is_streaming = Some(!done);
                    message.render = None;
                    self.replaced_content.insert(id.to_owned());
                    self.mark_changed(index);
                } else {
                    let mut message = ChatTranscriptMessage::new("tool", &content);
                    message.id = id.to_owned();
                    message.tool_name = event["name"].as_str().map(str::to_owned);
                    message.is_streaming = Some(!done);
                    self.push(message);
                }
            }
            "user" => {
                if let Some(blocks) = event.pointer("/message/content").and_then(Value::as_array) {
                    for block in blocks.iter().filter(|block| block["type"] == "tool_result") {
                        let Some(call_id) = block["tool_use_id"].as_str() else {
                            continue;
                        };
                        let id = format!("tool-call:{call_id}");
                        let output = match &block["content"] {
                            Value::String(text) => text.clone(),
                            Value::Array(parts) => parts
                                .iter()
                                .filter_map(|part| part["text"].as_str())
                                .collect::<Vec<_>>()
                                .join("\n"),
                            value => serde_json::to_string_pretty(value).unwrap_or_default(),
                        };
                        let output = format!(
                            "\n\n{}\n{output}",
                            if block["is_error"] == true {
                                "Error"
                            } else {
                                "Result"
                            }
                        );
                        if let Some(index) =
                            self.messages.iter().position(|message| message.id == id)
                        {
                            let message = &mut self.messages[index];
                            append_bounded_chat_content(
                                &mut message.content,
                                &output,
                                CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
                            );
                            message.is_streaming = Some(false);
                            message.render = None;
                            self.mark_changed(index);
                        } else {
                            let mut message = ChatTranscriptMessage::new(
                                "tool",
                                &truncate_chat_content(&output, CHAT_SINGLE_MESSAGE_CHAR_LIMIT),
                            );
                            message.id = id;
                            message.tool_name = Some("Tool result".into());
                            message.is_streaming = Some(false);
                            self.push(message);
                        }
                    }
                }
            }
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

    /// Apply an already admitted renderer splice without finalizing streaming rows.
    /// Returns the first affected presentation row, including preceding tool groups.
    pub fn splice_replica_messages(
        &mut self,
        range: std::ops::Range<usize>,
        messages: Vec<ChatTranscriptMessage>,
    ) -> usize {
        let start = range.start.saturating_sub(1);
        self.messages.splice(range, messages);
        self.mark_changed(start);
        self.prepare_render_model();
        self.dirty_start.take().unwrap_or(start)
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
                        if value["type"] == "inferay.automation-proposal"
                            && let Ok(
                                command @ crate::projects::LegacyAutomationProposal::SaveAutomation { .. },
                            ) = serde_json::from_value(value["command"].clone())
                            {
                                render.automation_proposal = Some(Box::new(command));
                            }
                        if value["type"] == "inferay.automation-definition-proposal"
                            && let Ok(command) = serde_json::from_value(value["command"].clone())
                            && crate::project_files::proposed_automation(&command).is_ok()
                        {
                            render.automation_definition_proposal = Some(Box::new(command));
                        }
                        if value["type"] == "inferay.plugin-proposal"
                            && let Ok(
                                command @ (crate::project_files::ProjectFileCommand::CreatePlugin {
                                    ..
                                }
                                | crate::project_files::ProjectFileCommand::UpdatePlugin {
                                    ..
                                }),
                            ) = serde_json::from_value(value["command"].clone())
                        {
                            render.plugin_proposal = Some(Box::new(command));
                        }
                        render.skill_proposal =
                            crate::prompts::cards::chat_skill_proposal(&value).map(Box::new);
                        render.skill_read =
                            crate::prompts::cards::chat_skill_read(&value).map(Box::new);
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
            render.group_start = index;
            render.group_anchor = None;
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
                    render.group_start = previous_render.group_start;
                    render.group_anchor = previous_render.group_anchor;
                }
            }
            render.kind = kind.clone();
            render.hidden = hidden;
            render.continues_after = false;
            render.group_end = index + 1;
            let group_id = &self.messages[render.group_start].id;
            render.group_leader = *group_id == message.id;
            render.row_id = if kind == ChatRenderKind::EditGroup {
                format!("edit-group:{group_id}")
            } else if kind == ChatRenderKind::ToolGroup {
                format!("tool-group:{}", message.id)
            } else {
                message.id.clone()
            };
            let leader = render.group_anchor;
            if !hidden && (kind != ChatRenderKind::EditGroup || leader.is_none()) {
                render.group_anchor = Some(index);
            }
            let continuation = !render.group_leader;
            self.messages[index].render = Some(render);
            if continuation && let Some(leader) = leader {
                if kind == ChatRenderKind::EditGroup {
                    self.messages[leader].render.as_mut().unwrap().group_end = index + 1;
                } else if !hidden {
                    self.messages[leader]
                        .render
                        .as_mut()
                        .unwrap()
                        .continues_after = true;
                }
                self.mark_changed(leader);
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
                    self.append_tool(
                        name,
                        &stringify_tool_input(block.get("input")),
                        block["id"].as_str(),
                    );
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
                self.append_tool(
                    name,
                    &stringify_tool_input(block.get("input")),
                    block["id"].as_str(),
                );
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
        let placeholder = tool_input && message.content == "{}";
        if placeholder {
            message.content.clear();
        }
        let append =
            append_bounded_chat_content(&mut message.content, text, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
        if !append || (placeholder && !message.content.starts_with("{}")) {
            self.replaced_content.insert(message.id.clone());
        }
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

    fn append_tool(&mut self, name: &str, content: &str, call_id: Option<&str>) {
        self.current_assistant_index = None;
        self.current_tool_index = Some(self.messages.len());
        let mut message = ChatTranscriptMessage::new("tool", content);
        message.tool_name = Some(name.to_string());
        if let Some(id) = call_id.filter(|id| !id.is_empty()) {
            message.id = format!("tool-call:{id}");
        }
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

pub fn truncate_chat_content(content: &str, max_chars: usize) -> String {
    bounded_chat_content(content, "", max_chars)
}

/// Append in place when possible; false means the retained prefix was replaced.
pub fn append_bounded_chat_content(current: &mut String, delta: &str, max_chars: usize) -> bool {
    if delta.is_empty() {
        return true;
    }
    // UTF-8 bytes bound UTF-16 units from above, avoiding a full scan on normal deltas.
    if current.len().saturating_add(delta.len()) <= max_chars {
        current.push_str(delta);
        return true;
    }
    let next = bounded_chat_content(current, delta, max_chars);
    let append = next.starts_with(current.as_str());
    *current = next;
    append
}

fn bounded_chat_content(current: &str, delta: &str, max_chars: usize) -> String {
    let current_length = javascript_length(current);
    let delta_length = javascript_length(delta);
    if current_length + delta_length <= max_chars {
        return format!("{current}{delta}");
    }
    // Both a short tail and a marked truncation share the same append boundary.
    let tail = |count: usize| {
        let units = current
            .encode_utf16()
            .chain(delta.encode_utf16())
            .skip(current_length + delta_length - count);
        let mut tail = Vec::with_capacity(count);
        tail.extend(units);
        String::from_utf16_lossy(&tail)
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
    pub label: String,
    pub description: Option<String>,
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
    pub status: GoalCardStatus,
    pub title: String,
    pub objective: Option<String>,
    pub turns_label: Option<String>,
    pub detail: Option<String>,
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
        _ => {}
    }
}

#[cfg(test)]
mod output_reference_tests {
    use super::*;

    #[test]
    fn transcript_rows_keep_rare_cards_out_of_inline_storage() {
        assert!(std::mem::size_of::<ChatTranscriptMessage>() <= 1024);
    }

    #[test]
    fn standalone_card_reloads_only_valid_automation_writes() {
        let id = "b39bc9f4-870f-42a9-871b-a892278bac52";
        let body = serde_json::json!({"schema":"inferay.automation/1","id":id,"name":"Briefing","trigger":{"kind":"manual"},"overlap":"skip","execution":{"kind":"agent","provider":"codex","instructions":"Review progress","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300},"may":[]});
        for (path, valid) in [
            (format!("automations/{id}/automation.json"), true),
            ("project.json".into(), false),
        ] {
            let command = serde_json::json!({"type":"saveDefinition","projectId":"project-1","path":path,"content":body.to_string(),"expectedHash":null});
            let message: ChatTranscriptMessage = serde_json::from_value(serde_json::json!({
                "id":"automation-card","role":"system",
                "content":serde_json::json!({"type":"inferay.automation-definition-proposal","command":command}).to_string()
            })).unwrap();
            let mut buffer = ChatMessageBuffer::default();
            buffer.replace_messages(vec![message]);
            let render = buffer.messages()[0].render.as_ref().unwrap();
            assert_eq!(render.automation_definition_proposal.is_some(), valid);
            assert!(render.plugin_proposal.is_none());
        }
    }

    #[test]
    fn plugin_card_reloads_only_bundle_proposals() {
        for command in [
            serde_json::json!({"type":"createPlugin","projectId":"project-1","slug":"daily","files":{"plugin.json":"{}"}}),
            serde_json::json!({"type":"updatePlugin","projectId":"project-1","slug":"daily","expectedHash":"old","files":{"README.md":"Updated guide"},"remove":[]}),
            serde_json::json!({"type":"runAutomation","id":"automation-1","requestId":"request-1"}),
        ] {
            let message: ChatTranscriptMessage = serde_json::from_value(serde_json::json!({
                "id":"plugin-card", "role":"system",
                "content":serde_json::json!({"type":"inferay.plugin-proposal","command":command}).to_string()
            })).unwrap();
            let mut buffer = ChatMessageBuffer::default();
            buffer.replace_messages(vec![message]);
            let render = buffer.messages()[0].render.as_ref().unwrap();
            if command["type"] == "createPlugin" || command["type"] == "updatePlugin" {
                assert_eq!(
                    serde_json::to_value(&render.plugin_proposal).unwrap(),
                    command
                );
            } else {
                assert!(render.plugin_proposal.is_none());
            }
            assert!(render.automation_proposal.is_none());
            assert!(render.skill_proposal.is_none());
        }
    }

    #[test]
    fn automation_card_survives_transcript_reload_without_becoming_a_skill() {
        let command = serde_json::json!({"type":"saveAutomation","id":"proposal-1","projectId":"project-1","expectedRevision":null,"name":"Weekly briefing","execution":{"kind":"agent","instructions":"Prepare a briefing","provider":"codex","model":null,"reasoningLevel":"medium","skillIds":[],"resourceIds":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300},"intervalSeconds":604800,"calendar":null,"overlapPolicy":"skip"});
        let message: ChatTranscriptMessage = serde_json::from_value(serde_json::json!({"id":"card-1","role":"system","content":serde_json::json!({"type":"inferay.automation-proposal","command":command}).to_string()})).unwrap();
        let mut buffer = ChatMessageBuffer::default();
        buffer.replace_messages(vec![message]);
        let render = buffer.messages()[0].render.as_ref().unwrap();
        assert_eq!(
            serde_json::to_value(&render.automation_proposal).unwrap(),
            command
        );
        assert!(render.skill_proposal.is_none());
    }

    #[test]
    fn truncation_preserves_utf16_limits_and_stream_append_boundaries() {
        let current = "a🌳b".repeat(80);
        for delta in ["", "x", "🌳", &"🌳x".repeat(120)] {
            let combined: Vec<_> = current.encode_utf16().chain(delta.encode_utf16()).collect();
            for limit in 0..=combined.len() + 1 {
                let actual = if delta.is_empty() {
                    truncate_chat_content(&current, limit)
                } else {
                    let mut next = current.clone();
                    let append = append_bounded_chat_content(&mut next, delta, limit);
                    assert_eq!(append, next.starts_with(&current));
                    next
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
        let mut unchanged = "unchanged".to_owned();
        assert!(append_bounded_chat_content(&mut unchanged, "", 0));
        assert_eq!(unchanged, "unchanged");
        assert_eq!(javascript_slice("a🌳b", 2, 3), "�");
        assert_eq!(javascript_slice("a🌳b", 1, 3), "🌳");
        assert_eq!(javascript_slice("a🌳b", 3, usize::MAX), "b");
        assert_eq!(javascript_slice("a🌳b", 7, 9), "");
        assert_eq!(javascript_slice("a🌳b", 3, 1), "");
    }

    #[test]
    fn edit_groups_keep_their_rows_after_history_trimming() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.replace_messages(
            (0..=CHAT_MESSAGE_RETAIN_LIMIT)
                .map(|index| {
                    serde_json::from_value(serde_json::json!({
                        "id": format!("edit-{index}"), "role": "tool", "toolName": "Edit",
                        "content": serde_json::json!({"file_path": format!("file-{}.rs", index / 3),
                            "old_string": index.to_string(), "new_string": "updated"}).to_string()
                    }))
                    .unwrap()
                })
                .collect(),
        );
        for (first, end) in [(1, 2), (2, 1)] {
            let render =
                serde_json::to_value(buffer.messages()[0].render.as_ref().unwrap()).unwrap();
            assert_eq!(render["rowId"], format!("edit-group:edit-{first}"));
            assert_eq!(render["groupLeader"], true);
            assert_eq!(render["groupEnd"], end);
            assert_eq!(buffer.messages().len(), CHAT_MESSAGE_RETAIN_LIMIT);
            buffer.take_update();
            buffer.push_user("Continue", None);
        }
    }

    #[test]
    fn side_answer_replacements_publish_authoritative_content() {
        let mut buffer = ChatMessageBuffer::default();
        buffer.apply_btw_event(
            "question",
            &serde_json::json!({"type":"chat:btw:start","question":"Why?"}),
        );
        buffer.take_update();
        buffer.apply_btw_event(
            "question",
            &serde_json::json!({"type":"chat:btw:delta","text":"draft"}),
        );
        assert_eq!(
            buffer.take_update().unwrap()["messages"][0]["appendContent"],
            "draft"
        );
        buffer.apply_btw_event(
            "question",
            &serde_json::json!({"type":"chat:btw:done","answer":"final answer"}),
        );
        let update = buffer.take_update().unwrap();
        assert_eq!(update["messages"][0]["message"]["content"], "final answer");
        assert!(update["messages"][0].get("appendContent").is_none());
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
    #[test]
    fn replica_splice_preserves_streaming_and_rebuilds_group_boundaries() {
        let mut buffer = ChatMessageBuffer::default();
        let mut first = ChatTranscriptMessage::new("assistant", "Hello");
        first.is_streaming = Some(true);
        buffer.splice_replica_messages(0..0, vec![first.clone()]);
        assert_eq!(buffer.messages()[0].is_streaming, Some(true));
        first.content.push_str(" world");
        buffer.splice_replica_messages(0..1, vec![first]);
        assert_eq!(buffer.messages()[0].content, "Hello world");
        let mut tool = ChatTranscriptMessage::new("tool", "first output");
        tool.tool_name = Some("Bash".into());
        buffer.splice_replica_messages(1..1, vec![tool]);
        let mut next = ChatTranscriptMessage::new("tool", "second output");
        next.tool_name = Some("Bash".into());
        let affected = buffer.splice_replica_messages(2..2, vec![next]);
        assert!(affected <= 1);
        assert!(
            buffer.messages()[1]
                .render
                .as_ref()
                .unwrap()
                .continues_after
        );
        buffer.splice_replica_messages(2..3, vec![]);
        assert!(
            !buffer.messages()[1]
                .render
                .as_ref()
                .unwrap()
                .continues_after
        );
    }
}
