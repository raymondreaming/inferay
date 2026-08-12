//! Typed, transport-free prompt/skill persistence for native clients.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use inferay_core::prompts::{Prompt, PromptError, PromptStore};
use serde_json::{Map, Value};
use tokio::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativePromptDraft {
    pub name: String,
    pub command: String,
    pub description: String,
    pub prompt_template: String,
    pub category: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NativePromptPatch {
    pub name: Option<String>,
    pub command: Option<String>,
    pub description: Option<String>,
    pub prompt_template: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Clone)]
pub struct NativePrompts {
    store: Arc<Mutex<PromptStore>>,
}

impl NativePrompts {
    pub(crate) fn new(store: Arc<Mutex<PromptStore>>) -> Self {
        Self { store }
    }

    pub async fn list(&self) -> Result<Vec<Prompt>, String> {
        self.store.lock().await.list_by_usage()
    }

    pub async fn create(&self, draft: NativePromptDraft) -> Result<Prompt, PromptError> {
        self.create_at(draft, unix_millis()).await
    }

    pub async fn create_at(
        &self,
        draft: NativePromptDraft,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        self.create_json(draft.into_map(), now).await
    }

    pub async fn update(&self, id: &str, patch: NativePromptPatch) -> Result<Prompt, PromptError> {
        self.update_at(id, patch, unix_millis()).await
    }

    pub async fn update_at(
        &self,
        id: &str,
        patch: NativePromptPatch,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        self.update_json(id, patch.into_map(), now).await
    }

    pub async fn delete(&self, id: &str) -> Result<(), PromptError> {
        self.store.lock().await.delete(id)
    }

    pub async fn increment_usage(&self, id: &str) -> Result<(), PromptError> {
        self.increment_usage_at(id, unix_millis()).await
    }

    pub async fn increment_usage_at(&self, id: &str, now: u64) -> Result<(), PromptError> {
        self.store.lock().await.increment_usage(id, now)
    }

    pub(crate) async fn create_json(
        &self,
        body: Map<String, Value>,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        self.store.lock().await.create(&body, now)
    }

    pub(crate) async fn update_json(
        &self,
        id: &str,
        body: Map<String, Value>,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        self.store.lock().await.update(id, &body, now)
    }
}

impl NativePromptDraft {
    fn into_map(self) -> Map<String, Value> {
        let mut body = Map::new();
        body.insert("name".into(), Value::String(self.name));
        body.insert("command".into(), Value::String(self.command));
        body.insert("description".into(), Value::String(self.description));
        body.insert("promptTemplate".into(), Value::String(self.prompt_template));
        if let Some(category) = self.category {
            body.insert("category".into(), Value::String(category));
        }
        body.insert(
            "tags".into(),
            Value::Array(self.tags.into_iter().map(Value::String).collect()),
        );
        body
    }
}

impl NativePromptPatch {
    fn into_map(self) -> Map<String, Value> {
        let mut body = Map::new();
        insert_optional_string(&mut body, "name", self.name);
        insert_optional_string(&mut body, "command", self.command);
        insert_optional_string(&mut body, "description", self.description);
        insert_optional_string(&mut body, "promptTemplate", self.prompt_template);
        insert_optional_string(&mut body, "category", self.category);
        if let Some(tags) = self.tags {
            body.insert(
                "tags".into(),
                Value::Array(tags.into_iter().map(Value::String).collect()),
            );
        }
        body
    }
}

fn insert_optional_string(body: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        body.insert(key.into(), Value::String(value));
    }
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use tempfile::tempdir;

    use super::*;

    fn service() -> (tempfile::TempDir, NativePrompts) {
        let root = tempdir().unwrap();
        let bundled = root.path().join("bundled.json");
        fs::write(
            &bundled,
            serde_json::to_vec(&json!([{
                "_id":"builtin-review",
                "name":"Review",
                "description":"Review changes",
                "command":"review",
                "promptTemplate":"Review this",
                "category":"code",
                "tags":["git"],
                "isBuiltIn":true,
                "executionCount":0,
                "createdAt":1,
                "updatedAt":1
            }]))
            .unwrap(),
        )
        .unwrap();
        let store = PromptStore::new(bundled, root.path().join("local.json"));
        (root, NativePrompts::new(Arc::new(Mutex::new(store))))
    }

    #[tokio::test]
    async fn typed_create_update_list_usage_and_delete_share_one_store() {
        let (_root, prompts) = service();
        let created = prompts
            .create_at(
                NativePromptDraft {
                    name: "Explain".into(),
                    command: "explain".into(),
                    description: "Explain code".into(),
                    prompt_template: "Explain {{input}}".into(),
                    category: Some("custom".into()),
                    tags: vec!["code".into(), "help".into()],
                },
                10,
            )
            .await
            .unwrap();
        assert_eq!(created.id, "custom-10");

        let updated = prompts
            .update_at(
                &created.id,
                NativePromptPatch {
                    name: Some("Explain clearly".into()),
                    tags: Some(vec!["help".into()]),
                    ..Default::default()
                },
                20,
            )
            .await
            .unwrap();
        assert_eq!(updated.name, "Explain clearly");
        assert_eq!(updated.command, "explain");
        assert_eq!(updated.tags, ["help"]);

        prompts.increment_usage_at(&created.id, 30).await.unwrap();
        let listed = prompts.list().await.unwrap();
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].execution_count, 1);
        assert_eq!(listed[0].last_used, Some(30));

        prompts.delete(&created.id).await.unwrap();
        assert_eq!(prompts.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn typed_boundary_preserves_duplicate_and_builtin_guards() {
        let (_root, prompts) = service();
        let duplicate = prompts
            .create_at(
                NativePromptDraft {
                    name: "Duplicate".into(),
                    command: "review".into(),
                    description: String::new(),
                    prompt_template: "Review".into(),
                    category: None,
                    tags: Vec::new(),
                },
                10,
            )
            .await
            .unwrap_err();
        assert_eq!(duplicate.status, 400);
        assert_eq!(duplicate.message, "Command /review already exists");

        let delete = prompts.delete("builtin-review").await.unwrap_err();
        assert_eq!(delete.status, 400);
        assert_eq!(delete.message, "Cannot delete built-in prompts");
    }
}
