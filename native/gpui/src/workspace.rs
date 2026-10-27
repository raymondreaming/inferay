use crate::zoom::ui;
mod attachments;
mod completions;
mod lifecycle;
mod live;
mod proposals;
mod settings;
use crate::transcript::PreparedTranscript;
use crate::{Back, Settings, ToggleSidebar, button, colors, icon, input::TextInput};
use gpui::{prelude::*, *};
#[cfg(test)]
use inferay_core::chat_protocol::ChatTranscriptMessage;
use inferay_core::chat_status::ChatRunStatus;
use std::collections::HashSet;

#[derive(Clone, Copy, PartialEq)]
enum Appearance {
    Dark,
    Glass,
    Scene,
}
impl Appearance {
    fn composer_background(self) -> Rgba {
        match self {
            Self::Dark => rgba(0x2f2f2fff),
            _ => rgba(0x181818e0),
        }
    }
}
struct Project {
    id: Option<String>,
    name: String,
    repositories: Vec<(String, String)>,
    selected_repository: Option<String>,
    selected: usize,
    dock: serde_json::Value,
    dock_workspace: Option<(String, String)>,
}
struct Conversation {
    closed: bool,
    close_task: Option<Task<()>>,
    images: Vec<std::path::PathBuf>,
    project: usize,
    pane: Option<String>,
    loading: bool,
    error: Option<String>,
    task: Option<Task<()>>,
    live_task: Option<Task<()>>,
    metadata_task: Option<Task<()>>,
    commands: Option<tokio::sync::mpsc::Sender<live::Command>>,
    command_task: Option<Task<()>>,
    sending: bool,
    run: ChatRunStatus,
    queue: Vec<serde_json::Value>,
    requests: Vec<serde_json::Value>,
    request_inputs: std::collections::HashMap<String, Entity<TextInput>>,
    request_task: Option<Task<()>>,
    queue_task: Option<Task<()>>,
    queue_editor: Option<(String, Entity<TextInput>)>,
    queue_submit: Option<Subscription>,
    connection_error: Option<String>,
    submit_subscription: Option<Subscription>,
    completion: completions::State,
    draft_subscription: Option<Subscription>,
    draft_task: Option<Task<()>>,
    title: String,
    input: Entity<TextInput>,
    transcript: crate::transcript::Transcript,
    theme_task: Option<Task<()>>,
    loaded: bool,
    config: inferay_core::provider_config::ProviderSettings,
}
impl Conversation {
    fn new(
        project: usize,
        input: Entity<TextInput>,
        config: inferay_core::provider_config::ProviderSettings,
    ) -> Self {
        Self {
            project,
            input,
            config,
            closed: false,
            close_task: None,
            images: vec![],
            pane: None,
            loading: false,
            error: None,
            task: None,
            live_task: None,
            metadata_task: None,
            commands: None,
            command_task: None,
            sending: false,
            run: ChatRunStatus::default(),
            queue: vec![],
            requests: vec![],
            request_inputs: Default::default(),
            request_task: None,
            queue_task: None,
            queue_editor: None,
            queue_submit: None,
            connection_error: None,
            submit_subscription: None,
            completion: Default::default(),
            draft_subscription: None,
            draft_task: None,
            title: "New chat".into(),
            transcript: crate::transcript::Transcript::new(),
            theme_task: None,
            loaded: false,
        }
    }
}
pub struct WorkspaceView {
    backend: std::sync::Arc<tokio::sync::OnceCell<std::sync::Arc<crate::backend::Backend>>>,
    default_config: inferay_core::provider_config::ProviderSettings,
    focus: FocusHandle,
    projects: Vec<Project>,
    closed_projects: HashSet<String>,
    project_picker: bool,
    profile: std::path::PathBuf,
    load_task: Option<Task<()>>,
    startup_window: Option<AnyWindowHandle>,
    restored: bool,
    update_task: Option<Task<()>>,
    update_available: bool,
    preference_updates: Option<tokio::sync::mpsc::UnboundedSender<lifecycle::PreferenceSave>>,
    preference_task: Option<Task<()>>,
    conversations: Vec<Conversation>,
    selected: usize,
    project: usize,
    sidebar: bool,
    sidebar_width: f32,
    zoom: crate::zoom::Zoom,
    sidebar_resize: Option<(Pixels, f32)>,
    repositories_collapsed: bool,
    chat_width: f32,
    dock_resize: Option<(Vec<&'static str>, Bounds<Pixels>, bool, serde_json::Value)>,
    repository: bool,
    repository_expanded: bool,
    repository_width: f32,
    repository_resize: Option<(Pixels, f32)>,
    repository_subscription: Option<Subscription>,
    repository_edit_task: Option<Task<()>>,
    repository_stats_task: Option<Task<()>>,
    repository_stats: std::collections::HashMap<String, inferay_core::repository::GitChangeSummary>,
    font: &'static str,
    syntax_theme: String,
    graph_preferences: serde_json::Value,
    glass_opacity: f32,
    repository_view: Option<Entity<crate::repository::RepositoryView>>,
    repository_views: std::collections::HashMap<String, Entity<crate::repository::RepositoryView>>,
    settings: bool,
    settings_focus: Option<FocusHandle>,
    settings_state: settings::State,
    appearance: Appearance,
    scene: Option<std::sync::Arc<RenderImage>>,
    scene_task: Option<Task<()>>,
    scene_dim: f32,
    menu: Option<(usize, &'static str)>,
    expanded: HashSet<String>,
    proposals: std::collections::HashMap<String, proposals::State>,
    status: String,
}
impl WorkspaceView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(TextInput::new);
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        let mut view = Self::empty(focus, input, cx);
        view.startup_window = Some(window.window_handle());
        let profile = view.profile.clone();
        let backend = view.backend.clone();
        let work = cx.background_executor().spawn(async move {
            // Saved work is visible immediately; connecting services must not gate restoration.
            if profile.join("agent-state.json").is_file() {
                return crate::session::load(&profile);
            }
            crate::backend::RUNTIME.block_on(async {
                let backend = backend
                    .get_or_try_init(|| crate::backend::Backend::connect(profile.clone()))
                    .await?;
                backend
                    .request(
                        reqwest::Method::POST,
                        "/api/agent/state/initialize",
                        Some(serde_json::json!({})),
                    )
                    .await?;
                crate::session::load(&profile)
            })
        });
        view.load_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| {
                view.restored = true;
                match result {
                    Ok(session) => view.restore(session, cx),
                    Err(error) => view.status = format!("Could not load Inferay: {error:#}"),
                }
                view.reveal_startup(cx);
                cx.notify();
            });
        }));
        if std::env::var_os("INFERAY_EXTERNAL_BACKEND_ADDR").is_none() {
            let backend = view.backend.clone();
            let profile = view.profile.clone();
            view.update_task = Some(cx.spawn(async move |this, cx| {
                loop {
                    let backend = backend.clone();
                    let profile = profile.clone();
                    let result = cx
                        .background_executor()
                        .spawn(async move {
                            crate::backend::RUNTIME.block_on(async {
                                backend
                                    .get_or_try_init(|| crate::backend::Backend::connect(profile))
                                    .await?
                                    .request(reqwest::Method::GET, "/api/app-info", None)
                                    .await
                            })
                        })
                        .await;
                    if this
                        .update(cx, |view, cx| {
                            if let Ok(info) = result {
                                view.update_available = info["production"] == true
                                    && info["update"]["available"] == true;
                                cx.notify();
                            }
                        })
                        .is_err()
                    {
                        break;
                    }
                    cx.background_executor()
                        .timer(std::time::Duration::from_secs(900))
                        .await;
                }
            }));
        }
        view
    }
    fn reveal_startup(&mut self, cx: &mut Context<Self>) {
        if !self.restored || self.scene_task.is_some() {
            return;
        }
        let Some(handle) = self.startup_window.take() else {
            return;
        };
        cx.defer(move |cx| {
            let _ = handle.update(cx, |_, window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                window.activate_window();
                cx.activate(true);
            });
        });
    }
    fn empty(focus: FocusHandle, input: Entity<TextInput>, cx: &mut Context<Self>) -> Self {
        Self {
            backend: Default::default(),
            default_config: inferay_core::provider_config::resolve(&serde_json::json!({})),
            focus,
            projects: vec![Project {
                id: None,
                name: "Loading workspace…".into(),
                repositories: vec![],
                selected_repository: None,
                selected: 0,
                dock: serde_json::Value::Null,
                dock_workspace: None,
            }],
            closed_projects: Default::default(),
            project_picker: false,
            profile: crate::session::profile(),
            load_task: None,
            startup_window: None,
            restored: false,
            update_task: None,
            update_available: false,
            preference_updates: None,
            preference_task: None,
            conversations: vec![Conversation::new(
                0,
                input,
                inferay_core::provider_config::resolve(&serde_json::json!({})),
            )],
            selected: 0,
            project: 0,
            sidebar: true,
            sidebar_width: 212.,
            zoom: crate::zoom::Zoom::default(),
            sidebar_resize: None,
            repositories_collapsed: false,
            chat_width: 1000.,
            dock_resize: None,
            repository: false,
            repository_expanded: false,
            repository_width: 584.,
            repository_resize: None,
            repository_subscription: None,
            repository_edit_task: None,
            repository_stats_task: None,
            repository_stats: Default::default(),
            font: ".SystemUIFont",
            syntax_theme: "vscode-black".into(),
            graph_preferences: serde_json::Value::Null,
            glass_opacity: 0.75,
            repository_view: None,
            repository_views: Default::default(),
            settings: false,
            settings_focus: None,
            settings_state: settings::State::new(cx),
            appearance: Appearance::Dark,
            scene: None,
            scene_task: None,
            scene_dim: 0.,
            menu: None,
            expanded: HashSet::new(),
            proposals: Default::default(),
            status: "Loading your saved workspace…".into(),
        }
    }
    fn restore(&mut self, session: crate::session::Session, cx: &mut Context<Self>) {
        self.closed_projects = session.closed_projects;
        self.default_config = session.default_config;
        self.sidebar = !session.sidebar_collapsed;
        self.sidebar_width = session.sidebar_width;
        self.zoom = session.zoom;
        self.set_background(&session.background, cx);
        self.graph_preferences = session.graph_preferences;
        self.syntax_theme = session.syntax_theme;
        self.font = match session.font.as_str() {
            "geist" => "Geist",
            "menlo" => "Menlo",
            "inter" => "Inter",
            "manrope" => "Manrope",
            "ibm-plex-sans" => "IBM Plex Sans",
            _ => ".SystemUIFont",
        };
        self.projects.clear();
        self.conversations.clear();
        for (project, saved) in session.projects.into_iter().enumerate() {
            let first = self.conversations.len();
            let selected = saved
                .panes
                .iter()
                .position(|p| Some(&p.id) == session.selected_pane.as_ref())
                .map(|i| first + i)
                .unwrap_or(first);
            self.projects.push(Project {
                id: saved.id,
                name: saved.name,
                repositories: saved.repositories,
                selected_repository: None,
                dock: saved.dock,
                dock_workspace: saved.dock_workspace,
                selected,
            });
            for pane in saved.panes {
                let input = cx.new(TextInput::new);
                input.update(cx, |input, _| {
                    input.content = session
                        .drafts
                        .get(&pane.id)
                        .cloned()
                        .unwrap_or_default()
                        .into()
                });
                let config = session
                    .chat_settings
                    .get(&pane.id)
                    .cloned()
                    .unwrap_or_else(|| {
                        inferay_core::provider_config::resolve(
                            &serde_json::json!({"agentKind":pane.agent_kind,"defaults":self.default_config}),
                        )
                    });
                let mut chat = Conversation::new(project, input, config);
                chat.pane = Some(pane.id);
                chat.title = pane
                    .summary
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("{} chat", pane.agent_kind));
                self.conversations.push(chat);
            }
            if self.conversations.len() == first {
                self.conversations.push(Conversation::new(
                    project,
                    cx.new(TextInput::new),
                    self.default_config.clone(),
                ));
            }
        }
        self.status.clear();
        if let Some(index) = self
            .projects
            .iter()
            .position(|p| !self.closed_projects.contains(p.id.as_deref().unwrap_or("")))
        {
            let selected = if self.closed_projects.contains(
                self.projects[session.selected_project]
                    .id
                    .as_deref()
                    .unwrap_or(""),
            ) {
                index
            } else {
                session.selected_project
            };
            self.select_project(selected, cx);
        } else {
            self.project_picker = true;
        }
    }
    fn close_project_tab(&mut self, index: usize, cx: &mut Context<Self>) {
        self.closed_projects
            .insert(self.projects[index].id.clone().unwrap_or_default());
        if index == self.project {
            if let Some(next) = self
                .projects
                .iter()
                .position(|p| !self.closed_projects.contains(p.id.as_deref().unwrap_or("")))
            {
                self.select_project(next, cx);
            } else {
                self.project_picker = true;
                self.repository = false;
                self.repository_stats_task = None;
            }
        }
        self.persist_workspace_preferences(None, cx);
        cx.notify();
    }
    fn select_project(&mut self, index: usize, cx: &mut Context<Self>) {
        self.closed_projects
            .remove(self.projects[index].id.as_deref().unwrap_or(""));
        self.project_picker = false;
        self.project = index;
        self.selected = self.projects[index].selected;
        self.settings = false;
        self.menu = None;
        self.status.clear();
        self.repository_view = None;
        self.repository_subscription = None;
        if let Some(path) = self.projects[index]
            .selected_repository
            .clone()
            .or_else(|| {
                self.projects[index]
                    .repositories
                    .first()
                    .map(|(_, path)| path.clone())
            })
        {
            self.open_repository(path, cx);
        }
        self.refresh_repository_stats(cx);
        let indices: Vec<_> = self
            .conversations
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.closed && c.project == index)
            .map(|(i, _)| i)
            .collect();
        for i in indices {
            self.track_draft(i, false, cx);
            if !self.conversations[i].loaded && !self.conversations[i].loading {
                self.load_chat(i, 200, cx);
            }
        }
        cx.notify();
    }
    fn refresh_repository_stats(&mut self, cx: &mut Context<Self>) {
        let paths = self.projects[self.project]
            .repositories
            .iter()
            .map(|(_, path)| path.clone())
            .collect::<Vec<_>>();
        self.repository_stats_task = Some(cx.spawn(async move |this, cx| {
            loop {
                let paths = paths.clone();
                let stats = cx
                    .background_executor()
                    .spawn(async move {
                        paths
                            .into_iter()
                            .filter_map(|path| {
                                inferay_native_diff::get_git_status(&path)
                                    .map(|status| (path, status.change_summary()))
                            })
                            .collect()
                    })
                    .await;
                if this
                    .update(cx, |s, cx| {
                        if s.repository_stats != stats {
                            s.repository_stats = stats;
                            cx.notify();
                        }
                        // Branches and linked worktrees can change without changing file counts.
                        if s.repository
                            && !s.settings
                            && let Some(view) = &s.repository_view
                        {
                            view.update(cx, |view, cx| view.refresh(cx));
                        }
                    })
                    .is_err()
                {
                    break;
                }
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(5))
                    .await;
            }
        }));
    }
    fn edit_repository(&mut self, remove: Option<String>, cx: &mut Context<Self>) {
        self.edit_repository_location(remove, false, cx);
    }
    fn edit_repository_location(
        &mut self,
        remove: Option<String>,
        relink: bool,
        cx: &mut Context<Self>,
    ) {
        if self.repository_edit_task.is_some() {
            return;
        }
        let Some(project_id) = self.projects[self.project].id.clone() else {
            return;
        };
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        self.status.clear();
        if let Some(view) = &self.repository_view {
            view.update(cx, |view, cx| {
                view.membership_error = None;
                cx.notify();
            });
        }
        let selected = (remove.is_none() || relink).then(|| {
            cx.prompt_for_paths(PathPromptOptions {
                files: false,
                directories: true,
                multiple: false,
                prompt: Some(
                    if relink {
                        "Locate moved repository folder"
                    } else {
                        "Add repository to workspace"
                    }
                    .into(),
                ),
            })
        });
        self.repository_edit_task = Some(cx.spawn(async move |this, cx| {
            let result = async {
                let path = if let Some(selected) = selected {
                    let paths = selected.await??;
                    let Some(path) = paths.and_then(|paths| paths.into_iter().next()) else { return Ok(None); };
                    path.to_string_lossy().into_owned()
                } else {
                    remove.clone().unwrap()
                };
                let removing = remove.is_some() && !relink;
                let id = project_id.clone();
                cx.background_executor().spawn(async move {
                    crate::backend::RUNTIME.block_on(async {
                        let path = if removing { path } else { std::path::Path::new(&path).canonicalize()?.to_string_lossy().into_owned() };

                        let endpoint = format!("/api/projects?projectId={id}");
                        let workspace: inferay_core::project_files::ProjectWorkspace = serde_json::from_value(backend.request(reqwest::Method::GET, &endpoint, None).await?)?;
                        let project = workspace.catalog.projects.iter().find(|p| p.id == id).ok_or_else(|| anyhow::anyhow!("Project no longer exists"))?;
                        let change = if removing || relink {
                            let repository = project.definition.as_ref().and_then(|definition| definition.repositories.iter().find(|repo| workspace.catalog.repository_paths.get(&repo.id) == remove.as_ref()))
                                .ok_or_else(|| anyhow::anyhow!("Repository is no longer linked to this project"))?;
                            if relink {
                                serde_json::json!({"kind":"relink", "id":repository.id, "path":path})
                            } else {
                                serde_json::json!({"kind":"remove", "id":repository.id})
                            }
                        } else {
                            serde_json::json!({"kind":"add", "path":path})
                        };
                        backend.request(reqwest::Method::POST, "/api/projects/command", Some(serde_json::json!({"type":"editRepository", "projectId":id, "expectedHash":project.source_hash, "change":change}))).await?;
                        let workspace: inferay_core::project_files::ProjectWorkspace = serde_json::from_value(backend.request(reqwest::Method::GET, &endpoint, None).await?)?;
                        let definition = workspace.catalog.projects.iter().find(|p| p.id == id).and_then(|p| p.definition.as_ref()).ok_or_else(|| anyhow::anyhow!("Project no longer exists"))?;
                        let repositories = definition.repositories.iter().filter_map(|repo| workspace.catalog.repository_paths.get(&repo.id).map(|path| (repo.name.clone(), path.clone()))).collect::<Vec<_>>();
                        Ok::<_, anyhow::Error>(Some((repositories, (!removing).then_some(path))))
                    })
                }).await
            }.await;
            let _ = this.update(cx, |s, cx| {
                s.repository_edit_task = None;
                match result {
                    Ok(Some((repositories, path))) => {
                        if let Some(project) = s.projects.iter_mut().find(|p| p.id.as_ref() == Some(&project_id)) {
                            project.repositories = repositories;
                            project.selected_repository = path.or_else(|| project.selected_repository.take().filter(|selected| project.repositories.iter().any(|(_, path)| path == selected)))
                                .or_else(|| project.repositories.first().map(|(_, path)| path.clone()));
                        }
                        s.repository_views.retain(|path, _| s.projects.iter().any(|project| project.repositories.iter().any(|(_, linked)| linked == path)));
                        if s.projects[s.project].id.as_ref() == Some(&project_id) {
                            if let Some(path) = s.projects[s.project].selected_repository.clone() {
                                s.open_repository(path, cx);
                            } else {
                                s.repository_view = None;
                                s.repository_subscription = None;
                                s.repository = false;
                            }
                            s.refresh_repository_stats(cx);
                        }
                    }
                    Ok(None) => (),
                    Err(error) => {
                        s.status = format!("Could not update repositories: {error}");
                        if s.projects[s.project].id.as_ref() == Some(&project_id)
                            && let Some(view) = &s.repository_view
                        {
                            view.update(cx, |view, cx| { view.membership_error = Some(s.status.clone()); cx.notify(); });
                        }
                    },
                }
                cx.notify();
            });
        }));
    }
    fn open_repository(&mut self, path: String, cx: &mut Context<Self>) {
        self.projects[self.project].selected_repository = Some(path.clone());
        let view = if let Some(view) = self.repository_views.get(&path) {
            let view = view.clone();
            view.update(cx, |view, cx| view.refresh(cx));
            view
        } else {
            let view = cx.new(|cx| {
                crate::repository::RepositoryView::new(
                    path.clone(),
                    self.graph_preferences.clone(),
                    self.syntax_theme.clone(),
                    if self.appearance == Appearance::Glass {
                        0x0d0d0d
                    } else {
                        colors::CANVAS
                    },
                    cx,
                )
            });
            self.repository_views.insert(path, view.clone());
            view
        };
        view.update(cx, |view, _| {
            view.repositories = self.projects[self.project].repositories.clone();
            self.repository_expanded = view.expanded;
        });
        self.repository_subscription = Some(cx.subscribe(
            &view,
            |s, _, event: &crate::repository::RepositoryEvent, cx| {
                match event {
                    crate::repository::RepositoryEvent::Expand => {
                        s.repository_expanded = !s.repository_expanded
                    }
                    crate::repository::RepositoryEvent::Select(path) => {
                        s.open_repository(path.clone(), cx)
                    }
                    crate::repository::RepositoryEvent::Add => s.edit_repository(None, cx),
                    crate::repository::RepositoryEvent::Relink(path) => {
                        s.edit_repository_location(Some(path.clone()), true, cx)
                    }
                    crate::repository::RepositoryEvent::Remove(path) => {
                        s.edit_repository(Some(path.clone()), cx)
                    }
                }
                cx.notify();
            },
        ));
        self.repository_view = Some(view);
    }
    fn load_transcript(&mut self, limit: usize, cx: &mut Context<Self>) {
        self.load_chat(self.selected, limit, cx);
    }
    fn load_chat(&mut self, index: usize, limit: usize, cx: &mut Context<Self>) {
        let chat = &mut self.conversations[index];
        let Some(pane) = chat.pane.clone() else {
            return;
        };
        chat.live_task = None;
        chat.loading = true;
        chat.error = None;
        let profile = self.profile.clone();
        let theme = self.syntax_theme.clone();
        let work = cx.background_executor().spawn(async move {
            crate::session::transcript(&profile, &pane, limit).map(|(total, messages)| {
                (
                    total,
                    PreparedTranscript::prepare(
                        0,
                        messages.into_iter().map(std::sync::Arc::new),
                        &theme,
                    ),
                )
            })
        });
        chat.task = Some(cx.spawn(async move |this, cx| {
            let result = match work.await {
                Ok((total, prepared)) => Self::prepare_for_current_theme(&this, prepared, cx)
                    .await
                    .map(|prepared| (total, prepared)),
                Err(error) => Err(error),
            };
            let _ = this.update(cx, |view, cx| {
                let chat = &mut view.conversations[index];
                chat.loading = false;
                match result {
                    Ok((total, prepared)) => {
                        chat.loaded = true;
                        chat.transcript.publish(prepared, Some(total));
                        view.connect_chat(index, cx);
                    }
                    Err(error) => chat.error = Some(format!("Could not load chat: {error:#}")),
                }
                cx.notify();
            });
        }));
    }
    // Revalidate after background work: a theme change must not publish stale styles.
    async fn prepare_for_current_theme(
        this: &WeakEntity<Self>,
        mut prepared: PreparedTranscript,
        cx: &mut AsyncApp,
    ) -> anyhow::Result<PreparedTranscript> {
        loop {
            let theme = this.read_with(cx, |view, _| view.syntax_theme.clone())?;
            if theme == prepared.theme {
                return Ok(prepared);
            }
            prepared = cx
                .background_executor()
                .spawn(async move { prepared.retheme(&theme) })
                .await;
        }
    }

    fn refresh_chat_theme(&mut self, index: usize, cx: &mut Context<Self>) {
        let chat = &mut self.conversations[index];
        if chat.closed {
            return;
        }
        let snapshot = chat.transcript.snapshot();
        let theme = self.syntax_theme.clone();
        let work = cx
            .background_executor()
            .spawn(async move { snapshot.retheme(&theme) });
        chat.theme_task = Some(cx.spawn(async move |this, cx| {
            let prepared = work.await;
            let _ = this.update(cx, |view, cx| {
                if view.syntax_theme != prepared.theme || view.conversations[index].closed {
                    return;
                }
                view.conversations[index].transcript.publish_theme(prepared);
                cx.notify();
            });
        }));
    }

    fn set_zoom(&mut self, zoom: crate::zoom::Zoom, window: &mut Window, cx: &mut Context<Self>) {
        if self.zoom == zoom {
            return;
        }
        self.zoom = zoom;
        zoom.apply(window);
        for chat in &self.conversations {
            chat.transcript.scroll.remeasure();
        }
        self.persist_workspace_preferences(None, cx);
        window.refresh();
        cx.notify();
    }

    fn new_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.select_project(self.project, cx);
        self.add_chat(cx);
        self.create_chat(self.selected, cx);
        window.focus(
            &self.conversations[self.selected].input.focus_handle(cx),
            cx,
        );
    }
    fn add_chat(&mut self, cx: &mut Context<Self>) {
        let input = cx.new(TextInput::new);
        self.conversations.push(Conversation::new(
            self.project,
            input,
            self.default_config.clone(),
        ));
        self.selected = self.conversations.len() - 1;
        self.projects[self.project].selected = self.selected;
        self.settings = false;
        cx.notify();
    }
    fn titlebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        crate::titlebar_surface()
            .debug_selector(|| "workspace-titlebar".into())
            .pr(ui(8.))
            .gap(ui(4.))
            .child(
                button("sidebar", "")
                    .debug_selector(|| "sidebar-toggle".into())
                    .aria_label("Toggle sidebar")
                    .child(icon("PanelLeft"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.sidebar = !s.sidebar;
                        s.persist_workspace_preferences(None, cx);
                        cx.notify();
                    })),
            )
            .child(
                button("open-workspaces", "Workspaces").on_click(cx.listener(|s, _, _, cx| {
                    s.project_picker = !s.project_picker;
                    cx.notify();
                })),
            )
            .child(
                button("new", "New")
                    .child(icon("Plus"))
                    .on_click(cx.listener(|s, _, w, cx| s.new_chat(w, cx))),
            )
            .child(
                div()
                    .id("project-tabs")
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .overflow_x_scroll()
                    .children(
                        self.projects
                            .iter()
                            .enumerate()
                            .filter(|(_, p)| {
                                !self.closed_projects.contains(p.id.as_deref().unwrap_or(""))
                            })
                            .map(|(i, project)| {
                                let name = project.name.clone();
                                div()
                                    .id(("project", i))
                                    .role(Role::Tab)
                                    .aria_selected(self.project == i)
                                    .aria_label(name.clone())
                                    .h(ui(30.))
                                    .flex_shrink_0()
                                    .px(ui(12.))
                                    .flex()
                                    .items_center()
                                    .gap(ui(7.))
                                    .rounded(ui(7.))
                                    .text_size(ui(colors::CHAT_SMALL))
                                    .font_weight(FontWeight::MEDIUM)
                                    .cursor_pointer()
                                    .when(self.project == i, |d| d.bg(rgba(0xebebeb17)))
                                    .hover(|s| s.bg(rgba(0xebebeb10)))
                                    .child(icon("Folder"))
                                    .child(name.clone())
                                    .child(
                                        button(("close-project", i), "")
                                            .aria_label(format!("Close {name} workspace tab"))
                                            .debug_selector(move || format!("close-project-{i}"))
                                            .child(icon("X").size(ui(12.)))
                                            .on_click(cx.listener(move |s, _, _, cx| {
                                                cx.stop_propagation();
                                                s.close_project_tab(i, cx);
                                            })),
                                    )
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        s.select_project(i, cx);
                                        s.persist_workspace_preferences(None, cx);
                                    }))
                            }),
                    )
                    .child(div().flex_1().h_full().min_w(ui(16.)).on_mouse_down(
                        MouseButton::Left,
                        |event, window, _| {
                            if event.click_count == 2 {
                                window.titlebar_double_click();
                            } else {
                                window.start_window_move();
                            }
                        },
                    )),
            )
            .child(
                button("repository", "")
                    .aria_label("Toggle repository panel")
                    .child(icon("CommitGraph"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.repository = !s.repository;
                        cx.notify();
                    })),
            )
    }
    fn sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div().id("sidebar").relative().w(ui(self.sidebar_width)).h_full().flex_shrink_0().flex().flex_col().overflow_y_scroll().px(ui(8.)).pt(ui(8.))
            .children([("Bookmark", "Memory"), ("Sparkles", "Plugins"), ("Workflow", "Automations")].into_iter().map(|(glyph, name)| {
                button(name, "").aria_label(name).h(ui(32.)).gap(ui(10.)).text_size(ui(colors::CHAT_SMALL)).child(icon(glyph)).child(name)
                    .on_click(cx.listener(move |s, _, _, cx| { s.status = format!("{name} is available in the current Inferay app. This preview covers the workspace and appearance."); cx.notify(); }))
            }))
            .child(button("repositories-toggle", "").h(ui(32.)).gap(ui(10.)).text_size(ui(colors::CHAT_SMALL)).text_color(rgba(0xebebeb80)).child(icon("GitBranch")).child("Repositories").child(div().flex_1()).child(icon(if self.repositories_collapsed { "ChevronRight" } else { "ChevronDown" }))
                .on_click(cx.listener(|s, _, _, cx| { s.repositories_collapsed = !s.repositories_collapsed; cx.notify(); })))
            .children(self.projects[self.project].repositories.iter().enumerate().filter(|_| !self.repositories_collapsed).map(|(i, (name, path))| {
                let selected_path = path.clone();
                let removed_path = path.clone();
                div().flex().items_center()
                .child(button(("repo", i), "").aria_label(format!("{name}: {path}")).flex_1().min_w_0().pl(ui(26.)).text_size(ui(colors::CHAT_SMALL)).child(icon("GitBranch")).child(div().flex_1().min_w_0()
                    .child(div().text_ellipsis().child(name.clone()))
                    .child(div().text_size(ui(10.)).text_color(rgba(0xebebeb80)).text_ellipsis().child(path.clone())))
                    .when_some(self.repository_stats.get(path), |d, stats| d
                        .child(div().text_size(ui(11.)).text_color(rgb(0x4fbd83)).child(format!("+{}", stats.additions)))
                        .child(div().text_size(ui(11.)).text_color(rgb(0xdf6464)).child(format!("−{}", stats.deletions))))
                    .on_click(cx.listener(move |s, _, _, cx| { s.repository = true; s.open_repository(selected_path.clone(), cx); cx.notify(); })))
                .child(button(("remove-repository", i), "").aria_label(format!("Remove {name} from project: {path}. Files stay on disk."))
                    .debug_selector(move || format!("remove-repository-{i}"))
                    .child(icon("X").size(ui(12.)))
                    .on_click(cx.listener(move |s, _, _, cx| { cx.stop_propagation(); s.edit_repository(Some(removed_path.clone()), cx); })))
            }))
            .child(button("add-sidebar-repository", "Add repository…").child(icon("Plus"))
                .on_click(cx.listener(|s, _, _, cx| s.edit_repository(None, cx))))
            .child(div().h(ui(1.)).bg(rgba(0xebebeb0f)).my(ui(14.)))
            .child(div().flex().items_center().justify_between().px(ui(9.)).mb(ui(10.)).text_color(rgba(0xebebeb80)).text_size(ui(colors::CHAT_SMALL)).child("Chats")
                .child(button("new-chat", "New chat").child(icon("Plus")).on_click(cx.listener(|s, _, w, cx| s.new_chat(w, cx)))))
            .children(self.conversations.iter().enumerate().filter(|(_, chat)| !chat.closed && chat.project == self.project).map(|(i, chat)| {
                div().id(("chat", i)).role(Role::Button).aria_label(chat.title.clone()).flex().items_center().gap(ui(8.)).px(ui(9.)).h(ui(36.)).mb(ui(3.)).rounded(ui(6.))
                    .border_1().border_color(if i == self.selected { rgba(0xebebeb0f) } else { rgba(0) })
                    .when(i == self.selected, |d| d.bg(rgba(0xebebeb17))).hover(|s| s.bg(rgba(0xebebeb0d))).cursor_pointer()
                    .child(icon("codex")).child(div().flex_1().min_w_0().text_size(ui(colors::CHAT_SMALL)).overflow_hidden().text_ellipsis().child(chat.title.clone()))
                    .child(button(("close-chat", i), "").aria_label("Close chat and stop agent").debug_selector(|| "close-chat".into())
                        .child(icon("X").size(ui(12.)))
                        .on_click(cx.listener(move |s, _, _, cx| { cx.stop_propagation(); s.close_chat(i, cx); })))
                    .on_click(cx.listener(move |s, _, _, cx| { s.selected = i; s.projects[s.project].selected = i; s.persist_workspace_preferences(None, cx); s.settings = false; if !s.conversations[i].loaded && !s.conversations[i].loading { s.load_transcript(200, cx); } cx.notify(); }))
            }))
            .child(div().flex_1())
            .child(button("settings", "").child(icon("Settings")).child("Settings").on_click(cx.listener(|s, _, window, cx| s.set_settings(true, window, cx))))
            .when(self.update_available, |d| d.child(button("update-available", "Update available").on_click(cx.listener(|s, _, window, cx| {
                s.set_settings(true, window, cx);
                s.settings_page("about", cx);
            }))))
            .child(div().id("sidebar-resize").absolute().right(ui(-2.)).top_0().w(ui(5.)).h_full().cursor_col_resize().on_mouse_down(MouseButton::Left, cx.listener(|s, e: &MouseDownEvent, _, cx| { s.sidebar_resize = Some((e.position.x, s.sidebar_width)); cx.stop_propagation(); })))
    }
    fn transcript(&self, index: usize, cx: &mut Context<Self>) -> impl IntoElement {
        let chat = &self.conversations[index];
        div()
            .id(("transcript", index))
            .relative()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .px(ui(0.))
            .pt(ui(8.))
            .pb(ui(8.))
            .child(
                div()
                    .w_full()
                    .max_w(ui(624.))
                    .px(ui(12.))
                    .mx_auto()
                    .when(chat.loading && !chat.loaded, |d| {
                        d.child(div().child("Loading saved messages…"))
                    })
                    .when_some(
                        chat.error.clone().or_else(|| chat.connection_error.clone()),
                        |d, error| d.child(div().child(error)),
                    )
                    .when(
                        chat.transcript.total() > chat.transcript.rows().len(),
                        |d| {
                            d.child(
                                button(("older-messages", index), "Load older messages").on_click(
                                    cx.listener(move |s, _, _, cx| {
                                        let limit =
                                            s.conversations[index].transcript.rows().len() + 200;
                                        s.load_chat(index, limit, cx);
                                        cx.notify();
                                    }),
                                ),
                            )
                        },
                    )
                    .when(
                        chat.transcript.rows().is_empty() && !chat.loading && chat.error.is_none(),
                        |d| {
                            d.child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .justify_center()
                                    .items_center()
                                    .h(ui(300.))
                                    .gap(ui(12.))
                                    .child(icon("codex").size(ui(28.)))
                                    .child(
                                        div()
                                            .text_size(ui(18.))
                                            .child("What would you like to work on?"),
                                    )
                                    .child(
                                        div()
                                            .text_size(ui(colors::CHAT_SMALL))
                                            .text_color(rgba(0xebebeb80))
                                            .child("Start a conversation below."),
                                    ),
                            )
                        },
                    ),
            )
            .child(
                list(
                    chat.transcript.scroll.clone(),
                    cx.processor(move |view, row, _, cx| view.transcript_row(index, row, cx)),
                )
                .flex_1()
                .min_h_0()
                .w_full(),
            )
            .when(
                !chat.transcript.rows().is_empty() && !chat.transcript.scroll.is_following_tail(),
                |d| {
                    d.child(
                        button(("latest-message", index), "")
                            .debug_selector(|| "latest-message".into())
                            .aria_label("Scroll to latest message")
                            .absolute()
                            .right(ui(8.))
                            .bottom(ui(8.))
                            .w(ui(24.))
                            .h(ui(24.))
                            .px(ui(5.))
                            .rounded_full()
                            .border_1()
                            .border_color(rgba(0xebebeb26))
                            .bg(rgb(0x202020))
                            .child(icon("ChevronDown").size(ui(12.)))
                            .on_click(cx.listener(move |view, _, _, cx| {
                                view.conversations[index]
                                    .transcript
                                    .scroll
                                    .set_follow_mode(FollowMode::Tail);
                                cx.notify();
                            })),
                    )
                },
            )
    }
    fn transcript_row(
        &self,
        index: usize,
        message_index: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let chat = &self.conversations[index];
        let row = &chat.transcript.rows()[message_index];
        let message = &row.message;
        if message.render.as_ref().is_some_and(|r| r.hidden) {
            return div().h(ui(0.)).into_any_element();
        }
        let last_visible = chat.transcript.last_visible() == Some(message_index);
        let id = message.id.clone();
        let row = if message.role == "tool" {
            let open = self.expanded.contains(&id);
            let render = message.render.as_ref();
            let display = render.and_then(|r| r.display.as_ref());
            let label = display.map(|d| d.label.clone()).unwrap_or_else(|| {
                inferay_core::tool_presentation::display(
                    message.tool_name.as_deref(),
                    &serde_json::Value::Null,
                )
                .label
            });
            div()
                .relative()
                .w_full()
                .max_w(ui(544.))
                .mx_auto()
                .pl(ui(12.))
                .pb(ui(if last_visible { 0. } else { 4. }))
                .when(
                    render.is_some_and(|r| {
                        matches!(
                            r.kind,
                            inferay_core::chat_protocol::ChatRenderKind::ToolGroup
                        ) && !r.group_leader
                    }),
                    |d| {
                        d.child(
                            div()
                                .debug_selector({
                                    let id = id.clone();
                                    move || format!("tool-line-before-{id}")
                                })
                                .absolute()
                                .left_0()
                                .top_0()
                                .w(ui(1.))
                                .h(ui(12.))
                                .bg(rgba(0xebebeb24)),
                        )
                    },
                )
                .when(render.is_some_and(|r| r.continues_after), |d| {
                    d.child(
                        div()
                            .debug_selector({
                                let id = id.clone();
                                move || format!("tool-line-after-{id}")
                            })
                            .absolute()
                            .left_0()
                            .top(ui(12.))
                            .bottom_0()
                            .w(ui(1.))
                            .bg(rgba(0xebebeb24)),
                    )
                })
                .child(
                    div()
                        .debug_selector({
                            let id = id.clone();
                            move || format!("tool-dot-{id}")
                        })
                        .absolute()
                        .left(ui(-2.5))
                        .top(ui(9.))
                        .size(ui(6.))
                        .rounded_full()
                        .bg(rgb(0x202020))
                        .border_1()
                        .border_color(rgba(0xebebeb40))
                        .when(message.is_streaming == Some(true), |dot| {
                            dot.child(
                                div()
                                    .absolute()
                                    .inset_0()
                                    .rounded_full()
                                    .bg(rgb(0x8ab4f8))
                                    .with_animation(
                                        SharedString::from(format!("tool-active-{id}")),
                                        Animation::new(std::time::Duration::from_millis(1200))
                                            .repeat(),
                                        |dot, phase| {
                                            dot.opacity(
                                                0.45 + 0.55 * (phase * std::f32::consts::PI).sin(),
                                            )
                                        },
                                    ),
                            )
                        }),
                )
                .child(
                    div()
                        .id(SharedString::from(id.clone()))
                        .debug_selector(|| "tool-timeline-row".into())
                        .role(Role::Button)
                        .aria_label(label.clone())
                        .flex()
                        .items_center()
                        .gap(ui(6.))
                        .min_h(ui(24.))
                        .px(ui(4.))
                        .cursor_pointer()
                        .text_size(ui(colors::CHAT_SMALL))
                        .text_color(rgba(0xebebebb8))
                        .when_some(
                            display.and_then(|display| display.source.as_ref()),
                            |d, source| {
                                d.child(
                                    div()
                                        .debug_selector(|| "tool-source".into())
                                        .flex_shrink_0()
                                        .text_size(ui(colors::CHAT_DETAIL))
                                        .text_color(rgb(0x8ab4f8))
                                        .child(source.server_label.clone()),
                                )
                            },
                        )
                        .child(
                            div()
                                .min_w_0()
                                .text_ellipsis()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(label),
                        )
                        .when_some(display.and_then(|d| d.detail.clone()), |d, detail| {
                            d.child(
                                div()
                                    .text_color(rgba(0xebebeb70))
                                    .max_w(relative(0.42))
                                    .font_family("Menlo")
                                    .text_size(ui(colors::CHAT_DETAIL))
                                    .text_ellipsis()
                                    .child(detail.split_whitespace().collect::<Vec<_>>().join(" ")),
                            )
                        })
                        .child(div().flex_1())
                        .child(
                            icon(if open { "ChevronDown" } else { "ChevronRight" }).size(ui(12.)),
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            if !s.expanded.remove(&id) {
                                s.expanded.insert(id.clone());
                            }
                            s.conversations[index]
                                .transcript
                                .scroll
                                .remeasure_items(message_index..message_index + 1);
                            cx.notify();
                        })),
                )
                .when(open, |d| {
                    d.child(
                        div()
                            .ml(ui(4.))
                            .py(ui(2.))
                            .child(row.rich.render(&message.id)),
                    )
                })
                .into_any_element()
        } else if let Some(command) = message
            .render
            .as_ref()
            .and_then(|r| r.automation_definition_proposal.as_deref())
        {
            self.automation_proposal_card(&message.id, command, cx)
        } else if let Some(card) = message
            .render
            .as_ref()
            .and_then(crate::rich_text::system_card)
        {
            card
        } else if message.role == "system" {
            div()
                .mt(ui(4.))
                .mb(ui(if last_visible { 0. } else { 4. }))
                .text_size(ui(colors::CHAT_SMALL))
                .text_color(rgba(0xebebeb80))
                .child(row.rich.render(&message.id))
                .into_any_element()
        } else if message.role == "user" {
            let images = message.images.as_deref().unwrap_or_default();
            let has_images = !images.is_empty();
            div()
                .flex()
                .justify_end()
                .mb(ui(if last_visible { 0. } else { 8. }))
                .child(
                    div()
                        .debug_selector({
                            let id = message.id.clone();
                            move || format!("user-bubble-{id}")
                        })
                        .max_w(relative(0.85))
                        .when(has_images, |d| {
                            d.flex()
                                .flex_col()
                                .items_end()
                                .w_full()
                                .min_w_0()
                                .gap(ui(8.))
                        })
                        .px(ui(10.))
                        .py(ui(6.))
                        .rounded(ui(8.))
                        .rounded_br(ui(2.))
                        .when(has_images, |d| {
                            d.child(
                                div()
                                    .debug_selector({
                                        let id = message.id.clone();
                                        move || format!("user-images-{id}")
                                    })
                                    .w_full()
                                    .min_w_0()
                                    .flex()
                                    .flex_wrap()
                                    .justify_end()
                                    .items_start()
                                    .gap(ui(4.))
                                    .flex_shrink_0()
                                    .children(images.iter().enumerate().map(|(i, path)| {
                                        attachments::photo(
                                            path.into(),
                                            format!("sent-photo-{}-{i}", message.id),
                                            false,
                                        )
                                    })),
                            )
                        })
                        .when(!message.content.is_empty(), |d| {
                            d.child(
                                div()
                                    .debug_selector({
                                        let id = message.id.clone();
                                        move || format!("user-message-text-{id}")
                                    })
                                    .when(has_images, |d| d.w_full().min_w_0().flex_shrink_0())
                                    .child(row.rich.render(&message.id)),
                            )
                        }),
                )
                .into_any_element()
        } else {
            let content = message.clone();
            div()
                .mb(ui(if last_visible { 0. } else { 8. }))
                .child(
                    div()
                        .line_height(ui(colors::CHAT_BODY * 1.6))
                        .text_color(rgba(0xebebebb8))
                        .child(row.rich.render(&message.id)),
                )
                .when(
                    message.is_streaming != Some(true) && !content.content.trim().is_empty(),
                    |d| {
                        d.child(
                            div().flex().justify_end().mt(ui(4.)).child(
                                crate::copy_button::copy_button(
                                    button(SharedString::from(format!("copy-{}", message.id)), "")
                                        .aria_label("Copy response")
                                        .w(ui(24.))
                                        .justify_center()
                                        .h(ui(24.))
                                        .px(ui(6.))
                                        .text_color(rgba(0xebebeb80)),
                                    move || content.content.clone(),
                                ),
                            ),
                        )
                    },
                )
                .into_any_element()
        };
        div()
            .w_full()
            .flex()
            .justify_center()
            .child(
                div()
                    .debug_selector(|| "chat-message-column".into())
                    .w_full()
                    .max_w(ui(624.))
                    .px(ui(12.))
                    .child(row),
            )
            .into_any_element()
    }
    fn chat_grid(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let ids: Vec<_> = self
            .conversations
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.closed && c.project == self.project)
            .map(|(i, c)| c.pane.clone().unwrap_or_else(|| format!("draft-{i}")))
            .collect();
        let columns = inferay_presentation::dock::responsive_columns(
            &serde_json::json!({"width": self.chat_width, "columns":3}),
        );
        let layout = inferay_presentation::dock::project(&serde_json::json!({"ids": ids, "columns":3,"visibleColumns":columns,"saved":self.projects[self.project].dock})).expect("valid chat layout");
        let dimensions = layout["canvas"]["minHeight"]
            .as_str()
            .unwrap_or("max(100%, 180px)");
        let (percent, pixels) = dimensions
            .trim_start_matches("max(")
            .trim_end_matches(')')
            .split_once(',')
            .unwrap();
        let height = percent.trim().trim_end_matches('%').parse::<f32>().unwrap() / 100.;
        let min_height = pixels.trim().trim_end_matches("px").parse::<f32>().unwrap();
        let width = layout["canvas"]["width"]
            .as_str()
            .unwrap_or("100%")
            .trim_end_matches('%')
            .parse::<f32>()
            .unwrap()
            / 100.;
        div()
            .relative()
            .flex_1()
            .min_w_0()
            .h_full()
            .child(
                canvas(
                    cx.processor(|s, bounds: Bounds<Pixels>, window, cx| {
                        let width = f32::from(bounds.size.width) / crate::zoom::factor(window);
                        if (s.chat_width - width).abs() > 1. {
                            s.chat_width = width;
                            let entity = cx.entity_id();
                            cx.defer(move |cx| cx.notify(entity));
                        }
                    }),
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(
                div()
                    .id("chat-grid-scroll")
                    .absolute()
                    .size_full()
                    .overflow_y_scroll()
                    .child(
                        div()
                            .h(relative(height))
                            .min_h(ui(min_height))
                            .w(relative(width))
                            .child(self.dock_branch(
                                &layout["tree"],
                                &layout["tree"],
                                vec![],
                                window,
                                cx,
                            )),
                    ),
            )
            .into_any_element()
    }
    fn dock_branch(
        &self,
        tree: &serde_json::Value,
        root: &serde_json::Value,
        path: Vec<&'static str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if tree["type"] == "split" {
            let ratio = tree["ratio"].as_f64().unwrap_or(0.5) as f32;
            let horizontal = tree["direction"] == "horizontal";
            let bounds = std::rc::Rc::new(std::cell::Cell::new(Bounds::default()));
            let measured = bounds.clone();
            let root = root.clone();
            let mut first_path = path.clone();
            first_path.push("first");
            let mut second_path = path.clone();
            second_path.push("second");
            return div()
                .relative()
                .child(
                    canvas(move |b, _, _| measured.set(b), |_, _, _, _| {})
                        .absolute()
                        .size_full(),
                )
                .flex()
                .size_full()
                .min_h_0()
                .min_w_0()
                .when(tree["direction"] == "vertical", |d| d.flex_col())
                .child(
                    div()
                        .flex_basis(ui(0.))
                        .flex_grow(ratio)
                        .min_w_0()
                        .min_h_0()
                        .overflow_hidden()
                        .child(self.dock_branch(&tree["first"], &root, first_path, window, cx)),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("divider-{path:?}")))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener({
                                let root = root.clone();
                                move |s, _, _, cx| {
                                    s.dock_resize = Some((
                                        path.clone(),
                                        bounds.get(),
                                        horizontal,
                                        root.clone(),
                                    ));
                                    cx.stop_propagation();
                                }
                            }),
                        )
                        .flex_shrink_0()
                        .bg(rgba(0xffffff00))
                        .child(
                            div()
                                .absolute()
                                .bg(rgba(0xebebeb18))
                                .when(horizontal, |d| d.left(ui(2.)).w(ui(1.)).h_full())
                                .when(!horizontal, |d| d.top(ui(2.)).h(ui(1.)).w_full()),
                        )
                        .when(tree["direction"] == "horizontal", |d| {
                            d.w(ui(5.)).mx(ui(-2.)).h_full().cursor_col_resize()
                        })
                        .when(tree["direction"] == "vertical", |d| {
                            d.h(ui(5.)).my(ui(-2.)).w_full().cursor_row_resize()
                        }),
                )
                .child(
                    div()
                        .flex_basis(ui(0.))
                        .flex_grow(1. - ratio)
                        .min_w_0()
                        .min_h_0()
                        .overflow_hidden()
                        .child(self.dock_branch(&tree["second"], &root, second_path, window, cx)),
                )
                .into_any_element();
        }
        let Some(index) = self
            .conversations
            .iter()
            .enumerate()
            .find(|(i, c)| {
                c.pane
                    .as_deref()
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("draft-{i}"))
                    == tree["id"].as_str().unwrap_or_default()
            })
            .map(|(i, _)| i)
        else {
            return div().into_any_element();
        };
        div()
            .id(("chat-pane", index))
            .debug_selector(|| "chat-pane".into())
            .on_drop(cx.listener(move |s, paths: &ExternalPaths, _, cx| {
                s.attach_images(index, paths.paths().to_vec(), cx)
            }))
            .size_full()
            .flex()
            .flex_col()
            .min_w_0()
            .min_h_0()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |s, _, _, cx| {
                    if s.selected != index {
                        s.selected = index;
                        s.projects[s.project].selected = index;
                        s.persist_workspace_preferences(None, cx);
                    }
                    cx.notify();
                }),
            )
            .child(self.transcript(index, cx))
            .child(self.composer(index, window, cx))
            .into_any_element()
    }
    fn composer(
        &self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let chat = &self.conversations[index];
        let catalog =
            inferay_core::provider_config::renderer_catalog(&serde_json::Value::Null, &[]);
        let definition = match chat.config.agent_kind {
            inferay_core::provider_config::WorkspaceAgentKind::Claude => catalog.agents.claude,
            inferay_core::provider_config::WorkspaceAgentKind::Agent => catalog.agents.agent,
            _ => catalog.agents.codex,
        };
        let model = definition
            .models
            .iter()
            .find(|m| m.id == chat.config.model)
            .map(|m| m.short_label.as_ref().unwrap_or(&m.label).clone())
            .unwrap_or_else(|| chat.config.model.clone());
        let reasoning = definition
            .reasoning_levels
            .iter()
            .find(|r| r.id == chat.config.reasoning_level)
            .map(|r| r.label.clone())
            .unwrap_or_else(|| chat.config.reasoning_level.clone());
        div().debug_selector(|| "chat-composer".into()).relative().w_full().max_w(ui(624.)).mx_auto().px(ui(12.)).pt(ui(0.)).pb(ui(8.)).flex_shrink_0().flex().flex_col()
            .when(!self.status.is_empty(), |d| d.child(div().px(ui(8.)).pb(ui(10.)).text_size(ui(11.)).text_color(rgba(0xebebeb80)).child(self.status.clone())))
            .when(chat.run.is_loading, |d| d.child(
                div().debug_selector(|| "chat-activity".into()).flex().items_center().h(ui(20.)).pb(ui(4.))
                    .child(div().h(ui(16.)).flex().items_center().when_some(chat.run.start_time, |d, start| d.child(
                        div().id(("activity-time", index)).flex().items_center().gap(ui(6.)).with_animation(
                            ("chat-activity", index), Animation::new(std::time::Duration::from_millis(1500)).repeat(),
                            move |d, phase| {
                                let seconds = ((std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000. - start as f64).max(0.) / 1000.) as u64;
                                let elapsed = if seconds < 60 { format!("{seconds}s") } else if seconds < 3600 { format!("{}m {}s", seconds / 60, seconds % 60) } else { format!("{}h {}m", seconds / 3600, seconds / 60 % 60) };
                                d.aria_label(format!("Agent active, {elapsed} elapsed"))
                                    .child(div().relative().size(ui(14.)).children((0..25).map(|i| {
                                        let row = i / 5;
                                        let column = i % 5;
                                        let ring = (2_i32 - row).abs() + (2_i32 - column).abs();
                                        let delay = (ring as f32 * 0.14 + (ring % 2) as f32 * 0.03) / 1.5;
                                        let t = (phase - delay).rem_euclid(1.);
                                        let stops = [(0., 0.1), (0.28, 0.98), (0.56, 0.32), (0.78, 0.78), (1., 0.1)];
                                        let pair = stops.windows(2).find(|pair| t <= pair[1].0).unwrap();
                                        let opacity = pair[0].1 + (pair[1].1 - pair[0].1) * (t - pair[0].0) / (pair[1].0 - pair[0].0);
                                        div().absolute().left(ui(column as f32 * 3.)).top(ui(row as f32 * 3.)).size(ui(2.)).rounded(ui(1.)).bg(rgba(0xebebebb3)).opacity(opacity)
                                    })))
                                    .child(div().font_family("Menlo").text_size(ui(10.)).text_color(rgba(0xebebeb80)).child(elapsed))
                            },
                        )
                    )))
            ))
            .when(!chat.images.is_empty(), |d| d.child(
                div().id(("draft-attachments", index)).debug_selector(|| "draft-attachments".into())
                    .flex().items_start().gap(ui(6.)).w_full().min_w_0().flex_shrink_0()
                    .overflow_x_scroll().overflow_y_hidden().px(ui(4.)).pt(ui(4.)).pb(ui(8.))
                    .children(chat.images.iter().enumerate().map(|(i, path)| {
                        attachments::photo(path.clone(), format!("draft-photo-{index}-{i}"), true)
                            .child(button(("remove-image", i), "").debug_selector(|| "remove-draft-image".into()).aria_label("Remove image")
                                .absolute().top(ui(4.)).right_0().size(ui(18.)).p(ui(3.)).rounded_full()
                                .bg(rgba(0x181818e8)).child(icon("X").size(ui(12.)))
                                .on_click(cx.listener(move |s, _, _, cx| { s.conversations[index].images.remove(i); cx.notify(); })))
                    }))
            ))
            .child(div().debug_selector(|| "chat-input-shell".into()).relative().flex().flex_col().flex_shrink_0().rounded(ui(12.)).border_1().border_color(rgba(0xebebeb0f)).pt(ui(8.)).pb(ui(8.))
                .when(chat.run.is_loading || chat.input.focus_handle(cx).is_focused(window), |d| d.child(
                    div().absolute().inset_0().rounded(ui(12.)).overflow_hidden().with_animation(("composer-beam", index), Animation::new(std::time::Duration::from_millis(2500)).repeat(), |d, phase| d.child(
                        canvas(|_, _, _| (), move |bounds, _, window, _| {
                            let width = f32::from(bounds.size.width);
                            let height = f32::from(bounds.size.height);
                            let radius = (11. * crate::zoom::factor(window)).min(width / 2.).min(height / 2.);
                            let horizontal = width - radius * 2.;
                            let vertical = height - radius * 2.;
                            let arc = std::f32::consts::FRAC_PI_2 * radius;
                            let perimeter = 2. * (horizontal + vertical) + 4. * arc;
                            let position = |mut distance: f32| {
                                let lengths = [horizontal, arc, vertical, arc, horizontal, arc, vertical, arc];
                                let mut part = 0;
                                while part < 7 && distance > lengths[part] { distance -= lengths[part]; part += 1; }
                                let (x, y) = match part {
                                    0 => (radius + distance, 0.),
                                    2 => (width, radius + distance),
                                    4 => (width - radius - distance, height),
                                    6 => (0., height - radius - distance),
                                    _ => {
                                        let corner = part / 2;
                                        let angle = -std::f32::consts::FRAC_PI_2 + corner as f32 * std::f32::consts::FRAC_PI_2 + distance / radius;
                                        let (x, y) = [(width-radius,radius),(width-radius,height-radius),(radius,height-radius),(radius,radius)][corner];
                                        (x + radius * angle.cos(), y + radius * angle.sin())
                                    }
                                };
                                bounds.origin + point(px(x), px(y))
                            };
                            for segment in 0..240 {
                                let progress = segment as f32 / 240.;
                                let tail = (progress - phase).rem_euclid(1.);
                                let alpha = (1. - ((tail - 0.66) / 0.14).abs()).max(0.);
                                if alpha == 0. { continue; }
                                for (stroke, opacity) in [(36., 0.015), (20., 0.025), (10., 0.04), (5., 0.08), (2., 0.2), (1., 0.65)] {
                                    let mut path = PathBuilder::stroke(crate::zoom::pixels(stroke, window));
                                    path.move_to(position(progress * perimeter));
                                    path.line_to(position((segment + 1) as f32 / 240. * perimeter));
                                    if let Ok(path) = path.build() { window.paint_path(path, hsla((progress + phase * 0.1) % 1., 0.8, 0.65, alpha * opacity)); }
                                }
                            }
                        }).size_full()
                    ))
                ))
                .bg(self.appearance.composer_background())
                .when(!chat.requests.is_empty(), |d| d.child(
                    div().id(("provider-requests", index)).debug_selector(|| "provider-requests".into())
                        .max_h(ui(240.)).overflow_y_scroll().p(ui(10.)).flex().flex_col().gap(ui(8.))
                        .children(chat.requests.iter().enumerate().map(|(position, request)| {
                            let id = request["id"].as_str().unwrap_or("").to_owned();
                            let approve_id = id.clone();
                            let method = request["method"].as_str().unwrap_or("");
                            let question = method == "item/tool/requestUserInput";
                            let title = if question { "The agent needs your input" } else if method == "mcpServer/elicitation/request" { "Connection request" } else { "Approval required" };
                            div().flex().flex_col().gap(ui(6.)).text_size(ui(13.))
                                .child(div().font_weight(FontWeight::SEMIBOLD).child(title))
                                .children(["message","reason","command"].into_iter().filter_map(|key| request["params"][key].as_str().map(|text| div().child(text.to_owned()))))
                                .children(live::request_fields(request).into_iter().filter_map(|(field,label)| {
                                    chat.request_inputs.get(&format!("{id}/{field}")).map(|input| div().flex().flex_col().gap(ui(3.)).child(label).child(input.clone()))
                                }))
                                .child(div().flex().gap(ui(8.))
                                    .child(button(("answer-provider", position), if question {"Send answers"} else {"Approve once"})
                                        .debug_selector(|| "answer-provider".into())
                                        .on_click(cx.listener(move |view,_,_,cx| view.answer_provider_request(index, approve_id.clone(), true, cx))))
                                    .when(!question, |d| d.child(button(("decline-provider", position), "Decline")
                                        .on_click(cx.listener(move |view,_,_,cx| view.answer_provider_request(index, id.clone(), false, cx)))))
                                )
                        }))
                ))
                .when(!chat.queue.is_empty(), |d| d.child(
                    div().id(("chat-queue", index)).debug_selector(|| "chat-queue".into()).max_h(ui(112.)).overflow_y_scroll().px(ui(4.)).py(ui(2.))
                        .border_b_1().border_color(rgba(0xebebeb0f))
                        .children(chat.queue.iter().enumerate().map(|(position, message)| {
                            let text = message["displayText"].as_str().filter(|s| !s.is_empty())
                                .or_else(|| message["text"].as_str()).unwrap_or("").to_owned();
                            div().flex().items_center().gap(ui(6.)).px(ui(8.)).py(ui(2.)).text_size(ui(12.)).line_height(ui(20.))
                                .child(div().flex_shrink_0().w(ui(20.)).text_color(rgba(0xebebeb80)).child((position + 1).to_string()))
                                .child(div().flex_1().min_w_0().when_some(
                                    chat.queue_editor.as_ref().filter(|(id, _)| message["id"].as_str() == Some(id.as_str())),
                                    |d, (_, input)| d.child(input.clone()).capture_key_down(cx.listener(move |view, event: &gpui::KeyDownEvent, window, cx| {
                                        if event.keystroke.key == "escape" {
                                            view.conversations[index].queue_editor = None;
                                            view.conversations[index].queue_submit = None;
                                            window.focus(&view.conversations[index].input.focus_handle(cx), cx);
                                            cx.stop_propagation();
                                            cx.notify();
                                        }
                                    })))
                                    .when(chat.queue_editor.as_ref().is_none_or(|(id, _)| message["id"].as_str() != Some(id.as_str())), |d| d.text_ellipsis().child(text)))
                                .when(message["interrupted"] == true, |d| {
                                    let id = message["id"].as_str().unwrap_or("").to_owned();
                                    d.child(div().text_color(rgba(0xebebeb80)).child("Interrupted — review work before retrying"))
                                     .child(button(("retry-queued", position), "Retry").debug_selector(|| "retry-queued".into())
                                        .on_click(cx.listener(move |view, _, _, cx| view.update_queued_message(index, id.clone(), None, true, cx))))
                                })
                                .when(message["transient"].as_bool().unwrap_or(false), |d| d.child(
                                    div().flex_shrink_0().text_color(rgba(0xebebeb80)).child("Steering…")))
                                .when(!message["transient"].as_bool().unwrap_or(false), |d| {
                                    let id = message["id"].as_str().unwrap_or("").to_owned();
                                    let edit_id = id.clone();
                                    let editing = chat.queue_editor.as_ref().is_some_and(|(id, _)| id == &edit_id);
                                    d.child(button(("edit-queued", position), "").debug_selector(|| "edit-queued".into())
                                        .w(ui(20.)).h(ui(20.)).px(ui(3.)).child(icon(if editing { "Check" } else { "Pencil" }).size(ui(14.)))
                                        .aria_label(if editing { "Save queued message" } else { "Edit queued message" })
                                        .on_click(cx.listener(move |view, _, window, cx| {
                                            let chat = &mut view.conversations[index];
                                            if chat.queue_task.is_some() { return; }
                                            if let Some((id, input)) = &chat.queue_editor && id == &edit_id {
                                                let text = input.read(cx).content.to_string();
                                                view.update_queued_message(index, edit_id.clone(), Some(text), false, cx);
                                            } else if let Some(message) = chat.queue.iter().find(|m| m["id"].as_str() == Some(&edit_id)) {
                                                let text = message["text"].as_str().unwrap_or("").to_owned();
                                                let input = cx.new(TextInput::new);
                                                input.update(cx, |input, cx| {
                                                    input.submit_on_enter = true;
                                                    input.set_content(&text, cx);
                                                });
                                                chat.queue_submit = Some(cx.subscribe(&input, move |view, _, _: &crate::input::Submit, cx| {
                                                    if let Some((id, input)) = &view.conversations[index].queue_editor {
                                                        let id = id.clone();
                                                        let text = input.read(cx).content.to_string();
                                                        view.update_queued_message(index, id, Some(text), false, cx);
                                                    }
                                                }));
                                                window.focus(&input.focus_handle(cx), cx);
                                                chat.queue_editor = Some((edit_id.clone(), input));
                                                cx.notify();
                                            }
                                        })))
                                    .when(editing, |d| d.child(button(("cancel-queued", position), "")
                                        .w(ui(20.)).h(ui(20.)).px(ui(3.)).child(icon("X").size(ui(14.)))
                                        .aria_label("Cancel queued message edit")
                                        .on_click(cx.listener(move |view, _, window, cx| {
                                            view.conversations[index].queue_editor = None;
                                            view.conversations[index].queue_submit = None;
                                            window.focus(&view.conversations[index].input.focus_handle(cx), cx);
                                            cx.notify();
                                        }))))
                                    .when(!editing, |d| d.child(button(("remove-queued", position), "").aria_label("Remove from queue")
                                        .w(ui(20.)).h(ui(20.)).px(ui(3.)).child(icon("Trash").size(ui(14.)))
                                        .opacity(if chat.queue_task.is_some() { 0.4 } else { 1. })
                                        .on_click(cx.listener(move |view, _, _, cx| view.update_queued_message(index, id.clone(), None, false, cx)))))
                                })
                        }))
                ))
                .child(div().debug_selector(|| "chat-input-row".into()).flex().items_end().gap(ui(4.)).pl(ui(4.)).pr(ui(12.)).py(ui(6.))
                    .child(div().flex().items_center().gap(ui(2.)).flex_shrink_0()
                        .children([("Plus", "Attach image"), ("Mic", "Start voice input")].into_iter().map(|(glyph, label)| {
                            button((label, index), "").aria_label(label).w(ui(28.)).h(ui(28.)).px(ui(6.)).child(icon(glyph).size(ui(16.)))
                                .on_click(cx.listener(move |s, _, _, cx| { if glyph == "Plus" { s.pick_chat_images(index, cx); } else { s.status = format!("{label} is not connected in the native preview yet."); cx.notify(); } }))
                        })))
                    .child(div().flex_1().min_w_0().child(chat.input.clone())
                        .capture_key_down(cx.listener(move |view, event: &KeyDownEvent, window, cx| { view.completion_key(index, &event.keystroke.key, event.keystroke.modifiers.shift, window, cx); }))
                        .capture_action(cx.listener(move |view, _: &crate::input::Enter, window, cx| { if !view.completion_key(index, "enter", false, window, cx) { cx.propagate(); } }))
                        .capture_action(cx.listener(move |view, _: &crate::input::Up, window, cx| { if !view.completion_key(index, "up", false, window, cx) { cx.propagate(); } }))
                        .capture_action(cx.listener(move |view, _: &crate::input::Down, window, cx| { if !view.completion_key(index, "down", false, window, cx) { cx.propagate(); } })))
                    .child(button(("send-chat", index), "").debug_selector(|| "chat-submit".into()).aria_label(if chat.run.is_loading { "Stop generating" } else { "Send message" })
                        .w(ui(28.)).h(ui(28.)).px(ui(6.))
                        .opacity(if chat.commands.is_some() && !chat.sending { 1. } else { 0.4 })
                        .child(icon(if chat.run.is_loading { "Stop" } else { "Send" }).size(ui(16.)))
                        .on_click(cx.listener(move |view, _, _, cx| view.send_chat(index, view.conversations[index].run.is_loading, cx)))))
                .child(div().debug_selector(|| "chat-input-options".into()).flex().flex_wrap().items_center().px(ui(8.)).pb(ui(4.)).gap(ui(4.))
                    .children([("provider", definition.label), ("model", model), ("reasoning", reasoning)].into_iter().map(|(name, value)| {
                        button((name, index), "").aria_label(format!("{name}: {value}")).h(ui(24.)).px(ui(4.)).gap(ui(4.)).text_size(ui(10.)).flex_shrink_0()
                            .when(name == "provider", |d| d.child(icon(if chat.config.agent_kind.as_str() == "codex" { "codex" } else { "Sparkles" }).size(ui(10.))))
                            .child(value).child(icon("ChevronDown").size(ui(9.)))
                            .on_click(cx.listener(move |s, _, _, cx| { s.selected = index; s.menu = if s.menu == Some((index, name)) { None } else { Some((index, name)) }; cx.notify(); }))
                    }))))
            .when(chat.completion.menu["show"] == true && chat.input.focus_handle(cx).is_focused(window), |d| d.child(self.completion_popup(index, cx)))
            .when_some(self.menu.filter(|(pane, _)| *pane == index), |d, (_, name)| d.child(self.popup(index, name, cx)))
    }
    fn popup(&self, index: usize, name: &'static str, cx: &mut Context<Self>) -> impl IntoElement {
        let config = &self.conversations[index].config;
        let catalog =
            inferay_core::provider_config::renderer_catalog(&serde_json::Value::Null, &[]);
        let definition = match config.agent_kind.as_str() {
            "claude" => catalog.agents.claude,
            "agent" => catalog.agents.agent,
            _ => catalog.agents.codex,
        };
        let options: Vec<(String, String)> = match name {
            "provider" => vec![
                ("codex".into(), "Codex".into()),
                ("claude".into(), "Claude".into()),
            ],
            "model" => definition
                .models
                .into_iter()
                .map(|m| (m.id, m.label))
                .collect(),
            _ => if config.agent_kind.as_str() == "codex" {
                inferay_core::provider_config::reasoning_levels_for(&config.model).to_vec()
            } else {
                definition.reasoning_levels
            }
            .into_iter()
            .map(|r| (r.id, r.label))
            .collect(),
        };
        crate::menu_surface(("composer-menu", index))
            .bg(Rgba {
                a: 1.,
                ..self.appearance.composer_background()
            })
            .bottom(ui(46.))
            .left(ui(12.))
            .w(ui(180.))
            .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                s.menu = None;
                cx.notify();
            }))
            .children(options.into_iter().map(|(value, label)| {
                let selected = match name {
                    "provider" => config.agent_kind.as_str() == value,
                    "model" => config.model == value,
                    _ => config.reasoning_level == value,
                };
                button(SharedString::from(value.clone()), label)
                    .w_full()
                    .when(selected, |d| d.bg(rgba(0xebebeb17)))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        let mut input =
                            serde_json::to_value(&s.conversations[index].config).unwrap();
                        input[match name {
                            "provider" => "agentKind",
                            "model" => "model",
                            _ => "reasoningLevel",
                        }] = value.clone().into();
                        s.conversations[index].config =
                            inferay_core::provider_config::resolve(&input);
                        s.menu = None;
                        cx.notify();
                    }))
            }))
    }
}
impl Render for WorkspaceView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if window.rem_size() != self.zoom.rem_size() {
            self.zoom.apply(window);
        }
        let shell = match self.appearance {
            Appearance::Dark => rgba((colors::SHELL << 8) | 255),
            Appearance::Glass => rgba((self.glass_opacity * 255.) as u32),
            Appearance::Scene => rgba(0x18212a88),
        };
        let canvas = match self.appearance {
            Appearance::Dark => rgba((colors::CANVAS << 8) | 255),
            Appearance::Glass => rgba(0x06060666),
            Appearance::Scene => rgba(0x05050661),
        };
        if self.project_picker
            || self
                .projects
                .iter()
                .all(|p| self.closed_projects.contains(p.id.as_deref().unwrap_or("")))
        {
            return div()
                .size_full()
                .flex()
                .flex_col()
                .bg(shell)
                .text_color(rgb(colors::TEXT))
                .child(self.titlebar(cx))
                .child(
                    div()
                        .p(ui(24.))
                        .flex()
                        .flex_col()
                        .gap(ui(8.))
                        .child("Open a workspace")
                        .child("Closing a tab keeps its chats, repositories and files.")
                        .children(self.projects.iter().enumerate().map(|(index, project)| {
                            button(("reopen-project", index), project.name.clone())
                                .debug_selector(move || format!("reopen-project-{index}"))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.select_project(index, cx);
                                    s.persist_workspace_preferences(None, cx);
                                }))
                        })),
                )
                .into_any_element();
        }
        div()
            .relative()
            .size_full()
            .font_family(self.font)
            .text_size(ui(colors::CHAT_BODY))
            .text_color(rgb(colors::TEXT))
            .bg(shell)
            .track_focus(&self.focus)
            .on_mouse_move(cx.listener(|s, event: &MouseMoveEvent, window, cx| {
                if let Some((start, width)) = s.repository_resize {
                    s.repository_width = (width + f32::from(start - event.position.x) / crate::zoom::factor(window)).max(280.);
                    cx.notify();
                }
                if let Some((start, width)) = s.sidebar_resize {
                    s.sidebar_width =
                        (width + f32::from(event.position.x - start) / crate::zoom::factor(window)).clamp(188., 340.);
                    cx.notify();
                }
                if let Some((path, bounds, horizontal, tree)) = &s.dock_resize {
                    let ratio = if *horizontal {
                        (event.position.x - bounds.left()) / bounds.size.width
                    } else {
                        (event.position.y - bounds.top()) / bounds.size.height
                    };
                    if let Ok(updated) = inferay_presentation::dock::resize_preview(
                        &serde_json::json!({"tree":tree,"path":path,"ratio":ratio}),
                    ) {
                        s.projects[s.project].dock =
                            serde_json::json!({"tree":updated["tree"],"preset":["grid",3]});
                        cx.notify();
                    }
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|s, event: &MouseUpEvent, _, cx| {
                    s.repository_resize = None;
                    if let Some((path, bounds, horizontal, _)) = s.dock_resize.take() {
                        let project = &s.projects[s.project];
                        if let Some((workspace, legacy)) = &project.dock_workspace {
                            let ratio = if horizontal {
                                (event.position.x - bounds.left()) / bounds.size.width
                            } else {
                                (event.position.y - bounds.top()) / bounds.size.height
                            };
                            let ids: Vec<_> = s.conversations.iter().enumerate()
                                .filter(|(_, chat)| !chat.closed && chat.project == s.project)
                                .map(|(i, chat)| chat.pane.clone().unwrap_or_else(|| format!("draft-{i}"))).collect();
                            let visible = inferay_presentation::dock::responsive_columns(&serde_json::json!({"width":s.chat_width,"columns":3}));
                            let request = serde_json::json!({"workspaceId":workspace,"legacyWorkspaceId":legacy,"ids":ids,"columns":3,"visibleColumns":visible,"action":{"type":"resize","path":path,"ratio":ratio}});
                            s.persist_workspace_preferences(Some(request), cx);
                        }
                    }
                    if s.sidebar_resize.take().is_some() {
                        s.persist_workspace_preferences(None, cx);
                    }
                }),
            )
            .on_action(cx.listener(|s, _: &crate::zoom::ZoomIn, window, cx| s.set_zoom(s.zoom.step(1), window, cx)))
            .on_action(cx.listener(|s, _: &crate::zoom::ZoomOut, window, cx| s.set_zoom(s.zoom.step(-1), window, cx)))
            .on_action(cx.listener(|s, _: &crate::zoom::ResetZoom, window, cx| s.set_zoom(crate::zoom::Zoom::default(), window, cx)))
            .on_action(cx.listener(|s, _: &ToggleSidebar, _, cx| {
                s.sidebar = !s.sidebar;
                        s.persist_workspace_preferences(None, cx);
                cx.notify();
            }))
            .on_action(cx.listener(|s, _: &Settings, window, cx| {
                s.set_settings(!s.settings, window, cx);
            }))
            .on_action(cx.listener(|s, _: &Back, window, cx| {
                if s.settings && s.menu.is_none() {
                    s.set_settings(false, window, cx);
                } else {
                    s.menu = None;
                    cx.notify();
                }
            }))
            .when(self.appearance == Appearance::Scene, |d| {
                d.when_some(self.scene.clone(), |d, scene| {
                    d.child(
                        img(scene)
                            .absolute()
                            .size_full()
                            .object_fit(ObjectFit::Cover),
                    )
                })
                .child(
                    div()
                        .absolute()
                        .size_full()
                        .bg(rgba((self.scene_dim * 255.) as u32)),
                )
            })
            .when(self.appearance == Appearance::Glass, |d| {
                d.child(div().absolute().size_full().bg(rgba(0xebebeb0d)))
            })
            .when(self.settings, |d| d.child(self.settings(canvas, cx)))
            .when(!self.settings, |d| {
                d.child(
                    div()
                        .relative()
                        .flex()
                        .flex_col()
                        .size_full()
                        .child(self.titlebar(cx))
                        .child(
                            div()
                                .flex()
                                .flex_1()
                                .min_h_0()
                                .pr(ui(6.))
                                .pb(ui(6.))
                                .when(self.sidebar, |d| d.child(self.sidebar(cx)))
                                .child(
                                    div()
                                        .flex()
                                        .flex_1()
                                        .min_w_0()
                                        .rounded(ui(12.))
                                        .overflow_hidden()
                                        .border_1()
                                        .border_color(rgba(0xebebeb0a))
                                        .bg(canvas)
                                        .when(!self.settings, |d| {
                                            d.when(
                                                !(self.repository && self.repository_expanded),
                                                |d| d.child(self.chat_grid(window, cx)),
                                            )
                                            .when(
                                                self.repository,
                                                |d| {
                                                    d.when_some(
                                                        self.repository_view.clone(),
                                                        |d, view| {
                                                            d.child(
                                                                div()
                                                                    .h_full()
                                                                    .min_w_0()
                                                                    .when(
                                                                        self.repository_expanded,
                                                                        |d| d.flex_1(),
                                                                    )
                                                                    .when(
                                                                        !self.repository_expanded,
                                                                        |d| {
                                                                            d.w(ui(self.repository_width))
                                                                                .max_w(relative(
                                                                                    0.65,
                                                                                ))
                                                                                .flex_shrink_0()
                                                                        },
                                                                    )
                                                                    .relative()
                                                                    .child(view)
                                                                    .when(!self.repository_expanded, |d| d.child(
                                                                        div().id("resize-repository").absolute().left_0().top_0().w(ui(6.)).h_full().cursor_col_resize()
                                                                            .on_mouse_down(MouseButton::Left, cx.listener(|view, event: &MouseDownEvent, _, cx| {
                                                                                view.repository_resize = Some((event.position.x, view.repository_width));
                                                                                cx.stop_propagation();
                                                                            }))
                                                                    )),
                                                            )
                                                        },
                                                    )
                                                },
                                            )
                                        }),
                                ),
                        ),
                )
            }).into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[gpui::test]
    fn workspace_tabs_close_and_reopen_without_deleting_chats(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.projects[0].id = Some("first".into());
            view.projects[0].name = "First".into();
            view.projects.push(Project {
                id: Some("second".into()),
                name: "Second".into(),
                repositories: vec![],
                selected_repository: None,
                selected: 1,
                dock: serde_json::Value::Null,
                dock_workspace: None,
            });
            view.conversations.push(Conversation::new(
                1,
                cx.new(TextInput::new),
                view.default_config.clone(),
            ));
            view.conversations[0]
                .input
                .update(cx, |input, _| input.content = "Keep draft".into());
            view
        });
        cx.draw(point(px(0.), px(0.)), size(px(1000.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        let target = cx.debug_bounds("close-project-0").unwrap().center();
        cx.simulate_click(target, Modifiers::default());
        view.read_with(cx, |view, cx| {
            assert_eq!(view.project, 1);
            assert_eq!(view.projects.len(), 2);
            assert_eq!(
                view.conversations[0].input.read(cx).content.as_ref(),
                "Keep draft"
            );
        });
        view.update(cx, |view, cx| view.close_project_tab(1, cx));
        cx.draw(point(px(0.), px(0.)), size(px(1000.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        let target = cx.debug_bounds("reopen-project-0").unwrap().center();
        cx.simulate_click(target, Modifiers::default());
        view.read_with(cx, |view, _| {
            assert_eq!(view.project, 0);
            assert!(!view.project_picker);
            assert!(!view.closed_projects.contains("first"));
            assert!(view.closed_projects.contains("second"));
            assert_eq!(view.conversations.len(), 2);
        });
    }

    fn attachment_photos() -> (tempfile::TempDir, Vec<std::path::PathBuf>) {
        let directory = tempfile::tempdir().unwrap();
        let paths = [("portrait.png", 16, 512), ("landscape.png", 512, 16)]
            .into_iter()
            .map(|(name, width, height)| {
                let path = directory.path().join(name);
                image::RgbaImage::from_pixel(width, height, image::Rgba([145, 120, 190, 255]))
                    .save(&path)
                    .unwrap();
                path
            })
            .collect();
        (directory, paths)
    }

    #[gpui::test]
    fn sent_photos_reserve_space_above_text_before_and_after_loading(
        cx: &mut gpui::TestAppContext,
    ) {
        let (_directory, photos) = attachment_photos();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.replace_messages(vec![
                serde_json::from_value(serde_json::json!({"id":"photos", "role":"user", "images":photos, "content":"This text stays below the photos.\n".repeat(6)})).unwrap(),
                serde_json::from_value(serde_json::json!({"id":"reply", "role":"assistant", "content":"A reply follows the complete message."})).unwrap(),
                serde_json::from_value(serde_json::json!({"id":"plain", "role":"user", "content":"This ordinary message must use the available width."})).unwrap(),
            ]);
            view.conversations[0].transcript.publish(PreparedTranscript::prepare(0, buffer.messages().iter().cloned().map(std::sync::Arc::new), "vscode-black"), None);
            view
        });
        cx.simulate_resize(size(px(900.), px(1000.)));
        for zoom in ["50", "100", "200"] {
            view.update(cx, |view, cx| {
                view.zoom = crate::zoom::Zoom::restore(Some(zoom));
                view.conversations[0].transcript.scroll.remeasure();
                cx.notify();
            });
            for _ in 0..2 {
                cx.draw(point(px(0.), px(0.)), size(px(900.), px(1000.)), |_, _| {
                    view.clone().into_any_element()
                });
                let images = cx.debug_bounds("user-images-photos").unwrap();
                let text = cx.debug_bounds("user-message-text-photos").unwrap();
                let bubble = cx.debug_bounds("user-bubble-photos").unwrap();
                let scale = zoom.parse::<f32>().unwrap() / 100.;
                let plain = cx.debug_bounds("user-bubble-plain").unwrap();
                assert!(
                    plain.size.width >= px(100. * scale),
                    "text-only bubble collapsed at {zoom}%: {plain:?}"
                );
                assert!(text.top() >= images.bottom() + px(8. * scale) - px(1.));
                assert!(bubble.bottom() >= text.bottom());
                for selector in ["sent-photo-photos-0", "sent-photo-photos-1"] {
                    let photo = cx.debug_bounds(selector).unwrap();
                    assert!((photo.size.height - px(124. * scale)).abs() < px(1.));
                    assert!(photo.right() <= images.right() + px(1.));
                    assert!(photo.bottom() <= images.bottom() + px(1.));
                }
                view.read_with(cx, |view, _| {
                    let list = &view.conversations[0].transcript.scroll;
                    assert!(list.bounds_for_item(1).unwrap().top() >= bubble.bottom());
                });
                cx.run_until_parked();
            }
        }
    }

    #[gpui::test]
    fn provider_question_fields_keep_separate_answers_and_stale_request_errors(
        cx: &mut gpui::TestAppContext,
    ) {
        let profile = tempfile::tempdir().unwrap();
        let backend = crate::backend::RUNTIME
            .block_on(crate::backend::Backend::connect(profile.path().to_owned()))
            .unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some("questions-pane".into());
            chat.requests = vec![serde_json::json!({"id":"request","method":"item/tool/requestUserInput","params":{"questions":[{"id":"color","question":"Which color?"},{"id":"size","question":"Which size?"}]}})];
            for field in ["color","size"] { chat.request_inputs.insert(format!("request/{field}"), cx.new(TextInput::new)); }
            view
        });
        cx.update(|_, cx| crate::input::bind(cx));
        for (field, answer) in [("color", "blue"), ("size", "large")] {
            let input = view.read_with(cx, |view, _| {
                view.conversations[0].request_inputs[&format!("request/{field}")].clone()
            });
            cx.focus(&input);
            cx.simulate_input(answer);
        }
        cx.simulate_resize(size(px(900.), px(800.)));
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("provider-requests").is_some());
        let answer_button = cx.debug_bounds("answer-provider").unwrap();
        cx.simulate_click(answer_button.center(), Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |view, cx| {
            let chat = &view.conversations[0];
            assert!(chat.request_task.is_none());
            assert!(
                chat.error
                    .as_ref()
                    .is_some_and(|error| error.contains("Could not answer request"))
            );
            assert_eq!(
                chat.request_inputs["request/color"]
                    .read(cx)
                    .content
                    .as_ref(),
                "blue"
            );
            assert_eq!(
                chat.request_inputs["request/size"]
                    .read(cx)
                    .content
                    .as_ref(),
                "large"
            );
            assert!(chat.input.read(cx).content.is_empty());
        });
    }

    #[gpui::test]
    fn draft_photos_stay_above_the_input_and_preserve_typing(cx: &mut gpui::TestAppContext) {
        let (_directory, photos) = attachment_photos();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            view
        });
        let input = view.read_with(cx, |view, _| view.conversations[0].input.clone());
        cx.update(|_, cx| crate::input::bind(cx));
        cx.focus(&input);
        cx.simulate_input("Keep this draft");
        view.update(cx, |view, cx| view.attach_images(0, photos.clone(), cx));
        cx.simulate_resize(size(px(900.), px(800.)));
        for zoom in ["50", "100", "200"] {
            view.update(cx, |view, cx| {
                view.zoom = crate::zoom::Zoom::restore(Some(zoom));
                cx.notify();
            });
            cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
                view.clone().into_any_element()
            });
            let strip = cx.debug_bounds("draft-attachments").unwrap();
            let shell = cx.debug_bounds("chat-input-shell").unwrap();
            assert!(strip.bottom() <= shell.top());
            for selector in ["draft-photo-0-0", "draft-photo-0-1"] {
                let photo = cx.debug_bounds(selector).unwrap();
                assert!(photo.bottom() <= shell.top());
            }
        }
        cx.simulate_input(" while attaching");
        assert_eq!(
            input.read_with(cx, |input, _| input.content.to_string()),
            "Keep this draft while attaching"
        );
        for remaining in [1, 0] {
            let remove = cx.debug_bounds("remove-draft-image").unwrap();
            cx.simulate_click(remove.center(), Modifiers::default());
            cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
                view.clone().into_any_element()
            });
            view.read_with(cx, |view, _| {
                assert_eq!(view.conversations[0].images.len(), remaining)
            });
        }
        assert!(cx.debug_bounds("draft-attachments").is_none());
        assert_eq!(
            input.read_with(cx, |input, _| input.content.to_string()),
            "Keep this draft while attaching"
        );
    }
    #[gpui::test]
    fn stop_hook_has_no_row_or_details_even_if_previously_expanded(cx: &mut gpui::TestAppContext) {
        let id = "hook:turn:stop";
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            view.expanded.insert(id.into());
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.replace_messages(vec![serde_json::from_value(serde_json::json!({"id":"answer","role":"assistant","content":"The answer remains visible."})).unwrap()]);
            buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":id,"name":"stop hook","input":{"event":"stop"},"output":"completed","done":true}));
            view.conversations[0].transcript.publish(PreparedTranscript::prepare(0, buffer.messages().iter().cloned().map(std::sync::Arc::new), "vscode-black"), None);
            view
        });
        cx.simulate_resize(size(px(900.), px(700.)));
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-dot-hook:turn:stop").is_none());
        assert!(cx.debug_bounds("tool-details-hook:turn:stop").is_none());
        assert!(cx.debug_bounds("tool-timeline-row").is_none());
        view.read_with(cx, |view, _| {
            let transcript = &view.conversations[0].transcript;
            assert_eq!(transcript.rows().len(), 2);
            assert_eq!(transcript.last_visible(), Some(0));
            assert_eq!(
                transcript.scroll.bounds_for_item(1).unwrap().size.height,
                px(0.)
            );
        });
    }
    #[gpui::test]
    fn tool_connectors_join_dot_centers_across_hidden_and_expanded_rows(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.replace_messages([
                serde_json::json!({"id":"first","role":"tool","toolName":"exec_command","content":"{\"cmd\":\"echo one\"}\none"}),
                serde_json::json!({"id":"hidden","role":"tool","toolName":"exec_command","content":"{\"cmd\":\"echo one\"}\none"}),
                serde_json::json!({"id":"second","role":"tool","toolName":"Read","content":"{\"file_path\":\"main.rs\"}\nlet value = 1;"}),
                serde_json::json!({"id":"note","role":"system","content":"**Next step**"}),
                serde_json::json!({"id":"separate","role":"tool","toolName":"Read","content":"{\"file_path\":\"other.rs\"}\nlet value = 2;"}),
            ].into_iter().map(|v| serde_json::from_value(v).unwrap()).collect());
            assert!(buffer.messages()[1].render.as_ref().unwrap().hidden);
            view.conversations[0].transcript.publish(PreparedTranscript::prepare(0, buffer.messages().iter().cloned().map(std::sync::Arc::new), "vscode-black"), None);
            view
        });
        cx.simulate_resize(size(px(1100.), px(1000.)));
        for zoom in ["100", "200"] {
            for expanded in [false, true] {
                view.update(cx, |view, cx| {
                    view.zoom = crate::zoom::Zoom::restore(Some(zoom));
                    if expanded {
                        view.expanded.insert("first".into());
                    } else {
                        view.expanded.remove("first");
                    }
                    view.conversations[0].transcript.scroll.remeasure();
                    cx.notify();
                });
                cx.draw(point(px(0.), px(0.)), size(px(1100.), px(1000.)), |_, _| {
                    view.clone().into_any_element()
                });
                let first = cx.debug_bounds("tool-dot-first").unwrap();
                let second = cx.debug_bounds("tool-dot-second").unwrap();
                let outgoing = cx.debug_bounds("tool-line-after-first").unwrap();
                let incoming = cx.debug_bounds("tool-line-before-second").unwrap();
                assert!((first.center().x - second.center().x).abs() < px(1.));
                assert!((outgoing.center().x - first.center().x).abs() < px(1.));
                assert!((outgoing.top() - first.center().y).abs() < px(1.));
                assert!((outgoing.bottom() - incoming.top()).abs() < px(1.));
                assert!((incoming.bottom() - second.center().y).abs() < px(1.));
                assert!(cx.debug_bounds("tool-line-before-first").is_none());
                assert!(cx.debug_bounds("tool-dot-hidden").is_none());
                assert!(cx.debug_bounds("tool-line-after-second").is_none());
                assert!(cx.debug_bounds("tool-line-before-separate").is_none());
            }
        }
    }
    #[gpui::test]
    fn last_expanded_tool_card_clears_the_padded_composer_at_large_zoom(
        cx: &mut gpui::TestAppContext,
    ) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            view.zoom = crate::zoom::Zoom::restore(Some("200"));
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"last-tool","name":"exec_command","input":{"cmd":"echo output"},"output": "readable output\n".repeat(200), "done":true}));
            view.conversations[0].transcript.publish(PreparedTranscript::prepare(0, buffer.messages().iter().cloned().map(std::sync::Arc::new), "vscode-black"), None);
            view
        });
        cx.simulate_resize(size(px(1100.), px(700.)));
        cx.draw(point(px(0.), px(0.)), size(px(1100.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        let tool = cx.debug_bounds("tool-timeline-row").unwrap();
        cx.simulate_click(tool.center(), Modifiers::default());
        cx.draw(point(px(0.), px(0.)), size(px(1100.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        let output = cx.debug_bounds("tool-details-last-tool").unwrap();
        let composer = cx.debug_bounds("chat-composer").unwrap();
        let viewport = view.read_with(cx, |view, _| {
            view.conversations[0].transcript.scroll.viewport_bounds()
        });
        assert!(output.bottom() <= viewport.bottom());
        assert!(output.bottom() > viewport.bottom() - px(24.));
        assert!(output.bottom() + px(16.) <= composer.top());
    }
    use core::prelude::v1::test;
    #[gpui::test]
    fn startup_waits_for_decoded_background(cx: &mut gpui::TestAppContext) {
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            WorkspaceView::empty(cx.focus_handle(), input, cx)
        });
        cx.run_until_parked();
        window
            .update(cx, |view, _, cx| {
                assert!(view.startup_window.is_none());
                view.restored = true;
                view.set_background(
                    &serde_json::json!({"mode":"scene","id":"city","blur":0}),
                    cx,
                );
                assert!(view.scene.is_none());
                assert!(view.scene_task.is_some());
                assert!(!view.restored || view.scene_task.is_some());
                cx.notify();
            })
            .unwrap();
        cx.run_until_parked();
        window
            .update(cx, |view, _, _| {
                assert!(view.scene.is_some());
                assert!(view.scene_task.is_none());
            })
            .unwrap();
    }

    #[gpui::test]
    fn repository_removal_persists_preserves_files_and_handles_dependencies(
        cx: &mut gpui::TestAppContext,
    ) {
        let profile = tempfile::tempdir().unwrap();
        let directories = [
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
        ];
        let mut paths: Vec<String> = directories
            .iter()
            .map(|dir| {
                dir.path()
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        for path in &paths {
            std::fs::write(std::path::Path::new(path).join("keep.txt"), "keep").unwrap();
        }
        let project_id = "00000000-0000-4000-8000-000000000001";
        let ids = [
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000003",
            "00000000-0000-4000-8000-000000000004",
        ];
        let backend = crate::backend::RUNTIME
            .block_on(crate::backend::Backend::connect(profile.path().to_owned()))
            .unwrap();
        let repositories: Vec<_> = ids
            .iter()
            .map(|id| serde_json::json!({"id":id,"name":"Same name"}))
            .collect();
        let bindings: std::collections::BTreeMap<_, _> = ids.iter().zip(paths.iter()).collect();
        crate::backend::RUNTIME.block_on(backend.request(reqwest::Method::POST, "/api/projects/command", Some(serde_json::json!({"type":"saveProject", "expectedHash":null, "definition":{"schema":"inferay.project/1","id":project_id,"name":"Test","description":"","instructions":"","repositories":repositories}, "repositoryPaths":bindings})))).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.status.clear();
            view.backend =
                std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend.clone())));
            view.projects[0].id = Some(project_id.into());
            view.projects[0].repositories = paths
                .iter()
                .map(|path| ("Same name".into(), path.clone()))
                .collect();
            view.repository = true;
            view.open_repository(paths[0].clone(), cx);
            view
        });
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(1000.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        let remove = cx.debug_bounds("remove-repository-1").unwrap();
        cx.simulate_click(remove.center(), Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(view.repository_edit_task.is_none());
            assert_eq!(view.projects[0].repositories.len(), 2, "{}", view.status);
            assert_eq!(
                view.projects[0].selected_repository.as_ref(),
                Some(&paths[0])
            );
            assert!(
                !view.projects[0]
                    .repositories
                    .iter()
                    .any(|(_, path)| path == &paths[1])
            );
        });
        view.update(cx, |view, cx| {
            view.edit_repository(Some(paths[0].clone()), cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert_eq!(
                view.projects[0].selected_repository.as_ref(),
                Some(&paths[2])
            );
            assert!(!view.repository_views.contains_key(&paths[0]));
        });
        let automation = profile
            .path()
            .join("projects")
            .join(project_id)
            .join("automations/job/automation.json");
        std::fs::create_dir_all(automation.parent().unwrap()).unwrap();
        std::fs::write(&automation, serde_json::json!({"schema":"inferay.automation/1","id":"00000000-0000-4000-8000-000000000005","name":"Keep dependency","archived":true,"trigger":{"kind":"manual"},"overlap":"skip","may":[],"execution":{"kind":"agent","provider":"codex","instructions":"Run","skills":[],"resources":[],"repositories":[ids[2]],"workingDirectory":{"base":"repository","id":ids[2]},"timeoutSeconds":300}}).to_string()).unwrap();
        view.update(cx, |view, cx| {
            view.edit_repository(Some(paths[2].clone()), cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |view, cx| {
            assert_eq!(view.projects[0].repositories.len(), 1);
            assert!(
                view.repository_view
                    .as_ref()
                    .unwrap()
                    .read(cx)
                    .membership_error
                    .as_ref()
                    .unwrap()
                    .contains("automations and tools")
            );
        });
        let automation_before = std::fs::read(&automation).unwrap();
        let moved = tempfile::tempdir().unwrap();
        let new_path = moved.path().join("moved-repo");
        std::fs::rename(&paths[2], &new_path).unwrap();
        view.update(cx, |view, cx| view.open_repository(paths[2].clone(), cx));
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(1000.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        let locate = cx.debug_bounds("locate-repository").unwrap();
        cx.simulate_click(locate.center(), Modifiers::default());
        assert!(cx.did_prompt_for_paths());
        cx.simulate_path_prompt_response(|_| None);
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert_eq!(
                view.projects[0].selected_repository.as_ref(),
                Some(&paths[2])
            )
        });
        view.update(cx, |view, cx| {
            view.edit_repository_location(Some(paths[2].clone()), true, cx)
        });
        cx.simulate_path_prompt_response(|_| Some(vec![new_path.clone()]));
        cx.run_until_parked();
        paths[2] = new_path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        view.read_with(cx, |view, _| {
            assert_eq!(
                view.projects[0].repositories,
                vec![("Same name".into(), paths[2].clone())]
            );
            assert_eq!(
                view.projects[0].selected_repository.as_ref(),
                Some(&paths[2])
            );
            assert!(view.status.is_empty(), "{}", view.status);
        });
        assert_eq!(
            std::fs::read(&automation).unwrap(),
            automation_before,
            "Relinking must preserve automation definitions"
        );
        let catalog = crate::backend::RUNTIME
            .block_on(backend.request(
                reqwest::Method::GET,
                &format!("/api/projects?projectId={project_id}"),
                None,
            ))
            .unwrap();
        assert_eq!(catalog["catalog"]["repositoryPaths"][ids[2]], paths[2]);
        assert_eq!(catalog["catalog"]["automations"][0]["enabled"], false);
        std::fs::remove_file(automation).unwrap();
        view.update(cx, |view, cx| {
            view.edit_repository(Some(paths[2].clone()), cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(view.projects[0].repositories.is_empty(), "{}", view.status);
            assert!(view.projects[0].selected_repository.is_none());
            assert!(view.repository_view.is_none());
            assert!(!view.repository);
            assert!(view.status.is_empty());
        });
        let saved: serde_json::Value = serde_json::from_slice(
            &std::fs::read(
                profile
                    .path()
                    .join("projects")
                    .join(project_id)
                    .join("project.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(saved["repositories"].as_array().unwrap().is_empty());
        for path in &paths {
            assert_eq!(
                std::fs::read_to_string(std::path::Path::new(path).join("keep.txt")).unwrap(),
                "keep"
            );
        }
    }

    #[gpui::test]
    fn repository_poll_refreshes_visible_panel_even_when_counts_match(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().to_string_lossy().into_owned();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.projects[0].repositories = vec![("Repository".into(), path.clone())];
            view.repository = true;
            view.open_repository(path, cx);
            view.refresh_repository_stats(cx);
            view
        });
        cx.run_until_parked();
        let notifications = std::rc::Rc::new(std::cell::Cell::new(0));
        let count = notifications.clone();
        let subscription = window
            .update(cx, |view, _, cx| {
                cx.observe(view.repository_view.as_ref().unwrap(), move |_, _, _| {
                    count.set(count.get() + 1);
                })
            })
            .unwrap();
        cx.background_executor
            .advance_clock(std::time::Duration::from_secs(5));
        cx.run_until_parked();
        assert!(notifications.get() > 0);
        window
            .update(cx, |view, _, _| view.repository = false)
            .unwrap();
        notifications.set(0);
        cx.background_executor
            .advance_clock(std::time::Duration::from_secs(5));
        cx.run_until_parked();
        assert_eq!(notifications.get(), 0);
        drop(subscription);
    }

    #[gpui::test]
    fn reopening_repository_reuses_loaded_view(cx: &mut gpui::TestAppContext) {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            WorkspaceView::empty(cx.focus_handle(), input, cx)
        });
        window
            .update(cx, |view, _, cx| {
                let first = first.path().to_string_lossy().into_owned();
                let second = second.path().to_string_lossy().into_owned();
                view.projects[0].repositories = vec![
                    ("First".into(), first.clone()),
                    ("Second".into(), second.clone()),
                ];
                view.open_repository(first.clone(), cx);
                let original = view.repository_view.clone().unwrap();
                original.update(cx, |repo, _| repo.expanded = true);
                view.open_repository(second.clone(), cx);
                assert_ne!(
                    view.repository_view.as_ref().unwrap().entity_id(),
                    original.entity_id()
                );
                view.open_repository(first.clone(), cx);
                assert_eq!(
                    view.repository_view.as_ref().unwrap().entity_id(),
                    original.entity_id()
                );
                assert!(view.repository_expanded);
                view.select_project(0, cx);
                assert_eq!(
                    view.repository_view.as_ref().unwrap().entity_id(),
                    original.entity_id()
                );
                assert_eq!(
                    view.projects[0].selected_repository.as_deref(),
                    Some(first.as_str())
                );
            })
            .unwrap();
    }

    #[gpui::test]
    fn queue_edit_escape_restores_the_main_draft(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.status.clear();
            view.conversations[0].loaded = true;
            view.conversations[0].queue =
                vec![serde_json::json!({"id":"queued", "text":"original"})];
            view.conversations[0]
                .input
                .update(cx, |input, cx| input.set_content("main draft", cx));
            view
        });
        cx.simulate_resize(size(px(1024.), px(768.)));
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| {
            view.clone().into_any_element()
        });
        let edit = cx.debug_bounds("edit-queued").unwrap();
        cx.simulate_click(edit.center(), Modifiers::default());
        view.read_with(cx, |view, cx| {
            let editor = &view.conversations[0].queue_editor.as_ref().unwrap().1;
            assert!(editor.read(cx).submit_on_enter);
        });
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| {
            view.clone().into_any_element()
        });
        cx.simulate_keystrokes("escape");
        view.read_with(cx, |view, cx| {
            let chat = &view.conversations[0];
            assert!(chat.queue_editor.is_none());
            assert!(chat.queue_submit.is_none());
            assert_eq!(chat.queue[0]["text"], "original");
            assert_eq!(chat.input.read(cx).content.as_ref(), "main draft");
        });
    }

    #[gpui::test]
    fn long_transcript_keeps_the_composer_in_the_viewport(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.status.clear();
            let chat = &mut view.conversations[0];
            chat.loaded = true;
            let mut messages = Vec::new();
            for i in 0..1_000 {
                let message: ChatTranscriptMessage = serde_json::from_value(serde_json::json!({
                    "id":format!("row-{i}"),"role":"assistant","content":"A long conversation keeps its composer visible.\n\nThis paragraph wraps as the pane becomes narrower."
                })).unwrap();
                messages.push(std::sync::Arc::new(message));
            }
            chat.transcript.publish(PreparedTranscript::prepare(0, messages, "vscode-black"), None);
            view
        });
        cx.simulate_resize(size(px(1024.), px(768.)));
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| {
            view.clone().into_any_element()
        });
        view.read_with(cx, |view, _| {
            let list = &view.conversations[0].transcript.scroll;
            assert!(list.viewport_bounds().size.height > px(100.));
            assert!(
                list.viewport_bounds().bottom() < px(740.),
                "{:?}",
                list.viewport_bounds()
            );
            assert!(list.is_following_tail());
            assert!(list.logical_scroll_top().item_ix >= 990);
            assert!(list.bounds_for_item(0).is_none());
        });
        let composer = cx.debug_bounds("chat-composer").unwrap();
        assert!(composer.size.height > px(40.));
        assert!(composer.bottom() <= px(768.));
        let pane = cx.debug_bounds("chat-pane").unwrap();
        assert_eq!(composer.size.width, px(624.));
        assert!(
            ((composer.left() - pane.left()) - (pane.right() - composer.right())).abs() < px(1.)
        );
        assert_eq!(composer.size.height, px(94.));
        let input = cx.debug_bounds("chat-input-shell").unwrap();
        let controls = cx.debug_bounds("chat-input-row").unwrap();
        let options = cx.debug_bounds("chat-input-options").unwrap();
        assert!(controls.top() - input.top() >= px(8.));
        assert!(input.bottom() - options.bottom() >= px(8.));
        view.read_with(cx, |view, _| {
            assert_eq!(
                view.conversations[0]
                    .transcript
                    .scroll
                    .viewport_bounds()
                    .bottom(),
                input.top() - px(8.)
            );
        });
        let message = cx.debug_bounds("chat-message-column").unwrap();
        assert_eq!(message.left(), composer.left());
        assert_eq!(message.size.width, composer.size.width);
        cx.simulate_resize(size(px(800.), px(560.)));
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        let composer = cx.debug_bounds("chat-composer").unwrap();
        assert!(composer.bottom() <= px(560.));
        assert!(composer.bottom() > px(500.));
        let pane = cx.debug_bounds("chat-pane").unwrap();
        assert_eq!(composer.size.width, pane.size.width);
        assert_eq!(composer.left(), pane.left());
        view.update(cx, |view, cx| {
            let scroll = &view.conversations[0].transcript.scroll;
            scroll.set_follow_mode(FollowMode::Normal);
            scroll.scroll_to(ListOffset {
                item_ix: 0,
                offset_in_item: px(0.),
            });
            cx.notify();
        });
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        let latest = cx.debug_bounds("latest-message").unwrap();
        cx.simulate_click(latest.center(), Modifiers::default());
        view.read_with(cx, |view, _| {
            assert!(view.conversations[0].transcript.scroll.is_following_tail())
        });
        view.update(cx, |view, cx| {
            view.conversations[0].run.is_loading = true;
            view.conversations[0].run.start_time = Some(1);
            view.conversations[0].queue = (0..20).map(|i| serde_json::json!({
                "id":format!("queued-{i}"), "text":"A follow-up message waiting for the active response.",
                "transient":i == 19
            })).collect();
            cx.notify();
        });
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        let activity = cx.debug_bounds("chat-activity").unwrap();
        assert_eq!(activity.size.height, px(20.));
        let input = cx.debug_bounds("chat-input-shell").unwrap();
        assert_eq!(activity.bottom(), input.top());
        let submit = cx.debug_bounds("chat-submit").unwrap();
        assert!(submit.top() >= input.top() && submit.bottom() <= input.bottom());
        assert!(cx.debug_bounds("chat-live-progress").is_none());
        view.read_with(cx, |view, _| {
            assert_eq!(
                view.conversations[0]
                    .transcript
                    .scroll
                    .viewport_bounds()
                    .bottom(),
                activity.top() - px(8.)
            );
        });
        let queue = cx.debug_bounds("chat-queue").unwrap();
        assert!(activity.bottom() <= queue.top());
        assert!(queue.size.height <= px(112.));
        assert!(queue.size.height > px(80.));
        let composer = cx.debug_bounds("chat-composer").unwrap();
        assert!(composer.bottom() <= px(560.));
        assert!(composer.size.height > px(160.));
    }

    #[gpui::test]
    fn first_live_messages_are_visible_after_an_empty_transcript(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.status.clear();
            view.conversations[0].loaded = true;
            view
        });
        cx.simulate_resize(size(px(1024.), px(768.)));
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| {
            view.clone().into_any_element()
        });
        view.update(cx, |view, cx| {
            let chat = &mut view.conversations[0];
            let message: ChatTranscriptMessage = serde_json::from_value(
                serde_json::json!({"id":"help", "role":"system", "content":"Available commands"}),
            )
            .unwrap();
            chat.transcript.publish(
                PreparedTranscript::prepare(0, [std::sync::Arc::new(message)], "vscode-black"),
                None,
            );
            cx.notify();
        });
        cx.simulate_resize(size(px(1024.), px(768.)));
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| {
            view.clone().into_any_element()
        });
        view.read_with(cx, |view, _| {
            let list = &view.conversations[0].transcript.scroll;
            assert!(list.viewport_bounds().size.height > px(100.));
            assert!(list.bounds_for_item(0).is_some());
        });
    }

    #[gpui::test]
    fn connector_timeline_is_visible_while_running_and_expands(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.status.clear();
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"live-tool","name":"mcp__github__list_issues","input":{"repo":"example"},"done":false}));
            let chat = &mut view.conversations[0];
            chat.loaded = true;
            chat.run.is_loading = true;
            chat.run.status = "tool:mcp__github__list_issues".into();
            chat.transcript.publish(PreparedTranscript::prepare(0, buffer.messages().iter().cloned().map(std::sync::Arc::new), "vscode-black"), None);
            view
        });
        cx.simulate_resize(size(px(800.), px(560.)));
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        let row = cx.debug_bounds("tool-timeline-row").unwrap();
        assert!(row.size.height >= px(24.));
        assert!(cx.debug_bounds("tool-source").is_some());
        assert!(row.size.height <= px(30.));
        assert!(cx.debug_bounds("tool-details-live-tool").is_none());
        cx.simulate_click(row.center(), Modifiers::default());
        view.read_with(cx, |view, _| assert!(view.expanded.contains("live-tool")));
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-details-live-tool").is_some());
        let row = cx.debug_bounds("tool-timeline-row").unwrap();
        cx.simulate_click(row.center(), Modifiers::default());
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-details-live-tool").is_none());
        view.update(cx, |view, cx| {
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"live-tool","name":"mcp__github__list_issues","input":{"repo":"example"},"output":"result line\n".repeat(3),"done":true}));
            view.conversations[0].transcript.publish(PreparedTranscript::prepare(0, buffer.messages().iter().cloned().map(std::sync::Arc::new), "vscode-black"), None);
            cx.notify();
        });
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-details-live-tool").is_none());
        let row = cx.debug_bounds("tool-timeline-row").unwrap();
        assert!(row.size.height <= px(30.));
        cx.simulate_click(row.center(), Modifiers::default());
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-details-live-tool").is_some());
    }

    #[gpui::test]
    fn restored_edit_details_are_closed_until_clicked(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.replace_messages(vec![serde_json::from_value(serde_json::json!({"id":"edit", "role":"tool", "toolName":"Edit", "content":"{\"file_path\":\"main.rs\",\"old_string\":\"old\",\"new_string\":\"new\"}"})).unwrap()]);
            view.conversations[0].transcript.publish(PreparedTranscript::prepare(0, buffer.messages().iter().cloned().map(std::sync::Arc::new), "vscode-black"), None);
            view
        });
        cx.simulate_resize(size(px(800.), px(560.)));
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-edit-card").is_none());
        assert!(cx.debug_bounds("tool-details-edit").is_none());
        let row = cx.debug_bounds("tool-timeline-row").unwrap();
        cx.simulate_click(row.center(), Modifiers::default());
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-edit-card").is_some());
    }

    #[gpui::test]
    fn sending_starts_timer_immediately_and_failure_restores_idle(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let backend = crate::backend::RUNTIME
            .block_on(crate::backend::Backend::connect(profile.path().to_owned()))
            .unwrap();
        let (commands, _receiver) = tokio::sync::mpsc::channel::<live::Command>(1);
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some("missing-pane".into());
            chat.commands = Some(commands);
            chat.input
                .update(cx, |input, cx| input.set_content("hello", cx));
            view.send_chat(0, false, cx);
            let chat = &view.conversations[0];
            assert!(chat.run.is_loading);
            assert!(chat.run.start_time.is_some());
            assert_eq!(chat.run.status, "sending");
            view
        });
        cx.run_until_parked();
        window
            .update(cx, |view, _, cx| {
                let chat = &view.conversations[0];
                assert!(!chat.run.is_loading);
                assert!(chat.run.start_time.is_none());
                assert_eq!(chat.run.status, "idle");
                assert_eq!(chat.input.read(cx).content.as_ref(), "hello");
                assert!(chat.error.is_some());
            })
            .unwrap();
    }

    #[gpui::test]
    fn stop_targets_the_active_pane_and_retains_the_draft_on_failure(
        cx: &mut gpui::TestAppContext,
    ) {
        let profile = tempfile::tempdir().unwrap();
        let backend = crate::backend::RUNTIME
            .block_on(crate::backend::Backend::connect(profile.path().to_owned()))
            .unwrap();
        let (commands, mut requests) = tokio::sync::mpsc::channel::<live::Command>(1);
        let received = crate::backend::RUNTIME.spawn(async move {
            let command = requests.recv().await.unwrap();
            assert_eq!(
                command.message,
                serde_json::json!({"type":"chat:stop","paneId":"test-running-pane"})
            );
            command
                .completed
                .send(Err("connection closed".into()))
                .unwrap();
        });
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.profile = profile.path().to_owned();
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some("test-running-pane".into());
            chat.commands = Some(commands);
            chat.run.is_loading = true;
            chat.input
                .update(cx, |input, cx| input.set_content("next message draft", cx));
            view.send_chat(0, true, cx);
            view.send_chat(0, true, cx); // An in-flight request cannot be submitted twice.
            view
        });
        cx.run_until_parked();
        crate::backend::RUNTIME.block_on(received).unwrap();
        window
            .update(cx, |view, _, cx| {
                let chat = &view.conversations[0];
                assert!(!chat.sending);
                assert_eq!(chat.input.read(cx).content.as_ref(), "next message draft");
                assert!(chat.error.as_deref().unwrap().contains("connection closed"));
            })
            .unwrap();
    }

    #[gpui::test]
    fn settings_restores_input_focus_and_draft(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.profile = profile.path().to_owned();
            view
        });
        window
            .update(cx, |view, window, cx| {
                let input = view.conversations[0].input.clone();
                input.update(cx, |input, _| input.content = "unfinished".into());
                let focus = input.read(cx).focus_handle(cx);
                window.focus(&focus, cx);
                view.set_settings(true, window, cx);
                assert!(view.focus.is_focused(window));
                assert!(!focus.is_focused(window));
                view.set_settings(false, window, cx);
                assert!(focus.is_focused(window));
                assert_eq!(input.read(cx).content.as_ref(), "unfinished");
            })
            .unwrap();
    }
    #[gpui::test]
    fn project_switch_restores_its_own_chat_and_draft(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.profile = profile.path().to_owned();
            view
        });
        window
            .update(cx, |view, window, cx| {
                view.restore(
                    crate::session::Session {
                        closed_projects: Default::default(),
                        zoom: crate::zoom::Zoom::default(),
                        default_config: inferay_core::provider_config::resolve(&serde_json::json!(
                            {}
                        )),
                        projects: vec![
                            crate::session::Project {
                                id: None,
                                name: "Alpha".into(),
                                repositories: vec![],
                                panes: vec![],
                                dock: serde_json::Value::Null,
                                dock_workspace: None,
                            },
                            crate::session::Project {
                                id: None,
                                name: "Beta".into(),
                                repositories: vec![],
                                panes: vec![],
                                dock: serde_json::Value::Null,
                                dock_workspace: None,
                            },
                        ],
                        sidebar_width: 212.,
                        sidebar_collapsed: false,
                        drafts: Default::default(),
                        chat_settings: Default::default(),
                        selected_project: 0,
                        selected_pane: None,
                        background: serde_json::Value::Null,
                        font: "vscode".into(),
                        syntax_theme: "vscode-black".into(),
                        graph_preferences: serde_json::Value::Null,
                    },
                    cx,
                );
                view.new_chat(window, cx);
                let alpha_chat = view.selected;
                view.conversations[alpha_chat]
                    .input
                    .update(cx, |input, _| input.content = "Alpha draft".into());
                view.select_project(1, cx);
                assert_ne!(view.selected, alpha_chat);
                assert_eq!(view.conversations[view.selected].project, 1);
                assert!(
                    view.conversations[view.selected]
                        .input
                        .read(cx)
                        .content
                        .is_empty()
                );
                view.select_project(0, cx);
                assert_eq!(view.selected, alpha_chat);
                assert_eq!(
                    view.conversations[view.selected]
                        .input
                        .read(cx)
                        .content
                        .as_ref(),
                    "Alpha draft"
                );
            })
            .unwrap();
    }
    #[gpui::test]
    fn new_chat_keeps_the_previous_draft(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.profile = profile.path().to_owned();
            view
        });
        window
            .update(cx, |view, window, cx| {
                view.conversations[0]
                    .input
                    .update(cx, |input, _| input.content = "Keep this draft".into());
                let previous_config = serde_json::to_value(&view.conversations[0].config).unwrap();
                view.default_config = inferay_core::provider_config::resolve(
                    &serde_json::json!({"agentKind":"claude"}),
                );
                view.new_chat(window, cx);
                assert_eq!(view.conversations[1].config.agent_kind.as_str(), "claude");
                assert_eq!(
                    serde_json::to_value(&view.conversations[0].config).unwrap(),
                    previous_config
                );
                assert_eq!(view.selected, 1);
                assert!(view.conversations[1].input.read(cx).content.is_empty());
                assert_eq!(
                    view.conversations[0].input.read(cx).content.as_ref(),
                    "Keep this draft"
                );
                assert!(view.conversations[0].transcript.rows().is_empty());
                assert!(view.conversations[1].transcript.rows().is_empty());
            })
            .unwrap();
    }
}
