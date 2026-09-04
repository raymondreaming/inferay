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
        atomic_write_json(&self.local_path, prompts)
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

fn atomic_write_json(path: &Path, value: impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "prompt path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    crate::atomic_write::overwrite(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_stale_skill_proposals_without_overwriting_newer_instructions() {
        let root = tempfile::tempdir().unwrap();
        let store = PromptStore::new(
            root.path().join("bundled.json"),
            root.path().join("local.json"),
        );
        let original = store.create(serde_json::json!({"name":"Review", "command":"review", "promptTemplate":"Original"}).as_object().unwrap(), 10).unwrap();
        store
            .update(
                &original.id,
                serde_json::json!({"promptTemplate":"Newer edit"})
                    .as_object()
                    .unwrap(),
                20,
            )
            .unwrap();
        let stale = store
            .update(
                &original.id,
                serde_json::json!({"expectedUpdatedAt":10, "promptTemplate":"Stale proposal"})
                    .as_object()
                    .unwrap(),
                30,
            )
            .unwrap_err();
        assert_eq!(stale.status, 409);
        assert_eq!(store.load().unwrap()[0].prompt_template, "Newer edit");
        let approved = store
            .update(
                &original.id,
                serde_json::json!({"expectedUpdatedAt":20, "promptTemplate":"Approved proposal"})
                    .as_object()
                    .unwrap(),
                30,
            )
            .unwrap();
        assert_eq!(approved.prompt_template, "Approved proposal");
    }

    fn prompt(id: &str, command: &str, built_in: bool, count: i64) -> Prompt {
        Prompt {
            id: id.into(),
            name: command.into(),
            description: command.into(),
            command: command.into(),
            prompt_template: "{args}".into(),
            category: None,
            tags: Vec::new(),
            is_built_in: built_in,
            execution_count: count,
            last_used: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn keeps_built_ins_while_carrying_forward_local_usage() {
        let bundled = vec![
            prompt("builtin-current", "explain", true, 0),
            prompt("custom-bundled", "ship", false, 0),
        ];
        let mut old_builtin = prompt("builtin-old", "explain", true, 9);
        old_builtin.last_used = Some(123);
        let local = vec![
            old_builtin,
            prompt("custom-local", "review", false, 0),
            prompt("custom-conflict", "explain", false, 0),
        ];
        let merged = merge_prompts(bundled, local);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].id, "builtin-current");
        assert_eq!(merged[0].execution_count, 9);
        assert_eq!(merged[0].last_used, Some(123));
        assert_eq!(merged[1].id, "custom-bundled");
        assert_eq!(merged[2].id, "custom-local");
    }
}
