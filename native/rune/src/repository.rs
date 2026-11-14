mod actions;
mod branches;
mod changes;
mod commit;
mod diff;
mod diff_cache;
mod diff_view;
mod graph;
mod graph_images;
mod keyboard;
#[cfg(test)]
mod testing;
mod view;

use crate::backend::Backend;
use crate::task::Task;
use crate::workspace::Workspace;
use diff::PreparedDiff;
use diff_cache::{DiffCache, Key as DiffKey};
use inferay_core::{path_security::AllowedPaths, repository::*};
use rune::{Live, Pixels, Tx};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub use keyboard::on_key;

pub enum RepositoryEvent {
    GraphPreferences(Value),
    Expand,
    Select(String),
    Add,
    Relink(String),
    Close(String),
    Reopen,
}

#[derive(Clone)]
pub(crate) enum MenuAnchor {
    Button,
    Point(f32, f32),
}

pub struct RepositoryView {
    pub path: String,
    pub backend: Arc<tokio::sync::OnceCell<Arc<Backend>>>,
    pub repositories: Vec<(String, String)>,
    pub has_closed_repositories: bool,
    pub expanded: bool,
    pub single_chat_column: bool,
    pub membership_error: Option<String>,
    commit_drafts: RefCell<HashMap<String, commit::Draft>>,
    commit_prepare_task: Option<Task>,
    commit_generating: bool,
    diff_images: [Option<Result<Pixels, String>>; 2],
    image_task: Option<Task>,
    keyboard_scope: &'static str,
    keyboard_active: bool,
    show_diff: bool,
    open_after_selection: bool,
    selected_staged: bool,
    tree_files: bool,
    collapsed_directories: HashSet<String>,
    diff_scroll: Live<[f32; 4]>,
    diff_thumb: Live<[f32; 4]>,
    diff_horizontal: [Live<[f32; 2]>; 2],
    diff_list_width: f32,
    diff_change: Option<usize>,
    minimap_drag: Option<f32>,
    missing: bool,
    repository_menu: bool,
    columns_menu: bool,
    branch_menu: Option<GitRefOperationPreflight>,
    branch_menu_position: (f32, f32),
    git_menu: Option<(MenuAnchor, String, Vec<GitGraphRef>)>,
    git_prompt: Option<actions::GitPrompt>,
    branch_menu_task: Option<Task>,
    branch_drag: Option<graph::BranchDrag>,
    column_resize: Option<(String, f32, bool)>,
    selected_worktree: Option<String>,
    changes_height: f32,
    changes_width: f32,
    changes_resize: Option<f32>,
    mutation_task: Option<Task>,
    avatar_task: Option<Task>,
    avatars: HashMap<String, Pixels>,
    mutating: bool,
    preferences: Value,
    syntax_theme: String,
    presentation: Value,
    layout_width: Option<f32>,
    origin: [f32; 2],
    node_background: u32,
    status: Option<GitStatusResult>,
    graph: GitGraphSnapshot,
    graph_images: Vec<Arc<graph_images::GraphImage>>,
    details: Option<GitCommitDetails>,
    selected: Option<String>,
    selected_item: Option<String>,
    file: Option<String>,
    diff: Option<Arc<PreparedDiff>>,
    history: bool,
    changes: bool,
    split_diff: bool,
    file_view: bool,
    limit: usize,
    loading: bool,
    error: Option<String>,
    task: Option<Task>,
    selection_task: Option<Task>,
    diff_task: Option<Task>,
    diff_cache: Arc<std::sync::Mutex<DiffCache>>,
    diff_prefetch_task: Option<Task>,
    theme_task: Option<Task>,
}

pub(crate) fn act(
    path: &str,
    f: impl Fn(&mut RepositoryView, &mut Tx) + 'static,
) -> impl Fn(&mut Workspace, &mut Tx) + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, tx: &mut Tx| {
        if let Some(view) = s.repository_views.get_mut(&path) {
            f(view, tx);
        }
    }
}

impl RepositoryView {
    pub fn new(
        path: String,
        preferences: Value,
        syntax_theme: String,
        node_background: u32,
    ) -> Self {
        let mut view = Self {
            path,
            backend: Default::default(),
            repositories: vec![],
            has_closed_repositories: false,
            expanded: false,
            single_chat_column: false,
            membership_error: None,
            commit_drafts: Default::default(),
            commit_prepare_task: None,
            commit_generating: false,
            diff_images: Default::default(),
            image_task: None,
            keyboard_scope: "graph",
            keyboard_active: false,
            show_diff: false,
            open_after_selection: false,
            selected_staged: false,
            tree_files: false,
            collapsed_directories: Default::default(),
            diff_scroll: Live::new([0.; 4]),
            diff_thumb: Live::new([0.; 4]),
            diff_horizontal: [Live::new([0.; 2]), Live::new([0.; 2])],
            diff_list_width: 0.,
            diff_change: None,
            minimap_drag: None,
            missing: false,
            repository_menu: false,
            columns_menu: false,
            branch_menu: None,
            branch_menu_position: (0., 0.),
            git_menu: None,
            git_prompt: None,
            branch_menu_task: None,
            branch_drag: None,
            column_resize: None,
            selected_worktree: None,
            changes_height: 246.,
            changes_width: 340.,
            changes_resize: None,
            mutation_task: None,
            avatar_task: None,
            avatars: Default::default(),
            mutating: false,
            preferences: inferay_presentation::graph::preferences(&preferences),
            syntax_theme,
            presentation: Value::Null,
            layout_width: None,
            origin: [0., 0.],
            node_background,
            status: None,
            graph: Default::default(),
            graph_images: vec![],
            details: None,
            selected: None,
            selected_item: None,
            file: None,
            diff: None,
            history: true,
            changes: true,
            split_diff: true,
            file_view: false,
            limit: 200,
            loading: false,
            error: None,
            task: None,
            selection_task: None,
            diff_task: None,
            diff_cache: Default::default(),
            diff_prefetch_task: None,
            theme_task: None,
        };
        view.refresh();
        view
    }

    fn spawn<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
        done: impl FnOnce(&mut RepositoryView, T, &mut Tx) + Send + 'static,
    ) -> Task {
        let path = self.path.clone();
        crate::task::background(work, move |s, value, tx| {
            if let Some(view) = s.repository_views.get_mut(&path) {
                done(view, value, tx);
            }
        })
    }

    pub fn set_syntax_theme(&mut self, theme: String) {
        if self.syntax_theme == theme {
            return;
        }
        self.syntax_theme = theme;
        self.theme_task = None;
        if let Some(diff) = self.diff.clone() {
            self.color_diff(diff);
        }
    }

    fn clear_diff(&mut self) {
        self.image_task = None;
        self.diff_images = Default::default();
        self.diff_task = None;
        self.diff_prefetch_task = None;
        self.theme_task = None;
        self.diff = None;
        for scroll in &self.diff_horizontal {
            scroll.set([0., 0.]);
        }
        self.diff_change = None;
        self.minimap_drag = None;
    }

    fn work_cwd(&self) -> String {
        self.selected_worktree
            .as_ref()
            .unwrap_or(&self.path)
            .clone()
    }

    fn available_width(&self) -> f32 {
        self.layout_width
            .map_or(584., |width| (width - 1.).max(0.) / crate::zoom::factor())
    }

    fn changes_on_right(&self) -> bool {
        (self.expanded || self.single_chat_column) && self.available_width() >= 900.
    }

    fn changes_panel_width(&self) -> f32 {
        self.changes_width
            .min((self.available_width() - 300.).max(180.))
    }

    fn viewport_width(&self) -> f32 {
        (self.available_width()
            - if self.changes_on_right() && self.changes {
                self.changes_panel_width()
            } else {
                0.
            })
        .max(1.)
    }

    fn close_menus(&mut self) {
        self.branch_menu = None;
        self.git_menu = None;
        self.git_prompt = None;
        self.branch_menu_task = None;
    }

    pub fn refresh(&mut self) {
        if self.loading || self.mutating {
            return;
        }
        self.loading = true;
        self.error = None;
        let cwd = self.path.clone();
        let limit = self.limit;
        let preferences = self.preferences.clone();
        let background = self.node_background;
        let previous = self.graph_images.clone();
        self.task = Some(self.spawn(
            move || {
                let started = std::time::Instant::now();
                let missing = std::fs::metadata(&cwd)
                    .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound);
                let input = inferay_native_diff::prepare_git_graph(&cwd);
                let status = input
                    .worktrees
                    .iter()
                    .find(|tree| tree.is_current)
                    .and_then(|tree| tree.status.clone());
                let prepared = started.elapsed();
                let graph = inferay_native_diff::get_git_graph_snapshot_with_query(&cwd, limit, input, "");
                let strings = |key: &str| -> Vec<String> {
                    preferences[key]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                };
                let data = serde_json::to_value(inferay_presentation::graph_response::response(
                    &graph,
                    &strings("hiddenRefs"),
                    &strings("soloRefs"),
                    &strings("pinnedRefs"),
                ))
                .unwrap();
                let presentation = data["presentation"].clone();
                let mut layout = preferences;
                layout["maxColumn"] = presentation["maxColumn"].clone();
                layout["pinnedColumns"] = presentation["pinnedColumns"].clone();
                let display = inferay_presentation::graph::layout(&layout)["displayColumns"].clone();
                let history = started.elapsed();
                let images = graph_images::images(&graph, &display, background, &previous);
                if std::env::var_os("INFERAY_PROFILE_GIT").is_some() {
                    eprintln!(
                        "[rune-git] prepare={prepared:?} history={:?} images={:?} total={:?} rows={}",
                        history - prepared,
                        started.elapsed() - history,
                        started.elapsed(),
                        graph.commits.len()
                    );
                }
                (status, graph, images, presentation, missing)
            },
            |view, (status, graph, images, presentation, missing), _| {
                view.loading = false;
                view.missing = missing;
                view.error = if missing {
                    Some(format!("Repository folder is missing: {}. Use Locate folder to reconnect it. Existing automation references are preserved; changed locations require execution review.", view.path))
                } else {
                    graph
                        .state_error
                        .clone()
                        .or_else(|| status.is_none().then(|| "Not a Git repository".into()))
                        .or_else(|| view.error.take())
                };
                view.status = status;
                view.graph = graph;
                view.presentation = presentation;
                view.graph_images = images;
                view.load_avatars();
            },
        ));
    }

    fn load_avatars(&mut self) {
        let identities: Vec<_> = self
            .graph
            .commits
            .iter()
            .filter(|c| c.item_kind == GitGraphItemKind::Commit)
            .filter(|c| {
                !self.avatars.contains_key(&c.hash)
                    && !self
                        .avatars
                        .contains_key(&c.author_email.trim().to_lowercase())
            })
            .take(100)
            .map(|c| inferay_server::AuthorIdentityRequest {
                hash: Some(c.hash.clone()),
                email: Some(c.author_email.clone()),
            })
            .collect();
        if identities.is_empty() {
            return;
        }
        let cwd = self.path.clone();
        self.avatar_task = Some(self.spawn(
            move || {
                static FORGE: std::sync::LazyLock<inferay_server::ForgeState> =
                    std::sync::LazyLock::new(Default::default);
                let Ok(runtime) = tokio::runtime::Runtime::new() else {
                    return HashMap::new();
                };
                let images: HashMap<String, Arc<Vec<u8>>> =
                    runtime.block_on(FORGE.author_images(std::path::Path::new(&cwd), &identities));
                images
                    .into_iter()
                    .filter_map(|(key, bytes)| Some((key, graph_images::decode_raster(&bytes)?)))
                    .collect::<HashMap<_, _>>()
            },
            |view, images, _| view.avatars.extend(images),
        ));
    }

    fn select_commit(&mut self, index: usize) {
        self.show_diff = false;
        self.open_after_selection = false;
        self.clear_diff();
        let commit = &self.graph.commits[index];
        self.selected_item = Some(commit.id.clone());
        self.selection_task = None;
        self.details = None;
        self.file = None;
        self.error = None;
        if commit.item_kind == GitGraphItemKind::WorktreeWip {
            self.selected = None;
            self.selected_worktree = commit.worktree_path.clone();
            self.changes = true;
            return;
        }
        self.selected_worktree = None;
        self.changes = true;
        let hash = commit.hash.clone();
        self.selected = Some(hash.clone());
        let cwd = self.path.clone();
        self.selection_task = Some(self.spawn(
            move || inferay_native_diff::get_git_commit_details_for_parent(&cwd, &hash, None),
            |view, details, tx| {
                view.error = details
                    .is_none()
                    .then(|| "Could not load this commit.".into());
                view.details = details;
                if view.open_after_selection {
                    view.open_after_selection = false;
                    view.navigate_file(0, tx);
                }
            },
        ));
    }

    fn select_commit_id(&mut self, id: &str) {
        if let Some(index) = self.graph.commits.iter().position(|commit| commit.id == id) {
            self.select_commit(index);
        }
    }

    fn open_file(&mut self, path: String, staged: bool, tx: &mut Tx) {
        if !self.show_diff
            && self.selected.is_some()
            && self.file.as_ref() == Some(&path)
            && self.selected_staged == staged
            && self.diff.is_some()
        {
            self.show_diff = true;
            return;
        }
        self.show_diff = true;
        if self.selected_item.is_none() && self.selected.is_none() {
            self.selected_item = self
                .graph
                .commits
                .iter()
                .find(|commit| {
                    commit.item_kind == GitGraphItemKind::WorktreeWip
                        && commit.worktree_path.as_deref() == Some(self.path.as_str())
                })
                .map(|commit| commit.id.clone());
        }
        self.selected_staged = staged;
        self.file = Some(path.clone());
        tx.scroll_to_y("diff-lines", 0.);
        self.clear_diff();
        self.error = None;
        let key = self.diff_key(path, staged);
        if key.commit.is_some() {
            let cached = self.diff_cache.lock().unwrap().get(&key);
            if let Some(data) = cached {
                self.show_prepared_diff(data, tx);
                self.prefetch_diffs();
                return;
            }
        }
        let theme = self.syntax_theme.clone();
        let cache = self.diff_cache.clone();
        self.diff_task = Some(self.spawn(
            move || {
                let started = std::time::Instant::now();
                let data = DiffCache::load(&cache, &key, &theme);
                if std::env::var_os("INFERAY_PROFILE_GIT").is_some() {
                    eprintln!(
                        "[rune-diff] file={} first-visible={:?} retained-colors={}",
                        key.path,
                        started.elapsed(),
                        data.as_ref().is_some_and(|d| d.colored)
                    );
                }
                data
            },
            |view, data, tx| {
                view.diff_task = None;
                view.error = data.is_none().then(|| "Could not load this diff.".into());
                if let Some(data) = data {
                    view.show_prepared_diff(data, tx);
                }
                view.prefetch_diffs();
            },
        ));
    }

    fn commit_tint(&self, color_index: usize) -> u32 {
        let lane = crate::colors::GRAPH_LANES[color_index % crate::colors::GRAPH_LANES.len()];
        u32::from_str_radix(&lane[1..], 16).unwrap()
    }
}

#[cfg(test)]
#[path = "repository/tests.rs"]
mod tests;
