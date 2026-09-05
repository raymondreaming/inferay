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

use crate::native_prompts::NativePrompts;
use inferay_core::agent_protocol::{
    AgentProtocolContext, ClaudeProtocolState, CodexInvocationContext, CodexProtocolState,
    ProtocolEmission, build_claude_invocation_args,
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
    skills: Option<NativePrompts>,
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
    pub(crate) fn with_skills(skills: NativePrompts) -> Self {
        Self {
            skills: Some(skills),
            ..Self::default()
        }
    }

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
    if !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
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
    let mut rpc = CodexConnection {
        stdin: child.stdin.take().expect("piped stdin"),
        stdout: BufReader::new(child.stdout.take().expect("piped stdout")).lines(),
        request_id: 0,
    };
    let startup = async {
        rpc.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "inferay", "title": "Inferay", "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {"experimentalApi": true}
            }),
            (&mut *context, &mut *state, emissions),
        )
        .await?;
        rpc.write(&json!({"method":"initialized"})).await?;
        let mut start_params = codex_thread_params(run.invocation);
        if handle.skills.is_some() {
            start_params["dynamicTools"] = NativePrompts::tool_definitions();
        }
        let thread_response = if let Some(thread_id) = &run.invocation.session_id {
            let mut params = codex_thread_params(run.invocation);
            params["threadId"] = json!(thread_id);
            rpc.request(
                "thread/resume",
                params,
                (&mut *context, &mut *state, emissions),
            )
            .await
            .ok()
        } else {
            None
        };
        let thread_response = match thread_response {
            Some(response) => response,
            None => {
                rpc.request(
                    "thread/start",
                    start_params,
                    (&mut *context, &mut *state, emissions),
                )
                .await?
            }
        };
        let thread_id = thread_response
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .ok_or("Codex App Server did not return a thread id")?
            .to_owned();
        state.set_session(context, thread_id.clone());
        flush_emissions(context, emissions);
        let turn_response = rpc
            .request(
                "turn/start",
                codex_turn_params(&thread_id, run.prompt, run.invocation),
                (&mut *context, &mut *state, emissions),
            )
            .await?;
        let turn_id = turn_response
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .ok_or("Codex App Server did not return a turn id")?
            .to_owned();
        Ok::<_, String>((thread_id, turn_id))
    }
    .await;
    if let Ok((thread_id, turn_id)) = &startup {
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
                                let result = rpc.write(&json!({"id":response_id,"result":{"answers":answers}}))
                                    .await
                                    .map_err(|error| error.to_string());
                                if result.is_ok() {
                                    state.close_tool(context);
                                    flush_emissions(context, emissions);
                                }
                                let _ = response.send(result);
                            } else {
                                match rpc.send("turn/steer", json!({
                                        "threadId":thread_id,
                                        "expectedTurnId":turn_id,
                                        "input":codex_user_input(&text, &images)
                                })).await {
                                    Ok(id) => { pending_steers.insert(id, response); }
                                    Err(error) => { let _ = response.send(Err(error)); }
                                }
                            }
                        }
                        Some(CodexControl::Interrupt) => {
                            let _ = rpc.send("turn/interrupt", json!({"threadId":thread_id,"turnId":turn_id})).await;
                        }
                        None => {}
                    }
                }
                read = rpc.read() => {
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
                        state.begin_tool(context, "AskUserQuestion", json!({"questions":questions}));
                        flush_emissions(context, emissions);
                        continue;
                    }
                    if message.get("method").and_then(Value::as_str) == Some("item/tool/call")
                        && let Some(id) = message.get("id").cloned()
                    {
                        let tool = message.pointer("/params/tool").and_then(Value::as_str).unwrap_or("");
                        let args = message.pointer("/params/arguments").cloned().unwrap_or(Value::Null);
                        let result = match &handle.skills {
                            Some(skills) => skills.call_tool(tool, &args).await,
                            None => Err("Inferay skills are unavailable in this session".into()),
                        };
                        let (success, output) = match result {
                            Ok((output, card)) => {
                                if let Some(card) = card {
                                    context.emissions.push(ProtocolEmission::System(card.to_string()));
                                    flush_emissions(context, emissions);
                                }
                                (true, output.to_string())
                            }
                            Err(error) => (false, error),
                        };
                        if let Err(error) = rpc.write(&json!({"id":id,"result":{
                            "success":success,"contentItems":[{"type":"inputText","text":output}]
                        }})).await {
                            emit_error(context, error);
                            break;
                        }
                        continue;
                    }
                    let is_completed = message.get("method").and_then(Value::as_str) == Some("turn/completed");
                    if let Some(method) = message["method"].as_str() {
                        state.handle_notification(context, method, &message["params"]);
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
    } else if let Err(error) = startup {
        emit_error(context, error);
    }

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

struct CodexConnection {
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    request_id: u64,
}

impl CodexConnection {
    async fn write(&mut self, message: &Value) -> Result<(), String> {
        let mut encoded = serde_json::to_vec(message).map_err(|error| error.to_string())?;
        encoded.push(b'\n');
        self.stdin
            .write_all(&encoded)
            .await
            .map_err(|error| error.to_string())?;
        self.stdin.flush().await.map_err(|error| error.to_string())
    }

    async fn send(&mut self, method: &str, params: Value) -> Result<u64, String> {
        self.request_id += 1;
        self.write(&json!({"method":method,"id":self.request_id,"params":params}))
            .await?;
        Ok(self.request_id)
    }

    async fn read(&mut self) -> Option<Value> {
        while let Some(line) = self.stdout.next_line().await.ok()? {
            if let Ok(message) = serde_json::from_str(&line) {
                return Some(message);
            }
        }
        None
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        protocol: (
            &mut AgentProtocolContext,
            &mut CodexProtocolState,
            Option<&mpsc::UnboundedSender<ProtocolEmission>>,
        ),
    ) -> Result<Value, String> {
        let id = self.send(method, params).await?;
        let (context, state, emissions) = protocol;
        loop {
            let message = tokio::time::timeout(std::time::Duration::from_secs(15), self.read())
                .await
                .map_err(|_| "Codex App Server response timed out".to_string())?
                .ok_or_else(|| "Codex App Server closed before replying".to_string())?;
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                return rpc_result(message);
            }
            if let Some(method) = message["method"].as_str() {
                state.handle_notification(context, method, &message["params"]);
                flush_emissions(context, emissions);
            }
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

pub(crate) fn spawn_direct(
    arguments: &[impl AsRef<OsStr>],
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

pub(crate) fn tail_javascript_chars(value: &str, max_units: usize) -> String {
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
    context.emissions.push(ProtocolEmission::System(message));
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
