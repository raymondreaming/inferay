//! Live chat subscriptions share the browser's epoch/revision admission model.
use super::*;
use crate::backend::{Backend, RUNTIME};
use futures_util::{SinkExt, StreamExt};
use inferay_core::chat_protocol::ChatMessageBuffer;
use inferay_presentation::transcript::{ChatReplica, TranscriptAdmission};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

pub(super) struct Command {
    pub message: Value,
    pub completed: tokio::sync::oneshot::Sender<Result<(), String>>,
}

struct Update {
    changed: Option<(usize, Vec<ChatTranscriptMessage>)>,
    notice: Option<String>,
    commands: Option<tokio::sync::mpsc::Sender<Command>>,
    running: bool,
    start_time: Option<f64>,
    refresh_title: bool,
    queue: Option<Vec<Value>>,
}

impl WorkspaceView {
    pub(super) fn update_queued_message(&mut self, index: usize, id: String, text: Option<String>, cx: &mut Context<Self>) {
        let text = text.map(|text| text.trim().to_owned());
        if text.as_ref().is_some_and(|text| text.is_empty()) { return; }
        let chat = &mut self.conversations[index];
        if chat.queue_task.is_some() || !chat.queue.iter().any(|message|
            message["id"].as_str() == Some(&id) && !message["transient"].as_bool().unwrap_or(false)) {
            return;
        }
        let (Some(backend), Some(pane)) = (self.backend.get().cloned(), chat.pane.clone()) else {
            chat.error = Some("Chat is connecting. Try updating the message again when connected.".into());
            cx.notify();
            return;
        };
        chat.error = None;
        let updated_id = id.clone();
        let updated_text = text.clone();
        let original = chat.queue.iter().find(|message| message["id"].as_str() == Some(&id)).cloned();
        let target_pane = pane.clone();
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
                let encoded = url::form_urlencoded::byte_serialize(pane.as_bytes()).collect::<String>().replace('+', "%20");
                backend.request(reqwest::Method::PATCH, &format!("/api/chat-queues/{encoded}"),
                    Some(json!({"action":if text.is_some() {"edit"} else {"remove"},"id":id,"text":text}))).await
            })
        });
        chat.queue_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| {
                let chat = &mut view.conversations[index];
                if chat.pane.as_ref() != Some(&target_pane) { return; }
                chat.queue_task = None;
                match result {
                    Ok(_) => {
                        // Never replace newer socket state with an older HTTP snapshot.
                        if let Some(text) = &updated_text {
                            if let Some(message) = chat.queue.iter_mut().find(|message| message["id"].as_str() == Some(&updated_id))
                                && Some(&*message) == original.as_ref() {
                                message["text"] = text.clone().into();
                                message["displayText"] = text.clone().into();
                            }
                        } else {
                            chat.queue.retain(|message| message["id"].as_str() != Some(&updated_id));
                        }
                        if chat.queue_editor.as_ref().is_some_and(|(id, input)|
                            id == &updated_id && updated_text.as_deref().is_none_or(|text| input.read(cx).content.trim() == text)) {
                            chat.queue_editor = None;
                            chat.queue_submit = None;
                        }
                    }
                    Err(error) => chat.error = Some(format!("Could not update queued message: {error:#}")),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn attach_images(&mut self, index: usize, paths: Vec<std::path::PathBuf>, cx: &mut Context<Self>) {
        let chat = &mut self.conversations[index];
        for path in paths {
            if !matches!(path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
                chat.error = Some("Choose PNG, JPEG, WebP, or GIF images.".into());
                continue;
            }
            if !chat.images.contains(&path) { chat.images.push(path); }
        }
        cx.notify();
    }
    pub(super) fn pick_chat_images(&mut self, index: usize, cx: &mut Context<Self>) {
        let picked = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: true, prompt: Some("Attach images".into()) });
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(Some(paths))) = picked.await {
                let _ = this.update(cx, |s, cx| s.attach_images(index, paths, cx));
            }
        }).detach();
    }
    pub(super) fn send_chat(&mut self, index: usize, stop: bool, cx: &mut Context<Self>) {
        let chat = &mut self.conversations[index];
        if chat.sending {
            return;
        }
        let text = chat.input.read(cx).content.to_string();
        if !stop && text.trim().is_empty() && chat.images.is_empty() {
            return;
        }
        let (Some(commands), Some(pane), Some(backend)) = (
            chat.commands.clone(),
            chat.pane.clone(),
            self.backend.get().cloned(),
        ) else {
            chat.error =
                Some("Chat is connecting. Your draft is kept; try again when connected.".into());
            cx.notify();
            return;
        };
        let config = chat.config.clone();
        chat.sending = true;
        chat.error = None;
        let sent_text = text.clone();
        let sent_images = chat.images.clone();
        let images = sent_images.clone();
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
                let message = if stop {
                    json!({"type":"chat:stop", "paneId":pane})
                } else {
                    let workspace: inferay_core::agent_state::Workspace = serde_json::from_value(
                        backend.request(reqwest::Method::GET, "/api/agent/state", None).await?
                    )?;
                    let saved = workspace.pane(&pane).ok_or_else(|| anyhow::anyhow!("This conversation no longer exists"))?;
                    if saved.agent_kind != config.agent_kind.as_str() {
                        let action = inferay_core::workspace_action::AgentWorkspaceAction::ChangePaneAgentKind {
                            pane_id: pane.clone(), agent_kind: config.agent_kind.clone(),
                        };
                        backend.request(reqwest::Method::POST, "/api/agent/state/workspace-action", Some(json!({"action":action}))).await?;
                    }
                    let mut preferences = serde_json::to_value(&config)?;
                    preferences["paneId"] = pane.clone().into();
                    backend.request(reqwest::Method::POST, "/api/native/provider-config", Some(preferences)).await?;
                    let mut uploaded = Vec::new();
                    for path in images { uploaded.push(backend.upload_image(path, "/api/upload-temp").await?["path"].as_str().ok_or_else(|| anyhow::anyhow!("Image upload returned no path"))?.to_owned()); }
                    let mut message = json!({"images":uploaded,"type":"chat:send", "paneId":pane, "text":text,
                        "agentKind":config.agent_kind, "model":config.model, "reasoningLevel":config.reasoning_level});
                    if let Some(cwd) = &saved.cwd { message["cwd"] = cwd.clone().into(); }
                    message["referencePaths"] = serde_json::to_value(&saved.reference_paths)?;
                    message
                };
                let (completed, result) = tokio::sync::oneshot::channel();
                commands.send(Command { message, completed }).await
                    .map_err(|_| anyhow::anyhow!("Chat disconnected before the request was sent"))?;
                result.await.map_err(|_| anyhow::anyhow!("Chat disconnected before the request was sent"))?
                    .map_err(anyhow::Error::msg)
            })
        });
        chat.command_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| {
                let chat = &mut view.conversations[index];
                chat.sending = false;
                match result {
                    Ok(()) if !stop => {
                        // Keep anything typed while the request was being prepared.
                        if chat.input.read(cx).content.as_ref() == sent_text {
                            chat.input.update(cx, |input, cx| input.set_content("", cx));
                        }
                        chat.images.retain(|path| !sent_images.contains(path));
                        chat.scroll.scroll_to_end();
                    }
                    Ok(()) => {}
                    Err(error) => {
                        chat.error = Some(format!(
                            "Could not {}: {error:#}",
                            if stop {
                                "stop generation"
                            } else {
                                "send message"
                            }
                        ))
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn connect_chat(&mut self, index: usize, cx: &mut Context<Self>) {
        self.track_draft(index, false, cx);
        let chat = &mut self.conversations[index];
        if chat.live_task.is_some() {
            return;
        }
        let Some(pane) = chat.pane.clone() else {
            return;
        };
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let (updates, mut incoming) = tokio::sync::mpsc::channel(8);
        RUNTIME.spawn(async move {
            let mut replica = ChatReplica::new();
            let mut buffer = ChatMessageBuffer::default();
            let mut queue = json!([]);
            let mut status = json!({"isLoading":false,"status":"idle","startTime":null});
            loop {
                let session = async {
                    let backend = backend
                        .get_or_try_init(|| Backend::connect(profile.clone()))
                        .await?;
                    let mut socket = backend.chat_socket().await?;
                    let (commands, mut pending) = tokio::sync::mpsc::channel::<Command>(1);
                    let mut ready = false;
                    replica.reconnect();
                    let mut reconnect: Value = serde_json::from_str(&replica.cursor())?;
                    reconnect["type"] = "chat:reconnect".into();
                    reconnect["paneId"] = pane.clone().into();
                    socket
                        .send(Message::Text(reconnect.to_string().into()))
                        .await?;
                    loop {
                        let frame = tokio::select! {
                            frame = socket.next() => match frame { Some(frame) => frame, None => break },
                            Some(command) = pending.recv(), if ready => {
                                let result = socket.send(Message::Text(command.message.to_string().into())).await;
                                let failed = result.is_err();
                                let _ = command.completed.send(result.map_err(|error| error.to_string()));
                                if failed { break; }
                                continue;
                            }
                        };
                        let event: Value = match frame? {
                            Message::Text(text) => serde_json::from_str(text.as_str())?,
                            Message::Close(_) => break,
                            _ => continue,
                        };
                        let Some(plan) = replica.event(&event, &pane, &status) else {
                            continue;
                        };
                        ready |= event["type"] == "chat:sync";
                        let range = match plan.admission {
                            TranscriptAdmission::Ignore => continue,
                            TranscriptAdmission::Resync { reconnect: retry } => {
                                if retry {
                                    // A full snapshot repairs a gap without admitting out-of-order patches.
                                    socket
                                        .send(Message::Text(
                                            json!({"type":"chat:reconnect","paneId":pane})
                                                .to_string()
                                                .into(),
                                        ))
                                        .await?;
                                }
                                continue;
                            }
                            TranscriptAdmission::Sync { .. } => Some((
                                0..buffer.messages().len(),
                                event["messages"].as_array().cloned().unwrap_or_default(),
                            )),
                            TranscriptAdmission::Patch {
                                start,
                                delete_count,
                            } => {
                                let mut messages = Vec::new();
                                for (offset, change) in event["transcriptUpdate"]["messages"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .enumerate()
                                {
                                    let mut message = change["message"].clone();
                                    if let Some(append) = change["appendContent"].as_str() {
                                        let old = buffer
                                            .messages()
                                            .get(start + offset)
                                            .ok_or_else(|| {
                                                anyhow::anyhow!("Missing transcript append target")
                                            })?;
                                        message["content"] =
                                            format!("{}{append}", old.content).into();
                                    }
                                    messages.push(message);
                                }
                                Some((start..start + delete_count, messages))
                            }
                            TranscriptAdmission::None => None,
                        };
                        if let Some(next) = plan.status {
                            status = serde_json::to_value(next)?;
                        }
                        let queue_update = if event["type"] == "chat:sync"
                            || plan.control.as_deref() == Some("cleared")
                            || !plan.pending_steers.is_empty() || plan.stage_steer
                            || plan.resolve_steer.is_some() || plan.queue {
                        let previous_queue = queue.clone();
                        if event["type"] == "chat:sync" || plan.control.as_deref() == Some("cleared") {
                            queue = json!([]);
                        }
                        for position in plan.pending_steers {
                            queue = inferay_presentation::composer::update_queue(
                                &json!({"current":queue,"message":event["pendingSteers"][position]}), true);
                        }
                        if plan.stage_steer {
                            queue = inferay_presentation::composer::update_queue(
                                &json!({"current":queue,"message":event["message"]}), true);
                        }
                        if let Some(id) = plan.resolve_steer {
                            queue = inferay_presentation::composer::update_queue(
                                &json!({"current":queue,"id":id}), false);
                        }
                        if plan.queue {
                            queue = inferay_presentation::composer::merge_queue(
                                &json!({"current":queue,"persisted":event["queue"]}));
                        }
                        (queue != previous_queue)
                            .then(|| queue.as_array().cloned().unwrap_or_default())
                        } else { None };
                        let changed = if plan.control.as_deref() == Some("cleared") {
                            replica.clear();
                            buffer = ChatMessageBuffer::default();
                            Some((0, Vec::new()))
                        } else if let Some((range, messages)) = range {
                            let messages = messages
                                .into_iter()
                                .map(serde_json::from_value)
                                .collect::<Result<Vec<_>, _>>()?;
                            let start = buffer.splice_replica_messages(range, messages);
                            Some((start, buffer.messages()[start..].to_vec()))
                        } else {
                            None
                        };
                        updates
                            .send(Update { changed, queue: queue_update, notice: plan.notice, commands: ready.then(|| commands.clone()), refresh_title: matches!(event["type"].as_str(), Some("chat:sync" | "chat:summary")), running: status["isLoading"].as_bool().unwrap_or(false), start_time: status["startTime"].as_f64() })
                            .await
                            .map_err(|_| anyhow::anyhow!("Chat view closed"))?;
                    }
                    anyhow::bail!("Chat disconnected; reconnecting…")
                };
                let result: anyhow::Result<()> = tokio::select! {
                    _ = updates.closed() => return,
                    result = session => result,
                };
                if let Err(error) = result
                    && updates
                        .send(Update { changed: None, queue: None, notice: Some(format!("{error:#}")), commands: None, refresh_title: false, running: status["isLoading"].as_bool().unwrap_or(false), start_time: status["startTime"].as_f64() })
                        .await
                        .is_err()
                {
                    return;
                }
                tokio::select! {
                    _ = updates.closed() => return,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {},
                }
            }
        });
        chat.live_task = Some(cx.spawn(async move |this, cx| {
            while let Some(update) = incoming.recv().await {
                let prepared = if let Some((start, messages)) = update.changed {
                    let Ok(theme) = this.read_with(cx, |view, _| view.syntax_theme.clone()) else {
                        break;
                    };
                    let rich = cx
                        .background_executor()
                        .spawn(async move {
                            let rich = messages
                                .iter()
                                .map(|message| crate::rich_text::RichText::message(message, &theme))
                                .collect::<Vec<_>>();
                            (start, messages, rich)
                        })
                        .await;
                    Some(rich)
                } else {
                    None
                };
                if this
                    .update(cx, |view, cx| {
                        view.track_draft(index, false, cx);
                        if update.refresh_title {
                            view.refresh_chat_title(index, cx);
                        }
                        let chat = &mut view.conversations[index];
                        chat.connection_error = update.notice;
                        chat.commands = update.commands;
                        chat.running = update.running;
                        chat.start_time = update.start_time;
                        if let Some(queue) = update.queue {
                            chat.queue = queue;
                            if chat.queue_editor.as_ref().is_some_and(|(id, _)| !chat.queue.iter().any(|m| m["id"].as_str() == Some(id.as_str()))) {
                                chat.queue_editor = None;
                            chat.queue_submit = None;
                            }
                        }
                        if let Some((start, messages, rich)) = prepared {
                            let follow = chat.scroll.is_following_tail();
                            let anchor = chat.scroll.logical_scroll_top();
                            let anchor_id = chat.messages.get(anchor.item_ix).map(|m| m.id.clone());
                            chat.scroll
                                .splice(start..chat.scroll.item_count(), messages.len());
                            chat.messages.truncate(start);
                            chat.rich.truncate(start);
                            chat.messages.extend(messages);
                            chat.rich.extend(rich);
                            chat.total_messages = chat.messages.len();
                            if follow {
                                chat.scroll.scroll_to_end();
                            } else if let Some(id) = anchor_id
                                && let Some(item_ix) = chat.messages.iter().position(|m| m.id == id)
                            {
                                chat.scroll.scroll_to(ListOffset { item_ix, ..anchor });
                            }
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
    }
}
