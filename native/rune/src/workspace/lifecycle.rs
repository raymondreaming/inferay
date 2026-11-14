use super::*;
use inferay_core::{
    agent_state::Workspace as AgentWorkspace, project_files::ProjectFileCommand,
    workspace_action::AgentWorkspaceAction,
};
use reqwest::Method;
use serde_json::json;

pub(crate) struct PreferenceSave {
    entries: serde_json::Value,
    pane: Option<String>,
    dock: Option<serde_json::Value>,
}

pub(crate) enum Draft {
    Unsaved,
    Saving {
        drafts: tokio::sync::mpsc::UnboundedSender<String>,
        previous: String,
    },
}

impl Workspace {
    pub(crate) fn close_chat(&mut self, index: usize) {
        let chat = &self.conversations[index];
        if chat.closed
            || chat.close_task.is_some()
            || (chat.loading && chat.pane.is_none())
            || chat.sending
        {
            return;
        }
        let Some(pane) = chat.pane.clone() else {
            self.finish_close_chat(index, None);
            return;
        };
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        self.conversations[index].close_task = Some(crate::task::spawn(
            async move {
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
            },
            move |view: &mut Workspace, result, _| {
                view.conversations[index].close_task = None;
                match result {
                    Ok(response) => {
                        let replacement =
                            serde_json::from_value::<AgentWorkspace>(response["state"].clone())
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
                        view.finish_close_chat(index, replacement);
                    }
                    Err(error) => {
                        view.conversations[index].error =
                            Some(format!("Could not close chat: {error:#}"))
                    }
                }
            },
        ));
    }

    fn finish_close_chat(&mut self, index: usize, replacement: Option<String>) {
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
        chat.submit_ready = false;
        chat.draft = None;
        chat.draft_task = None;
        chat.theme_task = None;
        chat.request_task = None;
        chat.completion = Default::default();
        chat.requests.clear();
        chat.request_inputs.clear();
        chat.transcript = Transcript::new();
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
            self.add_chat();
            self.conversations[self.selected].pane = replacement;
            self.create_chat(self.selected);
            if active_project != project {
                self.project = active_project;
                self.selected = active_selected;
            }
        }
        self.persist_workspace_preferences(None);
    }

    pub(crate) fn persist_workspace_preferences(&mut self, dock: Option<serde_json::Value>) {
        if self.preference_updates.is_none() {
            let (sender, mut updates) = tokio::sync::mpsc::unbounded_channel::<PreferenceSave>();
            self.preference_updates = Some(sender);
            let backend = self.backend.clone();
            let profile = self.profile.clone();
            self.preference_task = Some(crate::task::detached(async move {
                while let Some(selection) = updates.recv().await {
                    let result: anyhow::Result<()> = async {
                        let backend = backend
                            .get_or_try_init(|| Backend::connect(profile.clone()))
                            .await?;
                        backend
                            .request(
                                Method::POST,
                                "/api/client-storage",
                                Some(json!({"entries":selection.entries})),
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
                    }
                    .await;
                    if let Err(error) = result {
                        crate::task::update(move |view, _| {
                            view.status =
                                format!("Could not save workspace preferences: {error:#}");
                        });
                    }
                }
            }));
        }
        let project = self.projects[self.project].id.clone().unwrap_or_default();
        let pane = self.conversations[self.selected].pane.clone();
        let entries = json!({
            "commit-graph-columns-v14:repositories":serde_json::to_string(&self.repository_graph_preferences).unwrap_or_default(),
            "inferay-selected-project-id":project,
            "inferay-closed-project-tabs":serde_json::to_string(&self.closed_projects).unwrap_or_default(),
            "inferay-closed-repositories":serde_json::to_string(&self.closed_repositories).unwrap_or_default(),
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

    pub(crate) fn refresh_chat_title(&mut self, index: usize) {
        let (Some(backend), Some(pane)) = (
            self.backend.get().cloned(),
            self.conversations[index].pane.clone(),
        ) else {
            return;
        };
        self.conversations[index].metadata_task = Some(crate::task::spawn(
            async move {
                let workspace: AgentWorkspace = serde_json::from_value(
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
            },
            move |view: &mut Workspace, result, _| {
                if let Ok((pane, title)) = result {
                    let chat = &mut view.conversations[index];
                    if chat.pane.as_deref() == Some(&pane) && chat.title != title {
                        chat.title = title;
                    }
                }
            },
        ));
    }

    pub(crate) fn track_draft(&mut self, index: usize, save_initial: bool) {
        let chat = &mut self.conversations[index];
        if !chat.submit_ready {
            chat.input.submit_on_enter = true;
            chat.submit_ready = true;
        }
        if chat.draft.is_some() {
            return;
        }
        let Some(pane) = chat.pane.clone() else {
            chat.draft = Some(Draft::Unsaved);
            return;
        };
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let (drafts, mut pending) = tokio::sync::mpsc::unbounded_channel::<String>();
        let previous = chat.input.content().to_owned();
        if save_initial && !previous.is_empty() {
            let _ = drafts.send(previous.clone());
        }
        chat.draft = Some(Draft::Saving { drafts, previous });
        chat.draft_task = Some(crate::task::detached(async move {
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
                if let Err(error) = result {
                    let error = format!("Could not save draft: {error:#}");
                    crate::task::update(move |view, _| {
                        view.conversations[index].error = Some(error);
                    });
                }
            }
        }));
    }

    pub(crate) fn draft_changed(&mut self, index: usize) {
        self.track_completions(index);
        let chat = &mut self.conversations[index];
        let text = chat.input.content().to_owned();
        match &mut chat.draft {
            Some(Draft::Unsaved) if !text.is_empty() && !chat.loading => {
                self.create_chat(index);
            }
            Some(Draft::Unsaved) => {}
            Some(Draft::Saving { drafts, previous }) if text != *previous => {
                previous.clone_from(&text);
                let _ = drafts.send(text);
            }
            Some(Draft::Saving { .. }) => {}
            None => {}
        }
    }

    pub(crate) fn create_chat(&mut self, index: usize) {
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let project = self.projects[self.conversations[index].project].id.clone();
        let config = self.conversations[index].config.clone();
        let existing = self.conversations[index].pane.clone();
        self.conversations[index].loading = true;
        self.conversations[index].task = Some(crate::task::spawn(
            async move {
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
                    let workspace: AgentWorkspace =
                        serde_json::from_value(response["state"].clone())?;
                    workspace
                        .selected_pane_id()
                        .ok_or_else(|| {
                            anyhow::anyhow!("New chat was not returned by Inferay services")
                        })?
                        .to_owned()
                };
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
            },
            move |view: &mut Workspace, result, tx| {
                let chat = &mut view.conversations[index];
                chat.loading = false;
                match result {
                    Ok((pane, error)) => {
                        chat.pane = Some(pane);
                        chat.draft = None;
                        chat.error = error;
                        chat.loaded = true;
                        tx.scroll_to_bottom(super::conversation::transcript_key(index));
                        view.track_draft(index, true);
                        view.connect_chat(index);
                    }
                    Err(error) => chat.error = Some(format!("Could not save new chat: {error:#}")),
                }
            },
        ));
    }
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
