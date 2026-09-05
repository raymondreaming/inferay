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
    if let Some(patch) = body.get("patch").and_then(Value::as_object) {
        current
            .as_object_mut()
            .expect("normalized object")
            .extend(patch.clone());
    }
    let durable = normalize(&current, false);
    entries.insert(key, Value::String(durable.to_string()));
    write_json_object(&state.client_storage_path, &entries).await?;
    Ok(json!({"session":normalize(&durable, true)}))
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
