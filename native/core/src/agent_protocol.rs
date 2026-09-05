use crate::utf16_length as javascript_length;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::chat_protocol::{
    CHAT_SINGLE_MESSAGE_CHAR_LIMIT, append_bounded_chat_content, truncate_chat_content,
};
use crate::path_security::{is_within_directory, resolve_lexically};

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
    UserInputAcknowledged { text: String },
    FileChange(Vec<PathBuf>),
    Status { status: String, is_loading: bool },
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
        }
        let data = event
            .get("event")
            .filter(|_| event["type"] == "stream_event")
            .unwrap_or(event);
        if data["type"] == "result"
            && let Some(text) = data["result"].as_str()
        {
            self.last_assistant_message = truncate_agent_result(text);
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
    pub completed_from_event: bool,
    pub last_assistant_message: String,
    file_snapshots: HashMap<PathBuf, Option<String>>,
    active_patch_paths: Vec<PathBuf>,
    command_outputs: HashMap<String, String>,
}

impl CodexProtocolState {
    pub fn handle_notification(
        &mut self,
        context: &mut AgentProtocolContext,
        method: &str,
        params: &Value,
    ) {
        let item = params.get("item").unwrap_or(&Value::Null);
        let item_record = item.as_object();
        let item_type = item_record.map_or("", |item| string_field(item, "type"));

        match (method, item_type) {
            ("turn/started", _) => {
                self.emit_status(context, "thinking", true);
            }
            ("item/started", "commandExecution") => {
                let payload = json!({
                    "command": item_record.map_or("", |item| string_field(item, "command")),
                    "cwd": context.cwd,
                });
                if let Some(item) = item_record {
                    let item_id = string_field(item, "id");
                    if !item_id.is_empty() {
                        self.command_outputs.insert(
                            item_id.into(),
                            string_field(item, "aggregatedOutput").into(),
                        );
                    }
                }
                self.begin_tool(context, "exec", payload);
            }
            ("item/commandExecution/outputDelta", _) => {
                self.tool_delta(context, params["delta"].as_str().unwrap_or(""));
            }
            ("item/completed", "commandExecution") => {
                self.emit_command_output_delta(context, item);
                if let Some(item) = item_record {
                    let item_id = string_field(item, "id");
                    if !item_id.is_empty() {
                        self.command_outputs.remove(item_id);
                    }
                }
                self.close_tool(context);
            }
            ("item/started", "fileChange") => {
                let paths = file_change_paths(context, item);
                self.active_patch_paths = paths.clone();
                self.snapshot_paths(&paths);
                let changes = item
                    .get("changes")
                    .filter(|value| !value.is_null())
                    .cloned()
                    .unwrap_or_else(|| json!(display_paths(&paths)));
                let payload = json!({ "changes": changes });
                self.begin_tool(context, "patch", payload);
            }
            ("item/completed", "fileChange") => {
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
            ("item/completed", "agentMessage") => {
                let text = extract_text(item);
                if !text.is_empty() {
                    self.complete_assistant_message(context, &text);
                }
            }
            ("item/agentMessage/delta", _) => {
                self.assistant_delta(context, params["delta"].as_str().unwrap_or(""));
                self.emit_status(context, "responding", true);
            }
            ("item/completed", "error") => {
                let message = item_record.map_or("", |item| string_field(item, "message"));
                if !message.is_empty() {
                    self.emit_error(context, message);
                }
            }
            // App Server reports the submitted prompt as a completed item too.
            // It is input, not assistant output, and the chat runtime already
            // owns the canonical user transcript row.
            ("item/completed", "userMessage") => {
                let text = extract_text(item);
                if !text.is_empty() {
                    context
                        .emissions
                        .push(ProtocolEmission::UserInputAcknowledged { text });
                }
            }
            ("item/completed", _) if !item.is_null() => {
                let text = extract_text(item);
                if !self.saw_assistant_stream && !text.is_empty() {
                    self.emit_result(context, &text);
                }
            }
            ("error", _) => {
                if let Some(message) = params
                    .pointer("/error/message")
                    .or_else(|| params.get("message"))
                    .and_then(Value::as_str)
                    .filter(|message| !message.is_empty())
                {
                    self.emit_error(context, message);
                }
            }
            ("turn/completed", _) => {
                if params.pointer("/turn/status").and_then(Value::as_str) == Some("failed")
                    && let Some(message) = params
                        .pointer("/turn/error/message")
                        .and_then(Value::as_str)
                {
                    if !message.is_empty() {
                        self.emit_error(context, message);
                    }
                } else {
                    self.completed_from_event = true;
                }
            }
            _ => {}
        }
    }

    pub fn set_session(&mut self, context: &mut AgentProtocolContext, thread_id: String) {
        if thread_id.is_empty() {
            return;
        }
        context.session_id = Some(thread_id.clone());
        context.emissions.push(ProtocolEmission::Session(thread_id));
    }

    pub fn begin_tool(&mut self, context: &mut AgentProtocolContext, name: &str, input: Value) {
        self.emit_status(context, &format!("tool:{name}"), true);
        self.start_tool(context, name, input);
    }

    pub fn clear_live_diff_state(&mut self) {
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
        context.emissions.push(ProtocolEmission::Chat(
            json!({ "type": "content_block_stop" }),
        ));
        self.tool_open = false;
        self.assistant_open = false;
        self.file_snapshots.clear();
    }

    pub fn close_tool(&mut self, context: &mut AgentProtocolContext) {
        if !self.tool_open {
            return;
        }
        context.emissions.push(ProtocolEmission::Chat(
            json!({ "type": "content_block_stop" }),
        ));
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
    }

    fn start_tool(&mut self, context: &mut AgentProtocolContext, name: &str, input: Value) {
        self.close_assistant(context);
        self.close_tool(context);
        context.emissions.push(ProtocolEmission::Chat(json!({
            "type": "content_block_start",
            "content_block": { "type": "tool_use", "name": name, "input": input }
        })));

        self.tool_open = true;
    }

    fn tool_delta(&mut self, context: &mut AgentProtocolContext, delta: &str) {
        if !self.tool_open || delta.is_empty() {
            return;
        }
        context.emissions.push(ProtocolEmission::Chat(json!({
            "type": "content_block_delta",
            "delta": { "type": "input_json_delta", "partial_json": delta }
        })));
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

        self.last_assistant_message = append_bounded_chat_content(
            &self.last_assistant_message,
            delta,
            CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
        );
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
    }

    fn emit_result(&self, context: &mut AgentProtocolContext, text: &str) {
        context.emissions.push(ProtocolEmission::Chat(
            json!({ "type": "result", "result": text }),
        ));
    }

    fn emit_error(&self, context: &mut AgentProtocolContext, message: &str) {
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

    fn emit_command_output_delta(&mut self, context: &mut AgentProtocolContext, item: &Value) {
        let Some(item) = item.as_object() else { return };
        let next_output = string_field(item, "aggregatedOutput");
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
        }
    }

    fn emit_diffs_for_paths(&mut self, context: &mut AgentProtocolContext, paths: &[PathBuf]) {
        let mut unique = HashSet::new();
        for path in paths {
            if unique.insert(path.clone()) {
                self.emit_live_diff_for_path(context, path);
            }
        }
    }

    fn emit_live_diff_for_path(&mut self, context: &mut AgentProtocolContext, path: &Path) {
        let before = self.file_snapshots.remove(path).flatten();
        let after = read_snapshot(path);
        if let (Some(before), Some(after)) = (before.as_deref(), after.as_deref())
            && before != after
        {
            self.emit_edit_diff(context, path, before, after);
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

pub fn truncate_agent_result(value: &str) -> String {
    truncate_chat_content(value, crate::chat_protocol::CHAT_SINGLE_MESSAGE_CHAR_LIMIT)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn claude_tool_calls_preserve_transcript_input() {
        let mut context = AgentProtocolContext::new("/tmp");
        ClaudeProtocolState::default().handle_event(&mut context, &json!({
            "type":"content_block_start", "index":2,
            "content_block":{"type":"tool_use", "name":"Edit", "input":{"file_path":"src/app.ts"}}
        }));
        assert!(context.emissions.iter().any(|event| matches!(event,
            ProtocolEmission::Chat(value) if value["content_block"]["input"]["file_path"] == "src/app.ts"
        )));
    }

    #[test]
    fn reconciles_codex_completion() {
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
    }

    #[test]
    fn codex_notifications_preserve_completion_and_error_contracts() {
        for (method, params, completed, message) in [
            ("turn/completed", Value::Null, true, None),
            (
                "turn/completed",
                json!({"turn":{"status":"completed"}}),
                true,
                None,
            ),
            (
                "turn/completed",
                json!({"turn":{"status":"failed","error":{"message":"failed turn"}}}),
                false,
                Some("failed turn"),
            ),
            (
                "turn/completed",
                json!({"turn":{"status":"failed"}}),
                true,
                None,
            ),
            (
                "error",
                json!({"error":{"message":"provider error"}}),
                false,
                Some("provider error"),
            ),
            (
                "error",
                json!({"message":"direct error"}),
                false,
                Some("direct error"),
            ),
        ] {
            let mut state = CodexProtocolState::default();
            let mut context = AgentProtocolContext::new("/tmp");
            state.handle_notification(&mut context, method, &params);
            assert_eq!(state.completed_from_event, completed, "{method}: {params}");
            assert_eq!(
                context.emissions,
                message
                    .map(|message| ProtocolEmission::System(message.into()))
                    .into_iter()
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn codex_user_items_acknowledge_input_without_echoing_assistant_results() {
        for content in [
            json!({"text":"do not echo me"}),
            json!({"content":[{"text":"do not echo me"}]}),
        ] {
            let mut state = CodexProtocolState::default();
            let mut context = AgentProtocolContext::new("/tmp");
            let mut item = content;
            item["type"] = json!("userMessage");
            state.handle_notification(&mut context, "item/completed", &json!({"item":item}));
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
            "item": {
                "type": "fileChange",
                "id": "change-1",
                "changes": [{ "path": "src/main.rs", "kind": "update" }]
            }
        });
        state.handle_notification(&mut context, "item/started", &started);

        std::fs::write(&source, "fn answer() -> u8 { 42 }\n").unwrap();
        state.handle_notification(
            &mut context,
            "item/completed",
            &json!({
                "item": {
                    "type": "fileChange",
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
            ProtocolEmission::Status { status, is_loading: true }
                if status == "tool:patch"
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
}
