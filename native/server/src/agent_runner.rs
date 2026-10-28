//! Direct Claude and Codex child-process runners.
//!
//! This is a faithful process-boundary port of the former Bun adapters. The
//! caller owns transport-specific broadcasting by draining `ProtocolEmission`s;
//! no JavaScript process or reverse IPC is involved.

use std::collections::{HashMap, VecDeque};
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

pub(crate) const PROTOCOL_BUFFER_CAPACITY: usize = 64;

const PROTOCOL_BUFFER_BYTES: usize = 8 * 1024 * 1024;

/// Budget retained payloads as well as event count. An oversized event owns
/// the entire budget until applied, so large tool results cannot pile up.
#[derive(Clone)]
pub(crate) struct ProtocolSender {
    sender: mpsc::Sender<(ProtocolEmission, tokio::sync::OwnedSemaphorePermit)>,
    bytes: Arc<tokio::sync::Semaphore>,
}

pub(crate) fn protocol_channel() -> (
    ProtocolSender,
    mpsc::Receiver<(ProtocolEmission, tokio::sync::OwnedSemaphorePermit)>,
) {
    let (sender, receiver) = mpsc::channel(PROTOCOL_BUFFER_CAPACITY);
    (
        ProtocolSender {
            sender,
            bytes: Arc::new(tokio::sync::Semaphore::new(PROTOCOL_BUFFER_BYTES)),
        },
        receiver,
    )
}

impl ProtocolSender {
    pub(crate) async fn send(&self, emission: ProtocolEmission) -> Result<(), String> {
        fn value_bytes(value: &Value) -> usize {
            std::mem::size_of::<Value>()
                + match value {
                    Value::String(s) => s.capacity(),
                    Value::Array(items) => items.iter().map(value_bytes).sum(),
                    Value::Object(items) => items
                        .iter()
                        .map(|(key, value)| key.capacity() + value_bytes(value))
                        .sum(),
                    _ => 0,
                }
        }
        let size = match &emission {
            ProtocolEmission::Chat(value) => value_bytes(value),
            ProtocolEmission::Requests(values) => values.iter().map(value_bytes).sum(),
            ProtocolEmission::FileChange(paths) => {
                paths.iter().map(|path| path.as_os_str().len()).sum()
            }
            ProtocolEmission::Status { status, .. } => status.capacity(),
            ProtocolEmission::UserInputAcknowledged { text } => text.capacity(),
            ProtocolEmission::System(s)
            | ProtocolEmission::Session(s)
            | ProtocolEmission::Title(s) => s.capacity(),
        }
        .saturating_add(std::mem::size_of::<ProtocolEmission>())
        .min(PROTOCOL_BUFFER_BYTES);
        let budget = self
            .bytes
            .clone()
            .acquire_many_owned(size as u32)
            .await
            .map_err(|e| e.to_string())?;
        self.sender
            .send((emission, budget))
            .await
            .map_err(|_| "Protocol consumer closed".into())
    }
}

const MAX_PROVIDER_FRAME_BYTES: usize = 32 * 1024 * 1024;

/// Own partial frames across cancelled reads (the control select can interrupt
/// any read). Never allocate an unbounded NDJSON line from a provider.
struct ProviderFrames<R> {
    reader: BufReader<R>,
    partial: Vec<u8>,
}
impl<R: AsyncRead + Unpin> ProviderFrames<R> {
    fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
            partial: Vec::new(),
        }
    }
    async fn next(&mut self) -> std::io::Result<Option<Vec<u8>>> {
        loop {
            let available = self.reader.fill_buf().await?;
            if available.is_empty() {
                return Ok((!self.partial.is_empty()).then(|| std::mem::take(&mut self.partial)));
            }
            let length = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(available.len(), |index| index + 1);
            let complete = available[length - 1] == b'\n';
            if self.partial.len().saturating_add(length) > MAX_PROVIDER_FRAME_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Provider response exceeds Inferay’s 32 MiB message limit",
                ));
            }
            self.partial.extend_from_slice(&available[..length]);
            self.reader.consume(length);
            if complete {
                return Ok(Some(std::mem::take(&mut self.partial)));
            }
        }
    }
}

const MAX_STREAM_CHARS: usize = 64_000;
const CODEX_RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const CODEX_INTERRUPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Poll the provider while an emission waits for persistence or a file diff.
/// Backpressure caps pending events; applying them stays ordered, and the turn
/// cannot finish before they drain.
pub(crate) async fn drive_protocol<R, F, H, A>(run: R, mut apply: H) -> F::Output
where
    R: FnOnce(ProtocolSender) -> F,
    F: std::future::Future,
    H: FnMut(ProtocolEmission) -> A,
    A: std::future::Future<Output = ()>,
{
    let (sender, mut receiver) = protocol_channel();
    let (result, ()) = tokio::join!(run(sender), async {
        while let Some(emission) = receiver.recv().await {
            let (emission, _budget) = emission;
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
    requests: Arc<Mutex<HashMap<String, PendingProviderRequest>>>,
    started: std::time::Instant,
    timings: Arc<Mutex<serde_json::Map<String, Value>>>,
    skills: Arc<tokio::sync::Mutex<PromptStore>>,
    projects: Option<Arc<crate::project_runtime::ProjectRuntime>>,
    memory: Option<MemoryScope>,
    tools: Option<Arc<crate::project_tools::ToolScope>>,
}

#[derive(Clone)]
pub(crate) struct MemoryScope {
    pub runtime: Arc<crate::project_runtime::ProjectRuntime>,
    pub project: String,
    pub dir: PathBuf,
    pub allow_save: bool,
    pub reads: Arc<std::sync::Mutex<Vec<Value>>>,
}

#[derive(Clone)]
struct PendingProviderRequest {
    rpc_id: Value,
    method: String,
    params: Value,
}

pub(crate) enum CodexControl {
    Steer {
        text: String,
        images: Vec<PathBuf>,
        response: oneshot::Sender<Result<(), String>>,
    },
    Respond {
        id: String,
        answer: Value,
        response: oneshot::Sender<Result<(), String>>,
    },
    Interrupt,
}

impl AgentProcessHandle {
    pub(crate) fn with_skills(skills: Arc<tokio::sync::Mutex<PromptStore>>) -> Self {
        Self {
            skills,
            projects: None,
            memory: None,
            tools: None,
            pid: Arc::default(),
            cancelled: Arc::default(),
            codex_control: Arc::default(),
            requests: Arc::default(),
            started: std::time::Instant::now(),
            timings: Arc::default(),
        }
    }

    fn mark(&self, stage: &str) {
        self.timings
            .lock()
            .expect("provider timings")
            .entry(stage.to_owned())
            .or_insert_with(|| json!(self.started.elapsed().as_millis() as u64));
    }

    pub(crate) fn diagnostics(&self) -> Value {
        json!({"elapsedMs":self.started.elapsed().as_millis() as u64,
            "milestonesMs":self.timings.lock().expect("provider timings").clone()})
    }

    pub(crate) fn with_projects(
        mut self,
        projects: Arc<crate::project_runtime::ProjectRuntime>,
    ) -> Self {
        self.projects = Some(projects);
        self
    }

    pub(crate) fn with_memory(mut self, memory: Option<MemoryScope>) -> Self {
        self.memory = memory;
        self
    }

    pub(crate) fn with_tools(mut self, tools: Arc<crate::project_tools::ToolScope>) -> Self {
        self.tools = Some(tools);
        self
    }

    pub(crate) fn tool_definitions(&self) -> Value {
        let mut definitions = inferay_core::prompts::tools::tool_definitions();
        if self.tools.as_ref().is_some_and(|tools| tools.available()) {
            definitions
                .as_array_mut()
                .unwrap()
                .push(crate::project_tools::ToolScope::definition());
        }
        if self.projects.is_some() {
            definitions
                .as_array_mut()
                .unwrap()
                .push(crate::project_chat::tool_definition());
        }
        if self.memory.is_some() {
            definitions.as_array_mut().unwrap().push(
                serde_json::from_str(crate::memory_store::TOOL_DEFINITION)
                    .expect("memory tool definition"),
            );
        }
        definitions
    }

    pub(crate) async fn call_tool(
        &self,
        tool: &str,
        args: Value,
    ) -> Result<(Value, Option<Value>), String> {
        if tool == "inferay_tools" {
            let scope = self
                .tools
                .as_ref()
                .ok_or("No library tools are granted to this run")?;
            return scope
                .call(args)
                .await
                .map(|result| (result, None))
                .map_err(|error| error.to_string());
        }
        if tool == "inferay_projects" {
            if let Some(projects) = &self.projects {
                match args["action"].as_str() {
                                    Some("list") => projects.catalog(args["projectId"].as_str().map(str::to_owned),None).await.map(|v|(json!(v),None)).map_err(|e|e.to_string()),
                                    Some("help") => Ok((json!({"commands":include_str!("project_commands.json")}),None)),
                                    Some("command") => match serde_json::from_value::<inferay_core::project_files::ProjectFileCommand>(args["command"].clone()) {
                                        Ok(command @ (inferay_core::project_files::ProjectFileCommand::CreatePlugin {..} | inferay_core::project_files::ProjectFileCommand::UpdatePlugin {..})) => {
                                            match projects.preview_plugin(&command).await {
                                                Ok(()) => Ok((json!({"status":"proposed","message":"One plugin bundle card is ready for review. Nothing has been saved or enabled. Do not also propose a skill unless requested."}),Some(json!({"type":"inferay.plugin-proposal","command":command})))),
                                                Err(error) => Err(format!("Plugin proposal invalid: {error}")),
                                            }
                                        },
                                        Ok(command @ inferay_core::project_files::ProjectFileCommand::SaveDefinition {..}) => {
                                            projects.preview_automation(&command).await
                                                .map(|()| (json!({"status":"proposed","message":"Automation proposal ready. Nothing has been saved or enabled."}),
                                                    Some(json!({"type":"inferay.automation-definition-proposal","command":command}))))
                                                .map_err(|error| format!("Automation proposal invalid: {error}"))
                                        },
                                        Ok(command) => projects.command(command,false).await.map(|v|(v,None)).map_err(|e|e.to_string()),
                                        Err(error) => Err(error.to_string()),
                                    },
                                    _ => Err("Use list, help, or command".into()),
                                }
            } else {
                Err("Project tools unavailable".into())
            }
        } else if tool == "inferay_memory" {
            match &self.memory {
                Some(memory) => {
                    let result = memory.runtime.memory.tool(
                        &memory.project,
                        &memory.dir,
                        &args,
                        memory.allow_save,
                    );
                    if let (Ok((note, _)), Some("read")) = (&result, args["action"].as_str())
                        && let Ok(mut reads) = memory.reads.lock()
                    {
                        reads
                            .push(json!({"id": note["id"], "title": note["title"], "via": "tool"}));
                    }
                    result
                }
                None => {
                    Err("This conversation is not part of a project, so it has no memory".into())
                }
            }
        } else {
            self.skills.lock().await.call_tool(tool, &args)
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

    pub(crate) fn pending_requests(&self) -> Vec<Value> {
        let requests = self.requests.lock().expect("provider requests");
        let mut entries: Vec<_> = requests
            .iter()
            .map(|(id, request)| json!({"id":id,"method":request.method,"params":request.params}))
            .collect();
        entries.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        entries
    }

    pub(crate) async fn respond(&self, id: String, answer: Value) -> Result<(), String> {
        let sender = self
            .codex_control
            .lock()
            .expect("codex control")
            .clone()
            .ok_or("Provider request is no longer active")?;
        let (response, receiver) = oneshot::channel();
        sender
            .send(CodexControl::Respond {
                id,
                answer,
                response,
            })
            .map_err(|_| "Provider turn has ended")?;
        tokio::time::timeout(CODEX_RPC_TIMEOUT, receiver)
            .await
            .map_err(|_| "Provider response timed out; reconnect to check its state")?
            .map_err(|_| "Provider turn ended before accepting the response")?
    }

    pub fn stop_codex(&self) -> bool {
        self.cancelled.store(true, Ordering::Release);
        let handle = self.clone();
        let pid = self.pid();
        tokio::spawn(async move {
            tokio::time::sleep(CODEX_INTERRUPT_TIMEOUT).await;
            if pid.is_some() && handle.pid() == pid && handle.is_cancelled() {
                handle.kill();
            }
        });
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
        self.requests.lock().expect("provider requests").clear();
        self.codex_control
            .lock()
            .expect("codex control lock")
            .take();
    }
}

pub struct ProviderRun<'a> {
    pub binary: &'a Path,
    pub prompt: &'a str,
    pub invocation: &'a CodexInvocationContext,
    pub env: &'a HashMap<OsString, OsString>,
}

pub async fn run_agent(
    run: ProviderRun<'_>,
    kind: inferay_core::agent_kind::AgentKind,
    handle: &AgentProcessHandle,
    tracker: &RuntimePidTracker,
    context: &mut AgentProtocolContext,
    emissions: &ProtocolSender,
) -> String {
    match kind {
        inferay_core::agent_kind::AgentKind::Codex => {
            run_codex(
                run,
                handle,
                tracker,
                context,
                &mut CodexProtocolState::default(),
                emissions,
            )
            .await
        }
        inferay_core::agent_kind::AgentKind::Claude => {
            run_claude(run, handle, context, emissions).await
        }
    }
}

async fn run_claude(
    run: ProviderRun<'_>,
    handle: &AgentProcessHandle,
    context: &mut AgentProtocolContext,
    emissions: &ProtocolSender,
) -> String {
    let scoped_mcp = match run
        .invocation
        .mcp_servers
        .as_deref()
        .map(|wanted| crate::agent_mcp::claude(wanted, run.env, &run.invocation.cwd))
        .transpose()
    {
        Ok(config) => config,
        Err(error) => {
            emit_error(context, error);
            flush_emissions(context, emissions).await;
            return String::new();
        }
    };
    let bridge =
        match crate::agent_tools_mcp::ToolBridge::start(handle.clone(), emissions.clone()).await {
            Ok(bridge) => bridge,
            Err(error) => {
                emit_error(context, format!("Inferay tools could not start: {error}"));
                flush_emissions(context, emissions).await;
                return String::new();
            }
        };
    let config_path = if let Some(scoped) = &scoped_mcp {
        let merged = (|| -> Result<(), String> {
            let mut config: Value =
                serde_json::from_reader(scoped.reopen().map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            let internal: Value =
                serde_json::from_reader(bridge.config.reopen().map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            config["mcpServers"]["inferay"] = internal["mcpServers"]["inferay"].clone();
            scoped.as_file().set_len(0).map_err(|e| e.to_string())?;
            serde_json::to_writer(scoped.reopen().map_err(|e| e.to_string())?, &config)
                .map_err(|e| e.to_string())
        })();
        if let Err(error) = merged {
            emit_error(
                context,
                format!("Inferay tool configuration failed: {error}"),
            );
            flush_emissions(context, emissions).await;
            return String::new();
        }
        Some(scoped.path())
    } else {
        None
    };
    let mut arguments = claude_invocation_args(&run, config_path);
    if config_path.is_none() {
        arguments.extend([
            "--mcp-config".into(),
            bridge.config.path().to_string_lossy().into_owned(),
        ]);
    }
    let spawn = spawn_direct(&arguments, &run.invocation.cwd, run.env);
    let mut child = match spawn {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions).await;
            return String::new();
        }
    };
    handle.set_pid(child.id());
    handle.mark("processSpawned");
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut stdout = ProviderFrames::new(child.stdout.take().expect("piped stdout"));
    let mut protocol = ClaudeProtocolState::default();

    loop {
        match stdout.next().await {
            Ok(None) => break,
            Ok(Some(line)) => {
                if let Some(event) = parse_ndjson(&line) {
                    if event["type"] == "stream_event" || event["type"] == "assistant" {
                        handle.mark("firstOutput");
                    }
                    protocol.handle_event(context, &event);
                    flush_emissions(context, emissions).await;
                }
            }
            Err(error) => {
                if !handle.is_cancelled() {
                    emit_error(context, error.to_string());
                }
                let _ = child.start_kill();
                break;
            }
        }
    }
    let exit = child.wait().await;
    handle.set_pid(None);
    let stderr = stderr.await.unwrap_or_default().0.trim().to_string();
    if !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
    flush_emissions(context, emissions).await;
    if exit.as_ref().is_ok_and(std::process::ExitStatus::success) {
        protocol.last_assistant_message
    } else {
        String::new()
    }
}

fn claude_invocation_args(run: &ProviderRun<'_>, mcp_config: Option<&Path>) -> Vec<String> {
    let mut arguments = build_claude_invocation_args(
        run.binary,
        run.prompt,
        run.invocation.model.as_deref(),
        run.invocation.session_id.as_deref(),
        mcp_config,
    );
    arguments.extend([
        "--settings".into(),
        crate::agent_mcp::claude_policy(run.env),
        "--append-system-prompt".into(),
        format!(
            "{}\n\n{DIRECT_INTEGRATIONS}",
            run.invocation
                .developer_instructions
                .as_deref()
                .unwrap_or_default()
        ),
    ]);
    arguments
}

pub(crate) const DIRECT_INTEGRATIONS: &str = "You are running inside Inferay through the installed provider harness. Inferay owns the conversation, project bindings, queue and approval cards. Use native Inferay tools for app-owned resources; ordinary coding needs no app tools. A proposal is pending user action, not a saved change. Use absolute Markdown file links for local outputs. Inferay uses local Git and the GitHub CLI directly. GitKraken tools are disabled in Inferay. Use the direct Linear MCP tools for Linear; discover the available tools before claiming access is missing. If a direct integration is unavailable, report that specific connection failure rather than asking the user to connect GitKraken.";
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

async fn run_codex(
    run: ProviderRun<'_>,
    handle: &AgentProcessHandle,
    tracker: &RuntimePidTracker,
    context: &mut AgentProtocolContext,
    state: &mut CodexProtocolState,
    emissions: &ProtocolSender,
) -> String {
    let _ = emissions
        .send(ProtocolEmission::Status {
            status: "Starting Codex…".into(),
            is_loading: true,
        })
        .await;
    let mut child = match spawn_codex_app_server(run.binary, &run.invocation.cwd, run.env) {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions).await;
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
        stdout: ProviderFrames::new(child.stdout.take().expect("piped stdout")),
        read_failed: false,
        request_id: 0,
        pending_notifications: VecDeque::new(),
    };
    handle.mark("processSpawned");
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
        handle.mark("initialized");
        let _ = emissions.send(ProtocolEmission::Status { status: "Loading Codex configuration…".into(), is_loading: true }).await;
        let config = rpc
            .request(
                "config/read",
                json!({"cwd": run.invocation.cwd, "includeLayers": false}),
                (&mut *context, &mut *state, emissions),
            )
            .await?;
        handle.mark("configurationRead");
        let mut start_params = codex_thread_params(run.invocation);
        configure_codex_session(&mut start_params, &config["config"], run.env, run.invocation.mcp_servers.as_deref())?;
        start_params["dynamicTools"] = handle.tool_definitions();
        let _ = emissions.send(ProtocolEmission::Status { status: "Opening Codex conversation…".into(), is_loading: true }).await;
        let thread_response = if let Some(thread_id) = &run.invocation.session_id {
            let mut params = codex_thread_params(run.invocation);
            configure_codex_session(&mut params, &config["config"], run.env, run.invocation.mcp_servers.as_deref())?;
            params["threadId"] = json!(thread_id);
            // Inferay owns transcript display; resume model state without rehydrating old image/tool payloads.
            params["excludeTurns"] = json!(true);
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
        handle.mark("conversationReady");
        state.set_session(context, thread_id.clone());
        state.handle_notification(context, "thread/name/updated", &json!({
            "threadId": thread_id, "threadName": thread_response["thread"]["name"]
        }), &Default::default());
        flush_emissions(context, emissions).await;
        // Resolve MCP tools before the model snapshots its tool inventory.
        // Starting discovery after turn/start leaves slow servers out of that turn.
        let _ = emissions.send(ProtocolEmission::Status { status: "Connecting tools…".into(), is_loading: true }).await;
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
        let _ = emissions.send(ProtocolEmission::Status { status: "Starting response…".into(), is_loading: true }).await;
        handle.mark("toolsReady");
        let turn_params = codex_turn_params(&thread_id, run.prompt, run.invocation);
        let turn_response = rpc
            .request(
                "turn/start",
                turn_params,
                (&mut *context, &mut *state, emissions),
            )
            .await?;
        let turn_id = turn_response
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .ok_or("Codex App Server did not return a turn id")?
            .to_owned();
        handle.mark("turnAccepted");
        Ok::<_, String>((thread_id, turn_id))
    }
    .await;
    if let Ok((thread_id, turn_id)) = &startup {
        let (control_tx, mut control_rx) = mpsc::unbounded_channel();
        handle.set_codex_control(control_tx);
        let mut pending_steers = HashMap::<u64, oneshot::Sender<Result<(), String>>>::new();
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
                            flush_emissions(context, emissions).await;
                            match rpc.send("turn/steer", json!({
                                "threadId":thread_id,"expectedTurnId":turn_id,
                                "input":codex_user_input(&text, &images)
                            })).await {
                                Ok(id) => { pending_steers.insert(id, response); }
                                Err(error) => { let _ = response.send(Err(error)); }
                            }
                        }
                        Some(CodexControl::Respond { id, answer, response }) => {
                            let request = handle.requests.lock().expect("provider requests").get(&id).cloned();
                            let result = match request {
                                None => Err("This request was already answered or its turn ended".into()),
                                Some(request) => match provider_request_reply(&request, answer) {
                                    Err(error) => Err(error),
                                    Ok(reply) => rpc.write(&reply).await,
                                }
                            };
                            if result.is_ok() {
                                handle.requests.lock().expect("provider requests").remove(&id);
                            }
                            let accepted = result.is_ok();
                            let _ = response.send(result);
                            if accepted {
                                let _ = emissions.send(ProtocolEmission::Requests(handle.pending_requests())).await;
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
                    // Server requests must belong to this root before exposing
                    // an approval or invoking a host tool on its behalf.
                    if message.get("id").is_some() && message.get("method").is_some()
                        && (message["params"]["threadId"].as_str().is_some_and(|id| id != thread_id)
                            || message["params"]["turnId"].as_str().is_some_and(|id| id != turn_id))
                    {
                        let _ = rpc.write(&json!({"id":message["id"],"error":{"code":-32000,"message":"Request does not belong to the active turn"}})).await;
                        continue;
                    }
                    if let (Some(method), Some(rpc_id)) = (message["method"].as_str(), message.get("id"))
                        && matches!(method, "item/tool/requestUserInput" | "mcpServer/elicitation/request" | "item/commandExecution/requestApproval" | "item/fileChange/requestApproval")
                    {
                        let id = uuid::Uuid::new_v4().to_string();
                        handle.requests.lock().expect("provider requests").insert(id, PendingProviderRequest {
                            rpc_id: rpc_id.clone(), method: method.into(), params: message["params"].clone(),
                        });
                        let _ = emissions.send(ProtocolEmission::Requests(handle.pending_requests())).await;
                        continue;
                    }
                    if message.get("method").and_then(Value::as_str) == Some("item/tool/call")
                        && let Some(id) = message.get("id").cloned()
                    {
                        let tool = message.pointer("/params/tool").and_then(Value::as_str).unwrap_or("");
                        let args = message.pointer("/params/arguments").cloned().unwrap_or(Value::Null);
                        let result = handle.call_tool(tool, args).await;
                        let (success, output) = match result {
                            Ok((output, card)) => {
                                if let Some(card) = card {
                                    context.emissions.push(ProtocolEmission::System(card.to_string()));
                                    flush_emissions(context, emissions).await;
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
                    if let Some(reply) = unsupported_codex_request(&message) {
                        let method = message["method"].as_str().unwrap_or("unknown");
                        emit_error(context, format!("Codex requested {method}, which Inferay does not support yet. The request was declined so the turn can continue."));
                        flush_emissions(context, emissions).await;
                        if rpc.write(&reply).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    // App-server can report nested or stale provider turns on this
                    // transport. Only the submitted root owns this transcript and
                    // completion; never translate a child's output into its parent.
                    let params = &message["params"];
                    let event_thread = params["threadId"].as_str();
                    let event_turn = params["turnId"].as_str()
                        .or_else(|| params.pointer("/turn/id").and_then(Value::as_str));
                    if event_thread.is_some_and(|id| id != thread_id)
                        || event_turn.is_some_and(|id| id != turn_id)
                    {
                        continue;
                    }
                    if message["method"].as_str().is_some_and(|method| method.ends_with("/delta")) { handle.mark("firstDelta"); }
                    let is_completed = message.get("method").and_then(Value::as_str) == Some("turn/completed");
                    if is_completed && event_turn != Some(turn_id.as_str()) {
                        continue;
                    }
                    if let Some(method) = message["method"].as_str() {
                        crate::agent_protocol::handle_codex_notification(state, context, method, &message["params"]);
                        flush_emissions(context, emissions).await;
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
fn configure_codex_session(
    params: &mut Value,
    config: &Value,
    env: &HashMap<OsString, OsString>,
    wanted: Option<&[String]>,
) -> Result<(), String> {
    params["config"] = json!({});
    crate::agent_mcp::codex(params, config, &crate::agent_mcp::overrides(env), wanted)?;
    let provider = config["model_provider"].as_str().unwrap_or("openai");
    if provider != "openai" {
        return Ok(());
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
    Ok(())
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
        "summary": "auto",
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
    wanted: Option<&[String]>,
) -> Result<(Value, Vec<Value>), String> {
    let mut child = spawn_codex_app_server(binary, cwd, env).map_err(|e| e.to_string())?;
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut rpc = CodexConnection {
        stdin: child.stdin.take().expect("piped stdin"),
        stdout: ProviderFrames::new(child.stdout.take().expect("piped stdout")),
        read_failed: false,
        request_id: 0,
        pending_notifications: VecDeque::new(),
    };
    let mut context = AgentProtocolContext::new(cwd.to_owned());
    let mut protocol = CodexProtocolState::default();
    let (emissions, receiver) = protocol_channel();
    // Inventory inspection has no chat consumer. Discard notifications rather
    // than accumulating them while waiting for MCP discovery replies.
    drop(receiver);
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
        configure_codex_session(&mut params, &config["config"], env, wanted)?;
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
    stdout: ProviderFrames<tokio::process::ChildStdout>,
    read_failed: bool,
    request_id: u64,
    pending_notifications: VecDeque<Value>,
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
        if let Some(message) = self.pending_notifications.pop_front() {
            return Some(message);
        }
        self.read_frame().await
    }

    async fn read_frame(&mut self) -> Option<Value> {
        if self.read_failed {
            return None;
        }
        let result = match self.stdout.next().await {
            Ok(Some(line)) => serde_json::from_slice(&line)
                .map_err(|error| format!("Invalid provider JSON: {error}")),
            Ok(None) => return None,
            Err(error) => Err(error.to_string()),
        };
        Some(match result {
            Ok(message) => message,
            Err(error) => {
                self.read_failed = true;
                json!({"method":"error","params":{"error":{"message":error}}})
            }
        })
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        protocol: (
            &mut AgentProtocolContext,
            &mut CodexProtocolState,
            &ProtocolSender,
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
        let mut pending_bytes = 0;
        loop {
            if tokio::time::Instant::now() >= deadline {
                return Err(format!(
                    "Codex {method} response timed out; connection state is unknown"
                ));
            }
            let message = tokio::time::timeout_at(deadline, self.read_frame())
                .await
                .map_err(|_| {
                    format!("Codex {method} response timed out; connection state is unknown")
                })?
                .ok_or_else(|| "Codex App Server closed before replying".to_string())?;
            if self.read_failed {
                return Err(message["params"]["error"]["message"]
                    .as_str()
                    .unwrap_or("Could not read Codex response")
                    .to_owned());
            }
            if message.get("method").is_none()
                && message.get("id").and_then(Value::as_u64) == Some(id)
            {
                return rpc_result(message);
            }
            if let Some(reply) = unsupported_codex_request(&message) {
                self.write(&reply).await?;
                continue;
            }
            // A fast turn may emit output or completion before the start RPC
            // reply. Correlate those only after the root turn ID is known.
            if method == "turn/start" && message["method"].is_string() {
                pending_bytes += message.to_string().len();
                if self.pending_notifications.len() >= 128 || pending_bytes > 1_048_576 {
                    return Err(
                        "Codex emitted too much data before acknowledging turn/start".into(),
                    );
                }
                self.pending_notifications.push_back(message);
                continue;
            }
            if let Some(method) = message["method"].as_str() {
                crate::agent_protocol::handle_codex_notification(
                    state,
                    context,
                    method,
                    &message["params"],
                );
                flush_emissions(context, emissions).await;
            }
        }
    }
}

// Provider replies are matched to a live request, never inferred from chat text.
fn provider_request_reply(
    request: &PendingProviderRequest,
    answer: Value,
) -> Result<Value, String> {
    let result = match request.method.as_str() {
        "item/tool/requestUserInput" => {
            let questions = request.params["questions"]
                .as_array()
                .ok_or("Provider supplied invalid questions")?;
            let answers = answer
                .as_object()
                .ok_or("Answer each question separately")?;
            if answers.len() != questions.len() {
                return Err("Answer every question in this request".into());
            }
            let mut output = serde_json::Map::new();
            for question in questions {
                let id = question["id"].as_str().ok_or("Question has no identity")?;
                let text = answers
                    .get(id)
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                    .ok_or("An answer is missing")?;
                output.insert(id.into(), json!({"answers":[text]}));
            }
            json!({"answers":output})
        }
        "mcpServer/elicitation/request" => {
            let action = answer["action"]
                .as_str()
                .ok_or("Choose accept or decline")?;
            if !matches!(action, "accept" | "decline" | "cancel") {
                return Err("Invalid elicitation decision".into());
            }
            let content = answer.get("content").cloned().unwrap_or(json!({}));
            if action == "accept" && !request.params["requestedSchema"].is_null() {
                inferay_core::projects::validate_json(
                    &request.params["requestedSchema"],
                    &content,
                )?;
            }
            json!({"action":action,"content":content})
        }
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let decision = answer
                .as_str()
                .filter(|s| matches!(*s, "accept" | "decline" | "cancel"))
                .ok_or("Choose approve once or decline")?;
            if let Some(available) = request.params["availableDecisions"].as_array()
                && !available.iter().any(|value| value == decision)
            {
                return Err("Provider does not offer that decision".into());
            }
            json!({"decision":decision})
        }
        _ => return Err("Unsupported provider request".into()),
    };
    Ok(json!({"id":request.rpc_id,"result":result}))
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
    stderr: tokio::task::JoinHandle<(String, Option<std::io::Error>)>,
    protocol: (
        &mut AgentProtocolContext,
        &mut CodexProtocolState,
        &ProtocolSender,
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
    let stderr = stderr.await.unwrap_or_default().0.trim().to_string();
    state.clear_live_diff_state();
    state.finalize_open_block(context);
    if !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !state.completed_from_event
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
    flush_emissions(context, emissions).await;
    if state.completed_from_event {
        state.last_assistant_message.clone()
    } else {
        String::new()
    }
}

// GUI worker threads may block signals. exec preserves that mask, which leaves
// provider runtimes unable to reap hook/tool children or receive cancellation.
// Reset only in the child; the host's signal policy remains unchanged.
fn provider_command(binary: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(binary);
    #[cfg(unix)]
    unsafe {
        command.pre_exec(|| {
            let mut mask: libc::sigset_t = std::mem::zeroed();
            if libc::sigemptyset(&mut mask) != 0
                || libc::sigprocmask(libc::SIG_SETMASK, &mask, std::ptr::null_mut()) != 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command
}

fn spawn_codex_app_server(
    binary: &Path,
    cwd: &Path,
    env: &HashMap<OsString, OsString>,
) -> std::io::Result<tokio::process::Child> {
    provider_command(binary)
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
    provider_command(binary)
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

/// Drain diagnostics without retaining the entire stream. Return the tail even
/// on read failure so each caller can preserve its own error-reporting policy.
pub(crate) async fn drain_bounded(
    mut stream: impl AsyncRead + Unpin,
) -> (String, Option<std::io::Error>) {
    let mut tail = std::collections::VecDeque::new();
    let mut pending = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let (read, error) = match stream.read(&mut buffer).await {
            Ok(read) => (read, None),
            Err(error) => (0, Some(error)),
        };
        pending.extend_from_slice(&buffer[..read]);
        let mut consumed = 0;
        for chunk in pending.utf8_chunks() {
            consumed += chunk.valid().len();
            // Keep an incomplete final code point for the next read. Invalid
            // sequences elsewhere, or at EOF, use the normal lossy replacement.
            let incomplete = read > 0
                && consumed + chunk.invalid().len() == pending.len()
                && std::str::from_utf8(chunk.invalid())
                    .is_err_and(|error| error.error_len().is_none());
            tail.extend(chunk.valid().encode_utf16());
            if !incomplete && !chunk.invalid().is_empty() {
                tail.push_back(0xfffd);
            }
            if incomplete {
                break;
            }
            consumed += chunk.invalid().len();
        }
        pending.drain(..consumed);
        tail.drain(..tail.len().saturating_sub(MAX_STREAM_CHARS));
        if read == 0 {
            return (String::from_utf16_lossy(tail.make_contiguous()), error);
        }
    }
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

async fn flush_emissions(context: &mut AgentProtocolContext, sender: &ProtocolSender) {
    for emission in context.take_emissions() {
        let _ = sender.send(emission).await;
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
pub(crate) fn tree_kill(pid: u32) {
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
pub(crate) fn tree_kill(pid: u32) {
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
            configure_codex_session(&mut params, &config, &HashMap::new(), None).unwrap();
            assert_eq!(
                params["config"]["mcp_servers"]["GitKraken"]["enabled"],
                false
            );
            assert!(params["config"]["mcp_servers"].get("linear").is_none());
            assert_eq!(config, original);
        }
        let mut params = json!({});
        configure_codex_session(
            &mut params,
            &json!({"model_provider": "custom"}),
            &HashMap::new(),
            None,
        )
        .unwrap();
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
            PromptStore::open(root.join("bundled.json"), root.join("local.json")).unwrap(),
        )));
        let (tx, mut rx) = protocol_channel();
        let mut context = AgentProtocolContext::new(root.clone());
        let env = HashMap::new();
        let invocation = CodexInvocationContext {
            cwd: root.clone(),
            reference_paths: vec![],
            images: vec![],
            model: None,
            reasoning_level: None,
            developer_instructions: None,
            session_id: None,
            mcp_servers: None,
        };
        let make_run = || ProviderRun {
            binary: &binary,
            prompt: "fixture",
            invocation: &invocation,
            env: &env,
        };
        assert_eq!(
            run_claude(make_run(), &handle, &mut context, &tx).await,
            "done"
        );
        assert!(handle.pid().is_none());
        assert!(
            matches!(rx.try_recv().unwrap().0, ProtocolEmission::Session(id) if id == "fixture-session")
        );
        assert!(
            matches!(rx.try_recv().unwrap().0, ProtocolEmission::Chat(event) if event["result"] == "done")
        );
        std::fs::write(&binary, "#!/bin/sh\nprintf 'fixture failure' >&2\nexit 1\n").unwrap();
        assert_eq!(run_claude(make_run(), &handle, &mut context, &tx).await, "");
        assert!(
            matches!(rx.try_recv().unwrap().0, ProtocolEmission::System(error) if error == "fixture failure")
        );
        std::fs::remove_file(&binary).unwrap();
        assert_eq!(run_claude(make_run(), &handle, &mut context, &tx).await, "");
        assert!(matches!(
            rx.try_recv().unwrap().0,
            ProtocolEmission::System(_)
        ));
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(all(test, unix))]
#[path = "agent_runner_tests.rs"]
mod reliability_tests;
