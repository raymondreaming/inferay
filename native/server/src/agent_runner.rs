//! Direct Claude and Codex child-process runners.
//!
//! This is a faithful process-boundary port of the former Bun adapters. The
//! caller owns transport-specific broadcasting by draining `ProtocolEmission`s;
//! no JavaScript process or reverse IPC is involved.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use inferay_core::agent_protocol::{
    AgentEvent, AgentProtocolContext, ClaudeProtocolState, CodexInvocationContext,
    CodexProtocolState, ProtocolEmission, build_claude_invocation_args,
};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

const MAX_STREAM_CHARS: usize = 64_000;

pub trait PidTracker: Send + Sync {
    fn track_pid(&self, pid: u32);
    fn untrack_pid(&self, pid: u32);
    fn kill_pid_tree(&self, pid: u32);
}

/// Process control shared with the session owner while `run_*` is awaiting.
#[derive(Clone, Default)]
pub struct AgentProcessHandle {
    pid: Arc<AtomicU32>,
    cancelled: Arc<AtomicBool>,
    codex_control: Arc<Mutex<Option<mpsc::UnboundedSender<CodexControl>>>>,
}

pub(crate) enum CodexControl {
    Steer {
        text: String,
        images: Vec<PathBuf>,
        response: oneshot::Sender<Result<(), String>>,
    },
    Interrupt,
}

impl AgentProcessHandle {
    pub fn pid(&self) -> Option<u32> {
        match self.pid.load(Ordering::Acquire) {
            0 => None,
            pid => Some(pid),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    /// Claude's graceful stop contract: SIGINT now and again after 150ms.
    pub fn stop_claude(&self) {
        self.cancelled.store(true, Ordering::Release);
        let Some(pid) = self.pid() else { return };
        signal_interrupt(pid);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            signal_interrupt(pid);
        });
    }

    /// Appends input to the currently running Codex turn. This is the same
    /// active-turn steering contract used by Codex's own rich clients; it does
    /// not create a second turn or wait in Inferay's persisted queue.
    pub async fn steer_codex(&self, text: String, images: Vec<PathBuf>) -> Result<(), String> {
        let sender = self
            .codex_control
            .lock()
            .expect("codex control lock")
            .clone()
            .ok_or_else(|| "Codex turn is not steerable".to_string())?;
        let (response, receiver) = oneshot::channel();
        sender
            .send(CodexControl::Steer {
                text,
                images,
                response,
            })
            .map_err(|_| "Codex turn has already ended".to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await
            .map_err(|_| "Codex steering timed out".to_string())?
            .map_err(|_| "Codex turn ended before steering completed".to_string())?
    }

    pub fn stop_codex(&self) -> bool {
        self.cancelled.store(true, Ordering::Release);
        self.codex_control
            .lock()
            .expect("codex control lock")
            .as_ref()
            .is_some_and(|sender| sender.send(CodexControl::Interrupt).is_ok())
    }

    pub fn kill(&self, tracker: &dyn PidTracker) {
        self.cancelled.store(true, Ordering::Release);
        self.clear_codex_control();
        if let Some(pid) = self.pid() {
            tracker.kill_pid_tree(pid);
        }
    }

    fn set_pid(&self, pid: Option<u32>) {
        self.pid.store(pid.unwrap_or(0), Ordering::Release);
    }

    pub(crate) fn set_codex_control(&self, sender: mpsc::UnboundedSender<CodexControl>) {
        *self.codex_control.lock().expect("codex control lock") = Some(sender);
    }

    fn clear_codex_control(&self) {
        self.codex_control
            .lock()
            .expect("codex control lock")
            .take();
    }
}

pub struct ClaudeRun<'a> {
    pub binary: &'a Path,
    pub prompt: &'a str,
    pub developer_instructions: Option<&'a str>,
    pub cwd: &'a Path,
    pub model: Option<&'a str>,
    pub session_id: Option<&'a str>,
    pub env: &'a HashMap<OsString, OsString>,
}

pub struct CodexRun<'a> {
    pub binary: &'a Path,
    pub prompt: &'a str,
    pub invocation: &'a CodexInvocationContext,
    pub env: &'a HashMap<OsString, OsString>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentRunResult {
    pub last_assistant_message: String,
}

pub async fn run_claude(
    run: ClaudeRun<'_>,
    handle: &AgentProcessHandle,
    context: &mut AgentProtocolContext,
    emissions: Option<&tokio::sync::mpsc::UnboundedSender<ProtocolEmission>>,
) -> AgentRunResult {
    let arguments = claude_invocation_args(&run);
    let spawn = spawn_direct(&arguments, run.cwd, run.env);
    let mut child = match spawn {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions);
            return AgentRunResult::default();
        }
    };
    handle.set_pid(child.id());
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut line = Vec::new();
    let mut protocol = ClaudeProtocolState::default();

    loop {
        line.clear();
        match stdout.read_until(b'\n', &mut line).await {
            Ok(0) => break,
            Ok(_) => {
                if let Some(event) = parse_ndjson(&line) {
                    protocol.handle_event(context, &event);
                    flush_emissions(context, emissions);
                }
            }
            Err(error) => {
                if !handle.is_cancelled() {
                    emit_error(context, error.to_string());
                }
                break;
            }
        }
    }
    let exit = child.wait().await;
    handle.set_pid(None);
    let stderr = stderr.await.unwrap_or_default().trim().to_string();
    let exit_code = exit.as_ref().ok().and_then(std::process::ExitStatus::code);
    if !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
    emit_finish(context, finish_reason(handle, exit_code, false));
    flush_emissions(context, emissions);
    AgentRunResult {
        last_assistant_message: protocol.last_assistant_message,
    }
}

fn claude_invocation_args(run: &ClaudeRun<'_>) -> Vec<String> {
    let mut arguments =
        build_claude_invocation_args(run.binary, run.prompt, run.model, run.session_id);
    if let Some(instructions) = run.developer_instructions {
        arguments.extend(["--append-system-prompt".into(), instructions.into()]);
    }
    arguments
}

pub async fn run_codex(
    run: CodexRun<'_>,
    handle: &AgentProcessHandle,
    tracker: &dyn PidTracker,
    context: &mut AgentProtocolContext,
    state: &mut CodexProtocolState,
    emissions: Option<&tokio::sync::mpsc::UnboundedSender<ProtocolEmission>>,
) -> AgentRunResult {
    let mut child = match spawn_codex_app_server(run.binary, &run.invocation.cwd, run.env) {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions);
            return AgentRunResult::default();
        }
    };
    let pid = child.id();
    handle.set_pid(pid);
    if let Some(pid) = pid {
        tracker.track_pid(pid);
    }
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut stdin = child.stdin.take().expect("piped stdin");
    let mut stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut line = Vec::new();
    let mut request_id = 1_u64;
    let initialize = json!({
        "method": "initialize",
        "id": request_id,
        "params": {
            "clientInfo": {
                "name": "inferay",
                "title": "Inferay",
                "version": env!("CARGO_PKG_VERSION")
            },
            "capabilities": null
        }
    });
    if let Err(error) = write_rpc(&mut stdin, &initialize).await {
        emit_error(context, error);
        return finish_codex_child(
            child,
            pid,
            handle,
            tracker,
            stderr,
            (&mut *context, &mut *state, emissions),
        )
        .await;
    }
    if let Err(error) = wait_for_rpc_response(
        &mut stdout,
        &mut line,
        request_id,
        (&mut *context, &mut *state, emissions),
    )
    .await
    {
        emit_error(context, error);
        return finish_codex_child(
            child,
            pid,
            handle,
            tracker,
            stderr,
            (&mut *context, &mut *state, emissions),
        )
        .await;
    }
    if let Err(error) = write_rpc(&mut stdin, &json!({"method":"initialized"})).await {
        emit_error(context, error);
        return finish_codex_child(
            child,
            pid,
            handle,
            tracker,
            stderr,
            (&mut *context, &mut *state, emissions),
        )
        .await;
    }

    request_id += 1;
    let thread_params = codex_thread_params(run.invocation);
    let (thread_method, mut thread_params) = if let Some(thread_id) = &run.invocation.session_id {
        let mut params = thread_params;
        params["threadId"] = json!(thread_id);
        ("thread/resume", params)
    } else {
        ("thread/start", thread_params)
    };
    let mut thread_response = request_rpc(
        &mut stdin,
        &mut stdout,
        &mut line,
        request_id,
        thread_method,
        thread_params.take(),
        (&mut *context, &mut *state, emissions),
    )
    .await;
    if thread_response.is_err() && thread_method == "thread/resume" {
        request_id += 1;
        thread_response = request_rpc(
            &mut stdin,
            &mut stdout,
            &mut line,
            request_id,
            "thread/start",
            codex_thread_params(run.invocation),
            (&mut *context, &mut *state, emissions),
        )
        .await;
    }
    let thread_response = match thread_response {
        Ok(response) => response,
        Err(error) => {
            emit_error(context, error);
            return finish_codex_child(
                child,
                pid,
                handle,
                tracker,
                stderr,
                (&mut *context, &mut *state, emissions),
            )
            .await;
        }
    };
    let Some(thread_id) = thread_response
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        emit_error(
            context,
            "Codex App Server did not return a thread id".into(),
        );
        return finish_codex_child(
            child,
            pid,
            handle,
            tracker,
            stderr,
            (&mut *context, &mut *state, emissions),
        )
        .await;
    };
    state.handle_event(
        context,
        &json!({"type":"thread.started", "thread_id":thread_id}),
    );
    flush_emissions(context, emissions);

    request_id += 1;
    let turn_response = match request_rpc(
        &mut stdin,
        &mut stdout,
        &mut line,
        request_id,
        "turn/start",
        codex_turn_params(&thread_id, run.prompt, run.invocation),
        (&mut *context, &mut *state, emissions),
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            emit_error(context, error);
            return finish_codex_child(
                child,
                pid,
                handle,
                tracker,
                stderr,
                (&mut *context, &mut *state, emissions),
            )
            .await;
        }
    };
    let Some(turn_id) = turn_response
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        emit_error(context, "Codex App Server did not return a turn id".into());
        return finish_codex_child(
            child,
            pid,
            handle,
            tracker,
            stderr,
            (&mut *context, &mut *state, emissions),
        )
        .await;
    };
    let (control_tx, mut control_rx) = mpsc::unbounded_channel();
    handle.set_codex_control(control_tx);
    let mut pending_steers = HashMap::<u64, oneshot::Sender<Result<(), String>>>::new();
    let mut pending_user_input: Option<(Value, Vec<String>)> = None;
    let mut completed = false;
    loop {
        tokio::select! {
            control = control_rx.recv() => {
                match control {
                    Some(CodexControl::Steer { text, images, response }) => {
                        state.prepare_for_steering(context);
                        flush_emissions(context, emissions);
                        if let Some((response_id, question_ids)) = pending_user_input.take() {
                            let answers = question_ids.into_iter().map(|question_id| {
                                (question_id, json!({"answers":[text]}))
                            }).collect::<serde_json::Map<_, _>>();
                            let result = write_rpc(&mut stdin, &json!({"id":response_id,"result":{"answers":answers}}))
                                .await
                                .map_err(|error| error.to_string());
                            if result.is_ok() {
                                state.handle_event(context, &json!({"type":"mcp_tool_call_end"}));
                                flush_emissions(context, emissions);
                            }
                            let _ = response.send(result);
                        } else {
                            request_id += 1;
                            let request = json!({
                                "method":"turn/steer",
                                "id":request_id,
                                "params":{
                                    "threadId":thread_id,
                                    "expectedTurnId":turn_id,
                                    "input":codex_user_input(&text, &images)
                                }
                            });
                            match write_rpc(&mut stdin, &request).await {
                                Ok(()) => { pending_steers.insert(request_id, response); }
                                Err(error) => { let _ = response.send(Err(error)); }
                            }
                        }
                    }
                    Some(CodexControl::Interrupt) => {
                        request_id += 1;
                        let _ = write_rpc(&mut stdin, &json!({
                            "method":"turn/interrupt",
                            "id":request_id,
                            "params":{"threadId":thread_id,"turnId":turn_id}
                        })).await;
                    }
                    None => {}
                }
            }
            read = read_rpc(&mut stdout, &mut line) => {
                let Some(message) = read else { break };
                if let Some(id) = message.get("id").and_then(Value::as_u64)
                    && let Some(response) = pending_steers.remove(&id)
                {
                    let result = rpc_result(message).map(|_| ());
                    let _ = response.send(result);
                    continue;
                }
                if message.get("method").and_then(Value::as_str) == Some("item/tool/requestUserInput")
                    && let Some(id) = message.get("id").cloned()
                {
                    let questions = message.pointer("/params/questions").and_then(Value::as_array).cloned().unwrap_or_default();
                    let question_ids = questions.iter().filter_map(|question| question.get("id").and_then(Value::as_str).map(str::to_owned)).collect();
                    pending_user_input = Some((id, question_ids));
                    state.handle_event(context, &json!({
                        "type":"mcp_tool_call_begin",
                        "invocation":{"tool":"AskUserQuestion","arguments":{"questions":questions}}
                    }));
                    flush_emissions(context, emissions);
                    continue;
                }
                let is_completed = message.get("method").and_then(Value::as_str) == Some("turn/completed");
                if let Some(event) = normalize_app_server_notification(&message) {
                    state.handle_event(context, &event);
                    flush_emissions(context, emissions);
                }
                if is_completed {
                    completed = true;
                    break;
                }
            }
        }
    }
    handle.clear_codex_control();
    for (_, response) in pending_steers {
        let _ = response.send(Err("Codex turn ended before steering completed".into()));
    }
    state.completed_from_event = completed;
    finish_codex_child(
        child,
        pid,
        handle,
        tracker,
        stderr,
        (context, state, emissions),
    )
    .await
}

fn codex_thread_params(invocation: &CodexInvocationContext) -> Value {
    json!({
        "cwd": invocation.cwd,
        "approvalPolicy": "never",
        "sandbox": "danger-full-access",
        "model": invocation.model,
        "developerInstructions": invocation.developer_instructions,
        "ephemeral": false
    })
}

fn codex_turn_params(thread_id: &str, prompt: &str, invocation: &CodexInvocationContext) -> Value {
    json!({
        "threadId": thread_id,
        "input": codex_user_input(prompt, &invocation.images),
        "cwd": invocation.cwd,
        "approvalPolicy": "never",
        "sandboxPolicy": {"type":"dangerFullAccess"},
        "model": invocation.model,
        "effort": invocation.reasoning_level.as_deref().map(normalize_reasoning_effort)
    })
}

fn normalize_reasoning_effort(value: &str) -> &str {
    if value == "extra_high" {
        "xhigh"
    } else {
        value
    }
}

fn codex_user_input(text: &str, images: &[PathBuf]) -> Vec<Value> {
    let mut input = vec![json!({"type":"text", "text":text, "text_elements":[]})];
    input.extend(
        images
            .iter()
            .map(|path| json!({"type":"localImage", "path":path})),
    );
    input
}

async fn request_rpc(
    stdin: &mut tokio::process::ChildStdin,
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    line: &mut Vec<u8>,
    id: u64,
    method: &str,
    params: Value,
    protocol: (
        &mut AgentProtocolContext,
        &mut CodexProtocolState,
        Option<&mpsc::UnboundedSender<ProtocolEmission>>,
    ),
) -> Result<Value, String> {
    write_rpc(stdin, &json!({"method":method,"id":id,"params":params})).await?;
    wait_for_rpc_response(stdout, line, id, protocol).await
}

async fn wait_for_rpc_response(
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    line: &mut Vec<u8>,
    id: u64,
    protocol: (
        &mut AgentProtocolContext,
        &mut CodexProtocolState,
        Option<&mpsc::UnboundedSender<ProtocolEmission>>,
    ),
) -> Result<Value, String> {
    let (context, state, emissions) = protocol;
    loop {
        let message =
            tokio::time::timeout(std::time::Duration::from_secs(15), read_rpc(stdout, line))
                .await
                .map_err(|_| "Codex App Server response timed out".to_string())?
                .ok_or_else(|| "Codex App Server closed before replying".to_string())?;
        if message.get("id").and_then(Value::as_u64) == Some(id) {
            return rpc_result(message);
        }
        if let Some(event) = normalize_app_server_notification(&message) {
            state.handle_event(context, &event);
            flush_emissions(context, emissions);
        }
    }
}

fn rpc_result(message: Value) -> Result<Value, String> {
    if let Some(result) = message.get("result") {
        return Ok(result.clone());
    }
    let error = message
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Codex App Server request failed");
    Err(error.to_string())
}

async fn write_rpc(stdin: &mut tokio::process::ChildStdin, message: &Value) -> Result<(), String> {
    let mut encoded = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    encoded.push(b'\n');
    stdin
        .write_all(&encoded)
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

async fn read_rpc(
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    line: &mut Vec<u8>,
) -> Option<Value> {
    loop {
        line.clear();
        match stdout.read_until(b'\n', line).await {
            Ok(0) | Err(_) => return None,
            Ok(_) => {
                if let Some(message) = parse_ndjson(line) {
                    return Some(message);
                }
            }
        }
    }
}

fn normalize_app_server_notification(message: &Value) -> Option<Value> {
    let method = message.get("method")?.as_str()?;
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "turn/started" => Some(json!({"type":"turn.started"})),
        "turn/completed" => {
            let status = params
                .pointer("/turn/status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let error = params
                .pointer("/turn/error/message")
                .and_then(Value::as_str);
            if status == "failed"
                && let Some(error) = error
            {
                Some(json!({"type":"error","message":error}))
            } else {
                Some(json!({"type":"task_complete"}))
            }
        }
        "item/started" | "item/completed" => {
            let mut item = params.get("item")?.clone();
            normalize_app_server_item(&mut item);
            let event_type = if method == "item/started" {
                "item.started"
            } else {
                "item.completed"
            };
            Some(json!({"type":event_type,"item":item}))
        }
        "item/agentMessage/delta" => Some(json!({
            "type":"agent_message_delta",
            "delta":params.get("delta").cloned().unwrap_or(Value::Null)
        })),
        "item/commandExecution/outputDelta" => Some(json!({
            "type":"command_output_delta",
            "delta":params.get("delta").cloned().unwrap_or(Value::Null)
        })),
        "error" => Some(json!({
            "type":"error",
            "message":params.pointer("/error/message").or_else(|| params.get("message")).cloned().unwrap_or(Value::Null)
        })),
        _ => None,
    }
}

fn normalize_app_server_item(item: &mut Value) {
    let Some(record) = item.as_object_mut() else {
        return;
    };
    let Some(item_type) = record.get("type").and_then(Value::as_str) else {
        return;
    };
    let normalized = match item_type {
        "agentMessage" => "agent_message",
        "userMessage" => "user_message",
        "commandExecution" => "command_execution",
        "fileChange" => "file_change",
        other => other,
    };
    record.insert("type".into(), json!(normalized));
    if let Some(output) = record.remove("aggregatedOutput") {
        record.insert("aggregated_output".into(), output);
    }
}

async fn finish_codex_child(
    mut child: tokio::process::Child,
    pid: Option<u32>,
    handle: &AgentProcessHandle,
    tracker: &dyn PidTracker,
    stderr: tokio::task::JoinHandle<String>,
    protocol: (
        &mut AgentProtocolContext,
        &mut CodexProtocolState,
        Option<&mpsc::UnboundedSender<ProtocolEmission>>,
    ),
) -> AgentRunResult {
    let (context, state, emissions) = protocol;
    handle.clear_codex_control();
    if let Some(pid) = pid {
        tracker.kill_pid_tree(pid);
    }
    let _ = child.start_kill();
    let exit = child.wait().await;
    if let Some(pid) = pid {
        tracker.untrack_pid(pid);
    }
    handle.set_pid(None);
    let stderr = stderr.await.unwrap_or_default().trim().to_string();
    state.clear_live_diff_state();
    state.finalize_open_block(context);
    if !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !state.completed_from_event
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
    let exit_code = exit.as_ref().ok().and_then(std::process::ExitStatus::code);
    emit_finish(
        context,
        finish_reason(handle, exit_code, state.completed_from_event),
    );
    flush_emissions(context, emissions);
    AgentRunResult {
        last_assistant_message: state.last_assistant_message.clone(),
    }
}

fn spawn_codex_app_server(
    binary: &Path,
    cwd: &Path,
    env: &HashMap<OsString, OsString>,
) -> std::io::Result<tokio::process::Child> {
    Command::new(binary)
        .args(["app-server", "--listen", "stdio://"])
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

fn spawn_direct(
    arguments: &[String],
    cwd: &Path,
    env: &HashMap<OsString, OsString>,
) -> std::io::Result<tokio::process::Child> {
    let (binary, arguments) = arguments.split_first().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing agent binary")
    })?;
    Command::new(binary)
        .args(arguments)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

async fn drain_bounded(mut stream: impl AsyncRead + Unpin) -> String {
    let mut text = String::new();
    let mut buffer = [0_u8; 8192];
    let mut pending = Vec::new();
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                pending.extend_from_slice(&buffer[..read]);
                decode_utf8_stream(&mut pending, &mut text, false);
                text = tail_javascript_chars(&text, MAX_STREAM_CHARS);
            }
        }
    }
    decode_utf8_stream(&mut pending, &mut text, true);
    text = tail_javascript_chars(&text, MAX_STREAM_CHARS);
    text
}

fn decode_utf8_stream(pending: &mut Vec<u8>, output: &mut String, end: bool) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                output.push_str(valid);
                pending.clear();
                return;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    output.push_str(
                        std::str::from_utf8(&pending[..valid]).expect("validated prefix"),
                    );
                    pending.drain(..valid);
                }
                match error.error_len() {
                    Some(length) => {
                        output.push('\u{fffd}');
                        pending.drain(..length);
                    }
                    None if end => {
                        output.push_str(&String::from_utf8_lossy(pending));
                        pending.clear();
                        return;
                    }
                    None => return,
                }
            }
        }
    }
}

fn tail_javascript_chars(value: &str, max_units: usize) -> String {
    let units = value.encode_utf16().collect::<Vec<_>>();
    if units.len() <= max_units {
        return value.into();
    }
    String::from_utf16_lossy(&units[units.len() - max_units..])
}

fn parse_ndjson(line: &[u8]) -> Option<Value> {
    let line = String::from_utf8_lossy(line);
    let line = line.trim();
    if line.is_empty() {
        None
    } else {
        serde_json::from_str(line).ok()
    }
}

fn emit_error(context: &mut AgentProtocolContext, message: String) {
    context
        .emissions
        .push(ProtocolEmission::Agent(AgentEvent::Error {
            message: message.clone(),
        }));
    context.emissions.push(ProtocolEmission::System(message));
}

fn emit_finish(context: &mut AgentProtocolContext, reason: String) {
    context
        .emissions
        .push(ProtocolEmission::Agent(AgentEvent::Finish {
            reason: Some(reason),
        }));
}

fn flush_emissions(
    context: &mut AgentProtocolContext,
    sender: Option<&tokio::sync::mpsc::UnboundedSender<ProtocolEmission>>,
) {
    let Some(sender) = sender else { return };
    for emission in context.take_emissions() {
        let _ = sender.send(emission);
    }
}

fn finish_reason(handle: &AgentProcessHandle, exit_code: Option<i32>, completed: bool) -> String {
    if handle.is_cancelled() {
        "cancelled".into()
    } else if exit_code == Some(0) || completed {
        "completed".into()
    } else {
        format!("exit:{}", exit_code.unwrap_or(-1))
    }
}

#[cfg(unix)]
fn signal_interrupt(pid: u32) {
    let _ = std::process::Command::new("kill")
        .arg(OsStr::new("-INT"))
        .arg(pid.to_string())
        .status();
}

#[cfg(windows)]
fn signal_interrupt(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_app_server_requests_avoid_experimental_workspace_roots() {
        let invocation = CodexInvocationContext {
            cwd: PathBuf::from("/tmp/project"),
            reference_paths: vec![PathBuf::from("/tmp/reference")],
            images: vec![],
            model: Some("gpt-5.6-sol".into()),
            reasoning_level: Some("high".into()),
            developer_instructions: Some("internal context".into()),
            session_id: None,
        };

        let thread = codex_thread_params(&invocation);
        let turn = codex_turn_params("thread-1", "hello", &invocation);
        assert!(thread.get("runtimeWorkspaceRoots").is_none());
        assert!(turn.get("runtimeWorkspaceRoots").is_none());
        assert_eq!(thread["cwd"], "/tmp/project");
        assert_eq!(turn["cwd"], "/tmp/project");
        assert_eq!(thread["developerInstructions"], "internal context");
        assert_eq!(turn["input"][0]["text"], "hello");
        assert!(
            !turn["input"][0]["text"]
                .as_str()
                .unwrap()
                .contains("internal context")
        );
    }

    #[test]
    fn claude_keeps_internal_context_out_of_the_user_prompt() {
        let environment = HashMap::new();
        let run = ClaudeRun {
            binary: Path::new("claude"),
            prompt: "hello",
            developer_instructions: Some("internal context"),
            cwd: Path::new("/tmp/project"),
            model: None,
            session_id: None,
            env: &environment,
        };

        let arguments = claude_invocation_args(&run);
        assert_eq!(arguments[2], "hello");
        let system_prompt = arguments
            .windows(2)
            .find(|pair| pair[0] == "--append-system-prompt")
            .map(|pair| pair[1].as_str());
        assert_eq!(system_prompt, Some("internal context"));
        assert!(!arguments[2].contains("internal context"));
    }

    #[derive(Default)]
    struct RecordingTracker {
        tracked: std::sync::Mutex<Vec<(char, u32)>>,
    }

    impl PidTracker for RecordingTracker {
        fn track_pid(&self, pid: u32) {
            self.tracked.lock().unwrap().push(('t', pid));
        }
        fn untrack_pid(&self, pid: u32) {
            self.tracked.lock().unwrap().push(('u', pid));
        }
        fn kill_pid_tree(&self, pid: u32) {
            self.tracked.lock().unwrap().push(('k', pid));
        }
    }

    #[test]
    fn ndjson_and_utf16_tail_match_javascript_boundaries() {
        assert_eq!(
            parse_ndjson(b" {\"type\":\"result\"} \n").unwrap()["type"],
            "result"
        );
        assert!(parse_ndjson(b"not json\n").is_none());
        assert_eq!(tail_javascript_chars("a😀b", 3), "😀b");
    }

    #[test]
    fn codex_app_server_input_preserves_text_and_local_images() {
        assert_eq!(
            codex_user_input("steer now", &[PathBuf::from("/tmp/image.png")]),
            vec![
                json!({"type":"text","text":"steer now","text_elements":[]}),
                json!({"type":"localImage","path":"/tmp/image.png"})
            ]
        );
    }

    #[test]
    fn claude_event_order_preserves_session_agent_activity_and_chat() {
        let mut context = AgentProtocolContext::new("/tmp");
        let mut state = ClaudeProtocolState::default();
        state.handle_event(
            &mut context,
            &json!({
                "type": "content_block_start", "session_id": "s1", "index": 2,
                "content_block": {"type": "tool_use", "name": "Read", "input": {"path": "/tmp/a"}}
            }),
        );
        assert!(matches!(&context.emissions[0], ProtocolEmission::Session(id) if id == "s1"));
        assert!(matches!(
            &context.emissions[1],
            ProtocolEmission::Agent(AgentEvent::Session { .. })
        ));
        assert!(matches!(
            &context.emissions[2],
            ProtocolEmission::Agent(AgentEvent::ToolCallStart { .. })
        ));
        assert!(matches!(
            &context.emissions[3],
            ProtocolEmission::Activity { tool_name, .. } if tool_name == "Read"
        ));
        assert!(matches!(&context.emissions[4], ProtocolEmission::Chat(_)));
    }

    #[cfg(unix)]
    fn executable_script(body: &str) -> (tempfile::TempDir, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fake-agent");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        (directory, path)
    }

    #[cfg(unix)]
    fn test_env() -> HashMap<OsString, OsString> {
        std::env::vars_os().collect()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_runner_launches_binary_directly_and_preserves_finish_order() {
        let (directory, binary) = executable_script(
            "printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"claude-session\",\"result\":\"finished\"}'",
        );
        let environment = test_env();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let result = run_claude(
            ClaudeRun {
                binary: &binary,
                prompt: "hello",
                developer_instructions: None,
                cwd: directory.path(),
                model: Some("sonnet"),
                session_id: None,
                env: &environment,
            },
            &handle,
            &mut context,
            None,
        )
        .await;
        assert_eq!(result.last_assistant_message, "finished");
        assert!(
            matches!(context.emissions.last(), Some(ProtocolEmission::Agent(AgentEvent::Finish { reason: Some(reason) })) if reason == "completed")
        );
        assert_eq!(context.session_id.as_deref(), Some("claude-session"));
        assert_eq!(handle.pid(), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_runner_emits_delta_before_child_exit() {
        let (directory, binary) = executable_script(
            "printf '%s\n' '{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}' '{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"first\"}}'; sleep 3",
        );
        let environment = test_env();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let run = run_claude(
            ClaudeRun {
                binary: &binary,
                prompt: "hello",
                developer_instructions: None,
                cwd: directory.path(),
                model: None,
                session_id: None,
                env: &environment,
            },
            &handle,
            &mut context,
            Some(&sender),
        );
        tokio::pin!(run);
        let delta = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                tokio::select! {
                    result = &mut run => panic!("child exited before first delta: {result:?}"),
                    emission = receiver.recv() => {
                        if let Some(ProtocolEmission::Chat(event)) = emission
                            && event.get("type").and_then(Value::as_str) == Some("content_block_delta")
                        {
                            break event;
                        }
                    }
                }
            }
        }).await.expect("first delta should stream while child is still running");
        assert_eq!(delta["delta"]["text"], "first");
        run.await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_app_server_tracks_pid_and_streams_the_final_message() {
        let (directory, binary) = executable_script(
            r#"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"id":1,"result":{"userAgent":"test","codexHome":"/tmp","platformFamily":"unix","platformOs":"macos"}}' ;;
    *'"method":"thread/start"'*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-1"}}}' ;;
    *'"method":"turn/start"'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-1"}}}'
      printf '%s\n' '{"method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-1"}}}'
      printf '%s\n' '{"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"message-1","delta":"file summary"}}'
      printf '%s\n' '{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"agentMessage","id":"message-1","text":"file summary"}}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","error":null}}}'
      ;;
  esac
done
"#,
        );
        let environment = test_env();
        let invocation = CodexInvocationContext {
            cwd: directory.path().into(),
            reference_paths: vec![],
            images: vec![],
            model: None,
            reasoning_level: None,
            developer_instructions: None,
            session_id: None,
        };
        let tracker = RecordingTracker::default();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let mut state = CodexProtocolState::default();
        let result = run_codex(
            CodexRun {
                binary: &binary,
                prompt: "hello",
                invocation: &invocation,
                env: &environment,
            },
            &handle,
            &tracker,
            &mut context,
            &mut state,
            None,
        )
        .await;
        assert_eq!(result.last_assistant_message, "file summary");
        let tracking = tracker.tracked.lock().unwrap();
        assert_eq!(tracking.len(), 3);
        assert_eq!(tracking[0].0, 't');
        assert_eq!(tracking[1], ('k', tracking[0].1));
        assert_eq!(tracking[2], ('u', tracking[0].1));
        assert!(
            matches!(context.emissions.last(), Some(ProtocolEmission::Agent(AgentEvent::Finish { reason: Some(reason) })) if reason == "completed")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_runner_streams_inline_edit_before_child_exit() {
        let (directory, binary) = executable_script(
            r#"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"id":1,"result":{"userAgent":"test","codexHome":"/tmp","platformFamily":"unix","platformOs":"macos"}}' ;;
    *'"method":"thread/start"'*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-1"}}}' ;;
    *'"method":"turn/start"'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-1"}}}'
      printf '%s\n' '{"method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"fileChange","id":"change-1","changes":[{"path":"src/main.rs","kind":"update","diff":""}],"status":"inProgress"}}}'
      printf 'fn answer() -> u8 { 42 }\n' > src/main.rs
      printf '%s\n' '{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"fileChange","id":"change-1","changes":[{"path":"src/main.rs","kind":"update","diff":""}],"status":"completed"}}}'
      sleep 2
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","error":null}}}'
      ;;
  esac
done
"#,
        );
        let source = directory.path().join("src/main.rs");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(&source, "fn answer() -> u8 { 41 }\n").unwrap();
        let environment = test_env();
        let invocation = CodexInvocationContext {
            cwd: directory.path().into(),
            reference_paths: vec![],
            images: vec![],
            model: None,
            reasoning_level: None,
            developer_instructions: None,
            session_id: None,
        };
        let tracker = RecordingTracker::default();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let mut state = CodexProtocolState::default();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let run = run_codex(
            CodexRun {
                binary: &binary,
                prompt: "edit the answer",
                invocation: &invocation,
                env: &environment,
            },
            &handle,
            &tracker,
            &mut context,
            &mut state,
            Some(&sender),
        );
        tokio::pin!(run);
        let changed_paths = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                tokio::select! {
                    result = &mut run => panic!("child exited before file-change emission: {result:?}"),
                    emission = receiver.recv() => {
                        if let Some(ProtocolEmission::FileChange(paths)) = emission
                        {
                            break paths;
                        }
                    }
                }
            }
        })
        .await
        .expect("file change should stream while the child is still running");
        assert_eq!(changed_paths, vec![source]);
        run.await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_app_server_steers_the_active_turn_instead_of_starting_another() {
        let (directory, binary) = executable_script(
            r#"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"id":1,"result":{"userAgent":"test","codexHome":"/tmp","platformFamily":"unix","platformOs":"macos"}}' ;;
    *'"method":"thread/start"'*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-1"}}}' ;;
    *'"method":"turn/start"'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-1"}}}'
      printf '%s\n' '{"method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-1"}}}'
      ;;
    *'"method":"turn/steer"'*)
      printf '%s' "$line" > steer-request.json
      printf '%s\n' '{"id":4,"result":{"turnId":"turn-1"}}'
      printf '%s\n' '{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"userMessage","id":"user-2","text":"change direction"}}}'
      printf '%s\n' '{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"agentMessage","id":"message-1","text":"followed steering"}}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","error":null}}}'
      ;;
  esac
done
"#,
        );
        let environment = test_env();
        let invocation = CodexInvocationContext {
            cwd: directory.path().into(),
            reference_paths: vec![],
            images: vec![],
            model: Some("gpt-5.6-sol".into()),
            reasoning_level: Some("high".into()),
            developer_instructions: Some("own the outcome".into()),
            session_id: None,
        };
        let tracker = RecordingTracker::default();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let mut state = CodexProtocolState::default();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let run = run_codex(
            CodexRun {
                binary: &binary,
                prompt: "initial request",
                invocation: &invocation,
                env: &environment,
            },
            &handle,
            &tracker,
            &mut context,
            &mut state,
            Some(&sender),
        );
        tokio::pin!(run);
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                tokio::select! {
                    result = &mut run => panic!("turn ended before it became steerable: {result:?}"),
                    emission = receiver.recv() => {
                        if matches!(emission, Some(ProtocolEmission::Status { ref status, .. }) if status == "thinking") {
                            break;
                        }
                    }
                }
            }
        })
        .await
        .expect("turn should start");
        let steer = handle.steer_codex("change direction".into(), vec![]);
        tokio::pin!(steer);
        tokio::select! {
            result = &mut run => panic!("turn ended before steering was acknowledged: {result:?}"),
            result = &mut steer => result.expect("steering should be accepted"),
        }
        let result = run.await;
        assert_eq!(result.last_assistant_message, "followed steering");
        let mut acknowledged = false;
        while let Ok(emission) = receiver.try_recv() {
            acknowledged |= matches!(
                emission,
                ProtocolEmission::UserInputAcknowledged { ref text }
                    if text == "change direction"
            );
        }
        assert!(acknowledged);
        let request: Value = serde_json::from_slice(
            &std::fs::read(directory.path().join("steer-request.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(request["method"], "turn/steer");
        assert_eq!(request["params"]["expectedTurnId"], "turn-1");
        assert_eq!(request["params"]["input"][0]["text"], "change direction");
    }
}
