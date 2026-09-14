//! Native persistence for the shared dock layout model.
use super::*;

pub(super) async fn handle(state: &ServerState, request: Request) -> ApiResult {
    let mut body: Value = api_body(request).await?;
    let workspace = required(body["workspaceId"].as_str(), "workspaceId is required")?;
    let key = format!("native-workspace-dock:{workspace}");
    let mut storage = state.client_storage.lock().await;
    let entries = storage.read().await?;
    let read = |key: &str| crate::client_storage::decode_json(entries, key);
    let saved = read(&key).or_else(|| {
        body["legacyWorkspaceId"]
            .as_str()
            .and_then(|id| read(&format!("native-workspace-dock:{id}")))
    });
    let legacy = read(&format!("agent-workspace-dock:{workspace}")).or_else(|| {
        body["legacyWorkspaceId"]
            .as_str()
            .and_then(|id| read(&format!("agent-workspace-dock:{id}")))
    });
    body["saved"] = saved.unwrap_or(Value::Null);
    body["legacy"] = legacy.unwrap_or(Value::Null);
    let result = inferay_presentation::dock::project(&body)
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, &error))?;
    let value = crate::client_storage::encode_json(&result["saved"]);
    if entries.get(&key) != Some(&value) {
        storage
            .update(std::collections::BTreeMap::from([(key, Some(value))]))
            .await?;
    }
    Ok(result)
}
