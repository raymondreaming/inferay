//! AFK runner: `afk acp`, the Agent Client Protocol v1 over newline-delimited
//! JSON-RPC on stdio. One process per submitted run, like Codex. AFK owns its
//! model, credentials and MCP configuration; Inferay owns the transcript.

use super::*;
use inferay_core::agent_protocol::AfkProtocolState;

const AFK_SETUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const UPDATE_AFK: &str = "This AFK version does not speak Agent Client Protocol v1. Update agent-afk to a release with `afk acp` protocol version 1.";

struct AfkConnection {
    stdin: tokio::process::ChildStdin,
    stdout: ProviderFrames<tokio::process::ChildStdout>,
    request_id: u64,
}

impl AfkConnection {
    async fn write(&mut self, mut message: Value) -> Result<(), String> {
        message["jsonrpc"] = json!("2.0");
        let mut encoded = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        encoded.push(b'\n');
        tokio::time::timeout(CODEX_RPC_TIMEOUT, async {
            self.stdin.write_all(&encoded).await?;
            self.stdin.flush().await
        })
        .await
        .map_err(|_| "AFK stopped reading requests".to_string())?
        .map_err(|error| error.to_string())
    }

    async fn send(&mut self, method: &str, params: Value) -> Result<u64, String> {
        self.request_id += 1;
        self.write(json!({"id":self.request_id,"method":method,"params":params}))
            .await?;
        Ok(self.request_id)
    }

    async fn read(&mut self) -> Result<Option<Value>, String> {
        match self.stdout.next().await {
            Ok(Some(line)) => serde_json::from_slice(&line)
                .map(Some)
                .map_err(|error| format!("Invalid AFK JSON: {error}")),
            Ok(None) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    /// Setup requests precede any session, so nothing else may arrive except
    /// agent requests, which are declined.
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.send(method, params).await?;
        let deadline = tokio::time::Instant::now() + AFK_SETUP_TIMEOUT;
        loop {
            let message = tokio::time::timeout_at(deadline, self.read())
                .await
                .map_err(|_| format!("AFK {method} response timed out"))??
                .ok_or_else(|| "AFK exited before replying".to_string())?;
            if message.get("method").is_none() && message["id"].as_u64() == Some(id) {
                return rpc_result(message);
            }
            if let (Some(_), Some(rpc_id)) = (message["method"].as_str(), message.get("id")) {
                self.write(
                    json!({"id":rpc_id,"error":{"code":-32601,"message":"Method not found"}}),
                )
                .await?;
            }
        }
    }
}

pub(super) async fn run_afk(
    run: ProviderRun<'_>,
    handle: &AgentProcessHandle,
    tracker: &RuntimePidTracker,
    context: &mut AgentProtocolContext,
    emissions: &ProtocolSender,
) -> String {
    let _ = emissions
        .send(ProtocolEmission::Status {
            status: "Starting AFK…".into(),
            is_loading: true,
        })
        .await;
    let mut cmd = provider_command(run.binary);
    cmd.arg("acp");
    if let Some(model) = run.invocation.model.as_deref() {
        cmd.args(["--model", model]);
    }
    let cwd = if run.invocation.cwd.as_os_str().is_empty() {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"))
    } else {
        run.invocation.cwd.clone()
    };
    let spawn = cmd
        .current_dir(&cwd)
        .env_clear()
        .envs(run.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let mut child = match spawn {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, format!("Could not start AFK: {error}"));
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
    handle.mark("processSpawned");
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut rpc = AfkConnection {
        stdin: child.stdin.take().expect("piped stdin"),
        stdout: ProviderFrames::new(child.stdout.take().expect("piped stdout")),
        request_id: 0,
    };
    let mut state = AfkProtocolState::default();
    let startup = async {
        let init = rpc
            .request(
                "initialize",
                json!({"protocolVersion":1,"clientCapabilities":{},
                    "clientInfo":{"name":"inferay","title":"Inferay","version":env!("CARGO_PKG_VERSION")}}),
            )
            .await
            .map_err(|error| format!("{error}\n{UPDATE_AFK}"))?;
        if init["protocolVersion"].as_u64() != Some(1) {
            return Err(UPDATE_AFK.to_owned());
        }
        handle.mark("initialized");
        let cwd = cwd.to_string_lossy();
        let session_id = if let Some(id) = &run.invocation.session_id {
            let resumed = rpc
                .request(
                    "session/resume",
                    json!({"sessionId":id,"cwd":cwd,"mcpServers":[]}),
                )
                .await
                .map_err(|error| format!("Could not resume AFK session {id}: {error}"))?;
            // Use the returned sessionId (AFK may remap on expiry); fall back to the input id.
            resumed["sessionId"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| id.clone())
        } else {
            let mut new_params = json!({"cwd":cwd,"mcpServers":[]});
            if let Some(instructions) = &run.invocation.developer_instructions {
                new_params["systemPrompt"] = json!(instructions);
            }
            rpc.request("session/new", new_params)
                .await?["sessionId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or("AFK did not return a session id")?
                .to_owned()
        };
        handle.mark("conversationReady");
        context.session_id = Some(session_id.clone());
        context
            .emissions
            .push(ProtocolEmission::Session(session_id.clone()));
        flush_emissions(context, emissions).await;
        let prompt = rpc
            .send(
                "session/prompt",
                json!({"sessionId":session_id,"prompt":[{"type":"text","text":run.prompt}]}),
            )
            .await?;
        handle.mark("turnAccepted");
        Ok::<_, String>((session_id, prompt))
    }
    .await;
    let mut completed = false;
    match startup {
        Err(error) => emit_error(context, error),
        Ok((session_id, prompt)) => {
            let (control_tx, mut control_rx) = mpsc::unbounded_channel();
            handle.set_control(control_tx);
            let mut interrupt_deadline = None;
            loop {
                tokio::select! {
                    _ = async {
                        match interrupt_deadline {
                            Some(deadline) => tokio::time::sleep_until(deadline).await,
                            None => std::future::pending::<()>().await,
                        }
                    } => {
                        emit_error(context, "AFK did not finish stopping; terminated its process.".into());
                        break;
                    }
                    control = control_rx.recv() => match control {
                        Some(ProviderControl::Steer { response, .. }) => {
                            let _ = response.send(Err("AFK turns are not steerable".into()));
                        }
                        Some(ProviderControl::Respond { id, answer, response }) => {
                            let request = handle.requests.lock().expect("provider requests").get(&id).cloned();
                            let result = match request {
                                None => Err("This request was already answered or its turn ended".into()),
                                Some(request) => match provider_request_reply(&request, answer) {
                                    Err(error) => Err(error),
                                    Ok(reply) => rpc.write(reply).await,
                                },
                            };
                            let accepted = result.is_ok();
                            if accepted {
                                handle.requests.lock().expect("provider requests").remove(&id);
                            }
                            let _ = response.send(result);
                            if accepted {
                                let _ = emissions.send(ProtocolEmission::Requests(handle.pending_requests())).await;
                            }
                        }
                        Some(ProviderControl::Interrupt) => {
                            // The protocol requires the client to cancel its open permission requests.
                            if rpc.write(json!({"method":"session/cancel","params":{"sessionId":session_id}})).await.is_err()
                                || cancel_requests(handle, &mut rpc).await.is_err()
                            {
                                break;
                            }
                            let _ = emissions.send(ProtocolEmission::Requests(handle.pending_requests())).await;
                            interrupt_deadline.get_or_insert_with(|| tokio::time::Instant::now() + CODEX_INTERRUPT_TIMEOUT);
                        }
                        None => {}
                    },
                    read = rpc.read() => {
                        let message = match read {
                            Ok(Some(message)) => message,
                            Ok(None) => {
                                if !handle.is_cancelled() {
                                    emit_error(context, "AFK exited before finishing the turn.".into());
                                }
                                break;
                            }
                            Err(error) => {
                                emit_error(context, error);
                                break;
                            }
                        };
                        let params = &message["params"];
                        match (message["method"].as_str(), message.get("id")) {
                            (Some("session/update"), None) if params["sessionId"] == session_id.as_str() => {
                                handle.mark("firstDelta");
                                state.handle_update(context, &params["update"]);
                                flush_emissions(context, emissions).await;
                                if params["update"]["sessionUpdate"] == "tool_call_update"
                                    && matches!(params["update"]["status"].as_str(), Some("completed" | "failed"))
                                {
                                    // AFK resolved this approval itself (timeout or denial); drop its stale card.
                                    let tool = &params["update"]["toolCallId"];
                                    let changed = {
                                        let mut requests = handle.requests.lock().expect("provider requests");
                                        let before = requests.len();
                                        requests.retain(|_, request| &request.params["toolCall"]["toolCallId"] != tool);
                                        requests.len() != before
                                    };
                                    if changed {
                                        let _ = emissions.send(ProtocolEmission::Requests(handle.pending_requests())).await;
                                    }
                                }
                            }
                            (Some("session/request_permission"), Some(rpc_id)) if params["sessionId"] == session_id.as_str() => {
                                let mut params = params.clone();
                                params["message"] = params["toolCall"]["title"]
                                    .as_str()
                                    .or_else(|| params["toolCall"]["name"].as_str())
                                    .map(|s| json!(s))
                                    .unwrap_or(json!("Permission requested"));
                                handle.requests.lock().expect("provider requests").insert(
                                    uuid::Uuid::new_v4().to_string(),
                                    PendingProviderRequest { rpc_id: rpc_id.clone(), method: "session/request_permission".into(), params },
                                );
                                let _ = emissions.send(ProtocolEmission::Requests(handle.pending_requests())).await;
                            }
                            (Some(_), Some(rpc_id)) => {
                                if rpc.write(json!({"id":rpc_id,"error":{"code":-32601,"message":"Method not found"}})).await.is_err() {
                                    break;
                                }
                            }
                            (None, Some(id)) if id.as_u64() == Some(prompt) => {
                                state.finalize_open_block(context);
                                match rpc_result(message) {
                                    Ok(result) => {
                                        completed = true;
                                        match result["stopReason"].as_str() {
                                            Some("end_turn" | "cancelled") => {}
                                            Some("max_tokens") => emit_error(context, "AFK stopped: the model reached its token limit.".into()),
                                            Some("max_turn_requests") => emit_error(context, "AFK stopped: the turn reached its request limit.".into()),
                                            Some("refusal") => emit_error(context, "AFK's model refused to continue.".into()),
                                            other => emit_error(context, format!("AFK stopped: {}", other.unwrap_or("unknown reason"))),
                                        }
                                    }
                                    Err(error) => emit_error(context, format!("AFK turn failed: {error}")),
                                }
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }
            let _ = cancel_requests(handle, &mut rpc).await;
        }
    }
    handle.clear_control();
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
    state.finalize_open_block(context);
    if !completed
        && !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
    flush_emissions(context, emissions).await;
    if completed {
        state.last_assistant_message().to_owned()
    } else {
        String::new()
    }
}

/// Unanswered permission requests are answered as cancelled, never approved.
async fn cancel_requests(
    handle: &AgentProcessHandle,
    rpc: &mut AfkConnection,
) -> Result<(), String> {
    let pending: Vec<_> = handle
        .requests
        .lock()
        .expect("provider requests")
        .drain()
        .map(|(_, request)| request)
        .collect();
    for request in pending {
        rpc.write(json!({"id":request.rpc_id,"result":{"outcome":{"outcome":"cancelled"}}}))
            .await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "agent_runner_afk_tests.rs"]
mod tests;
