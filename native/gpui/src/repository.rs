use crate::zoom::ui;
mod changes;
mod graph;
use crate::{button, colors, icon};
use gpui::{prelude::*, *};
use inferay_core::{path_security::AllowedPaths, repository::*};
use serde_json::{Value, json};
use std::sync::Arc;

struct PreparedDiff {
    diff: Arc<GitHunkDiff>,
    path: SharedString,
    theme: String,
    old: Vec<Vec<(std::ops::Range<usize>, HighlightStyle)>>,
    new: Vec<Vec<(std::ops::Range<usize>, HighlightStyle)>>,
    patch: Arc<[SharedString]>,
}
impl PreparedDiff {
    fn classify(
        lines: &[GitDiffLine],
        path: &str,
        theme: &str,
    ) -> Vec<Vec<(std::ops::Range<usize>, HighlightStyle)>> {
        let extension = std::path::Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("text");
        let source: Vec<_> = lines
            .iter()
            .map(|line| {
                if matches!(
                    line.line_type,
                    GitDiffLineType::Hunk | GitDiffLineType::Spacer
                ) {
                    ""
                } else {
                    line.content.as_str()
                }
            })
            .collect();
        let text = source.join("\n");
        let spans = crate::syntax::highlights(&text, extension, theme);
        let mut offset = 0;
        let mut cursor = 0;
        source
            .iter()
            .map(|line| {
                let end = offset + line.len();
                let mut runs = Vec::new();
                while cursor < spans.len() && spans[cursor].0.start < end {
                    let (range, style) = &spans[cursor];
                    if range.end > offset {
                        runs.push((
                            range.start.max(offset) - offset..range.end.min(end) - offset,
                            *style,
                        ));
                    }
                    cursor += 1;
                }
                offset = end + 1;
                runs
            })
            .collect()
    }
    fn new(diff: GitHunkDiff, path: &str, theme: &str) -> Self {
        Self {
            old: Self::classify(&diff.old_lines, path, theme),
            new: Self::classify(&diff.new_lines, path, theme),
            patch: diff
                .raw_patch
                .as_deref()
                .unwrap_or("")
                .lines()
                .map(SharedString::from)
                .collect(),
            diff: Arc::new(diff),
            path: path.to_owned().into(),
            theme: theme.into(),
        }
    }
    fn retheme(&self, theme: &str) -> Self {
        Self {
            old: Self::classify(&self.diff.old_lines, &self.path, theme),
            new: Self::classify(&self.diff.new_lines, &self.path, theme),
            diff: self.diff.clone(),
            path: self.path.clone(),
            patch: self.patch.clone(),
            theme: theme.into(),
        }
    }
}

pub enum RepositoryEvent {
    Expand,
    Select(String),
    Add,
}
impl EventEmitter<RepositoryEvent> for RepositoryView {}

/// Repository reads and staging use the shared Git engine.
pub struct RepositoryView {
    focus: FocusHandle,
    keyboard_scope: &'static str,
    show_diff: bool,
    open_after_selection: bool,
    selected_staged: bool,
    tree_files: bool,
    collapsed_directories: std::collections::HashSet<String>,
    diff_scroll: UniformListScrollHandle,
    files_scroll: [ScrollHandle; 2],
    cwd: String,
    pub repositories: Vec<(String, String)>,
    repository_menu: bool,
    selected_worktree: Option<String>,
    pub expanded: bool,
    changes_height: f32,
    changes_width: f32,
    changes_resize: Option<(Point<Pixels>, f32)>,
    mutation_task: Option<Task<()>>,
    avatar_task: Option<Task<()>>,
    avatars: std::collections::HashMap<String, Arc<Image>>,
    mutating: bool,
    preferences: Value,
    syntax_theme: String,
    presentation: Value,
    available_width: f32,
    node_background: u32,
    status: Option<GitStatusResult>,
    graph: GitGraphSnapshot,
    graph_images: Vec<Arc<Image>>,
    graph_render_images: Vec<Option<Arc<RenderImage>>>,
    details: Option<GitCommitDetails>,
    selected: Option<String>,
    selected_item: Option<String>,
    hovered: Option<usize>,
    graph_scroll: UniformListScrollHandle,
    file: Option<String>,
    diff: Option<Arc<PreparedDiff>>,
    history: bool,
    changes: bool,
    split_diff: bool,
    limit: usize,
    loading: bool,
    error: Option<String>,
    task: Option<Task<()>>,
    selection_task: Option<Task<()>>,
    diff_task: Option<Task<()>>,
    theme_task: Option<Task<()>>,
}
impl RepositoryView {
    pub fn set_syntax_theme(&mut self, theme: String, cx: &mut Context<Self>) {
        if self.syntax_theme == theme {
            return;
        }
        self.syntax_theme = theme.clone();
        self.theme_task = None;
        if let Some(diff) = self.diff.clone() {
            let work = cx
                .background_executor()
                .spawn(async move { Arc::new(diff.retheme(&theme)) });
            self.theme_task = Some(cx.spawn(async move |this, cx| {
                let prepared = work.await;
                let _ = this.update(cx, |view, cx| {
                    if view.syntax_theme == prepared.theme
                        && view
                            .diff
                            .as_ref()
                            .is_some_and(|current| Arc::ptr_eq(&current.diff, &prepared.diff))
                    {
                        view.diff = Some(prepared);
                        cx.notify();
                    }
                });
            }));
        }
        cx.notify();
    }

    fn clear_diff(&mut self) {
        self.diff_task = None;
        self.theme_task = None;
        self.diff = None;
    }

    fn viewport_width(&self) -> f32 {
        (self.available_width
            - if self.expanded && self.changes {
                self.changes_width
            } else {
                0.
            })
        .max(1.)
    }
    pub fn new(
        cwd: String,
        preferences: Value,
        syntax_theme: String,
        node_background: u32,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut view = Self {
            focus: cx.focus_handle(),
            keyboard_scope: "graph",
            show_diff: false,
            open_after_selection: false,
            selected_staged: false,
            tree_files: false,
            collapsed_directories: Default::default(),
            diff_scroll: UniformListScrollHandle::new(),
            files_scroll: [ScrollHandle::new(), ScrollHandle::new()],
            cwd,
            repositories: vec![],
            repository_menu: false,
            selected_worktree: None,
            expanded: false,
            changes_height: 246.,
            changes_width: 340.,
            changes_resize: None,
            mutation_task: None,
            avatar_task: None,
            avatars: Default::default(),
            mutating: false,
            syntax_theme,
            preferences: inferay_presentation::graph::preferences(&preferences),
            presentation: Value::Null,
            available_width: 584.,
            node_background,
            status: None,
            graph: Default::default(),
            graph_images: vec![],
            graph_render_images: vec![],
            details: None,
            selected: None,
            selected_item: None,
            hovered: None,
            graph_scroll: UniformListScrollHandle::new(),
            file: None,
            diff: None,
            history: true,
            changes: true,
            split_diff: true,
            limit: 200,
            loading: false,
            error: None,
            task: None,
            selection_task: None,
            diff_task: None,
            theme_task: None,
        };
        view.refresh(cx);
        view
    }
    fn navigate_file(&mut self, direction: i32, cx: &mut Context<Self>) {
        let files = self.file_entries();
        let current = files.iter().position(|file| {
            self.file.as_deref() == Some(&file.0) && file.4 == self.selected_staged
        });
        let next = inferay_presentation::workbench::adjacent_file(&json!({
            "count": files.len(), "current": current.map(|i| i as i64).unwrap_or(-1), "direction": direction, "repeatBoundary": direction == 0,
        }));
        if let Some(index) = next.as_u64() {
            let file = &files[index as usize];
            let group_index = files[..index as usize]
                .iter()
                .filter(|f| f.4 == file.4)
                .count();
            self.files_scroll[usize::from(file.4)].scroll_to_item(group_index);
            self.open_file(file.0.clone(), file.4, cx);
        }
    }
    fn navigate(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = match event.keystroke.key.as_str() {
            "up" => "ArrowUp",
            "down" => "ArrowDown",
            "left" => "ArrowLeft",
            "right" => "ArrowRight",
            "home" => "Home",
            "end" => "End",
            "space" => " ",
            "enter" => "Enter",
            key => key,
        };
        let modifiers = event.keystroke.modifiers;
        let mut input = json!({"key":key,"meta":modifiers.platform,"ctrl":modifiers.control,"alt":modifiers.alt,"shift":modifiers.shift,"repeat":event.is_held,
            "graphFocused":self.keyboard_scope == "graph", "sidebarFocused":self.keyboard_scope == "sidebar",
            "focusedPanelId":"workspace-diff-viewer", "mainViewMode":if self.show_diff {"diff"} else {"graph"},
            "graphVisible":self.history, "sidebarVisible":self.changes, "hasFile":self.file.is_some(), "historical":self.selected.is_some(), "workingTree":self.selected.is_none()});
        let action = inferay_presentation::workbench::keyboard_action(&input);
        match action["type"].as_str() {
            Some("close" | "focusGraph") => {
                self.show_diff = false;
                self.history = true;
                self.keyboard_scope = "graph";
                self.open_after_selection = false;
            }
            Some("closeGraph") => {
                self.history = false;
                self.changes = true;
                self.keyboard_scope = "sidebar";
            }
            Some("toggle") => {
                if let Some(path) = self.file.clone() {
                    self.stage(Some(path), self.selected_staged, cx);
                }
            }
            Some("cycle") => self.navigate_file(action["direction"].as_i64().unwrap() as i32, cx),
            Some("enterSidebar" | "open") => {
                self.keyboard_scope = "sidebar";
                self.changes = true;
                self.navigate_file(0, cx);
            }
            Some("navigateGraph") => {
                let current = self
                    .graph
                    .commits
                    .iter()
                    .find(|commit| Some(&commit.id) == self.selected_item.as_ref());
                input["branchTarget"] = json!(current.and_then(|commit| if key == "ArrowUp" {
                    commit.navigation.branch_newer.as_ref()
                } else {
                    commit.navigation.branch_older.as_ref()
                }));
                input["items"] = self.presentation["selectableItems"].clone();
                input["current"] = json!(self.selected_item);
                input["canOpen"] = json!(true);
                let next =
                    serde_json::to_value(inferay_presentation::graph::navigation(&input)).unwrap();
                if next["handled"] != true {
                    return;
                }
                if let Some(id) = next["selectItem"].as_str()
                    && let Some(index) =
                        self.graph.commits.iter().position(|commit| commit.id == id)
                {
                    self.select_commit(index, cx);
                    self.graph_scroll
                        .scroll_to_item(index, ScrollStrategy::Nearest);
                }
                if next["openItem"].is_string() || (key == "ArrowRight" && self.file.is_some()) {
                    self.changes = true;
                    self.keyboard_scope = "sidebar";
                    if self.selected.is_some() && self.details.is_none() {
                        self.open_after_selection = true;
                    } else {
                        self.navigate_file(0, cx);
                    }
                }
            }
            Some("scrollDiff") => {
                let handle = &self.diff_scroll.0.borrow().base_handle;
                let mut offset = handle.offset();
                offset.y -= handle.bounds().size.height
                    * 0.9
                    * action["direction"].as_i64().unwrap() as f32;
                handle.set_offset(offset);
            }
            _ => return,
        }
        window.focus(&self.focus, cx);
        cx.stop_propagation();
        cx.notify();
    }
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            return;
        }
        self.loading = true;
        self.error = None;
        let cwd = self.cwd.clone();
        let limit = self.limit;
        let preferences = self.preferences.clone();
        let background = self.node_background;
        let previous_images = self.graph_images.clone();
        let previous_render_images = self.graph_render_images.clone();
        let renderer = cx.svg_renderer();
        let work = cx.background_executor().spawn(async move {
            let started = std::time::Instant::now();
            let input = inferay_native_diff::prepare_git_graph(&cwd);
            let status = input
                .worktrees
                .iter()
                .find(|tree| tree.is_current)
                .and_then(|tree| tree.status.clone());
            let prepared = started.elapsed();
            let graph =
                inferay_native_diff::get_git_graph_snapshot_with_query(&cwd, limit, input, "");
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
            let images = graph::images(&graph, &display, background, &previous_images);
            let rendered = images
                .iter()
                .enumerate()
                .map(|(index, image)| {
                    if previous_images
                        .get(index)
                        .is_some_and(|old| Arc::ptr_eq(old, image))
                    {
                        previous_render_images.get(index).cloned().flatten()
                    } else {
                        image.to_image_data(renderer.clone()).ok()
                    }
                })
                .collect();
            if std::env::var_os("INFERAY_PROFILE_GIT").is_some() {
                eprintln!(
                    "[gpui-git] prepare={prepared:?} history={:?} images={:?} total={:?} rows={}",
                    history - prepared,
                    started.elapsed() - history,
                    started.elapsed(),
                    graph.commits.len()
                );
            }
            (status, graph, images, rendered, presentation)
        });
        self.task = Some(cx.spawn(async move |this, cx| {
            let (status, graph, images, rendered, presentation) = work.await;
            let _ = this.update(cx, |view, cx| {
                view.loading = false;
                view.error = graph
                    .state_error
                    .clone()
                    .or_else(|| status.is_none().then(|| "Not a Git repository".into()));
                view.status = status;
                view.graph = graph;
                view.presentation = presentation;
                view.graph_images = images;
                view.graph_render_images = rendered;
                view.load_avatars(cx);
                cx.notify();
            });
        }));
    }
    fn load_avatars(&mut self, cx: &mut Context<Self>) {
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
        let cwd = self.cwd.clone();
        let work = cx.background_executor().spawn(async move {
            static FORGE: std::sync::LazyLock<inferay_server::ForgeState> =
                std::sync::LazyLock::new(Default::default);
            let Ok(runtime) = tokio::runtime::Runtime::new() else {
                return Default::default();
            };
            runtime.block_on(FORGE.author_images(std::path::Path::new(&cwd), &identities))
        });
        self.avatar_task = Some(cx.spawn(async move |this, cx| {
            let images: std::collections::HashMap<String, Arc<Vec<u8>>> = work.await;
            let _ = this.update(cx, |s, cx| {
                s.avatars.extend(images.into_iter().map(|(key, bytes)| {
                    (
                        key,
                        Arc::new(Image::from_bytes(ImageFormat::Png, bytes.as_ref().clone())),
                    )
                }));
                cx.notify();
            });
        }));
    }
    fn author_avatar(&self, hash: &str, email: &str, name: &str, diameter: f32) -> AnyElement {
        let image = self
            .avatars
            .get(&email.trim().to_lowercase())
            .or_else(|| self.avatars.get(hash));
        div()
            .size(ui(diameter))
            .rounded_full()
            .overflow_hidden()
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .text_size(ui(diameter * 0.28))
            .font_weight(FontWeight::MEDIUM)
            .when_some(image.cloned(), |d, image| {
                d.child(
                    img(image)
                        .size_full()
                        .rounded_full()
                        .object_fit(ObjectFit::Cover),
                )
            })
            .when(image.is_none(), |d| {
                d.child(
                    name.split_whitespace()
                        .take(2)
                        .filter_map(|word| word.chars().next())
                        .collect::<String>()
                        .to_uppercase(),
                )
            })
            .into_any_element()
    }
    fn select_commit(&mut self, index: usize, cx: &mut Context<Self>) {
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
            cx.notify();
            return;
        }
        self.selected_worktree = None;
        self.changes = true;
        let hash = commit.hash.clone();
        self.selected = Some(hash.clone());
        let cwd = self.cwd.clone();
        let work = cx.background_executor().spawn(async move {
            inferay_native_diff::get_git_commit_details_for_parent(&cwd, &hash, None)
        });
        self.selection_task = Some(cx.spawn(async move |this, cx| {
            let details = work.await;
            let _ = this.update(cx, |view, cx| {
                view.error = details
                    .is_none()
                    .then(|| "Could not load this commit.".into());
                view.details = details;
                if view.open_after_selection {
                    view.open_after_selection = false;
                    view.navigate_file(0, cx);
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn open_file(&mut self, path: String, staged: bool, cx: &mut Context<Self>) {
        if !self.show_diff
            && self.file.as_ref() == Some(&path)
            && self.selected_staged == staged
            && self.diff.is_some()
        {
            self.show_diff = true;
            cx.notify();
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
                        && commit.worktree_path.as_deref() == Some(self.cwd.as_str())
                })
                .map(|commit| commit.id.clone());
        }
        self.selected_staged = staged;
        self.file = Some(path.clone());
        self.diff_scroll.scroll_to_item(0, ScrollStrategy::Top);
        self.clear_diff();
        self.error = None;
        let cwd = self.selected_worktree.as_ref().unwrap_or(&self.cwd).clone();
        let hash = self.selected.clone();
        let theme = self.syntax_theme.clone();
        let work = cx.background_executor().spawn(async move {
            let diff = if let Some(hash) = hash {
                inferay_native_diff::get_git_commit_hunk_diff_for_parent(
                    &cwd, &hash, None, &path, false,
                )
            } else {
                let allowed = AllowedPaths::new(&cwd, &cwd, &cwd).ok()?;
                Some(inferay_native_diff::get_git_hunk_diff(
                    &allowed, &cwd, &path, staged,
                ))
            };
            diff.map(|diff| Arc::new(PreparedDiff::new(diff, &path, &theme)))
        });
        self.diff_task = Some(cx.spawn(async move |this, cx| {
            let mut diff = work.await;
            while let Some(prepared) = diff.take() {
                let Ok(theme) = this.read_with(cx, |view, _| view.syntax_theme.clone()) else {
                    return;
                };
                if prepared.theme == theme {
                    diff = Some(prepared);
                    break;
                }
                diff = Some(
                    cx.background_executor()
                        .spawn(async move { Arc::new(prepared.retheme(&theme)) })
                        .await,
                );
            }
            let _ = this.update(cx, |view, cx| {
                view.error = diff.is_none().then(|| "Could not load this diff.".into());
                view.diff = diff;
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn diff_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let diff = self.diff.clone();
        let count = diff.as_ref().map_or(0, |d| {
            if self.split_diff {
                d.diff.old_lines.len().max(d.diff.new_lines.len())
            } else {
                d.patch.len()
            }
        });
        let split = self.split_diff;
        div()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|s, _, _, _| s.keyboard_scope = "diff"),
            )
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .h(ui(32.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .gap(ui(8.))
                    .px(ui(8.))
                    .child(button("close-diff", "← Graph").on_click(cx.listener(
                        |s, _, window, cx| {
                            s.show_diff = false;
                            s.open_after_selection = false;
                            s.history = true;
                            s.keyboard_scope = "graph";
                            window.focus(&s.focus, cx);
                            cx.notify();
                        },
                    )))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(ui(11.))
                            .text_ellipsis()
                            .child(self.file.clone().unwrap_or_default()),
                    )
                    .child(
                        button("diff-mode", if split { "Split" } else { "Unified" }).on_click(
                            cx.listener(|s, _, _, cx| {
                                s.split_diff = !s.split_diff;
                                cx.notify();
                            }),
                        ),
                    ),
            )
            .when(diff.as_ref().is_some_and(|d| d.diff.is_binary), |d| {
                d.child(div().p(ui(12.)).child("Binary file"))
            })
            .child(
                uniform_list("diff-lines", count, move |range, _, _| {
                    let Some(data) = diff.as_ref() else {
                        return Vec::new();
                    };
                    let diff = &data.diff;
                    range
                        .map(|i| {
                            let row = div()
                                .w_full()
                                .overflow_hidden()
                                .h(ui(colors::DIFF_ROW))
                                .flex()
                                .font_family("Menlo")
                                .line_height(ui(colors::DIFF_ROW))
                                .text_size(ui(colors::DIFF_TEXT));
                            if split {
                                row.children(
                                    [diff.old_lines.get(i), diff.new_lines.get(i)]
                                        .into_iter()
                                        .enumerate()
                                        .map(|(side, line)| {
                                            let tint = match line.map(|l| &l.line_type) {
                                                Some(GitDiffLineType::Add) => 0x55d68b18,
                                                Some(GitDiffLineType::Remove) => 0xff686818,
                                                _ => 0,
                                            };
                                            div()
                                                .w(relative(0.5))
                                                .flex_shrink_0()
                                                .min_w_0()
                                                .h_full()
                                                .overflow_hidden()
                                                .bg(rgba(tint))
                                                .flex()
                                                .gap(ui(8.))
                                                .border_r_1()
                                                .border_color(rgba(0xebebeb0f))
                                                .child(
                                                    div()
                                                        .w(ui(colors::DIFF_GUTTER))
                                                        .text_size(ui(colors::DIFF_NUMBER))
                                                        .text_right()
                                                        .flex_shrink_0()
                                                        .text_color(rgba(0xebebeb60))
                                                        .child(
                                                            line.and_then(|l| l.number)
                                                                .map(|n| n.to_string())
                                                                .unwrap_or_default(),
                                                        ),
                                                )
                                                .child(
                                                    StyledText::new(
                                                        line.map(|l| l.content.clone())
                                                            .unwrap_or_default(),
                                                    )
                                                    .with_highlights(
                                                        if side == 0 {
                                                            &data.old
                                                        } else {
                                                            &data.new
                                                        }
                                                        .get(i)
                                                        .into_iter()
                                                        .flatten()
                                                        .cloned(),
                                                    ),
                                                )
                                        }),
                                )
                            } else {
                                let line = data.patch.get(i).cloned().unwrap_or_default();
                                row.bg(rgba(if line.starts_with('+') {
                                    0x55d68b18
                                } else if line.starts_with('-') {
                                    0xff686818
                                } else {
                                    0
                                }))
                                .child(line)
                            }
                        })
                        .collect()
                })
                .track_scroll(&self.diff_scroll)
                .flex_1()
                .min_h_0(),
            )
    }
}
impl Render for RepositoryView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity().downgrade();
        div()
            .relative()
            .track_focus(&self.focus)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|s, _, window, cx| window.focus(&s.focus, cx)),
            )
            .on_mouse_move(cx.listener(|view, event: &MouseMoveEvent, window, cx| {
                if let Some((start, size)) = view.changes_resize {
                    if view.expanded {
                        view.changes_width = (size
                            + f32::from(start.x - event.position.x) / crate::zoom::factor(window))
                        .clamp(180., (view.available_width - 180.).max(180.));
                    } else {
                        view.changes_height = (size
                            + f32::from(start.y - event.position.y) / crate::zoom::factor(window))
                        .max(100.);
                    }
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|view, _, _, _| {
                    view.changes_resize = None;
                }),
            )
            .on_key_down(cx.listener(Self::navigate))
            .relative()
            .child(
                canvas(
                    move |bounds, window, cx| {
                        let width = f32::from(bounds.size.width) / crate::zoom::factor(window);
                        let _ = entity.update(cx, |s, cx| {
                            if (s.available_width - width).abs() > 1. {
                                s.available_width = width;
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .size_full()
            .flex()
            .flex_col()
            .min_w_0()
            .border_l_1()
            .border_color(rgba(0xebebeb0f))
            .child(
                div()
                    .debug_selector(|| "repository-toolbar".into())
                    .h(ui(32.))
                    .flex_shrink_0()
                    .px(ui(8.))
                    .flex()
                    .items_center()
                    .gap(ui(4.))
                    .border_b_1()
                    .border_color(rgba(0xebebeb0f))
                    .child(
                        button("repository-picker", "")
                            .aria_label("Choose workspace repository")
                            .child(icon("Folder"))
                            .child(
                                div()
                                    .text_size(ui(12.))
                                    .max_w(ui(140.))
                                    .text_ellipsis()
                                    .child(
                                        std::path::Path::new(&self.cwd)
                                            .file_name()
                                            .unwrap_or_default()
                                            .to_string_lossy()
                                            .into_owned(),
                                    ),
                            )
                            .child(icon("ChevronDown"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.repository_menu = !s.repository_menu;
                                cx.notify();
                            })),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(ui(4.))
                            .text_size(ui(11.))
                            .text_color(rgba(0xebebeb80))
                            .child(icon("GitBranch").size(ui(12.)))
                            .child(
                                self.status
                                    .as_ref()
                                    .map(|s| s.branch.clone())
                                    .unwrap_or_default(),
                            ),
                    )
                    .child(div().flex_1())
                    .child(
                        crate::plain_button("history", "History")
                            .hover(|s| s.text_color(rgb(0xffffff)))
                            .on_click(cx.listener(|s, _, _, cx| {
                                if s.show_diff {
                                    s.show_diff = false;
                                    s.history = true;
                                    s.keyboard_scope = "graph";
                                    s.open_after_selection = false;
                                } else {
                                    s.history = !s.history;
                                }
                                if !s.history {
                                    s.changes = true;
                                }
                                cx.notify();
                            })),
                    )
                    .child(
                        crate::plain_button("changes", "Changes")
                            .hover(|s| s.text_color(rgb(0xffffff)))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.changes = !s.changes;
                                if !s.changes {
                                    s.history = true;
                                }
                                cx.notify();
                            })),
                    )
                    .child(
                        button("refresh-git", "↻")
                            .aria_label("Refresh repository")
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.refresh(cx);
                                cx.notify();
                            })),
                    )
                    .child(
                        button("expand-git", "")
                            .aria_label(if self.expanded {
                                "Collapse repository panel"
                            } else {
                                "Expand repository panel"
                            })
                            .size(ui(24.))
                            .p(ui(5.))
                            .flex_shrink_0()
                            .justify_center()
                            .child(
                                icon(if self.expanded { "Collapse" } else { "Expand" })
                                    .size(ui(14.)),
                            )
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.expanded = !s.expanded;
                                cx.emit(RepositoryEvent::Expand);
                                cx.notify();
                            })),
                    ),
            )
            .when(self.loading && self.graph.commits.is_empty(), |d| {
                d.child(
                    div()
                        .px(ui(12.))
                        .text_size(ui(11.))
                        .child("Reading repository…"),
                )
            })
            .when_some(self.error.clone(), |d, error| {
                d.child(div().p(ui(12.)).text_size(ui(11.)).child(error))
            })
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .when(!self.expanded, |d| d.flex_col())
                    .when(self.history || self.show_diff, |d| {
                        d.child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_h_0()
                                .min_w_0()
                                .when(self.history && !self.show_diff, |d| {
                                    d.child(self.graph_table(cx))
                                })
                                .when(self.show_diff, |d| d.child(self.diff_view(cx))),
                        )
                    })
                    .when(self.changes, |d| {
                        d.child(
                            div()
                                .flex()
                                .flex_col()
                                .min_h_0()
                                .min_w_0()
                                .flex_shrink_0()
                                .when(!self.history && !self.show_diff, |d| d.size_full())
                                .when((self.history || self.show_diff) && self.expanded, |d| {
                                    d.w(ui(self.changes_width)).h_full().border_l_1()
                                })
                                .when((self.history || self.show_diff) && !self.expanded, |d| {
                                    d.h(ui(self.changes_height))
                                        .max_h(relative(0.8))
                                        .w_full()
                                        .border_t_1()
                                })
                                .border_color(rgba(0xebebeb0f))
                                .relative()
                                .child(self.changes_panel(cx))
                                .when(self.history || self.show_diff, |d| {
                                    d.child(
                                        div()
                                            .id("resize-changes")
                                            .absolute()
                                            .top_0()
                                            .left_0()
                                            .when(self.expanded, |d| {
                                                d.w(ui(6.)).h_full().cursor_col_resize()
                                            })
                                            .when(!self.expanded, |d| {
                                                d.h(ui(6.)).w_full().cursor_row_resize()
                                            })
                                            .on_mouse_down(
                                                MouseButton::Left,
                                                cx.listener(
                                                    |view, event: &MouseDownEvent, _, cx| {
                                                        view.changes_resize = Some((
                                                            event.position,
                                                            if view.expanded {
                                                                view.changes_width
                                                            } else {
                                                                view.changes_height
                                                            },
                                                        ));
                                                        cx.stop_propagation();
                                                    },
                                                ),
                                            ),
                                    )
                                }),
                        )
                    }),
            )
            .when(self.repository_menu, |d| {
                d.child(
                    crate::menu_surface("repository-menu")
                        .debug_selector(|| "repository-menu".into())
                        .top(ui(32.))
                        .left(ui(8.))
                        .w(ui(260.))
                        .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                            s.repository_menu = false;
                            cx.notify();
                        }))
                        .children(
                            self.repositories
                                .iter()
                                .enumerate()
                                .map(|(i, (name, path))| {
                                    let path = path.clone();
                                    button(("workspace-repository", i), name.clone())
                                        .w_full()
                                        .when(path == self.cwd, |d| d.bg(rgba(0xebebeb17)))
                                        .on_click(cx.listener(move |s, _, _, cx| {
                                            s.repository_menu = false;
                                            cx.emit(RepositoryEvent::Select(path.clone()));
                                            cx.notify();
                                        }))
                                }),
                        )
                        .child(
                            button("add-workspace-repository", "Add repository…")
                                .child(icon("Plus"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.repository_menu = false;
                                    cx.emit(RepositoryEvent::Add);
                                    cx.notify();
                                })),
                        ),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[gpui::test]
    fn repository_geometry_uses_global_zoom_and_logical_viewport_width(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            RepositoryView::new(
                directory.path().to_string_lossy().into_owned(),
                Value::Null,
                "vscode-black".into(),
                0,
                cx,
            )
        });
        view.update(cx, |view, _| {
            view.task = None;
            view.loading = false;
        });
        cx.simulate_resize(size(px(600.), px(600.)));
        cx.draw(point(px(0.), px(0.)), size(px(600.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        let before = cx.debug_bounds("repository-toolbar").unwrap();
        cx.update(|window, _| window.set_rem_size(px(24.)));
        cx.draw(point(px(0.), px(0.)), size(px(600.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        let after = cx.debug_bounds("repository-toolbar").unwrap();
        assert_eq!(after.size.height, before.size.height * 1.5);
        let expected = f32::from(after.size.width) / 1.5;
        assert!((view.read_with(cx, |view, _| view.available_width) - expected).abs() < 1.);
    }

    #[test]
    fn recoloring_shares_source_and_unified_patch_without_rereading_git() {
        let line = GitDiffLine {
            number: Some(1),
            content: "const value = 1;".into(),
            line_type: GitDiffLineType::Context,
        };
        let prepared = PreparedDiff::new(
            GitHunkDiff {
                old_lines: vec![line.clone()],
                new_lines: vec![line],
                raw_patch: Some(" const value = 1;".into()),
                ..Default::default()
            },
            "example.js",
            "vscode-black",
        );
        let recolored = prepared.retheme("vitesse");
        assert!(Arc::ptr_eq(&prepared.diff, &recolored.diff));
        assert!(Arc::ptr_eq(&prepared.patch, &recolored.patch));
        assert_ne!(prepared.new, recolored.new);
    }

    #[gpui::test]
    fn latest_theme_recolors_retained_diff_without_resetting_file_selection(
        cx: &mut gpui::TestAppContext,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let source = Arc::new(PreparedDiff::new(
            GitHunkDiff::default(),
            "example.rs",
            "vscode-black",
        ));
        let window = cx.add_window(|_, cx| {
            let mut view = RepositoryView::new(
                directory.path().to_string_lossy().into_owned(),
                Value::Null,
                "vscode-black".into(),
                0,
                cx,
            );
            view.task = None;
            view.loading = false;
            view.file = Some("example.rs".into());
            view.diff = Some(source.clone());
            view.set_syntax_theme("slack".into(), cx);
            view.set_syntax_theme("vitesse".into(), cx);
            view
        });
        cx.run_until_parked();
        window
            .update(cx, |view, _, _| {
                assert_eq!(view.file.as_deref(), Some("example.rs"));
                let current = view.diff.as_ref().unwrap();
                assert_eq!(current.theme, "vitesse");
                assert!(Arc::ptr_eq(&source.diff, &current.diff));
            })
            .unwrap();
    }
    use core::prelude::v1::test;

    #[gpui::test]
    fn repository_menu_overlays_without_moving_toolbar(cx: &mut TestAppContext) {
        let directory = tempfile::tempdir().unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            RepositoryView::new(
                directory.path().to_string_lossy().into_owned(),
                Value::Null,
                "vscode-black".into(),
                0,
                cx,
            )
        });
        view.update(cx, |view, _| {
            view.task = None;
            view.loading = false;
            view.repositories = vec![
                ("First".into(), "/first".into()),
                ("Second".into(), "/second".into()),
            ];
        });
        cx.draw(point(px(0.), px(0.)), size(px(600.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        let toolbar = cx.debug_bounds("repository-toolbar").unwrap();
        view.update(cx, |view, cx| {
            view.repository_menu = true;
            cx.notify();
        });
        cx.draw(point(px(0.), px(0.)), size(px(600.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        assert_eq!(cx.debug_bounds("repository-toolbar").unwrap(), toolbar);
        let menu = cx.debug_bounds("repository-menu").unwrap();
        assert_eq!(menu.top(), toolbar.bottom());
        assert!(menu.size.height > px(80.));
        cx.simulate_click(point(px(500.), px(500.)), Modifiers::default());
        assert!(!view.read_with(cx, |view, _| view.repository_menu));
    }

    #[gpui::test]
    fn keyboard_returns_to_graph_and_reopens_selected_file(cx: &mut gpui::TestAppContext) {
        let directory = tempfile::tempdir().unwrap();
        let window = cx.add_window(|_, cx| {
            RepositoryView::new(
                directory.path().to_string_lossy().into_owned(),
                Value::Null,
                "vscode-black".into(),
                0,
                cx,
            )
        });
        window.update(cx, |view, window, cx| {
            view.task = None;
            view.loading = false;
            view.graph.commits = vec![GraphCommit { id: "wip".into(), item_kind: GitGraphItemKind::WorktreeWip, ..Default::default() }];
            view.presentation = json!({"selectableItems":["wip"]});
            view.status = Some(serde_json::from_value(json!({"cwd":"", "name":"", "branch":"main", "upstream":null, "ahead":0, "behind":0,
                "files":[{"path":"a.rs","status":"M","staged":false},{"path":"b.rs","status":"M","staged":false}]})).unwrap());
            let key = |key: &str| KeyDownEvent { keystroke: Keystroke::parse(key).unwrap(), is_held:false, prefer_character_input:false };
            view.navigate(&key("down"), window, cx);
            assert_eq!(view.selected_item.as_deref(), Some("wip"));
            view.navigate(&key("right"), window, cx);
            assert!(view.show_diff);
            assert_eq!(view.file.as_deref(), Some("a.rs"));
            view.navigate(&key("down"), window, cx);
            assert_eq!(view.file.as_deref(), Some("b.rs"));
            view.navigate(&key("up"), window, cx);
            assert_eq!(view.file.as_deref(), Some("a.rs"));
            view.navigate(&key("left"), window, cx);
            assert!(!view.show_diff);
            assert_eq!(view.selected_item.as_deref(), Some("wip"));
            assert_eq!(view.file.as_deref(), Some("a.rs"));
            view.navigate(&key("right"), window, cx);
            assert!(view.show_diff);
            assert_eq!(view.file.as_deref(), Some("a.rs"));
            view.diff_task = None;
            let prepared = Arc::new(PreparedDiff::new(GitHunkDiff::default(), "a.rs", "vscode-black"));
            view.diff = Some(prepared.clone());
            view.navigate(&key("left"), window, cx);
            view.navigate(&key("right"), window, cx);
            assert!(view.show_diff);
            assert!(Arc::ptr_eq(view.diff.as_ref().unwrap(), &prepared));
            assert!(view.diff_task.is_none());
        }).unwrap();
    }
    #[gpui::test]
    fn enter_toggles_staging_in_the_selected_worktree(cx: &mut gpui::TestAppContext) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap().join("main");
        let other = directory.path().canonicalize().unwrap().join("other");
        std::fs::create_dir(&root).unwrap();
        let git = |cwd: &std::path::Path, args: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(cwd)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.name", "Test Author"]);
        git(&root, &["config", "user.email", "test@example.invalid"]);
        std::fs::write(root.join("file.txt"), "base\n").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", "Initial"]);
        git(
            &root,
            &["worktree", "add", "-b", "other", other.to_str().unwrap()],
        );
        std::fs::write(root.join("main.txt"), "main only\n").unwrap();
        std::fs::write(other.join("file.txt"), "other staged\n").unwrap();
        git(&other, &["add", "file.txt"]);
        std::fs::write(other.join("file.txt"), "other unstaged\n").unwrap();
        let root = root.to_string_lossy().into_owned();
        let other = other.to_string_lossy().into_owned();
        let window = cx.add_window(|_, cx| {
            RepositoryView::new(root.clone(), Value::Null, "vscode-black".into(), 0, cx)
        });
        window
            .update(cx, |view, window, cx| {
                view.task = None;
                view.loading = false;
                view.history = false;
                view.avatars.insert(
                    "test@example.invalid".into(),
                    Arc::new(Image::from_bytes(ImageFormat::Png, vec![])),
                );
                view.status = inferay_native_diff::get_git_status(&root);
                view.graph = inferay_native_diff::get_git_graph_snapshot_with_query(
                    &root,
                    200,
                    inferay_native_diff::prepare_git_graph(&root),
                    "",
                );
                let index = view
                    .graph
                    .commits
                    .iter()
                    .position(|c| {
                        c.item_kind == GitGraphItemKind::WorktreeWip
                            && c.worktree_path.as_deref() == Some(&other)
                    })
                    .unwrap();
                view.select_commit(index, cx);
                assert_eq!(view.cwd, root);
                assert_eq!(view.selected_worktree.as_deref(), Some(other.as_str()));
                let entries = view.file_entries();
                assert_eq!(entries.len(), 2);
                assert!(entries.iter().all(|f| f.0 == "file.txt"));
                assert!(entries.iter().any(|f| f.4));
                assert!(entries.iter().any(|f| !f.4));
                view.keyboard_scope = "sidebar";
                view.open_file("file.txt".into(), false, cx);
                view.navigate(
                    &KeyDownEvent {
                        keystroke: Keystroke::parse("enter").unwrap(),
                        is_held: false,
                        prefer_character_input: false,
                    },
                    window,
                    cx,
                );
            })
            .unwrap();
        cx.run_until_parked();
        window
            .update(cx, |view, window, cx| {
                assert!(!view.mutating);
                assert!(view.error.is_none(), "{:?}", view.error);
                assert_eq!(view.cwd, root);
                assert_eq!(view.file_entries().len(), 1);
                assert!(view.file_entries()[0].4);
                assert_eq!(view.file.as_deref(), Some("file.txt"));
                assert!(view.selected_staged);
                view.navigate(
                    &KeyDownEvent {
                        keystroke: Keystroke::parse("enter").unwrap(),
                        is_held: true,
                        prefer_character_input: false,
                    },
                    window,
                    cx,
                );
                assert!(!view.mutating);
                view.navigate(
                    &KeyDownEvent {
                        keystroke: Keystroke::parse("enter").unwrap(),
                        is_held: false,
                        prefer_character_input: false,
                    },
                    window,
                    cx,
                );
            })
            .unwrap();
        cx.run_until_parked();
        window
            .update(cx, |view, _, _| {
                assert!(!view.mutating);
                assert!(view.error.is_none(), "{:?}", view.error);
                assert_eq!(view.file_entries().len(), 1);
                assert!(!view.file_entries()[0].4);
                assert_eq!(view.file.as_deref(), Some("file.txt"));
                assert!(!view.selected_staged);
                assert_eq!(view.cwd, root);
            })
            .unwrap();
        assert!(!inferay_native_diff::get_git_status(&root).unwrap().files[0].staged);
        assert_eq!(
            std::fs::read_to_string(std::path::Path::new(&other).join("file.txt")).unwrap(),
            "other unstaged\n"
        );
    }
    #[test]
    fn diff_highlights_keep_multiline_context_and_utf8_row_ranges() {
        let lines = [
            "@@ -1,3 +1,3 @@",
            "/* comment",
            "😀 comment */",
            "const value = 1;",
        ]
        .into_iter()
        .enumerate()
        .map(|(index, content)| GitDiffLine {
            number: Some(index),
            content: content.into(),
            line_type: if index == 0 {
                GitDiffLineType::Hunk
            } else {
                GitDiffLineType::Context
            },
        })
        .collect::<Vec<_>>();
        let prepared = PreparedDiff::new(
            GitHunkDiff {
                old_lines: lines.clone(),
                new_lines: lines,
                ..Default::default()
            },
            "example.ts",
            "vscode-black",
        );
        assert!(prepared.old[0].is_empty());
        for (line, runs) in prepared.diff.new_lines.iter().zip(&prepared.new) {
            for (range, _) in runs {
                assert!(line.content.get(range.clone()).is_some());
            }
        }
        assert!(
            prepared.new[2]
                .iter()
                .any(|(_, style)| style.color == Some(rgb(0x777777).into())
                    && style.font_style == Some(FontStyle::Italic))
        );
        assert!(
            prepared.new[3]
                .iter()
                .any(|(_, style)| style.color == Some(rgb(0x569cd6).into()))
        );
    }
}
