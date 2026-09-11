//! Provider catalog and configuration policy shared by the native runtime and UI.
use serde_json::{Value, json};
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceAgentKind {
    Agent,
    Claude,
    Codex,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum AgentIconKey {
    Agent,
    Anthropic,
    Openai,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub short_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, ts_rs::TS)]
pub struct ReasoningLevel {
    pub id: String,
    pub label: String,
    pub detail: String,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_local_command: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_from_library: Option<bool>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub kind: WorkspaceAgentKind,
    pub label: String,
    pub icon_key: AgentIconKey,
    #[serde(default)]
    pub commands: Vec<SlashCommand>,
    pub native_slash_commands: Vec<SlashCommand>,
    pub models: Vec<ModelOption>,
    pub default_model: String,
    pub reasoning_levels: Vec<ReasoningLevel>,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, ts_rs::TS)]
pub struct AgentCatalog {
    pub agent: AgentDefinition,
    pub claude: AgentDefinition,
    pub codex: AgentDefinition,
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub agent_kind: WorkspaceAgentKind,
    pub model: String,
    pub reasoning_level: String,
}
#[derive(Clone, Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalog {
    pub agents: AgentCatalog,
    pub reasoning_levels: Vec<ReasoningLevel>,
    pub defaults: ProviderSettings,
}

/// Shared serializer for the native endpoint and the build's prerender snapshot.
pub fn renderer_catalog(defaults: &Value, skills: &[crate::prompts::Prompt]) -> ProviderCatalog {
    let mut agents: AgentCatalog =
        serde_json::from_value(catalog()["agents"].clone()).expect("native provider catalog");
    for (kind, definition) in [
        ("agent", &mut agents.agent),
        ("claude", &mut agents.claude),
        ("codex", &mut agents.codex),
    ] {
        definition.commands = composer_commands(kind, skills)
            .into_iter()
            .map(|command| serde_json::from_value(command).expect("native composer command"))
            .collect();
    }
    ProviderCatalog {
        agents,
        reasoning_levels: serde_json::from_value(catalog()["reasoningLevels"].clone())
            .expect("native reasoning levels"),
        defaults: serde_json::from_value(resolve(&json!({"defaults": defaults})))
            .expect("resolved provider settings"),
    }
}

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

/// Local commands take precedence over skills, then provider commands.
pub fn composer_commands(kind: &str, skills: &[crate::prompts::Prompt]) -> Vec<Value> {
    let mut result = commands(&[
        ("exit", "Close this chat pane"),
        ("clear", "Clear all messages"),
        ("help", "Show available commands"),
    ]);
    for command in &mut result {
        command["action"] = json!("local");
        command["isLocalCommand"] = json!(true);
    }
    result.extend(skills.iter().map(|skill| {
        json!({
            "id":skill.id, "name":skill.command, "description":skill.description,
            "action":"send", "isFromLibrary":true
        })
    }));
    if let Some(native) = catalog()["agents"][kind]["nativeSlashCommands"].as_array() {
        result.extend(native.iter().cloned().map(|mut command| {
            command["action"] = json!("send");
            command["isLocalCommand"] = json!(true);
            command
        }));
    }
    let mut seen = std::collections::HashSet::new();
    result.retain(|command| seen.insert(command["name"].as_str().unwrap().to_lowercase()));
    result
}

pub fn catalog() -> &'static Value {
    static CATALOG: LazyLock<Value> = LazyLock::new(|| {
        let mut value = json!({
                    "agents": {
                        "agent": {
                            "kind": "agent",
                            "label": "Agent",
                            "iconKey": "agent",
                            "nativeSlashCommands": [],
                            "models": [],
                            "defaultModel": ""
                        },
                        "claude": {
                            "kind": "claude",
                            "label": "Claude",
                            "iconKey": "anthropic",
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
        ("claude-fable-5-1", "Fable 5.1", "Hardest tasks", None),
        ("claude-fable-5", "Fable 5", "Previous Fable", None),
        ("claude-opus-5", "Opus 5", "★ Most capable", None),
        ("claude-opus-4-8", "Opus 4.8", "Previous Opus", None),
        ("claude-opus-4-7", "Opus 4.7", "Older Opus", None),
        ("claude-opus-4-6", "Opus 4.6", "Older Opus", None),
        ("claude-sonnet-5", "Sonnet 5", "Best value", None),
        ("claude-sonnet-4-6", "Sonnet 4.6", "Previous Sonnet", None),
        ("claude-haiku-4-5", "Haiku 4.5", "Fastest", None)
        ]),
                            "defaultModel": "claude-opus-5"
                        },
                        "codex": {
                            "kind": "codex",
                            "label": "Codex",
                            "iconKey": "openai",
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
    json!(ProviderSettings {
        agent_kind: match kind {
            "claude" => WorkspaceAgentKind::Claude,
            "codex" => WorkspaceAgentKind::Codex,
            _ => WorkspaceAgentKind::Agent,
        },
        model: model.as_str().unwrap_or_default().into(),
        reasoning_level: reasoning.as_str().unwrap_or_default().into(),
    })
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
    fn renderer_catalog_preserves_the_endpoint_contract_and_command_precedence() {
        let skills = vec![crate::prompts::Prompt {
            id: "skill-review".into(),
            name: "Review".into(),
            description: "Custom review".into(),
            command: "review".into(),
            prompt_template: "Review the changes".into(),
            is_built_in: false,
            created_at: 0,
            updated_at: 0,
        }];
        let defaults =
            json!({"agentKind":"claude", "model":"missing-model", "reasoningLevel":"low"});
        let actual = json!(renderer_catalog(&defaults, &skills));
        let mut expected = catalog().clone();
        for (kind, definition) in expected["agents"].as_object_mut().unwrap() {
            definition["commands"] = json!(composer_commands(kind, &skills));
        }
        expected["defaults"] = resolve(&json!({"defaults":defaults}));
        assert_eq!(actual, expected);
        let commands = actual["agents"]["claude"]["commands"].as_array().unwrap();
        let review: Vec<_> = commands
            .iter()
            .filter(|command| command["name"] == "review")
            .collect();
        assert_eq!(review.len(), 1);
        assert_eq!(review[0]["id"], "skill-review");
        assert_eq!(
            actual["defaults"]["model"],
            catalog()["agents"]["claude"]["defaultModel"]
        );
    }
}
