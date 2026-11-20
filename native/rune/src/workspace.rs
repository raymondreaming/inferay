mod attachments;
mod completions;
mod composer;
mod conversation;
mod grid;
mod lifecycle;
mod live;
mod project_pages;
mod proposals;
mod settings;
mod shell;

use crate::backend::Backend;
use crate::input::TextInput;
use crate::repository::RepositoryView;
use crate::task::Task;
use crate::transcript::{PreparedTranscript, Transcript};
use inferay_core::chat_status::ChatRunStatus;
use rune::Tx;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(crate) use shell::view;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Appearance {
    Dark,
    Glass,
    Scene,
}

pub(crate) struct Project {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    pub(crate) repositories: Vec<(String, String)>,
    pub(crate) selected_repository: Option<String>,
    pub(crate) selected: usize,
    pub(crate) dock: serde_json::Value,
    pub(crate) dock_workspace: Option<(String, String)>,
}

pub(crate) struct Conversation {
    pub(crate) closed: bool,
    pub(crate) close_task: Option<Task>,
    pub(crate) images: Vec<std::path::PathBuf>,
    pub(crate) project: usize,
    pub(crate) pane: Option<String>,
    pub(crate) loading: bool,
    pub(crate) error: Option<String>,
    pub(crate) task: Option<Task>,
    pub(crate) live_task: Option<Task>,
    pub(crate) metadata_task: Option<Task>,
    pub(crate) commands: Option<tokio::sync::mpsc::Sender<live::Command>>,
    pub(crate) command_task: Option<Task>,
    pub(crate) sending: bool,
    pub(crate) run: ChatRunStatus,
    pub(crate) queue: Vec<serde_json::Value>,
    pub(crate) requests: Vec<serde_json::Value>,
    pub(crate) request_inputs: HashMap<String, TextInput>,
    pub(crate) request_task: Option<Task>,
    pub(crate) queue_task: Option<Task>,
    pub(crate) queue_editor: Option<(String, TextInput)>,
    pub(crate) connection_error: Option<String>,
    pub(crate) submit_ready: bool,
    pub(crate) completion: completions::State,
    pub(crate) draft: Option<lifecycle::Draft>,
    pub(crate) draft_task: Option<Task>,
    pub(crate) title: String,
    pub(crate) input: TextInput,
    pub(crate) transcript: Transcript,
    pub(crate) theme_task: Option<Task>,
    pub(crate) loaded: bool,
    pub(crate) config: inferay_core::provider_config::ProviderSettings,
}

impl Conversation {
    pub(crate) fn new(
        project: usize,
        input: TextInput,
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
            connection_error: None,
            submit_ready: false,
            completion: Default::default(),
            draft: None,
            draft_task: None,
            title: "New chat".into(),
            transcript: Transcript::new(),
            theme_task: None,
            loaded: false,
        }
    }
}

pub(crate) struct SidebarResize {
    pub(crate) width: f32,
}

pub(crate) struct DockResize {
    pub(crate) path: Vec<&'static str>,
    pub(crate) tree: serde_json::Value,
}

pub struct Workspace {
    pub(crate) backend: Arc<tokio::sync::OnceCell<Arc<Backend>>>,
    pub(crate) default_config: inferay_core::provider_config::ProviderSettings,
    pub(crate) projects: Vec<Project>,
    pub(crate) closed_projects: HashSet<String>,
    pub(crate) closed_repositories: HashMap<String, HashSet<String>>,
    pub(crate) project_picker: bool,
    pub(crate) new_menu: bool,
    pub(crate) new_project_name: Option<TextInput>,
    pub(crate) new_project_repository: Option<std::path::PathBuf>,
    pub(crate) new_project_task: Option<Task>,
    pub(crate) profile: std::path::PathBuf,
    pub(crate) load_task: Option<Task>,
    pub(crate) restored: bool,
    pub(crate) update_task: Option<Task>,
    pub(crate) update_available: bool,
    pub(crate) preference_updates:
        Option<tokio::sync::mpsc::UnboundedSender<lifecycle::PreferenceSave>>,
    pub(crate) preference_task: Option<Task>,
    pub(crate) conversations: Vec<Conversation>,
    pub(crate) selected: usize,
    pub(crate) project: usize,
    pub(crate) sidebar: bool,
    pub(crate) sidebar_width: f32,
    pub(crate) zoom: crate::zoom::Zoom,
    pub(crate) sidebar_resize: Option<SidebarResize>,
    pub(crate) repositories_collapsed: bool,
    pub(crate) chat_width: f32,
    pub(crate) viewport: (f32, f32),
    pub(crate) dock_resize: Option<DockResize>,
    pub(crate) repository: bool,
    pub(crate) repository_expanded: bool,
    pub(crate) repository_width: f32,
    pub(crate) repository_resize: Option<f32>,
    pub(crate) repository_edit_task: Option<Task>,
    pub(crate) repository_stats_task: Option<Task>,
    pub(crate) repository_fetch_task: Option<Task>,
    pub(crate) repository_stats: HashMap<String, inferay_core::repository::GitChangeSummary>,
    pub(crate) font: &'static str,
    pub(crate) font_applied: Option<&'static str>,
    pub(crate) syntax_theme: String,
    pub(crate) project_pages: project_pages::State,
    pub(crate) repository_graph_preferences: HashMap<String, serde_json::Value>,
    pub(crate) glass_opacity: f32,
    pub(crate) repository_view: Option<String>,
    pub(crate) repository_views: HashMap<String, RepositoryView>,
    pub(crate) settings: bool,
    pub(crate) settings_state: settings::State,
    pub(crate) appearance: Appearance,
    pub(crate) scene: Option<rune::Pixels>,
    pub(crate) scene_task: Option<Task>,
    pub(crate) scene_dim: f32,
    pub(crate) menu: Option<(usize, &'static str)>,
    pub(crate) expanded: HashSet<String>,
    pub(crate) proposals: HashMap<String, proposals::State>,
    pub(crate) skill_proposals: HashMap<String, proposals::SkillState>,
    pub(crate) status: String,
    pub(crate) activity_second: u64,
}

impl Workspace {
    pub fn new() -> Self {
        let mut view = Self::empty();
        let profile = view.profile.clone();
        let backend = view.backend.clone();
        view.load_task = Some(crate::task::spawn(
            async move {
                if profile.join("agent-state.json").is_file() {
                    return crate::session::load(&profile);
                }
                let backend = backend
                    .get_or_try_init(|| Backend::connect(profile.clone()))
                    .await?;
                backend
                    .request(
                        reqwest::Method::POST,
                        "/api/agent/state/initialize",
                        Some(serde_json::json!({})),
                    )
                    .await?;
                crate::session::load(&profile)
            },
            |view: &mut Workspace, result, tx| {
                view.restored = true;
                match result {
                    Ok(session) => view.restore(session, tx),
                    Err(error) => view.status = format!("Could not load Inferay: {error:#}"),
                }
            },
        ));
        if std::env::var_os("INFERAY_EXTERNAL_BACKEND_ADDR").is_none() {
            let backend = view.backend.clone();
            let profile = view.profile.clone();
            view.update_task = Some(crate::task::detached(async move {
                loop {
                    let result = async {
                        backend
                            .get_or_try_init(|| Backend::connect(profile.clone()))
                            .await?
                            .request(reqwest::Method::GET, "/api/app-info", None)
                            .await
                    }
                    .await;
                    if let Ok(info) = result {
                        crate::task::update(move |view, _| {
                            view.update_available =
                                info["production"] == true && info["update"]["available"] == true;
                        });
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(900)).await;
                }
            }));
        }
        view
    }

    pub(crate) fn empty() -> Self {
        Self {
            backend: Default::default(),
            default_config: inferay_core::provider_config::resolve(&serde_json::json!({})),
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
            closed_repositories: Default::default(),
            project_picker: false,
            new_menu: false,
            new_project_name: None,
            new_project_repository: None,
            new_project_task: None,
            profile: crate::session::profile(),
            load_task: None,
            restored: false,
            update_task: None,
            update_available: false,
            preference_updates: None,
            preference_task: None,
            conversations: vec![Conversation::new(
                0,
                TextInput::new(),
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
            viewport: (1280., 820.),
            dock_resize: None,
            repository: false,
            repository_expanded: false,
            repository_width: 584.,
            repository_resize: None,
            repository_edit_task: None,
            repository_stats_task: None,
            repository_fetch_task: None,
            repository_stats: Default::default(),
            font: "System Font",
            font_applied: None,
            syntax_theme: "vscode-black".into(),
            project_pages: project_pages::State::new(),
            repository_graph_preferences: Default::default(),
            glass_opacity: 0.75,
            repository_view: None,
            repository_views: Default::default(),
            settings: false,
            settings_state: settings::State::new(),
            appearance: Appearance::Dark,
            scene: None,
            scene_task: None,
            scene_dim: 0.,
            menu: None,
            expanded: HashSet::new(),
            proposals: Default::default(),
            skill_proposals: Default::default(),
            status: "Loading your saved workspace…".into(),
            activity_second: 0,
        }
    }

    pub(crate) fn font_family(name: &str) -> &'static str {
        match name {
            "geist" => "Geist",
            "menlo" => "Menlo",
            "inter" => "Inter",
            "manrope" => "Manrope",
            "ibm-plex-sans" => "IBM Plex Sans",
            _ => "System Font",
        }
    }

    fn restore(&mut self, session: crate::session::Session, tx: &mut Tx) {
        self.closed_projects = session.closed_projects;
        self.closed_repositories = session.closed_repositories;
        self.default_config = session.default_config;
        self.sidebar = !session.sidebar_collapsed;
        self.sidebar_width = session.sidebar_width;
        self.zoom = session.zoom;
        self.set_background(&session.background);
        self.repository_graph_preferences = session.repository_graph_preferences;
        self.syntax_theme = session.syntax_theme;
        self.font = Self::font_family(session.font.as_str());
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
                let mut input = TextInput::new();
                input.set_content(&session.drafts.get(&pane.id).cloned().unwrap_or_default());
                let config = session.chat_settings.get(&pane.id).cloned().unwrap_or_else(|| {
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
                    TextInput::new(),
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
            self.select_project(selected, tx);
        } else {
            self.project_picker = true;
        }
    }

    pub(crate) fn close_project_tab(&mut self, index: usize, tx: &mut Tx) {
        self.closed_projects
            .insert(self.projects[index].id.clone().unwrap_or_default());
        if index == self.project {
            if let Some(next) = self
                .projects
                .iter()
                .position(|p| !self.closed_projects.contains(p.id.as_deref().unwrap_or("")))
            {
                self.select_project(next, tx);
            } else {
                self.project_picker = true;
                self.repository = false;
                self.repository_stats_task = None;
                self.repository_fetch_task = None;
            }
        }
        self.persist_workspace_preferences(None);
    }

    pub(crate) fn select_project(&mut self, index: usize, tx: &mut Tx) {
        self.closed_projects
            .remove(self.projects[index].id.as_deref().unwrap_or(""));
        self.project_picker = false;
        self.project = index;
        self.project_pages.page = None;
        self.project_pages.poll = None;
        self.selected = self.projects[index].selected;
        self.settings = false;
        self.menu = None;
        self.status.clear();
        self.repository_view = None;
        if let Some(path) = self.projects[index]
            .selected_repository
            .clone()
            .filter(|p| self.repository_is_open(p))
            .or_else(|| {
                self.projects[index]
                    .repositories
                    .iter()
                    .find(|(_, p)| self.repository_is_open(p))
                    .map(|(_, path)| path.clone())
            })
        {
            self.open_repository(path);
        }
        self.refresh_repository_stats();
        let indices: Vec<_> = self
            .conversations
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.closed && c.project == index)
            .map(|(i, _)| i)
            .collect();
        for i in indices {
            self.track_draft(i, false);
            if !self.conversations[i].loaded && !self.conversations[i].loading {
                self.load_chat(i, 200, tx);
            }
        }
    }

    pub(crate) fn refresh_repository_stats(&mut self) {
        let fetch_paths: Vec<String> = self.projects[self.project]
            .repositories
            .iter()
            .filter(|(_, path)| self.repository_is_open(path))
            .map(|(_, path)| path.clone())
            .collect();
        self.repository_fetch_task = Some(crate::task::guarded(move |fetch_alive| async move {
            while fetch_alive.load(std::sync::atomic::Ordering::Acquire) {
                for path in &fetch_paths {
                    let path = path.clone();
                    let result = tokio::task::spawn_blocking({
                        let path = path.clone();
                        move || inferay_native_diff::fetch_git_remotes_if_due(&path)
                    })
                    .await
                    .ok()
                    .flatten();
                    if !fetch_alive.load(std::sync::atomic::Ordering::Acquire) {
                        return;
                    }
                    if let Some(Ok(())) = result {
                        crate::task::update(move |s, _| {
                            if s.repository
                                && !s.settings
                                && s.projects[s.project].selected_repository.as_ref() == Some(&path)
                                && let Some(view) = s.repository_views.get_mut(&path)
                            {
                                view.refresh();
                            }
                        });
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            }
        }));
        let paths = self.projects[self.project]
            .repositories
            .iter()
            .map(|(_, path)| path.clone())
            .collect::<Vec<_>>();
        self.repository_stats_task = Some(crate::task::guarded(move |stats_alive| async move {
            while stats_alive.load(std::sync::atomic::Ordering::Acquire) {
                let paths = paths.clone();
                let Ok(stats) = tokio::task::spawn_blocking(move || {
                    paths
                        .into_iter()
                        .filter_map(|path| {
                            inferay_native_diff::get_git_status(&path)
                                .map(|status| (path, status.change_summary()))
                        })
                        .collect::<HashMap<_, _>>()
                })
                .await
                else {
                    return;
                };
                if !stats_alive.load(std::sync::atomic::Ordering::Acquire) {
                    return;
                }
                crate::task::update(move |s, _| {
                    if s.repository_stats != stats {
                        s.repository_stats = stats;
                    }
                    if s.repository
                        && !s.settings
                        && let Some(path) = s.repository_view.clone()
                        && let Some(view) = s.repository_views.get_mut(&path)
                    {
                        view.refresh();
                    }
                });
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }));
    }

    pub(crate) fn repository_is_open(&self, path: &str) -> bool {
        !self
            .closed_repositories
            .get(self.projects[self.project].id.as_deref().unwrap_or(""))
            .is_some_and(|paths| paths.contains(path))
    }

    pub(crate) fn close_repository(&mut self, path: String) {
        self.closed_repositories
            .entry(self.projects[self.project].id.clone().unwrap_or_default())
            .or_default()
            .insert(path.clone());
        self.status.clear();
        let next = self.projects[self.project]
            .selected_repository
            .clone()
            .filter(|p| p != &path && self.repository_is_open(p))
            .or_else(|| {
                self.projects[self.project]
                    .repositories
                    .iter()
                    .find(|(_, p)| self.repository_is_open(p))
                    .map(|(_, p)| p.clone())
            });
        self.repository_views.remove(&path);
        if let Some(next) = next {
            self.open_repository(next);
            if let Some(view) = self.current_repository_mut() {
                view.membership_error = None;
            }
        } else {
            self.projects[self.project].selected_repository = None;
            self.repository_view = None;
            self.repository = false;
        }
        self.persist_workspace_preferences(None);
    }

    pub(crate) fn reopen_repositories(&mut self) {
        self.closed_repositories
            .remove(self.projects[self.project].id.as_deref().unwrap_or(""));
        if let Some(path) = self.projects[self.project]
            .repositories
            .first()
            .map(|(_, p)| p.clone())
        {
            self.repository = true;
            self.open_repository(path);
        }
        self.persist_workspace_preferences(None);
    }

    pub(crate) fn current_repository_mut(&mut self) -> Option<&mut RepositoryView> {
        let path = self.repository_view.clone()?;
        self.repository_views.get_mut(&path)
    }

    pub(crate) fn edit_repository(&mut self, remove: Option<String>, tx: &mut Tx) {
        self.edit_repository_location(remove, false, tx);
    }

    pub(crate) fn edit_repository_location(
        &mut self,
        remove: Option<String>,
        relink: bool,
        tx: &mut Tx,
    ) {
        if self.repository_edit_task.is_some() {
            return;
        }
        if self.projects[self.project].id.is_none() {
            self.begin_project_creation();
            self.status = "Create a project to share repositories across its chats.".into();
            return;
        }
        if self.backend.get().is_none() {
            self.status = "The workspace is still connecting. Try again shortly.".into();
            return;
        }
        self.status.clear();
        if let Some(view) = self.current_repository_mut() {
            view.membership_error = None;
        }
        if remove.is_none() || relink {
            let _ = tx;
            crate::platform::prompt_for_paths(
                crate::platform::PathPrompt {
                    files: false,
                    directories: true,
                    multiple: false,
                    prompt: Some(if relink {
                        "Locate moved repository folder"
                    } else {
                        "Add repository to workspace"
                    }),
                },
                move |s: &mut Workspace, paths, _| {
                    if let Some(path) = paths.and_then(|paths| paths.into_iter().next()) {
                        s.apply_repository_edit(
                            path.to_string_lossy().into_owned(),
                            remove.clone(),
                            relink,
                        );
                    }
                },
            );
        } else if let Some(path) = remove.clone() {
            self.apply_repository_edit(path, remove, false);
        }
    }

    fn apply_repository_edit(&mut self, path: String, remove: Option<String>, relink: bool) {
        let Some(project_id) = self.projects[self.project].id.clone() else {
            return;
        };
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let removing = remove.is_some() && !relink;
        let id = project_id.clone();
        self.repository_edit_task = Some(crate::task::spawn(
            async move {
                let path = if removing {
                    path
                } else {
                    std::path::Path::new(&path)
                        .canonicalize()?
                        .to_string_lossy()
                        .into_owned()
                };
                let endpoint = format!("/api/projects?projectId={id}");
                let workspace: inferay_core::project_files::ProjectWorkspace =
                    serde_json::from_value(
                        backend
                            .request(reqwest::Method::GET, &endpoint, None)
                            .await?,
                    )?;
                let project = workspace
                    .catalog
                    .projects
                    .iter()
                    .find(|p| p.id == id)
                    .ok_or_else(|| anyhow::anyhow!("Project no longer exists"))?;
                let change = if removing || relink {
                    let repository = project
                        .definition
                        .as_ref()
                        .and_then(|definition| {
                            definition.repositories.iter().find(|repo| {
                                workspace.catalog.repository_paths.get(&repo.id) == remove.as_ref()
                            })
                        })
                        .ok_or_else(|| {
                            anyhow::anyhow!("Repository is no longer linked to this project")
                        })?;
                    if relink {
                        serde_json::json!({"kind":"relink", "id":repository.id, "path":path})
                    } else {
                        serde_json::json!({"kind":"remove", "id":repository.id})
                    }
                } else {
                    serde_json::json!({"kind":"add", "path":path})
                };
                backend
                    .request(
                        reqwest::Method::POST,
                        "/api/projects/command",
                        Some(serde_json::json!({"type":"editRepository", "projectId":id, "expectedHash":project.source_hash, "change":change})),
                    )
                    .await?;
                let workspace: inferay_core::project_files::ProjectWorkspace =
                    serde_json::from_value(
                        backend
                            .request(reqwest::Method::GET, &endpoint, None)
                            .await?,
                    )?;
                let definition = workspace
                    .catalog
                    .projects
                    .iter()
                    .find(|p| p.id == id)
                    .and_then(|p| p.definition.as_ref())
                    .ok_or_else(|| anyhow::anyhow!("Project no longer exists"))?;
                let repositories = definition
                    .repositories
                    .iter()
                    .filter_map(|repo| {
                        workspace
                            .catalog
                            .repository_paths
                            .get(&repo.id)
                            .map(|path| (repo.name.clone(), path.clone()))
                    })
                    .collect::<Vec<_>>();
                Ok::<_, anyhow::Error>((repositories, (!removing).then_some(path)))
            },
            move |s: &mut Workspace, result, _| {
                s.repository_edit_task = None;
                match result {
                    Ok((repositories, path)) => {
                        if let Some(project) = s
                            .projects
                            .iter_mut()
                            .find(|p| p.id.as_ref() == Some(&project_id))
                        {
                            project.repositories = repositories;
                            project.selected_repository = path
                                .or_else(|| {
                                    project.selected_repository.take().filter(|selected| {
                                        project
                                            .repositories
                                            .iter()
                                            .any(|(_, path)| path == selected)
                                    })
                                })
                                .or_else(|| {
                                    project.repositories.first().map(|(_, path)| path.clone())
                                });
                        }
                        let linked: HashSet<String> = s
                            .projects
                            .iter()
                            .flat_map(|project| project.repositories.iter().map(|(_, p)| p.clone()))
                            .collect();
                        s.repository_views.retain(|path, _| linked.contains(path));
                        if s.projects[s.project].id.as_ref() == Some(&project_id) {
                            if let Some(path) = s.projects[s.project].selected_repository.clone() {
                                s.open_repository(path);
                            } else {
                                s.repository_view = None;
                                s.repository = false;
                            }
                            s.refresh_repository_stats();
                        }
                    }
                    Err(error) => {
                        s.status = format!("Could not update repositories: {error}");
                        if s.projects[s.project].id.as_ref() == Some(&project_id) {
                            let status = s.status.clone();
                            if let Some(view) = s.current_repository_mut() {
                                view.membership_error = Some(status);
                            }
                        }
                    }
                }
            },
        ));
    }

    pub(crate) fn open_repository(&mut self, path: String) {
        self.projects[self.project].selected_repository = Some(path.clone());
        if let Some(view) = self.repository_views.get_mut(&path) {
            view.refresh();
        } else {
            let view = RepositoryView::new(
                path.clone(),
                self.repository_graph_preferences
                    .get(&path)
                    .cloned()
                    .unwrap_or_default(),
                self.syntax_theme.clone(),
                crate::colors::CANVAS,
            );
            self.repository_views.insert(path.clone(), view);
        }
        let repositories: Vec<(String, String)> = self.projects[self.project]
            .repositories
            .iter()
            .filter(|(_, p)| self.repository_is_open(p))
            .cloned()
            .collect();
        let total = self.projects[self.project].repositories.len();
        let backend = self.backend.clone();
        let view = self
            .repository_views
            .get_mut(&path)
            .expect("repository view");
        view.backend = backend;
        view.has_closed_repositories = repositories.len() < total;
        view.repositories = repositories;
        self.repository_expanded = view.expanded;
        self.repository_view = Some(path);
    }

    pub(crate) fn repository_event(
        &mut self,
        path: &str,
        event: crate::repository::RepositoryEvent,
        tx: &mut Tx,
    ) {
        use crate::repository::RepositoryEvent;
        match event {
            RepositoryEvent::GraphPreferences(preferences) => {
                self.repository_graph_preferences
                    .insert(path.to_owned(), preferences);
                self.persist_workspace_preferences(None);
            }
            RepositoryEvent::Expand => self.repository_expanded = !self.repository_expanded,
            RepositoryEvent::Select(path) => self.open_repository(path),
            RepositoryEvent::Add => self.edit_repository(None, tx),
            RepositoryEvent::Relink(path) => self.edit_repository_location(Some(path), true, tx),
            RepositoryEvent::Close(path) => self.close_repository(path),
            RepositoryEvent::Reopen => self.reopen_repositories(),
        }
    }

    pub(crate) fn load_transcript(&mut self, limit: usize, tx: &mut Tx) {
        self.load_chat(self.selected, limit, tx);
    }

    pub(crate) fn load_chat(&mut self, index: usize, limit: usize, _tx: &mut Tx) {
        let chat = &mut self.conversations[index];
        let Some(pane) = chat.pane.clone() else {
            return;
        };
        chat.live_task = None;
        chat.loading = true;
        chat.error = None;
        let profile = self.profile.clone();
        let theme = self.syntax_theme.clone();
        chat.task = Some(crate::task::background(
            move || {
                crate::session::transcript(&profile, &pane, limit).map(|(total, messages)| {
                    (
                        total,
                        PreparedTranscript::prepare(0, messages.into_iter().map(Arc::new), &theme),
                    )
                })
            },
            move |view: &mut Workspace, result, _| match result {
                Ok((total, prepared)) => {
                    view.publish_current_theme(index, prepared, Some(total), true)
                }
                Err(error) => {
                    let chat = &mut view.conversations[index];
                    chat.loading = false;
                    chat.error = Some(format!("Could not load chat: {error:#}"));
                }
            },
        ));
    }

    pub(crate) fn publish_current_theme(
        &mut self,
        index: usize,
        prepared: PreparedTranscript,
        total: Option<usize>,
        initial: bool,
    ) {
        if prepared.theme != self.syntax_theme {
            let theme = self.syntax_theme.clone();
            self.conversations[index].theme_task = Some(crate::task::background(
                move || prepared.retheme(&theme),
                move |view: &mut Workspace, prepared, _| {
                    view.publish_current_theme(index, prepared, total, initial)
                },
            ));
            return;
        }
        let chat = &mut self.conversations[index];
        if chat.closed {
            return;
        }
        chat.transcript.publish(prepared, total);
        if initial {
            chat.loading = false;
            chat.loaded = true;
            self.connect_chat(index);
        }
    }

    pub(crate) fn refresh_chat_theme(&mut self, index: usize) {
        let chat = &mut self.conversations[index];
        if chat.closed {
            return;
        }
        let snapshot = chat.transcript.snapshot();
        let theme = self.syntax_theme.clone();
        chat.theme_task = Some(crate::task::background(
            move || snapshot.retheme(&theme),
            move |view: &mut Workspace, prepared, _| {
                if view.syntax_theme != prepared.theme || view.conversations[index].closed {
                    return;
                }
                view.conversations[index].transcript.publish_theme(prepared);
            },
        ));
    }

    pub(crate) fn set_zoom(&mut self, zoom: crate::zoom::Zoom) {
        if self.zoom == zoom {
            return;
        }
        self.zoom = zoom;
        self.persist_workspace_preferences(None);
    }

    pub(crate) fn new_chat(&mut self, tx: &mut Tx) {
        self.select_project(self.project, tx);
        self.add_chat();
        self.create_chat(self.selected);
        self.conversations[self.selected].input.focus();
    }

    pub(crate) fn add_chat(&mut self) {
        self.conversations.push(Conversation::new(
            self.project,
            TextInput::new(),
            self.default_config.clone(),
        ));
        self.selected = self.conversations.len() - 1;
        self.projects[self.project].selected = self.selected;
        self.settings = false;
    }

    pub(crate) fn begin_project_creation(&mut self) {
        self.new_menu = false;
        self.status.clear();
        let mut input = TextInput::field("Project name");
        input.submit_on_enter = true;
        input.height_limits = (28., 28.);
        input.focus();
        self.new_project_name = Some(input);
        self.new_project_repository = None;
    }

    pub(crate) fn create_project(&mut self, tx: &mut Tx) {
        if self.new_project_task.is_some() {
            return;
        }
        let Some(input) = &self.new_project_name else {
            return;
        };
        let name = input.content().trim().to_owned();
        if name.is_empty() {
            return;
        }
        let Some(backend) = self.backend.get().cloned() else {
            self.status = "The workspace is still connecting. Try again shortly.".into();
            return;
        };
        let id = uuid::Uuid::new_v4().to_string();
        let repository = self.new_project_repository.clone();
        let project_id = id.clone();
        let project_name = name.clone();
        self.status.clear();
        let _ = tx;
        self.new_project_task = Some(crate::task::spawn(
            async move {
                let mut repositories = Vec::new();
                let mut bindings = serde_json::Map::new();
                let mut linked = Vec::new();
                if let Some(path) = repository {
                    let path = path.canonicalize()?;
                    let name = path
                        .file_name()
                        .ok_or_else(|| anyhow::anyhow!("Choose a repository folder"))?
                        .to_string_lossy()
                        .into_owned();
                    let path = path.to_string_lossy().into_owned();
                    let id = uuid::Uuid::new_v4().to_string();
                    repositories.push(serde_json::json!({"id":id,"name":name}));
                    bindings.insert(id, path.clone().into());
                    linked.push((name, path));
                }
                backend
                    .request(
                        reqwest::Method::POST,
                        "/api/projects/command",
                        Some(serde_json::json!({"type":"saveProject","definition":{
                            "schema":"inferay.project/1","id":project_id,"name":project_name,"description":"","instructions":"","repositories":repositories
                        },"repositoryPaths":bindings,"expectedHash":null})),
                    )
                    .await?;
                Ok::<_, anyhow::Error>(linked)
            },
            move |s: &mut Workspace, result, tx| {
                s.new_project_task = None;
                match result {
                    Ok(repositories) => {
                        let project = s.projects.len();
                        s.projects.push(Project {
                            id: Some(id),
                            name,
                            selected_repository: repositories.first().map(|(_, path)| path.clone()),
                            repositories,
                            selected: s.conversations.len(),
                            dock: serde_json::Value::Null,
                            dock_workspace: None,
                        });
                        s.project = project;
                        s.add_chat();
                        s.select_project(project, tx);
                        s.new_project_name = None;
                        s.new_project_repository = None;
                        s.persist_workspace_preferences(None);
                    }
                    Err(error) => s.status = format!("Could not create project: {error}"),
                }
            },
        ));
    }

    pub(crate) fn max_repository_width(&self) -> f32 {
        let content = self.viewport.0 / crate::zoom::factor()
            - if self.sidebar {
                self.sidebar_width + 8.
            } else {
                14.
            };
        (content - inferay_presentation::dock::MIN_COLUMN_WIDTH as f32).max(280.)
    }
}

impl Workspace {
    pub(crate) fn follow_focused_input(&mut self) -> bool {
        let focused = self.conversations.iter().position(|chat| {
            !chat.closed && chat.project == self.project && chat.input.is_focused()
        });
        match focused {
            Some(index) if index != self.selected => {
                self.select_chat_pane(index);
                true
            }
            _ => false,
        }
    }

    pub(crate) fn tick_activity_clock(&mut self, tx: &mut Tx) -> bool {
        if !self.any_chat_running() {
            return false;
        }
        tx.wake_after(std::time::Duration::from_millis(250));
        let second = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if second == self.activity_second {
            return false;
        }
        self.activity_second = second;
        true
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "workspace/fixture_tests.rs"]
mod fixture_tests;
