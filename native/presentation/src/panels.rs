//! Shared workbench transitions. The native server is the durable writer.
use serde_json::{Value, json};
fn required<T>(value: Option<T>, message: &str) -> Result<T, String> {
    value.ok_or_else(|| message.to_owned())
}

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
    // Validate the command against the same enum that generates renderer bindings.
    let _: PanelAction = serde_json::from_value(action.clone()).map_err(|e| e.to_string())?;
    let kind = required(action["type"].as_str(), "Missing panel action")?;
    let cwd = &action["cwd"];
    let source = session["selectedFile"]["source"]["kind"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    match kind {
        "initialize" => {
            if session["repositoryInitialized"] == true && session["diffViewerCwd"].is_string() {
                return Ok(None);
            }
            if session["diffViewerCwd"].is_null() {
                session["diffViewerCwd"] = cwd.clone();
                session["mainViewMode"] = json!("graph");
            }
            session["repositoryInitialized"] = json!(true);
            session["sidebarVisible"] = json!(true);
        }
        "openGraph" => {
            if action["reset"] == true {
                clear_selection(session);
            }
            session["diffViewerCwd"] = cwd.clone();
            session["mainViewMode"] = json!("graph");
            focus(session, "workspace-diff-viewer", cwd);
        }
        "focusChat" => {
            if cwd.is_string() && session["mainViewMode"] == "graph" {
                if session["diffViewerCwd"] != *cwd {
                    clear_selection(session);
                }
                session["diffViewerCwd"] = cwd.clone();
            }
            session["focusedAuxiliaryPanel"] = Value::Null;
        }
        "focus" => session["focusedAuxiliaryPanel"] = action["panel"].clone(),
        "mode" => session["mainViewMode"] = action["mode"].clone(),
        "toggleSidebar" => session["sidebarVisible"] = json!(session["sidebarVisible"] != true),
        "document" => {
            session["fileViewerCwd"] = cwd.clone();
            session["fileViewerOpen"] = json!(true);
            session["fileRequest"] = json!({"path":action["path"],"token":now});
            focus(session, "workspace-file-viewer", cwd);
        }
        "detachFile" => {
            let panels = session["detachedFilePanels"]
                .as_array_mut()
                .expect("normalized panels");
            if !panels.iter().any(|panel| panel["id"] == action["id"]) {
                panels.push(json!({"id":action["id"],"cwd":cwd,"path":action["path"]}));
            }
            session["focusedAuxiliaryPanel"] = json!({"id":action["id"],"cwd":cwd});
        }
        "closeFile" => {
            if action["id"] == "workspace-file-viewer" {
                session["fileViewerOpen"] = json!(false);
            } else {
                session["detachedFilePanels"]
                    .as_array_mut()
                    .expect("normalized panels")
                    .retain(|panel| panel["id"] != action["id"]);
            }
            if session["focusedAuxiliaryPanel"]["id"] == action["id"] {
                session["focusedAuxiliaryPanel"] = Value::Null;
            }
        }
        "documents" => {
            let session_id = required(action["sessionId"].as_str(), "Missing document session")?;
            session["documentSessions"][session_id] = json!({
                "cwd": required(action["cwd"].as_str(), "Missing document cwd")?,
                "activePath": action["activePath"],
                "paths": action["paths"],
            });
        }
        "dismissDiff" => {
            session["mainViewMode"] = json!("graph");
            if session["diffViewerCwd"].is_string() {
                let cwd = session["diffViewerCwd"].clone();
                focus(session, "workspace-diff-viewer", &cwd);
            }
        }
        "workingTreeFile" | "commitFile" | "comparisonFile" => {
            let source = match kind {
                "commitFile" => {
                    json!({"kind":"commit","commitHash":action["commitHash"],"commitParent":action["commitParent"]})
                }
                "comparisonFile" => {
                    json!({"kind":"comparison","comparisonFrom":action["from"],"comparisonTo":action["to"]})
                }
                _ => {
                    json!({"kind":if session["mainViewMode"] == "graph" || (session["mainViewMode"] == "diff" && source == "graphWorkingTree") { "graphWorkingTree" } else { "workingTree" }})
                }
            };
            session["selectedFile"] = json!({"path":action["path"],"staged":kind == "workingTreeFile" && action["staged"] == true,"source":source});
            session["mainViewMode"] = json!("diff");
            session["diffViewerCwd"] = cwd.clone();
            focus(session, "workspace-diff-viewer", cwd);
        }
        "reconcileFile" if session["selectedFile"] == action["expected"] => {
            if action["staged"].is_boolean() {
                session["selectedFile"]["staged"] = action["staged"].clone();
            } else {
                session["selectedFile"] = Value::Null;
                session["diffViewerCwd"] = Value::Null;
            }
        }
        "reconcileFile" => {}
        "selectGraph" | "reconcileGraph" => {
            let old_primary = session["selectedCommitHash"].clone();
            let old_ids = session["selectedCommitIds"]
                .as_array()
                .expect("normalized selection")
                .clone();
            let mut ids = vec![action["id"].clone()];
            let primary;
            let mut announcement = None;
            if kind == "reconcileGraph" {
                let items = required(action["items"].as_array(), "Missing graph items")?;
                let Some(first) = items.first() else {
                    return Ok(None);
                };
                let visible = |id: &Value| items.iter().any(|item| item["id"] == *id);
                ids = old_ids.iter().filter(|id| visible(id)).cloned().collect();
                if ids.is_empty() {
                    ids.push(first["id"].clone());
                }
                primary = if visible(&old_primary) {
                    old_primary.clone()
                } else {
                    ids.last().cloned().unwrap_or(Value::Null)
                };
                if old_primary.is_string() && (primary != old_primary || ids != old_ids) {
                    announcement = Some(format!(
                        "The selected graph item is no longer available. Selected {}.",
                        first["message"].as_str().unwrap_or_default()
                    ));
                }
            } else {
                let id = &action["id"];
                if id.is_null() {
                    ids.clear();
                } else if action["intent"]["range"] == true && old_primary.is_string() {
                    let ordered = required(action["orderedIds"].as_array(), "Missing graph order")?;
                    if let (Some(anchor), Some(target)) = (
                        ordered.iter().position(|id| *id == old_primary),
                        ordered.iter().position(|candidate| candidate == id),
                    ) {
                        ids = ordered[anchor.min(target)..=anchor.max(target)].to_vec();
                    }
                } else if action["intent"]["additive"] == true {
                    ids = old_ids.clone();
                    if ids.contains(id) {
                        ids.retain(|candidate| candidate != id);
                    } else {
                        ids.push(id.clone());
                    }
                }
                primary = if ids.contains(id) {
                    id.clone()
                } else {
                    ids.last().cloned().unwrap_or(Value::Null)
                };
                if id.is_string() && (primary != old_primary || ids != old_ids) {
                    session["selectedFile"] = Value::Null;
                }
            }
            session["selectedCommitHash"] = primary;
            session["selectedCommitIds"] = json!(ids);
            session["selectedCommitParent"] = Value::Null;
            return Ok(announcement);
        }
        _ => return Err("Unknown panel action".into()),
    }
    Ok(None)
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
    session["sidebarContent"] = json!(if session["mainViewMode"] == "graph" {
        if session["selectedCommitHash"]
            .as_str()
            .is_some_and(|id| id == "wip" || id.starts_with("wip:"))
        {
            "workingTree"
        } else {
            "history"
        }
    } else if matches!(context.as_str(), "workingTree" | "graphWorkingTree") {
        "workingTree"
    } else {
        "history"
    });
    session
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
