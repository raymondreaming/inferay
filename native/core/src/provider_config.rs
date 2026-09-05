//! Provider catalog and configuration policy shared by the native runtime and UI.
use serde_json::{Value, json};
use std::sync::LazyLock;

pub fn catalog() -> &'static Value {
    static CATALOG: LazyLock<Value> = LazyLock::new(|| {
        let mut value = json!({
            "agents": {
                "agent": {
                    "kind": "agent",
                    "label": "Agent",
                    "paneTitle": "Agent",
                    "description": "Interactive shell session",
                    "iconKey": "agent",
                    "supportsChat": false,
                    "supportsInteractiveAgent": true,
                    "supportsResume": false,
                    "nativeSlashCommands": [],
                    "models": [],
                    "defaultModel": ""
                },
                "claude": {
                    "kind": "claude",
                    "label": "Claude",
                    "paneTitle": "Claude",
                    "description": "Anthropic Claude Code CLI",
                    "iconKey": "anthropic",
                    "supportsChat": true,
                    "supportsInteractiveAgent": true,
                    "supportsResume": true,
                    "nativeSlashCommands": [
                        {
                            "name": "btw",
                            "description": "Ask a side question without adding to conversation"
                        },
                        {
                            "name": "bug",
                            "description": "Report bugs or issues"
                        },
                        {
                            "name": "compact",
                            "description": "Compact conversation history"
                        },
                        {
                            "name": "config",
                            "description": "Open config panel"
                        },
                        {
                            "name": "cost",
                            "description": "Show token usage and costs"
                        },
                        {
                            "name": "doctor",
                            "description": "Check Claude Code health"
                        },
                        {
                            "name": "init",
                            "description": "Initialize project with CLAUDE.md"
                        },
                        {
                            "name": "login",
                            "description": "Switch accounts or login"
                        },
                        {
                            "name": "logout",
                            "description": "Logout from current account"
                        },
                        {
                            "name": "memory",
                            "description": "Edit CLAUDE.md memory file"
                        },
                        {
                            "name": "model",
                            "description": "Switch AI model"
                        },
                        {
                            "name": "pr-comments",
                            "description": "View PR comments"
                        },
                        {
                            "name": "review",
                            "description": "Review code changes"
                        },
                        {
                            "name": "agent-setup",
                            "description": "Setup agent integration"
                        },
                        {
                            "name": "vim",
                            "description": "Toggle vim mode"
                        }
                    ],
                    "models": [
                        {
                            "id": "claude-fable-5",
                            "label": "Fable 5",
                            "detail": "Hardest tasks"
                        },
                        {
                            "id": "claude-opus-4-7",
                            "label": "Opus 4.7",
                            "detail": "★ Most capable"
                        },
                        {
                            "id": "claude-opus-4-6",
                            "label": "Opus 4.6",
                            "detail": "Previous Opus"
                        },
                        {
                            "id": "claude-sonnet-4-6",
                            "label": "Sonnet 4.6",
                            "detail": "Best value"
                        },
                        {
                            "id": "claude-haiku-4-5",
                            "label": "Haiku 4.5",
                            "detail": "Fastest"
                        }
                    ],
                    "defaultModel": "claude-opus-4-7"
                },
                "codex": {
                    "kind": "codex",
                    "label": "Codex",
                    "paneTitle": "Codex",
                    "description": "OpenAI Codex CLI",
                    "iconKey": "openai",
                    "supportsChat": true,
                    "supportsInteractiveAgent": true,
                    "supportsResume": true,
                    "nativeSlashCommands": [
                        {
                            "name": "goal",
                            "description": "Start, pause, resume, clear, or inspect a Codex objective"
                        }
                    ],
                    "models": [
                        {
                            "id": "gpt-6-astra",
                            "label": "GPT-6 Astra",
                            "shortLabel": "Astra",
                            "detail": "Complex agentic work"
                        },
                        {
                            "id": "gpt-5.6-sol",
                            "label": "GPT-5.6 Sol",
                            "shortLabel": "Sol",
                            "detail": "★ Frontier agentic coding"
                        },
                        {
                            "id": "gpt-5.6-terra",
                            "label": "GPT-5.6 Terra",
                            "shortLabel": "Terra",
                            "detail": "Balanced everyday work"
                        },
                        {
                            "id": "gpt-5.6-luna",
                            "label": "GPT-5.6 Luna",
                            "shortLabel": "Luna",
                            "detail": "Fast & affordable"
                        },
                        {
                            "id": "gpt-5.5",
                            "label": "GPT-5.5",
                            "detail": "Frontier model"
                        },
                        {
                            "id": "gpt-5.4",
                            "label": "GPT-5.4",
                            "detail": "Everyday coding"
                        },
                        {
                            "id": "gpt-5.2-codex",
                            "label": "GPT-5.2 Codex",
                            "detail": "★ Frontier agentic"
                        },
                        {
                            "id": "gpt-5.1-codex-max",
                            "label": "GPT-5.1 Codex Max",
                            "detail": "Deep reasoning"
                        },
                        {
                            "id": "gpt-5.4-mini",
                            "label": "GPT-5.4 Mini",
                            "detail": "Fast & cheap"
                        },
                        {
                            "id": "gpt-5.3-codex",
                            "label": "GPT-5.3 Codex",
                            "detail": "Coding-optimized"
                        },
                        {
                            "id": "gpt-5.3-codex-spark",
                            "label": "GPT-5.3 Spark",
                            "detail": "Ultra-fast"
                        },
                        {
                            "id": "gpt-5.2",
                            "label": "GPT-5.2",
                            "detail": "Long-running agents"
                        },
                        {
                            "id": "gpt-5.1-codex-mini",
                            "label": "GPT-5.1 Codex Mini",
                            "detail": "Cheapest"
                        }
                    ],
                    "defaultModel": "gpt-5.6-sol"
                }
            }
        });
        let levels = json!([
            {
                "id": "low",
                "label": "Low",
                "detail": "Fast responses"
            },
            {
                "id": "medium",
                "label": "Medium",
                "detail": "Balanced"
            },
            {
                "id": "high",
                "label": "High",
                "detail": "Greater depth (default)"
            },
            {
                "id": "xhigh",
                "label": "Extra High",
                "detail": "Maximum reasoning"
            }
        ]);
        value["agents"]["agent"]["reasoningLevels"] = json!([]);
        value["agents"]["claude"]["reasoningLevels"] = json!([]);
        value["agents"]["codex"]["reasoningLevels"] = levels.clone();
        value["reasoningLevels"] = levels;
        value
    });
    &CATALOG
}

pub fn resolve(input: &Value) -> Value {
    let defaults = &input["defaults"];
    let default_kind = defaults["agentKind"]
        .as_str()
        .filter(|v| matches!(*v, "claude" | "codex"))
        .unwrap_or("codex");
    let kind = input["agentKind"]
        .as_str()
        .filter(|v| matches!(*v, "agent" | "claude" | "codex"))
        .unwrap_or(default_kind);
    let definition = &catalog()["agents"][kind];
    let valid_model = |value: &Value| {
        definition["models"]
            .as_array()
            .unwrap()
            .iter()
            .any(|option| option["id"] == *value && value.is_string())
    };
    let model = if valid_model(&input["model"]) {
        input["model"].clone()
    } else if kind == default_kind && valid_model(&defaults["model"]) {
        defaults["model"].clone()
    } else {
        definition["defaultModel"].clone()
    };
    let levels = catalog()["reasoningLevels"].as_array().unwrap();
    let valid_reasoning = |value: &Value| {
        levels
            .iter()
            .any(|option| option["id"] == *value && value.is_string())
    };
    let reasoning = if valid_reasoning(&input["reasoningLevel"]) {
        input["reasoningLevel"].clone()
    } else if valid_reasoning(&defaults["reasoningLevel"]) {
        defaults["reasoningLevel"].clone()
    } else {
        json!("high")
    };
    json!({"agentKind":kind, "model":model, "reasoningLevel":reasoning})
}

/// An unknown previous model is a restored session, not evidence of a config change.
pub fn requires_new_session(
    previous_kind: &str,
    previous_model: Option<&str>,
    previous_reasoning: Option<&str>,
    next_kind: &str,
    next_model: Option<&str>,
    next_reasoning: Option<&str>,
) -> bool {
    previous_kind != next_kind
        || previous_model.is_some_and(|value| Some(value) != next_model)
        || (next_kind == "codex"
            && previous_reasoning.is_some_and(|value| Some(value) != next_reasoning))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_stale_and_cross_provider_settings() {
        assert_eq!(
            resolve(
                &json!({"agentKind":"claude","model":"gpt-6-astra", "reasoningLevel":"invalid"})
            ),
            json!({"agentKind":"claude","model":"claude-opus-4-7","reasoningLevel":"high"})
        );
        assert_eq!(
            resolve(
                &json!({"agentKind":"codex","defaults":{"agentKind":"codex","model":"gpt-6-astra","reasoningLevel":"low"}})
            )["model"],
            "gpt-6-astra"
        );
        assert_eq!(
            resolve(
                &json!({"agentKind":"codex","model":"gpt-5.5","defaults":{"agentKind":"codex","model":"gpt-6-astra"}})
            )["model"],
            "gpt-5.5"
        );
    }
    #[test]
    fn resume_policy_preserves_restored_unknown_config_and_resets_known_changes() {
        assert!(!requires_new_session(
            "codex",
            None,
            None,
            "codex",
            Some("gpt-6-astra"),
            Some("high")
        ));
        assert!(requires_new_session(
            "codex",
            Some("gpt-5.5"),
            Some("high"),
            "codex",
            Some("gpt-6-astra"),
            Some("high")
        ));
        assert!(requires_new_session(
            "codex", None, None, "claude", None, None
        ));
        assert!(!requires_new_session(
            "claude",
            Some("claude-opus-4-7"),
            Some("high"),
            "claude",
            Some("claude-opus-4-7"),
            Some("low")
        ));
    }
}
