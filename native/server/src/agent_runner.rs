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

use crate::prompt_store::PromptStore;
use inferay_core::agent_protocol::{
    AgentProtocolContext, ClaudeProtocolState, CodexInvocationContext, CodexProtocolState,
    ProtocolEmission, build_claude_invocation_args,
};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

const MAX_STREAM_CHARS: usize = 64_000;
const CODEX_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const CODEX_INTERRUPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Poll the provider while an emission waits for persistence or a file diff.
/// Applying emissions stays ordered, and the turn cannot finish before they drain.
pub(crate) async fn drive_protocol<R, F, H, A>(run: R, mut apply: H) -> F::Output
where
    R: FnOnce(mpsc::UnboundedSender<ProtocolEmission>) -> F,
    F: std::future::Future,
    H: FnMut(ProtocolEmission) -> A,
    A: std::future::Future<Output = ()>,
{
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let (result, ()) = tokio::join!(run(sender), async {
        while let Some(emission) = receiver.recv().await {
            apply(emission).await;
        }
    });
    result
}

/// Process control shared with the session owner while `run_*` is awaiting.
#[derive(Clone)]
pub struct AgentProcessHandle {
    pid: Arc<AtomicU32>,
    cancelled: Arc<AtomicBool>,
    codex_control: Arc<Mutex<Option<mpsc::UnboundedSender<CodexControl>>>>,
    skills: Arc<tokio::sync::Mutex<PromptStore>>,
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
    pub(crate) fn with_skills(skills: Arc<tokio::sync::Mutex<PromptStore>>) -> Self {
        Self {
            skills,
            pid: Arc::default(),
            cancelled: Arc::default(),
            codex_control: Arc::default(),
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

    pub fn kill(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.clear_codex_control();
        if let Some(pid) = self.pid() {
            tree_kill(pid);
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
    /// Names of the MCP servers this run actually needs. `None` keeps Claude's
    /// ambient configuration; `Some` writes a minimal config and passes
    /// `--strict-mcp-config`, which skips reconnecting every other server.
    pub mcp_servers: Option<&'a [String]>,
}

pub struct CodexRun<'a> {
    pub binary: &'a Path,
    pub prompt: &'a str,
    pub invocation: &'a CodexInvocationContext,
    pub env: &'a HashMap<OsString, OsString>,
}

pub async fn run_claude(
    run: ClaudeRun<'_>,
    handle: &AgentProcessHandle,
    context: &mut AgentProtocolContext,
    emissions: &mpsc::UnboundedSender<ProtocolEmission>,
) -> String {
    let scoped_mcp = run.mcp_servers.and_then(write_scoped_mcp_config);
    let arguments = claude_invocation_args(&run, scoped_mcp.as_ref().map(|file| file.path()));
    let spawn = spawn_direct(&arguments, run.cwd, run.env);
    let mut child = match spawn {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions);
            return String::new();
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
    protocol.last_assistant_message
}

fn claude_invocation_args(run: &ClaudeRun<'_>, mcp_config: Option<&Path>) -> Vec<String> {
    let mut arguments = build_claude_invocation_args(
        run.binary,
        run.prompt,
        run.model,
        run.session_id,
        mcp_config,
    );
    arguments.extend([
        "--settings".into(),
        claude_mcp_policy(run.env),
        "--append-system-prompt".into(),
        format!(
            "{}\n\n{DIRECT_INTEGRATIONS}",
            run.developer_instructions.unwrap_or_default()
        ),
    ]);
    arguments
}

const DIRECT_INTEGRATIONS: &str = "Inferay uses local Git and the GitHub CLI directly. GitKraken tools are disabled in Inferay. Use the direct Linear MCP tools for Linear; discover the available tools before claiming access is missing. If a direct integration is unavailable, report that specific connection failure rather than asking the user to connect GitKraken.";
pub(crate) fn mcp_overrides(env: &HashMap<OsString, OsString>) -> HashMap<String, bool> {
    env.get(OsStr::new("INFERAY_MCP_OVERRIDES"))
        .and_then(|value| serde_json::from_str(&value.to_string_lossy()).ok())
        .unwrap_or_default()
}

pub(crate) fn claude_mcp_policy(env: &HashMap<OsString, OsString>) -> String {
    let mut denied = vec![
        json!({"serverName":"GitKraken"}),
        json!({"serverName":"gitkraken"}),
    ];
    denied.extend(
        mcp_overrides(env)
            .into_iter()
            .filter(|(_, enabled)| !enabled)
            .map(|(name, _)| json!({"serverName":name})),
    );
    json!({"deniedMcpServers": denied}).to_string()
}

/// Config with no MCP servers, for turns that cannot use them.
pub(crate) fn write_empty_mcp_config() -> Option<tempfile::NamedTempFile> {
    let file = tempfile::Builder::new()
        .prefix("inferay-mcp-")
        .suffix(".json")
        .tempfile()
        .ok()?;
    serde_json::to_writer(&file, &serde_json::json!({ "mcpServers": {} })).ok()?;
    Some(file)
}

/// Write a config holding only `wanted`, copied out of the user's own
/// `~/.claude.json`. Returns `None` when nothing needs narrowing, so the caller
/// falls back to Claude's ambient configuration rather than silently removing
/// every server.
fn write_scoped_mcp_config(wanted: &[String]) -> Option<tempfile::NamedTempFile> {
    let home = std::env::var_os("HOME")?;
    let source = std::path::Path::new(&home).join(".claude.json");
    let text = std::fs::read_to_string(source).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
    let available = parsed.get("mcpServers")?.as_object()?;
    let mut scoped = serde_json::Map::new();
    for name in wanted {
        if let Some(entry) = available.get(name) {
            scoped.insert(name.clone(), entry.clone());
        }
    }
    let file = tempfile::Builder::new()
        .prefix("inferay-mcp-")
        .suffix(".json")
        .tempfile()
        .ok()?;
    serde_json::to_writer(
        &file,
        &serde_json::json!({ "mcpServers": serde_json::Value::Object(scoped) }),
    )
    .ok()?;
    Some(file)
}

pub async fn run_codex(
    run: CodexRun<'_>,
    handle: &AgentProcessHandle,
    tracker: &RuntimePidTracker,
    context: &mut AgentProtocolContext,
    state: &mut CodexProtocolState,
    emissions: &mpsc::UnboundedSender<ProtocolEmission>,
) -> String {
    let mut child = match spawn_codex_app_server(run.binary, &run.invocation.cwd, run.env) {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions);
            return String::new();
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
        let config = rpc
            .request(
                "config/read",
                json!({"cwd": run.invocation.cwd, "includeLayers": false}),
                (&mut *context, &mut *state, emissions),
            )
            .await?;
        let mut start_params = codex_thread_params(run.invocation);
        configure_codex_session(&mut start_params, &config["config"], run.env);
        start_params["dynamicTools"] = inferay_core::prompts::tools::tool_definitions();
        let thread_response = if let Some(thread_id) = &run.invocation.session_id {
            let mut params = codex_thread_params(run.invocation);
            configure_codex_session(&mut params, &config["config"], run.env);
            params["threadId"] = json!(thread_id);
            rpc.request(
                "thread/resume",
                params,
                (&mut *context, &mut *state, emissions),
            )
            .await
            .map(Some)
            .map_err(|error| format!("Could not resume Codex session {thread_id}: {error}"))?
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
        // Resolve MCP tools before the model snapshots its tool inventory.
        // Starting discovery after turn/start leaves slow servers out of that turn.
        let mut cursor = Value::Null;
        loop {
            let page = rpc
                .request(
                    "mcpServerStatus/list",
                    json!({"threadId":thread_id,"limit":100,"cursor":cursor,"detail":"toolsAndAuthOnly"}),
                    (&mut *context, &mut *state, emissions),
                )
                .await
                .map_err(|error| format!("Could not prepare Codex MCP tools: {error}"))?;
            crate::mcp_icons::register(&page);
            cursor = page["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
        }
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
        // An MCP server waiting on the user. Held separately from
        // pending_user_input because the reply shape is MCP's
        // {action, content}, not Codex's answers map.
        let mut pending_elicitation: Option<(Value, Option<String>)> = None;
        let mut completed = false;
        let mut interrupt_deadline = None;
        loop {
            tokio::select! {
                _ = async {
                    match interrupt_deadline {
                        Some(deadline) => tokio::time::sleep_until(deadline).await,
                        None => std::future::pending::<()>().await,
                    }
                } => {
                    emit_error(context, "Codex did not finish stopping; terminated its process.".into());
                    break;
                }
                control = control_rx.recv() => {
                    match control {
                        Some(CodexControl::Steer { text, images, response }) => {
                            state.prepare_for_steering(context);
                            flush_emissions(context, emissions);
                            if let Some((response_id, field)) = pending_elicitation.take() {
                                let reply = elicitation_reply(&response_id, &text, field.as_deref());
                                let result = rpc
                                    .write(&reply)
                                    .await
                                    .map_err(|error| error.to_string());
                                if result.is_ok() {
                                    state.close_tool(context);
                                    flush_emissions(context, emissions);
                                }
                                let _ = response.send(result);
                            } else if let Some((response_id, question_ids)) = pending_user_input.take() {
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
                            if rpc.send("turn/interrupt", json!({"threadId":thread_id,"turnId":turn_id})).await.is_err() {
                                break;
                            }
                            interrupt_deadline.get_or_insert_with(|| tokio::time::Instant::now() + CODEX_INTERRUPT_TIMEOUT);
                        }
                        None => {}
                    }
                }
                read = rpc.read() => {
                    let Some(message) = read else { break };
                    if message.get("method").is_none()
                        && let Some(id) = message.get("id").and_then(Value::as_u64)
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
                        let result = handle.skills.lock().await.call_tool(tool, &args);
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
                    if message.get("method").and_then(Value::as_str)
                        == Some("mcpServer/elicitation/request")
                        && let Some(id) = message.get("id").cloned()
                    {
                        // Declining this is what made MCP servers needing consent
                        // unusable: the server asks, Inferay refuses, and the
                        // connect prompt can never reach the user.
                        let params = message.pointer("/params").cloned().unwrap_or(Value::Null);
                        let field = params
                            .pointer("/requestedSchema/properties")
                            .and_then(Value::as_object)
                            .filter(|properties| properties.len() == 1)
                            .and_then(|properties| properties.keys().next().cloned());
                        pending_elicitation = Some((id, field));
                        state.begin_tool(context, "McpElicitation", params);
                        flush_emissions(context, emissions);
                        continue;
                    }
                    if let Some(reply) = unsupported_codex_request(&message) {
                        let method = message["method"].as_str().unwrap_or("unknown");
                        emit_error(context, format!("Codex requested {method}, which Inferay does not support yet. The request was declined so the turn can continue."));
                        flush_emissions(context, emissions);
                        if rpc.write(&reply).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    let is_completed = message.get("method").and_then(Value::as_str) == Some("turn/completed");
                    if let Some(method) = message["method"].as_str() {
                        crate::agent_protocol::handle_codex_notification(state, context, method, &message["params"]);
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

// Inferay currently creates an app-server per turn. Codex's WebSocket -> HTTP
// fallback lives only in that process, so restarting it repeats the entire retry
// budget. Use HTTP for the built-in OpenAI provider; leave custom providers alone.
// Built-in providers cannot be overridden, hence the separate provider ID.
fn configure_codex_session(params: &mut Value, config: &Value, env: &HashMap<OsString, OsString>) {
    params["config"] = json!({});
    if let Some(servers) = config["mcp_servers"].as_object() {
        let overrides = mcp_overrides(env);
        for name in servers.keys().filter(|name| !name.contains('.')) {
            let enabled = if name.eq_ignore_ascii_case("gitkraken") {
                Some(false)
            } else {
                overrides.get(name).copied()
            };
            if let Some(enabled) = enabled {
                params["config"][format!("mcp_servers.{name}.enabled")] = json!(enabled);
            }
        }
    }
    let provider = config["model_provider"].as_str().unwrap_or("openai");
    if provider != "openai" {
        return;
    }
    let mut http_provider = json!({
        "name": "OpenAI",
        "wire_api": "responses",
        "requires_openai_auth": true,
        "supports_websockets": false,
        "supports_standalone_web_search": true,
        "env_http_headers": {
            "OpenAI-Organization": "OPENAI_ORGANIZATION",
            "OpenAI-Project": "OPENAI_PROJECT"
        }
    });
    if let Some(base_url) = config["openai_base_url"].as_str() {
        http_provider["base_url"] = json!(base_url);
    }
    params["modelProvider"] = json!("inferay_openai_http");
    params["config"]["model_providers.inferay_openai_http"] = http_provider;
}

fn codex_thread_params(invocation: &CodexInvocationContext) -> Value {
    json!({
        "cwd": invocation.cwd,
        "approvalPolicy": "never",
        "sandbox": "danger-full-access",
        "model": invocation.model,
        "developerInstructions": format!("{}\n\n{DIRECT_INTEGRATIONS}", invocation.developer_instructions.as_deref().unwrap_or_default()),
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

/// Inspect the same thread-scoped tool inventory used by chat, without a model turn.
pub(crate) async fn inspect_codex_mcp(
    binary: &Path,
    cwd: &Path,
    env: &HashMap<OsString, OsString>,
) -> Result<(Value, Vec<Value>), String> {
    let mut child = spawn_codex_app_server(binary, cwd, env).map_err(|e| e.to_string())?;
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut rpc = CodexConnection {
        stdin: child.stdin.take().expect("piped stdin"),
        stdout: BufReader::new(child.stdout.take().expect("piped stdout")).lines(),
        request_id: 0,
    };
    let mut context = AgentProtocolContext::new(cwd.to_owned());
    let mut protocol = CodexProtocolState::default();
    let (emissions, _receiver) = mpsc::unbounded_channel();
    let result = tokio::time::timeout(std::time::Duration::from_secs(75), async {
        rpc.request(
            "initialize",
            json!({
                "clientInfo": {"name": "inferay", "version": env!("CARGO_PKG_VERSION")},
                "capabilities": {"experimentalApi": true}
            }),
            (&mut context, &mut protocol, &emissions),
        )
        .await?;
        rpc.write(&json!({"method": "initialized"})).await?;
        let config = rpc
            .request(
                "config/read",
                json!({"cwd": cwd, "includeLayers": false}),
                (&mut context, &mut protocol, &emissions),
            )
            .await?;
        let mut params = json!({"cwd": cwd, "ephemeral": true});
        configure_codex_session(&mut params, &config["config"], env);
        let thread = rpc
            .request(
                "thread/start",
                params,
                (&mut context, &mut protocol, &emissions),
            )
            .await?;
        let mut servers = Vec::new();
        let mut cursor = Value::Null;
        loop {
            let page = rpc
                .request(
                    "mcpServerStatus/list",
                    json!({
                        "threadId": thread["thread"]["id"], "limit": 100, "cursor": cursor,
                        "detail": "toolsAndAuthOnly"
                    }),
                    (&mut context, &mut protocol, &emissions),
                )
                .await?;
            crate::mcp_icons::register(&page);
            if let Some(data) = page["data"].as_array() {
                servers.extend(data.iter().cloned());
            }
            cursor = page["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
        }
        Ok((config["config"]["mcp_servers"].clone(), servers))
    })
    .await
    .unwrap_or_else(|_| Err("Codex connection check timed out".into()));
    if let Some(pid) = child.id() {
        tree_kill(pid);
    }
    let _ = child.kill().await;
    stderr.abort();
    result
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
        tokio::time::timeout(CODEX_RPC_TIMEOUT, async {
            self.stdin.write_all(&encoded).await?;
            self.stdin.flush().await
        })
        .await
        .map_err(|_| "Codex App Server stopped reading requests".to_string())?
        .map_err(|error| error.to_string())
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
            &mpsc::UnboundedSender<ProtocolEmission>,
        ),
    ) -> Result<Value, String> {
        let id = self.send(method, params).await?;
        let (context, state, emissions) = protocol;
        // MCP startup/tool discovery can outlast ordinary App Server requests.
        let timeout = if method == "mcpServerStatus/list" {
            std::time::Duration::from_secs(45)
        } else {
            CODEX_RPC_TIMEOUT
        };
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if tokio::time::Instant::now() >= deadline {
                return Err(format!(
                    "Codex {method} response timed out; connection state is unknown"
                ));
            }
            let message = tokio::time::timeout_at(deadline, self.read())
                .await
                .map_err(|_| {
                    format!("Codex {method} response timed out; connection state is unknown")
                })?
                .ok_or_else(|| "Codex App Server closed before replying".to_string())?;
            if message.get("method").is_none()
                && message.get("id").and_then(Value::as_u64) == Some(id)
            {
                return rpc_result(message);
            }
            if let Some(reply) = unsupported_codex_request(&message) {
                self.write(&reply).await?;
                continue;
            }
            if let Some(method) = message["method"].as_str() {
                crate::agent_protocol::handle_codex_notification(
                    state,
                    context,
                    method,
                    &message["params"],
                );
                flush_emissions(context, emissions);
            }
        }
    }
}

// Server requests have their own ID namespace. Never confuse them with replies
// to our requests, and never leave an unsupported request waiting indefinitely.
/// MCP expects `{action, content}` back. A declining word means declined; a
/// server that asked for one string field gets the user's text as that field,
/// and everything else is a plain acceptance.
fn elicitation_reply(id: &Value, text: &str, field: Option<&str>) -> Value {
    let answer = text.trim();
    let declined = matches!(
        answer.to_lowercase().as_str(),
        "decline" | "declined" | "cancel" | "cancelled" | "no" | "deny" | "reject" | "skip"
    );
    if declined {
        return json!({"id": id, "result": {"action": "decline"}});
    }
    let content = match field {
        Some(field) if !answer.is_empty() => json!({ field: answer }),
        _ => json!({}),
    };
    json!({"id": id, "result": {"action": "accept", "content": content}})
}

fn unsupported_codex_request(message: &Value) -> Option<Value> {
    let method = message.get("method")?.as_str()?;
    let id = message.get("id")?;
    Some(json!({
        "id": id,
        "error": {"code": -32601, "message": format!("Inferay does not support Codex server request: {method}")}
    }))
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
    tracker: &RuntimePidTracker,
    stderr: tokio::task::JoinHandle<String>,
    protocol: (
        &mut AgentProtocolContext,
        &mut CodexProtocolState,
        &mpsc::UnboundedSender<ProtocolEmission>,
    ),
) -> String {
    let (context, state, emissions) = protocol;
    handle.clear_codex_control();
    if let Some(pid) = pid {
        tree_kill(pid);
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
    state.last_assistant_message.clone()
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
    sender: &mpsc::UnboundedSender<ProtocolEmission>,
) {
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

#[derive(Clone)]
pub struct RuntimePidTracker {
    path: PathBuf,
    active: Arc<std::sync::Mutex<std::collections::HashSet<u32>>>,
    save_pending: Arc<AtomicBool>,
    save_lock: Arc<tokio::sync::Mutex<()>>,
}

impl RuntimePidTracker {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            active: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
            save_pending: Arc::new(AtomicBool::new(false)),
            save_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn cleanup_orphans(&self) {
        if let Ok(bytes) = tokio::fs::read(&self.path).await
            && let Ok(values) = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes)
        {
            for value in values {
                if let Some(pid) = value.as_u64().and_then(|pid| u32::try_from(pid).ok())
                    && pid > 0
                {
                    tree_kill(pid);
                }
            }
        }
        self.active
            .lock()
            .expect("PID tracker lock poisoned")
            .clear();
        self.write_pids().await;
    }

    fn schedule_save(&self) {
        if self.save_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let tracker = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            tracker.save_pending.store(false, Ordering::Release);
            tracker.write_pids().await;
        });
    }

    async fn write_pids(&self) {
        let _guard = self.save_lock.lock().await;
        let mut pids = self
            .active
            .lock()
            .expect("PID tracker lock poisoned")
            .iter()
            .copied()
            .collect::<Vec<_>>();
        pids.sort_unstable();
        let Ok(bytes) = serde_json::to_vec_pretty(&pids) else {
            return;
        };
        let _ = crate::atomic_write::overwrite(&self.path, &bytes).await;
    }

    pub fn track_pid(&self, pid: u32) {
        if pid == 0 {
            return;
        }
        self.active
            .lock()
            .expect("PID tracker lock poisoned")
            .insert(pid);
        self.schedule_save();
    }

    pub fn untrack_pid(&self, pid: u32) {
        if pid == 0 {
            return;
        }
        self.active
            .lock()
            .expect("PID tracker lock poisoned")
            .remove(&pid);
        self.schedule_save();
    }
}

#[cfg(windows)]
fn tree_kill(pid: u32) {
    if pid == 0 {
        return;
    }
    let _ = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(not(windows))]
fn tree_kill(pid: u32) {
    if pid == 0 {
        return;
    }
    if let Ok(output) = std::process::Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
    {
        for child in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(child) = child.trim().parse::<u32>() {
                tree_kill(child);
            }
        }
    }
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(all(test, unix))]
mod runner_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn session_policy_disables_gitkraken_without_replacing_other_connectors() {
        for provider in ["openai", "custom"] {
            let config = json!({
                "model_provider": provider,
                "mcp_servers": {
                    "GitKraken": {"command": "gk", "enabled": true},
                    "linear": {"url": "https://mcp.linear.app/mcp"}
                }
            });
            let original = config.clone();
            let mut params = json!({});
            configure_codex_session(&mut params, &config, &HashMap::new());
            assert_eq!(params["config"]["mcp_servers.GitKraken.enabled"], false);
            assert!(params["config"].get("mcp_servers.linear.enabled").is_none());
            assert_eq!(config, original);
        }
        let mut params = json!({});
        configure_codex_session(
            &mut params,
            &json!({"model_provider": "custom"}),
            &HashMap::new(),
        );
        assert_eq!(params["config"], json!({}));
    }

    #[tokio::test]
    async fn concrete_runner_delivers_result_session_and_failure_events() {
        let root = std::env::temp_dir().join(format!("inferay-runner-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let binary = root.join("claude-fixture");
        std::fs::write(&binary, "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"result\",\"result\":\"done\",\"session_id\":\"fixture-session\"}'\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let handle = AgentProcessHandle::with_skills(Arc::new(tokio::sync::Mutex::new(
            PromptStore::new(root.join("bundled.json"), root.join("local.json")),
        )));
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut context = AgentProtocolContext::new(root.clone());
        let env = HashMap::new();
        let make_run = || ClaudeRun {
            binary: &binary,
            prompt: "fixture",
            developer_instructions: None,
            cwd: &root,
            model: None,
            session_id: None,
            env: &env,
            mcp_servers: None,
        };
        assert_eq!(
            run_claude(make_run(), &handle, &mut context, &tx).await,
            "done"
        );
        assert!(handle.pid().is_none());
        assert!(
            matches!(rx.try_recv().unwrap(), ProtocolEmission::Session(id) if id == "fixture-session")
        );
        assert!(
            matches!(rx.try_recv().unwrap(), ProtocolEmission::Chat(event) if event["result"] == "done")
        );
        std::fs::write(&binary, "#!/bin/sh\nprintf 'fixture failure' >&2\nexit 1\n").unwrap();
        assert_eq!(run_claude(make_run(), &handle, &mut context, &tx).await, "");
        assert!(
            matches!(rx.try_recv().unwrap(), ProtocolEmission::System(error) if error == "fixture failure")
        );
        std::fs::remove_file(&binary).unwrap();
        assert_eq!(run_claude(make_run(), &handle, &mut context, &tx).await, "");
        assert!(matches!(
            rx.try_recv().unwrap(),
            ProtocolEmission::System(_)
        ));
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(all(test, unix))]
#[path = "agent_runner_tests.rs"]
mod reliability_tests;
