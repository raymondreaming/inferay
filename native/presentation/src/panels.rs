//! Shared workbench transitions. The native server is the durable writer.
use crate::json_wire;
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DiffSource {
    WorkingTree,
    GraphWorkingTree,
    Commit {
        commit_hash: String,
        commit_parent: Option<String>,
    },
    Comparison {
        comparison_from: String,
        comparison_to: String,
    },
}

fn file_source(value: &Value) -> DiffSource {
    serde_json::from_value(value["selectedFile"]["source"].clone()).unwrap_or_else(|_| {
        // Convert saved panels from the previous flat representation once on read.
        if let Some(hash) = value["selectedFileCommitHash"].as_str() {
            DiffSource::Commit {
                commit_hash: hash.into(),
                commit_parent: value["selectedFileCommitParent"]
                    .as_str()
                    .map(str::to_owned),
            }
        } else if let (Some(from), Some(to)) = (
            value["selectedFileComparisonFrom"].as_str(),
            value["selectedFileComparisonTo"].as_str(),
        ) {
            DiffSource::Comparison {
                comparison_from: from.into(),
                comparison_to: to.into(),
            }
        } else if value["diffContext"] == "graphWorkingTree"
            || (value["diffContext"] != "workingTree" && value["selectedCommitHash"].is_string())
        {
            DiffSource::GraphWorkingTree
        } else {
            DiffSource::WorkingTree
        }
    })
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub cwd: String,
    pub path: String,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DetachedFilePanel {
    pub id: String,
    pub cwd: String,
    pub path: String,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSession {
    pub cwd: String,
    pub active_path: Option<String>,
    pub paths: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct FocusedPanel {
    pub id: String,
    pub cwd: String,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct FileRequest {
    pub path: String,
    pub token: u64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct SelectedPanelFile {
    pub path: String,
    pub staged: bool,
    pub source: DiffSource,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum MainView {
    Diff,
    Graph,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum SidebarContent {
    WorkingTree,
    History,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PanelSession {
    pub repository_initialized: bool,
    pub sidebar_visible: bool,
    pub graph_visible: bool,
    pub file_viewer_open: bool,
    pub file_viewer_cwd: Option<String>,
    pub diff_viewer_cwd: Option<String>,
    pub focused_auxiliary_panel: Option<FocusedPanel>,
    pub detached_file_panels: Vec<DetachedFilePanel>,
    pub document_sessions: std::collections::BTreeMap<String, DocumentSession>,
    pub file_request: Option<FileRequest>,
    pub selected_file: Option<SelectedPanelFile>,
    pub selected_commit_hash: Option<String>,
    pub selected_commit_ids: Vec<String>,
    pub selected_commit_parent: Option<String>,
    pub main_view_mode: MainView,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct SelectionIntent {
    pub additive: bool,
    pub range: bool,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct GraphItem {
    pub id: String,
    pub message: String,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PanelAction {
    Initialize {
        #[ts(optional)]
        cwd: Option<String>,
        #[serde(default)]
        #[ts(optional)]
        reveal: Option<bool>,
    },
    FocusChat {
        #[ts(optional)]
        cwd: Option<String>,
    },
    OpenGraph {
        cwd: String,
        #[ts(optional)]
        reset: Option<bool>,
    },
    Focus {
        panel: Option<FocusedPanel>,
    },
    Mode {
        mode: MainView,
    },
    ToggleSidebar,
    ToggleGraph {
        cwd: String,
    },
    DismissDiff,
    Document {
        cwd: String,
        path: String,
    },
    CloseFile {
        id: String,
    },
    Documents {
        session_id: String,
        cwd: String,
        active_path: Option<String>,
        paths: Vec<String>,
    },
    WorkingTreeFile {
        cwd: String,
        path: String,
        staged: bool,
    },
    CommitFile {
        cwd: String,
        path: String,
        commit_hash: String,
        commit_parent: Option<String>,
    },
    ComparisonFile {
        cwd: String,
        path: String,
        from: String,
        to: String,
    },
    SelectGraph {
        id: Option<String>,
        ordered_ids: Vec<String>,
        #[ts(optional)]
        intent: Option<SelectionIntent>,
    },
    ReconcileGraph {
        items: Vec<GraphItem>,
    },
    ReconcileFile {
        expected: Option<SelectedPanelFile>,
        staged: Option<bool>,
    },
}

impl PanelSession {
    /// Tolerate incomplete saved sessions and migrate the previous flat diff source.
    /// Actions operate on this model directly; only external snapshots need repair.
    pub fn read(value: &Value) -> Self {
        fn read<T: serde::de::DeserializeOwned + Default>(value: &Value) -> T {
            serde_json::from_value(value.clone()).unwrap_or_default()
        }
        let main_view_mode = if value["mainViewMode"] == "graph" {
            MainView::Graph
        } else {
            MainView::Diff
        };
        let sidebar_visible = value["sidebarVisible"]
            .as_bool()
            .unwrap_or(main_view_mode == MainView::Graph);
        let selected_commit_hash: Option<String> = read(&value["selectedCommitHash"]);
        Self {
            repository_initialized: value["repositoryInitialized"].as_bool().unwrap_or(matches!(
                value["mainViewMode"].as_str(),
                Some("graph" | "diff")
            )),
            sidebar_visible,
            graph_visible: value["graphVisible"].as_bool().unwrap_or(sidebar_visible),
            file_viewer_open: value["fileViewerOpen"] == true,
            file_viewer_cwd: read(&value["fileViewerCwd"]),
            diff_viewer_cwd: read(&value["diffViewerCwd"]),
            focused_auxiliary_panel: read(&value["focusedAuxiliaryPanel"]),
            detached_file_panels: value["detachedFilePanels"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|panel| serde_json::from_value(panel.clone()).ok())
                .collect(),
            document_sessions: value["documentSessions"]
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(id, value)| {
                    serde_json::from_value(value.clone())
                        .ok()
                        .map(|session| (id.clone(), session))
                })
                .collect(),
            file_request: value["fileRequest"]["path"]
                .as_str()
                .map(|path| FileRequest {
                    path: path.into(),
                    token: value["fileRequest"]["token"].as_u64().unwrap_or(0),
                }),
            selected_file: value["selectedFile"]["path"]
                .as_str()
                .zip(value["selectedFile"]["staged"].as_bool())
                .map(|(path, staged)| SelectedPanelFile {
                    path: path.into(),
                    staged,
                    source: file_source(value),
                }),
            selected_commit_ids: value["selectedCommitIds"]
                .as_array()
                .map(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_else(|| selected_commit_hash.iter().cloned().collect()),
            selected_commit_hash,
            selected_commit_parent: read(&value["selectedCommitParent"]),
            main_view_mode,
        }
    }

    pub fn presentation(&self) -> PanelPresentation {
        let source = self.selected_file.as_ref().map(|file| &file.source);
        let diff = self.main_view_mode == MainView::Diff;
        let working_tree = !self.graph_visible
            || if self.main_view_mode == MainView::Graph {
                self.selected_commit_hash
                    .as_deref()
                    .is_some_and(|id| id == "wip" || id.starts_with("wip:"))
            } else {
                matches!(
                    source,
                    Some(DiffSource::WorkingTree | DiffSource::GraphWorkingTree)
                )
            };
        PanelPresentation {
            graph_drill_in: diff
                && matches!(
                    source,
                    Some(
                        DiffSource::GraphWorkingTree
                            | DiffSource::Commit { .. }
                            | DiffSource::Comparison { .. }
                    )
                ),
            historical_diff: diff
                && matches!(
                    source,
                    Some(DiffSource::Commit { .. } | DiffSource::Comparison { .. })
                ),
            sidebar_content: if working_tree {
                SidebarContent::WorkingTree
            } else {
                SidebarContent::History
            },
        }
    }

    fn clear_selection(&mut self) {
        self.selected_file = None;
        self.selected_commit_hash = None;
        self.selected_commit_parent = None;
        self.selected_commit_ids.clear();
    }

    fn focus(&mut self, id: String, cwd: String) {
        self.focused_auxiliary_panel = Some(FocusedPanel { id, cwd });
    }

    fn select_file(&mut self, cwd: String, path: String, staged: bool, source: DiffSource) {
        self.selected_file = Some(SelectedPanelFile {
            path,
            staged,
            source,
        });
        self.main_view_mode = MainView::Diff;
        self.diff_viewer_cwd = Some(cwd.clone());
        self.focus("workspace-diff-viewer".into(), cwd);
    }

    pub fn apply(&mut self, action: PanelAction, now: u64) -> Option<String> {
        match action {
            PanelAction::Initialize { cwd, reveal } => {
                if self.repository_initialized && self.diff_viewer_cwd.is_some() {
                    return None;
                }
                if self.diff_viewer_cwd.is_none() {
                    self.diff_viewer_cwd = cwd;
                    self.main_view_mode = MainView::Graph;
                }
                self.repository_initialized = true;
                self.sidebar_visible = reveal.unwrap_or(true);
                self.graph_visible = self.sidebar_visible;
            }
            PanelAction::OpenGraph { cwd, reset } => {
                if reset == Some(true) {
                    self.clear_selection();
                }
                self.diff_viewer_cwd = Some(cwd.clone());
                self.main_view_mode = MainView::Graph;
                self.graph_visible = true;
                self.focus("workspace-diff-viewer".into(), cwd);
            }
            PanelAction::ToggleGraph { cwd } => {
                if self.main_view_mode == MainView::Graph && self.graph_visible {
                    self.graph_visible = false;
                } else {
                    self.apply(PanelAction::OpenGraph { cwd, reset: None }, now);
                }
            }
            PanelAction::FocusChat { cwd } => {
                if let Some(cwd) = cwd.filter(|_| self.main_view_mode == MainView::Graph) {
                    if self.diff_viewer_cwd.as_ref() != Some(&cwd) {
                        self.clear_selection();
                    }
                    self.diff_viewer_cwd = Some(cwd);
                }
                self.focused_auxiliary_panel = None;
            }
            PanelAction::Focus { panel } => self.focused_auxiliary_panel = panel,
            PanelAction::Mode { mode } => self.main_view_mode = mode,
            PanelAction::ToggleSidebar => self.sidebar_visible = !self.sidebar_visible,
            PanelAction::Document { cwd, path } => {
                self.file_viewer_cwd = Some(cwd.clone());
                self.file_viewer_open = true;
                self.file_request = Some(FileRequest { path, token: now });
                self.focus("workspace-file-viewer".into(), cwd);
            }
            PanelAction::CloseFile { id } => {
                if id == "workspace-file-viewer" {
                    self.file_viewer_open = false;
                } else {
                    self.detached_file_panels.retain(|panel| panel.id != id);
                }
                if self
                    .focused_auxiliary_panel
                    .as_ref()
                    .is_some_and(|panel| panel.id == id)
                {
                    self.focused_auxiliary_panel = None;
                }
            }
            PanelAction::Documents {
                session_id,
                cwd,
                active_path,
                paths,
            } => {
                self.document_sessions.insert(
                    session_id,
                    DocumentSession {
                        cwd,
                        active_path,
                        paths,
                    },
                );
            }
            PanelAction::DismissDiff => {
                self.main_view_mode = MainView::Graph;
                if let Some(cwd) = self.diff_viewer_cwd.clone() {
                    self.focus("workspace-diff-viewer".into(), cwd);
                }
            }
            PanelAction::WorkingTreeFile { cwd, path, staged } => {
                let source = if self.main_view_mode == MainView::Graph
                    || self
                        .selected_file
                        .as_ref()
                        .is_some_and(|file| file.source == DiffSource::GraphWorkingTree)
                {
                    DiffSource::GraphWorkingTree
                } else {
                    DiffSource::WorkingTree
                };
                self.select_file(cwd, path, staged, source);
            }
            PanelAction::CommitFile {
                cwd,
                path,
                commit_hash,
                commit_parent,
            } => {
                self.select_file(
                    cwd,
                    path,
                    false,
                    DiffSource::Commit {
                        commit_hash,
                        commit_parent,
                    },
                );
            }
            PanelAction::ComparisonFile {
                cwd,
                path,
                from,
                to,
            } => {
                self.select_file(
                    cwd,
                    path,
                    false,
                    DiffSource::Comparison {
                        comparison_from: from,
                        comparison_to: to,
                    },
                );
            }
            PanelAction::ReconcileFile { expected, staged } => {
                if self.selected_file == expected {
                    if let Some(staged) = staged {
                        if let Some(file) = &mut self.selected_file {
                            file.staged = staged;
                        }
                    } else {
                        self.selected_file = None;
                        if self.graph_visible {
                            self.main_view_mode = MainView::Graph;
                        } else {
                            self.diff_viewer_cwd = None;
                        }
                    }
                }
            }
            PanelAction::SelectGraph {
                id,
                ordered_ids,
                intent,
            } => {
                let mut ids: Vec<_> = id.iter().cloned().collect();
                if let Some(id) = &id {
                    if intent.as_ref().is_some_and(|intent| intent.range)
                        && self.selected_commit_hash.is_some()
                    {
                        if let (Some(anchor), Some(target)) = (
                            ordered_ids
                                .iter()
                                .position(|item| Some(item) == self.selected_commit_hash.as_ref()),
                            ordered_ids.iter().position(|item| item == id),
                        ) {
                            ids = ordered_ids[anchor.min(target)..=anchor.max(target)].to_vec();
                        }
                    } else if intent.as_ref().is_some_and(|intent| intent.additive) {
                        ids = self.selected_commit_ids.clone();
                        if ids.contains(id) {
                            ids.retain(|candidate| candidate != id);
                        } else {
                            ids.push(id.clone());
                        }
                    }
                }
                let primary = id
                    .filter(|id| ids.contains(id))
                    .or_else(|| ids.last().cloned());
                if primary.is_some()
                    && (primary != self.selected_commit_hash || ids != self.selected_commit_ids)
                {
                    self.selected_file = None;
                }
                self.selected_commit_hash = primary;
                self.selected_commit_ids = ids;
                self.selected_commit_parent = None;
            }
            PanelAction::ReconcileGraph { items } => {
                let first = items.first()?;
                let visible = |id: &str| items.iter().any(|item| item.id == id);
                let mut ids: Vec<_> = self
                    .selected_commit_ids
                    .iter()
                    .filter(|id| visible(id))
                    .cloned()
                    .collect();
                if ids.is_empty() {
                    ids.push(first.id.clone());
                }
                let primary = self
                    .selected_commit_hash
                    .clone()
                    .filter(|id| visible(id))
                    .or_else(|| ids.last().cloned());
                let announcement = (self.selected_commit_hash.is_some()
                    && (primary != self.selected_commit_hash || ids != self.selected_commit_ids))
                    .then(|| {
                        format!(
                            "The selected graph item is no longer available. Selected {}.",
                            first.message
                        )
                    });
                self.selected_commit_hash = primary;
                self.selected_commit_ids = ids;
                self.selected_commit_parent = None;
                return announcement;
            }
        }
        None
    }
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PanelPresentation {
    pub graph_drill_in: bool,
    pub historical_diff: bool,
    pub sidebar_content: SidebarContent,
}

/// Optimistic panel metadata. File bodies remain in the renderer's cache.

#[derive(Default)]
pub struct PanelReplica {
    workspaces: std::collections::HashMap<String, PanelPending>,
    sequence: u32,
}
struct PanelPending {
    canonical: PanelSession,
    pending: Vec<(u32, PanelAction, u64)>,
    revision: u32,
}
impl Default for PanelPending {
    fn default() -> Self {
        Self {
            canonical: PanelSession::read(&Value::Null),
            pending: Vec::new(),
            revision: 0,
        }
    }
}
impl PanelPending {
    fn session(&self) -> PanelSession {
        let mut session = self.canonical.clone();
        for (_, action, now) in &self.pending {
            session.apply(action.clone(), *now);
        }
        session
    }
}

impl PanelReplica {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn revision(&mut self, workspace: &str) -> u32 {
        self.workspaces
            .entry(workspace.into())
            .or_default()
            .revision
    }
    pub fn preview(
        &mut self,
        workspace: &str,
        action: &str,
        now: f64,
        current: &str,
    ) -> Result<String, String> {
        let action: PanelAction = json_wire::parse(action)?;
        let current: PanelSession = json_wire::parse(current)?;
        let state = self.workspaces.entry(workspace.into()).or_default();
        let mut next = current.clone();
        next.apply(action.clone(), now as u64);
        if state.pending.is_empty() {
            state.canonical = current;
        }
        self.sequence += 1;
        state.pending.push((self.sequence, action, now as u64));
        Ok(json!({"sequence": self.sequence, "session": next}).to_string())
    }
    pub fn load(
        &mut self,
        workspace: &str,
        revision: u32,
        session: &str,
    ) -> Result<String, String> {
        let session = json_wire::parse(session)?;
        let state = self.workspaces.entry(workspace.into()).or_default();
        if state.revision == revision {
            state.canonical = session;
        }
        Ok(json_wire::stringify(&state.session(), "panel session"))
    }
    pub fn settle(
        &mut self,
        workspace: &str,
        sequence: u32,
        session: Option<String>,
    ) -> Result<String, String> {
        let canonical = session.map(|s| json_wire::parse(&s)).transpose()?;
        let state = self.workspaces.entry(workspace.into()).or_default();
        state.pending.retain(|(id, _, _)| *id != sequence);
        if let Some(canonical) = canonical {
            state.canonical = canonical;
            state.revision += 1;
        }
        Ok(json_wire::stringify(&state.session(), "panel session"))
    }
}
