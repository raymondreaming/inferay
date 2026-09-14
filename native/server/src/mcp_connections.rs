use crate::{ServerState, agent_runner};
use inferay_core::agent_kind::AgentKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::process::Command;

#[derive(Clone, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpProviderStatus {
    pub checking: bool,
    pub checked_at: Option<u64>,
    pub error: Option<String>,
    pub servers: Vec<McpConnection>,
}

#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpConnection {
    name: String,
    #[ts(
        type = "'Connected' | 'Needs sign-in' | 'Disabled' | 'Unavailable' | 'No tools reported' | 'Needs approval'"
    )]
    status: &'static str,
    tool_count: Option<usize>,
    source: Option<inferay_core::mcp_presentation::McpToolSource>,
    icon_url: Option<String>,
    version: Option<String>,
    can_toggle: bool,
}

pub(crate) type Connections = Arc<Mutex<[McpProviderStatus; 2]>>;

pub(crate) fn status(state: &ServerState, kind: AgentKind, refresh: bool) -> McpProviderStatus {
    let index = if kind == AgentKind::Codex { 0 } else { 1 };
    let mut statuses = state.mcp_connections.lock().expect("MCP status lock");
    let status = &mut statuses[index];
    if !status.checking && (refresh || status.checked_at.is_none()) {
        status.checking = true;
        let statuses = Arc::clone(&state.mcp_connections);
        let resolver = Arc::clone(&state.agent_command_resolver);
        let cwd = state.allowed_paths.project_root().to_path_buf();
        tokio::spawn(async move {
            let binary = resolver.resolve_agent_binary(kind);
            let env = resolver.create_agent_env(kind);
            let overrides = resolver.mcp_overrides(kind);
            let result = match kind {
                AgentKind::Codex => agent_runner::inspect_codex_mcp(&binary, &cwd, &env)
                    .await
                    .map(|(mut config, servers)| {
                        for (name, enabled) in &overrides {
                            if config.get(name).is_some() {
                                config[name]["enabled"] = serde_json::json!(enabled);
                            }
                        }
                        codex_connections(&config, servers)
                    }),
                AgentKind::Claude => {
                    let command = Command::new(binary)
                        .args([
                            "--settings",
                            &agent_runner::claude_mcp_policy(&env),
                            "mcp",
                            "list",
                        ])
                        .current_dir(cwd)
                        .env_clear()
                        .envs(env)
                        .stdin(std::process::Stdio::null())
                        .kill_on_drop(true)
                        .output();
                    match tokio::time::timeout(Duration::from_secs(45), command).await {
                        Ok(Ok(output)) if output.status.success() => {
                            Ok(claude_connections(&String::from_utf8_lossy(&output.stdout)))
                        }
                        Ok(Ok(_)) => Err("Claude could not check MCP connections".into()),
                        Ok(Err(error)) => Err(error.to_string()),
                        Err(_) => Err("Claude connection check timed out".into()),
                    }
                }
            };
            let mut statuses = statuses.lock().expect("MCP status lock");
            let status = &mut statuses[index];
            status.checking = false;
            status.checked_at = Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            );
            match result {
                Ok(mut servers) => {
                    for (name, enabled) in &overrides {
                        if !enabled && !servers.iter().any(|server| &server.name == name) {
                            servers.push(McpConnection {
                                name: name.clone(),
                                status: "Disabled",
                                tool_count: None,
                                source: source(name),
                                icon_url: None,
                                version: None,
                                can_toggle: true,
                            });
                        }
                    }
                    servers.sort_by_key(|server| server.name.to_lowercase());
                    status.servers = servers;
                    status.error = None;
                }
                Err(error) => status.error = Some(error),
            }
        });
    }
    let mut result = status.clone();
    let icons = crate::mcp_icons::manifest();
    for server in &mut result.servers {
        server.icon_url = server
            .source
            .as_ref()
            .and_then(|source| icons[&source.server_id].as_str())
            .map(str::to_owned);
    }
    result
}

fn source(name: &str) -> Option<inferay_core::mcp_presentation::McpToolSource> {
    let name = name.replace("claude.ai ", "claude_ai_");
    inferay_core::mcp_presentation::resolve(&format!("mcp__{name}__status"))
        .map(|(source, _)| source)
}

fn codex_connections(config: &Value, servers: Vec<Value>) -> Vec<McpConnection> {
    servers
        .into_iter()
        .filter_map(|server| {
            let name = server["name"].as_str()?;
            let tools = server["tools"].as_object().map_or(0, |tools| tools.len());
            let status =
                if name.eq_ignore_ascii_case("gitkraken") || config[name]["enabled"] == false {
                    "Disabled"
                } else if server["authStatus"] == "notLoggedIn" {
                    "Needs sign-in"
                } else if tools > 0
                    || server["resources"]
                        .as_array()
                        .is_some_and(|items| !items.is_empty())
                {
                    "Connected"
                } else {
                    "No tools reported"
                };
            Some(McpConnection {
                name: name.into(),
                status,
                tool_count: Some(tools),
                source: source(name),
                icon_url: None,
                version: server
                    .pointer("/serverInfo/version")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                can_toggle: config.get(name).is_some()
                    && !name.contains('.')
                    && !name.eq_ignore_ascii_case("gitkraken"),
            })
        })
        .collect()
}

fn claude_connections(output: &str) -> Vec<McpConnection> {
    output
        .lines()
        .filter_map(|line| {
            let (endpoint, health) = line.rsplit_once(" - ")?;
            let (name, _) = endpoint.split_once(": ")?;
            let status = if health.contains("Needs authentication") {
                "Needs sign-in"
            } else if health.contains("Connected") {
                "Connected"
            } else if health.contains("Pending approval") {
                "Needs approval"
            } else if health.to_lowercase().contains("disabled") {
                "Disabled"
            } else {
                "Unavailable"
            };
            Some(McpConnection {
                name: name.into(),
                status,
                tool_count: None,
                source: source(name),
                icon_url: None,
                version: None,
                can_toggle: !name.eq_ignore_ascii_case("gitkraken"),
            })
        })
        .collect()
}

#[test]
fn inventories_distinguish_authentication_from_loaded_tools_and_keep_secrets_private() {
    use serde_json::json;
    let codex = codex_connections(
        &json!({}),
        vec![
            json!({"name":"GitKraken", "tools":{}}),
            json!({"name":"linear", "authStatus":"oAuth", "tools":{"list_issues":{}}}),
            json!({"name":"offline", "authStatus":"oAuth", "tools":{}}),
            json!({"name":"login", "authStatus":"notLoggedIn", "tools":{}}),
        ],
    );
    assert_eq!(
        codex.iter().map(|s| s.status).collect::<Vec<_>>(),
        [
            "Disabled",
            "Connected",
            "No tools reported",
            "Needs sign-in"
        ]
    );
    let claude = claude_connections(
        "Checking MCP server health…\nlinear: https://mcp.linear.app/mcp?secret=private - ✔ Connected\nplugin:example:tools: https://example.com - ! Needs authentication\n",
    );
    assert_eq!(claude[0].name, "linear");
    assert_eq!(claude[1].name, "plugin:example:tools");
    assert_eq!(claude[1].status, "Needs sign-in");
    assert!(!serde_json::to_string(&claude).unwrap().contains("private"));
}

#[derive(Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpAction {
    #[ts(type = "'codex' | 'claude'")]
    provider: String,
    name: String,
    action: McpOperation,
}
#[derive(Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
enum McpOperation {
    Connect,
    Reconnect,
    Disable,
}

pub(super) async fn act(state: &ServerState, request: axum::extract::Request) -> crate::ApiResult {
    let input: McpAction = crate::api_body(request).await?;
    use crate::{StatusCode, api_error};
    let (kind, index) = match input.provider.as_str() {
        "codex" => (AgentKind::Codex, 0),
        "claude" => (AgentKind::Claude, 1),
        _ => return Err(api_error(StatusCode::BAD_REQUEST, "Unknown agent provider")),
    };
    let server = state.mcp_connections.lock().expect("MCP status lock")[index]
        .servers
        .iter()
        .find(|server| server.name == input.name)
        .cloned()
        .ok_or_else(|| {
            api_error(
                StatusCode::BAD_REQUEST,
                "Refresh connections before changing this server",
            )
        })?;
    if !server.can_toggle {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "This connection is managed by the provider or Inferay policy",
        ));
    }
    if state.mcp_connections.lock().expect("MCP status lock")[index].checking {
        return Err(api_error(
            StatusCode::CONFLICT,
            "Wait for the current connection check to finish",
        ));
    }
    let enabled = !matches!(input.action, McpOperation::Disable);
    state
        .agent_command_resolver
        .set_mcp_enabled(kind, &input.name, enabled)?;
    let message = if enabled && server.status == "Needs sign-in" {
        crate::native_app::open_terminal_command(
            &state.agent_command_resolver.resolve_agent_binary(kind),
            &["mcp", "login", "--", &input.name],
        )
        .await?;
        "Complete sign-in in the browser or terminal, then refresh connections."
    } else if enabled {
        "Reconnecting. Changes apply to the next chat turn."
    } else {
        "Disabled in Inferay. This takes effect on the next chat turn."
    };
    status(state, kind, true);
    Ok(serde_json::json!({"message":message}))
}
