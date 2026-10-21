use super::*;
use crate::project_runtime::ExecutionInputs;
use crate::project_store::{Result, resolve_path};
use inferay_core::{
    project_files::ProjectFileCommand, projects::ProjectExecution,
    workspace_action::AgentWorkspaceAction,
};
use std::path::Path;
use tokio::io::AsyncWriteExt;

pub(super) struct AutomationRun {
    pub id: String,
    pub tools: Arc<crate::project_tools::ToolScope>,
    log: tokio::fs::File,
    log_bytes: usize,
    error: Option<String>,
}

impl ChatRuntime {
    pub(super) async fn record_automation_emission(
        &self,
        session: &Arc<Mutex<ChatSession>>,
        emission: &ProtocolEmission,
    ) {
        let mut state = session.lock().await;
        let Some(run) = &mut state.automation else {
            return;
        };
        let data = match emission {
            ProtocolEmission::Chat(value) => value.clone(),
            ProtocolEmission::System(text) => json!({"system":text}),
            ProtocolEmission::Session(id) => json!({"providerSessionId":id}),
            _ => return,
        };
        let usage = if data["type"] == "inferay.usage" {
            Some(data.clone())
        } else if data["type"] == "result" && data["usage"].is_object() {
            Some(
                json!({"provider":"claude","usage":data["usage"],"modelUsage":data["modelUsage"],"reportedCostUsd":data["total_cost_usd"]}),
            )
        } else {
            None
        };
        if let Some(usage) = usage {
            let result = self.projects.store().and_then(|store| {
                crate::project_store::event(&store.db, &run.id, "provider_usage", &usage)
                    .map_err(|error| error.to_string())
            });
            if let Err(error) = result {
                run.error = Some(error.to_string());
            }
        }
        let line = format!("{data}\n");
        if run.log_bytes + line.len() <= 1_048_576 {
            if let Err(error) = run.log.write_all(line.as_bytes()).await {
                run.error = Some(error.to_string());
            }
            run.log_bytes += line.len();
        }
    }

    /// A trigger submits one task to an ordinary, durable chat. The run tracks
    /// that task; subsequent user turns continue in the same provider session.
    pub(crate) async fn run_automation(
        &self,
        id: &str,
        project: &str,
        root: &Path,
        dir: &Path,
        snapshot: &Value,
        inputs: Arc<ExecutionInputs>,
    ) -> Result<Value> {
        let ProjectExecution::Agent {
            instructions,
            provider,
            model,
            reasoning_level,
            working_directory,
            timeout_seconds,
            ..
        } = &inputs.execution
        else {
            return Err("Expected an agent execution".into());
        };
        let cwd = resolve_path(root, working_directory)?;
        if !cwd.is_dir() {
            return Err(format!("Automation working directory does not exist: {}. Update the project's repository binding.", cwd.display()).into());
        }
        let reference_paths: Vec<PathBuf> = snapshot["repositoryPaths"]
            .as_object()
            .into_iter()
            .flat_map(|paths| paths.values())
            .filter_map(Value::as_str)
            .map(PathBuf::from)
            .collect();
        let pane_id = {
            let store = self
                .workspaces
                .lock()
                .map_err(|_| "Workspace lock failed")?;
            let previous = store
                .read()?
                .and_then(|state| state.selected_pane_id().map(str::to_owned));
            let workspace = store.apply_workspace_action(
                &AgentWorkspaceAction::AddPane {
                    group_id: None,
                    agent_kind: Some(if provider == "codex" {
                        inferay_core::provider_config::WorkspaceAgentKind::Codex
                    } else {
                        inferay_core::provider_config::WorkspaceAgentKind::Claude
                    }),
                    cwd: Some(cwd.to_string_lossy().into_owned()),
                    reference_paths: Some(paths_to_strings(&reference_paths)),
                },
                provider,
            )?;
            let pane = workspace
                .selected_pane_id()
                .ok_or("No automation chat created")?
                .to_owned();
            store.set_pane_summary(&pane, Some(inputs.automation.name.clone()))?;
            std::fs::write(
                dir.join("inputs/chat-pane.json"),
                serde_json::to_vec(&store.pane(&pane)?.ok_or("Automation chat disappeared")?)?,
            )?;
            // A scheduled task must not steal focus from the user's current chat.
            if let Some(previous) = previous
                && store.pane(&previous)?.is_some()
            {
                store.apply_workspace_action(
                    &AgentWorkspaceAction::SelectPane { pane_id: previous },
                    provider,
                )?;
            }
            pane
        };
        let configuration = inferay_core::provider_config::resolve(&json!({
            "agentKind":provider,"model":model,"reasoningLevel":reasoning_level,
        }));
        self.client_storage
            .lock()
            .await
            .update(std::collections::BTreeMap::from([
                (
                    format!("inferay-chat-model-{pane_id}"),
                    Some(json!(configuration.model)),
                ),
                (
                    format!("inferay-chat-reasoning-{pane_id}"),
                    Some(json!(configuration.reasoning_level)),
                ),
            ]))
            .await?;
        self.projects
            .command(
                ProjectFileCommand::AssociateConversation {
                    project_id: project.into(),
                    pane_id: pane_id.clone(),
                },
                true,
            )
            .await?;
        self.projects.attach_run_chat(id, &pane_id)?;
        let context = format!(
            "Automation: {}\n\nCaptured resource context:\n{}\n\nCaptured skill instructions:\n{}\n\nRun output directory: {}\nGranted library tools: {}. Use inferay_tools for these library calls. This is a regular local chat; use its normal tools to perform the task. Report the outcome and actual verification truthfully.",
            inputs.automation.name,
            snapshot["resources"],
            snapshot["skills"],
            dir.join("output").display(),
            snapshot["tools"]
        );
        let input = SendMessageInput {
            pane_id: pane_id.clone(),
            agent_kind: provider.clone(),
            cwd,
            cwd_provided: true,
            model: model.clone(),
            reasoning_level: reasoning_level.clone(),
            reasoning_level_provided: true,
            reference_paths,
            reference_paths_provided: true,
            text: instructions.clone(),
            include_workspace: true,
            ..Default::default()
        };
        let session = self.ensure_session(&input).await;
        // Capture the same global/project instructions and skill library as a
        // newly typed chat, then add this run's selected context.
        self.create_agent_context_prefix(&session, instructions)
            .await;
        let context = {
            let state = session.lock().await;
            format!(
                "{}\n\n{context}",
                state.session_instructions.as_deref().unwrap_or_default()
            )
        };
        self.persistence
            .save_agent_context(&pane_id, context.clone())
            .await?;
        session.lock().await.session_instructions = Some(context);
        let tools = crate::project_tools::ToolScope::new(
            self.projects.clone(),
            id,
            root.to_owned(),
            dir.to_owned(),
            snapshot.clone(),
            inputs.clone(),
        );
        let _lease = crate::project_tools::ToolLease(tools.clone());
        session.lock().await.automation = Some(AutomationRun {
            id: id.into(),
            tools: tools.clone(),
            log: tokio::fs::File::create(dir.join("logs/agent.jsonl")).await?,
            log_bytes: 0,
            error: None,
        });
        let task = self.send_message(input);
        tokio::pin!(task);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(*timeout_seconds);
        let mut stopped = None;
        loop {
            tokio::select! {
                _ = &mut task => break,
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    if stopped.is_some() {
                        let mut state = session.lock().await;
                        state.cancelled = true;
                        if let Some(handle) = &state.current_handle { handle.kill(); }
                    } else if self.projects.stopped(id) || tokio::time::Instant::now() >= deadline {
                        stopped = Some(if self.projects.stopped(id) { "Cancelled by user" } else { "Automation timed out" });
                        self.stop_generation(&pane_id).await;
                    }
                }
            }
        }
        tools.close().await;
        let mut state = session.lock().await;
        let run = state.automation.take();
        if let Some(error) = run.and_then(|run| run.error) {
            return Err(error.into());
        }
        if let Some(error) = stopped {
            return Err(error.into());
        }
        if state.cancelled {
            drop(state);
            self.projects
                .command(ProjectFileCommand::StopRun { id: id.into() }, true)
                .await?;
            return Err("Chat stopped by user".into());
        }
        if state.turn_failed {
            return Err("Provider failed; open the chat for details".into());
        }
        let response = state
            .message_buffer
            .messages()
            .iter()
            .rev()
            .find(|message| message.role == "assistant" && !message.content.trim().is_empty())
            .map(|message| message.content.clone())
            .ok_or("Provider returned no response; open the chat for details")?;
        drop(state);
        tools.verify_required()?;
        std::fs::write(dir.join("output/response.md"), &response)?;
        let mut artifacts = tools.artifacts()?;
        artifacts.push("response.md".into());
        Ok(
            json!({"chatPaneId":pane_id,"message":response,"artifacts":artifacts,
            "completion":"chat task completed; not an independently verified business outcome"}),
        )
    }
}
