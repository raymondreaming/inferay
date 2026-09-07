use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

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

#[derive(Serialize, ts_rs::TS)]
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
#[derive(Deserialize, Serialize, ts_rs::TS)]
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

#[derive(Debug)]
pub struct PromptStore {
    bundled_path: PathBuf,
    local_path: PathBuf,
}

impl PromptStore {
    pub fn new(bundled_path: PathBuf, local_path: PathBuf) -> Self {
        Self {
            bundled_path,
            local_path,
        }
    }

    pub fn load(&self) -> Result<Vec<Prompt>, String> {
        let bundled = if self.bundled_path.is_file() {
            read_prompts(&self.bundled_path)?
        } else {
            Vec::new()
        };
        let local = if self.local_path.is_file() {
            read_prompts(&self.local_path)?
        } else {
            Vec::new()
        };
        Ok(merge_prompts(bundled, local))
    }

    pub fn create(&self, body: &Map<String, Value>, now: u64) -> Result<Prompt, PromptError> {
        let body = normalize_prompt_fields(body, true)?;
        let body = &body;
        let mut prompts = self.load().map_err(internal_prompt_error)?;
        let command = string_value(body, "command").unwrap_or_default();
        if prompts.iter().any(|prompt| prompt.command == command) {
            return Err(PromptError {
                status: 400,
                message: format!("Command /{command} already exists"),
            });
        }
        let name = string_value(body, "name").unwrap_or_default();
        let prompt = Prompt {
            id: format!("custom-{now}"),
            name: name.clone(),
            description: string_value(body, "description")
                .filter(|value| !value.is_empty())
                .unwrap_or(name),
            command,
            prompt_template: string_value(body, "promptTemplate").unwrap_or_default(),
            is_built_in: false,
            created_at: now,
            updated_at: now,
        };
        prompts.push(prompt.clone());
        self.save(&prompts).map_err(internal_prompt_error)?;
        Ok(prompt)
    }

    pub fn update(
        &self,
        id: &str,
        body: &Map<String, Value>,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        let mut prompts = self.load().map_err(internal_prompt_error)?;
        let Some(index) = prompts.iter().position(|prompt| prompt.id == id) else {
            return Err(not_found());
        };
        if prompts[index].is_built_in {
            return Err(PromptError {
                status: 400,
                message: "Cannot edit built-in prompts".into(),
            });
        }
        if let Some(expected) = body.get("expectedUpdatedAt")
            && expected.as_u64() != Some(prompts[index].updated_at)
        {
            return Err(PromptError {
                status: 409,
                message:
                    "This skill changed after the proposal. Review a fresh proposal before saving."
                        .into(),
            });
        }
        let body = normalize_prompt_fields(body, false)?;
        let body = &body;
        if let Some(command) = string_value(body, "command")
            && command != prompts[index].command
            && prompts
                .iter()
                .any(|prompt| prompt.id != id && prompt.command == command)
        {
            return Err(PromptError {
                status: 400,
                message: format!("Command /{command} already exists"),
            });
        }

        let current = &mut prompts[index];
        for (key, field) in [
            ("name", &mut current.name),
            ("description", &mut current.description),
            ("command", &mut current.command),
            ("promptTemplate", &mut current.prompt_template),
        ] {
            if let Some(value) = string_value(body, key) {
                *field = value;
            }
        }
        current.updated_at = now.max(current.updated_at.saturating_add(1));
        let updated = current.clone();
        self.save(&prompts).map_err(internal_prompt_error)?;
        Ok(updated)
    }

    pub fn approve_proposal(
        &self,
        proposal: &Map<String, Value>,
        now: u64,
    ) -> Result<Value, PromptError> {
        let invalid = || PromptError {
            status: 400,
            message: "Invalid skill proposal".into(),
        };
        let (saved, verb) = match proposal.get("action").and_then(Value::as_str) {
            Some("create") => (self.create(proposal, now)?, "created"),
            Some("update") => {
                let id = proposal
                    .get("skillId")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(invalid)?;
                proposal
                    .get("expectedUpdatedAt")
                    .and_then(Value::as_u64)
                    .ok_or_else(invalid)?;
                (self.update(id, proposal, now)?, "updated")
            }
            _ => return Err(invalid()),
        };
        Ok(json!({
            "outcome": { "status": "saved", "skillId": saved.id },
            "message": format!("I approved the skill proposal. Inferay successfully {verb} /{} (skill ID: {}).", saved.command, saved.id)
        }))
    }

    pub fn delete(&self, id: &str) -> Result<(), PromptError> {
        let mut prompts = self.load().map_err(internal_prompt_error)?;
        let Some(prompt) = prompts.iter().find(|prompt| prompt.id == id) else {
            return Err(not_found());
        };
        if prompt.is_built_in {
            return Err(PromptError {
                status: 400,
                message: "Cannot delete built-in prompts".into(),
            });
        }
        prompts.retain(|prompt| prompt.id != id);
        self.save(&prompts).map_err(internal_prompt_error)
    }

    fn save(&self, prompts: &[Prompt]) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(prompts).map_err(|error| error.to_string())?;
        crate::atomic_write::overwrite(&self.local_path, &bytes)
    }
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

fn read_prompts(path: &Path) -> Result<Vec<Prompt>, String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
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

fn internal_prompt_error(message: String) -> PromptError {
    PromptError {
        status: 500,
        message,
    }
}

/// Presentation validation for saved and live skill cards. Applying a proposal
/// still requires the native store's independent revision/approval validation.
pub fn chat_skill_proposal(value: &Value) -> Option<Value> {
    if value["type"] != "inferay.skill-proposal"
        || !matches!(value["action"].as_str(), Some("create" | "update"))
    {
        return None;
    }
    let fields = ["name", "command", "description", "promptTemplate", "reason"];
    for field in fields {
        let text = value[field].as_str()?;
        if text.trim().is_empty() || text.encode_utf16().count() > 50_000 {
            return None;
        }
    }
    let command = value["command"].as_str()?;
    if !valid_command(command) {
        return None;
    }
    let (skill_id, expected_updated_at) = if value["action"] == "update" {
        let id = value["skillId"].as_str()?;
        let updated = value["expectedUpdatedAt"].as_u64()?;
        if id.is_empty() || updated > 9_007_199_254_740_991 {
            return None;
        }
        (Some(id.to_owned()), Some(updated))
    } else {
        (None, None)
    };
    serde_json::to_value(SkillProposal {
        kind: "inferay.skill-proposal",
        action: value["action"].as_str()?.to_owned(),
        skill_id,
        expected_updated_at,
        name: value["name"].as_str()?.to_owned(),
        command: command.to_owned(),
        description: value["description"].as_str()?.to_owned(),
        prompt_template: value["promptTemplate"].as_str()?.to_owned(),
        reason: value["reason"].as_str()?.to_owned(),
    })
    .ok()
}

pub fn chat_skill_read(value: &Value) -> Option<Value> {
    if value["type"] != "inferay.skill-read" {
        return None;
    }
    let skill: SkillRead = serde_json::from_value(value["skill"].clone()).ok()?;
    serde_json::to_value(skill).ok()
}

/// Text spans use JavaScript UTF-16 coordinates without duplicating message text.
pub fn chat_skill_parts(content: &str, streaming: bool) -> Option<Value> {
    if !content.contains("```inferay-skill") {
        return None;
    }
    let mut parts = Vec::new();
    let mut cursor = 0;
    let mut cursor_utf16 = 0;
    let mut lines = content.split_inclusive('\n').scan(0, |offset, line| {
        let start = *offset;
        *offset += line.len();
        Some((start, line))
    });
    while let Some((start, line)) = lines.next() {
        if !line.ends_with('\n')
            || !line
                .strip_prefix("```inferay-skill")
                .is_some_and(|rest| rest.trim().is_empty())
        {
            continue;
        }
        let body_start = start + line.len();
        let mut closing = None;
        for (end, line) in lines.by_ref() {
            if line
                .strip_suffix('\n')
                .unwrap_or(line)
                .trim_end_matches([' ', '\t'])
                == "```"
            {
                closing = Some((end, end + line.len()));
                break;
            }
        }
        let Some((body_end, block_end)) = closing else {
            break;
        };
        let proposal = serde_json::from_str::<Value>(&content[body_start..body_end])
            .ok()
            .and_then(|value| chat_skill_proposal(&value));
        if let Some(proposal) = proposal {
            let start_utf16 = cursor_utf16 + content[cursor..start].encode_utf16().count();
            if start > cursor {
                parts.push(serde_json::json!({"start":cursor_utf16, "end":start_utf16}));
            }
            parts.push(serde_json::json!({"proposal":proposal, "index":start_utf16}));
            cursor_utf16 = start_utf16 + content[start..block_end].encode_utf16().count();
            cursor = block_end;
        }
    }
    let rest = &content[cursor..];
    let partial = if streaming {
        let mut offset = 0;
        rest.split_inclusive('\n').find_map(|line| {
            let start = offset;
            offset += line.len();
            line.strip_prefix("```inferay-skill")
                .filter(|suffix| suffix.is_empty() || suffix.starts_with(char::is_whitespace))
                .map(|_| start)
        })
    } else {
        None
    };
    if let Some(partial) = partial {
        if partial > 0 {
            parts.push(serde_json::json!({"start":cursor_utf16, "end":cursor_utf16 + rest[..partial].encode_utf16().count()}));
        }
        parts.push(serde_json::json!({"pending":true}));
    } else if !rest.is_empty() {
        parts.push(serde_json::json!({"start":cursor_utf16, "end":cursor_utf16 + rest.encode_utf16().count()}));
    }
    Some(Value::Array(parts))
}

#[cfg(test)]
mod skill_card_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn proposal_contract_validates_revisions_and_preserves_card_fields() {
        let mut proposal = json!({
            "type": "inferay.skill-proposal", "action": "update",
            "skillId": "skill-1", "expectedUpdatedAt": 42,
            "name": "Review", "command": "review-2", "description": "Review changes",
            "promptTemplate": "Check the diff", "reason": "Save this workflow"
        });
        assert_eq!(chat_skill_proposal(&proposal), Some(proposal.clone()));
        proposal["expectedUpdatedAt"] = json!(9_007_199_254_740_992_u64);
        assert!(chat_skill_proposal(&proposal).is_none());
        proposal["action"] = json!("create");
        let created = chat_skill_proposal(&proposal).unwrap();
        assert!(created.get("skillId").is_none());
        assert!(created.get("expectedUpdatedAt").is_none());
        proposal["command"] = json!("Review");
        assert!(chat_skill_proposal(&proposal).is_none());
        proposal["command"] = json!("review");
        proposal["promptTemplate"] = json!("🦀".repeat(25_001));
        assert!(chat_skill_proposal(&proposal).is_none());
    }

    #[test]
    fn read_contract_preserves_extra_fields_and_rejects_invalid_shapes() {
        let mut envelope = json!({"type": "inferay.skill-read", "skill": {
            "_id": "skill-1", "name": "Review", "command": "review",
            "description": "Review changes", "promptTemplate": "Check the diff",
            "isBuiltIn": false, "updatedAt": 42, "futureField": {"enabled": true}
        }});
        assert_eq!(chat_skill_read(&envelope), Some(envelope["skill"].clone()));
        envelope["skill"]["isBuiltIn"] = json!("false");
        assert!(chat_skill_read(&envelope).is_none());
        envelope["skill"]["isBuiltIn"] = json!(false);
        envelope["skill"].as_object_mut().unwrap().remove("name");
        assert!(chat_skill_read(&envelope).is_none());
    }
}

impl PromptStore {
    /// Expansion happens once at chat admission. Queued sends carry
    /// prepared text without the expansion flag, so replay never expands again.
    pub fn expand_chat_commands(
        &self,
        text: &str,
        command_id: Option<&str>,
        args: Option<&str>,
    ) -> Result<String, String> {
        let skills = self.load()?;
        Ok(expand_commands(text, &skills, command_id, args))
    }

    /// Agent tools read the same store as the editor. Proposals never write it.
    pub fn tool_definitions() -> Value {
        json!([
            {"type":"function","name":"inferay_list_skills",
             "description":"Find skills in the user's Inferay library. No filesystem or HTTP lookup needed.",
             "inputSchema":{"type":"object","properties":{"query":{"type":"string","description":"Optional name, command, or description filter"}},"additionalProperties":false}},
            {"type":"function","name":"inferay_read_skill",
             "description":"Read a saved Inferay skill directly by ID, slash command, or exact name. Returns complete instructions and revision, and displays a native skill card.",
             "inputSchema":{"type":"object","properties":{"skill":{"type":"string"}},"required":["skill"],"additionalProperties":false}},
            {"type":"function","name":"inferay_propose_skill",
             "description":"Show a native approval card to create or update an Inferay skill. Does NOT save. For updates first read the skill and pass its ID and updatedAt revision. Wait for the user's approval result; never save through shell or HTTP.",
             "inputSchema":{"type":"object","properties":{
                 "action":{"type":"string","enum":["create","update"]},
                 "skillId":{"type":"string"},"expectedUpdatedAt":{"type":"integer"},
                 "name":{"type":"string"},"command":{"type":"string"},
                 "description":{"type":"string"},"promptTemplate":{"type":"string"},"reason":{"type":"string"}
             },"required":["action","name","command","description","promptTemplate","reason"],"additionalProperties":false}}
        ])
    }

    /// Returns the tool result and, optionally, a persisted native chat card.
    pub fn call_tool(&self, tool: &str, args: &Value) -> Result<(Value, Option<Value>), String> {
        if !matches!(
            tool,
            "inferay_list_skills" | "inferay_read_skill" | "inferay_propose_skill"
        ) {
            return Err(format!("Unknown Inferay tool: {tool}"));
        }
        let skills = self.load()?;
        match tool {
            "inferay_list_skills" => {
                let query = args
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_lowercase();
                let matches = filter_prompts(&skills, "all", &query).into_iter().map(|skill| json!({"_id":skill.id,"name":skill.name,"command":skill.command,
                    "description":skill.description,"isBuiltIn":skill.is_built_in,"updatedAt":skill.updated_at})).collect::<Vec<_>>();
                Ok((json!({"skills":matches}), None))
            }
            "inferay_read_skill" => {
                let key = args
                    .get("skill")
                    .and_then(Value::as_str)
                    .ok_or("skill is required")?
                    .trim()
                    .trim_start_matches('/');
                let matches = skills
                    .iter()
                    .filter(|skill| {
                        skill.id == key
                            || skill.command.eq_ignore_ascii_case(key)
                            || skill.name.eq_ignore_ascii_case(key)
                    })
                    .collect::<Vec<_>>();
                if matches.len() != 1 {
                    return Err("Skill not found or ambiguous. Use inferay_list_skills to find its exact ID.".into());
                }
                let skill = matches[0];
                let result = json!({"_id":skill.id,"name":skill.name,"command":skill.command,
                    "description":skill.description,"promptTemplate":skill.prompt_template,
                    "isBuiltIn":skill.is_built_in,"updatedAt":skill.updated_at});
                Ok((
                    result.clone(),
                    Some(json!({"type":"inferay.skill-read","skill":result})),
                ))
            }
            _ => {
                let action = args
                    .get("action")
                    .and_then(Value::as_str)
                    .ok_or("action is required")?;
                if !matches!(action, "create" | "update") {
                    return Err("Invalid action".into());
                }
                let mut proposal = json!({"type":"inferay.skill-proposal","action":action});
                for field in ["name", "command", "description", "promptTemplate", "reason"] {
                    let value = args
                        .get(field)
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty() && value.len() <= 50_000)
                        .ok_or_else(|| {
                            format!("{field} must be nonempty text, at most 50000 bytes")
                        })?;
                    proposal[field] = json!(value);
                }
                let command = proposal["command"].as_str().unwrap();
                if !valid_command(command) {
                    return Err("Command must start with a lowercase letter and contain only lowercase letters, digits, and hyphens".into());
                }
                let id = args.get("skillId").and_then(Value::as_str).unwrap_or("");
                if skills
                    .iter()
                    .any(|skill| skill.command == command && (action == "create" || skill.id != id))
                {
                    return Err("That command already exists. Choose a unique command.".into());
                }
                if action == "update" {
                    let skill = skills
                        .iter()
                        .find(|skill| skill.id == id)
                        .ok_or("Skill no longer exists. Read it again.")?;
                    if skill.is_built_in {
                        return Err("Built-in skills are read-only. Propose a custom copy.".into());
                    }
                    if args.get("expectedUpdatedAt").and_then(Value::as_u64)
                        != Some(skill.updated_at)
                    {
                        return Err(
                            "Skill changed. Read it again before proposing an update.".into()
                        );
                    }
                    proposal["skillId"] = json!(id);
                    proposal["expectedUpdatedAt"] = json!(skill.updated_at);
                }
                Ok((
                    json!({"status":"pending_approval","message":"Approval card displayed. Nothing saved. Do not repeat the proposal as a fenced block. Wait for the user's approval result."}),
                    Some(proposal),
                ))
            }
        }
    }
}

fn expand_commands(
    text: &str,
    skills: &[Prompt],
    command_id: Option<&str>,
    args: Option<&str>,
) -> String {
    let expand = |skill: &Prompt, token: &str, args: &str| {
        if skill.prompt_template.is_empty() {
            token.trim().to_owned()
        } else {
            skill
                .prompt_template
                .replacen("{args}", args, 1)
                .trim()
                .to_owned()
        }
    };
    if let Some(id) = command_id {
        return skills
            .iter()
            .find(|skill| skill.id == id)
            .map(|skill| expand(skill, text, args.unwrap_or("")))
            .unwrap_or_else(|| text.to_owned());
    }
    text.split_inclusive(char::is_whitespace)
        .map(|part| {
            let token = part.trim_end_matches(char::is_whitespace);
            let Some(name) = token.strip_prefix('/') else {
                return part.to_owned();
            };
            if !name.starts_with(|c: char| c.is_ascii_alphabetic())
                || !name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                || ["exit", "clear", "help"]
                    .iter()
                    .any(|local| name.eq_ignore_ascii_case(local))
            {
                return part.to_owned();
            }
            skills
                .iter()
                .find(|skill| skill.command.eq_ignore_ascii_case(name))
                .map(|skill| format!("{}{}", expand(skill, token, ""), &part[token.len()..]))
                .unwrap_or_else(|| part.to_owned())
        })
        .collect()
}

fn valid_command(command: &str) -> bool {
    command.starts_with(|c: char| c.is_ascii_lowercase())
        && command
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

#[cfg(test)]
mod store_behavior_tests {
    use super::*;

    #[test]
    fn expansion_and_proposals_share_the_saved_library_without_implicit_writes() {
        let root = std::env::temp_dir().join(format!("inferay-skills-{}", uuid::Uuid::new_v4()));
        let store = PromptStore::new(root.join("bundled.json"), root.join("local.json"));
        let skill = store
            .create(
                json!({"name":"Review", "command":"review", "description":"Review changes",
            "promptTemplate":"Inspect {args}"})
                .as_object()
                .unwrap(),
                42,
            )
            .unwrap();
        for (input, expected) in [
            (" /REVIEW\t/review\n", " Inspect\tInspect\n"),
            (
                "/review, x/review /review/foo /reviewé",
                "/review, x/review /review/foo /reviewé",
            ),
            ("\u{2003}/review\u{2003}", "\u{2003}Inspect\u{2003}"),
            ("/help /unknown", "/help /unknown"),
        ] {
            assert_eq!(
                store.expand_chat_commands(input, None, None).unwrap(),
                expected
            );
        }
        assert_eq!(
            store
                .expand_chat_commands("/review", Some(&skill.id), Some("changes"))
                .unwrap(),
            "Inspect changes"
        );
        let (result, card) = store
            .call_tool("inferay_read_skill", &json!({"skill":"review"}))
            .unwrap();
        assert_eq!(result["_id"], skill.id);
        assert_eq!(card.unwrap()["type"], "inferay.skill-read");
        let proposal = json!({"action":"update", "skillId":skill.id, "expectedUpdatedAt":42,
            "name":"New name", "command":"review", "description":"New description",
            "promptTemplate":"New instructions", "reason":"Improve review"});
        assert!(
            store
                .call_tool("inferay_propose_skill", &proposal)
                .unwrap()
                .1
                .is_some()
        );
        assert_eq!(store.load().unwrap()[0].name, "Review");
        let mut stale = proposal.clone();
        stale["expectedUpdatedAt"] = json!(41);
        assert!(store.call_tool("inferay_propose_skill", &stale).is_err());
        assert!(store.call_tool("unknown", &proposal).is_err());
        assert_eq!(
            store
                .approve_proposal(stale.as_object().unwrap(), 43)
                .unwrap_err()
                .status,
            409
        );
        let approved = store
            .approve_proposal(proposal.as_object().unwrap(), 43)
            .unwrap();
        assert_eq!(approved["outcome"]["skillId"], skill.id);
        assert!(
            approved["message"]
                .as_str()
                .unwrap()
                .contains("updated /review")
        );
        assert_eq!(store.load().unwrap()[0].name, "New name");
        assert_eq!(
            store
                .approve_proposal(proposal.as_object().unwrap(), 44)
                .unwrap_err()
                .status,
            409
        );
        let mut invalid = proposal.clone();
        invalid.as_object_mut().unwrap().remove("expectedUpdatedAt");
        assert_eq!(
            store
                .approve_proposal(invalid.as_object().unwrap(), 44)
                .unwrap_err()
                .status,
            400
        );
        invalid["action"] = json!("delete");
        assert_eq!(
            store
                .approve_proposal(invalid.as_object().unwrap(), 44)
                .unwrap_err()
                .status,
            400
        );
        let created = store.approve_proposal(json!({"action":"create", "name":"Build", "command":"/BUILD", "promptTemplate":"Build it"}).as_object().unwrap(), 45).unwrap();
        assert!(
            created["message"]
                .as_str()
                .unwrap()
                .contains("created /build")
        );
        assert_eq!(store.load().unwrap().len(), 2);

        std::fs::remove_dir_all(root).unwrap();
    }
}
