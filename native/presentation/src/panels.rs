//! Shared workbench transitions. The native server is the durable writer.
use crate::wasm_json;
use serde_json::{Value, json};

#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
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

fn clear_selection(session: &mut Value) {
    for key in ["selectedFile", "selectedCommitHash", "selectedCommitParent"] {
        session[key] = Value::Null;
    }
    session["selectedCommitIds"] = json!([]);
}

fn focus(session: &mut Value, id: &str, cwd: &Value) {
    session["focusedAuxiliaryPanel"] = json!({"id":id,"cwd":cwd});
}

pub fn apply_action(
    session: &mut Value,
    action: &Value,
    now: u64,
) -> Result<Option<String>, String> {
    let action: PanelAction = serde_json::from_value(action.clone()).map_err(|e| e.to_string())?;
    let selected_source = session["selectedFile"]["source"]["kind"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    match action {
        PanelAction::Initialize { cwd, reveal } => {
            if session["repositoryInitialized"] == true && session["diffViewerCwd"].is_string() {
                return Ok(None);
            }
            let reveal = reveal.unwrap_or(true);
            if session["diffViewerCwd"].is_null() {
                session["diffViewerCwd"] = json!(cwd);
                session["mainViewMode"] = json!("graph");
            }
            session["repositoryInitialized"] = json!(true);
            session["sidebarVisible"] = json!(reveal);
            session["graphVisible"] = json!(reveal);
        }
        PanelAction::OpenGraph { cwd, reset } => {
            if reset == Some(true) {
                clear_selection(session);
            }
            session["diffViewerCwd"] = json!(cwd);
            session["mainViewMode"] = json!("graph");
            session["graphVisible"] = json!(true);
            focus(session, "workspace-diff-viewer", &json!(cwd));
        }
        PanelAction::ToggleGraph { cwd } => {
            if session["mainViewMode"] == "graph" && session["graphVisible"] == true {
                session["graphVisible"] = json!(false);
            } else {
                session["diffViewerCwd"] = json!(cwd);
                session["mainViewMode"] = json!("graph");
                session["graphVisible"] = json!(true);
                focus(session, "workspace-diff-viewer", &json!(cwd));
            }
        }
        PanelAction::FocusChat { cwd } => {
            if let Some(cwd) = cwd.filter(|_| session["mainViewMode"] == "graph") {
                if session["diffViewerCwd"] != cwd {
                    clear_selection(session);
                }
                session["diffViewerCwd"] = json!(cwd);
            }
            session["focusedAuxiliaryPanel"] = Value::Null;
        }
        PanelAction::Focus { panel } => session["focusedAuxiliaryPanel"] = json!(panel),
        PanelAction::Mode { mode } => session["mainViewMode"] = json!(mode),
        PanelAction::ToggleSidebar => {
            session["sidebarVisible"] = json!(session["sidebarVisible"] != true);
        }
        PanelAction::Document { cwd, path } => {
            session["fileViewerCwd"] = json!(cwd);
            session["fileViewerOpen"] = json!(true);
            session["fileRequest"] = json!({"path":path,"token":now});
            focus(session, "workspace-file-viewer", &json!(cwd));
        }
        PanelAction::DetachFile { id, cwd, path, .. } => {
            let panels = session["detachedFilePanels"]
                .as_array_mut()
                .expect("normalized panels");
            if !panels.iter().any(|panel| panel["id"] == id) {
                panels.push(json!({"id":id,"cwd":cwd,"path":path}));
            }
            session["focusedAuxiliaryPanel"] = json!({"id":id,"cwd":cwd});
        }
        PanelAction::CloseFile { id } => {
            if id == "workspace-file-viewer" {
                session["fileViewerOpen"] = json!(false);
            } else {
                session["detachedFilePanels"]
                    .as_array_mut()
                    .expect("normalized panels")
                    .retain(|panel| panel["id"] != id);
            }
            if session["focusedAuxiliaryPanel"]["id"] == id {
                session["focusedAuxiliaryPanel"] = Value::Null;
            }
        }
        PanelAction::Documents {
            session_id,
            cwd,
            active_path,
            paths,
        } => {
            session["documentSessions"][session_id] = json!({
                "cwd": cwd, "activePath": active_path, "paths": paths,
            });
        }
        PanelAction::DismissDiff => {
            session["mainViewMode"] = json!("graph");
            if session["diffViewerCwd"].is_string() {
                let cwd = session["diffViewerCwd"].clone();
                focus(session, "workspace-diff-viewer", &cwd);
            }
        }
        PanelAction::WorkingTreeFile { cwd, path, staged } => {
            let kind = if session["mainViewMode"] == "graph"
                || (session["mainViewMode"] == "diff" && selected_source == "graphWorkingTree")
            {
                "graphWorkingTree"
            } else {
                "workingTree"
            };
            select_file(session, cwd, path, staged, json!({"kind":kind}));
        }
        PanelAction::CommitFile {
            cwd,
            path,
            commit_hash,
            commit_parent,
        } => {
            select_file(
                session,
                cwd,
                path,
                false,
                json!({
                    "kind":"commit", "commitHash":commit_hash, "commitParent":commit_parent
                }),
            );
        }
        PanelAction::ComparisonFile {
            cwd,
            path,
            from,
            to,
        } => {
            select_file(
                session,
                cwd,
                path,
                false,
                json!({
                    "kind":"comparison", "comparisonFrom":from, "comparisonTo":to
                }),
            );
        }
        PanelAction::ReconcileFile { expected, staged } => {
            if session["selectedFile"] == json!(expected) {
                if let Some(staged) = staged {
                    session["selectedFile"]["staged"] = json!(staged);
                } else {
                    session["selectedFile"] = Value::Null;
                    if session["graphVisible"] == true {
                        session["mainViewMode"] = json!("graph");
                    } else {
                        session["diffViewerCwd"] = Value::Null;
                    }
                }
            }
        }
        PanelAction::SelectGraph {
            id,
            ordered_ids,
            intent,
        } => {
            return select_graph(session, id, &ordered_ids, intent.as_ref());
        }
        PanelAction::ReconcileGraph { items } => return reconcile_graph(session, &items),
    }
    Ok(None)
}

fn select_file(session: &mut Value, cwd: String, path: String, staged: bool, source: Value) {
    session["selectedFile"] = json!({"path":path,"staged":staged,"source":source});
    session["mainViewMode"] = json!("diff");
    session["diffViewerCwd"] = json!(cwd);
    focus(session, "workspace-diff-viewer", &json!(cwd));
}

struct GraphSelection {
    primary: Option<String>,
    ids: Vec<String>,
}
impl GraphSelection {
    fn read(session: &Value) -> Self {
        Self {
            primary: session["selectedCommitHash"].as_str().map(str::to_owned),
            ids: session["selectedCommitIds"]
                .as_array()
                .expect("normalized selection")
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
        }
    }
    fn write(self, session: &mut Value) {
        session["selectedCommitHash"] = json!(self.primary);
        session["selectedCommitIds"] = json!(self.ids);
        session["selectedCommitParent"] = Value::Null;
    }
}

fn select_graph(
    session: &mut Value,
    id: Option<String>,
    ordered_ids: &[String],
    intent: Option<&SelectionIntent>,
) -> Result<Option<String>, String> {
    let old = GraphSelection::read(session);
    let mut ids = id.iter().cloned().collect::<Vec<_>>();
    if let Some(id) = &id {
        if intent.is_some_and(|intent| intent.range) && old.primary.is_some() {
            if let (Some(anchor), Some(target)) = (
                ordered_ids
                    .iter()
                    .position(|item| Some(item) == old.primary.as_ref()),
                ordered_ids.iter().position(|item| item == id),
            ) {
                ids = ordered_ids[anchor.min(target)..=anchor.max(target)].to_vec();
            }
        } else if intent.is_some_and(|intent| intent.additive) {
            ids = old.ids.clone();
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
    if primary.is_some() && (primary != old.primary || ids != old.ids) {
        session["selectedFile"] = Value::Null;
    }
    GraphSelection { primary, ids }.write(session);
    Ok(None)
}

fn reconcile_graph(session: &mut Value, items: &[GraphItem]) -> Result<Option<String>, String> {
    let Some(first) = items.first() else {
        return Ok(None);
    };
    let old = GraphSelection::read(session);
    let visible = |id: &str| items.iter().any(|item| item.id == id);
    let mut ids = old
        .ids
        .iter()
        .filter(|id| visible(id))
        .cloned()
        .collect::<Vec<_>>();
    if ids.is_empty() {
        ids.push(first.id.clone());
    }
    let primary = old
        .primary
        .clone()
        .filter(|id| visible(id))
        .or_else(|| ids.last().cloned());
    let announcement =
        (old.primary.is_some() && (primary != old.primary || ids != old.ids)).then(|| {
            format!(
                "The selected graph item is no longer available. Selected {}.",
                first.message
            )
        });
    GraphSelection { primary, ids }.write(session);
    Ok(announcement)
}

pub fn normalize(value: &Value) -> Value {
    let string = |key: &str| {
        value
            .get(key)
            .filter(|value| value.is_string())
            .cloned()
            .unwrap_or(Value::Null)
    };
    let mode = if value["mainViewMode"] == "graph" {
        "graph"
    } else {
        "diff"
    };
    let mut session = json!({
        "repositoryInitialized":value["repositoryInitialized"].as_bool().unwrap_or(matches!(value["mainViewMode"].as_str(), Some("graph" | "diff"))),
        "sidebarVisible":value["sidebarVisible"].as_bool().unwrap_or(mode == "graph"),
        "graphVisible":value["graphVisible"].as_bool().unwrap_or(value["sidebarVisible"].as_bool().unwrap_or(mode == "graph")),
        "fileViewerOpen":value["fileViewerOpen"] == true,
        "fileViewerCwd":string("fileViewerCwd"), "diffViewerCwd":string("diffViewerCwd"),
        "focusedAuxiliaryPanel":null, "detachedFilePanels":[], "documentSessions":{}, "fileRequest":null, "selectedFile":null,
        "selectedCommitHash":string("selectedCommitHash"),
        "selectedCommitParent":string("selectedCommitParent"),
        "selectedCommitIds":[], "mainViewMode":mode
    });
    let focus = &value["focusedAuxiliaryPanel"];
    if focus["id"].is_string() && focus["cwd"].is_string() {
        session["focusedAuxiliaryPanel"] = json!({"id":focus["id"], "cwd":focus["cwd"]});
    }
    session["detachedFilePanels"] = Value::Array(
        value["detachedFilePanels"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|panel| {
                panel["id"].is_string() && panel["cwd"].is_string() && panel["path"].is_string()
            })
            .map(|panel| json!({"id":panel["id"], "cwd":panel["cwd"], "path":panel["path"]}))
            .collect(),
    );
    session["documentSessions"] = value["documentSessions"]
        .as_object()
        .map(|_| value["documentSessions"].clone())
        .unwrap_or_else(|| json!({}));
    let file = &value["selectedFile"];
    if file["path"].is_string() && file["staged"].is_boolean() {
        session["selectedFile"] =
            json!({"path":file["path"], "staged":file["staged"], "source":file_source(value)});
    }
    if value["fileRequest"]["path"].is_string() {
        let token = value["fileRequest"]["token"].as_u64().unwrap_or(0);
        session["fileRequest"] = json!({"path":value["fileRequest"]["path"], "token":token});
    }
    session["selectedCommitIds"] = match value["selectedCommitIds"].as_array() {
        Some(ids) => Value::Array(ids.iter().filter(|id| id.is_string()).cloned().collect()),
        None => Value::Array(
            session["selectedCommitHash"]
                .as_str()
                .map(|hash| vec![json!(hash)])
                .unwrap_or_default(),
        ),
    };
    let context = session["selectedFile"]["source"]["kind"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let diff_mode = session["mainViewMode"] == "diff";
    session["graphDrillIn"] = json!(
        diff_mode
            && matches!(
                context.as_str(),
                "graphWorkingTree" | "commit" | "comparison"
            )
    );
    session["historicalDiff"] =
        json!(diff_mode && matches!(context.as_str(), "commit" | "comparison"));
    session["sidebarContent"] = json!(sidebar_content(&session));
    session
}

/// Without the graph, the sidebar is a direct entry point to current changes.
pub fn sidebar_content(session: &Value) -> &'static str {
    if session["graphVisible"] == false {
        return "workingTree";
    }
    if session["mainViewMode"] == "graph" {
        if session["selectedCommitHash"]
            .as_str()
            .is_some_and(|id| id == "wip" || id.starts_with("wip:"))
        {
            "workingTree"
        } else {
            "history"
        }
    } else if matches!(
        session["selectedFile"]["source"]["kind"].as_str(),
        Some("workingTree" | "graphWorkingTree")
    ) {
        "workingTree"
    } else {
        "history"
    }
}

#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub cwd: String,
    pub path: String,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DetachedFilePanel {
    pub id: String,
    pub cwd: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub initial_file: Option<FileContent>,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSession {
    pub cwd: String,
    pub active_path: Option<String>,
    pub paths: Vec<String>,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct FocusedPanel {
    pub id: String,
    pub cwd: String,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct FileRequest {
    pub path: String,
    pub token: u64,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct SelectedPanelFile {
    pub path: String,
    pub staged: bool,
    pub source: DiffSource,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum MainView {
    Diff,
    Graph,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum SidebarContent {
    WorkingTree,
    History,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
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
    pub graph_drill_in: bool,
    pub historical_diff: bool,
    pub sidebar_content: SidebarContent,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct SelectionIntent {
    pub additive: bool,
    pub range: bool,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct GraphItem {
    pub id: String,
    pub message: String,
}
#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
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
    DetachFile {
        id: String,
        cwd: String,
        path: String,
        #[ts(optional)]
        initial_file: Option<FileContent>,
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

/// Optimistic panel metadata. File bodies remain in the renderer's cache.
#[wasm_bindgen::prelude::wasm_bindgen]
#[derive(Default)]
pub struct PanelReplica {
    workspaces: std::collections::HashMap<String, PanelPending>,
    sequence: u32,
}
#[derive(Default)]
struct PanelPending {
    canonical: Value,
    pending: Vec<(u32, Value, u64)>,
    revision: u32,
}
impl PanelPending {
    fn session(&self) -> Value {
        let mut session = normalize(&self.canonical);
        for (_, action, now) in &self.pending {
            // Actions are validated before admission; replay uses the same reducer.
            apply_action(&mut session, action, *now).expect("admitted panel action");
        }
        normalize(&session)
    }
}
#[wasm_bindgen::prelude::wasm_bindgen]
impl PanelReplica {
    #[wasm_bindgen(constructor)]
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
    ) -> Result<String, wasm_bindgen::JsValue> {
        let action: Value = wasm_json::parse(action)?;
        let current: Value = wasm_json::parse(current)?;
        let state = self.workspaces.entry(workspace.into()).or_default();
        let mut next = normalize(&current);
        wasm_json::result(apply_action(&mut next, &action, now as u64))?;
        if state.pending.is_empty() {
            state.canonical = current;
        }
        self.sequence += 1;
        state.pending.push((self.sequence, action, now as u64));
        Ok(json!({"sequence": self.sequence, "session": normalize(&next)}).to_string())
    }
    pub fn load(
        &mut self,
        workspace: &str,
        revision: u32,
        session: &str,
    ) -> Result<String, wasm_bindgen::JsValue> {
        let session = wasm_json::parse(session)?;
        let state = self.workspaces.entry(workspace.into()).or_default();
        if state.revision == revision {
            state.canonical = session;
        }
        Ok(state.session().to_string())
    }
    pub fn settle(
        &mut self,
        workspace: &str,
        sequence: u32,
        session: Option<String>,
    ) -> Result<String, wasm_bindgen::JsValue> {
        let canonical = session.map(|s| wasm_json::parse(&s)).transpose()?;
        let state = self.workspaces.entry(workspace.into()).or_default();
        state.pending.retain(|(id, _, _)| *id != sequence);
        if let Some(canonical) = canonical {
            state.canonical = canonical;
            state.revision += 1;
        }
        Ok(state.session().to_string())
    }
}
