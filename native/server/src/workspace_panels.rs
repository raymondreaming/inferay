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
