use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use inferay_core::agent_command::{AgentCommandResolver, AgentKind};
use inferay_core::agent_protocol::{build_claude_invocation_args, truncate_agent_result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;
use tokio::sync::Mutex;

const CLAUDE_HAIKU_MODEL: &str = "claude-haiku-4-5";
const DEFAULT_TIMEOUT_MS: u64 = 120_000;

/// The stable envelope of `automations.json`.
///
/// Flow internals intentionally remain untyped: they are persisted client data and
/// must round-trip fields unknown to this version of the native server.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AutomationStore {
    pub flows: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunAutomationError {
    MissingPrompt,
}

#[derive(Clone)]
pub struct AutomationService {
    path: PathBuf,
    write_lock: Arc<Mutex<()>>,
    agent_command_resolver: Arc<AgentCommandResolver>,
    owner: tokio::runtime::Handle,
}

impl AutomationService {
    pub fn new(
        path: impl Into<PathBuf>,
        agent_command_resolver: Arc<AgentCommandResolver>,
    ) -> Self {
        Self {
            path: path.into(),
            write_lock: Arc::new(Mutex::new(())),
            agent_command_resolver,
            owner: tokio::runtime::Handle::current(),
        }
    }

    pub async fn load(&self) -> Result<AutomationStore, String> {
        let path = self.path.clone();
        self.owner
            .spawn(async move { load_store(&path).await })
            .await
            .map_err(|error| format!("automation runtime stopped: {error}"))?
    }

    pub async fn save(&self, value: &Value) -> Result<AutomationStore, String> {
        let path = self.path.clone();
        let write_lock = self.write_lock.clone();
        let value = value.clone();
        self.owner
            .spawn(async move {
                let store = normalize_store(&value)?;
                let _write_guard = write_lock.lock().await;
                atomic_write_pretty_json(&path, &store).await?;
                Ok(store)
            })
            .await
            .map_err(|error| format!("automation runtime stopped: {error}"))?
    }

    /// Runs the compatibility request used by `/api/automations/run`.
    ///
    /// `Ok(None)` covers both a non-string prompt/cwd (matching the previous
    /// JavaScript behavior) and a process that produced no usable result.
    pub async fn run_once(&self, request: &Value) -> Result<Option<String>, RunAutomationError> {
        let prompt_value = request.get("prompt").unwrap_or(&Value::Null);
        if !javascript_truthy(prompt_value) {
            return Err(RunAutomationError::MissingPrompt);
        }
        let Some(prompt) = prompt_value.as_str() else {
            return Ok(None);
        };
        let cwd = match request.get("cwd").filter(|value| javascript_truthy(value)) {
            Some(Value::String(cwd)) => PathBuf::from(cwd),
            Some(_) => return Ok(None),
            None => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        };
        let timeout_ms = request
            .get("timeoutMs")
            .filter(|value| !value.is_null())
            .and_then(javascript_timeout)
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let prompt = prompt.to_owned();
        let resolver = self.agent_command_resolver.clone();
        Ok(self
            .owner
            .spawn(async move { run_claude_once(resolver, &prompt, &cwd, timeout_ms).await })
            .await
            .ok()
            .flatten())
    }
}

async fn load_store(path: &Path) -> Result<AutomationStore, String> {
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AutomationStore::default());
        }
        Err(error) => return Err(error.to_string()),
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    normalize_store(&value)
}

async fn run_claude_once(
    agent_command_resolver: Arc<AgentCommandResolver>,
    prompt: &str,
    cwd: &Path,
    timeout_ms: u64,
) -> Option<String> {
    let binary = agent_command_resolver.resolve_agent_binary(AgentKind::Claude);
    let arguments = build_claude_invocation_args(&binary, prompt, Some(CLAUDE_HAIKU_MODEL), None);
    let mut command = Command::new(&arguments[0]);
    command
        .args(&arguments[1..])
        .current_dir(cwd)
        .envs(agent_command_resolver.create_agent_env(AgentKind::Claude))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_millis(timeout_ms), command.output())
        .await
        .ok()?
        .ok()?;
    extract_one_shot_output(&String::from_utf8_lossy(&output.stdout))
}

fn normalize_store(value: &Value) -> Result<AutomationStore, String> {
    if value.is_null() {
        return Err("Cannot read properties of null (reading 'flows')".into());
    }
    Ok(AutomationStore {
        flows: value
            .get("flows")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}

async fn atomic_write_pretty_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "automation path has no parent directory".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    crate::atomic_write::overwrite(path, &bytes).await
}

pub(crate) fn extract_one_shot_output(stdout: &str) -> Option<String> {
    let mut last_assistant_message = String::new();
    let mut result_text = String::new();
    let mut streamed_text = String::new();
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("result") => {
                if let Some(result) = event.get("result").and_then(Value::as_str) {
                    last_assistant_message = truncate_agent_result(result);
                    result_text = result.to_string();
                }
            }
            Some("content_block_start") => append_streamed_text(
                &mut streamed_text,
                event.get("content_block"),
                "text",
                "text",
            ),
            Some("content_block_delta") => {
                append_streamed_text(&mut streamed_text, event.get("delta"), "text_delta", "text")
            }
            _ => {}
        }
    }
    let text = if !last_assistant_message.is_empty() {
        last_assistant_message
    } else if !result_text.is_empty() {
        result_text
    } else {
        streamed_text
    };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn append_streamed_text(
    output: &mut String,
    container: Option<&Value>,
    expected_type: &str,
    text_key: &str,
) {
    if container
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        == Some(expected_type)
        && let Some(text) = container
            .and_then(|value| value.get(text_key))
            .and_then(Value::as_str)
        && !text.is_empty()
    {
        output.push_str(text);
    }
}

fn javascript_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn javascript_timeout(value: &Value) -> Option<u64> {
    let value = value.as_f64()?;
    if !value.is_finite() || value <= 0.0 {
        return Some(0);
    }
    Some(value.trunc().min(u64::MAX as f64) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn service(root: &TempDir) -> AutomationService {
        AutomationService::new(
            root.path().join("nested/automations.json"),
            Arc::new(AgentCommandResolver::new(root.path())),
        )
    }

    #[tokio::test]
    async fn load_save_normalize_and_preserve_flow_internals() {
        let root = TempDir::new().unwrap();
        let service = service(&root);
        assert_eq!(service.load().await.unwrap(), AutomationStore::default());

        let input = json!({
            "flows": [{ "id": "one", "futureField": { "anything": [1, true] } }],
            "ignoredEnvelopeField": true
        });
        let saved = service.save(&input).await.unwrap();
        assert_eq!(saved.flows, input["flows"].as_array().unwrap().clone());
        assert_eq!(service.load().await.unwrap(), saved);

        let persisted: Value = serde_json::from_slice(
            &tokio::fs::read(root.path().join("nested/automations.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(persisted, json!({ "flows": input["flows"] }));
    }

    #[tokio::test]
    async fn malformed_and_legacy_store_shapes_match_the_route_contract() {
        let root = TempDir::new().unwrap();
        let service = service(&root);
        let path = root.path().join("nested/automations.json");
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();

        for value in [json!({}), json!({ "flows": "not-an-array" }), json!([])] {
            tokio::fs::write(&path, serde_json::to_vec(&value).unwrap())
                .await
                .unwrap();
            assert_eq!(service.load().await.unwrap(), AutomationStore::default());
        }

        tokio::fs::write(&path, b"null").await.unwrap();
        assert_eq!(
            service.load().await.unwrap_err(),
            "Cannot read properties of null (reading 'flows')"
        );
        tokio::fs::write(&path, b"{not json").await.unwrap();
        assert!(service.load().await.is_err());
    }

    #[tokio::test]
    async fn cloned_services_serialize_concurrent_atomic_writes() {
        let root = TempDir::new().unwrap();
        let service = service(&root);
        let first = json!({ "flows": [{ "id": "first" }] });
        let second = json!({ "flows": [{ "id": "second" }] });
        let first_task = {
            let service = service.clone();
            let first = first.clone();
            tokio::spawn(async move { service.save(&first).await.unwrap() })
        };
        let second_task = {
            let service = service.clone();
            let second = second.clone();
            tokio::spawn(async move { service.save(&second).await.unwrap() })
        };
        let first_saved = first_task.await.unwrap();
        let second_saved = second_task.await.unwrap();
        let loaded = service.load().await.unwrap();
        assert!(loaded == first_saved || loaded == second_saved);

        let directory = root.path().join("nested");
        let mut entries = tokio::fs::read_dir(directory).await.unwrap();
        let mut names = Vec::new();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
        assert_eq!(names, ["automations.json"]);
    }

    #[test]
    fn ndjson_result_wins_and_fallback_stream_chunks_are_appended_once() {
        let stdout = concat!(
            "{\"type\":\"content_block_start\",\"content_block\":{\"type\":\"text\",\"text\":\"a\"}}\n",
            "not json\n",
            "{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"b\"}}\n",
            "{\"type\":\"result\",\"result\":\" final \"}\n"
        );
        assert_eq!(extract_one_shot_output(stdout).as_deref(), Some("final"));
        assert_eq!(
            extract_one_shot_output(
                "{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ab\"}}\n"
            )
            .as_deref(),
            Some("ab")
        );
    }

    #[tokio::test]
    async fn run_request_preserves_compatibility_validation() {
        let root = TempDir::new().unwrap();
        let service = service(&root);
        assert_eq!(
            service.run_once(&json!({})).await,
            Err(RunAutomationError::MissingPrompt)
        );
        assert_eq!(service.run_once(&json!({ "prompt": {} })).await, Ok(None));
        assert_eq!(
            service
                .run_once(&json!({ "prompt": "hello", "cwd": {} }))
                .await,
            Ok(None)
        );
    }
}
