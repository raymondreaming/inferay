mod lifecycle;
mod live;
mod settings;
use crate::{Back, Settings, ToggleSidebar, button, colors, icon, input::TextInput};
use gpui::{prelude::*, *};
use inferay_core::chat_protocol::ChatTranscriptMessage;
use std::collections::HashSet;

#[derive(Clone, Copy, PartialEq)]
enum Appearance {
    Dark,
    Glass,
    Scene,
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
    total_messages: usize,
    loading: bool,
    error: Option<String>,
    task: Option<Task<()>>,
    live_task: Option<Task<()>>,
    metadata_task: Option<Task<()>>,
    commands: Option<tokio::sync::mpsc::Sender<live::Command>>,
    command_task: Option<Task<()>>,
    sending: bool,
    running: bool,
    start_time: Option<f64>,
    run_status: String,
    queue: Vec<serde_json::Value>,
    queue_task: Option<Task<()>>,
    queue_editor: Option<(String, Entity<TextInput>)>,
    queue_submit: Option<Subscription>,
    connection_error: Option<String>,
    submit_subscription: Option<Subscription>,
    draft_subscription: Option<Subscription>,
    draft_task: Option<Task<()>>,
    title: String,
    input: Entity<TextInput>,
    messages: Vec<ChatTranscriptMessage>,
    rich: Vec<crate::rich_text::RichText>,
    scroll: ListState,
    loaded: bool,
    config: inferay_core::provider_config::ProviderSettings,
}
pub struct WorkspaceView {
    backend: std::sync::Arc<tokio::sync::OnceCell<std::sync::Arc<crate::backend::Backend>>>,
    default_config: inferay_core::provider_config::ProviderSettings,
    focus: FocusHandle,
    projects: Vec<Project>,
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
    sidebar_resize: Option<(Pixels, f32)>,
    repositories_collapsed: bool,
    chat_width: f32,
    dock_resize: Option<(Vec<&'static str>, Bounds<Pixels>, bool, serde_json::Value)>,
    repository: bool,
    repository_expanded: bool,
    repository_width: f32,
    repository_resize: Option<(Pixels, f32)>,
    repository_subscription: Option<Subscription>,
    repository_add_task: Option<Task<()>>,
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
                    let result = cx.background_executor().spawn(async move {
                        crate::backend::RUNTIME.block_on(async {
                            backend.get_or_try_init(|| crate::backend::Backend::connect(profile)).await?
                                .request(reqwest::Method::GET, "/api/app-info", None).await
                        })
                    }).await;
                    if this.update(cx, |view, cx| {
                        if let Ok(info) = result {
                            view.update_available = info["production"] == true && info["update"]["available"] == true;
                            cx.notify();
                        }
                    }).is_err() { break; }
                    cx.background_executor().timer(std::time::Duration::from_secs(900)).await;
                }
            }));
        }
        view
    }
    fn reveal_startup(&mut self, cx: &mut Context<Self>) {
        if !self.restored || self.scene_task.is_some() { return; }
        let Some(handle) = self.startup_window.take() else { return; };
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
            profile: crate::session::profile(),
            load_task: None,
            startup_window: None,
            restored: false,
            update_task: None,
            update_available: false,
            preference_updates: None,
            preference_task: None,
            conversations: vec![Conversation {
                closed: false,
                close_task: None,
                images: vec![],
                project: 0,
                pane: None,
                total_messages: 0,
                loading: false,
                error: None,
                task: None,
                live_task: None,
                metadata_task: None,
                commands: None,
                command_task: None,
                sending: false,
                running: false,
                start_time: None,
                run_status: "idle".into(),
                queue: Vec::new(),
                queue_task: None,
                queue_editor: None,
                queue_submit: None,
                connection_error: None,
                submit_subscription: None,
                draft_subscription: None,
                draft_task: None,
                title: "New chat".into(),
                input,
                messages: vec![],
                rich: vec![],
                scroll: ListState::new(0, ListAlignment::Top, px(300.)),
                loaded: false,
                config: inferay_core::provider_config::resolve(&serde_json::json!({})),
            }],
            selected: 0,
            project: 0,
            sidebar: true,
            sidebar_width: 212.,
            sidebar_resize: None,
            repositories_collapsed: false,
            chat_width: 1000.,
            dock_resize: None,
            repository: false,
            repository_expanded: false,
            repository_width: 584.,
            repository_resize: None,
            repository_subscription: None,
            repository_add_task: None,
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
            status: "Loading your saved workspace…".into(),
        }
    }
    fn restore(&mut self, session: crate::session::Session, cx: &mut Context<Self>) {
        self.default_config = session.default_config;
        self.sidebar = !session.sidebar_collapsed;
        self.sidebar_width = session.sidebar_width;
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
                self.conversations.push(Conversation {
                closed: false,
                close_task: None,
                images: vec![],
                    project,
                    pane: Some(pane.id),
                    total_messages: 0,
                    loading: false,
                    error: None,
                    task: None,
                    live_task: None,
                    metadata_task: None,
                    commands: None,
                    command_task: None,
                    sending: false,
                    running: false,
                start_time: None,
                run_status: "idle".into(),
                queue: Vec::new(),
                queue_task: None,
                queue_editor: None,
                queue_submit: None,
                    connection_error: None,
                    submit_subscription: None,
                    draft_subscription: None,
                    draft_task: None,
                    title: pane
                        .summary
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| format!("{} chat", pane.agent_kind)),
                    input,
                    messages: vec![],
                    rich: vec![],
                    scroll: ListState::new(0, ListAlignment::Top, px(300.)),
                    loaded: false,
                    config,
                });
            }
            if self.conversations.len() == first {
                self.conversations.push(Conversation {
                closed: false,
                close_task: None,
                images: vec![],
                    project,
                    pane: None,
                    total_messages: 0,
                    loading: false,
                    error: None,
                    task: None,
                    live_task: None,
                    metadata_task: None,
                    commands: None,
                    command_task: None,
                    sending: false,
                    running: false,
                start_time: None,
                run_status: "idle".into(),
                queue: Vec::new(),
                queue_task: None,
                queue_editor: None,
                queue_submit: None,
                    connection_error: None,
                    submit_subscription: None,
                    draft_subscription: None,
                    draft_task: None,
                    title: "New chat".into(),
                    input: cx.new(TextInput::new),
                    messages: vec![],
                    rich: vec![],
                    scroll: ListState::new(0, ListAlignment::Top, px(300.)),
                    loaded: false,
                    config: self.default_config.clone(),
                });
            }
        }
        self.status.clear();
        self.select_project(session.selected_project, cx);
    }
    fn select_project(&mut self, index: usize, cx: &mut Context<Self>) {
        self.project = index;
        self.selected = self.projects[index].selected;
        self.settings = false;
        self.menu = None;
        self.status.clear();
        self.repository_view = None;
        self.repository_subscription = None;
        if let Some(path) = self.projects[index].selected_repository.clone().or_else(|| self.projects[index].repositories.first().map(|(_, path)| path.clone())) {
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
        let paths = self.projects[self.project].repositories.iter().map(|(_, path)| path.clone()).collect::<Vec<_>>();
        self.repository_stats_task = Some(cx.spawn(async move |this, cx| {
            loop {
                let paths = paths.clone();
                let stats = cx.background_executor().spawn(async move {
                    paths.into_iter().filter_map(|path| inferay_native_diff::get_git_status(&path).map(|status| (path, status.change_summary()))).collect()
                }).await;
                if this.update(cx, |s, cx| { s.repository_stats = stats; cx.notify(); }).is_err() { break; }
                cx.background_executor().timer(std::time::Duration::from_secs(5)).await;
            }
        }));
    }
    fn add_repository(&mut self, cx: &mut Context<Self>) {
        if self.repository_add_task.is_some() { return; }
        let Some(project_id) = self.projects[self.project].id.clone() else { return; };
        let Some(backend) = self.backend.get().cloned() else { return; };
        let selected = cx.prompt_for_paths(PathPromptOptions { files: false, directories: true, multiple: false, prompt: Some("Add repository to workspace".into()) });
        self.repository_add_task = Some(cx.spawn(async move |this, cx| {
            let result = async {
                let paths = selected.await??;
                let Some(path) = paths.and_then(|paths| paths.into_iter().next()) else { return Ok(None); };
                let id = project_id.clone();
                cx.background_executor().spawn(async move {
                    crate::backend::RUNTIME.block_on(async {
                        let endpoint = format!("/api/projects?projectId={id}");
                        let workspace: inferay_core::project_files::ProjectWorkspace = serde_json::from_value(backend.request(reqwest::Method::GET, &endpoint, None).await?)?;
                        let project = workspace.catalog.projects.iter().find(|p| p.id == id).ok_or_else(|| anyhow::anyhow!("Project no longer exists"))?;
                        backend.request(reqwest::Method::POST, "/api/projects/command", Some(serde_json::json!({"type":"editRepository", "projectId":id, "expectedHash":project.source_hash, "change":{"kind":"add", "path":path}}))).await?;
                        let workspace: inferay_core::project_files::ProjectWorkspace = serde_json::from_value(backend.request(reqwest::Method::GET, &endpoint, None).await?)?;
                        let definition = workspace.catalog.projects.iter().find(|p| p.id == id).and_then(|p| p.definition.as_ref()).ok_or_else(|| anyhow::anyhow!("Project no longer exists"))?;
                        let repositories = definition.repositories.iter().filter_map(|repo| workspace.catalog.repository_paths.get(&repo.id).map(|path| (repo.name.clone(), path.clone()))).collect::<Vec<_>>();
                        Ok::<_, anyhow::Error>(Some((repositories, path.to_string_lossy().into_owned())))
                    })
                }).await
            }.await;
            let _ = this.update(cx, |s, cx| {
                s.repository_add_task = None;
                match result {
                    Ok(Some((repositories, path))) => {
                        if let Some(project) = s.projects.iter_mut().find(|p| p.id.as_ref() == Some(&project_id)) { project.repositories = repositories; }
                        if s.projects[s.project].id.as_ref() == Some(&project_id) { s.open_repository(path, cx); s.refresh_repository_stats(cx); }
                    }
                    Ok(None) => (),
                    Err(error) => s.status = format!("Could not add repository: {error}"),
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
            let view = cx.new(|cx| crate::repository::RepositoryView::new(
                path.clone(), self.graph_preferences.clone(), self.syntax_theme.clone(),
                if self.appearance == Appearance::Glass { 0x0d0d0d } else { colors::CANVAS }, cx));
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
                    crate::repository::RepositoryEvent::Expand => s.repository_expanded = !s.repository_expanded,
                    crate::repository::RepositoryEvent::Select(path) => s.open_repository(path.clone(), cx),
                    crate::repository::RepositoryEvent::Add => s.add_repository(cx),
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
                let rich = messages
                    .iter()
                    .map(|message| crate::rich_text::RichText::message(message, &theme))
                    .collect();
                (total, messages, rich)
            })
        });
        chat.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| {
                let chat = &mut view.conversations[index];
                chat.loading = false;
                match result {
                    Ok((total, messages, rich)) => {
                        if !chat.loaded {
                            chat.scroll.set_follow_mode(FollowMode::Tail);
                        }
                        chat.loaded = true;
                        chat.scroll
                            .splice(0..chat.scroll.item_count(), messages.len());
                        chat.rich = rich;
                        chat.total_messages = total;
                        chat.messages = messages;
                        view.connect_chat(index, cx);
                    }
                    Err(error) => chat.error = Some(format!("Could not load chat: {error:#}")),
                }
                cx.notify();
            });
        }));
    }
    fn new_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.add_chat(cx);
        self.create_chat(self.selected, cx);
        window.focus(&self.conversations[self.selected].input.focus_handle(cx), cx);
    }
    fn add_chat(&mut self, cx: &mut Context<Self>) {
        let input = cx.new(TextInput::new);
        self.conversations.push(Conversation {
                closed: false,
                close_task: None,
                images: vec![],
            project: self.project,
            pane: None,
            total_messages: 0,
            loading: false,
            error: None,
            task: None,
            live_task: None,
            metadata_task: None,
            commands: None,
            command_task: None,
            sending: false,
            running: false,
                start_time: None,
                run_status: "idle".into(),
                queue: Vec::new(),
                queue_task: None,
                queue_editor: None,
                queue_submit: None,
            connection_error: None,
            submit_subscription: None,
            draft_subscription: None,
            draft_task: None,
            title: "New chat".into(),
            input,
            messages: vec![],
            rich: vec![],
            scroll: ListState::new(0, ListAlignment::Top, px(300.)),
            loaded: false,
            config: self.default_config.clone(),
        });
        self.selected = self.conversations.len() - 1;
        self.projects[self.project].selected = self.selected;
        self.settings = false;
        cx.notify();
    }
    fn titlebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .h(px(38.))
            .flex_shrink_0()
            .pl(px(76.))
            .pr(px(8.))
            .gap(px(4.))
            .child(
                button("sidebar", "")
                    .aria_label("Toggle sidebar")
                    .child(icon("PanelLeft"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.sidebar = !s.sidebar;
                        s.persist_workspace_preferences(None, cx);
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
                    .children(self.projects.iter().enumerate().map(|(i, project)| {
                        let name = project.name.clone();
                        div()
                            .id(("project", i))
                            .role(Role::Tab)
                            .aria_selected(self.project == i)
                            .aria_label(name.clone())
                            .h(px(30.))
                            .flex_shrink_0()
                            .px(px(12.))
                            .flex()
                            .items_center()
                            .gap(px(7.))
                            .rounded(px(7.))
                            .text_size(px(colors::CHAT_SMALL))
                            .font_weight(FontWeight::MEDIUM)
                            .cursor_pointer()
                            .when(self.project == i, |d| d.bg(rgba(0xebebeb17)))
                            .hover(|s| s.bg(rgba(0xebebeb10)))
                            .child(icon("Folder"))
                            .child(name)
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.select_project(i, cx);
                                s.persist_workspace_preferences(None, cx);
                            }))
                    }))
                    .child(div().flex_1().h_full().min_w(px(16.)).on_mouse_down(
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
        div().id("sidebar").relative().w(px(self.sidebar_width)).h_full().flex_shrink_0().flex().flex_col().overflow_y_scroll().px(px(8.)).pt(px(8.))
            .children([("Bookmark", "Memory"), ("Sparkles", "Plugins"), ("Workflow", "Automations")].into_iter().map(|(glyph, name)| {
                button(name, "").aria_label(name).h(px(32.)).gap(px(10.)).text_size(px(colors::CHAT_SMALL)).child(icon(glyph)).child(name)
                    .on_click(cx.listener(move |s, _, _, cx| { s.status = format!("{name} is available in the current Inferay app. This preview covers the workspace and appearance."); cx.notify(); }))
            }))
            .child(button("repositories-toggle", "").h(px(32.)).gap(px(10.)).text_size(px(colors::CHAT_SMALL)).text_color(rgba(0xebebeb80)).child(icon("GitBranch")).child("Repositories").child(div().flex_1()).child(icon(if self.repositories_collapsed { "ChevronRight" } else { "ChevronDown" }))
                .on_click(cx.listener(|s, _, _, cx| { s.repositories_collapsed = !s.repositories_collapsed; cx.notify(); })))
            .children(self.projects[self.project].repositories.iter().enumerate().filter(|_| !self.repositories_collapsed).map(|(i, (name, path))| {
                let path = path.clone();
                button(("repo", i), "").aria_label(name.clone()).h(px(32.)).pl(px(26.)).text_size(px(colors::CHAT_SMALL)).child(icon("GitBranch")).child(div().flex_1().min_w_0().text_ellipsis().child(name.clone()))
                    .when_some(self.repository_stats.get(&path), |d, stats| d
                        .child(div().text_size(px(11.)).text_color(rgb(0x4fbd83)).child(format!("+{}", stats.additions)))
                        .child(div().text_size(px(11.)).text_color(rgb(0xdf6464)).child(format!("−{}", stats.deletions))))
                    .on_click(cx.listener(move |s, _, _, cx| { s.repository = true; s.open_repository(path.clone(), cx); cx.notify(); }))
            }))
            .child(div().h(px(1.)).bg(rgba(0xebebeb0f)).my(px(14.)))
            .child(div().flex().items_center().justify_between().px(px(9.)).mb(px(10.)).text_color(rgba(0xebebeb80)).text_size(px(colors::CHAT_SMALL)).child("Chats")
                .child(button("new-chat", "New chat").child(icon("Plus")).on_click(cx.listener(|s, _, w, cx| s.new_chat(w, cx)))))
            .children(self.conversations.iter().enumerate().filter(|(_, chat)| !chat.closed && chat.project == self.project).map(|(i, chat)| {
                div().id(("chat", i)).role(Role::Button).aria_label(chat.title.clone()).flex().items_center().gap(px(8.)).px(px(9.)).h(px(36.)).mb(px(3.)).rounded(px(6.))
                    .border_1().border_color(if i == self.selected { rgba(0xebebeb0f) } else { rgba(0) })
                    .when(i == self.selected, |d| d.bg(rgba(0xebebeb17))).hover(|s| s.bg(rgba(0xebebeb0d))).cursor_pointer()
                    .child(icon("codex")).child(div().flex_1().min_w_0().text_size(px(colors::CHAT_SMALL)).overflow_hidden().text_ellipsis().child(chat.title.clone()))
                    .child(button(("close-chat", i), "").aria_label("Close chat and stop agent").debug_selector(|| "close-chat".into())
                        .child(icon("X").size(px(12.)))
                        .on_click(cx.listener(move |s, _, _, cx| { cx.stop_propagation(); s.close_chat(i, cx); })))
                    .on_click(cx.listener(move |s, _, _, cx| { s.selected = i; s.projects[s.project].selected = i; s.persist_workspace_preferences(None, cx); s.settings = false; if !s.conversations[i].loaded && !s.conversations[i].loading { s.load_transcript(200, cx); } cx.notify(); }))
            }))
            .child(div().flex_1())
            .child(button("settings", "").child(icon("Settings")).child("Settings").on_click(cx.listener(|s, _, window, cx| s.set_settings(true, window, cx))))
            .when(self.update_available, |d| d.child(button("update-available", "Update available").on_click(cx.listener(|s, _, window, cx| {
                s.set_settings(true, window, cx);
                s.settings_page("about", cx);
            }))))
            .child(div().id("sidebar-resize").absolute().right(px(-2.)).top_0().w(px(5.)).h_full().cursor_col_resize().on_mouse_down(MouseButton::Left, cx.listener(|s, e: &MouseDownEvent, _, cx| { s.sidebar_resize = Some((e.position.x, s.sidebar_width)); cx.stop_propagation(); })))
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
            .px(px(0.))
            .pt(px(0.))
            .pb(px(0.))
            .child(
                div()
                    .w_full()
                    .max_w(px(624.))
                    .px(px(12.))
                    .mx_auto()
                    .when(chat.loading && !chat.loaded, |d| {
                        d.child(div().child("Loading saved messages…"))
                    })
                    .when_some(
                        chat.error.clone().or_else(|| chat.connection_error.clone()),
                        |d, error| d.child(div().child(error)),
                    )
                    .when(chat.total_messages > chat.messages.len(), |d| {
                        d.child(
                            button(("older-messages", index), "Load older messages").on_click(
                                cx.listener(move |s, _, _, cx| {
                                    let limit = s.conversations[index].messages.len() + 200;
                                    s.load_chat(index, limit, cx);
                                    cx.notify();
                                }),
                            ),
                        )
                    })
                    .when(
                        chat.messages.is_empty() && !chat.loading && chat.error.is_none(),
                        |d| {
                            d.child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .justify_center()
                                    .items_center()
                                    .h(px(300.))
                                    .gap(px(12.))
                                    .child(icon("codex").size(px(28.)))
                                    .child(
                                        div()
                                            .text_size(px(18.))
                                            .child("What would you like to work on?"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(colors::CHAT_SMALL))
                                            .text_color(rgba(0xebebeb80))
                                            .child("Start a conversation below."),
                                    ),
                            )
                        },
                    ),
            )
            .child(
                list(
                    chat.scroll.clone(),
                    cx.processor(move |view, row, _, cx| view.transcript_row(index, row, cx)),
                )
                .flex_1()
                .min_h_0()
                .w_full(),
            )
            .when(chat.running, |d| d.child(
                div().debug_selector(|| "chat-live-progress".into()).w_full().max_w(px(624.)).mx_auto().px(px(12.)).py(px(4.))
                    .text_size(px(colors::CHAT_SMALL)).text_color(rgba(0xebebeb80))
                    .child(match chat.run_status.as_str() {
                        "sending" => "Sending message…".to_owned(),
                        "thinking" => "Thinking…".to_owned(),
                        "responding" => "Writing response…".to_owned(),
                        status if status.starts_with("tool:") => inferay_core::tool_presentation::display(Some(&status[5..]), &serde_json::Value::Null).label,
                        "idle" | "" => "Working…".to_owned(),
                        status => status.to_owned(),
                    })
            ))
            .when(
                !chat.messages.is_empty() && !chat.scroll.is_following_tail(),
                |d| {
                    d.child(
                        button(("latest-message", index), "")
                            .debug_selector(|| "latest-message".into())
                            .aria_label("Scroll to latest message")
                            .absolute()
                            .right(px(8.))
                            .bottom(px(8.))
                            .w(px(24.))
                            .h(px(24.))
                            .px(px(5.))
                            .rounded_full()
                            .border_1()
                            .border_color(rgba(0xebebeb26))
                            .bg(rgb(0x202020))
                            .child(icon("ChevronDown").size(px(12.)))
                            .on_click(cx.listener(move |view, _, _, cx| {
                                view.conversations[index]
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
        let message = &chat.messages[message_index];
        if message.render.as_ref().is_some_and(|r| r.hidden) {
            return div().h(px(0.)).into_any_element();
        }
        let last_visible = !chat.messages[message_index + 1..].iter()
            .any(|message| !message.render.as_ref().is_some_and(|render| render.hidden));
        let id = message.id.clone();
        let content = message.content.clone();
        let row = if message.role == "tool" {
            let open = self.expanded.contains(&id);
            let render = message.render.as_ref();
            let display = render.and_then(|r| r.display.as_ref());
            let label = display
                .map(|d| d.label.clone())
                .or_else(|| message.tool_name.clone())
                .unwrap_or_else(|| "Tool output".into());
            div()
                .relative()
                .max_w(px(544.))
                .mx_auto()
                .pl(px(12.))
                .pb(px(if last_visible { 0. } else { 4. }))
                .when(
                    render.is_some_and(|render| render.continues_after),
                    |d| d.border_l_1().border_color(rgba(0xebebeb24)),
                )
                .child(
                    div()
                        .absolute()
                        .left(px(-3.))
                        .top(px(9.))
                        .size(px(6.))
                        .rounded_full()
                        .bg(rgb(0x202020))
                        .border_1()
                        .border_color(rgba(0xebebeb40))
                        .when(message.is_streaming == Some(true), |dot| dot.child(
                            div().absolute().inset_0().rounded_full().bg(rgb(0x8ab4f8))
                                .with_animation(SharedString::from(format!("tool-active-{id}")), Animation::new(std::time::Duration::from_millis(1200)).repeat(),
                                    |dot, phase| dot.opacity(0.45 + 0.55 * (phase * std::f32::consts::PI).sin())))),
                )
                .child(
                    div()
                        .id(SharedString::from(id.clone()))
                        .debug_selector(|| "tool-timeline-row".into())
                        .role(Role::Button)
                        .aria_label(label.clone())
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .min_h(px(24.))
                        .px(px(4.))
                        .cursor_pointer()
                        .text_size(px(colors::CHAT_SMALL))
                        .text_color(rgba(0xebebebb8))
                        .when_some(display.and_then(|display| display.source.as_ref()), |d, source| d.child(
                            div().debug_selector(|| "tool-source".into()).flex_shrink_0().text_size(px(colors::CHAT_DETAIL)).text_color(rgb(0x8ab4f8))
                                .child(source.server_label.clone())))
                        .child(
                            div()
                                .min_w_0()
                                .text_ellipsis()
                                .font_weight(FontWeight::MEDIUM)
                                .child(label),
                        )
                        .when_some(display.and_then(|d| d.detail.clone()), |d, detail| {
                            d.child(
                                div()
                                    .text_color(rgba(0xebebeb70))
                                    .max_w(relative(0.42))
                                    .font_family("Menlo")
                                    .text_size(px(colors::CHAT_DETAIL))
                                    .text_ellipsis()
                                    .child(detail.split_whitespace().collect::<Vec<_>>().join(" ")),
                            )
                        })
                        .child(div().flex_1())
                        .child(
                            icon(if open { "ChevronDown" } else { "ChevronRight" }).size(px(12.)),
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            if !s.expanded.remove(&id) {
                                s.expanded.insert(id.clone());
                            }
                            s.conversations[index]
                                .scroll
                                .remeasure_items(message_index..message_index + 1);
                            cx.notify();
                        })),
                )
                .when(!open && !content.trim().is_empty(), |d| {
                    let preview = content.lines().rev().filter(|line| !line.trim().is_empty()).take(3).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
                    let preview: String = preview.chars().take(360).collect();
                    d.child(div().debug_selector(|| "tool-output-preview".into()).ml(px(4.)).mb(px(4.)).px(px(8.)).py(px(4.))
                        .border_l_1().border_color(rgba(0xebebeb20)).text_size(px(colors::CHAT_DETAIL))
                        .text_color(rgba(0xebebeb80)).font_family("Menlo").child(preview))
                })
                .when_some(render.and_then(|r| r.edit.as_ref()), |d, edit| {
                    d.child(crate::rich_text::edit_card(edit))
                })
                .when(open, |d| {
                    d.child(
                        div()
                            .ml(px(4.))
                            .py(px(4.))
                            .rounded(px(6.))
                            .bg(rgba(0xffffff06))
                            .font_family("Menlo")
                            .text_size(px(colors::CHAT_DETAIL))
                            .child(chat.rich[message_index].render(&message.id))
                            .child(div().flex().justify_end().child(
                                button(SharedString::from(format!("copy-tool-{}", message.id)), "Copy output")
                                    .h(px(24.)).on_click({ let content = content.clone(); move |_, _, cx| {
                                        cx.write_to_clipboard(ClipboardItem::new_string(content.clone()));
                                    }}))),
                    )
                })
                .into_any_element()
        } else if let Some(card) = message
            .render
            .as_ref()
            .and_then(crate::rich_text::system_card)
        {
            card
        } else if message.role == "system" {
            div()
                .mt(px(4.)).mb(px(if last_visible { 0. } else { 4. }))
                .text_size(px(colors::CHAT_SMALL))
                .text_color(rgba(0xebebeb80))
                .child(crate::selectable::SelectableText { id: format!("message-text-{}", message.id).into(), text: content, highlights: vec![], links: vec![] })
                .into_any_element()
        } else if message.role == "user" {
            div()
                .flex()
                .justify_end()
                .mb(px(if last_visible { 0. } else { 8. }))
                .child(
                    div()
                        .max_w(relative(0.85))
                        .px(px(10.))
                        .py(px(6.))
                        .rounded(px(8.))
                        .rounded_br(px(2.))
                        .children(message.images.iter().flatten().map(|path| img(std::path::PathBuf::from(path)).w(px(220.)).h(px(150.)).object_fit(ObjectFit::Contain)))
                        .child(crate::selectable::SelectableText { id: format!("message-text-{}", message.id).into(), text: content, highlights: vec![], links: vec![] }),
                )
                .into_any_element()
        } else {
            div()
                .mb(px(if last_visible { 0. } else { 8. }))
                .child(
                    div()
                        .line_height(px(colors::CHAT_BODY * 1.6))
                        .text_color(rgba(0xebebebb8))
                        .child(chat.rich[message_index].render(&message.id)),
                )
                .when(message.is_streaming != Some(true) && !content.trim().is_empty(), |d| d.child(
                    div().flex().justify_end().mt(px(4.)).child(
                        button(SharedString::from(format!("copy-{}", message.id)), "Copy")
                            .h(px(24.))
                            .px(px(6.))
                            .text_color(rgba(0xebebeb80))
                            .child(icon("Copy").size(px(12.)))
                            .on_click(move |_, _, cx| {
                                cx.write_to_clipboard(ClipboardItem::new_string(content.clone()))
                            }),
                    ),
                ))
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
                    .max_w(px(624.))
                    .px(px(12.))
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
                    cx.processor(|s, bounds: Bounds<Pixels>, _, cx| {
                        let width: f32 = bounds.size.width.into();
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
                            .min_h(px(min_height))
                            .w(relative(width))
                            .child(self.dock_branch(&layout["tree"], &layout["tree"], vec![], window, cx)),
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
                        .flex_basis(px(0.))
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
                                .when(horizontal, |d| d.left(px(2.)).w(px(1.)).h_full())
                                .when(!horizontal, |d| d.top(px(2.)).h(px(1.)).w_full()),
                        )
                        .when(tree["direction"] == "horizontal", |d| {
                            d.w(px(5.)).mx(px(-2.)).h_full().cursor_col_resize()
                        })
                        .when(tree["direction"] == "vertical", |d| {
                            d.h(px(5.)).my(px(-2.)).w_full().cursor_row_resize()
                        }),
                )
                .child(
                    div()
                        .flex_basis(px(0.))
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
            .on_drop(cx.listener(move |s, paths: &ExternalPaths, _, cx| s.attach_images(index, paths.paths().to_vec(), cx)))
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
    fn composer(&self, index: usize, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
        div().debug_selector(|| "chat-composer".into()).relative().w_full().max_w(px(624.)).mx_auto().px(px(12.)).pt(px(0.)).pb(px(8.)).flex_shrink_0()
            .when(!self.status.is_empty(), |d| d.child(div().px(px(8.)).pb(px(10.)).text_size(px(11.)).text_color(rgba(0xebebeb80)).child(self.status.clone())))
            .when(chat.running, |d| d.child(
                div().debug_selector(|| "chat-activity".into()).flex().items_center().justify_between().h(px(20.)).pb(px(4.))
                    .child(div().h(px(16.)).flex().items_center().when_some(chat.start_time, |d, start| d.child(
                        div().id(("activity-time", index)).flex().items_center().gap(px(6.)).with_animation(
                            ("chat-activity", index), Animation::new(std::time::Duration::from_millis(1500)).repeat(),
                            move |d, phase| {
                                let seconds = ((std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000. - start).max(0.) / 1000.) as u64;
                                let elapsed = if seconds < 60 { format!("{seconds}s") } else if seconds < 3600 { format!("{}m {}s", seconds / 60, seconds % 60) } else { format!("{}h {}m", seconds / 3600, seconds / 60 % 60) };
                                d.aria_label(format!("Agent active, {elapsed} elapsed"))
                                    .child(div().relative().size(px(14.)).children((0..25).map(|i| {
                                        let row = i / 5;
                                        let column = i % 5;
                                        let ring = (2_i32 - row).abs() + (2_i32 - column).abs();
                                        let delay = (ring as f32 * 0.14 + (ring % 2) as f32 * 0.03) / 1.5;
                                        let t = (phase - delay).rem_euclid(1.);
                                        let stops = [(0., 0.1), (0.28, 0.98), (0.56, 0.32), (0.78, 0.78), (1., 0.1)];
                                        let pair = stops.windows(2).find(|pair| t <= pair[1].0).unwrap();
                                        let opacity = pair[0].1 + (pair[1].1 - pair[0].1) * (t - pair[0].0) / (pair[1].0 - pair[0].0);
                                        div().absolute().left(px(column as f32 * 3.)).top(px(row as f32 * 3.)).size(px(2.)).rounded(px(1.)).bg(rgba(0xebebebb3)).opacity(opacity)
                                    })))
                                    .child(div().font_family("Menlo").text_size(px(10.)).text_color(rgba(0xebebeb80)).child(elapsed))
                            },
                        )
                    )))
                    .child(button(("activity-stop", index), "").aria_label("Stop generation").size(px(16.)).p(px(0.)).justify_center().border_1().border_color(rgba(0xebebeb1a)).rounded(px(4.)).child(icon("Stop").size(px(12.)))
                        .on_click(cx.listener(move |view, _, _, cx| view.send_chat(index, true, cx))))
            ))
            .child(div().debug_selector(|| "chat-input-shell".into()).relative().rounded(px(12.)).border_1().border_color(rgba(0xebebeb0f))
                .when(chat.running || chat.input.focus_handle(cx).is_focused(window), |d| d.child(
                    div().absolute().inset_0().rounded(px(12.)).overflow_hidden().with_animation(("composer-beam", index), Animation::new(std::time::Duration::from_millis(2500)).repeat(), |d, phase| d.child(
                        canvas(|_, _, _| (), move |bounds, _, window, _| {
                            let width = f32::from(bounds.size.width);
                            let height = f32::from(bounds.size.height);
                            let radius = 11_f32.min(width / 2.).min(height / 2.);
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
                                    let mut path = PathBuilder::stroke(px(stroke));
                                    path.move_to(position(progress * perimeter));
                                    path.line_to(position((segment + 1) as f32 / 240. * perimeter));
                                    if let Ok(path) = path.build() { window.paint_path(path, hsla((progress + phase * 0.1) % 1., 0.8, 0.65, alpha * opacity)); }
                                }
                            }
                        }).size_full()
                    ))
                ))
                .bg(match self.appearance { Appearance::Dark => rgba(0x2f2f2fff), _ => rgba(0x181818e0) })
                .when(!chat.queue.is_empty(), |d| d.child(
                    div().id(("chat-queue", index)).debug_selector(|| "chat-queue".into()).max_h(px(112.)).overflow_y_scroll().p(px(4.))
                        .border_b_1().border_color(rgba(0xebebeb0f))
                        .children(chat.queue.iter().enumerate().map(|(position, message)| {
                            let text = message["displayText"].as_str().filter(|s| !s.is_empty())
                                .or_else(|| message["text"].as_str()).unwrap_or("").to_owned();
                            div().flex().items_start().gap(px(8.)).px(px(8.)).py(px(4.)).text_size(px(12.))
                                .child(div().flex_shrink_0().w(px(20.)).text_color(rgba(0xebebeb80)).child((position + 1).to_string()))
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
                                .when(message["transient"].as_bool().unwrap_or(false), |d| d.child(
                                    div().flex_shrink_0().text_color(rgba(0xebebeb80)).child("Steering…")))
                                .when(!message["transient"].as_bool().unwrap_or(false), |d| {
                                    let id = message["id"].as_str().unwrap_or("").to_owned();
                                    let edit_id = id.clone();
                                    let editing = chat.queue_editor.as_ref().is_some_and(|(id, _)| id == &edit_id);
                                    d.child(button(("edit-queued", position), "").debug_selector(|| "edit-queued".into())
                                        .w(px(20.)).h(px(20.)).px(px(3.)).child(icon(if editing { "Check" } else { "Pencil" }).size(px(14.)))
                                        .aria_label(if editing { "Save queued message" } else { "Edit queued message" })
                                        .on_click(cx.listener(move |view, _, window, cx| {
                                            let chat = &mut view.conversations[index];
                                            if chat.queue_task.is_some() { return; }
                                            if let Some((id, input)) = &chat.queue_editor && id == &edit_id {
                                                let text = input.read(cx).content.to_string();
                                                view.update_queued_message(index, edit_id.clone(), Some(text), cx);
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
                                                        view.update_queued_message(index, id, Some(text), cx);
                                                    }
                                                }));
                                                window.focus(&input.focus_handle(cx), cx);
                                                chat.queue_editor = Some((edit_id.clone(), input));
                                                cx.notify();
                                            }
                                        })))
                                    .when(editing, |d| d.child(button(("cancel-queued", position), "")
                                        .w(px(20.)).h(px(20.)).px(px(3.)).child(icon("X").size(px(14.)))
                                        .aria_label("Cancel queued message edit")
                                        .on_click(cx.listener(move |view, _, window, cx| {
                                            view.conversations[index].queue_editor = None;
                                            view.conversations[index].queue_submit = None;
                                            window.focus(&view.conversations[index].input.focus_handle(cx), cx);
                                            cx.notify();
                                        }))))
                                    .when(!editing, |d| d.child(button(("remove-queued", position), "").aria_label("Remove from queue")
                                        .w(px(20.)).h(px(20.)).px(px(3.)).child(icon("Trash").size(px(14.)))
                                        .opacity(if chat.queue_task.is_some() { 0.4 } else { 1. })
                                        .on_click(cx.listener(move |view, _, _, cx| view.update_queued_message(index, id.clone(), None, cx)))))
                                })
                        }))
                ))
                .when(!chat.images.is_empty(), |d| d.child(div().flex().flex_wrap().gap(px(6.)).p(px(8.)).children(chat.images.iter().enumerate().map(|(i, path)| {
                    let path = path.clone();
                    div().relative().child(img(path).w(px(72.)).h(px(56.)).object_fit(ObjectFit::Contain).rounded(px(6.)))
                        .child(button(("remove-image", i), "×").aria_label("Remove image").absolute().top_0().right_0().w(px(18.)).h(px(18.)).px(px(3.)).bg(rgb(0x222222)).on_click(cx.listener(move |s, _, _, cx| { s.conversations[index].images.remove(i); cx.notify(); })))
                }))))
                .child(div().flex().items_end().gap(px(4.)).pl(px(4.)).pr(px(12.)).py(px(6.))
                    .child(div().flex().items_center().gap(px(2.)).flex_shrink_0()
                        .children([("Plus", "Attach image"), ("Mic", "Start voice input")].into_iter().map(|(glyph, label)| {
                            button((label, index), "").aria_label(label).w(px(28.)).h(px(28.)).px(px(6.)).child(icon(glyph).size(px(16.)))
                                .on_click(cx.listener(move |s, _, _, cx| { if glyph == "Plus" { s.pick_chat_images(index, cx); } else { s.status = format!("{label} is not connected in the native preview yet."); cx.notify(); } }))
                        })))
                    .child(div().flex_1().min_w_0().child(chat.input.clone()))
                    .child(button(("send-chat", index), "").aria_label(if chat.running { "Stop generating" } else { "Send message" })
                        .w(px(28.)).h(px(28.)).px(px(6.))
                        .opacity(if chat.commands.is_some() && !chat.sending { 1. } else { 0.4 })
                        .child(icon(if chat.running { "Stop" } else { "Send" }).size(px(16.)))
                        .on_click(cx.listener(move |view, _, _, cx| view.send_chat(index, view.conversations[index].running, cx)))))
                .child(div().flex().flex_wrap().items_center().px(px(8.)).pb(px(4.)).gap(px(4.))
                    .children([("provider", definition.label), ("model", model), ("reasoning", reasoning)].into_iter().map(|(name, value)| {
                        button((name, index), "").aria_label(format!("{name}: {value}")).h(px(24.)).px(px(4.)).gap(px(4.)).text_size(px(10.)).flex_shrink_0()
                            .when(name == "provider", |d| d.child(icon(if chat.config.agent_kind.as_str() == "codex" { "codex" } else { "Sparkles" }).size(px(10.))))
                            .child(value).child(icon("ChevronDown").size(px(9.)))
                            .on_click(cx.listener(move |s, _, _, cx| { s.selected = index; s.menu = if s.menu == Some((index, name)) { None } else { Some((index, name)) }; cx.notify(); }))
                    }))))
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
            .bottom(px(38.))
            .left(px(12.))
            .w(px(180.))
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
        div()
            .relative()
            .size_full()
            .font_family(self.font)
            .text_size(px(colors::CHAT_BODY))
            .text_color(rgb(colors::TEXT))
            .bg(shell)
            .track_focus(&self.focus)
            .on_mouse_move(cx.listener(|s, event: &MouseMoveEvent, _, cx| {
                if let Some((start, width)) = s.repository_resize {
                    s.repository_width = (width + f32::from(start - event.position.x)).max(280.);
                    cx.notify();
                }
                if let Some((start, width)) = s.sidebar_resize {
                    s.sidebar_width =
                        (width + f32::from(event.position.x - start)).clamp(188., 340.);
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
                                .pr(px(6.))
                                .pb(px(6.))
                                .when(self.sidebar, |d| d.child(self.sidebar(cx)))
                                .child(
                                    div()
                                        .flex()
                                        .flex_1()
                                        .min_w_0()
                                        .rounded(px(12.))
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
                                                                            d.w(px(self.repository_width))
                                                                                .max_w(relative(
                                                                                    0.65,
                                                                                ))
                                                                                .flex_shrink_0()
                                                                        },
                                                                    )
                                                                    .relative()
                                                                    .child(view)
                                                                    .when(!self.repository_expanded, |d| d.child(
                                                                        div().id("resize-repository").absolute().left_0().top_0().w(px(6.)).h_full().cursor_col_resize()
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
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn startup_waits_for_decoded_background(cx: &mut gpui::TestAppContext) {
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            WorkspaceView::empty(cx.focus_handle(), input, cx)
        });
        cx.run_until_parked();
        window.update(cx, |view, _, cx| {
            assert!(view.startup_window.is_none());
            view.restored = true;
            view.set_background(&serde_json::json!({"mode":"scene","id":"city","blur":0}), cx);
            assert!(view.scene.is_none());
            assert!(view.scene_task.is_some());
            assert!(!view.restored || view.scene_task.is_some());
            cx.notify();
        }).unwrap();
        cx.run_until_parked();
        window.update(cx, |view, _, _| {
            assert!(view.scene.is_some());
            assert!(view.scene_task.is_none());
        }).unwrap();
    }

    #[gpui::test]
    fn reopening_repository_reuses_loaded_view(cx: &mut gpui::TestAppContext) {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            WorkspaceView::empty(cx.focus_handle(), input, cx)
        });
        window.update(cx, |view, _, cx| {
            let first = first.path().to_string_lossy().into_owned();
            let second = second.path().to_string_lossy().into_owned();
            view.projects[0].repositories = vec![("First".into(), first.clone()), ("Second".into(), second.clone())];
            view.open_repository(first.clone(), cx);
            let original = view.repository_view.clone().unwrap();
            original.update(cx, |repo, _| repo.expanded = true);
            view.open_repository(second.clone(), cx);
            assert_ne!(view.repository_view.as_ref().unwrap().entity_id(), original.entity_id());
            view.open_repository(first.clone(), cx);
            assert_eq!(view.repository_view.as_ref().unwrap().entity_id(), original.entity_id());
            assert!(view.repository_expanded);
            view.select_project(0, cx);
            assert_eq!(view.repository_view.as_ref().unwrap().entity_id(), original.entity_id());
            assert_eq!(view.projects[0].selected_repository.as_deref(), Some(first.as_str()));
        }).unwrap();
    }

    #[gpui::test]
    fn queue_edit_escape_restores_the_main_draft(cx: &mut gpui::TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.status.clear();
            view.conversations[0].loaded = true;
            view.conversations[0].queue = vec![serde_json::json!({"id":"queued", "text":"original"})];
            view.conversations[0].input.update(cx, |input, cx| input.set_content("main draft", cx));
            view
        });
        cx.simulate_resize(size(px(1024.), px(768.)));
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| view.clone().into_any_element());
        let edit = cx.debug_bounds("edit-queued").unwrap();
        cx.simulate_click(edit.center(), Modifiers::default());
        view.read_with(cx, |view, cx| {
            let editor = &view.conversations[0].queue_editor.as_ref().unwrap().1;
            assert!(editor.read(cx).submit_on_enter);
        });
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| view.clone().into_any_element());
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
            for i in 0..1_000 {
                let message: ChatTranscriptMessage = serde_json::from_value(serde_json::json!({
                    "id":format!("row-{i}"),"role":"assistant","content":"A long conversation keeps its composer visible.\n\nThis paragraph wraps as the pane becomes narrower."
                })).unwrap();
                chat.rich.push(crate::rich_text::RichText::message(&message, "vscode-black"));
                chat.messages.push(message);
            }
            chat.scroll.splice(0..0, chat.messages.len());
            chat.scroll.set_follow_mode(FollowMode::Tail);
            view
        });
        cx.simulate_resize(size(px(1024.), px(768.)));
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| {
            view.clone().into_any_element()
        });
        view.read_with(cx, |view, _| {
            let list = &view.conversations[0].scroll;
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
        assert_eq!(composer.size.height, px(78.));
        let input = cx.debug_bounds("chat-input-shell").unwrap();
        view.read_with(cx, |view, _| {
            assert_eq!(view.conversations[0].scroll.viewport_bounds().bottom(), input.top());
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
            let scroll = &view.conversations[0].scroll;
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
            assert!(view.conversations[0].scroll.is_following_tail())
        });
        view.update(cx, |view, cx| {
            view.conversations[0].running = true;
            view.conversations[0].start_time = Some(1.);
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
        let progress = cx.debug_bounds("chat-live-progress").unwrap();
        view.read_with(cx, |view, _| {
            assert_eq!(view.conversations[0].scroll.viewport_bounds().bottom(), progress.top());
            assert_eq!(progress.bottom(), activity.top());
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
            chat.rich.push(crate::rich_text::RichText::message(
                &message,
                "vscode-black",
            ));
            chat.messages.push(message);
            chat.scroll.splice(0..0, 1);
            chat.scroll.scroll_to_end();
            cx.notify();
        });
        cx.simulate_resize(size(px(1024.), px(768.)));
        cx.draw(point(px(0.), px(0.)), size(px(1024.), px(768.)), |_, _| {
            view.clone().into_any_element()
        });
        view.read_with(cx, |view, _| {
            let list = &view.conversations[0].scroll;
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
            chat.running = true;
            chat.run_status = "tool:mcp__github__list_issues".into();
            chat.messages = buffer.messages().to_vec();
            chat.rich = chat.messages.iter().map(|m| crate::rich_text::RichText::message(m, "vscode-black")).collect();
            chat.scroll.splice(0..0, chat.messages.len());
            view
        });
        cx.simulate_resize(size(px(800.), px(560.)));
        cx.draw(point(px(0.), px(0.)), size(px(800.), px(560.)), |_, _| view.clone().into_any_element());
        let row = cx.debug_bounds("tool-timeline-row").unwrap();
        assert!(row.size.height >= px(24.));
        assert!(cx.debug_bounds("tool-source").is_some());
        assert!(cx.debug_bounds("tool-output-preview").is_some());
        cx.simulate_click(row.center(), Modifiers::default());
        view.read_with(cx, |view, _| assert!(view.expanded.contains("live-tool")));
    }

    #[gpui::test]
    fn sending_starts_timer_immediately_and_failure_restores_idle(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let backend = crate::backend::RUNTIME.block_on(crate::backend::Backend::connect(profile.path().to_owned())).unwrap();
        let (commands, _receiver) = tokio::sync::mpsc::channel::<live::Command>(1);
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            let mut view = WorkspaceView::empty(cx.focus_handle(), input, cx);
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            let chat = &mut view.conversations[0];
            chat.pane = Some("missing-pane".into());
            chat.commands = Some(commands);
            chat.input.update(cx, |input, cx| input.set_content("hello", cx));
            view.send_chat(0, false, cx);
            let chat = &view.conversations[0];
            assert!(chat.running);
            assert!(chat.start_time.is_some());
            assert_eq!(chat.run_status, "sending");
            view
        });
        cx.run_until_parked();
        window.update(cx, |view, _, cx| {
            let chat = &view.conversations[0];
            assert!(!chat.running);
            assert!(chat.start_time.is_none());
            assert_eq!(chat.run_status, "idle");
            assert_eq!(chat.input.read(cx).content.as_ref(), "hello");
            assert!(chat.error.is_some());
        }).unwrap();
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
            chat.running = true;
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
                assert!(view.conversations[0].messages.is_empty());
                assert!(view.conversations[1].messages.is_empty());
            })
            .unwrap();
    }
}
