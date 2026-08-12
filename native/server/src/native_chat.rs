use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value};
use tokio::sync::Mutex as AsyncMutex;

const DEFAULT_SETTINGS_KEY: &str = "inferay-default-chat-settings";
const CLAUDE_MODELS: &[&str] = &[
    "claude-fable-5",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
];
const CODEX_MODELS: &[&str] = &[
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2",
    "gpt-5.1-codex-mini",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChatAgentKind {
    Claude,
    Codex,
}

impl ChatAgentKind {
    fn parse(value: Option<&str>) -> Option<Self> {
        match value {
            Some("claude") => Some(Self::Claude),
            Some("codex") => Some(Self::Codex),
            _ => None,
        }
    }

    const fn default_model(self) -> &'static str {
        match self {
            Self::Claude => "claude-opus-4-7",
            Self::Codex => "gpt-5.6-sol",
        }
    }

    const fn models(self) -> &'static [&'static str] {
        match self {
            Self::Claude => CLAUDE_MODELS,
            Self::Codex => CODEX_MODELS,
        }
    }
}

#[derive(Clone)]
pub struct NativeChatHandoff {
    client_storage_path: PathBuf,
    storage_write: Arc<AsyncMutex<()>>,
}

impl NativeChatHandoff {
    pub(crate) fn with_storage(user_data_dir: PathBuf, storage_write: Arc<AsyncMutex<()>>) -> Self {
        Self {
            client_storage_path: user_data_dir.join("client-storage.json"),
            storage_write,
        }
    }

    pub(crate) async fn workspace_action_with_defaults(&self, mut action: Value) -> Value {
        if action.get("type").and_then(Value::as_str) == Some("ensureChatPane")
            && action.get("defaultAgentKind").is_none()
            && let Some(object) = action.as_object_mut()
        {
            object.insert(
                "defaultAgentKind".into(),
                Value::String(self.default_agent_kind().await.into()),
            );
        }
        action
    }

    async fn default_agent_kind(&self) -> &'static str {
        let _guard = self.storage_write.lock().await;
        let entries = read_json_object(&self.client_storage_path).await;
        entries
            .get(DEFAULT_SETTINGS_KEY)
            .and_then(Value::as_str)
            .and_then(|value| serde_json::from_str::<Value>(value).ok())
            .and_then(|value| {
                value
                    .get("agentKind")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .filter(|kind| matches!(kind.as_str(), "claude" | "codex"))
            .map_or(
                "codex",
                |kind| if kind == "claude" { "claude" } else { "codex" },
            )
    }
}

pub(crate) fn resolve_agent_model(agent_kind: &str, requested: Option<&str>) -> Option<String> {
    let kind = ChatAgentKind::parse(Some(agent_kind)).unwrap_or(ChatAgentKind::Claude);
    requested
        .filter(|model| kind.models().contains(model))
        .unwrap_or_else(|| kind.default_model())
        .to_string()
        .into()
}

async fn read_json_object(path: &Path) -> Map<String, Value> {
    let Ok(bytes) = tokio::fs::read(path).await else {
        return Map::new();
    };
    serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}
