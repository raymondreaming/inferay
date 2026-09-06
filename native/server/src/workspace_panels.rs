//! Durable panel snapshots share the existing client-storage lock and file.
use super::*;
use serde_json::Value;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum DiffSource {
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

const KEY: &str = "native-workspace-panels:";

pub(super) async fn handle(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let workspace_id = required(
        body["workspaceId"].as_str().filter(|id| !id.is_empty()),
        "workspaceId is required",
    )?;
    let _guard = state.client_storage_write.lock().await;
    let mut entries = read_client_storage(&state.client_storage_path).await?;
    let key = format!("{KEY}{workspace_id}");
    let stored = entries
        .get(&key)
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str::<Value>(text).ok());
    let mut current = normalize(stored.as_ref().unwrap_or(&Value::Null), false);
    let announcement = match body.get("action") {
        Some(action) => apply_action(&mut current, action)?,
        None => None,
    };
    let durable = normalize(&current, false);
    if stored.as_ref() != Some(&durable) {
        entries.insert(key, Value::String(durable.to_string()));
        write_json_object(&state.client_storage_path, &entries).await?;
    }
    Ok(
        json!({"session":normalize(&durable, body.get("action").is_none()), "announcement":announcement}),
    )
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

fn apply_action(session: &mut Value, action: &Value) -> ApiResult<Option<String>> {
    let kind = required(action["type"].as_str(), "Missing panel action")?;
    let cwd = &action["cwd"];
    let source = session["selectedFile"]["source"]["kind"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    match kind {
        "initialize" => {
            if session["repositoryInitialized"] == true {
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
            session["fileRequest"] = json!({"path":action["path"],"token":unix_millis()});
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
        "dismissDiff" => {
            if session["diffViewerCwd"].is_string()
                && session["mainViewMode"] == "diff"
                && matches!(
                    source.as_str(),
                    "graphWorkingTree" | "commit" | "comparison"
                )
            {
                session["mainViewMode"] = json!("graph");
                let cwd = session["diffViewerCwd"].clone();
                focus(session, "workspace-diff-viewer", &cwd);
            } else {
                clear_selection(session);
                session["mainViewMode"] = json!("diff");
                session["diffViewerCwd"] = Value::Null;
                if session["focusedAuxiliaryPanel"]["id"] == "workspace-diff-viewer" {
                    session["focusedAuxiliaryPanel"] = Value::Null;
                }
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
        _ => return Err(api_error(StatusCode::BAD_REQUEST, "Unknown panel action")),
    }
    Ok(None)
}

fn normalize(value: &Value, restore: bool) -> Value {
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
        "focusedAuxiliaryPanel":null, "detachedFilePanels":[], "fileRequest":null, "selectedFile":null,
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
    let file = &value["selectedFile"];
    if file["path"].is_string() && file["staged"].is_boolean() {
        session["selectedFile"] =
            json!({"path":file["path"], "staged":file["staged"], "source":file_source(value)});
    }
    if value["fileRequest"]["path"].is_string() {
        let token = if restore {
            unix_millis()
        } else {
            value["fileRequest"]["token"].as_u64().unwrap_or(0)
        };
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
    session
}
