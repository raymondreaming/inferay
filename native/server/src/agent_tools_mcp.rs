use crate::agent_runner::AgentProcessHandle;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use inferay_core::agent_protocol::ProtocolEmission;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::mpsc;

#[derive(Clone)]
struct Tools {
    token: String,
    active: Arc<AtomicBool>,
    handle: AgentProcessHandle,
    emissions: mpsc::Sender<ProtocolEmission>,
}

pub(crate) struct ToolBridge {
    pub config: tempfile::NamedTempFile,
    task: tokio::task::JoinHandle<()>,
    active: Arc<AtomicBool>,
}
impl Drop for ToolBridge {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
        self.task.abort();
    }
}
impl ToolBridge {
    pub async fn start(
        handle: AgentProcessHandle,
        emissions: mpsc::Sender<ProtocolEmission>,
    ) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
        let config = tempfile::Builder::new()
            .prefix("inferay-tools-")
            .suffix(".json")
            .tempfile()
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&config, &json!({"mcpServers":{"inferay":{"type":"http","url":format!("http://{address}/mcp"),"headers":{"Authorization":format!("Bearer {token}")}}}})).map_err(|e|e.to_string())?;
        let active = Arc::new(AtomicBool::new(true));
        let app = Router::new()
            .route("/mcp", post(call))
            .layer(DefaultBodyLimit::max(52_000_000))
            .with_state(Tools {
                token,
                active: active.clone(),
                handle,
                emissions,
            });
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(Self {
            config,
            task,
            active,
        })
    }
}

async fn call(
    State(tools): State<Tools>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    if headers.contains_key("origin")
        || headers.get("authorization").and_then(|h| h.to_str().ok())
            != Some(&format!("Bearer {}", tools.token))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !tools.active.load(Ordering::Acquire) || tools.handle.is_cancelled() {
        return StatusCode::GONE.into_response();
    }
    let id = request.get("id").cloned();
    if request["jsonrpc"] != "2.0" {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let method = request["method"].as_str().unwrap_or("");
    if id.is_none() {
        return if method == "notifications/initialized" {
            StatusCode::ACCEPTED
        } else {
            StatusCode::BAD_REQUEST
        }
        .into_response();
    }
    let result = match method {
        "initialize" => {
            json!({"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"inferay","version":"1"}})
        }
        "ping" => json!({}),
        "tools/list" => {
            let mut definitions = tools.handle.tool_definitions();
            for tool in definitions.as_array_mut().into_iter().flatten() {
                tool.as_object_mut().unwrap().remove("type");
            }
            json!({"tools":definitions})
        }
        "tools/call" => {
            let name = request["params"]["name"].as_str().unwrap_or("");
            match tools
                .handle
                .call_tool(name, request["params"]["arguments"].clone())
                .await
            {
                Ok((output, card)) => {
                    if let Some(card) = card {
                        let _ = tools
                            .emissions
                            .send(ProtocolEmission::System(card.to_string()))
                            .await;
                    }
                    json!({"content":[{"type":"text","text":output.to_string()}],"isError":false})
                }
                Err(error) => json!({"content":[{"type":"text","text":error}],"isError":true}),
            }
        }
        _ => return Json(
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
        )
        .into_response(),
    };
    Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn bridge_requires_turn_token_and_dispatches_native_tools() {
        let root = tempfile::tempdir().unwrap();
        let skills = Arc::new(tokio::sync::Mutex::new(
            crate::prompt_store::PromptStore::open(
                root.path().join("bundled.json"),
                root.path().join("local.json"),
            )
            .unwrap(),
        ));
        let handle = AgentProcessHandle::with_skills(skills);
        let (sender, _receiver) = mpsc::channel(crate::agent_runner::PROTOCOL_BUFFER_CAPACITY);
        let bridge = ToolBridge::start(handle, sender).await.unwrap();
        let config: Value = serde_json::from_reader(bridge.config.reopen().unwrap()).unwrap();
        let url = config["mcpServers"]["inferay"]["url"].as_str().unwrap();
        let token = config["mcpServers"]["inferay"]["headers"]["Authorization"]
            .as_str()
            .unwrap();
        let client = reqwest::Client::new();
        let payload = json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}).to_string();
        let response = client
            .post(url)
            .header("content-type", "application/json")
            .body(payload.clone())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = client
            .post(url)
            .header("content-type", "application/json")
            .header("authorization", token)
            .body(payload.clone())
            .send()
            .await
            .unwrap();
        let result: Value = serde_json::from_str(&response.text().await.unwrap()).unwrap();
        assert!(
            result["result"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool["name"] == "inferay_list_skills")
        );
        let response = client
            .post(url)
            .header("content-type", "application/json")
            .header("authorization", token)
            .header("origin", "https://example.com")
            .body(payload)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = client.post(url).header("content-type","application/json").header("authorization",token).body(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"inferay_list_skills","arguments":{}}}).to_string()).send().await.unwrap();
        let result: Value = serde_json::from_str(&response.text().await.unwrap()).unwrap();
        assert_eq!(result["result"]["isError"], false);
        let active = bridge.active.clone();
        drop(bridge);
        assert!(!active.load(Ordering::Acquire));
    }
}

#[cfg(test)]
mod provider_test {
    use super::*;
    #[tokio::test]
    #[ignore = "Uses installed Claude credentials and a paid provider request"]
    async fn real_claude_discovers_and_calls_inferay_tools() {
        let root = tempfile::tempdir().unwrap();
        let handle = AgentProcessHandle::with_skills(Arc::new(tokio::sync::Mutex::new(
            crate::prompt_store::PromptStore::open(
                root.path().join("bundled.json"),
                root.path().join("local.json"),
            )
            .unwrap(),
        )));
        let (sender, _receiver) = mpsc::channel(crate::agent_runner::PROTOCOL_BUFFER_CAPACITY);
        let bridge = ToolBridge::start(handle, sender).await.unwrap();
        let output = tokio::time::timeout(std::time::Duration::from_secs(120), tokio::process::Command::new("claude")
            .current_dir(root.path())
            .args(["-p", "Call inferay_list_skills once with query 'transport-proof'. Then reply TOOL_PROOF_COMPLETE. Do not use other tools.", "--model", "haiku", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config", "--mcp-config"])
            .arg(bridge.config.path())
            .args(["--tools", "", "--permission-mode", "dontAsk", "--allowedTools", "mcp__inferay__inferay_list_skills"])
            .kill_on_drop(true).output()).await.expect("Claude tool test timed out").expect("Claude is installed");
        assert!(
            output.status.success(),
            "Claude exited unsuccessfully: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let events: Vec<Value> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
        assert!(
            events.iter().any(|event| event["message"]["content"]
                .as_array()
                .is_some_and(|parts| parts.iter().any(|part| part["type"] == "tool_use"
                    && part["name"] == "mcp__inferay__inferay_list_skills"))),
            "Claude did not call Inferay's tool"
        );
        assert!(
            events
                .iter()
                .any(|event| event["type"] == "result" && event["is_error"] == false),
            "Claude did not finish successfully"
        );
    }
}
