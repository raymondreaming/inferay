//! Build-time reference artifacts from the same owners used by the running app.
use crate::{database_explorer, project_store::Result};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn mcp_tools() -> Value {
    let mut tools = inferay_core::prompts::tools::tool_definitions();
    let list = tools.as_array_mut().unwrap();
    list.push(crate::project_chat::tool_definition());
    list.push(serde_json::from_str(crate::memory_store::TOOL_DEFINITION).unwrap());
    list.push(crate::project_tools::ToolScope::definition());
    for tool in list {
        tool.as_object_mut().unwrap().remove("type");
    }
    json!({"description":"Superset of native Inferay tools. Actual tools/list is restricted to the current turn's project, memory and automation grants. External provider MCP servers are separate.","tools":tools,"projectCommands":serde_json::from_str::<Value>(include_str!("project_commands.json")).unwrap()})
}
fn mcp_openapi() -> Value {
    let tools = mcp_tools();
    let calls:Vec<_>=tools["tools"].as_array().unwrap().iter().map(|tool|json!({"type":"object","required":["name","arguments"],"properties":{"name":{"const":tool["name"]},"arguments":tool["inputSchema"]}})).collect();
    json!({
        "openapi": "3.1.0",
        "info": {
            "title": "Inferay per-turn MCP bridge",
            "version": "1.0.0",
            "description": "The Claude native-tool bridge, not the main application server. Its loopback port and bearer token are ephemeral and emitted only to the running agent. Do not expose or persist credentials. Codex receives the same native tool definitions through its app-server protocol."
        },
        "servers": [
            {
                "url": "http://127.0.0.1:{port}",
                "variables": {
                    "port": {
                        "default": "1",
                        "description": "Replace with this turn's assigned port; there is no fixed port."
                    }
                }
            }
        ],
        "security": [
            {
                "turnToken": []
            }
        ],
        "components": {
            "securitySchemes": {
                "turnToken": {
                    "type": "http",
                    "scheme": "bearer"
                }
            }
        },
        "paths": {
            "/mcp": {
                "post": {
                    "operationId": "callNativeMcpBridge",
                    "description": "Rejects any Origin header. Protocol version 2025-11-25. A missing id is accepted only for notifications/initialized. tools/call errors appear as result.isError=true; unsupported methods use JSON-RPC -32601. Tool calls are checked against live scope and permissions.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": [
                                        "jsonrpc",
                                        "method"
                                    ],
                                    "properties": {
                                        "jsonrpc": {
                                            "const": "2.0"
                                        },
                                        "id": {
                                            "type": [
                                                "string",
                                                "number",
                                                "null"
                                            ]
                                        },
                                        "method": {
                                            "enum": [
                                                "initialize",
                                                "ping",
                                                "tools/list",
                                                "tools/call",
                                                "notifications/initialized"
                                            ]
                                        },
                                        "params": {
                                            "type": "object"
                                        }
                                    },
                                    "allOf": [
                                        {
                                            "if": {
                                                "properties": {
                                                    "method": {
                                                        "const": "tools/call"
                                                    }
                                                }
                                            },
                                            "then": {
                                                "required": [
                                                    "id",
                                                    "params"
                                                ],
                                                "properties": {
                                                    "params": {
                                                        "oneOf": calls
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            "if": {
                                                "properties": {
                                                    "method": {
                                                        "enum": [
                                                            "initialize",
                                                            "ping",
                                                            "tools/list"
                                                        ]
                                                    }
                                                }
                                            },
                                            "then": {
                                                "required": [
                                                    "id"
                                                ]
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "JSON-RPC result or method error. Tool content is a text block containing serialized JSON, with isError indicating execution failure.",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "required": [
                                            "jsonrpc",
                                            "id"
                                        ],
                                        "properties": {
                                            "jsonrpc": {
                                                "const": "2.0"
                                            },
                                            "id": {},
                                            "result": {},
                                            "error": {
                                                "type": "object",
                                                "properties": {
                                                    "code": {
                                                        "type": "integer"
                                                    },
                                                    "message": {
                                                        "type": "string"
                                                    }
                                                },
                                                "required": [
                                                    "code",
                                                    "message"
                                                ]
                                            }
                                        },
                                        "oneOf": [
                                            {
                                                "required": [
                                                    "result"
                                                ]
                                            },
                                            {
                                                "required": [
                                                    "error"
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        },
                        "202": {
                            "description": "Initialization notification accepted"
                        },
                        "400": {
                            "description": "Invalid JSON-RPC version or notification"
                        },
                        "403": {
                            "description": "Missing/incorrect turn token or any Origin header"
                        },
                        "410": {
                            "description": "Turn ended or cancelled"
                        },
                        "413": {
                            "description": "Request exceeds 52000000-byte body limit"
                        },
                        "415": {
                            "description": "Unsupported content type"
                        },
                        "422": {
                            "description": "JSON body could not be deserialized"
                        }
                    }
                }
            }
        }
    })
}
/// Generates schema from a disposable empty profile using production initializers.
/// No actual profile is opened, read, migrated or written.
pub fn artifacts() -> Result<BTreeMap<&'static str, Value>> {
    let root = tempfile::tempdir()?;
    let _projects = crate::project_file_store::FileProjectStore::open(root.path(), &[])?;
    let _memory = crate::memory_store::MemoryStore::open(root.path())?;
    let _skills = crate::prompt_store::PromptStore::open(
        root.path().join("bundled.json"),
        root.path().join("prompts.json"),
    )?;
    tokio::runtime::Runtime::new()?.block_on(async {
        crate::client_storage::ClientStorage::new(root.path().join("client-storage.json"))
            .select(&[])
            .await?;
        let chat = crate::chat_persistence::ChatPersistence::new(root.path().to_owned());
        chat.read_transcript("schema-reference").await;
        Ok::<_, String>(())
    })?;
    let databases = database_explorer::catalog(root.path());
    let schemas = databases
        .iter()
        .map(|db| database_explorer::schema(root.path(), db.id))
        .collect::<Result<Vec<_>>>()?;
    let mut artifacts = BTreeMap::from([
        ("openapi.json", database_explorer::http::openapi()),
        ("mcp-openapi.json", mcp_openapi()),
        ("mcp-tools.json", mcp_tools()),
        (
            "database-schema.json",
            json!({"description":"Generated from an empty temporary profile using production initializers. The explorer inspects the actual running profile instead.","databases":databases,"schemas":schemas}),
        ),
    ]);
    // Route inventory is deliberately separate from typed OpenAPI: declaring
    // unconstrained JSON as a precise contract would hide gaps rather than fix them.
    let source = include_str!("lib.rs");
    let source = source
        .split("async fn dispatch_api(")
        .nth(1)
        .unwrap()
        .split("#[derive(Debug)]")
        .next()
        .unwrap();
    let pattern = regex::Regex::new(
        r#"\(\s*((?:"/api/[^"\n]+"\s*\|?\s*)+),\s*((?:"(?:GET|HEAD|POST|PUT|DELETE|PATCH)"\s*\|?\s*)+)\)"#,
    )?;
    let strings = regex::Regex::new(r#""([^"]+)""#)?;
    let mut routes = BTreeMap::<String, Vec<String>>::new();
    for captures in pattern.captures_iter(source) {
        let methods: Vec<_> = strings
            .captures_iter(&captures[2])
            .map(|c| c[1].to_string())
            .collect();
        for path in strings.captures_iter(&captures[1]) {
            routes
                .entry(path[1].to_string())
                .or_default()
                .extend(methods.clone());
        }
    }
    for path in artifacts["openapi.json"]["paths"]
        .as_object()
        .unwrap()
        .keys()
    {
        routes.entry(path.clone()).or_default().push("GET".into());
    }
    for methods in routes.values_mut() {
        methods.sort();
        methods.dedup();
    }
    artifacts.insert("http-routes.json",json!({"description":"Static dispatch_api route inventory, plus database routes. Parameterized prompts/{id}, chat-queues/{paneId} and websocket messages remain documented in api.md; this is not a generated client contract.","routes":routes}));
    Ok(artifacts)
}
#[cfg(test)]
mod tests {
    #[test]
    fn committed_contracts_match_the_running_owners() {
        for (name, value) in super::artifacts().unwrap() {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../docs/reference")
                .join(name);
            let expected = std::fs::read_to_string(&path)
                .expect("Run cargo run -p inferay-tooling --bin export-api-reference");
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&expected).unwrap(),
                value,
                "{} is stale",
                path.display()
            );
        }
    }
}
