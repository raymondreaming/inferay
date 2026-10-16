//! Durable panel snapshots share the existing client-storage lock and database.
use super::*;
use serde_json::Value;

const KEY: &str = "native-workspace-panels:";

pub(super) async fn handle(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let workspace_id = required(
        body["workspaceId"].as_str().filter(|id| !id.is_empty()),
        "workspaceId is required",
    )?;
    let storage = state.client_storage.lock().await;
    let key = format!("{KEY}{workspace_id}");
    let entries = storage.select(&[&key]).await?;
    let stored = crate::client_storage::decode_json(&entries, &key);
    let mut current =
        inferay_presentation::panels::PanelSession::read(stored.as_ref().unwrap_or(&Value::Null));
    let announcement = match body.get("action") {
        Some(action) => {
            let action = serde_json::from_value(action.clone())
                .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
            current.apply(action, unix_millis())
        }
        None => None,
    };
    let snapshot = json!(current);
    if stored.as_ref() != Some(&snapshot) {
        storage
            .update(std::collections::BTreeMap::from([(
                key,
                Some(crate::client_storage::encode_json(&snapshot)),
            )]))
            .await?;
    }
    if body.get("action").is_none()
        && let Some(request) = &mut current.file_request
    {
        request.token = unix_millis();
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
        let storage = state.client_storage.lock().await;
        let entries = storage
            .select(&[
                &format!("{KEY}{workspace}"),
                &format!("agent-workspace-files:{session_id}"),
            ])
            .await?;
        let panels = crate::client_storage::decode_json(&entries, &format!("{KEY}{workspace}"));
        panels
            .as_ref()
            .and_then(|panels| panels["documentSessions"].get(session_id))
            .cloned()
            .or_else(|| {
                crate::client_storage::decode_json(
                    &entries,
                    &format!("agent-workspace-files:{session_id}"),
                )
            })
            .filter(|session| session["cwd"] == cwd)
            .unwrap_or(Value::Null)
    };
    let paths: Vec<_> = saved["paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|path| !path.is_empty())
        .collect();
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
