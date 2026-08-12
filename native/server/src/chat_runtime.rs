//! Rust-native owner for live agent chat sessions.
//!
//! This module is the direct replacement boundary for `agent-chat.ts`: it owns
//! sessions, queues, transcript/event persistence, checkpoint lifecycle and
//! client fanout. Agent execution is injected as a Rust future so the server
//! can call `agent_runner::{run_claude, run_codex}` without Node/Bun or IPC.

use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use inferay_core::{
    agent_context::AgentContextStore,
    agent_protocol::{AgentEvent, AgentProtocolContext, ProtocolEmission},
    chat_protocol::{
        ChatMessageBuffer, ChatTranscriptMessage, javascript_slice, truncate_chat_content,
    },
    prompts::PromptStore,
};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;

use crate::{
    agent_runner::{AgentProcessHandle, AgentRunResult},
    chat_persistence::{ChatEventLogEntry, ChatPersistence, QueuedMessageInfo},
    checkpoint::CheckpointService,
};

const DISCONNECTED_SESSION_TTL: Duration = Duration::from_secs(5 * 60);
const GOAL_MAX_TURNS: u32 = 20;
const GOAL_COMPLETE_MARKER: &str = "[[GOAL_COMPLETE]]";
const GOAL_NEEDS_INPUT_MARKER: &str = "[[GOAL_NEEDS_INPUT]]";
const GENERATION_STOPPED_MESSAGE: &str = "Generation stopped";
const CODEX_WORKFLOW_INSTRUCTIONS: &str = r#"<inferay-workflow-instructions>
For coding tasks, inspect the relevant repository context before concluding that information is missing. Continue through implementation and proportionate verification unless blocked or the user asked only for analysis.
During substantial work, provide brief progress updates before tool work and after meaningful findings. Keep updates factual and do not claim checks that were not run.
Lead the final response with the outcome, then include changed files, verification actually run, and any remaining limitation.
Do not run formatters with write mode as a routine chat-completion step. In this project, do not run `bunx biome check --write ...` unless the user explicitly asks for Biome formatting.
Do not run `bun run build:renderer` at the end of every chat. Run builds/tests only when the user requests verification or when the change genuinely needs that specific check.
If formatting is needed, prefer the project's intended formatting or commit-hook flow and keep formatting-only churn out of unrelated edits.
</inferay-workflow-instructions>"#;
const FINAL_SUMMARY_RECOVERY_PROMPT: &str = r#"<inferay-final-summary-recovery>
The previous turn ended after a tool call without a final user-facing response. Provide the final summary now. Lead with the outcome, then state changed files, verification actually run, and any remaining limitation. Do not run more tools unless required to avoid an inaccurate claim.
</inferay-final-summary-recovery>"#;

pub type ClientId = u64;
pub type AgentFuture<'a> = Pin<Box<dyn Future<Output = Result<ExecutedTurn, String>> + Send + 'a>>;

/// The production implementation calls the Rust agent runner functions
/// directly. This trait exists for provider selection and deterministic tests;
/// it is not an IPC or JavaScript adapter boundary.
pub trait AgentExecutor: Send + Sync {
    fn run<'a>(
        &'a self,
        request: AgentRunRequest,
        handle: AgentProcessHandle,
        emissions: tokio::sync::mpsc::UnboundedSender<ProtocolEmission>,
    ) -> AgentFuture<'a>;
    fn stop(&self, agent_kind: &str, handle: &AgentProcessHandle);
    fn kill(&self, handle: &AgentProcessHandle);
}

#[derive(Clone, Debug)]
pub struct AgentRunRequest {
    pub pane_id: String,
    pub agent_kind: String,
    pub prompt: String,
    pub cwd: PathBuf,
    pub reference_paths: Vec<PathBuf>,
    pub images: Vec<PathBuf>,
    pub model: Option<String>,
    pub reasoning_level: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug)]
pub struct ExecutedTurn {
    pub result: AgentRunResult,
    pub protocol: AgentProtocolContext,
}

#[derive(Clone, Debug)]
pub struct SendMessageInput {
    pub pane_id: String,
    pub agent_kind: String,
    pub client_session_id: Option<String>,
    pub cwd: PathBuf,
    pub cwd_provided: bool,
    pub model: Option<String>,
    pub reasoning_level: Option<String>,
    pub reasoning_level_provided: bool,
    pub reference_paths: Vec<PathBuf>,
    pub reference_paths_provided: bool,
    pub display_text: Option<String>,
    pub images: Vec<PathBuf>,
    pub text: String,
    pub client_id: Option<ClientId>,
    pub client_sender: Option<broadcast::Sender<Value>>,
    pub include_workspace: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionInfo {
    pub pane_id: String,
    pub agent_kind: String,
    pub cwd: PathBuf,
    pub reference_paths: Vec<PathBuf>,
    pub session_id: Option<String>,
    pub is_running: bool,
    pub client_count: usize,
    pub message_count: usize,
}

#[derive(Clone, Debug)]
struct GoalState {
    objective: String,
    status: GoalStatus,
    turns: u32,
    started_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GoalStatus {
    Active,
    Paused,
}

struct ChatSession {
    pane_id: String,
    agent_kind: String,
    model: Option<String>,
    reasoning_level: Option<String>,
    session_id: Option<String>,
    clients: HashMap<ClientId, broadcast::Sender<Value>>,
    current_handle: Option<AgentProcessHandle>,
    turn_active: bool,
    cwd: PathBuf,
    reference_paths: Vec<PathBuf>,
    message_buffer: ChatMessageBuffer,
    disconnected_at: Option<u64>,
    cancelled: bool,
    goal: Option<GoalState>,
    agent_events: Vec<AgentEvent>,
    context_hash: Option<String>,
}

#[derive(Clone)]
pub struct ChatRuntime {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<ChatSession>>>>>,
    persistence: ChatPersistence,
    checkpoints: CheckpointService,
    executor: Arc<dyn AgentExecutor>,
    agent_context: Arc<Mutex<AgentContextStore>>,
    prompts: Arc<Mutex<PromptStore>>,
}

impl ChatRuntime {
    pub fn new(
        persistence: ChatPersistence,
        checkpoints: CheckpointService,
        executor: Arc<dyn AgentExecutor>,
        agent_context: Arc<Mutex<AgentContextStore>>,
        prompts: Arc<Mutex<PromptStore>>,
    ) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            persistence,
            checkpoints,
            executor,
            agent_context,
            prompts,
        }
    }

    pub fn send_message(
        &self,
        input: SendMessageInput,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        self.send_message_with_admission(input, false)
    }

    /// Publishes a queue already persisted by a compatibility HTTP route.
    /// Keeping persistence outside this method preserves that route's legacy
    /// `source: api` event-log semantics.
    pub async fn broadcast_queue(&self, pane_id: &str, queue: &[Value]) {
        let session = self.sessions.lock().await.get(pane_id).cloned();
        if let Some(session) = session {
            self.emit(
                &session,
                json!({"type":"chat:queue", "paneId":pane_id, "queue":queue}),
            )
            .await;
        }
    }

    fn send_message_with_admission(
        &self,
        input: SendMessageInput,
        already_admitted: bool,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let session = self.ensure_session(&input).await;
            let system_prefix = {
                let mut state = session.lock().await;
                let changed = state.agent_kind != input.agent_kind;
                if changed {
                    state.session_id = None;
                }
                state.agent_kind = input.agent_kind.clone();
                state.model.clone_from(&input.model);
                if input.reasoning_level_provided {
                    state.reasoning_level.clone_from(&input.reasoning_level);
                }
                if input.cwd_provided {
                    state.cwd.clone_from(&input.cwd);
                }
                if input.reference_paths_provided {
                    state.reference_paths.clone_from(&input.reference_paths);
                }
                if state.session_id.is_none() {
                    state.session_id.clone_from(&input.client_session_id);
                }
                if let (Some(client_id), Some(sender)) =
                    (input.client_id, input.client_sender.clone())
                {
                    state.clients.insert(client_id, sender);
                }
                let prefix = create_system_prefix(&state, input.include_workspace, changed);
                if !already_admitted && state.turn_active {
                    let queued = serde_json::to_value(QueuedMessageInfo {
                        id: Uuid::new_v4().to_string(),
                        text: input.text.clone(),
                        display_text: input
                            .display_text
                            .clone()
                            .unwrap_or_else(|| input.text.clone()),
                        images: (!input.images.is_empty()).then(|| paths_to_strings(&input.images)),
                    })
                    .expect("queue serialization");
                    let queue = self
                        .persistence
                        .enqueue_runtime(&input.pane_id, queued)
                        .await
                        .unwrap_or_default();
                    drop(state);
                    self.emit(
                        &session,
                        json!({"type":"chat:queue", "paneId":input.pane_id, "queue":queue}),
                    )
                    .await;
                    return;
                }
                state.turn_active = true;
                prefix
            };

            let agent_context_prefix = self
                .create_agent_context_prefix(&session, &input.text)
                .await;

            let display = input.display_text.as_deref().unwrap_or(&input.text);
            {
                let mut state = session.lock().await;
                state.message_buffer.push_user(
                    display,
                    (!input.images.is_empty()).then(|| paths_to_strings(&input.images)),
                );
                state.cancelled = false;
            }
            self.persistence
            .append_event(
                &input.pane_id,
                "user_message",
                json!({"text": input.text, "displayText": display, "images": paths_to_strings(&input.images)}),
            )
            .await;
            self.persist(&session).await;
            self.fanout_except(
                &session,
                json!({"type":"chat:user_message", "paneId":input.pane_id, "text":input.text}),
                input.client_id,
            )
            .await;

            let mut prompt = input.text.clone();
            if input.agent_kind == "codex"
                && let Some(command) = parse_goal_command(&prompt)
            {
                let Some(next) = self.handle_goal_command(&session, command).await else {
                    self.finalize_turn(&session).await;
                    self.drain_next_or_release(&session).await;
                    return;
                };
                prompt = next;
            }
            let instruction_prefix = [system_prefix, agent_context_prefix]
                .into_iter()
                .filter(|prefix| !prefix.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            if !instruction_prefix.is_empty() {
                prompt = format!("{instruction_prefix}\n\n{prompt}");
            }
            let checkpoint_cwd = session.lock().await.cwd.clone();
            let checkpoint_id = match self
                .checkpoints
                .create_checkpoint(input.pane_id.clone(), &checkpoint_cwd, input.text.clone())
                .await
            {
                Ok(id) => Some(id),
                Err(error) => {
                    self.persistence
                        .append_event(
                            &input.pane_id,
                            "checkpoint_failed",
                            json!({"stage":"create","message":error}),
                        )
                        .await;
                    None
                }
            };
            if let Some(id) = checkpoint_id.as_ref() {
                self.emit(
                    &session,
                    json!({"type":"checkpoint:created", "paneId":input.pane_id, "checkpointId":id}),
                )
                .await;
                self.persistence
                    .append_event(
                        &input.pane_id,
                        "checkpoint_created",
                        json!({"checkpointId":id}),
                    )
                    .await;
            }

            let outcome = self.run_goal_loop(&session, prompt, input.images).await;
            match outcome {
                Ok(()) => {
                    self.finalize_success(&session, checkpoint_id.as_deref())
                        .await
                }
                Err(error) => {
                    self.finalize_failure(&session, checkpoint_id.as_deref(), &error)
                        .await
                }
            }
        })
    }

    pub async fn stop_generation(&self, pane_id: &str) {
        let Some(session) = self.session(pane_id).await else {
            return;
        };
        let (agent_kind, handle) = {
            let mut state = session.lock().await;
            state.cancelled = true;
            state.goal = None;
            (state.agent_kind.clone(), state.current_handle.take())
        };
        if let Some(handle) = handle {
            self.executor.stop(&agent_kind, &handle);
        }
        let should_emit = {
            let state = session.lock().await;
            !state
                .message_buffer
                .messages()
                .last()
                .is_some_and(|message| {
                    message.role == "system" && message.content.trim() == GENERATION_STOPPED_MESSAGE
                })
        };
        if should_emit {
            self.emit_system(&session, GENERATION_STOPPED_MESSAGE).await;
        }
        self.finalize_turn(&session).await;
        self.emit(&session, status_message(pane_id, "idle", false))
            .await;
    }

    pub async fn destroy_session(&self, pane_id: &str) {
        if let Some(session) = self.sessions.lock().await.remove(pane_id) {
            {
                let mut state = session.lock().await;
                state.cancelled = true;
                state.goal = None;
                state.turn_active = false;
                // Dropping the last handle does not spawn a wrapper process;
                // the runner's child is kill-on-drop and explicit server wiring
                // may additionally invoke its PidTracker for Codex.
                if let Some(handle) = state.current_handle.take() {
                    self.executor.kill(&handle);
                }
            }
            self.persist(&session).await;
        }
    }

    pub async fn detach_client(&self, client_id: ClientId) {
        let sessions = self
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut needs_cleanup = false;
        for session in sessions {
            let mut state = session.lock().await;
            state.clients.remove(&client_id);
            if state.clients.is_empty() && !state.turn_active {
                state.disconnected_at = Some(now_millis());
                needs_cleanup = true;
            }
        }
        self.prune_disconnected().await;
        if needs_cleanup {
            let runtime = self.clone();
            tokio::spawn(async move {
                tokio::time::sleep(DISCONNECTED_SESSION_TTL).await;
                runtime.prune_disconnected().await;
            });
        }
    }

    pub async fn reconnect(
        &self,
        pane_id: &str,
        client_id: ClientId,
        sender: broadcast::Sender<Value>,
    ) {
        if let Some(session) = self.session(pane_id).await {
            let (session_message, sync, status) = {
                let mut state = session.lock().await;
                state.clients.insert(client_id, sender.clone());
                state.disconnected_at = None;
                let session_message = state.session_id.as_ref().map(|id| {
                    json!({
                        "type":"chat:session", "paneId":pane_id, "sessionId":id
                    })
                });
                let streaming = state.turn_active;
                let status = if state.turn_active {
                    if state.message_buffer.streaming() {
                        "responding"
                    } else {
                        "thinking"
                    }
                } else {
                    "idle"
                };
                (
                    session_message,
                    json!({
                        "type":"chat:sync", "paneId":pane_id,
                        "messages":state.message_buffer.messages(),
                        "revision":state.message_buffer.revision(), "isStreaming":streaming
                    }),
                    status_message(pane_id, status, state.turn_active),
                )
            };
            if let Some(message) = session_message {
                let _ = sender.send(message);
            }
            let _ = sender.send(sync);
            let queue = self
                .persistence
                .read_queue(pane_id)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| serde_json::from_value::<QueuedMessageInfo>(value).ok())
                .collect::<Vec<_>>();
            let _ = sender.send(json!({"type":"chat:queue", "paneId":pane_id, "queue":queue}));
            let _ = sender.send(status);
        } else {
            let snapshot = self.persistence.persisted_reconnect_snapshot(pane_id).await;
            let _ = sender.send(snapshot.sync);
            let _ = sender.send(snapshot.queue);
            let _ = sender.send(snapshot.status);
        }
    }

    pub async fn list_sessions(&self) -> Vec<AgentSessionInfo> {
        let sessions = self
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut output = Vec::new();
        for session in sessions {
            let state = session.lock().await;
            if state.turn_active || !state.clients.is_empty() {
                output.push(AgentSessionInfo {
                    pane_id: state.pane_id.clone(),
                    agent_kind: state.agent_kind.clone(),
                    cwd: state.cwd.clone(),
                    reference_paths: state.reference_paths.clone(),
                    session_id: state.session_id.clone(),
                    is_running: state.turn_active,
                    client_count: state.clients.len(),
                    message_count: state.message_buffer.messages().len(),
                });
            }
        }
        output
    }

    pub async fn list_goals(&self) -> Vec<Value> {
        let now = now_millis();
        let sessions = self
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut output = Vec::new();
        for session in sessions {
            let state = session.lock().await;
            let Some(goal) = state.goal.as_ref() else {
                continue;
            };
            output.push(json!({
                "paneId": state.pane_id,
                "agentKind": state.agent_kind,
                "cwd": state.cwd,
                "sessionId": state.session_id,
                "isRunning": state.turn_active,
                "clientCount": state.clients.len(),
                "objective": goal.objective,
                "status": if goal.status == GoalStatus::Active { "active" } else { "paused" },
                "turns": goal.turns,
                "startedAt": goal.started_at,
                "elapsedMs": now.saturating_sub(goal.started_at),
                "activity": goal_activity(&state),
            }));
        }
        output
    }

    pub async fn read_events(
        &self,
        pane_id: &str,
        after: u64,
        limit: usize,
    ) -> std::io::Result<Vec<ChatEventLogEntry>> {
        self.persistence.read_events(pane_id, after, limit).await
    }

    async fn create_agent_context_prefix(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        text: &str,
    ) -> String {
        let (cwd, pane_id) = {
            let state = session.lock().await;
            (
                state.cwd.to_string_lossy().into_owned(),
                state.pane_id.clone(),
            )
        };
        let skills = self.prompts.lock().await.load().unwrap_or_default();
        let context = self.agent_context.lock().await.resolve_for_agent(
            Some(&cwd),
            Some(&pane_id),
            text,
            &skills,
        );
        let base = [
            (!context.effective_instructions.is_empty()).then(|| {
                format!(
                    "<agent-instructions>\n{}\n</agent-instructions>",
                    context.effective_instructions
                )
            }),
            (!context.skill_manifest.is_empty()).then(|| {
                format!(
                    "<available-skills>\nThe following Inferay skills are available. When a request clearly matches one, follow that skill's instructions as a first-class workflow. Explicit /skill or $skill references take priority.\n{}\n</available-skills>",
                    context.skill_manifest
                )
            }),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n\n");
        let activated = context
            .activated_skills
            .iter()
            .filter_map(|skill| {
                Some(format!(
                    "<activated-skill name=\"{}\">\n{}\n</activated-skill>",
                    skill.get("command")?.as_str()?,
                    skill.get("instructions")?.as_str()?
                ))
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let include_base = {
            let mut state = session.lock().await;
            let include = state.context_hash.as_deref() != Some(base.as_str());
            if include {
                state.context_hash = Some(base.clone());
            }
            include
        };
        [
            include_base.then_some(base),
            (!activated.is_empty()).then_some(activated),
        ]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
    }

    async fn ensure_session(&self, input: &SendMessageInput) -> Arc<Mutex<ChatSession>> {
        if let Some(session) = self.session(&input.pane_id).await {
            return session;
        }
        let mut buffer = ChatMessageBuffer::default();
        if let Some(messages) = self
            .persistence
            .read_authoritative_transcript(&input.pane_id)
            .await
        {
            buffer.replace_messages(messages);
        }
        let session = Arc::new(Mutex::new(ChatSession {
            pane_id: input.pane_id.clone(),
            agent_kind: input.agent_kind.clone(),
            model: input.model.clone(),
            reasoning_level: input.reasoning_level.clone(),
            session_id: input.client_session_id.clone(),
            clients: input
                .client_id
                .zip(input.client_sender.clone())
                .into_iter()
                .collect(),
            current_handle: None,
            turn_active: false,
            cwd: input.cwd.clone(),
            reference_paths: input.reference_paths.clone(),
            message_buffer: buffer,
            disconnected_at: None,
            cancelled: false,
            goal: None,
            agent_events: Vec::new(),
            context_hash: None,
        }));
        self.sessions
            .lock()
            .await
            .insert(input.pane_id.clone(), session.clone());
        session
    }

    async fn session(&self, pane_id: &str) -> Option<Arc<Mutex<ChatSession>>> {
        self.sessions.lock().await.get(pane_id).cloned()
    }

    async fn run_goal_loop(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        prompt: String,
        images: Vec<PathBuf>,
    ) -> Result<(), String> {
        let goal_run = session
            .lock()
            .await
            .goal
            .as_ref()
            .is_some_and(|goal| goal.status == GoalStatus::Active);
        let mut result = self.run_once(session, prompt, images).await?;
        let last_is_tool = session
            .lock()
            .await
            .message_buffer
            .messages()
            .last()
            .is_some_and(|m| m.role == "tool");
        if !goal_run && last_is_tool && !session.lock().await.cancelled {
            result = self
                .run_once(session, FINAL_SUMMARY_RECOVERY_PROMPT.into(), Vec::new())
                .await?;
        }
        if !goal_run {
            return Ok(());
        }
        loop {
            let next = {
                let mut state = session.lock().await;
                let cancelled = state.cancelled;
                let Some(goal) = state.goal.as_mut() else {
                    return Ok(());
                };
                goal.turns += 1;
                match goal_result_status(&result.last_assistant_message) {
                    GoalResult::Complete => {
                        goal.status = GoalStatus::Paused;
                        None
                    }
                    GoalResult::Paused => {
                        goal.status = GoalStatus::Paused;
                        None
                    }
                    GoalResult::Active if !cancelled && goal.turns < GOAL_MAX_TURNS => {
                        Some(create_goal_continuation(goal))
                    }
                    GoalResult::Active => {
                        goal.status = GoalStatus::Paused;
                        None
                    }
                }
            };
            let Some(next) = next else { break };
            result = self.run_once(session, next, Vec::new()).await?;
        }
        let message = {
            let mut state = session.lock().await;
            let Some(goal) = state.goal.as_ref() else {
                return Ok(());
            };
            let result_status = goal_result_status(&result.last_assistant_message);
            let payload = match result_status {
                GoalResult::Complete => {
                    json!({"type":"inferay.goal", "status":"complete", "objective":goal.objective, "turns":goal.turns, "detail":"Goal achieved"})
                }
                GoalResult::Paused => {
                    json!({"type":"inferay.goal", "status":"paused", "objective":goal.objective, "turns":goal.turns, "detail":"Codex needs input. Reply with the missing detail or use /goal resume."})
                }
                GoalResult::Active => {
                    json!({"type":"inferay.goal", "status":"paused", "objective":goal.objective, "turns":goal.turns, "detail":format!("Paused after {GOAL_MAX_TURNS} turns")})
                }
            };
            if matches!(result_status, GoalResult::Complete | GoalResult::Paused) {
                state
                    .message_buffer
                    .replace_in_assistant_messages(|content| {
                        content
                            .replace(GOAL_COMPLETE_MARKER, "")
                            .replace(GOAL_NEEDS_INPUT_MARKER, "")
                            .trim()
                            .to_string()
                    });
            }
            if result_status == GoalResult::Complete {
                state.goal = None;
            }
            payload.to_string()
        };
        self.emit_system(session, &message).await;
        Ok(())
    }

    async fn run_once(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        prompt: String,
        images: Vec<PathBuf>,
    ) -> Result<AgentRunResult, String> {
        let (request, handle) = {
            let mut state = session.lock().await;
            let handle = AgentProcessHandle::default();
            state.current_handle = Some(handle.clone());
            (
                AgentRunRequest {
                    pane_id: state.pane_id.clone(),
                    agent_kind: state.agent_kind.clone(),
                    prompt: if state.agent_kind == "codex" {
                        format!("{CODEX_WORKFLOW_INSTRUCTIONS}\n\n{prompt}")
                    } else {
                        prompt
                    },
                    cwd: state.cwd.clone(),
                    reference_paths: state.reference_paths.clone(),
                    images,
                    model: state.model.clone(),
                    reasoning_level: state.reasoning_level.clone(),
                    session_id: state.session_id.clone(),
                },
                handle,
            )
        };
        let (emission_tx, mut emission_rx) = tokio::sync::mpsc::unbounded_channel();
        let executed = self.executor.run(request, handle, emission_tx);
        tokio::pin!(executed);
        let executed = loop {
            tokio::select! {
                result = &mut executed => break result,
                emission = emission_rx.recv() => {
                    if let Some(emission) = emission {
                        self.apply_emissions(session, vec![emission]).await;
                    }
                }
            }
        };
        while let Ok(emission) = emission_rx.try_recv() {
            self.apply_emissions(session, vec![emission]).await;
        }
        session.lock().await.current_handle = None;
        let mut executed = executed?;
        self.apply_emissions(session, executed.protocol.take_emissions())
            .await;
        Ok(executed.result)
    }

    async fn apply_emissions(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        emissions: Vec<ProtocolEmission>,
    ) {
        let pane_id = session.lock().await.pane_id.clone();
        for emission in emissions {
            match emission {
                ProtocolEmission::Chat(event) => {
                    let event = bound_chat_event(event);
                    if event.get("type").and_then(Value::as_str) != Some("content_block_delta") {
                        self.persistence.append_event(&pane_id, "agent_event", event.clone()).await;
                    }
                    session.lock().await.message_buffer.apply_event(&event);
                    self.emit(session, json!({"type":"chat:event", "paneId":pane_id, "event":event})).await;
                }
                ProtocolEmission::Agent(event) => {
                    let compact = compact_agent_event(event);
                    let mut state = session.lock().await;
                    state.agent_events.push(compact.clone());
                    if state.agent_events.len() > 500 { let drop = state.agent_events.len() - 500; state.agent_events.drain(..drop); }
                    drop(state);
                    self.emit(session, json!({"type":"chat:agent-event", "paneId":pane_id, "event":compact})).await;
                }
                ProtocolEmission::Status { status, is_loading } => self.emit(session, status_message(&pane_id, &status, is_loading)).await,
                ProtocolEmission::Activity { tool_name, summary, is_streaming } => self.emit(session, json!({"type":"chat:activity", "paneId":pane_id, "activity":{"toolName":tool_name,"summary":summary,"isStreaming":is_streaming}})).await,
                ProtocolEmission::System(message) => self.emit_system(session, &message).await,
                ProtocolEmission::Session(id) => {
                    session.lock().await.session_id = Some(id.clone());
                    self.emit(session, json!({"type":"chat:session", "paneId":pane_id, "sessionId":id})).await;
                }
            }
        }
        self.persist(session).await;
    }

    async fn finalize_success(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        checkpoint_id: Option<&str>,
    ) {
        let changed = self
            .finalize_checkpoint_events(session, checkpoint_id)
            .await;
        let pane_id = session.lock().await.pane_id.clone();
        let needs_summary = {
            let state = session.lock().await;
            let last = state.message_buffer.messages().last();
            !(last.is_some_and(|m| m.role == "assistant" && !m.content.trim().is_empty()))
                && (changed > 0 || last.is_some_and(|m| m.role == "tool"))
        };
        if needs_summary {
            let text = if changed > 0 {
                format!(
                    "Updated {changed} file{}, but Codex did not provide a final summary.",
                    if changed == 1 { "" } else { "s" }
                )
            } else {
                "The tool run completed, but Codex did not provide a final summary.".into()
            };
            let event = json!({"type":"result", "result":text});
            session.lock().await.message_buffer.apply_event(&event);
            self.persistence
                .append_event(&pane_id, "agent_event", event.clone())
                .await;
            self.emit(
                session,
                json!({"type":"chat:event", "paneId":pane_id, "event":event}),
            )
            .await;
        }
        self.finalize_turn(session).await;
        self.drain_next_or_release(session).await;
    }

    async fn finalize_checkpoint_events(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        checkpoint_id: Option<&str>,
    ) -> usize {
        let pane_id = session.lock().await.pane_id.clone();
        let touched = edited_paths(session.lock().await.message_buffer.messages());
        if let Some(id) = checkpoint_id {
            match self.checkpoints.finalize_checkpoint(id, &touched).await {
                Ok(Some(meta)) if meta.changed_file_count > 0 => {
                    self.emit(session, json!({"type":"checkpoint:finalized", "paneId":pane_id, "checkpointId":id, "changedFileCount":meta.changed_file_count, "changedFiles":meta.changed_files})).await;
                    self.persistence.append_event(&pane_id, "checkpoint_finalized", json!({"checkpointId":id,"changedFileCount":meta.changed_file_count,"changedFiles":meta.changed_files})).await;
                    let existing =
                        existing_edit_paths(session.lock().await.message_buffer.messages());
                    for diff in self.checkpoints.get_inline_diffs(id).await {
                        if existing.contains(&diff.path) {
                            continue;
                        }
                        for event in [
                            json!({"type":"content_block_start","content_block":{"type":"tool_use","name":"Edit","input":{"file_path":diff.path,"old_string":diff.old_string,"new_string":diff.new_string}}}),
                            json!({"type":"content_block_stop"}),
                        ] {
                            session.lock().await.message_buffer.apply_event(&event);
                            self.persistence
                                .append_event(&pane_id, "agent_event", event.clone())
                                .await;
                            self.emit(
                                session,
                                json!({"type":"chat:event","paneId":pane_id,"event":event}),
                            )
                            .await;
                        }
                    }
                    meta.changed_file_count
                }
                Ok(Some(_)) => {
                    self.persistence
                        .append_event(&pane_id, "checkpoint_unchanged", json!({"checkpointId":id}))
                        .await;
                    0
                }
                Ok(None) => {
                    self.persistence
                        .append_event(
                            &pane_id,
                            "checkpoint_skipped",
                            json!({"checkpointId":id,"reason":"missing_metadata"}),
                        )
                        .await;
                    0
                }
                Err(error) => {
                    self.persistence
                        .append_event(
                            &pane_id,
                            "checkpoint_failed",
                            json!({"checkpointId":id,"stage":"finalize","message":error}),
                        )
                        .await;
                    0
                }
            }
        } else {
            self.persistence
                .append_event(
                    &pane_id,
                    "checkpoint_skipped",
                    json!({"reason":"not_created"}),
                )
                .await;
            0
        }
    }

    async fn finalize_failure(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        checkpoint_id: Option<&str>,
        error: &str,
    ) {
        self.emit_system(session, error).await;
        session.lock().await.message_buffer.finalize();
        self.persist(session).await;
        let pane_id = session.lock().await.pane_id.clone();
        self.emit(
            session,
            json!({"type":"chat:error", "paneId":pane_id, "error":error}),
        )
        .await;
        self.finalize_checkpoint_events(session, checkpoint_id)
            .await;
        self.persist(session).await;
        self.drain_next_or_release(session).await;
    }

    async fn finalize_turn(&self, session: &Arc<Mutex<ChatSession>>) {
        let message = {
            let mut state = session.lock().await;
            state.message_buffer.finalize();
            json!({"type":"chat:sync", "paneId":state.pane_id, "messages":state.message_buffer.messages(), "revision":state.message_buffer.revision(), "isStreaming":false})
        };
        self.persist(session).await;
        self.emit(session, message).await;
        let pane_id = session.lock().await.pane_id.clone();
        self.emit(session, json!({"type":"chat:done", "paneId":pane_id}))
            .await;
    }

    async fn persist(&self, session: &Arc<Mutex<ChatSession>>) {
        let (pane, messages) = {
            let state = session.lock().await;
            (
                state.pane_id.clone(),
                state.message_buffer.messages().to_vec(),
            )
        };
        let _ = self.persistence.write_transcript(&pane, messages).await;
    }

    async fn emit_system(&self, session: &Arc<Mutex<ChatSession>>, message: &str) {
        let pane = {
            let mut state = session.lock().await;
            state.message_buffer.push_system(message);
            state.pane_id.clone()
        };
        self.persistence
            .append_event(&pane, "system_message", json!({"message":message}))
            .await;
        self.emit(
            session,
            json!({"type":"chat:system", "paneId":pane, "message":message}),
        )
        .await;
    }

    async fn emit(&self, session: &Arc<Mutex<ChatSession>>, message: Value) {
        for sender in session.lock().await.clients.values() {
            let _ = sender.send(message.clone());
        }
    }

    async fn fanout_except(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        message: Value,
        exclude: Option<ClientId>,
    ) {
        for (id, sender) in &session.lock().await.clients {
            if Some(*id) != exclude {
                let _ = sender.send(message.clone());
            }
        }
    }

    async fn drain_next_or_release(&self, session: &Arc<Mutex<ChatSession>>) {
        let pane = session.lock().await.pane_id.clone();
        let (next, queue) = loop {
            let mut state = session.lock().await;
            let shifted = self.persistence.shift_runtime(&pane).await.unwrap_or(None);
            let Some((next, queue)) = shifted else {
                state.turn_active = false;
                return;
            };
            drop(state);
            if let Ok(next) = serde_json::from_value::<QueuedMessageInfo>(next) {
                break (next, queue);
            }
        };
        self.emit(
            session,
            json!({"type":"chat:queue", "paneId":pane, "queue":queue}),
        )
        .await;
        self.persistence
            .append_queue_drained(&pane, &next.id, queue.len())
            .await;
        let state = session.lock().await;
        let input = SendMessageInput {
            pane_id: pane,
            agent_kind: state.agent_kind.clone(),
            client_session_id: state.session_id.clone(),
            cwd: state.cwd.clone(),
            cwd_provided: true,
            model: state.model.clone(),
            reasoning_level: state.reasoning_level.clone(),
            reasoning_level_provided: true,
            reference_paths: state.reference_paths.clone(),
            reference_paths_provided: true,
            display_text: Some(next.display_text),
            images: next
                .images
                .unwrap_or_default()
                .into_iter()
                .map(PathBuf::from)
                .collect(),
            text: next.text,
            client_id: None,
            client_sender: None,
            include_workspace: true,
        };
        drop(state);
        // Box the recursive queue drain so the async state machine remains
        // finite-sized. The TypeScript runtime fire-and-forgot this call; the
        // Rust owner keeps it in the same task, preserving queue order.
        self.send_message_with_admission(input, true).await;
    }

    async fn handle_goal_command(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        command: GoalCommand,
    ) -> Option<String> {
        let (pane, message, prompt) = {
            let mut state = session.lock().await;
            let pane = state.pane_id.clone();
            match command {
                GoalCommand::Start(objective) => { state.goal = Some(GoalState { objective: objective.clone(), status: GoalStatus::Active, turns: 0, started_at: now_millis() }); (pane, json!({"type":"inferay.goal","status":"active","objective":objective,"turns":0,"detail":"Goal started"}), Some(create_goal_prompt(&objective))) }
                GoalCommand::Pause => { if let Some(goal)=state.goal.as_mut(){goal.status=GoalStatus::Paused;} (pane, goal_message(state.goal.as_ref(), "paused", "Goal paused"), None) }
                GoalCommand::Resume => { if let Some(goal)=state.goal.as_mut(){goal.status=GoalStatus::Active; let prompt=create_goal_continuation(goal); (pane, goal_message(Some(goal), "active", "Goal resumed"), Some(prompt))} else {(pane,json!({"type":"inferay.goal","status":"empty","detail":"No goal to resume"}),None)} }
                GoalCommand::Clear => { let old=state.goal.take(); (pane, goal_message(old.as_ref(), "cleared", "Goal cleared"), None) }
                GoalCommand::Status => (pane, state.goal.as_ref().map_or_else(||json!({"type":"inferay.goal","status":"empty","detail":"No active goal"}), |goal|goal_message(Some(goal), if goal.status==GoalStatus::Active{"active"}else{"paused"}, "")), None),
            }
        };
        self.emit_system(session, &message.to_string()).await;
        self.persistence
            .append_event(&pane, "goal_command", message)
            .await;
        prompt
    }

    async fn prune_disconnected(&self) {
        let now = now_millis();
        let ttl = DISCONNECTED_SESSION_TTL.as_millis() as u64;
        let entries = self
            .sessions
            .lock()
            .await
            .iter()
            .map(|(id, s)| (id.clone(), s.clone()))
            .collect::<Vec<_>>();
        let mut remove = Vec::new();
        for (id, session) in entries {
            let state = session.lock().await;
            if !state.turn_active
                && state.clients.is_empty()
                && state
                    .disconnected_at
                    .is_some_and(|at| now.saturating_sub(at) >= ttl)
            {
                remove.push(id);
            }
        }
        let mut sessions = self.sessions.lock().await;
        for id in remove {
            sessions.remove(&id);
        }
    }
}

#[derive(Debug)]
enum GoalCommand {
    Start(String),
    Pause,
    Resume,
    Clear,
    Status,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum GoalResult {
    Active,
    Paused,
    Complete,
}

fn parse_goal_command(text: &str) -> Option<GoalCommand> {
    let trimmed = text.trim();
    if trimmed.len() < 5
        || !trimmed[..5].eq_ignore_ascii_case("/goal")
        || trimmed
            .as_bytes()
            .get(5)
            .is_some_and(|b| !b.is_ascii_whitespace())
    {
        return None;
    }
    let args = trimmed[5..].trim();
    Some(match args.to_ascii_lowercase().as_str() {
        "pause" => GoalCommand::Pause,
        "resume" => GoalCommand::Resume,
        "clear" | "stop" => GoalCommand::Clear,
        "" | "status" => GoalCommand::Status,
        _ => GoalCommand::Start(args.into()),
    })
}
fn create_goal_prompt(objective: &str) -> String {
    format!(
        "Start pursuing this goal until it is genuinely complete:\n\n{objective}\n\nWork autonomously. When the goal is fully achieved, include {GOAL_COMPLETE_MARKER} in your final response. If you are blocked and need user input, include {GOAL_NEEDS_INPUT_MARKER}."
    )
}
fn create_goal_continuation(goal: &GoalState) -> String {
    format!(
        "<goal-continuation>\nObjective: {}\nTurns used: {}\nElapsed milliseconds: {}\n\nContinue working toward the objective. Do not ask for confirmation unless you are blocked. When the goal is fully achieved, include {GOAL_COMPLETE_MARKER} in your final response. If you need user input to proceed, include {GOAL_NEEDS_INPUT_MARKER}.\n</goal-continuation>",
        goal.objective,
        goal.turns,
        now_millis().saturating_sub(goal.started_at)
    )
}
fn goal_result_status(text: &str) -> GoalResult {
    if text.contains(GOAL_COMPLETE_MARKER) {
        GoalResult::Complete
    } else if text.contains(GOAL_NEEDS_INPUT_MARKER) {
        GoalResult::Paused
    } else {
        GoalResult::Active
    }
}
fn goal_message(goal: Option<&GoalState>, status: &str, detail: &str) -> Value {
    goal.map_or_else(||json!({"type":"inferay.goal","status":"empty","detail":"No active goal"}),|goal|json!({"type":"inferay.goal","status":status,"objective":goal.objective,"turns":goal.turns,"detail":detail}))
}
fn paths_to_strings(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}
fn create_system_prefix(
    session: &ChatSession,
    include_workspace: bool,
    include_prior_context: bool,
) -> String {
    let workspace = if include_workspace && session.session_id.is_none() {
        let mut sections = vec!["You are working in a multi-directory workspace.".to_string()];
        sections.push(format!(
            "Primary working directory (use this as the execution root unless the user says otherwise): {}",
            session.cwd.to_string_lossy()
        ));
        if !session.reference_paths.is_empty() {
            sections.push(format!(
                "Additional reference directories available in this workspace:\n{}",
                session
                    .reference_paths
                    .iter()
                    .map(|path| format!("- {}", path.to_string_lossy()))
                    .collect::<Vec<_>>()
                    .join("\n")
            ));
            sections.push("The additional directories are supporting context. Read and reference them when relevant, but treat the primary working directory as the default root.".into());
        }
        format!(
            "<workspace-context>\n{}\n</workspace-context>",
            sections.join("\n\n")
        )
    } else {
        String::new()
    };
    let prior_lines = if include_prior_context {
        session
            .message_buffer
            .messages()
            .iter()
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .filter_map(|message| match message.role.as_str() {
                "user" => Some(format!(
                    "User: {}",
                    javascript_slice(&message.content, 0, 500)
                )),
                "assistant" if !message.content.is_empty() => Some(format!(
                    "Assistant: {}",
                    javascript_slice(&message.content, 0, 500)
                )),
                _ => None,
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let prior = if prior_lines.is_empty() {
        String::new()
    } else {
        format!(
            "<prior-conversation-context>\nThe following is a summary of the prior conversation in this chat session (from a different model). Use it as context for the request below.\n\n{}\n</prior-conversation-context>",
            prior_lines.join("\n\n")
        )
    };
    [workspace, prior]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}
fn status_message(pane: &str, status: &str, is_loading: bool) -> Value {
    json!({"type":"chat:status","paneId":pane,"status":status,"isLoading":is_loading})
}
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn bound_chat_event(mut event: Value) -> Value {
    if let Some(delta) = event.get_mut("delta").and_then(Value::as_object_mut) {
        for key in ["text", "partial_json"] {
            if let Some(text) = delta.get(key).and_then(Value::as_str) {
                delta.insert(
                    key.into(),
                    Value::String(truncate_chat_content(text, 64_000)),
                );
            }
        }
    }
    if let Some(result) = event
        .get("result")
        .and_then(Value::as_str)
        .map(|s| truncate_chat_content(s, 256_000))
    {
        event["result"] = Value::String(result);
    }
    if let Some(block) = event
        .get_mut("content_block")
        .and_then(Value::as_object_mut)
    {
        bound_content_block(block);
    }
    if let Some(content) = event
        .get_mut("message")
        .and_then(Value::as_object_mut)
        .and_then(|message| message.get_mut("content"))
        .and_then(Value::as_array_mut)
    {
        for block in content {
            if let Some(block) = block.as_object_mut() {
                bound_content_block(block);
            }
        }
    }
    event
}

fn bound_content_block(block: &mut serde_json::Map<String, Value>) {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => {
            if let Some(text) = block
                .get("text")
                .and_then(Value::as_str)
                .map(|text| truncate_chat_content(text, 256_000))
            {
                block.insert("text".into(), Value::String(text));
            }
        }
        Some("tool_use") => {
            let Some(input) = block.get("input") else {
                return;
            };
            let serialized = input
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| serde_json::to_string(input).unwrap_or_default());
            let bounded = truncate_chat_content(&serialized, 256_000);
            if bounded != serialized {
                block.insert("input".into(), Value::String(bounded));
            }
        }
        _ => {}
    }
}
fn compact_agent_event(event: AgentEvent) -> AgentEvent {
    match event {
        AgentEvent::TextDelta { text, message_id } => AgentEvent::TextDelta {
            text: truncate_chat_content(&text, 16_000),
            message_id,
        },
        AgentEvent::ThinkingDelta { text, message_id } => AgentEvent::ThinkingDelta {
            text: truncate_chat_content(&text, 16_000),
            message_id,
        },
        AgentEvent::Result { text } => AgentEvent::Result {
            text: truncate_chat_content(&text, 16_000),
        },
        AgentEvent::Error { message } => AgentEvent::Error {
            message: truncate_chat_content(&message, 16_000),
        },
        AgentEvent::ToolCallStart {
            tool_call_id,
            tool_name,
            summary,
            ..
        } => AgentEvent::ToolCallStart {
            tool_call_id,
            tool_name,
            input: None,
            summary,
        },
        AgentEvent::ToolCallEnd {
            tool_call_id,
            error,
            ..
        } => AgentEvent::ToolCallEnd {
            tool_call_id,
            output: None,
            error,
        },
        AgentEvent::Raw {
            provider,
            event_type,
            ..
        } => AgentEvent::Raw {
            provider,
            event_type,
            event: None,
        },
        event => event,
    }
}
fn edited_paths(messages: &[ChatTranscriptMessage]) -> Vec<String> {
    let mut paths = Vec::new();
    let start = messages
        .iter()
        .rposition(|message| message.role == "user")
        .map_or(0, |index| index + 1);
    for message in &messages[start..] {
        if message.role != "tool" {
            continue;
        }
        let name = message
            .tool_name
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase();
        if !["edit", "write", "multiedit", "patch", "apply_patch"].contains(&name.as_str()) {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&message.content) {
            collect_paths(&value, &mut paths);
        }
    }
    paths
}
fn existing_edit_paths(messages: &[ChatTranscriptMessage]) -> std::collections::HashSet<String> {
    messages
        .iter()
        .filter(|message| message.role == "tool" && message.tool_name.as_deref() == Some("Edit"))
        .filter_map(|message| serde_json::from_str::<Value>(&message.content).ok())
        .filter_map(|value| {
            value
                .get("file_path")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect()
}
fn collect_paths(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if ["path", "file", "file_path"].contains(&key.as_str()) {
                    if let Some(path) = value.as_str() {
                        output.push(path.into());
                    }
                } else if ["files", "changes"].contains(&key.as_str())
                    && let Some(values) = value.as_array()
                {
                    output.extend(values.iter().filter_map(Value::as_str).map(str::to_owned));
                }
                collect_paths(value, output)
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_paths(value, output)
            }
        }
        _ => {}
    }
}

fn goal_activity(session: &ChatSession) -> Vec<Value> {
    let mut activity = Vec::new();
    for (index, event) in session.agent_events.iter().enumerate() {
        let item = match event {
            AgentEvent::Status { status, label } => Some(json!({
                "id": format!("status-{index}"), "type": "status",
                "label": label.as_deref().unwrap_or(status), "detail": null,
                "state": if status == "error" { "error" } else if status == "idle" { "complete" } else { "running" }
            })),
            AgentEvent::ToolCallStart {
                tool_call_id,
                tool_name,
                summary,
                ..
            } => Some(json!({
                "id": tool_call_id, "type": "tool", "label": tool_name,
                "detail": summary, "state": "running"
            })),
            AgentEvent::ToolCallEnd {
                tool_call_id,
                error,
                ..
            } => Some(json!({
                "id": format!("{tool_call_id}-end"), "type": "tool",
                "label": if error.is_some() { "Tool failed" } else { "Tool finished" },
                "detail": error, "state": if error.is_some() { "error" } else { "complete" }
            })),
            AgentEvent::Result { text } => Some(json!({
                "id": format!("result-{index}"), "type": "result", "label": "Result",
                "detail": first_useful_line(text, 140), "state": "complete"
            })),
            AgentEvent::Error { message } => Some(json!({
                "id": format!("error-{index}"), "type": "error", "label": "Error",
                "detail": message, "state": "error"
            })),
            _ => None,
        };
        if let Some(item) = item {
            activity.push(item);
            if activity.len() > 30 {
                activity.remove(0);
            }
        }
    }
    if let Some(message) = session
        .message_buffer
        .messages()
        .iter()
        .rev()
        .find(|message| message.role == "system" && !message.content.trim().is_empty())
    {
        activity.push(json!({
            "id": format!("system-{}", activity.len()), "type": "system", "label": "System",
            "detail": first_useful_line(&message.content, 140),
            "state": if session.goal.as_ref().is_some_and(|goal| goal.status == GoalStatus::Paused) { "paused" } else { "complete" }
        }));
        if activity.len() > 30 {
            activity.remove(0);
        }
    }
    activity
}

fn first_useful_line(text: &str, max: usize) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let units = line.encode_utf16().collect::<Vec<_>>();
    if units.len() > max {
        format!(
            "{}...",
            String::from_utf16_lossy(&units[..max.saturating_sub(3)])
        )
    } else {
        line.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use inferay_core::path_security::AllowedPaths;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::tempdir;

    struct UnusedExecutor;

    impl AgentExecutor for UnusedExecutor {
        fn run<'a>(
            &'a self,
            _request: AgentRunRequest,
            _handle: AgentProcessHandle,
            _emissions: tokio::sync::mpsc::UnboundedSender<ProtocolEmission>,
        ) -> AgentFuture<'a> {
            Box::pin(async { Err("executor must not run in queue replacement test".into()) })
        }

        fn stop(&self, _agent_kind: &str, _handle: &AgentProcessHandle) {}

        fn kill(&self, _handle: &AgentProcessHandle) {}
    }

    struct CountingExecutor(AtomicUsize);

    impl AgentExecutor for CountingExecutor {
        fn run<'a>(
            &'a self,
            _request: AgentRunRequest,
            _handle: AgentProcessHandle,
            _emissions: tokio::sync::mpsc::UnboundedSender<ProtocolEmission>,
        ) -> AgentFuture<'a> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err("test failure".into()) })
        }

        fn stop(&self, _agent_kind: &str, _handle: &AgentProcessHandle) {}
        fn kill(&self, _handle: &AgentProcessHandle) {}
    }

    fn test_runtime(
        root: &Path,
        executor: Arc<dyn AgentExecutor>,
    ) -> (ChatRuntime, ChatPersistence, CheckpointService) {
        let persistence = ChatPersistence::new(root.join("data"));
        let allowed = AllowedPaths::new(root, root).unwrap();
        let checkpoints = CheckpointService::new(allowed, root.join("checkpoints.json"));
        let runtime = ChatRuntime::new(
            persistence.clone(),
            checkpoints.clone(),
            executor,
            Arc::new(Mutex::new(AgentContextStore::new(
                root.join("agent-context.json"),
            ))),
            Arc::new(Mutex::new(PromptStore::new(
                root.join("bundled-prompts.json"),
                root.join("prompts.json"),
            ))),
        );
        (runtime, persistence, checkpoints)
    }

    fn test_session(
        root: &Path,
        sender: broadcast::Sender<Value>,
        current_handle: Option<AgentProcessHandle>,
    ) -> Arc<Mutex<ChatSession>> {
        Arc::new(Mutex::new(ChatSession {
            pane_id: "pane".into(),
            agent_kind: "codex".into(),
            model: None,
            reasoning_level: None,
            session_id: None,
            clients: HashMap::from([(1, sender)]),
            current_handle,
            turn_active: true,
            cwd: root.into(),
            reference_paths: Vec::new(),
            message_buffer: ChatMessageBuffer::default(),
            disconnected_at: None,
            cancelled: false,
            goal: None,
            agent_events: Vec::new(),
            context_hash: None,
        }))
    }

    #[tokio::test]
    async fn stop_does_not_admit_a_queued_turn_before_the_owner_unwinds() {
        let root = tempdir().unwrap();
        let executor = Arc::new(CountingExecutor(AtomicUsize::new(0)));
        let (runtime, persistence, _) = test_runtime(root.path(), executor.clone());
        let (sender, mut receiver) = broadcast::channel(16);
        let session = test_session(root.path(), sender, Some(AgentProcessHandle::default()));
        runtime.sessions.lock().await.insert("pane".into(), session);
        persistence
            .save_queue(
                "pane",
                &[json!({"id":"q1","text":"next","displayText":"next"})],
            )
            .await
            .unwrap();

        runtime.stop_generation("pane").await;
        tokio::task::yield_now().await;

        assert_eq!(executor.0.load(Ordering::SeqCst), 0);
        assert_eq!(persistence.read_queue("pane").await.unwrap().len(), 1);
        let types = [
            receiver.recv().await.unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string(),
            receiver.recv().await.unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string(),
            receiver.recv().await.unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string(),
            receiver.recv().await.unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string(),
        ];
        assert_eq!(
            types,
            ["chat:system", "chat:sync", "chat:done", "chat:status"]
        );
    }

    #[tokio::test]
    async fn reconnect_reports_an_active_turn_between_stream_blocks() {
        let root = tempdir().unwrap();
        let (runtime, _, _) = test_runtime(root.path(), Arc::new(UnusedExecutor));
        let (existing_sender, _) = broadcast::channel(8);
        let session = test_session(root.path(), existing_sender, None);
        {
            let mut state = session.lock().await;
            state.message_buffer.apply_event(&json!({
                "type":"content_block_start",
                "content_block":{"type":"text","text":"progress"}
            }));
            state
                .message_buffer
                .apply_event(&json!({"type":"content_block_stop"}));
            assert!(!state.message_buffer.streaming());
            assert!(state.turn_active);
        }
        runtime.sessions.lock().await.insert("pane".into(), session);

        let (sender, mut receiver) = broadcast::channel(8);
        runtime.reconnect("pane", 2, sender).await;
        let sync = receiver.recv().await.unwrap();
        let queue = receiver.recv().await.unwrap();
        let status = receiver.recv().await.unwrap();

        assert_eq!(sync["type"], "chat:sync");
        assert_eq!(sync["isStreaming"], true);
        assert_eq!(queue["type"], "chat:queue");
        assert_eq!(status["type"], "chat:status");
        assert_eq!(status["isLoading"], true);
        assert_eq!(status["status"], "thinking");
    }

    #[tokio::test]
    async fn drain_broadcasts_remainder_before_starting_the_next_turn() {
        let root = tempdir().unwrap();
        let executor = Arc::new(CountingExecutor(AtomicUsize::new(0)));
        let (runtime, persistence, _) = test_runtime(root.path(), executor);
        let (sender, mut receiver) = broadcast::channel(32);
        let session = test_session(root.path(), sender, None);
        runtime
            .sessions
            .lock()
            .await
            .insert("pane".into(), session.clone());
        persistence
            .save_queue(
                "pane",
                &[
                    json!({"id":"q1","text":"first","displayText":"first"}),
                    json!({"id":"q2","text":"second","displayText":"second"}),
                ],
            )
            .await
            .unwrap();

        runtime.drain_next_or_release(&session).await;

        let first = receiver.recv().await.unwrap();
        assert_eq!(
            first,
            json!({"type":"chat:queue","paneId":"pane","queue":[{"id":"q2","text":"second","displayText":"second"}]})
        );
        assert_eq!(receiver.recv().await.unwrap()["type"], "chat:user_message");
    }

    #[tokio::test]
    async fn omitted_send_fields_preserve_live_session_context() {
        let root = tempdir().unwrap();
        let (runtime, _, _) = test_runtime(root.path(), Arc::new(UnusedExecutor));
        let (sender, _) = broadcast::channel(8);
        let session = test_session(root.path(), sender, Some(AgentProcessHandle::default()));
        let original_cwd = root.path().join("workspace");
        let original_reference = root.path().join("reference");
        {
            let mut state = session.lock().await;
            state.cwd.clone_from(&original_cwd);
            state.reference_paths = vec![original_reference.clone()];
            state.reasoning_level = Some("high".into());
        }
        runtime
            .sessions
            .lock()
            .await
            .insert("pane".into(), session.clone());

        runtime
            .send_message(SendMessageInput {
                pane_id: "pane".into(),
                agent_kind: "codex".into(),
                client_session_id: None,
                cwd: root.path().join("fallback-that-must-not-replace"),
                cwd_provided: false,
                model: Some("gpt-5.6-sol".into()),
                reasoning_level: None,
                reasoning_level_provided: false,
                reference_paths: Vec::new(),
                reference_paths_provided: false,
                display_text: None,
                images: Vec::new(),
                text: "queued".into(),
                client_id: None,
                client_sender: None,
                include_workspace: false,
            })
            .await;

        let state = session.lock().await;
        assert_eq!(state.cwd, original_cwd);
        assert_eq!(state.reference_paths, vec![original_reference]);
        assert_eq!(state.reasoning_level.as_deref(), Some("high"));
    }

    #[tokio::test]
    async fn failure_emits_checkpoint_and_inline_edit_without_sync_or_done() {
        let root = tempdir().unwrap();
        let root_path = std::fs::canonicalize(root.path()).unwrap();
        for arguments in [
            vec!["init"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
        ] {
            assert!(
                std::process::Command::new("git")
                    .args(arguments)
                    .current_dir(&root_path)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        std::fs::write(root_path.join("tracked.txt"), "before\n").unwrap();
        assert!(
            std::process::Command::new("git")
                .args(["add", "tracked.txt"])
                .current_dir(&root_path)
                .status()
                .unwrap()
                .success()
        );
        assert!(
            std::process::Command::new("git")
                .args(["commit", "-m", "initial"])
                .current_dir(&root_path)
                .status()
                .unwrap()
                .success()
        );

        let (runtime, _persistence, checkpoints) =
            test_runtime(&root_path, Arc::new(UnusedExecutor));
        let (sender, mut receiver) = broadcast::channel(32);
        let session = test_session(&root_path, sender, None);
        {
            let mut state = session.lock().await;
            state.message_buffer.push_user("change it", None);
            state.message_buffer.apply_event(&json!({
                "type":"content_block_start",
                "content_block":{"type":"tool_use","name":"Write","input":{"file_path":"tracked.txt"}}
            }));
            state
                .message_buffer
                .apply_event(&json!({"type":"content_block_stop"}));
        }
        runtime
            .sessions
            .lock()
            .await
            .insert("pane".into(), session.clone());
        let checkpoint_id = checkpoints
            .create_checkpoint("pane".into(), &root_path, "change it".into())
            .await
            .unwrap();
        std::fs::write(root_path.join("tracked.txt"), "after\n").unwrap();

        runtime
            .finalize_failure(&session, Some(&checkpoint_id), "agent failed")
            .await;

        let mut messages = Vec::new();
        while let Ok(message) = receiver.try_recv() {
            messages.push(message);
        }
        let types = messages
            .iter()
            .map(|message| message["type"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            types,
            [
                "chat:system",
                "chat:error",
                "checkpoint:finalized",
                "chat:event",
                "chat:event",
            ]
        );
        assert_eq!(messages[3]["event"]["type"], "content_block_start");
        assert_eq!(messages[3]["event"]["content_block"]["name"], "Edit");
        assert_eq!(messages[4]["event"]["type"], "content_block_stop");
        assert!(!types.contains(&"chat:sync"));
        assert!(!types.contains(&"chat:done"));
        let restored = runtime.persistence.read_transcript("pane").await.unwrap();
        assert_eq!(restored.last().unwrap().tool_name.as_deref(), Some("Edit"));
        assert_eq!(restored.last().unwrap().is_streaming, Some(false));
    }

    #[tokio::test]
    async fn compatibility_queue_broadcast_keeps_api_persistence_semantics() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().join("data"));
        let allowed = AllowedPaths::new(root.path(), root.path()).unwrap();
        let runtime = ChatRuntime::new(
            persistence.clone(),
            CheckpointService::new(allowed, root.path().join("checkpoints.json")),
            Arc::new(UnusedExecutor),
            Arc::new(Mutex::new(AgentContextStore::new(
                root.path().join("agent-context.json"),
            ))),
            Arc::new(Mutex::new(PromptStore::new(
                root.path().join("bundled-prompts.json"),
                root.path().join("prompts.json"),
            ))),
        );
        let (sender, mut receiver) = broadcast::channel(4);
        runtime.sessions.lock().await.insert(
            "pane".into(),
            Arc::new(Mutex::new(ChatSession {
                pane_id: "pane".into(),
                agent_kind: "codex".into(),
                model: None,
                reasoning_level: None,
                session_id: Some("live-session".into()),
                clients: HashMap::from([(1, sender)]),
                current_handle: None,
                turn_active: true,
                cwd: root.path().into(),
                reference_paths: Vec::new(),
                message_buffer: ChatMessageBuffer::default(),
                disconnected_at: None,
                cancelled: false,
                goal: None,
                agent_events: Vec::new(),
                context_hash: None,
            })),
        );
        let queue = vec![json!({"id":"q", "text":"edited", "displayText":"edited"})];
        persistence.save_queue("pane", &queue).await.unwrap();
        runtime.broadcast_queue("pane", &queue).await;
        let event = receiver.recv().await.unwrap();
        assert_eq!(
            event,
            json!({"type":"chat:queue", "paneId":"pane", "queue":queue})
        );
        let events = persistence.read_events("pane", 0, 10).await.unwrap();
        assert_eq!(events.last().unwrap().event_type, "queue_persisted");
        assert_eq!(events.last().unwrap().payload["source"], "api");

        persistence.delete_queue("pane").await.unwrap();
        runtime.broadcast_queue("pane", &[]).await;
        let event = receiver.recv().await.unwrap();
        assert_eq!(
            event,
            json!({"type":"chat:queue", "paneId":"pane", "queue":[]})
        );
        assert!(persistence.read_queue("pane").await.unwrap().is_empty());
        let events = persistence.read_events("pane", 0, 10).await.unwrap();
        assert_eq!(events.last().unwrap().payload["source"], "api");
        assert_eq!(events.last().unwrap().payload["count"], 0);
    }

    #[test]
    fn goal_commands_match_the_typescript_contract() {
        assert!(matches!(
            parse_goal_command(" /goal pause "),
            Some(GoalCommand::Pause)
        ));
        assert!(
            matches!(parse_goal_command("/GOAL build it"),Some(GoalCommand::Start(value)) if value=="build it")
        );
        assert!(parse_goal_command("/goalkeeper").is_none());
    }
    #[test]
    fn stopped_message_is_literal_and_goal_markers_win() {
        assert_eq!(GENERATION_STOPPED_MESSAGE, "Generation stopped");
        assert!(matches!(
            goal_result_status("ok [[GOAL_COMPLETE]]"),
            GoalResult::Complete
        ));
    }

    #[test]
    fn bounds_nested_chat_event_content_like_the_previous_server() {
        let oversized = "x".repeat(300_000);
        let bounded = bound_chat_event(json!({
            "type": "assistant",
            "message": {
                "content": [
                    { "type": "text", "text": oversized },
                    { "type": "tool_use", "input": { "value": "y".repeat(300_000) } }
                ]
            }
        }));
        let content = bounded["message"]["content"].as_array().unwrap();
        assert!(content[0]["text"].as_str().unwrap().encode_utf16().count() <= 256_000);
        assert!(content[1]["input"].is_string());
        assert!(content[1]["input"].as_str().unwrap().encode_utf16().count() <= 256_000);
    }
}
