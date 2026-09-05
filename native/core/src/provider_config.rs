//! Provider catalog and configuration policy shared by the native runtime and UI.
use serde_json::{Value, json};
use std::sync::LazyLock;

fn models(rows: &[(&str, &str, &str, Option<&str>)]) -> Vec<Value> {
    rows.iter()
        .map(|(id, label, detail, short_label)| {
            let mut model = json!({"id":id, "label":label, "detail":detail});
            if let Some(label) = short_label {
                model["shortLabel"] = json!(label);
            }
            model
        })
        .collect()
}

fn commands(rows: &[(&str, &str)]) -> Vec<Value> {
    rows.iter()
        .map(|(name, description)| json!({"name":name, "description":description}))
        .collect()
}

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
                            "nativeSlashCommands": commands(&[
        ("btw", "Ask a side question without adding to conversation"),
        ("bug", "Report bugs or issues"),
        ("compact", "Compact conversation history"),
        ("config", "Open config panel"),
        ("cost", "Show token usage and costs"),
        ("doctor", "Check Claude Code health"),
        ("init", "Initialize project with CLAUDE.md"),
        ("login", "Switch accounts or login"),
        ("logout", "Logout from current account"),
        ("memory", "Edit CLAUDE.md memory file"),
        ("model", "Switch AI model"),
        ("pr-comments", "View PR comments"),
        ("review", "Review code changes"),
        ("agent-setup", "Setup agent integration"),
        ("vim", "Toggle vim mode")
        ]),
                            "models": models(&[
        ("claude-fable-5", "Fable 5", "Hardest tasks", None),
        ("claude-opus-4-7", "Opus 4.7", "★ Most capable", None),
        ("claude-opus-4-6", "Opus 4.6", "Previous Opus", None),
        ("claude-sonnet-4-6", "Sonnet 4.6", "Best value", None),
        ("claude-haiku-4-5", "Haiku 4.5", "Fastest", None)
        ]),
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
                            "nativeSlashCommands": commands(&[
        ("goal", "Start, pause, resume, clear, or inspect a Codex objective")
        ]),
                            "models": models(&[
        ("gpt-6-astra", "GPT-6 Astra", "Complex agentic work", Some("Astra")),
        ("gpt-5.6-sol", "GPT-5.6 Sol", "★ Frontier agentic coding", Some("Sol")),
        ("gpt-5.6-terra", "GPT-5.6 Terra", "Balanced everyday work", Some("Terra")),
        ("gpt-5.6-luna", "GPT-5.6 Luna", "Fast & affordable", Some("Luna")),
        ("gpt-5.5", "GPT-5.5", "Frontier model", None),
        ("gpt-5.4", "GPT-5.4", "Everyday coding", None),
        ("gpt-5.2-codex", "GPT-5.2 Codex", "★ Frontier agentic", None),
        ("gpt-5.1-codex-max", "GPT-5.1 Codex Max", "Deep reasoning", None),
        ("gpt-5.4-mini", "GPT-5.4 Mini", "Fast & cheap", None),
        ("gpt-5.3-codex", "GPT-5.3 Codex", "Coding-optimized", None),
        ("gpt-5.3-codex-spark", "GPT-5.3 Spark", "Ultra-fast", None),
        ("gpt-5.2", "GPT-5.2", "Long-running agents", None),
        ("gpt-5.1-codex-mini", "GPT-5.1 Codex Mini", "Cheapest", None)
        ]),
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
