//! Skill vocabulary and shared validation. File persistence belongs to the server.
pub mod cards;
pub mod commands;
pub mod library;
pub mod tools;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub prompt_template: String,
    pub is_built_in: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillProposal {
    #[serde(rename = "type")]
    #[ts(type = "'inferay.skill-proposal'")]
    kind: &'static str,
    #[ts(type = "'create' | 'update'")]
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    skill_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    expected_updated_at: Option<u64>,
    name: String,
    command: String,
    description: String,
    prompt_template: String,
    reason: String,
}
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillProposalView {
    title: String,
    status: String,
    decided: bool,
    saved_skill_id: Option<String>,
    current_instructions: Option<String>,
    blocked_reason: Option<String>,
    message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillRead {
    #[serde(rename = "_id")]
    id: String,
    name: String,
    command: String,
    description: String,
    prompt_template: String,
    is_built_in: bool,
    #[serde(flatten)]
    #[ts(skip)]
    extra: Map<String, Value>,
}

/// Shared name, command, description, and ownership filtering.
pub fn filter_prompts<'a>(prompts: &'a [Prompt], filter: &str, query: &str) -> Vec<&'a Prompt> {
    let query = query.to_lowercase();
    prompts
        .iter()
        .filter(|prompt| {
            let kind_matches = match filter {
                "builtin" => prompt.is_built_in,
                "custom" => !prompt.is_built_in,
                _ => true,
            };
            kind_matches
                && (query.is_empty()
                    || [&prompt.name, &prompt.command, &prompt.description]
                        .iter()
                        .any(|field| field.to_lowercase().contains(&query)))
        })
        .collect()
}

#[derive(Debug, PartialEq)]
pub struct PromptError {
    pub status: u16,
    pub message: String,
}

pub fn merge_prompts(bundled: Vec<Prompt>, local: Vec<Prompt>) -> Vec<Prompt> {
    let (mut merged, custom): (Vec<_>, Vec<_>) =
        bundled.into_iter().partition(|prompt| prompt.is_built_in);
    let built_in_ids: HashSet<_> = merged.iter().map(|prompt| prompt.id.clone()).collect();
    let built_in_commands: HashSet<_> =
        merged.iter().map(|prompt| prompt.command.clone()).collect();

    let mut custom_positions = HashMap::<String, usize>::new();
    for prompt in custom.into_iter().chain(local) {
        if prompt.is_built_in
            || built_in_ids.contains(prompt.id.as_str())
            || built_in_commands.contains(prompt.command.as_str())
        {
            continue;
        }
        if let Some(index) = custom_positions.get(&prompt.id).copied() {
            merged[index] = prompt;
        } else {
            custom_positions.insert(prompt.id.clone(), merged.len());
            merged.push(prompt);
        }
    }
    merged
}

fn normalize_prompt_fields(
    body: &Map<String, Value>,
    creating: bool,
) -> Result<Map<String, Value>, PromptError> {
    let mut body = body.clone();
    let invalid = |message: &str| PromptError {
        status: 400,
        message: message.into(),
    };
    for key in ["name", "command", "promptTemplate", "description"] {
        if !creating && !body.contains_key(key) {
            continue;
        }
        let text = body.get(key).and_then(Value::as_str).unwrap_or("").trim();
        if key != "description" && text.is_empty() {
            return Err(invalid("Name, command, and instructions are required"));
        }
        let value = if key == "command" {
            let command = text.strip_prefix('/').unwrap_or(text).to_lowercase();
            if !valid_command(&command) {
                return Err(invalid("Command: letters, numbers, hyphens only"));
            }
            command
        } else {
            text.to_owned()
        };
        body.insert(key.into(), Value::String(value));
    }
    if body.get("description").and_then(Value::as_str) == Some("") {
        body.insert(
            "description".into(),
            body.get("name")
                .cloned()
                .unwrap_or(Value::String(String::new())),
        );
    }
    Ok(body)
}

fn string_value(body: &Map<String, Value>, key: &str) -> Option<String> {
    body.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn not_found() -> PromptError {
    PromptError {
        status: 404,
        message: "Not found".into(),
    }
}

fn valid_command(command: &str) -> bool {
    command.starts_with(|c: char| c.is_ascii_lowercase())
        && command
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
