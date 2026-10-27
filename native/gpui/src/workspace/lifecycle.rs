use super::*;
use crate::backend::{Backend, RUNTIME};
use inferay_core::{
    agent_state::Workspace, project_files::ProjectFileCommand,
    workspace_action::AgentWorkspaceAction,
};
use reqwest::Method;
use serde_json::json;

pub(super) struct PreferenceSave {
    entries: serde_json::Value,
    pane: Option<String>,
    dock: Option<serde_json::Value>,
}

impl WorkspaceView {
    pub(super) fn close_chat(&mut self, index: usize, cx: &mut Context<Self>) {
        let chat = &self.conversations[index];
        if chat.closed
            || chat.close_task.is_some()
            || (chat.loading && chat.pane.is_none())
            || chat.sending
        {
            return;
        }
        let Some(pane) = chat.pane.clone() else {
            self.finish_close_chat(index, None, cx);
            return;
        };
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
                let backend = backend
                    .get_or_try_init(|| Backend::connect(profile))
                    .await?;
                backend
                    .request(
                        Method::POST,
                        "/api/chat/close",
                        Some(json!({"paneId":pane})),
                    )
                    .await
            })
        });
        self.conversations[index].close_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| {
                view.conversations[index].close_task = None;
                match result {
                    Ok(response) => {
                        let replacement =
                            serde_json::from_value::<Workspace>(response["state"].clone())
                                .ok()
                                .and_then(|workspace| {
                                    workspace
                                        .panes()
                                        .find(|pane| {
                                            !view
                                                .conversations
                                                .iter()
                                                .any(|chat| chat.pane.as_deref() == Some(&pane.id))
                                        })
                                        .map(|pane| pane.id.clone())
                                });
                        view.finish_close_chat(index, replacement, cx);
                    }
                    Err(error) => {
                        view.conversations[index].error =
                            Some(format!("Could not close chat: {error:#}"))
                    }
                }
                cx.notify();
            });
        }));
    }

    fn finish_close_chat(
        &mut self,
        index: usize,
        replacement: Option<String>,
        cx: &mut Context<Self>,
    ) {
        // Keep indices stable for other chats' subscriptions and pending requests.
        let chat = &mut self.conversations[index];
        let project = chat.project;
        chat.closed = true;
        chat.run = ChatRunStatus::default();
        chat.task = None;
        chat.live_task = None;
        chat.metadata_task = None;
        chat.commands = None;
        chat.command_task = None;
        chat.queue_task = None;
        chat.queue_editor = None;
        chat.queue_submit = None;
        chat.submit_subscription = None;
        chat.draft_subscription = None;
        chat.draft_task = None;
        chat.theme_task = None;
        chat.request_task = None;
        chat.completion = Default::default();
        chat.requests.clear();
        chat.request_inputs.clear();
        chat.transcript = crate::transcript::Transcript::new();
        chat.images.clear();
        if let Some(next) = self
            .conversations
            .iter()
            .enumerate()
            .filter(|(_, chat)| !chat.closed && chat.project == project)
            .min_by_key(|(i, _)| i.abs_diff(index))
            .map(|(i, _)| i)
        {
            if self.projects[project].selected == index {
                self.projects[project].selected = next;
            }
            if self.selected == index {
                self.selected = next;
            }
        } else {
            let active_project = self.project;
            let active_selected = self.selected;
            self.project = project;
            self.add_chat(cx);
            self.conversations[self.selected].pane = replacement;
            self.create_chat(self.selected, cx);
            if active_project != project {
                self.project = active_project;
                self.selected = active_selected;
            }
        }
        self.persist_workspace_preferences(None, cx);
        cx.notify();
    }

    pub(super) fn persist_workspace_preferences(
        &mut self,
        dock: Option<serde_json::Value>,
        cx: &mut Context<Self>,
    ) {
        if self.preference_updates.is_none() {
            let (sender, mut updates) = tokio::sync::mpsc::unbounded_channel::<PreferenceSave>();
            self.preference_updates = Some(sender);
            let backend = self.backend.clone();
            let profile = self.profile.clone();
            self.preference_task = Some(cx.spawn(async move |this, cx| {
                while let Some(selection) = updates.recv().await {
                    let backend = backend.clone();
                    let profile = profile.clone();
                    let result: anyhow::Result<()> = cx
                        .background_executor()
                        .spawn(async move {
                            RUNTIME.block_on(async move {
                                let backend = backend
                                    .get_or_try_init(|| Backend::connect(profile))
                                    .await?;
                                backend
                                    .request(
                                        Method::POST,
                                        "/api/client-storage",
                                        Some(json!({
                                            "entries":selection.entries
                                        })),
                                    )
                                    .await?;
                                if let Some(pane_id) = selection.pane {
                                    let action = AgentWorkspaceAction::SelectPane { pane_id };
                                    backend
                                        .request(
                                            Method::POST,
                                            "/api/agent/state/workspace-action",
                                            Some(json!({"action":action})),
                                        )
                                        .await?;
                                }
                                if let Some(dock) = selection.dock {
                                    backend
                                        .request(Method::POST, "/api/workspace/dock", Some(dock))
                                        .await?;
                                }
                                Ok(())
                            })
                        })
                        .await;
                    if let Err(error) = result {
                        let _ = this.update(cx, |view, cx| {
                            view.status =
                                format!("Could not save workspace preferences: {error:#}");
                            cx.notify();
                        });
                    }
                }
            }));
        }
        let project = self.projects[self.project].id.clone().unwrap_or_default();
        let pane = self.conversations[self.selected].pane.clone();
        let entries = json!({
            "inferay-selected-project-id":project,
            "sidebar-collapsed":(!self.sidebar).to_string(),
            "main-sidebar-width":self.sidebar_width.to_string(),
            "inferay-ui-zoom-percent":self.zoom.percent().to_string(),
        });
        if let Some(sender) = &self.preference_updates {
            let _ = sender.send(PreferenceSave {
                entries,
                pane,
                dock,
            });
        }
    }

    pub(super) fn refresh_chat_title(&mut self, index: usize, cx: &mut Context<Self>) {
        let (Some(backend), Some(pane)) = (
            self.backend.get().cloned(),
            self.conversations[index].pane.clone(),
        ) else {
            return;
        };
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
                let workspace: Workspace = serde_json::from_value(
                    backend
                        .request(Method::GET, "/api/agent/state", None)
                        .await?,
                )?;
                let saved = workspace
                    .pane(&pane)
                    .ok_or_else(|| anyhow::anyhow!("Conversation no longer exists"))?;
                let title = saved
                    .summary
                    .clone()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("{} chat", saved.agent_kind));
                Ok::<_, anyhow::Error>((pane, title))
            })
        });
        self.conversations[index].metadata_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            if let Ok((pane, title)) = result {
                let _ = this.update(cx, |view, cx| {
                    let chat = &mut view.conversations[index];
                    if chat.pane.as_deref() == Some(&pane) && chat.title != title {
                        chat.title = title;
                        cx.notify();
                    }
                });
            }
        }));
    }

    pub(super) fn track_draft(&mut self, index: usize, save_initial: bool, cx: &mut Context<Self>) {
        self.track_completions(index, cx);
        let chat = &mut self.conversations[index];
        if chat.submit_subscription.is_none() {
            chat.input
                .update(cx, |input, _| input.submit_on_enter = true);
            chat.submit_subscription = Some(cx.subscribe(
                &chat.input,
                move |view, _, _: &crate::input::Submit, cx| {
                    view.send_chat(index, false, cx);
                },
            ));
        }
        if chat.draft_subscription.is_some() {
            return;
        }
        let Some(pane) = chat.pane.clone() else {
            let input = chat.input.clone();
            chat.draft_subscription = Some(cx.observe(&input, move |view, input, cx| {
                if !input.read(cx).content.is_empty() && !view.conversations[index].loading {
                    view.create_chat(index, cx);
                }
            }));
            return;
        };
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let (drafts, mut pending) = tokio::sync::mpsc::unbounded_channel::<String>();
        let (results, mut completed) = tokio::sync::mpsc::channel(1);
        let input = chat.input.clone();
        let mut previous = input.read(cx).content.to_string();
        if save_initial && !previous.is_empty() {
            let _ = drafts.send(previous.clone());
        }
        chat.draft_subscription = Some(cx.observe(&input, move |_, input, cx| {
            let text = input.read(cx).content.to_string();
            if text != previous {
                previous.clone_from(&text);
                let _ = drafts.send(text);
            }
        }));
        RUNTIME.spawn(async move {
            while let Some(mut text) = pending.recv().await {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                while let Ok(newer) = pending.try_recv() {
                    text = newer;
                }
                let result = backend
                    .request(
                        Method::POST,
                        "/api/client-storage",
                        Some(json!({"entries":{format!("inferay-chat-input-{pane}"):text}})),
                    )
                    .await;
                if results
                    .send(result.err().map(|e| format!("Could not save draft: {e:#}")))
                    .await
                    .is_err()
                {
                    return;
                }
            }
        });
        chat.draft_task = Some(cx.spawn(async move |this, cx| {
            while let Some(error) = completed.recv().await {
                if let Some(error) = error {
                    let _ = this.update(cx, |view, cx| {
                        view.conversations[index].error = Some(error);
                        cx.notify();
                    });
                }
            }
        }));
    }

    pub(super) fn create_chat(&mut self, index: usize, cx: &mut Context<Self>) {
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let project = self.projects[self.conversations[index].project].id.clone();
        let config = self.conversations[index].config.clone();
        let existing = self.conversations[index].pane.clone();
        self.conversations[index].loading = true;
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
                let backend = backend
                    .get_or_try_init(|| Backend::connect(profile.clone()))
                    .await?;
                backend
                    .request(Method::POST, "/api/agent/state/initialize", Some(json!({})))
                    .await?;
                let pane = if let Some(pane) = existing {
                    if let Some(project_id) = &project {
                        let action = AgentWorkspaceAction::DirectorySelected {
                            pane_id: pane.clone(),
                            path: Some(
                                profile
                                    .join("projects")
                                    .join(project_id)
                                    .to_string_lossy()
                                    .into_owned(),
                            ),
                            reference_paths: None,
                        };
                        backend
                            .request(
                                Method::POST,
                                "/api/agent/state/workspace-action",
                                Some(json!({"action":action})),
                            )
                            .await?;
                    }
                    pane
                } else {
                    let action = AgentWorkspaceAction::AddPane {
                        group_id: None,
                        agent_kind: Some(config.agent_kind.clone()),
                        cwd: project.as_ref().map(|id| {
                            profile
                                .join("projects")
                                .join(id)
                                .to_string_lossy()
                                .into_owned()
                        }),
                        reference_paths: None,
                    };
                    let response = backend
                        .request(
                            Method::POST,
                            "/api/agent/state/workspace-action",
                            Some(json!({"action":action})),
                        )
                        .await?;
                    let workspace: Workspace = serde_json::from_value(response["state"].clone())?;
                    workspace
                        .selected_pane_id()
                        .ok_or_else(|| {
                            anyhow::anyhow!("New chat was not returned by Inferay services")
                        })?
                        .to_owned()
                };
                // Retain the created identity even if a subsequent settings/association write fails.
                let setup = async {
                    if let Some(project_id) = project {
                        let command = ProjectFileCommand::AssociateConversation {
                            project_id,
                            pane_id: pane.clone(),
                        };
                        backend
                            .request(
                                Method::POST,
                                "/api/projects/command",
                                Some(serde_json::to_value(command)?),
                            )
                            .await?;
                    }
                    let mut config = serde_json::to_value(config)?;
                    config["paneId"] = pane.clone().into();
                    backend
                        .request(Method::POST, "/api/native/provider-config", Some(config))
                        .await?;
                    Ok::<_, anyhow::Error>(())
                }
                .await;
                Ok::<_, anyhow::Error>((
                    pane,
                    setup
                        .err()
                        .map(|e| format!("Chat created, but its setup could not be saved: {e:#}")),
                ))
            })
        });
        self.conversations[index].task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| {
                let chat = &mut view.conversations[index];
                chat.loading = false;
                match result {
                    Ok((pane, error)) => {
                        chat.pane = Some(pane);
                        chat.draft_subscription = None;
                        chat.error = error;
                        chat.loaded = true;
                        chat.transcript.scroll.set_follow_mode(FollowMode::Tail);
                        view.track_draft(index, true, cx);
                        view.connect_chat(index, cx);
                    }
                    Err(error) => chat.error = Some(format!("Could not save new chat: {error:#}")),
                }
                cx.notify();
            });
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn closing_chat_removes_saved_pane_and_keeps_other_indices(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let mut workspace = Workspace::new("codex");
        let first = workspace.selected_pane_id().unwrap().to_owned();
        workspace
            .apply_action(
                &AgentWorkspaceAction::AddPane {
                    group_id: None,
                    agent_kind: None,
                    cwd: None,
                    reference_paths: None,
                },
                "codex",
            )
            .unwrap();
        let second = workspace.selected_pane_id().unwrap().to_owned();
        std::fs::write(
            profile.path().join("agent-state.json"),
            serde_json::to_vec(&workspace).unwrap(),
        )
        .unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        let services = backend.clone();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.profile = profile.path().to_owned();
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            view.conversations[0].pane = Some(first.clone());
            let other_input = cx.new(TextInput::new);
            let mut other = WorkspaceView::empty(cx.focus_handle(), other_input, cx)
                .conversations
                .pop()
                .unwrap();
            other.pane = Some(second.clone());
            view.conversations.push(other);
            view
        });
        cx.run_until_parked();
        window
            .update(cx, |view, _, cx| {
                assert_eq!(view.conversations[0].pane.as_deref(), Some(first.as_str()));
                view.conversations[1]
                    .input
                    .update(cx, |input, cx| input.set_content("keep draft", cx));
                view.close_chat(0, cx);
            })
            .unwrap();
        cx.run_until_parked();
        window
            .update(cx, |view, _, cx| {
                assert!(
                    view.conversations[0].closed,
                    "{:?}",
                    view.conversations[0].error
                );
                assert!(view.conversations[0].live_task.is_none());
                assert!(!view.conversations[1].closed);
                assert_eq!(view.conversations[1].pane.as_deref(), Some(second.as_str()));
                assert_eq!(
                    view.conversations[1].input.read(cx).content.as_ref(),
                    "keep draft"
                );
            })
            .unwrap();
        let state = RUNTIME
            .block_on(services.request(Method::GET, "/api/agent/state", None))
            .unwrap();
        let saved: Workspace = serde_json::from_value(state).unwrap();
        assert!(saved.pane(&first).is_none());
        assert!(saved.pane(&second).is_some());
    }

    #[gpui::test]
    fn closing_last_chat_selects_a_new_draft(cx: &mut gpui::TestAppContext) {
        cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.finish_close_chat(0, None, cx);
            assert!(view.conversations[0].closed);
            assert_eq!(view.selected, 1);
            assert_eq!(view.projects[0].selected, 1);
            let replacement = &mut view.conversations[1];
            assert!(!replacement.closed);
            assert!(replacement.loading);
            assert!(replacement.input.read(cx).content.is_empty());
            // This test covers immediate selection; persistence is exercised above.
            replacement.task = None;
            view.preference_task = None;
            view
        });
    }

    #[gpui::test]
    fn latest_selection_is_saved_through_workspace_services(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let workspace = Workspace::new("codex");
        let serialized = serde_json::to_value(&workspace).unwrap();
        let pane = serialized["groups"][0]["panes"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        std::fs::write(
            profile.path().join("agent-state.json"),
            serialized.to_string(),
        )
        .unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        let services = backend.clone();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            view.conversations[0].pane = Some(pane.clone());
            view.projects[0].id = Some("first".into());
            view.persist_workspace_preferences(None, cx);
            view.projects[0].id = Some("latest".into());
            view.sidebar = false;
            view.sidebar_width = 280.;
            view.persist_workspace_preferences(None, cx);
            view
        });
        cx.run_until_parked();
        let state = RUNTIME
            .block_on(services.request(Method::GET, "/api/agent/state", None))
            .unwrap();
        let saved: Workspace = serde_json::from_value(state).unwrap();
        assert_eq!(saved.selected_pane_id(), Some(pane.as_str()));
        let storage = RUNTIME
            .block_on(services.request(Method::GET, "/api/client-storage", None))
            .unwrap();
        assert_eq!(
            storage["entries"]["inferay-selected-project-id"], "latest",
            "{storage}"
        );
        assert_eq!(storage["entries"]["sidebar-collapsed"], "true");
        assert_eq!(storage["entries"]["main-sidebar-width"], "280");
        let restored = crate::session::load(profile.path()).unwrap();
        assert!(restored.sidebar_collapsed);
        assert_eq!(restored.sidebar_width, 280.);
        window
            .update(cx, |view, _, _| {
                assert!(!view.status.starts_with("Could not save"))
            })
            .unwrap();
    }

    #[gpui::test]
    fn dock_resizes_persist_in_order_without_resetting_columns(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        let services = backend.clone();
        let request =
            json!({"workspaceId":"layout-test","ids":["a","b"],"columns":2,"visibleColumns":2});
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            for ratio in [0.3, 0.7] {
                let mut update = request.clone();
                update["action"] = json!({"type":"resize","path":[],"ratio":ratio});
                view.persist_workspace_preferences(Some(update), cx);
            }
            view
        });
        cx.run_until_parked();
        let restored = RUNTIME
            .block_on(services.request(Method::POST, "/api/workspace/dock", Some(request)))
            .unwrap();
        assert_eq!(restored["saved"]["preset"], json!(["grid", 2]));
        assert_eq!(restored["saved"]["tree"]["ratio"], 0.7, "{restored}");
        window
            .update(cx, |view, _, _| {
                assert!(
                    !view.status.starts_with("Could not save"),
                    "{}",
                    view.status
                )
            })
            .unwrap();
    }

    #[gpui::test]
    fn queue_removal_persists_and_preserves_newer_items(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let store =
            inferay_server::chat_persistence::ChatPersistence::new(profile.path().to_owned());
        let queued =
            json!({"id":"remove-me","text":"waiting","displayText":"waiting","images":null});
        RUNTIME
            .block_on(store.enqueue_runtime(
                "queue-pane",
                serde_json::from_value(queued.clone()).unwrap(),
            ))
            .unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some("queue-pane".into());
            chat.queue = vec![
                queued,
                json!({"id":"steering","text":"live steer","transient":true}),
            ];
            view.update_queued_message(0, "steering".into(), None, false, cx);
            assert!(view.conversations[0].queue_task.is_none());
            view.update_queued_message(0, "remove-me".into(), None, false, cx);
            // A newer socket update arriving before the HTTP response must survive.
            view.conversations[0]
                .queue
                .push(json!({"id":"newer","text":"new follow-up"}));
            view
        });
        cx.run_until_parked();
        window
            .update(cx, |view, _, _| {
                let chat = &view.conversations[0];
                assert!(chat.queue_task.is_none());
                assert!(chat.error.is_none(), "{:?}", chat.error);
                assert_eq!(
                    chat.queue
                        .iter()
                        .map(|m| m["id"].as_str().unwrap())
                        .collect::<Vec<_>>(),
                    ["steering", "newer"]
                );
            })
            .unwrap();
        assert!(
            RUNTIME
                .block_on(store.read_queue("queue-pane"))
                .unwrap()
                .is_empty()
        );
    }

    #[gpui::test]
    fn queue_edit_persists_without_overwriting_newer_text(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let store =
            inferay_server::chat_persistence::ChatPersistence::new(profile.path().to_owned());
        let queued =
            json!({"id":"remove-me","text":"waiting","displayText":"waiting","images":null});
        RUNTIME
            .block_on(store.enqueue_runtime(
                "queue-pane",
                serde_json::from_value(queued.clone()).unwrap(),
            ))
            .unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some("queue-pane".into());
            chat.queue = vec![
                queued,
                json!({"id":"steering","text":"live steer","transient":true}),
            ];
            let editor = cx.new(TextInput::new);
            editor.update(cx, |input, cx| input.set_content("edited message", cx));
            view.conversations[0].queue_editor = Some(("remove-me".into(), editor.clone()));
            view.update_queued_message(0, "remove-me".into(), Some("   ".into()), false, cx);
            assert!(view.conversations[0].queue_task.is_none());
            view.update_queued_message(
                0,
                "remove-me".into(),
                Some(" edited message ".into()),
                false,
                cx,
            );
            editor.update(cx, |input, cx| input.set_content("still typing", cx));
            view.conversations[0].queue[0]["text"] = "newer socket text".into();
            view
        });
        cx.run_until_parked();
        window
            .update(cx, |view, _, cx| {
                let chat = &view.conversations[0];
                assert!(chat.queue_task.is_none());
                assert!(chat.error.is_none(), "{:?}", chat.error);
                assert_eq!(chat.queue[0]["text"], "newer socket text");
                assert_eq!(
                    chat.queue_editor
                        .as_ref()
                        .unwrap()
                        .1
                        .read(cx)
                        .content
                        .as_ref(),
                    "still typing"
                );
            })
            .unwrap();
        assert_eq!(
            RUNTIME.block_on(store.read_queue("queue-pane")).unwrap()[0].text,
            "edited message"
        );
    }

    #[gpui::test]
    fn enter_sends_follow_up_without_stopping_the_active_turn(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let workspace = Workspace::new("codex");
        let serialized = serde_json::to_value(&workspace).unwrap();
        let pane = serialized["groups"][0]["panes"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        std::fs::write(
            profile.path().join("agent-state.json"),
            serialized.to_string(),
        )
        .unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        let (commands, mut requests) = tokio::sync::mpsc::channel::<live::Command>(1);
        let expected_pane = pane.clone();
        let received = RUNTIME.spawn(async move {
            let command = requests.recv().await.unwrap();
            assert_eq!(command.message["type"], "chat:send");
            assert_eq!(command.message["paneId"], expected_pane);
            assert_eq!(command.message["text"], "follow up");
            command.completed.send(Ok(())).unwrap();
        });
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.profile = profile.path().to_owned();
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some(pane);
            chat.commands = Some(commands);
            chat.run.is_loading = true;
            chat.input
                .update(cx, |input, cx| input.set_content("follow up", cx));
            view.track_draft(0, false, cx);
            view
        });
        window
            .update(cx, |view, _, cx| {
                view.conversations[0]
                    .input
                    .update(cx, |_, cx| cx.emit(crate::input::Submit));
            })
            .unwrap();
        cx.run_until_parked();
        RUNTIME.block_on(received).unwrap();
        window
            .update(cx, |view, _, cx| {
                let chat = &view.conversations[0];
                assert!(chat.run.is_loading);
                assert!(!chat.sending);
                assert!(chat.error.is_none(), "{:?}", chat.error);
                assert!(chat.input.read(cx).content.is_empty());
            })
            .unwrap();
    }

    #[gpui::test]
    fn refreshed_title_preserves_the_open_conversation(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let mut workspace = serde_json::to_value(Workspace::new("codex")).unwrap();
        workspace["groups"][0]["panes"][0]["summary"] = "Updated conversation title".into();
        let pane = workspace["groups"][0]["panes"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        std::fs::write(
            profile.path().join("agent-state.json"),
            workspace.to_string(),
        )
        .unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.profile = profile.path().to_owned();
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some(pane.clone());
            chat.input
                .update(cx, |input, cx| input.set_content("unsent draft", cx));
            view.refresh_chat_title(0, cx);
            view
        });
        cx.run_until_parked();
        window
            .update(cx, |view, _, cx| {
                let chat = &view.conversations[0];
                assert_eq!(chat.title, "Updated conversation title");
                assert_eq!(chat.pane.as_deref(), Some(pane.as_str()));
                assert_eq!(chat.input.read(cx).content.as_ref(), "unsent draft");
            })
            .unwrap();
    }
}
