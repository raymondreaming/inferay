//! Typed, transport-free agent-context access for native clients.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use inferay_core::agent_context::{
    AgentContextLayer, AgentContextStore, AgentContextUpdate, EffectiveAgentContext,
};
use inferay_core::prompts::PromptStore;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeAgentContextScope {
    Global,
    Project,
    Chat,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NativeAgentContextMode {
    #[default]
    Inherit,
    Replace,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NativeAgentContextQuery {
    pub cwd: Option<String>,
    pub pane_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeAgentContextUpdate {
    pub scope: NativeAgentContextScope,
    pub cwd: Option<String>,
    pub pane_id: Option<String>,
    pub instructions: String,
    pub mode: Option<NativeAgentContextMode>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAgentContextLayer {
    pub instructions: String,
    pub mode: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeActivatedSkill {
    pub name: String,
    pub command: String,
    pub instructions: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEffectiveAgentContext {
    pub global: NativeAgentContextLayer,
    pub project: Option<NativeAgentContextLayer>,
    pub chat: Option<NativeAgentContextLayer>,
    pub effective_instructions: String,
    pub scope: String,
    pub skill_count: usize,
    pub skill_manifest: String,
    pub activated_skills: Vec<NativeActivatedSkill>,
}

#[derive(Clone)]
pub struct NativeAgentContext {
    store: Arc<Mutex<AgentContextStore>>,
    prompts: Arc<Mutex<PromptStore>>,
}

impl NativeAgentContext {
    pub(crate) fn new(
        store: Arc<Mutex<AgentContextStore>>,
        prompts: Arc<Mutex<PromptStore>>,
    ) -> Self {
        Self { store, prompts }
    }

    /// Loads the persisted layers and current skill manifest, like GET /api/agent-context.
    pub async fn load(
        &self,
        query: &NativeAgentContextQuery,
    ) -> Result<NativeEffectiveAgentContext, String> {
        self.resolve(query, None).await
    }

    /// Resolves effective instructions and optionally activates skills for agent input.
    pub async fn resolve(
        &self,
        query: &NativeAgentContextQuery,
        agent_input: Option<&str>,
    ) -> Result<NativeEffectiveAgentContext, String> {
        // Match the HTTP route's ordering: prompt loading can fail before context resolution.
        let skills = self.prompts.lock().await.load()?;
        let store = self.store.lock().await;
        let context = match agent_input {
            Some(input) => store.resolve_for_agent(
                query.cwd.as_deref(),
                query.pane_id.as_deref(),
                input,
                &skills,
            ),
            None => store.resolve(query.cwd.as_deref(), query.pane_id.as_deref(), &skills),
        };
        Ok(context.into())
    }

    /// Persists an update and reloads the effective context, matching save-then-reload in Octane.
    pub async fn update(
        &self,
        update: NativeAgentContextUpdate,
    ) -> Result<NativeEffectiveAgentContext, String> {
        self.update_at(update, unix_millis()).await
    }

    pub async fn reset(
        &self,
        scope: NativeAgentContextScope,
        query: NativeAgentContextQuery,
    ) -> Result<NativeEffectiveAgentContext, String> {
        self.update(NativeAgentContextUpdate {
            scope,
            cwd: query.cwd,
            pane_id: query.pane_id,
            instructions: String::new(),
            mode: Some(NativeAgentContextMode::Inherit),
        })
        .await
    }

    pub(crate) async fn update_at(
        &self,
        update: NativeAgentContextUpdate,
        now: u64,
    ) -> Result<NativeEffectiveAgentContext, String> {
        let query = NativeAgentContextQuery {
            cwd: update.cwd.clone(),
            pane_id: update.pane_id.clone(),
        };
        self.store.lock().await.update(update.into(), now)?;
        self.load(&query).await
    }

    pub(crate) async fn update_raw(
        &self,
        scope: String,
        cwd: Option<String>,
        pane_id: Option<String>,
        instructions: String,
        mode: Option<String>,
        now: u64,
    ) -> Result<(), String> {
        self.store.lock().await.update(
            AgentContextUpdate {
                scope,
                cwd,
                pane_id,
                instructions,
                mode,
            },
            now,
        )
    }
}

impl From<NativeAgentContextUpdate> for AgentContextUpdate {
    fn from(value: NativeAgentContextUpdate) -> Self {
        Self {
            scope: value.scope.as_str().into(),
            cwd: value.cwd,
            pane_id: value.pane_id,
            instructions: value.instructions,
            mode: value.mode.map(|mode| mode.as_str().into()),
        }
    }
}

impl NativeAgentContextScope {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Project => "project",
            Self::Chat => "chat",
        }
    }
}

impl NativeAgentContextMode {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Inherit => "inherit",
            Self::Replace => "replace",
        }
    }
}

impl From<AgentContextLayer> for NativeAgentContextLayer {
    fn from(value: AgentContextLayer) -> Self {
        Self {
            instructions: value.instructions,
            mode: value.mode,
            updated_at: value.updated_at,
        }
    }
}

impl From<EffectiveAgentContext> for NativeEffectiveAgentContext {
    fn from(value: EffectiveAgentContext) -> Self {
        Self {
            global: value.global.into(),
            project: value.project.map(Into::into),
            chat: value.chat.map(Into::into),
            effective_instructions: value.effective_instructions,
            scope: value.scope,
            skill_count: value.skill_count,
            skill_manifest: value.skill_manifest,
            activated_skills: value
                .activated_skills
                .into_iter()
                .filter_map(activated_skill)
                .collect(),
        }
    }
}

fn activated_skill(value: Value) -> Option<NativeActivatedSkill> {
    Some(NativeActivatedSkill {
        name: value.get("name")?.as_str()?.to_owned(),
        command: value.get("command")?.as_str()?.to_owned(),
        instructions: value.get("instructions")?.as_str()?.to_owned(),
    })
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
    use tempfile::{TempDir, tempdir};

    use super::*;

    fn service() -> (TempDir, NativeAgentContext) {
        let root = tempdir().unwrap();
        let bundled = root.path().join("bundled.json");
        fs::write(
            &bundled,
            serde_json::to_vec(&json!([{
                "_id": "builtin-review",
                "name": "Code Review",
                "description": "Review changes",
                "command": "review",
                "promptTemplate": "Inspect carefully",
                "category": "code",
                "tags": ["quality"],
                "isBuiltIn": true,
                "executionCount": 0,
                "createdAt": 1,
                "updatedAt": 1
            }]))
            .unwrap(),
        )
        .unwrap();
        let context = Arc::new(Mutex::new(AgentContextStore::new(
            root.path().join("agent-context.json"),
        )));
        let prompts = Arc::new(Mutex::new(PromptStore::new(
            bundled,
            root.path().join("prompts.json"),
        )));
        (root, NativeAgentContext::new(context, prompts))
    }

    fn update(
        scope: NativeAgentContextScope,
        cwd: Option<String>,
        pane_id: Option<String>,
        instructions: &str,
        mode: NativeAgentContextMode,
    ) -> NativeAgentContextUpdate {
        NativeAgentContextUpdate {
            scope,
            cwd,
            pane_id,
            instructions: instructions.into(),
            mode: Some(mode),
        }
    }

    #[tokio::test]
    async fn update_load_and_reset_preserve_layer_composition() {
        let (root, service) = service();
        let cwd = root.path().join("project").to_string_lossy().into_owned();
        let pane_id = "pane-1".to_string();
        service
            .update_at(
                update(
                    NativeAgentContextScope::Global,
                    None,
                    None,
                    " global ",
                    NativeAgentContextMode::Inherit,
                ),
                10,
            )
            .await
            .unwrap();
        service
            .update_at(
                update(
                    NativeAgentContextScope::Project,
                    Some(cwd.clone()),
                    None,
                    "project",
                    NativeAgentContextMode::Inherit,
                ),
                20,
            )
            .await
            .unwrap();
        let resolved = service
            .update_at(
                update(
                    NativeAgentContextScope::Chat,
                    Some(cwd.clone()),
                    Some(pane_id.clone()),
                    "chat",
                    NativeAgentContextMode::Replace,
                ),
                30,
            )
            .await
            .unwrap();
        assert_eq!(resolved.effective_instructions, "chat");
        assert_eq!(resolved.scope, "chat");
        assert_eq!(resolved.chat.unwrap().updated_at, 30);

        let reset = service
            .reset(
                NativeAgentContextScope::Chat,
                NativeAgentContextQuery {
                    cwd: Some(cwd),
                    pane_id: Some(pane_id),
                },
            )
            .await
            .unwrap();
        assert!(reset.chat.is_none());
        assert_eq!(reset.scope, "project");
        assert_eq!(reset.effective_instructions, "global\n\nproject");
    }

    #[tokio::test]
    async fn resolve_returns_typed_skills_with_existing_activation_rules() {
        let (_root, service) = service();
        let resolved = service
            .resolve(
                &NativeAgentContextQuery::default(),
                Some("please /review this"),
            )
            .await
            .unwrap();
        assert_eq!(resolved.skill_count, 1);
        assert!(resolved.skill_manifest.contains("/review"));
        assert_eq!(
            resolved.activated_skills,
            [NativeActivatedSkill {
                name: "Code Review".into(),
                command: "review".into(),
                instructions: "Inspect carefully".into(),
            }]
        );
    }

    #[tokio::test]
    async fn missing_scope_identity_keeps_core_validation_semantics() {
        let (_root, service) = service();
        let project_error = service
            .update_at(
                update(
                    NativeAgentContextScope::Project,
                    None,
                    None,
                    "project",
                    NativeAgentContextMode::Inherit,
                ),
                1,
            )
            .await
            .unwrap_err();
        assert_eq!(project_error, "A project directory is required");

        let chat_error = service
            .reset(
                NativeAgentContextScope::Chat,
                NativeAgentContextQuery::default(),
            )
            .await
            .unwrap_err();
        assert_eq!(chat_error, "A chat pane is required");
    }
}
