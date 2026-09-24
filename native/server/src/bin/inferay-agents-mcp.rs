//! Minimal MCP stdio bridge: Claude calls Inferay HTTP for subagent tools.

use std::io::{BufRead, Write};

use serde_json::{Value, json};

fn main() {
    let url = std::env::var("INFERAY_AGENTS_URL").expect("INFERAY_AGENTS_URL");
    let pane = std::env::var("INFERAY_AGENTS_PANE").expect("INFERAY_AGENTS_PANE");
    let token = std::env::var("INFERAY_AGENTS_TOKEN").unwrap_or_default();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(response) = handle(&url, &pane, &token, &message) {
            let _ = writeln!(stdout, "{response}");
            let _ = stdout.flush();
        }
    }
}

fn handle(url: &str, pane: &str, token: &str, message: &Value) -> Option<String> {
    let id = message.get("id").cloned();
    match message.get("method").and_then(Value::as_str)? {
        "initialize" => Some(
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "inferay-agents", "version": env!("CARGO_PKG_VERSION") }
                }
            })
            .to_string(),
        ),
        "notifications/initialized" | "initialized" => None,
        "tools/list" => Some(
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [
                        {
                            "name": "run_subagent",
                            "description": "Spawn an Inferay subagent with a fresh context.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "profile": { "type": "string", "enum": ["explore", "general"] },
                                    "title": { "type": "string" },
                                    "prompt": { "type": "string" },
                                    "background": { "type": "boolean" }
                                },
                                "required": ["profile", "prompt"]
                            }
                        },
                        {
                            "name": "read_subagent",
                            "description": "Read status and summary for a subagent.",
                            "inputSchema": {
                                "type": "object",
                                "properties": { "id": { "type": "string" } },
                                "required": ["id"]
                            }
                        },
                        {
                            "name": "list_subagents",
                            "description": "List Inferay subagents for this chat.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "status": {
                                        "type": "string",
                                        "enum": ["running", "completed", "failed", "cancelled"]
                                    }
                                }
                            }
                        }
                    ]
                }
            })
            .to_string(),
        ),
        "tools/call" => {
            let name = message.pointer("/params/name").and_then(Value::as_str)?;
            let args = message
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            let result = call_http(url, pane, token, name, &args);
            let (is_error, text) = match result {
                Ok(value) => (false, value.to_string()),
                Err(error) => (true, error),
            };
            Some(
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": text }],
                        "isError": is_error
                    }
                })
                .to_string(),
            )
        }
        "ping" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": {} }).to_string()),
        _ => {
            if id.is_some() {
                Some(
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": "Method not found" }
                    })
                    .to_string(),
                )
            } else {
                None
            }
        }
    }
}

fn call_http(
    base: &str,
    pane: &str,
    token: &str,
    tool: &str,
    args: &Value,
) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .post(format!(
            "{}/api/agents/{}/tools/{}",
            base.trim_end_matches('/'),
            urlencoding(pane),
            urlencoding(tool)
        ))
        .header("Content-Type", "application/json")
        .header("X-Inferay-Auth", token)
        .header("Cookie", format!("inferay_local_auth={token}"))
        .json(&json!({ "arguments": args }))
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response
        .json::<Value>()
        .map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(body["error"]
            .as_str()
            .unwrap_or("agents tool call failed")
            .to_owned());
    }
    Ok(body["result"].clone())
}

fn urlencoding(value: &str) -> String {
    inferay_core::url_encode(value)
}
