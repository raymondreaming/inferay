//! Durable panel snapshots share the existing client-storage lock and file.
use super::*;
use serde_json::Value;

const KEY: &str = "native-workspace-panels:";
const LEGACY_KEY: &str = "agent-workspace-panels:";

pub(super) async fn handle(state: &ServerState, request: Request) -> Response {
    let headers = request.headers().clone();
    let body: Value = match request_json(request, &headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(workspace_id) = body
        .get("workspaceId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({"error":"workspaceId is required"}),
            &headers,
        );
    };
    let _guard = state.client_storage_write.lock().await;
    let mut entries = read_json_object(&state.client_storage_path).await;
    let key = format!("{KEY}{workspace_id}");
    let stored = entries
        .get(&key)
        .or_else(|| entries.get(&format!("{LEGACY_KEY}{workspace_id}")))
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str::<Value>(text).ok());
    let mut current = normalize(
        stored
            .as_ref()
            .or_else(|| body.get("legacy"))
            .unwrap_or(&Value::Null),
        false,
    );
    if let Some(patch) = body.get("patch").and_then(Value::as_object) {
        current
            .as_object_mut()
            .expect("normalized object")
            .extend(patch.clone());
    }
    let durable = normalize(&current, false);
    entries.insert(key, Value::String(durable.to_string()));
    if let Err(error) = write_json_object(&state.client_storage_path, &entries).await {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error":error}),
            &headers,
        );
    }
    json_response(
        StatusCode::OK,
        json!({"session":normalize(&durable, true)}),
        &headers,
    )
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
        "selectedFileCommitHash":string("selectedFileCommitHash"),
        "selectedFileCommitParent":string("selectedFileCommitParent"),
        "selectedFileComparisonFrom":string("selectedFileComparisonFrom"),
        "selectedFileComparisonTo":string("selectedFileComparisonTo"),
        "selectedCommitHash":string("selectedCommitHash"),
        "selectedCommitParent":string("selectedCommitParent"),
        "selectedCommitIds":[], "diffContext":null, "mainViewMode":mode
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
        session["selectedFile"] = json!({"path":file["path"], "staged":file["staged"]});
    }
    if value["fileRequest"]["path"].is_string() {
        let token = if restore {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
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
    if mode == "diff" && !session["selectedFile"].is_null() {
        session["diffContext"] = json!(match value["diffContext"].as_str() {
            Some(context @ ("workingTree" | "graphWorkingTree" | "commit" | "comparison")) =>
                context,
            _ if session["selectedFileCommitHash"].is_string() => "commit",
            _ if session["selectedFileComparisonFrom"].is_string()
                && session["selectedFileComparisonTo"].is_string() =>
                "comparison",
            _ if session["selectedCommitHash"].is_string() => "graphWorkingTree",
            _ => "workingTree",
        });
    }
    session
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_legacy_selection_and_excludes_transient_content() {
        let session = normalize(
            &json!({
                "mainViewMode":"diff", "selectedFile":{"path":"a.rs", "staged":false},
                "selectedCommitHash":"abc", "fileRequest":{"path":"a.rs", "token":1},
                "detachedFilePanels":[{"id":"p", "cwd":"/repo", "path":"a.rs", "initialFile":{"content":"large"}}, null]
            }),
            true,
        );
        assert_eq!(session["selectedCommitIds"], json!(["abc"]));
        assert_eq!(session["diffContext"], "graphWorkingTree");
        assert_eq!(
            session["detachedFilePanels"],
            json!([{"id":"p", "cwd":"/repo", "path":"a.rs"}])
        );
        assert!(session["fileRequest"]["token"].as_u64().unwrap() > 1);
        let roundtrip = normalize(&session, false);
        assert_eq!(roundtrip, session);
    }
}
