use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::chat_protocol::{
    CHAT_SINGLE_MESSAGE_CHAR_LIMIT, append_bounded_chat_content, javascript_length,
    truncate_chat_content,
};
use crate::path_security::{is_within_directory, resolve_lexically};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentEvent {
    #[serde(rename = "session")]
    Session {
        #[serde(rename = "providerSessionId")]
        provider_session_id: String,
    },
    #[serde(rename = "status")]
    Status {
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename = "text-delta")]
    TextDelta {
        text: String,
        #[serde(rename = "messageId", skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
    },
    #[serde(rename = "thinking-delta")]
    ThinkingDelta {
        text: String,
        #[serde(rename = "messageId", skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
    },
    #[serde(rename = "tool-call-start")]
    ToolCallStart {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
    #[serde(rename = "tool-call-delta")]
    ToolCallDelta {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        delta: String,
    },
    #[serde(rename = "tool-call-end")]
    ToolCallEnd {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename = "result")]
    Result { text: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "finish")]
    Finish {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "raw")]
    Raw {
        provider: String,
        #[serde(rename = "eventType", skip_serializing_if = "Option::is_none")]
        event_type: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        event: Option<Value>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompletedAssistantMessage {
    Skip,
    Delta(String),
    Replace,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexInvocationContext {
    pub cwd: PathBuf,
    pub reference_paths: Vec<PathBuf>,
    pub images: Vec<PathBuf>,
    pub model: Option<String>,
    pub reasoning_level: Option<String>,
    pub developer_instructions: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProtocolEmission {
    Chat(Value),
    Agent(AgentEvent),
    UserInputAcknowledged {
        text: String,
    },
    FileChange(Vec<PathBuf>),
    Status {
        status: String,
        is_loading: bool,
    },
    Activity {
        tool_name: String,
        summary: String,
        is_streaming: bool,
    },
    System(String),
    Session(String),
}

#[derive(Clone, Debug)]
pub struct AgentProtocolContext {
    pub cwd: PathBuf,
    pub reference_paths: Vec<PathBuf>,
    pub session_id: Option<String>,
    pub emissions: Vec<ProtocolEmission>,
}

impl AgentProtocolContext {
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: cwd.into(),
            reference_paths: Vec::new(),
            session_id: None,
            emissions: Vec::new(),
        }
    }

    pub fn take_emissions(&mut self) -> Vec<ProtocolEmission> {
        std::mem::take(&mut self.emissions)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatBlockRole {
    Assistant,
    Tool,
}

#[derive(Debug, Default)]
pub struct ClaudeProtocolState {
    pub last_assistant_message: String,
}

impl ClaudeProtocolState {
    pub fn handle_event(&mut self, context: &mut AgentProtocolContext, event: &Value) {
        if let Some(session_id) = event.get("session_id").and_then(Value::as_str)
            && context.session_id.as_deref() != Some(session_id)
        {
            context.session_id = Some(session_id.into());
            context
                .emissions
                .push(ProtocolEmission::Session(session_id.into()));
            context
                .emissions
                .push(ProtocolEmission::Agent(AgentEvent::Session {
                    provider_session_id: session_id.into(),
                }));
        }
        if let Some(normalized) = normalize_claude_event(event) {
            if let AgentEvent::Result { text } = &normalized {
                self.last_assistant_message = truncate_agent_result(text);
            }
            let activity = match &normalized {
                AgentEvent::ToolCallStart {
                    tool_name, summary, ..
                } => Some((
                    tool_name.clone(),
                    summary
                        .clone()
                        .unwrap_or_else(|| summarize_tool_input(tool_name, &json!({}))),
                )),
                _ => None,
            };
            context.emissions.push(ProtocolEmission::Agent(normalized));
            if let Some((tool_name, summary)) = activity {
                context.emissions.push(ProtocolEmission::Activity {
                    tool_name,
                    summary,
                    is_streaming: true,
                });
            }
        }
        if is_chat_stream_event(event) {
            context
                .emissions
                .push(ProtocolEmission::Chat(event.clone()));
        }
    }
}

#[derive(Debug, Default)]
pub struct CodexProtocolState {
    pub assistant_open: bool,
    pub tool_open: bool,
    pub saw_assistant_stream: bool,
    pub has_final_assistant_message: bool,
    pub completed_from_event: bool,
    pub last_assistant_message: String,
    pub last_chat_block_role: Option<ChatBlockRole>,
    pub current_tool_id: Option<String>,
    file_snapshots: HashMap<PathBuf, Option<String>>,
    watched_paths: HashSet<PathBuf>,
    active_patch_paths: Vec<PathBuf>,
    command_outputs: HashMap<String, String>,
}

impl CodexProtocolState {
    pub fn handle_event(&mut self, context: &mut AgentProtocolContext, event: &Value) {
        let event = unwrap_codex_event(event);
        let Some(data) = event.as_object() else {
            return;
        };
        let event_type = string_field(data, "type");
        let event_text = extract_text(event);
        let item = data.get("item").unwrap_or(&Value::Null);
        let item_record = item.as_object();
        let item_type = item_record.map_or("", |item| string_field(item, "type"));

        match (event_type, item_type) {
            ("thread.started", _) if !string_field(data, "thread_id").is_empty() => {
                let thread_id = string_field(data, "thread_id").to_string();
                context.session_id = Some(thread_id.clone());
                context
                    .emissions
                    .push(ProtocolEmission::Session(thread_id.clone()));
                context
                    .emissions
                    .push(ProtocolEmission::Agent(AgentEvent::Session {
                        provider_session_id: thread_id,
                    }));
            }
            ("turn.started", _) => {
                self.emit_status(context, "thinking", true);
                context
                    .emissions
                    .push(ProtocolEmission::Agent(AgentEvent::Status {
                        status: "thinking".into(),
                        label: None,
                    }));
            }
            ("item.started", "command_execution") => {
                let payload = json!({
                    "command": item_record.map_or("", |item| string_field(item, "command")),
                    "cwd": context.cwd,
                });
                self.emit_tool_status_and_activity(context, "exec", &payload);
                if let Some(item) = item_record {
                    let item_id = string_field(item, "id");
                    if !item_id.is_empty() {
                        self.command_outputs.insert(
                            item_id.into(),
                            string_field(item, "aggregated_output").into(),
                        );
                    }
                }
                self.start_tool(context, "exec", payload);
            }
            ("item.updated", "command_execution") => {
                self.emit_command_output_delta(context, item);
            }
            ("command_output_delta", _) => {
                self.tool_delta(context, string_field(data, "delta"));
            }
            ("item.completed", "command_execution") => {
                self.emit_command_output_delta(context, item);
                if let Some(item) = item_record {
                    let item_id = string_field(item, "id");
                    if !item_id.is_empty() {
                        self.command_outputs.remove(item_id);
                    }
                }
                self.close_tool(context);
            }
            ("item.started", "file_change") => {
                let paths = file_change_paths(context, item);
                self.active_patch_paths = paths.clone();
                self.snapshot_paths(&paths);
                let changes = item_record
                    .and_then(|item| nullish_value(item.get("changes"), None))
                    .cloned()
                    .unwrap_or_else(|| json!(display_paths(&paths)));
                let payload = json!({ "changes": changes });
                self.emit_tool_status_and_activity(context, "patch", &payload);
                self.start_tool(context, "patch", payload);
            }
            ("item.completed", "file_change") => {
                self.close_tool(context);
                let paths = file_change_paths(context, item);
                let paths = if paths.is_empty() {
                    self.active_patch_paths.clone()
                } else {
                    paths
                };
                self.emit_diffs_for_paths(context, &paths);
                if !paths.is_empty() {
                    context.emissions.push(ProtocolEmission::FileChange(paths));
                }
                self.active_patch_paths.clear();
            }
            ("item.completed", "agent_message") => {
                let text = item_record
                    .map(|item| string_field(item, "text"))
                    .filter(|text| !text.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| extract_text(item));
                if !text.is_empty() {
                    self.complete_assistant_message(context, &text);
                }
            }
            ("agent_message_delta", _) => {
                self.assistant_delta(context, &first_string(data, &["delta", "text", "content"]));
                self.emit_status(context, "responding", true);
                context
                    .emissions
                    .push(ProtocolEmission::Agent(AgentEvent::Status {
                        status: "responding".into(),
                        label: None,
                    }));
            }
            ("agent_message", _) => {
                let content = first_string(data, &["message", "content", "text"]);
                if !content.is_empty() {
                    self.assistant_delta(context, &content);
                }
            }
            ("exec_command_begin", _) => {
                let cwd = {
                    let cwd = string_field(data, "cwd");
                    if cwd.is_empty() {
                        context.cwd.to_string_lossy().into_owned()
                    } else {
                        cwd.into()
                    }
                };
                let payload = json!({
                    "command": first_string(data, &["parsed_cmd", "command", "cmd"]),
                    "cwd": cwd,
                });
                self.emit_tool_status_and_activity(context, "exec", &payload);
                self.start_tool(context, "exec", payload);
            }
            ("exec_command_output_delta", _) => {
                let encoded = string_field(data, "chunk");
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .ok()
                    .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
                    .unwrap_or_default();
                self.tool_delta(context, &decoded);
            }
            ("exec_command_end", _) => self.close_tool(context),
            ("patch_apply_begin", _) => {
                let paths = file_change_paths(context, event);
                self.active_patch_paths = paths.clone();
                self.snapshot_paths(&paths);
                let changes = array_field(data, "changes")
                    .filter(|values| !values.is_empty())
                    .or_else(|| array_field(data, "files").filter(|values| !values.is_empty()))
                    .cloned()
                    .unwrap_or_else(|| paths.iter().map(|path| json!(path)).collect());
                let payload = json!({ "changes": changes });
                self.emit_tool_status_and_activity(context, "patch", &payload);
                self.start_tool(context, "patch", payload);
            }
            ("patch_apply_end", _) => {
                self.close_tool(context);
                let paths = file_change_paths(context, event);
                let paths = if paths.is_empty() {
                    self.active_patch_paths.clone()
                } else {
                    paths
                };
                self.emit_diffs_for_paths(context, &paths);
                self.active_patch_paths.clear();
            }
            ("web_search_begin", _) => {
                let payload = json!({ "query": string_field(data, "query") });
                self.emit_tool_status_and_activity(context, "web_search", &payload);
                self.start_tool(context, "web_search", payload);
            }
            ("web_search_end", _) => {
                self.tool_delta(context, string_field(data, "query"));
                self.close_tool(context);
            }
            ("mcp_tool_call_begin", _) => {
                let invocation = data.get("invocation").and_then(Value::as_object);
                let tool_name = invocation
                    .map(|invocation| first_string(invocation, &["tool"]))
                    .filter(|tool| !tool.is_empty())
                    .or_else(|| {
                        let tool = string_field(data, "tool");
                        (!tool.is_empty()).then(|| tool.into())
                    })
                    .unwrap_or_else(|| "mcp_tool".into());
                let payload = invocation
                    .and_then(|invocation| invocation.get("arguments"))
                    .or_else(|| data.get("arguments"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                self.emit_tool_status_and_activity(context, &tool_name, &payload);
                self.start_tool(context, &tool_name, payload);
            }
            ("mcp_tool_call_end", _) => self.close_tool(context),
            ("item.completed", "error") => {
                let message = item_record.map_or("", |item| string_field(item, "message"));
                if !message.is_empty() {
                    self.emit_error(context, message);
                }
            }
            // App Server reports the submitted prompt as a completed item too.
            // It is input, not assistant output, and the chat runtime already
            // owns the canonical user transcript row.
            ("item.completed", "user_message" | "userMessage") => {
                let text = item_record
                    .map(|item| string_field(item, "text"))
                    .filter(|text| !text.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| extract_text(item));
                if !text.is_empty() {
                    context
                        .emissions
                        .push(ProtocolEmission::UserInputAcknowledged { text });
                }
            }
            ("item.completed", _) if !item.is_null() && !extract_text(item).is_empty() => {
                let text = extract_text(item);
                if !self.saw_assistant_stream {
                    self.emit_result(context, &text);
                    self.has_final_assistant_message = true;
                }
            }
            ("error", _) if !string_field(data, "message").is_empty() => {
                self.emit_error(context, string_field(data, "message"));
            }
            ("task_complete", _) => {
                self.completed_from_event = true;
                let final_text = string_field(data, "last_agent_message");
                if !final_text.is_empty() {
                    self.last_assistant_message =
                        truncate_chat_content(final_text, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
                }
                if !final_text.is_empty() && !self.saw_assistant_stream {
                    self.emit_result(context, final_text);
                    self.has_final_assistant_message = true;
                }
            }
            _ if is_generic_assistant_event(event_type, &event_text) => {
                self.assistant_delta(context, &event_text);
                self.emit_status(context, "responding", true);
                context
                    .emissions
                    .push(ProtocolEmission::Agent(AgentEvent::Status {
                        status: "responding".into(),
                        label: None,
                    }));
            }
            _ => {}
        }
    }

    pub fn clear_live_diff_state(&mut self) {
        self.watched_paths.clear();
        self.file_snapshots.clear();
        self.active_patch_paths.clear();
    }

    /// Ends an in-progress assistant text block before a client appends new
    /// user input to the active turn. Subsequent model text starts a fresh
    /// assistant block after the steering message.
    pub fn prepare_for_steering(&mut self, context: &mut AgentProtocolContext) {
        self.close_assistant(context);
    }

    pub fn finalize_open_block(&mut self, context: &mut AgentProtocolContext) {
        if !(self.tool_open || self.assistant_open) {
            return;
        }
        if let Some(tool_call_id) = self.current_tool_id.take() {
            context
                .emissions
                .push(ProtocolEmission::Agent(AgentEvent::ToolCallEnd {
                    tool_call_id,
                    output: None,
                    error: None,
                }));
        }
        context.emissions.push(ProtocolEmission::Chat(
            json!({ "type": "content_block_stop" }),
        ));
        self.tool_open = false;
        self.assistant_open = false;
        self.watched_paths.clear();
        self.file_snapshots.clear();
    }

    fn close_tool(&mut self, context: &mut AgentProtocolContext) {
        if !self.tool_open {
            return;
        }
        context.emissions.push(ProtocolEmission::Chat(
            json!({ "type": "content_block_stop" }),
        ));
        if let Some(tool_call_id) = self.current_tool_id.take() {
            context
                .emissions
                .push(ProtocolEmission::Agent(AgentEvent::ToolCallEnd {
                    tool_call_id,
                    output: None,
                    error: None,
                }));
        }
        self.tool_open = false;
    }

    fn close_assistant(&mut self, context: &mut AgentProtocolContext) {
        if !self.assistant_open {
            return;
        }
        context.emissions.push(ProtocolEmission::Chat(
            json!({ "type": "content_block_stop" }),
        ));
        self.assistant_open = false;
    }

    fn start_assistant(&mut self, context: &mut AgentProtocolContext) {
        if self.assistant_open {
            return;
        }
        self.close_tool(context);
        context.emissions.push(ProtocolEmission::Chat(json!({
            "type": "content_block_start",
            "content_block": { "type": "text", "text": "" }
        })));
        self.assistant_open = true;
        self.saw_assistant_stream = true;
        self.last_chat_block_role = Some(ChatBlockRole::Assistant);
    }

    fn start_tool(&mut self, context: &mut AgentProtocolContext, name: &str, input: Value) {
        self.close_assistant(context);
        self.close_tool(context);
        let tool_call_id = format!(
            "{name}:{}:{}",
            epoch_millis(),
            &uuid::Uuid::new_v4().simple().to_string()[..6]
        );
        context.emissions.push(ProtocolEmission::Chat(json!({
            "type": "content_block_start",
            "content_block": { "type": "tool_use", "name": name, "input": input }
        })));
        context
            .emissions
            .push(ProtocolEmission::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tool_call_id.clone(),
                tool_name: name.into(),
                input: Some(input.clone()),
                summary: Some(summarize_tool_input(name, &input)),
            }));
        self.tool_open = true;
        self.current_tool_id = Some(tool_call_id);
        self.last_chat_block_role = Some(ChatBlockRole::Tool);
    }

    fn tool_delta(&mut self, context: &mut AgentProtocolContext, delta: &str) {
        if !self.tool_open || delta.is_empty() {
            return;
        }
        context.emissions.push(ProtocolEmission::Chat(json!({
            "type": "content_block_delta",
            "delta": { "type": "input_json_delta", "partial_json": delta }
        })));
        if let Some(tool_call_id) = &self.current_tool_id {
            context
                .emissions
                .push(ProtocolEmission::Agent(AgentEvent::ToolCallDelta {
                    tool_call_id: tool_call_id.clone(),
                    delta: delta.into(),
                }));
        }
    }

    fn assistant_delta(&mut self, context: &mut AgentProtocolContext, delta: &str) {
        if delta.is_empty() {
            return;
        }
        self.start_assistant(context);
        context.emissions.push(ProtocolEmission::Chat(json!({
            "type": "content_block_delta",
            "delta": { "type": "text_delta", "text": delta }
        })));
        context
            .emissions
            .push(ProtocolEmission::Agent(AgentEvent::TextDelta {
                text: delta.into(),
                message_id: None,
            }));
        self.last_assistant_message = append_bounded_chat_content(
            &self.last_assistant_message,
            delta,
            CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
        );
        self.has_final_assistant_message = true;
    }

    fn complete_assistant_message(&mut self, context: &mut AgentProtocolContext, text: &str) {
        match resolve_completed_codex_assistant_message(&self.last_assistant_message, text) {
            CompletedAssistantMessage::Delta(delta) => {
                self.assistant_delta(context, &delta);
                self.close_assistant(context);
            }
            CompletedAssistantMessage::Replace => {
                self.close_assistant(context);
                self.emit_result(context, text);
            }
            CompletedAssistantMessage::Skip => self.close_assistant(context),
        }
        self.last_assistant_message = truncate_chat_content(text, CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
        self.has_final_assistant_message = true;
        self.last_chat_block_role = Some(ChatBlockRole::Assistant);
    }

    fn emit_result(&self, context: &mut AgentProtocolContext, text: &str) {
        context.emissions.push(ProtocolEmission::Chat(
            json!({ "type": "result", "result": text }),
        ));
        context
            .emissions
            .push(ProtocolEmission::Agent(AgentEvent::Result {
                text: text.into(),
            }));
    }

    fn emit_error(&self, context: &mut AgentProtocolContext, message: &str) {
        context
            .emissions
            .push(ProtocolEmission::Agent(AgentEvent::Error {
                message: message.into(),
            }));
        context
            .emissions
            .push(ProtocolEmission::System(message.into()));
    }

    fn emit_status(&self, context: &mut AgentProtocolContext, status: &str, is_loading: bool) {
        context.emissions.push(ProtocolEmission::Status {
            status: status.into(),
            is_loading,
        });
    }

    fn emit_tool_status_and_activity(
        &self,
        context: &mut AgentProtocolContext,
        tool_name: &str,
        payload: &Value,
    ) {
        self.emit_status(context, &format!("tool:{tool_name}"), true);
        context.emissions.push(ProtocolEmission::Activity {
            tool_name: tool_name.into(),
            summary: summarize_tool_input(tool_name, payload),
            is_streaming: true,
        });
    }

    fn emit_command_output_delta(&mut self, context: &mut AgentProtocolContext, item: &Value) {
        let Some(item) = item.as_object() else { return };
        let next_output = string_field(item, "aggregated_output");
        if next_output.is_empty() {
            return;
        }
        let item_id = {
            let item_id = string_field(item, "id");
            if item_id.is_empty() {
                "latest"
            } else {
                item_id
            }
        };
        let previous = self.command_outputs.get(item_id).map_or("", String::as_str);
        let delta = next_output.strip_prefix(previous).unwrap_or(next_output);
        self.tool_delta(context, delta);
        self.command_outputs
            .insert(item_id.into(), next_output.into());
    }

    fn snapshot_paths(&mut self, paths: &[PathBuf]) {
        for path in paths {
            self.file_snapshots
                .insert(path.clone(), read_snapshot(path));
            self.watched_paths.insert(path.clone());
        }
    }

    fn emit_diffs_for_paths(&mut self, context: &mut AgentProtocolContext, paths: &[PathBuf]) {
        let mut unique = HashSet::new();
        for path in paths {
            if unique.insert(path.clone()) {
                self.emit_live_diff_for_path(context, path, false);
            }
        }
    }

    fn emit_live_diff_for_path(
        &mut self,
        context: &mut AgentProtocolContext,
        path: &Path,
        keep_watching: bool,
    ) {
        let before = self.file_snapshots.get(path).cloned().flatten();
        let after = read_snapshot(path);
        if let (Some(before), Some(after)) = (before.as_deref(), after.as_deref())
            && before != after
        {
            self.emit_edit_diff(context, path, before, after);
            self.file_snapshots
                .insert(path.to_path_buf(), Some(after.into()));
        }
        if !keep_watching {
            self.watched_paths.remove(path);
            self.file_snapshots.remove(path);
        }
    }

    fn emit_edit_diff(
        &mut self,
        context: &mut AgentProtocolContext,
        path: &Path,
        before: &str,
        after: &str,
    ) {
        if before == after || javascript_length(before) + javascript_length(after) > 80_000 {
            return;
        }
        let input = json!({
            "file_path": display_path(context, path),
            "old_string": before,
            "new_string": after,
        });
        self.start_tool(context, "Edit", input);
        self.close_tool(context);
    }
}

fn unwrap_codex_event(event: &Value) -> &Value {
    if event.get("type").and_then(Value::as_str) == Some("event_msg")
        && event
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|payload| payload.get("type"))
            .and_then(Value::as_str)
            .is_some()
    {
        event.get("payload").unwrap_or(event)
    } else {
        event
    }
}

fn string_field<'a>(record: &'a serde_json::Map<String, Value>, key: &str) -> &'a str {
    record.get(key).and_then(Value::as_str).unwrap_or("")
}

fn first_string(record: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| {
            let value = string_field(record, key);
            (!value.is_empty()).then(|| value.to_string())
        })
        .unwrap_or_default()
}

fn array_field<'a>(
    record: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Option<&'a Vec<Value>> {
    record.get(key).and_then(Value::as_array)
}

fn extract_text(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.into();
    }
    let Some(record) = value.as_object() else {
        return String::new();
    };
    let text = first_string(
        record,
        &[
            "text",
            "message",
            "content",
            "delta",
            "last_agent_message",
            "output_text",
        ],
    );
    if !text.is_empty() {
        return text;
    }
    record
        .get("content")
        .and_then(Value::as_array)
        .map(|content| content.iter().map(extract_text).collect::<String>())
        .unwrap_or_default()
}

fn workspace_path(context: &AgentProtocolContext, value: &str) -> Option<PathBuf> {
    if value.is_empty() {
        return None;
    }
    let candidate = Path::new(value);
    let candidate = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        context.cwd.join(candidate)
    };
    let candidate = resolve_lexically(&candidate).ok()?;
    workspace_roots(&context.cwd, &context.reference_paths)
        .iter()
        .any(|root| is_within_directory(&candidate, root))
        .then_some(candidate)
}

fn file_change_paths(context: &AgentProtocolContext, value: &Value) -> Vec<PathBuf> {
    let Some(record) = value.as_object() else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    for key in ["changes", "files"] {
        if let Some(values) = record.get(key).and_then(Value::as_object) {
            candidates.extend(values.keys().cloned());
        }
        if let Some(values) = array_field(record, key) {
            for value in values {
                if let Some(path) = value.as_str() {
                    candidates.push(path.to_string());
                } else if let Some(value) = value.as_object() {
                    candidates.push(first_string(value, &["path", "file_path", "file"]));
                }
            }
        }
    }
    candidates.push(first_string(record, &["path", "file_path", "file"]));
    let mut unique = HashSet::new();
    candidates
        .into_iter()
        .filter_map(|path| workspace_path(context, &path))
        .filter(|path| unique.insert(path.clone()))
        .collect()
}

fn display_path(context: &AgentProtocolContext, absolute_path: &Path) -> String {
    let cwd = resolve_lexically(&context.cwd).unwrap_or_else(|_| context.cwd.clone());
    for root in workspace_roots(&context.cwd, &context.reference_paths) {
        let Ok(relative) = absolute_path.strip_prefix(&root) else {
            continue;
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        if root == cwd {
            return relative.to_string_lossy().into_owned();
        }
        let basename = root
            .file_name()
            .unwrap_or(root.as_os_str())
            .to_string_lossy();
        return format!("{basename}/{}", relative.to_string_lossy());
    }
    absolute_path.to_string_lossy().into_owned()
}

fn display_paths(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

fn read_snapshot(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 80_000 {
        return None;
    }
    std::fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn is_generic_assistant_event(event_type: &str, text: &str) -> bool {
    !text.is_empty()
        && ["message", "assistant", "output_text", "text_delta"]
            .iter()
            .any(|part| event_type.contains(part))
        && ![
            "error",
            "tool",
            "exec_command",
            "patch",
            "web_search",
            "mcp",
        ]
        .iter()
        .any(|part| event_type.contains(part))
}

fn epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn normalize_claude_event(event: &Value) -> Option<AgentEvent> {
    let data = event.as_object()?;
    let event_type = data.get("type").and_then(Value::as_str)?;
    if event_type == "content_block_start" {
        let block = data.get("content_block")?.as_object()?;
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = block.get("text").and_then(Value::as_str)?;
                if !text.is_empty() {
                    return Some(AgentEvent::TextDelta {
                        text: text.to_string(),
                        message_id: None,
                    });
                }
            }
            Some("tool_use") => {
                let tool_name =
                    javascript_string(block.get("name").unwrap_or(&Value::String("tool".into())));
                let input = block.get("input").cloned().unwrap_or_else(|| json!({}));
                let tool_call_id = data
                    .get("index")
                    .or_else(|| block.get("id"))
                    .map(javascript_string)
                    .unwrap_or_else(|| format!("{tool_name}:latest"));
                return Some(AgentEvent::ToolCallStart {
                    tool_call_id,
                    tool_name: tool_name.clone(),
                    input: Some(input.clone()),
                    summary: Some(summarize_tool_input(&tool_name, &input)),
                });
            }
            _ => {}
        }
    }
    if event_type == "content_block_delta" {
        let delta = data.get("delta")?.as_object()?;
        match delta.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                return Some(AgentEvent::TextDelta {
                    text: delta.get("text").and_then(Value::as_str)?.to_string(),
                    message_id: None,
                });
            }
            Some("thinking_delta") => {
                return Some(AgentEvent::ThinkingDelta {
                    text: delta.get("thinking").and_then(Value::as_str)?.to_string(),
                    message_id: None,
                });
            }
            Some("input_json_delta") => {
                return Some(AgentEvent::ToolCallDelta {
                    tool_call_id: data
                        .get("index")
                        .map(javascript_string)
                        .unwrap_or_else(|| "latest".into()),
                    delta: delta
                        .get("partial_json")
                        .and_then(Value::as_str)?
                        .to_string(),
                });
            }
            _ => {}
        }
    }
    if event_type == "result" {
        return Some(AgentEvent::Result {
            text: data.get("result").and_then(Value::as_str)?.to_string(),
        });
    }
    if event_type == "error" {
        return Some(AgentEvent::Error {
            message: data.get("message").and_then(Value::as_str)?.to_string(),
        });
    }
    if event_type == "system" && data.get("subtype").and_then(Value::as_str) == Some("init") {
        return Some(AgentEvent::Raw {
            provider: "claude".into(),
            event_type: Some("system".into()),
            event: Some(event.clone()),
        });
    }
    None
}

pub fn is_chat_stream_event(value: &Value) -> bool {
    value
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|event_type| {
            matches!(
                event_type,
                "assistant"
                    | "content_block_start"
                    | "content_block_delta"
                    | "content_block_stop"
                    | "result"
            )
        })
}

pub fn build_claude_invocation_args(
    binary: &Path,
    prompt: &str,
    model: Option<&str>,
    session_id: Option<&str>,
) -> Vec<String> {
    let mut arguments = vec![
        binary.to_string_lossy().into_owned(),
        "-p".into(),
        prompt.into(),
        "--dangerously-skip-permissions".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
    ];
    if let Some(model) = model {
        arguments.extend(["--model".into(), model.into()]);
    }
    if let Some(session_id) = session_id {
        arguments.extend(["--resume".into(), session_id.into()]);
    }
    arguments
}

pub fn workspace_roots(cwd: &Path, reference_paths: &[PathBuf]) -> Vec<PathBuf> {
    let cwd_root = resolve_lexically(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let mut roots = vec![cwd_root.clone()];
    for path in reference_paths {
        let Ok(path) = resolve_lexically(path) else {
            continue;
        };
        let root = if path.is_dir() {
            path
        } else if path.is_file() {
            path.parent().map(Path::to_path_buf).unwrap_or(path)
        } else {
            continue;
        };
        if is_within_directory(&root, &cwd_root)
            || roots
                .iter()
                .any(|existing_root| is_within_directory(&root, existing_root))
        {
            continue;
        }
        roots.push(root);
    }
    roots
}

pub fn resolve_completed_codex_assistant_message(
    streamed_text: &str,
    completed_text: &str,
) -> CompletedAssistantMessage {
    if completed_text.is_empty() || completed_text == streamed_text {
        CompletedAssistantMessage::Skip
    } else if streamed_text.is_empty() {
        CompletedAssistantMessage::Delta(completed_text.into())
    } else if let Some(delta) = completed_text.strip_prefix(streamed_text) {
        CompletedAssistantMessage::Delta(delta.into())
    } else {
        CompletedAssistantMessage::Replace
    }
}

pub fn should_emit_codex_output_fallback(
    output_text: &str,
    last_assistant_message: &str,
    has_final_assistant_message: bool,
    last_chat_block_role: Option<&str>,
) -> bool {
    if output_text.is_empty() {
        return false;
    }
    if has_final_assistant_message && output_text.trim() == last_assistant_message.trim() {
        return false;
    }
    !has_final_assistant_message || last_chat_block_role != Some("assistant")
}

pub fn summarize_tool_input(tool_name: &str, input: &Value) -> String {
    let action = tool_action_label(tool_name);
    let Some(payload) = input.as_object() else {
        return action;
    };
    let command = nullish_value(payload.get("command"), payload.get("cmd"));
    if let Some(command) = command
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return format!("{action}: {}", trim_summary(command, 64));
    }
    if let Some(query) = payload
        .get("query")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return format!("{action}: {}", trim_summary(query, 64));
    }
    let path = nullish_value(
        payload.get("path"),
        nullish_value(payload.get("file"), payload.get("file_path")),
    );
    if let Some(path) = path
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return format!("{action}: {}", javascript_basename(path));
    }
    let files = nullish_value(payload.get("files"), payload.get("changes"));
    let Some(files) = files
        .and_then(Value::as_array)
        .filter(|files| !files.is_empty())
    else {
        return action;
    };
    let first_path = match &files[0] {
        Value::String(path) => Some(path.as_str()),
        Value::Object(first) => nullish_value(
            first.get("path"),
            nullish_value(first.get("file"), first.get("file_path")),
        )
        .and_then(Value::as_str),
        _ => None,
    };
    if let Some(first_path) = first_path.filter(|value| !value.is_empty()) {
        let basename = javascript_basename(first_path);
        let file_summary = if files.len() == 1 {
            basename.to_string()
        } else {
            format!("{basename} +{}", files.len() - 1)
        };
        return format!("{action}: {file_summary}");
    }
    format!("{action}: {} changes", files.len())
}

pub fn truncate_agent_result(value: &str) -> String {
    truncate_chat_content(value, crate::chat_protocol::CHAT_SINGLE_MESSAGE_CHAR_LIMIT)
}

fn tool_action_label(tool_name: &str) -> String {
    match tool_name.trim().to_lowercase().as_str() {
        "exec" | "bash" | "command_execution" => "Running command".into(),
        "patch" | "apply_patch" | "file_change" => "Applying changes".into(),
        "web_search" | "websearch" | "webfetch" => "Searching web".into(),
        "grep" | "glob" => "Searching files".into(),
        "read" | "read_file" | "view" => "Reading".into(),
        "edit" => "Editing".into(),
        "write" => "Writing file".into(),
        _ => format!("Using {tool_name}"),
    }
}

fn trim_summary(value: &str, max: usize) -> String {
    if javascript_length(value) > max {
        format!("{}...", javascript_slice(value, 0, max))
    } else {
        value.into()
    }
}

fn javascript_basename(value: &str) -> &str {
    value
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(value)
}

fn nullish_value<'a>(first: Option<&'a Value>, second: Option<&'a Value>) -> Option<&'a Value> {
    match first {
        Some(Value::Null) | None => second,
        value => value,
    }
}

fn javascript_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(javascript_string)
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

fn javascript_slice(value: &str, start: usize, end: usize) -> String {
    let units = value.encode_utf16().collect::<Vec<_>>();
    String::from_utf16_lossy(&units[start.min(units.len())..end.min(units.len())])
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn normalizes_claude_text_tools_thinking_results_and_init_events() {
        assert_eq!(
            normalize_claude_event(&json!({
                "type": "content_block_start",
                "index": 2,
                "content_block": {
                    "type": "tool_use",
                    "name": "Edit",
                    "input": { "file_path": "src/app.ts" }
                }
            })),
            Some(AgentEvent::ToolCallStart {
                tool_call_id: "2".into(),
                tool_name: "Edit".into(),
                input: Some(json!({ "file_path": "src/app.ts" })),
                summary: Some("Editing: app.ts".into()),
            })
        );
        assert_eq!(
            normalize_claude_event(&json!({
                "type": "content_block_delta",
                "delta": { "type": "thinking_delta", "thinking": "hmm" }
            })),
            Some(AgentEvent::ThinkingDelta {
                text: "hmm".into(),
                message_id: None
            })
        );
        assert!(matches!(
            normalize_claude_event(&json!({ "type": "system", "subtype": "init" })),
            Some(AgentEvent::Raw { provider, .. }) if provider == "claude"
        ));
    }

    #[test]
    fn matches_codex_completion_and_output_fallback_rules() {
        assert_eq!(
            resolve_completed_codex_assistant_message("done", "done"),
            CompletedAssistantMessage::Skip
        );
        assert_eq!(
            resolve_completed_codex_assistant_message("partial", "partial answer"),
            CompletedAssistantMessage::Delta(" answer".into())
        );
        assert_eq!(
            resolve_completed_codex_assistant_message("draft", "final"),
            CompletedAssistantMessage::Replace
        );
        assert!(!should_emit_codex_output_fallback(
            "same",
            " same ",
            true,
            Some("tool")
        ));
        assert!(should_emit_codex_output_fallback(
            "recovered",
            "earlier",
            true,
            Some("tool")
        ));
    }

    #[test]
    fn codex_user_items_acknowledge_input_without_echoing_assistant_results() {
        for item_type in ["userMessage", "user_message"] {
            let mut state = CodexProtocolState::default();
            let mut context = AgentProtocolContext::new("/tmp");
            state.handle_event(
                &mut context,
                &json!({
                    "type": "item.completed",
                    "item": { "type": item_type, "text": "do not echo me" }
                }),
            );
            assert_eq!(
                context.emissions,
                vec![ProtocolEmission::UserInputAcknowledged {
                    text: "do not echo me".into()
                }]
            );
            assert!(state.last_assistant_message.is_empty());
        }
    }

    #[test]
    fn codex_file_change_streams_patch_then_inline_edit() {
        let root = TempDir::new().unwrap();
        let source = root.path().join("src/main.rs");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(&source, "fn answer() -> u8 { 41 }\n").unwrap();
        let mut state = CodexProtocolState::default();
        let mut context = AgentProtocolContext::new(root.path());
        let started = json!({
            "type": "item.started",
            "item": {
                "type": "file_change",
                "id": "change-1",
                "changes": [{ "path": "src/main.rs", "kind": "update" }]
            }
        });
        state.handle_event(&mut context, &started);

        std::fs::write(&source, "fn answer() -> u8 { 42 }\n").unwrap();
        state.handle_event(
            &mut context,
            &json!({
                "type": "item.completed",
                "item": {
                    "type": "file_change",
                    "id": "change-1",
                    "changes": {
                        "src/main.rs": {
                            "type": "update",
                            "unified_diff": "@@ -1 +1 @@\n-fn answer() -> u8 { 41 }\n+fn answer() -> u8 { 42 }\n"
                        }
                    }
                }
            }),
        );

        assert!(context.emissions.iter().any(|emission| matches!(
            emission,
            ProtocolEmission::Agent(AgentEvent::ToolCallStart { tool_name, .. })
                if tool_name == "patch"
        )));
        assert!(context.emissions.iter().any(|emission| matches!(
            emission,
            ProtocolEmission::Chat(event)
                if event["content_block"]["name"] == "Edit"
                    && event["content_block"]["input"]["file_path"] == "src/main.rs"
                    && event["content_block"]["input"]["old_string"]
                        == "fn answer() -> u8 { 41 }\n"
                    && event["content_block"]["input"]["new_string"]
                        == "fn answer() -> u8 { 42 }\n"
        )));
    }

    #[test]
    fn summarizes_tool_inputs_with_the_existing_priority() {
        assert_eq!(
            summarize_tool_input("exec", &json!({ "command": "bun test", "path": "ignored" })),
            "Running command: bun test"
        );
        assert_eq!(
            summarize_tool_input("patch", &json!({ "changes": ["src/a.ts", "src/b.ts"] })),
            "Applying changes: a.ts +1"
        );
        assert_eq!(
            summarize_tool_input("custom", &json!({ "files": [1, 2] })),
            "Using custom: 2 changes"
        );
    }
}
