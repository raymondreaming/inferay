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

impl WorkspaceAgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
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
#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize, ts_rs::TS)]
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

#[derive(serde::Serialize, ts_rs::TS)]
pub struct ProviderSettingsChoice {
    kind: WorkspaceAgentKind,
    label: String,
    title: String,
    selected: bool,
    disabled: bool,
    model: String,
}
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum ProviderSettingsFieldKey {
    Model,
    ReasoningLevel,
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct ProviderSettingsOption {
    id: String,
    label: String,
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct ProviderSettingsField {
    key: ProviderSettingsFieldKey,
    label: String,
    value: String,
    options: Vec<ProviderSettingsOption>,
}
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettingsView {
    status_label: String,
    providers: Vec<ProviderSettingsChoice>,
    fields: Vec<ProviderSettingsField>,
}

/// Account facts and saved defaults produce the complete settings choice model.
pub fn settings_view(input: &Value) -> ProviderSettingsView {
    let settings = &input["settings"];
    let kind = settings["agentKind"].as_str().unwrap_or("codex");
    let definition = agent_definition(kind);
    let loading = input["loading"] == true;
    let status = |kind: &str| {
        input["statuses"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|status| status["kind"] == kind)
    };
    let active = status(kind);
    let label = definition.map_or("", |agent| agent.label.as_str());
    let status_label = if loading && active.is_none() {
        "Checking accounts…".into()
    } else {
        format!(
            "{label} {}",
            match active.and_then(|status| status["health"].as_str()) {
                Some("ready") => "is connected.",
                Some("needs-login") => "needs a login.",
                _ => "is not installed.",
            }
        )
    };
    let providers = [WorkspaceAgentKind::Claude, WorkspaceAgentKind::Codex]
        .into_iter()
        .map(|provider| {
            let name = provider.as_str();
            let definition = agent_definition(name).unwrap();
            let label = &definition.label;
            let status = status(name);
            let health = status.and_then(|status| status["health"].as_str());
            let detail = if loading && status.is_none() {
                "Checking…"
            } else {
                match health {
                    Some("ready") => "Connected",
                    Some("needs-login") => "Login needed",
                    _ => "Not installed",
                }
            };
            ProviderSettingsChoice {
                selected: name == kind,
                disabled: if status.is_some() {
                    health != Some("ready")
                } else {
                    loading
                },
                model: definition.default_model.clone(),
                label: label.clone(),
                title: format!("{label} · {detail}"),
                kind: provider,
            }
        })
        .collect();
    let mut fields = vec![ProviderSettingsField {
        key: ProviderSettingsFieldKey::Model,
        label: "Model".into(),
        value: settings["model"].as_str().unwrap_or_default().into(),
        options: definition
            .into_iter()
            .flat_map(|agent| &agent.models)
            .map(|model| ProviderSettingsOption {
                id: model.id.clone(),
                label: model.label.clone(),
            })
            .collect(),
    }];
    if kind == "codex" {
        fields.push(ProviderSettingsField {
            key: ProviderSettingsFieldKey::ReasoningLevel,
            label: "Reasoning".into(),
            value: settings["reasoningLevel"]
                .as_str()
                .unwrap_or_default()
                .into(),
            options: catalog()
                .codex
                .reasoning_levels
                .iter()
                .map(|level| ProviderSettingsOption {
                    id: level.id.clone(),
                    label: level.label.clone(),
                })
                .collect(),
        });
    }
    ProviderSettingsView {
        status_label,
        providers,
        fields,
    }
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
    let mut agents = catalog().clone();
    for definition in [&mut agents.agent, &mut agents.claude, &mut agents.codex] {
        definition.commands = composer_commands(definition.kind.as_str(), skills);
    }
    ProviderCatalog {
        agents,
        reasoning_levels: catalog().codex.reasoning_levels.clone(),
        defaults: resolve(&json!({"defaults": defaults})),
    }
}

fn models(rows: &[(&str, &str, &str, Option<&str>)]) -> Vec<ModelOption> {
    rows.iter()
        .map(|(id, label, detail, short_label)| ModelOption {
            id: (*id).into(),
            label: (*label).into(),
            detail: Some((*detail).into()),
            short_label: short_label.map(str::to_owned),
        })
        .collect()
}

fn commands(rows: &[(&str, &str)]) -> Vec<SlashCommand> {
    rows.iter()
        .map(|(name, description)| SlashCommand {
            name: (*name).into(),
            description: (*description).into(),
            ..Default::default()
        })
        .collect()
}

/// Local commands take precedence over skills, then provider commands.
pub fn composer_commands(kind: &str, skills: &[crate::prompts::Prompt]) -> Vec<SlashCommand> {
    let mut result = commands(&[
        ("exit", "Close this chat pane"),
        ("clear", "Clear all messages"),
        ("help", "Show available commands"),
    ]);
    for command in &mut result {
        command.action = Some("local".into());
        command.is_local_command = Some(true);
    }
    result.extend(skills.iter().map(|skill| SlashCommand {
        id: Some(skill.id.clone()),
        name: skill.command.clone(),
        description: skill.description.clone(),
        action: Some("send".into()),
        is_from_library: Some(true),
        ..Default::default()
    }));
    if let Some(definition) = agent_definition(kind) {
        result.extend(
            definition
                .native_slash_commands
                .iter()
                .cloned()
                .map(|mut command| {
                    command.action = Some("send".into());
                    command.is_local_command = Some(true);
                    command
                }),
        );
    }
    let mut seen = std::collections::HashSet::new();
    result.retain(|command| seen.insert(command.name.to_lowercase()));
    result
}

fn catalog() -> &'static AgentCatalog {
    static CATALOG: LazyLock<AgentCatalog> = LazyLock::new(|| AgentCatalog {
        agent: AgentDefinition {
            kind: WorkspaceAgentKind::Agent,
            label: "Agent".into(),
            icon_key: AgentIconKey::Agent,
            commands: vec![],
            native_slash_commands: vec![],
            models: vec![],
            default_model: String::new(),
            reasoning_levels: vec![],
        },
        claude: AgentDefinition {
            kind: WorkspaceAgentKind::Claude,
            label: "Claude".into(),
            icon_key: AgentIconKey::Anthropic,
            commands: vec![],
            native_slash_commands: commands(&[
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
                ("vim", "Toggle vim mode"),
            ]),
            models: models(&[
                ("claude-fable-5-1", "Fable 5.1", "Hardest tasks", None),
                ("claude-fable-5", "Fable 5", "Previous Fable", None),
                ("claude-opus-5", "Opus 5", "★ Most capable", None),
                ("claude-opus-4-8", "Opus 4.8", "Previous Opus", None),
                ("claude-opus-4-7", "Opus 4.7", "Older Opus", None),
                ("claude-opus-4-6", "Opus 4.6", "Older Opus", None),
                ("claude-sonnet-5", "Sonnet 5", "Best value", None),
                ("claude-sonnet-4-6", "Sonnet 4.6", "Previous Sonnet", None),
                ("claude-haiku-4-5", "Haiku 4.5", "Fastest", None),
            ]),
            default_model: "claude-opus-5".into(),
            reasoning_levels: vec![],
        },
        codex: AgentDefinition {
            kind: WorkspaceAgentKind::Codex,
            label: "Codex".into(),
            icon_key: AgentIconKey::Openai,
            commands: vec![],
            native_slash_commands: commands(&[(
                "goal",
                "Start, pause, resume, clear, or inspect a Codex objective",
            )]),
            models: models(&[
                (
                    "gpt-6-astra",
                    "GPT-6 Astra",
                    "Complex agentic work",
                    Some("Astra"),
                ),
                (
                    "gpt-5.6-sol",
                    "GPT-5.6 Sol",
                    "★ Frontier agentic coding",
                    Some("Sol"),
                ),
                (
                    "gpt-5.6-terra",
                    "GPT-5.6 Terra",
                    "Balanced everyday work",
                    Some("Terra"),
                ),
                (
                    "gpt-5.6-luna",
                    "GPT-5.6 Luna",
                    "Fast & affordable",
                    Some("Luna"),
                ),
                ("gpt-5.5", "GPT-5.5", "Frontier model", None),
                ("gpt-5.4", "GPT-5.4", "Everyday coding", None),
                ("gpt-5.2-codex", "GPT-5.2 Codex", "★ Frontier agentic", None),
                (
                    "gpt-5.1-codex-max",
                    "GPT-5.1 Codex Max",
                    "Deep reasoning",
                    None,
                ),
                ("gpt-5.4-mini", "GPT-5.4 Mini", "Fast & cheap", None),
                ("gpt-5.3-codex", "GPT-5.3 Codex", "Coding-optimized", None),
                ("gpt-5.3-codex-spark", "GPT-5.3 Spark", "Ultra-fast", None),
                ("gpt-5.2", "GPT-5.2", "Long-running agents", None),
                ("gpt-5.1-codex-mini", "GPT-5.1 Codex Mini", "Cheapest", None),
            ]),
            default_model: "gpt-5.6-sol".into(),
            reasoning_levels: [
                ("low", "Low", "Fast responses"),
                ("medium", "Medium", "Balanced"),
                ("high", "High", "Greater depth (default)"),
                ("xhigh", "Extra High", "Maximum reasoning"),
            ]
            .into_iter()
            .map(|(id, label, detail)| ReasoningLevel {
                id: id.into(),
                label: label.into(),
                detail: detail.into(),
            })
            .collect(),
        },
    });
    &CATALOG
}

fn agent_definition(kind: &str) -> Option<&'static AgentDefinition> {
    let agents = catalog();
    match kind {
        "agent" => Some(&agents.agent),
        "claude" => Some(&agents.claude),
        "codex" => Some(&agents.codex),
        _ => None,
    }
}

pub fn resolve(input: &Value) -> ProviderSettings {
    let defaults = &input["defaults"];
    let default_kind = defaults["agentKind"]
        .as_str()
        .filter(|kind| matches!(*kind, "claude" | "codex"))
        .unwrap_or("codex");
    let agent = input["agentKind"]
        .as_str()
        .and_then(agent_definition)
        .unwrap_or_else(|| agent_definition(default_kind).unwrap());
    let model = input["model"]
        .as_str()
        .into_iter()
        .chain(
            defaults["model"]
                .as_str()
                .filter(|_| agent.kind.as_str() == default_kind),
        )
        .find(|model| agent.models.iter().any(|option| option.id == *model))
        .unwrap_or(&agent.default_model);
    let reasoning = input["reasoningLevel"]
        .as_str()
        .into_iter()
        .chain(defaults["reasoningLevel"].as_str())
        .find(|level| {
            catalog()
                .codex
                .reasoning_levels
                .iter()
                .any(|option| option.id == *level)
        })
        .unwrap_or("high");
    ProviderSettings {
        agent_kind: agent.kind.clone(),
        model: model.into(),
        reasoning_level: reasoning.into(),
    }
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
    fn resolution_validates_once_and_preserves_provider_default_precedence() {
        let defaults =
            json!({"agentKind":"claude", "model":"claude-haiku-4-5", "reasoningLevel":"low"});
        for (input, kind, model, reasoning) in [
            (json!({}), "codex", "gpt-5.6-sol", "high"),
            (
                json!({"defaults":defaults}),
                "claude",
                "claude-haiku-4-5",
                "low",
            ),
            (
                json!({"defaults":defaults,"agentKind":"codex"}),
                "codex",
                "gpt-5.6-sol",
                "low",
            ),
            (
                json!({"defaults":defaults,"agentKind":"unknown","model":42,"reasoningLevel":false}),
                "claude",
                "claude-haiku-4-5",
                "low",
            ),
            (
                json!({"defaults":defaults,"agentKind":"agent"}),
                "agent",
                "",
                "low",
            ),
            (
                json!({"defaults":defaults,"model":"claude-opus-5","reasoningLevel":"xhigh"}),
                "claude",
                "claude-opus-5",
                "xhigh",
            ),
        ] {
            assert_eq!(
                json!(resolve(&input)),
                json!({"agentKind":kind,"model":model,"reasoningLevel":reasoning}),
                "{input}"
            );
        }
        let commands = json!(composer_commands("unknown", &[]));
        assert_eq!(commands.as_array().unwrap().len(), 3);
        assert_eq!(
            commands[0],
            json!({"name":"exit","description":"Close this chat pane","action":"local","isLocalCommand":true})
        );
    }

    #[test]
    fn settings_choices_preserve_account_loading_and_availability_rules() {
        let mut input = json!({"settings":{"agentKind":"codex","model":"custom","reasoningLevel":"high"},
            "statuses":[], "loading":true});
        let pending = settings_view(&input);
        assert_eq!(pending.status_label, "Checking accounts…");
        assert!(pending.providers.iter().all(|provider| provider.disabled));
        assert_eq!(pending.providers[1].title, "Codex · Checking…");
        input["statuses"] =
            json!([{"kind":"claude","health":"ready"},{"kind":"codex","health":"needs-login"}]);
        let ready = settings_view(&input);
        assert_eq!(ready.status_label, "Codex needs a login.");
        assert!(!ready.providers[0].disabled);
        assert!(ready.providers[1].disabled);
        assert!(ready.providers[1].selected);
        assert_eq!(ready.providers[0].title, "Claude · Connected");
        input["loading"] = json!(false);
        input["statuses"] = json!([]);
        let absent = settings_view(&input);
        assert!(!absent.providers[0].disabled);
        assert_eq!(absent.status_label, "Codex is not installed.");
    }

    #[test]
    fn settings_fields_and_provider_changes_use_the_native_catalog() {
        let mut input =
            json!({"settings":{"agentKind":"codex","model":"custom","reasoningLevel":"high"}});
        let codex = settings_view(&input);
        assert_eq!(codex.fields.len(), 2);
        assert_eq!(codex.fields[0].value, "custom");
        assert_eq!(codex.fields[1].value, "high");
        for provider in &codex.providers {
            assert_eq!(
                provider.model,
                agent_definition(provider.kind.as_str())
                    .unwrap()
                    .default_model
            );
        }
        input["settings"]["agentKind"] = json!("claude");
        let claude = settings_view(&input);
        assert_eq!(claude.fields.len(), 1);
        assert_eq!(
            claude.fields[0].options.len(),
            catalog().claude.models.len()
        );
        assert!(claude.providers[0].selected);
    }

    #[test]
    fn renderer_catalog_preserves_skill_precedence_and_resolved_defaults() {
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
        let commands = actual["agents"]["claude"]["commands"].as_array().unwrap();
        let review: Vec<_> = commands
            .iter()
            .filter(|command| command["name"] == "review")
            .collect();
        assert_eq!(review.len(), 1);
        assert_eq!(review[0]["id"], "skill-review");
        assert_eq!(actual["defaults"]["model"], catalog().claude.default_model);
    }
}
