use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub prompt_template: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub is_built_in: bool,
    pub execution_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
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

    pub fn list_by_usage(&self) -> Result<Vec<Prompt>, String> {
        let mut prompts = self.load()?;
        prompts.sort_by_key(|prompt| std::cmp::Reverse(prompt.execution_count));
        Ok(prompts)
    }

    pub fn create(&self, body: &Map<String, Value>, now: u64) -> Result<Prompt, PromptError> {
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
            category: Some(
                string_value(body, "category")
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "custom".into()),
            ),
            tags: string_array(body.get("tags")).unwrap_or_default(),
            is_built_in: false,
            execution_count: 0,
            last_used: None,
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
        if let Some(value) = string_value(body, "name") {
            current.name = value;
        }
        if let Some(value) = string_value(body, "description") {
            current.description = value;
        }
        if let Some(value) = string_value(body, "command") {
            current.command = value;
        }
        if let Some(value) = string_value(body, "promptTemplate") {
            current.prompt_template = value;
        }
        if let Some(value) = string_value(body, "category") {
            current.category = Some(value);
        }
        if let Some(value) = string_array(body.get("tags")) {
            current.tags = value;
        }
        current.updated_at = now.max(current.updated_at.saturating_add(1));
        let updated = current.clone();
        self.save(&prompts).map_err(internal_prompt_error)?;
        Ok(updated)
    }

    pub fn delete(&self, id: &str) -> Result<(), PromptError> {
        let prompts = self.load().map_err(internal_prompt_error)?;
        let Some(prompt) = prompts.iter().find(|prompt| prompt.id == id) else {
            return Err(not_found());
        };
        if prompt.is_built_in {
            return Err(PromptError {
                status: 400,
                message: "Cannot delete built-in prompts".into(),
            });
        }
        self.save(
            &prompts
                .into_iter()
                .filter(|prompt| prompt.id != id)
                .collect::<Vec<_>>(),
        )
        .map_err(internal_prompt_error)
    }

    pub fn increment_usage(&self, id: &str, now: u64) -> Result<(), PromptError> {
        let mut prompts = self.load().map_err(internal_prompt_error)?;
        let Some(prompt) = prompts.iter_mut().find(|prompt| prompt.id == id) else {
            return Err(not_found());
        };
        prompt.execution_count += 1;
        prompt.last_used = Some(now);
        self.save(&prompts).map_err(internal_prompt_error)
    }

    fn save(&self, prompts: &[Prompt]) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(prompts).map_err(|error| error.to_string())?;
        crate::atomic_write::overwrite(&self.local_path, &bytes)
    }
}

pub fn merge_prompts(bundled: Vec<Prompt>, local: Vec<Prompt>) -> Vec<Prompt> {
    let local_by_id: HashMap<_, _> = local
        .iter()
        .map(|prompt| (prompt.id.as_str(), prompt))
        .collect();
    let local_built_in_by_command: HashMap<_, _> = local
        .iter()
        .filter(|prompt| prompt.is_built_in)
        .map(|prompt| (prompt.command.as_str(), prompt))
        .collect();
    let bundled_built_ins: Vec<_> = bundled
        .iter()
        .filter(|prompt| prompt.is_built_in)
        .cloned()
        .collect();
    let built_in_ids: HashSet<_> = bundled_built_ins
        .iter()
        .map(|prompt| prompt.id.clone())
        .collect();
    let built_in_commands: HashSet<_> = bundled_built_ins
        .iter()
        .map(|prompt| prompt.command.clone())
        .collect();

    let mut merged = Vec::new();
    for mut prompt in bundled_built_ins {
        let local_prompt = local_by_id.get(prompt.id.as_str()).copied().or_else(|| {
            local_built_in_by_command
                .get(prompt.command.as_str())
                .copied()
        });
        prompt.is_built_in = true;
        if let Some(local_prompt) = local_prompt {
            prompt.execution_count = local_prompt.execution_count;
            if local_prompt.last_used.is_some() {
                prompt.last_used = local_prompt.last_used;
            }
        }
        merged.push(prompt);
    }

    let mut custom_positions = HashMap::<String, usize>::new();
    for prompt in bundled.into_iter().chain(local) {
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

fn string_value(body: &Map<String, Value>, key: &str) -> Option<String> {
    body.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn string_array(value: Option<&Value>) -> Option<Vec<String>> {
    value.and_then(Value::as_array).map(|values| {
        values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    })
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
    if !command
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_lowercase)
        || !command
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return None;
    }
    let mut result = Map::new();
    for field in ["type", "action"].into_iter().chain(fields) {
        result.insert(field.into(), value[field].clone());
    }
    if value["action"] == "update" {
        if value["skillId"].as_str()?.is_empty()
            || value["expectedUpdatedAt"].as_u64()? > 9_007_199_254_740_991
        {
            return None;
        }
        result.insert("skillId".into(), value["skillId"].clone());
        result.insert(
            "expectedUpdatedAt".into(),
            value["expectedUpdatedAt"].clone(),
        );
    }
    Some(Value::Object(result))
}

pub fn chat_skill_read(value: &Value) -> Option<Value> {
    let skill = &value["skill"];
    if value["type"] != "inferay.skill-read"
        || !skill["isBuiltIn"].is_boolean()
        || ["_id", "name", "command", "description", "promptTemplate"]
            .iter()
            .any(|key| !skill[key].is_string())
    {
        return None;
    }
    Some(skill.clone())
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
