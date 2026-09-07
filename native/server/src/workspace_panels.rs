//! Durable panel snapshots share the existing client-storage lock and file.
use super::*;
use serde_json::Value;

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
    let mut current =
        inferay_presentation::panels::normalize(stored.as_ref().unwrap_or(&Value::Null));
    let announcement = match body.get("action") {
        Some(action) => {
            let announcement =
                inferay_presentation::panels::apply_action(&mut current, action, unix_millis())
                    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
            current = inferay_presentation::panels::normalize(&current);
            announcement
        }
        None => None,
    };
    if stored.as_ref() != Some(&current) {
        entries.insert(key, Value::String(current.to_string()));
        write_json_object(&state.client_storage_path, &entries).await?;
    }
    if body.get("action").is_none() && current["fileRequest"].is_object() {
        current["fileRequest"]["token"] = json!(unix_millis());
    }
    Ok(json!({"session":current, "announcement":announcement}))
}

/// Restore readable tabs directly from durable panel state, including legacy sessions.
pub(super) async fn restore_documents(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let cwd = required(body["cwd"].as_str(), "cwd is required")?;
    state.project_cwd(cwd)?;
    let workspace = required(body["workspaceId"].as_str(), "workspaceId is required")?;
    let session_id = required(body["sessionId"].as_str(), "sessionId is required")?;
    let saved = {
        let _guard = state.client_storage_write.lock().await;
        let entries = read_client_storage(&state.client_storage_path).await?;
        let decode = |key: &str| {
            entries
                .get(key)
                .and_then(Value::as_str)
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
        };
        let panels = decode(&format!("{KEY}{workspace}"));
        panels
            .as_ref()
            .and_then(|panels| panels["documentSessions"].get(session_id))
            .cloned()
            .or_else(|| decode(&format!("agent-workspace-files:{session_id}")))
            .filter(|session| session["cwd"] == cwd)
            .unwrap_or(Value::Null)
    };
    let mut paths: Vec<_> = saved["paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|path| !path.is_empty())
        .collect();
    if let Some(initial) = body["initialPath"].as_str() {
        paths.push(initial);
    }
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    let mut active = Value::Null;
    for path in paths {
        if !seen.insert(path.to_owned()) {
            continue;
        }
        if let Ok(file) = state.read_project_file(cwd, path).await {
            if saved["activePath"] == path {
                active = file["path"].clone();
            }
            if !files
                .iter()
                .any(|open: &Value| open["path"] == file["path"])
            {
                files.push(file);
            }
        }
    }
    if active.is_null() {
        active = files
            .first()
            .map(|file| file["path"].clone())
            .unwrap_or(Value::Null);
    }
    Ok(json!({"files":files, "activePath":active}))
}
