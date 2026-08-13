use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

const DEFAULT_SEARCH_FOLDERS: &[&str] = &[
    "~/Desktop",
    "~/Documents",
    "~/Projects",
    "~/Developer",
    "~/Code",
    "~/Work",
    "~/Sites",
    "~/repos",
    "~/src",
    "~/dev",
];

#[derive(Debug)]
pub struct ConfigManager {
    base_path: PathBuf,
    local_path: PathBuf,
    cache: Option<Map<String, Value>>,
}

impl ConfigManager {
    pub fn new(base_path: PathBuf, local_path: PathBuf) -> Self {
        Self {
            base_path,
            local_path,
            cache: None,
        }
    }

    pub fn load(&mut self) -> Map<String, Value> {
        let loaded = self.load_inner().unwrap_or_else(|_| default_config());
        self.cache = Some(loaded.clone());
        loaded
    }

    pub fn update(&mut self, updates: Map<String, Value>) -> Result<Map<String, Value>, String> {
        let local_only_keys = BTreeSet::from(["build_agent", "search_folders"]);
        let mut base_updates = Map::new();
        let mut local_updates = Map::new();
        for (key, value) in &updates {
            if local_only_keys.contains(key.as_str()) {
                local_updates.insert(key.clone(), value.clone());
            } else {
                base_updates.insert(key.clone(), value.clone());
            }
        }

        let current = self.load();
        if !base_updates.is_empty() {
            let base_current = read_yaml_object(&self.base_path)?.unwrap_or_else(default_config);
            let merged = deep_merge_records(&base_current, &base_updates);
            write_yaml_object(&self.base_path, &merged)?;
        }
        if !local_updates.is_empty() {
            let local_current = read_yaml_object(&self.local_path)?.unwrap_or_default();
            let merged = deep_merge_records(&local_current, &local_updates);
            write_yaml_object(&self.local_path, &merged)?;
        }

        let merged = deep_merge_records(&current, &updates);
        self.cache = Some(merged.clone());
        Ok(merged)
    }

    fn load_inner(&self) -> Result<Map<String, Value>, String> {
        let mut base = default_config();
        if let Some(base_file) = read_yaml_object(&self.base_path)? {
            base = deep_merge_records(&base, &base_file);
        }
        if let Some(local_file) = read_yaml_object(&self.local_path)? {
            base = deep_merge_records(&base, &local_file);
        }
        Ok(base)
    }
}

pub fn deep_merge_records(
    target: &Map<String, Value>,
    source: &Map<String, Value>,
) -> Map<String, Value> {
    let mut result = target.clone();
    for (key, source_value) in source {
        let value = match (target.get(key), source_value) {
            (Some(Value::Object(target_record)), Value::Object(source_record)) => {
                Value::Object(deep_merge_records(target_record, source_record))
            }
            _ => source_value.clone(),
        };
        result.insert(key.clone(), value);
    }
    result
}

fn default_config() -> Map<String, Value> {
    json!({
        "openai": { "api_key": "", "model": "gpt-5.6-sol" },
        "anthropic": { "api_key": "", "model": "claude-opus-4-7" },
        "build_agent": "claude",
        "fal": { "api_key": "" },
        "paths": { "template_dir": "../templates" },
        "search_folders": DEFAULT_SEARCH_FOLDERS,
    })
    .as_object()
    .expect("default config must be an object")
    .clone()
}

fn read_yaml_object(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let value = serde_yaml_ng::from_str::<Value>(&text).map_err(|error| error.to_string())?;
    Ok(Some(value.as_object().cloned().unwrap_or_default()))
}

fn write_yaml_object(path: &Path, value: &Map<String, Value>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "config path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let yaml = serde_yaml_ng::to_string(value).map_err(|error| error.to_string())?;
    std::fs::write(path, yaml).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_merges_records_but_replaces_arrays_and_primitives() {
        let target = json!({
            "openai": { "api_key": "old", "model": "gpt-5.4" },
            "search_folders": ["~/Desktop"],
            "build_agent": "claude",
        });
        let source = json!({
            "openai": { "model": "gpt-5.5" },
            "search_folders": ["~/Code"],
            "build_agent": "codex",
        });
        assert_eq!(
            Value::Object(deep_merge_records(
                target.as_object().unwrap(),
                source.as_object().unwrap(),
            )),
            json!({
                "openai": { "api_key": "old", "model": "gpt-5.5" },
                "search_folders": ["~/Code"],
                "build_agent": "codex",
            })
        );
    }

    #[test]
    fn splits_base_and_local_updates_like_the_typescript_manager() {
        let root = tempfile::TempDir::new().unwrap();
        let base_path = root.path().join("config.yaml");
        let local_path = root.path().join("config.local.yaml");
        let mut manager = ConfigManager::new(base_path.clone(), local_path.clone());

        let updated = manager
            .update(
                json!({
                    "openai": { "api_key": "secret" },
                    "build_agent": "codex",
                    "search_folders": ["~/Code"],
                })
                .as_object()
                .unwrap()
                .clone(),
            )
            .unwrap();
        assert_eq!(updated["openai"]["api_key"], "secret");
        assert_eq!(updated["build_agent"], "codex");

        let base: Value =
            serde_yaml_ng::from_str(&std::fs::read_to_string(base_path).unwrap()).unwrap();
        let local: Value =
            serde_yaml_ng::from_str(&std::fs::read_to_string(local_path).unwrap()).unwrap();
        assert_eq!(base["openai"]["api_key"], "secret");
        assert_eq!(base["build_agent"], "claude");
        assert_eq!(local["build_agent"], "codex");
        assert_eq!(local["search_folders"], json!(["~/Code"]));

        let reloaded = manager.load();
        assert_eq!(reloaded["openai"]["model"], "gpt-5.6-sol");
        assert_eq!(reloaded["openai"]["api_key"], "secret");
        assert_eq!(reloaded["build_agent"], "codex");
        assert_eq!(reloaded["search_folders"], json!(["~/Code"]));
    }
}
