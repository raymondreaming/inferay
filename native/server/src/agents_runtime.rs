//! Inferay subagent control plane: mode, registry, and hidden worker spawns.
//! Parent providers call tools; this module owns lifecycle and caps.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use inferay_core::agent_kind::AgentKind;
use inferay_core::agent_protocol::{
    AgentProtocolContext, CodexInvocationContext, CodexProtocolState, ProtocolEmission,
};
use inferay_core::agents::{
    MAX_CONCURRENT_WORKERS, SubagentProfile, SubagentStatus, explore_model,
};
use serde_json::{Value, json};
use tokio::sync::{Mutex, broadcast, oneshot};
use uuid::Uuid;

use crate::agent_command::AgentCommandResolver;
use crate::agent_runner::{self, AgentProcessHandle, RuntimePidTracker};
use crate::prompt_store::PromptStore;

#[derive(Clone)]
pub struct AgentsRuntime {
    inner: Arc<Mutex<HashMap<String, PaneAgents>>>,
    resolver: Arc<AgentCommandResolver>,
    prompts: Arc<Mutex<PromptStore>>,
    pid_tracker: RuntimePidTracker,
    events: broadcast::Sender<AgentsEvent>,
    pub api_base: Arc<std::sync::Mutex<Option<String>>>,
    pub auth_token: Arc<std::sync::Mutex<Option<String>>>,
    pub mcp_command: Arc<std::sync::Mutex<Option<PathBuf>>>,
}

#[derive(Clone, Debug)]
pub struct AgentsEvent {
    pub pane_id: String,
    pub card: Option<Value>,
    pub status: Value,
}

#[derive(Default)]
struct PaneAgents {
    enabled: bool,
    workers: HashMap<String, WorkerRecord>,
}

struct WorkerRecord {
    id: String,
    profile: SubagentProfile,
    title: String,
    status: SubagentStatus,
    background: bool,
    started_at: u64,
    summary: Option<String>,
    detail: Option<String>,
    handle: Option<AgentProcessHandle>,
}

impl AgentsRuntime {
    pub fn new(
        resolver: Arc<AgentCommandResolver>,
        prompts: Arc<Mutex<PromptStore>>,
        pid_tracker: RuntimePidTracker,
    ) -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            resolver,
            prompts,
            pid_tracker,
            events,
            api_base: Arc::new(std::sync::Mutex::new(None)),
            auth_token: Arc::new(std::sync::Mutex::new(None)),
            mcp_command: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentsEvent> {
        self.events.subscribe()
    }

    pub fn configure_bridge(&self, api_base: String, auth_token: String, mcp_command: PathBuf) {
        *self.api_base.lock().expect("agents api_base") = Some(api_base);
        *self.auth_token.lock().expect("agents auth") = Some(auth_token);
        *self.mcp_command.lock().expect("agents mcp") = Some(mcp_command);
    }

    pub async fn is_enabled(&self, pane_id: &str) -> bool {
        self.inner
            .lock()
            .await
            .get(pane_id)
            .is_some_and(|pane| pane.enabled)
    }

    async fn publish(&self, pane_id: &str, card: Option<Value>) {
        let status = self.snapshot_event(pane_id).await;
        let _ = self.events.send(AgentsEvent {
            pane_id: pane_id.to_owned(),
            card,
            status,
        });
    }

    pub async fn set_enabled(&self, pane_id: &str, enabled: bool) -> Value {
        if !enabled {
            let _ = self.cancel_all_running(pane_id).await;
            let mut panes = self.inner.lock().await;
            let pane = panes.entry(pane_id.to_owned()).or_default();
            pane.enabled = false;
            let card = json!({
                "type": "inferay.subagent",
                "status": "off",
                "detail": "Subagents disabled for this chat. Running workers were cancelled."
            });
            drop(panes);
            self.publish(pane_id, Some(card.clone())).await;
            return card;
        }
        {
            let mut panes = self.inner.lock().await;
            panes.entry(pane_id.to_owned()).or_default().enabled = true;
        }
        let card = json!({
            "type": "inferay.subagent",
            "status": "on",
            "detail": "Subagents enabled. The parent agent can use run_subagent, read_subagent, and list_subagents."
        });
        self.publish(pane_id, Some(card.clone())).await;
        card
    }

    pub async fn status_card(&self, pane_id: &str) -> Value {
        let panes = self.inner.lock().await;
        let Some(pane) = panes.get(pane_id) else {
            return json!({
                "type": "inferay.subagent",
                "status": "status",
                "detail": "Subagents are off.",
                "active": 0
            });
        };
        let active = pane
            .workers
            .values()
            .filter(|worker| worker.status == SubagentStatus::Running)
            .count();
        let detail = if pane.enabled {
            format!(
                "Subagents on. {} worker(s) tracked, {active} running.",
                pane.workers.len()
            )
        } else {
            "Subagents are off.".into()
        };
        json!({
            "type": "inferay.subagent",
            "status": "status",
            "detail": detail,
            "active": active
        })
    }

    pub async fn snapshot_event(&self, pane_id: &str) -> Value {
        let workers = self.list(pane_id, None).await;
        let enabled = self.is_enabled(pane_id).await;
        let active = workers
            .iter()
            .filter(|worker| worker["status"] == "running")
            .count();
        json!({
            "type": "agents:status",
            "paneId": pane_id,
            "enabled": enabled,
            "active": active,
            "workers": workers
        })
    }

    pub async fn cancel_all_running(&self, pane_id: &str) -> Value {
        let running: Vec<String> = {
            let panes = self.inner.lock().await;
            panes
                .get(pane_id)
                .map(|pane| {
                    pane.workers
                        .values()
                        .filter(|worker| worker.status == SubagentStatus::Running)
                        .map(|worker| worker.id.clone())
                        .collect()
                })
                .unwrap_or_default()
        };
        for id in &running {
            let _ = self.cancel_one(pane_id, id).await;
        }
        let card = json!({
            "type": "inferay.subagent",
            "status": "cancelled",
            "detail": format!("Cancelled {} worker(s).", running.len()),
            "active": 0
        });
        self.publish(pane_id, Some(card.clone())).await;
        card
    }

    pub async fn cancel_one(&self, pane_id: &str, worker_id: &str) -> Result<Value, String> {
        let handle = {
            let mut panes = self.inner.lock().await;
            let pane = panes
                .get_mut(pane_id)
                .ok_or_else(|| "No subagents for this chat".to_string())?;
            let worker = pane
                .workers
                .get_mut(worker_id)
                .ok_or_else(|| format!("Unknown subagent id: {worker_id}"))?;
            if worker.status != SubagentStatus::Running {
                return Ok(json!({
                    "type": "inferay.subagent",
                    "status": worker.status.as_str(),
                    "id": worker.id,
                    "profile": worker.profile.as_str(),
                    "detail": format!("Subagent already {}", worker.status.as_str())
                }));
            }
            worker.status = SubagentStatus::Cancelled;
            worker.detail = Some("Cancelled".into());
            worker.handle.take()
        };
        if let Some(handle) = handle {
            handle.kill();
        }
        let card = json!({
            "type": "inferay.subagent",
            "status": "cancelled",
            "id": worker_id,
            "detail": "Subagent cancelled"
        });
        self.publish(pane_id, Some(card.clone())).await;
        Ok(card)
    }

    pub async fn list(&self, pane_id: &str, status: Option<&str>) -> Vec<Value> {
        let panes = self.inner.lock().await;
        let Some(pane) = panes.get(pane_id) else {
            return Vec::new();
        };
        pane.workers
            .values()
            .filter(|worker| status.is_none_or(|wanted| worker.status.as_str() == wanted))
            .map(worker_json)
            .collect()
    }

    pub async fn read(&self, pane_id: &str, worker_id: &str) -> Result<Value, String> {
        let panes = self.inner.lock().await;
        let worker = panes
            .get(pane_id)
            .and_then(|pane| pane.workers.get(worker_id))
            .ok_or_else(|| format!("Unknown subagent id: {worker_id}"))?;
        Ok(worker_json(worker))
    }

    pub async fn call_tool(
        &self,
        pane_id: &str,
        tool: &str,
        args: &Value,
        parent: ParentWorkerContext,
    ) -> Result<(Value, Option<Value>), String> {
        if !self.is_enabled(pane_id).await {
            return Err("Subagents are off. Send /agents on first.".into());
        }
        match tool {
            "run_subagent" => self.run_subagent(pane_id, args, parent).await,
            "read_subagent" => {
                let id = args
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or("id is required")?;
                Ok((self.read(pane_id, id).await?, None))
            }
            "list_subagents" => {
                let status = args.get("status").and_then(Value::as_str);
                Ok((json!({ "workers": self.list(pane_id, status).await }), None))
            }
            _ => Err(format!("Unknown Inferay agents tool: {tool}")),
        }
    }

    async fn run_subagent(
        &self,
        pane_id: &str,
        args: &Value,
        parent: ParentWorkerContext,
    ) -> Result<(Value, Option<Value>), String> {
        let profile = args
            .get("profile")
            .and_then(Value::as_str)
            .and_then(SubagentProfile::parse)
            .ok_or("profile must be explore or general")?;
        let prompt = args
            .get("prompt")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or("prompt is required")?
            .to_owned();
        let title = args
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Subagent")
            .to_owned();
        let background = args
            .get("background")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        {
            let panes = self.inner.lock().await;
            let running = panes
                .get(pane_id)
                .map(|pane| {
                    pane.workers
                        .values()
                        .filter(|worker| worker.status == SubagentStatus::Running)
                        .count()
                })
                .unwrap_or(0);
            if running >= MAX_CONCURRENT_WORKERS {
                return Err(format!(
                    "At most {MAX_CONCURRENT_WORKERS} concurrent subagents per chat"
                ));
            }
        }

        let id = Uuid::new_v4().to_string();
        let started_at = now_millis();
        let handle = AgentProcessHandle::with_skills(self.prompts.clone());
        {
            let mut panes = self.inner.lock().await;
            let pane = panes.entry(pane_id.to_owned()).or_default();
            pane.workers.insert(
                id.clone(),
                WorkerRecord {
                    id: id.clone(),
                    profile,
                    title: title.clone(),
                    status: SubagentStatus::Running,
                    background,
                    started_at,
                    summary: None,
                    detail: None,
                    handle: Some(handle.clone()),
                },
            );
        }

        let start_card = json!({
            "type": "inferay.subagent",
            "status": "running",
            "id": id,
            "profile": profile.as_str(),
            "detail": format!("{title} ({})", profile.as_str())
        });
        self.publish(pane_id, Some(start_card.clone())).await;

        let runtime = self.clone();
        let parent_pane = pane_id.to_owned();
        let worker_id = id.clone();
        let (finish_tx, finish_rx) = oneshot::channel::<Result<String, String>>();

        tokio::spawn(async move {
            let result = runtime
                .drive_worker(&worker_id, profile, &prompt, parent, handle)
                .await;
            let _ = finish_tx.send(result);
        });

        if background {
            let runtime = self.clone();
            let parent_pane = pane_id.to_owned();
            let worker_id = id.clone();
            tokio::spawn(async move {
                let outcome =
                    finish_rx
                        .await
                        .unwrap_or_else(|_| Err("Worker task dropped".into()));
                runtime.finish_worker(&parent_pane, &worker_id, outcome).await;
            });
            return Ok((
                json!({
                    "id": id,
                    "status": "running",
                    "profile": profile.as_str(),
                    "title": title,
                    "background": true,
                    "message": "Subagent started in background. Use read_subagent when you need the result."
                }),
                Some(start_card),
            ));
        }

        let outcome = finish_rx
            .await
            .unwrap_or_else(|_| Err("Worker task dropped".into()));
        let card = self
            .finish_worker(pane_id, &id, outcome.clone())
            .await;
        match outcome {
            Ok(summary) => Ok((
                json!({
                    "id": id,
                    "status": "completed",
                    "profile": profile.as_str(),
                    "title": title,
                    "summary": summary
                }),
                card.or(Some(start_card)),
            )),
            Err(error) => Ok((
                json!({
                    "id": id,
                    "status": "failed",
                    "profile": profile.as_str(),
                    "title": title,
                    "error": error
                }),
                card,
            )),
        }
    }

    async fn finish_worker(
        &self,
        pane_id: &str,
        worker_id: &str,
        outcome: Result<String, String>,
    ) -> Option<Value> {
        let card = {
            let mut panes = self.inner.lock().await;
            let Some(worker) = panes
                .get_mut(pane_id)
                .and_then(|pane| pane.workers.get_mut(worker_id))
            else {
                return None;
            };
            if worker.status == SubagentStatus::Cancelled {
                worker.handle = None;
                let card = json!({
                    "type": "inferay.subagent",
                    "status": "cancelled",
                    "id": worker_id,
                    "profile": worker.profile.as_str(),
                    "detail": worker.title.clone()
                });
                drop(panes);
                self.publish(pane_id, Some(card.clone())).await;
                return Some(card);
            }
            worker.handle = None;
            match outcome {
                Ok(summary) => {
                    worker.status = SubagentStatus::Completed;
                    worker.summary = Some(summary.clone());
                    worker.detail = Some(truncate(&summary, 240));
                    json!({
                        "type": "inferay.subagent",
                        "status": "completed",
                        "id": worker_id,
                        "profile": worker.profile.as_str(),
                        "detail": truncate(&summary, 240)
                    })
                }
                Err(error) => {
                    worker.status = SubagentStatus::Failed;
                    worker.detail = Some(error.clone());
                    json!({
                        "type": "inferay.subagent",
                        "status": "failed",
                        "id": worker_id,
                        "profile": worker.profile.as_str(),
                        "detail": error
                    })
                }
            }
        };
        self.publish(pane_id, Some(card.clone())).await;
        Some(card)
    }

    async fn drive_worker(
        &self,
        worker_id: &str,
        profile: SubagentProfile,
        prompt: &str,
        parent: ParentWorkerContext,
        handle: AgentProcessHandle,
    ) -> Result<String, String> {
        let agent_kind = parent.agent_kind.clone();
        let model = match profile {
            SubagentProfile::Explore => explore_model(&agent_kind, parent.model.as_deref()),
            SubagentProfile::General => parent.model.clone(),
        };
        let instructions = profile.worker_instructions();
        let full_prompt = format!("{instructions}\n\n# Task\n{prompt}");
        let kind = if agent_kind == "codex" {
            AgentKind::Codex
        } else {
            AgentKind::Claude
        };
        let binary = self.resolver.resolve_agent_binary(kind);
        let environment = self.resolver.create_agent_env(kind);
        let invocation = CodexInvocationContext {
            cwd: parent.cwd.clone(),
            reference_paths: parent.reference_paths.clone(),
            images: Vec::new(),
            model,
            reasoning_level: parent.reasoning_level.clone(),
            developer_instructions: Some(instructions.into()),
            session_id: None,
            mcp_servers: Some(Vec::new()),
        };

        let summary = agent_runner::drive_protocol(
            |emission_tx| async move {
                let mut protocol = AgentProtocolContext::new(invocation.cwd.clone());
                protocol.reference_paths = invocation.reference_paths.clone();
                if agent_kind == "codex" {
                    agent_runner::run_codex(
                        agent_runner::CodexRun {
                            binary: &binary,
                            prompt: &full_prompt,
                            invocation: &invocation,
                            env: &environment,
                            agents_tools: false,
                            agents_bridge: None,
                        },
                        &handle,
                        &self.pid_tracker,
                        &mut protocol,
                        &mut CodexProtocolState::default(),
                        &emission_tx,
                    )
                    .await
                } else {
                    agent_runner::run_claude(
                        agent_runner::ClaudeRun {
                            binary: &binary,
                            prompt: &full_prompt,
                            developer_instructions: invocation.developer_instructions.as_deref(),
                            cwd: &invocation.cwd,
                            model: invocation.model.as_deref(),
                            session_id: None,
                            env: &environment,
                            mcp_servers: Some(&[]),
                            agents_mcp: None,
                        },
                        &handle,
                        &mut protocol,
                        &emission_tx,
                    )
                    .await
                }
            },
            |_emission: ProtocolEmission| async {},
        )
        .await;

        if handle.is_cancelled() {
            return Err("Subagent cancelled".into());
        }
        let summary = summary.trim().to_owned();
        if summary.is_empty() {
            let panes = self.inner.lock().await;
            if panes
                .values()
                .any(|pane| {
                    pane.workers
                        .get(worker_id)
                        .is_some_and(|worker| worker.status == SubagentStatus::Cancelled)
                })
            {
                return Err("Subagent cancelled".into());
            }
            return Err("Subagent finished without a summary".into());
        }
        Ok(summary)
    }

    pub async fn claude_mcp_server_entry(&self, pane_id: &str) -> Option<Value> {
        if !self.is_enabled(pane_id).await {
            return None;
        }
        let command = self.mcp_command.lock().expect("agents mcp").clone()?;
        let api_base = self.api_base.lock().expect("agents api_base").clone()?;
        let token = self
            .auth_token
            .lock()
            .expect("agents auth")
            .clone()
            .unwrap_or_default();
        Some(json!({
            "command": command,
            "args": [],
            "env": {
                "INFERAY_AGENTS_URL": api_base,
                "INFERAY_AGENTS_PANE": pane_id,
                "INFERAY_AGENTS_TOKEN": token
            }
        }))
    }
}

#[derive(Clone)]
pub struct ParentWorkerContext {
    pub agent_kind: String,
    pub model: Option<String>,
    pub reasoning_level: Option<String>,
    pub cwd: PathBuf,
    pub reference_paths: Vec<PathBuf>,
}

/// Bridge used by Codex dynamic tool calls on the parent turn.
#[derive(Clone)]
pub struct AgentsToolBridge {
    pub runtime: AgentsRuntime,
    pub pane_id: String,
    pub parent: ParentWorkerContext,
}

impl AgentsToolBridge {
    pub async fn call_tool(
        &self,
        tool: &str,
        args: &Value,
    ) -> Result<(Value, Option<Value>), String> {
        self.runtime
            .call_tool(&self.pane_id, tool, args, self.parent.clone())
            .await
    }
}

fn worker_json(worker: &WorkerRecord) -> Value {
    json!({
        "id": worker.id,
        "profile": worker.profile.as_str(),
        "title": worker.title,
        "status": worker.status.as_str(),
        "background": worker.background,
        "startedAt": worker.started_at,
        "summary": worker.summary,
        "detail": worker.detail
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_owned()
    } else {
        format!(
            "{}…",
            value.chars().take(max.saturating_sub(1)).collect::<String>()
        )
    }
}

pub fn parse_agents_command(text: &str) -> Option<AgentsCommand> {
    let trimmed = text.trim();
    if trimmed.len() < 7
        || !trimmed[..7].eq_ignore_ascii_case("/agents")
        || trimmed
            .as_bytes()
            .get(7)
            .is_some_and(|byte| !byte.is_ascii_whitespace())
    {
        return None;
    }
    let args = trimmed[7..].trim();
    let mut parts = args.split_whitespace();
    let head = parts.next().unwrap_or("status").to_ascii_lowercase();
    match head.as_str() {
        "on" | "enable" => Some(AgentsCommand::On),
        "off" | "disable" => Some(AgentsCommand::Off),
        "status" | "" => Some(AgentsCommand::Status),
        "cancel" => {
            let target = parts.next().unwrap_or("all");
            Some(AgentsCommand::Cancel(target.to_owned()))
        }
        _ => Some(AgentsCommand::Status),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentsCommand {
    On,
    Off,
    Status,
    Cancel(String),
}

pub fn resolve_mcp_command(app_root: &Path) -> PathBuf {
    if let Ok(path) = std::env::var("INFERAY_AGENTS_MCP") {
        return PathBuf::from(path);
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let sibling = dir.join(if cfg!(windows) {
            "inferay-agents-mcp.exe"
        } else {
            "inferay-agents-mcp"
        });
        if sibling.exists() {
            return sibling;
        }
    }
    let debug = app_root.join("native/target/debug").join(if cfg!(windows) {
        "inferay-agents-mcp.exe"
    } else {
        "inferay-agents-mcp"
    });
    if debug.exists() {
        return debug;
    }
    app_root
        .join("native/target/release")
        .join(if cfg!(windows) {
            "inferay-agents-mcp.exe"
        } else {
            "inferay-agents-mcp"
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn parses_agents_slash_commands() {
        assert_eq!(parse_agents_command("/agents on"), Some(AgentsCommand::On));
        assert_eq!(
            parse_agents_command("/agents off"),
            Some(AgentsCommand::Off)
        );
        assert_eq!(
            parse_agents_command("/agents status"),
            Some(AgentsCommand::Status)
        );
        assert_eq!(
            parse_agents_command("/agents cancel all"),
            Some(AgentsCommand::Cancel("all".into()))
        );
        assert_eq!(
            parse_agents_command("/agents cancel abc"),
            Some(AgentsCommand::Cancel("abc".into()))
        );
        assert!(parse_agents_command("/agent on").is_none());
        assert!(parse_agents_command("/agentship").is_none());
    }

    #[test]
    fn explore_model_picks_fast_defaults() {
        assert_eq!(
            explore_model("claude", Some("claude-opus-5-5")).as_deref(),
            Some("claude-haiku-4-5")
        );
        assert_eq!(
            explore_model("codex", Some("gpt-6-astra")).as_deref(),
            Some("gpt-6-luna")
        );
    }

    fn test_runtime(root: &Path) -> AgentsRuntime {
        AgentsRuntime::new(
            Arc::new(AgentCommandResolver::new(
                root.to_path_buf(),
                root.join("mcp-preferences.json"),
            )),
            Arc::new(Mutex::new(PromptStore::new(
                root.join("bundled.json"),
                root.join("local.json"),
            ))),
            RuntimePidTracker::new(root.join("pids.json")),
        )
    }

    #[tokio::test]
    async fn enable_disable_and_cancel_all_are_idempotent() {
        let root = std::env::temp_dir().join(format!("inferay-agents-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let agents = test_runtime(&root);
        let pane = "pane-a";
        assert!(!agents.is_enabled(pane).await);
        assert_eq!(agents.set_enabled(pane, true).await["status"], "on");
        assert!(agents.is_enabled(pane).await);
        assert_eq!(
            agents.cancel_all_running(pane).await["status"],
            "cancelled"
        );
        assert_eq!(agents.set_enabled(pane, false).await["status"], "off");
        assert!(!agents.is_enabled(pane).await);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn tools_reject_when_mode_is_off() {
        let root = std::env::temp_dir().join(format!("inferay-agents-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let agents = test_runtime(&root);
        let error = agents
            .call_tool(
                "pane-b",
                "list_subagents",
                &json!({}),
                ParentWorkerContext {
                    agent_kind: "claude".into(),
                    model: None,
                    reasoning_level: None,
                    cwd: root.clone(),
                    reference_paths: vec![],
                },
            )
            .await
            .unwrap_err();
        assert!(error.contains("/agents on"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn list_and_read_work_after_enable() {
        let root = std::env::temp_dir().join(format!("inferay-agents-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let agents = test_runtime(&root);
        let pane = "pane-c";
        agents.set_enabled(pane, true).await;
        let (listed, _) = agents
            .call_tool(
                pane,
                "list_subagents",
                &json!({}),
                ParentWorkerContext {
                    agent_kind: "codex".into(),
                    model: Some("gpt-6-luna".into()),
                    reasoning_level: None,
                    cwd: root.clone(),
                    reference_paths: vec![],
                },
            )
            .await
            .unwrap();
        assert_eq!(listed["workers"].as_array().unwrap().len(), 0);
        let missing = agents.read(pane, "missing").await.unwrap_err();
        assert!(missing.contains("Unknown subagent"));
        let _ = std::fs::remove_dir_all(root);
    }
}
