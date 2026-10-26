//! Live chat transport uses shared transcript admission and native task lifetimes.
use super::*;
use crate::backend::{Backend, RUNTIME};
use futures_util::{SinkExt, StreamExt};
use inferay_core::chat_protocol::{ChatMessageBuffer, ChatTranscriptMessage};
use inferay_presentation::transcript::{ChatReplica, TranscriptAdmission};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

pub(super) struct Command {
    pub message: Value,
    pub completed: tokio::sync::oneshot::Sender<Result<(), String>>,
}

const UPDATE_CAPACITY: usize = 8;

#[cfg_attr(test, derive(Clone))]
struct Update {
    changed: Option<(usize, Vec<ChatTranscriptMessage>)>,
    notice: Option<String>,
    commands: Option<tokio::sync::mpsc::Sender<Command>>,
    run_status: ChatRunStatus,
    terminal: bool,
    prior_activity: Vec<(ChatRunStatus, bool)>,
    refresh_title: bool,
    queue: Option<Vec<Value>>,
}

impl Update {
    // Each admitted patch replaces a suffix. Keep the earliest untouched prefix
    // and the newest suffix before performing Markdown and syntax preparation.
    fn merge(&mut self, next: Self) {
        let previous = std::mem::replace(self, next);
        self.changed = match (previous.changed, self.changed.take()) {
            (Some((start, mut earlier)), Some((new_start, newer))) if new_start > start => {
                assert!(new_start - start <= earlier.len());
                earlier.truncate(new_start - start);
                earlier.extend(newer);
                Some((start, earlier))
            }
            (_, Some(changed)) | (Some(changed), None) => Some(changed),
            (None, None) => None,
        };
        self.queue = self.queue.take().or(previous.queue);
        self.refresh_title |= previous.refresh_title;
        let mut activity = previous.prior_activity;
        activity.push((previous.run_status, previous.terminal));
        activity.append(&mut self.prior_activity);
        self.prior_activity = activity;
    }
}

impl WorkspaceView {
    pub(super) fn update_queued_message(
        &mut self,
        index: usize,
        id: String,
        text: Option<String>,
        cx: &mut Context<Self>,
    ) {
        let text = text.map(|text| text.trim().to_owned());
        if text.as_ref().is_some_and(|text| text.is_empty()) {
            return;
        }
        let chat = &mut self.conversations[index];
        if chat.queue_task.is_some()
            || !chat.queue.iter().any(|message| {
                message["id"].as_str() == Some(&id)
                    && !message["transient"].as_bool().unwrap_or(false)
            })
        {
            return;
        }
        let (Some(backend), Some(pane)) = (self.backend.get().cloned(), chat.pane.clone()) else {
            chat.error =
                Some("Chat is connecting. Try updating the message again when connected.".into());
            cx.notify();
            return;
        };
        chat.error = None;
        let updated_id = id.clone();
        let updated_text = text.clone();
        let original = chat
            .queue
            .iter()
            .find(|message| message["id"].as_str() == Some(&id))
            .cloned();
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
                if chat.pane.as_ref() != Some(&target_pane) {
                    return;
                }
                chat.queue_task = None;
                match result {
                    Ok(_) => {
                        // Never replace newer socket state with an older HTTP snapshot.
                        if let Some(text) = &updated_text {
                            if let Some(message) = chat
                                .queue
                                .iter_mut()
                                .find(|message| message["id"].as_str() == Some(&updated_id))
                                && Some(&*message) == original.as_ref()
                            {
                                message["text"] = text.clone().into();
                                message["displayText"] = text.clone().into();
                            }
                        } else {
                            chat.queue
                                .retain(|message| message["id"].as_str() != Some(&updated_id));
                        }
                        if chat.queue_editor.as_ref().is_some_and(|(id, input)| {
                            id == &updated_id
                                && updated_text
                                    .as_deref()
                                    .is_none_or(|text| input.read(cx).content.trim() == text)
                        }) {
                            chat.queue_editor = None;
                            chat.queue_submit = None;
                        }
                    }
                    Err(error) => {
                        chat.error = Some(format!("Could not update queued message: {error:#}"))
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn attach_images(
        &mut self,
        index: usize,
        paths: Vec<std::path::PathBuf>,
        cx: &mut Context<Self>,
    ) {
        let chat = &mut self.conversations[index];
        for path in paths {
            if !matches!(
                path.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif"
            ) {
                chat.error = Some("Choose PNG, JPEG, WebP, or GIF images.".into());
                continue;
            }
            if !chat.images.contains(&path) {
                chat.images.push(path);
            }
        }
        cx.notify();
    }
    pub(super) fn pick_chat_images(&mut self, index: usize, cx: &mut Context<Self>) {
        let picked = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("Attach images".into()),
        });
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(Some(paths))) = picked.await {
                let _ = this.update(cx, |s, cx| s.attach_images(index, paths, cx));
            }
        })
        .detach();
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
        let local_command = text.split_whitespace().next().is_some_and(|command| {
            ["/help", "/clear", "/exit", "/btw"]
                .iter()
                .any(|local| command.eq_ignore_ascii_case(local))
        });
        let started = !stop
            && !local_command
            && chat.run.begin(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            );
        if started {
            chat.transcript.scroll.set_follow_mode(FollowMode::Tail);
            chat.transcript.scroll.scroll_to_end();
        }
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
                        chat.transcript.scroll.scroll_to_end();
                    }
                    Ok(()) => {}
                    Err(error) => {
                        if started {
                            chat.run.submission_failed();
                        }
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
        let (updates, mut incoming) = tokio::sync::mpsc::channel(UPDATE_CAPACITY);
        RUNTIME.spawn(async move {
            let mut replica = ChatReplica::default();
            let mut buffer = ChatMessageBuffer::default();
            let mut queue = json!([]);
            let mut status = ChatRunStatus::default();
            loop {
                let session = async {
                    let backend = backend
                        .get_or_try_init(|| Backend::connect(profile.clone()))
                        .await?;
                    let mut socket = backend.chat_socket().await?;
                    let (commands, mut pending) = tokio::sync::mpsc::channel::<Command>(1);
                    let mut ready = false;
                    let reconnect = replica.reconnect(&pane);
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
                            status = next;
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
                            .send(Update { changed, queue: queue_update, notice: plan.notice, commands: ready.then(|| commands.clone()), refresh_title: matches!(event["type"].as_str(), Some("chat:sync" | "chat:summary")), run_status: status.clone(), terminal: matches!(event["type"].as_str(), Some("chat:done" | "chat:error")), prior_activity: vec![] })
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
                        .send(Update { changed: None, queue: None, notice: Some(format!("{error:#}")), commands: None, refresh_title: false, run_status: status.clone(), terminal: false, prior_activity: vec![] })
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
            while let Some(mut update) = incoming.recv().await {
                for _ in 1..UPDATE_CAPACITY {
                    let Ok(next) = incoming.try_recv() else {
                        break;
                    };
                    update.merge(next);
                }
                let changed = update.changed.take();
                if this
                    .update(cx, |view, cx| {
                        view.track_draft(index, false, cx);
                        if update.refresh_title {
                            view.refresh_chat_title(index, cx);
                        }
                        let chat = &mut view.conversations[index];
                        chat.connection_error = update.notice.take();
                        chat.commands = update.commands.take();
                        for (status, terminal) in update.prior_activity {
                            chat.run.admit(status, terminal);
                        }
                        chat.run.admit(update.run_status, update.terminal);
                        if let Some(queue) = update.queue.take() {
                            chat.queue = queue;
                            if chat.queue_editor.as_ref().is_some_and(|(id, _)| {
                                !chat
                                    .queue
                                    .iter()
                                    .any(|m| m["id"].as_str() == Some(id.as_str()))
                            }) {
                                chat.queue_editor = None;
                                chat.queue_submit = None;
                            }
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
                let Some((start, messages)) = changed else {
                    continue;
                };
                let Ok(theme) = this.read_with(cx, |view, _| view.syntax_theme.clone()) else {
                    break;
                };
                let prepared = cx
                    .background_executor()
                    .spawn(async move {
                        PreparedTranscript::prepare(
                            start,
                            messages.into_iter().map(std::sync::Arc::new),
                            &theme,
                        )
                    })
                    .await;
                let Ok(prepared) = Self::prepare_for_current_theme(&this, prepared, cx).await
                else {
                    break;
                };
                if this
                    .update(cx, |view, cx| {
                        view.conversations[index].transcript.publish(prepared, None);
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn update(start: usize, messages: Vec<ChatTranscriptMessage>) -> Update {
        Update {
            changed: Some((start, messages)),
            notice: None,
            commands: None,
            run_status: ChatRunStatus::default(),
            terminal: false,
            prior_activity: vec![],
            refresh_title: false,
            queue: None,
        }
    }

    fn message(id: usize, content: &str) -> ChatTranscriptMessage {
        serde_json::from_value(json!({"id":id.to_string(),"role":"assistant","content":content}))
            .unwrap()
    }

    #[test]
    fn coalesced_suffixes_match_sequential_publication_including_clear() {
        let initial: Vec<_> = (0..6).map(|i| message(i, "original")).collect();
        for seed in 0..40 {
            let mut expected = initial.clone();
            let mut combined: Option<Update> = None;
            for step in 0..12 {
                let start = (seed * 7 + step * 11) % (expected.len() + 1);
                let suffix: Vec<_> = (0..(seed + step) % 5)
                    .map(|i| message(step * 10 + i, "new"))
                    .collect();
                expected.truncate(start);
                expected.extend(suffix.clone());
                let next = update(start, suffix);
                if let Some(combined) = &mut combined {
                    combined.merge(next);
                } else {
                    combined = Some(next);
                }
            }
            let (start, suffix) = combined.unwrap().changed.unwrap();
            let mut actual = initial.clone();
            actual.truncate(start);
            actual.extend(suffix);
            assert_eq!(actual, expected, "sequence {seed}");
        }
    }

    #[test]
    fn coalescing_preserves_queue_refresh_and_terminal_events() {
        let mut combined = update(0, vec![message(0, "final response")]);
        combined.terminal = true;
        combined.refresh_title = true;
        combined.queue = Some(vec![json!({"id":"queued"})]);
        let mut next = update(0, vec![]);
        next.changed = None;
        next.notice = Some("disconnected".into());
        combined.merge(next);
        assert_eq!(combined.changed.unwrap().1[0].content, "final response");
        assert!(combined.prior_activity[0].1 && combined.refresh_title);
        assert_eq!(combined.queue.unwrap()[0]["id"], "queued");
        assert_eq!(combined.notice.as_deref(), Some("disconnected"));
    }

    #[test]
    fn coalescing_keeps_the_clock_boundary_between_completed_and_queued_turns() {
        let mut current = ChatRunStatus::default();
        current.begin(100);
        let mut completed = update(0, vec![]);
        completed.terminal = true;
        let mut queued = update(0, vec![]);
        queued
            .run_status
            .observe("thinking".into(), Some(true), 300);
        completed.merge(queued);
        for (status, terminal) in completed.prior_activity {
            current.admit(status, terminal);
        }
        current.admit(completed.run_status, completed.terminal);
        assert_eq!(current.start_time, Some(300));
        assert_eq!(current.status, "thinking");
    }

    #[test]
    #[ignore = "paired release benchmark"]
    fn benchmark_stream_burst_preparation() {
        use std::hint::black_box;
        let source =
            "A paragraph with **bold**, `code`, and a [reference](https://example.com).\n\n"
                .repeat(128);
        let updates: Vec<_> = (0..8)
            .map(|i| update(0, vec![message(0, &format!("{source}chunk {i}"))]))
            .collect();
        let mut combined = updates[0].clone();
        for next in updates[1..].iter().cloned() {
            combined.merge(next);
        }
        assert_eq!(
            combined.changed.as_ref().unwrap().1,
            updates.last().unwrap().changed.as_ref().unwrap().1
        );
        crate::performance::compare("stream_burst_8_updates", |coalesce| {
            let mut pending = black_box(updates.clone()).into_iter();
            if coalesce {
                let mut combined = pending.next().unwrap();
                for next in pending {
                    combined.merge(next);
                }
                let (start, messages) = combined.changed.unwrap();
                black_box(PreparedTranscript::prepare(
                    start,
                    messages.into_iter().map(std::sync::Arc::new),
                    "vscode-black",
                ));
            } else {
                for next in pending {
                    let (start, messages) = next.changed.unwrap();
                    black_box(PreparedTranscript::prepare(
                        start,
                        messages.into_iter().map(std::sync::Arc::new),
                        "vscode-black",
                    ));
                }
            }
        });
    }
}
