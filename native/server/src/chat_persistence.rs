use std::{
    collections::HashMap,
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use inferay_core::chat_protocol::{
    ChatMessageBuffer, ChatTranscriptMessage, parse_chat_transcript,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
    sync::Mutex,
};

const CHAT_EVENTS_DIR: &str = "chat-events";
const CHAT_QUEUE_DIR: &str = "chat-queues";
const CHAT_TRANSCRIPTS_DIR: &str = "chat-transcripts";
const MAX_CHAT_EVENT_READ_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChatEventLogEntry {
    #[serde(rename = "paneId")]
    pub pane_id: String,
    pub sequence: u64,
    pub timestamp: u64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QueuedMessageInfo {
    pub id: String,
    pub text: String,
    #[serde(rename = "displayText")]
    pub display_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ChatReconnectSnapshot {
    pub sync: Value,
    pub queue: Value,
    pub status: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LocalSessionInfo {
    #[serde(rename = "paneId")]
    pub pane_id: String,
    pub title: String,
    #[serde(rename = "agentKind")]
    pub agent_kind: String,
    pub cwd: Option<String>,
    #[serde(rename = "messageCount")]
    pub message_count: usize,
    #[serde(rename = "lastMessage")]
    pub last_message: Option<String>,
    #[serde(rename = "lastRole")]
    pub last_role: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: f64,
    #[serde(rename = "inCurrentWorkspace")]
    pub in_current_workspace: bool,
}

#[derive(Clone, Debug)]
struct PaneMetadata {
    title: String,
    agent_kind: String,
    cwd: Option<String>,
}

#[derive(Clone)]
pub struct ChatPersistence {
    user_data_dir: PathBuf,
    queue_writes: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl ChatPersistence {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            user_data_dir,
            queue_writes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn read_legacy_events(&self, pane_id: &str) -> std::io::Result<Vec<ChatEventLogEntry>> {
        let path = self.event_path(pane_id);
        let mut events = Vec::new();
        if let Ok(mut file) = fs::File::open(path).await {
            let size = file.metadata().await?.len();
            let start = size.saturating_sub(MAX_CHAT_EVENT_READ_BYTES);
            file.seek(SeekFrom::Start(start)).await?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).await?;
            let mut text = String::from_utf8_lossy(&bytes).into_owned();
            if start > 0 {
                text = text
                    .find('\n')
                    .map_or_else(String::new, |index| text[index + 1..].to_string());
            }
            for line in text.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(entry) = serde_json::from_str::<ChatEventLogEntry>(line) else {
                    continue;
                };
                if entry.pane_id == pane_id {
                    events.push(entry);
                }
            }
        }
        events.sort_by_key(|entry| entry.sequence);
        events.dedup_by_key(|entry| entry.sequence);
        Ok(events)
    }

    async fn read_legacy_snapshot(&self, pane_id: &str) -> Option<Vec<ChatTranscriptMessage>> {
        let value = read_json_value(&self.transcript_path(pane_id)).await;
        value.and_then(parse_chat_transcript)
    }

    pub async fn read_legacy_transcript(
        &self,
        pane_id: &str,
    ) -> Option<Vec<ChatTranscriptMessage>> {
        if let Some(snapshot) = self.read_legacy_snapshot(pane_id).await {
            return Some(snapshot);
        }
        self.read_event_log_transcript(pane_id).await
    }

    pub async fn list_event_pane_ids(&self) -> Vec<String> {
        let mut pane_ids = Vec::new();
        if let Ok(mut entries) = fs::read_dir(self.user_data_dir.join(CHAT_EVENTS_DIR)).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let file = entry.file_name();
                let file = file.to_string_lossy();
                if let Some(pane_id) = file.strip_suffix(".jsonl") {
                    push_unique(&mut pane_ids, pane_id.to_string());
                }
            }
        }
        pane_ids
    }

    pub async fn read_queue(&self, pane_id: &str) -> Result<Vec<Value>, String> {
        let path = self.queue_path(pane_id)?;
        let Some(value) = read_json_value(&path).await else {
            return Ok(Vec::new());
        };
        Ok(value
            .get("queue")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    pub async fn save_queue(&self, pane_id: &str, queue: &[Value]) -> Result<(), String> {
        let write_lock = self.queue_write_lock(pane_id).await;
        let _guard = write_lock.lock().await;
        self.write_queue_file(pane_id, queue).await?;
        #[cfg(test)]
        self.append_event(
            pane_id,
            "queue_persisted",
            queue_event_payload("api", queue),
        )
        .await;
        Ok(())
    }

    async fn save_runtime_queue_unlocked(
        &self,
        pane_id: &str,
        queue: &[Value],
    ) -> Result<(), String> {
        if queue.is_empty() {
            self.remove_queue_file(pane_id).await?;
        } else {
            self.write_queue_file(pane_id, queue).await?;
        }
        #[cfg(test)]
        {
            self.append_event(
                pane_id,
                "queue_persisted",
                queue_event_payload("runtime", queue),
            )
            .await;
            self.append_event(pane_id, "queue_changed", json!({ "queue": queue }))
                .await;
        }
        Ok(())
    }

    pub async fn enqueue_runtime(
        &self,
        pane_id: &str,
        message: Value,
    ) -> Result<Vec<Value>, String> {
        let write_lock = self.queue_write_lock(pane_id).await;
        let _guard = write_lock.lock().await;
        let mut queue = self.read_queue(pane_id).await.unwrap_or_default();
        queue.push(message);
        self.save_runtime_queue_unlocked(pane_id, &queue).await?;
        Ok(queue)
    }

    pub async fn shift_runtime(
        &self,
        pane_id: &str,
    ) -> Result<Option<(Value, Vec<Value>)>, String> {
        let write_lock = self.queue_write_lock(pane_id).await;
        let _guard = write_lock.lock().await;
        let mut queue = self.read_queue(pane_id).await.unwrap_or_default();
        if queue.is_empty() {
            return Ok(None);
        }
        let next = queue.remove(0);
        self.save_runtime_queue_unlocked(pane_id, &queue).await?;
        Ok(Some((next, queue)))
    }

    pub async fn delete_queue(&self, pane_id: &str) -> Result<(), String> {
        let write_lock = self.queue_write_lock(pane_id).await;
        let _guard = write_lock.lock().await;
        self.remove_queue_file(pane_id).await?;
        #[cfg(test)]
        self.append_event(
            pane_id,
            "queue_persisted",
            json!({ "source": "api", "count": 0, "messageIds": [] }),
        )
        .await;
        Ok(())
    }

    async fn queue_write_lock(&self, pane_id: &str) -> Arc<Mutex<()>> {
        let mut writes = self.queue_writes.lock().await;
        writes
            .entry(pane_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    pub async fn persisted_reconnect_snapshot(&self, pane_id: &str) -> ChatReconnectSnapshot {
        let queue = self
            .read_queue(pane_id)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| serde_json::from_value::<QueuedMessageInfo>(value).ok())
            .collect::<Vec<_>>();
        let messages = self
            .read_legacy_transcript(pane_id)
            .await
            .unwrap_or_default();
        ChatReconnectSnapshot {
            sync: json!({
                "type": "chat:sync", "paneId": pane_id, "messages": messages,
                "revision": 0, "isStreaming": false
            }),
            queue: json!({ "type": "chat:queue", "paneId": pane_id, "queue": queue }),
            status: json!({
                "type": "chat:status", "paneId": pane_id,
                "status": "idle", "isLoading": false
            }),
        }
    }

    pub async fn list_local_sessions(&self, agent_state_path: &Path) -> Vec<LocalSessionInfo> {
        let metadata = read_pane_metadata(agent_state_path).await;
        let mut pane_ids = Vec::new();
        if let Ok(mut entries) = fs::read_dir(self.user_data_dir.join(CHAT_TRANSCRIPTS_DIR)).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let file = entry.file_name().to_string_lossy().into_owned();
                if let Some(pane_id) = file.strip_suffix(".json") {
                    push_unique(&mut pane_ids, pane_id.to_string());
                }
            }
        }
        for pane_id in self.list_event_pane_ids().await {
            push_unique(&mut pane_ids, pane_id);
        }
        let mut sessions = Vec::new();
        for pane_id in pane_ids {
            let Some(transcript) = self.read_legacy_transcript(&pane_id).await else {
                continue;
            };
            if transcript.is_empty() {
                continue;
            }
            let pane = metadata.get(&pane_id);
            let cwd = pane
                .and_then(|pane| pane.cwd.clone())
                .or_else(|| infer_cwd_from_messages(&transcript));
            let title = pane.map_or_else(
                || {
                    cwd.as_deref()
                        .and_then(|cwd| Path::new(cwd).file_name())
                        .map_or_else(
                            || "Archived session".to_string(),
                            |name| name.to_string_lossy().into_owned(),
                        )
                },
                |pane| pane.title.clone(),
            );
            let updated_at = file_modified_millis(&self.transcript_path(&pane_id)).await;
            let last = transcript.last();
            sessions.push(LocalSessionInfo {
                pane_id: pane_id.clone(),
                title,
                agent_kind: pane
                    .map_or("codex", |pane| pane.agent_kind.as_str())
                    .to_string(),
                cwd,
                message_count: transcript.len(),
                last_message: last.and_then(|message| {
                    let content = message.content.trim();
                    (!content.is_empty()).then(|| content.to_string())
                }),
                last_role: last.map(|message| message.role.clone()),
                updated_at,
                in_current_workspace: metadata.contains_key(&pane_id),
            });
        }
        sessions.sort_by(|left, right| right.updated_at.total_cmp(&left.updated_at));
        sessions
    }

    async fn read_event_log_transcript(&self, pane_id: &str) -> Option<Vec<ChatTranscriptMessage>> {
        let events = self.read_legacy_events(pane_id).await.ok()?;
        if events.is_empty() {
            return None;
        }
        let mut buffer = ChatMessageBuffer::default();
        let mut has_transcript_event = false;
        for event in events {
            has_transcript_event = replay_event(&mut buffer, &event) || has_transcript_event;
        }
        if !has_transcript_event {
            return None;
        }
        buffer.finalize();
        Some(buffer.into_messages())
    }

    fn event_path(&self, pane_id: &str) -> PathBuf {
        self.user_data_dir
            .join(CHAT_EVENTS_DIR)
            .join(format!("{pane_id}.jsonl"))
    }

    fn transcript_path(&self, pane_id: &str) -> PathBuf {
        self.user_data_dir
            .join(CHAT_TRANSCRIPTS_DIR)
            .join(format!("{pane_id}.json"))
    }

    fn queue_path(&self, pane_id: &str) -> Result<PathBuf, String> {
        if !pane_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        }) {
            return Err("Invalid pane id".to_string());
        }
        Ok(self
            .user_data_dir
            .join(CHAT_QUEUE_DIR)
            .join(format!("{pane_id}.json")))
    }

    async fn write_queue_file(&self, pane_id: &str, queue: &[Value]) -> Result<(), String> {
        atomic_write_json(
            &self.queue_path(pane_id)?,
            &json!({ "queue": queue, "updatedAt": now_millis() }),
        )
        .await
        .map_err(|error| error.to_string())
    }

    async fn remove_queue_file(&self, pane_id: &str) -> Result<(), String> {
        match fs::remove_file(self.queue_path(pane_id)?).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn replay_event(buffer: &mut ChatMessageBuffer, entry: &ChatEventLogEntry) -> bool {
    let payload = entry.payload.as_object();
    match entry.event_type.as_str() {
        "user_message" => {
            let text = payload
                .and_then(|payload| payload.get("displayText").and_then(Value::as_str))
                .or_else(|| payload.and_then(|payload| payload.get("text").and_then(Value::as_str)))
                .unwrap_or_default();
            let images = payload
                .and_then(|payload| payload.get("images"))
                .and_then(Value::as_array)
                .map(|images| {
                    images
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                });
            if !text.is_empty() || images.as_ref().is_some_and(|images| !images.is_empty()) {
                buffer.push_user(text, images);
                true
            } else {
                false
            }
        }
        "system_message" => payload
            .and_then(|payload| payload.get("message").and_then(Value::as_str))
            .is_some_and(|message| {
                buffer.push_system(message);
                true
            }),
        "agent_event" => {
            let revision = buffer.revision();
            buffer.apply_event(&entry.payload);
            buffer.revision() != revision
        }
        _ => false,
    }
}

#[cfg(test)]
fn queue_event_payload(source: &str, queue: &[Value]) -> Value {
    let message_ids = queue
        .iter()
        .filter_map(|item| item.as_object()?.get("id")?.as_str())
        .collect::<Vec<_>>();
    json!({ "source": source, "count": queue.len(), "messageIds": message_ids })
}

// Legacy persistence helpers exist only for compatibility fixtures. Production
// code can read old files but has no interface for creating new ones.
#[cfg(test)]
impl ChatPersistence {
    async fn append_event(&self, pane_id: &str, event_type: &str, payload: Value) -> u64 {
        let sequence = now_millis() * 1_000;
        let entry = ChatEventLogEntry {
            pane_id: pane_id.to_string(),
            sequence,
            timestamp: now_millis(),
            event_type: event_type.to_string(),
            payload,
        };
        let path = self.event_path(pane_id);
        let mut events = self.read_legacy_events(pane_id).await.unwrap_or_default();
        events.push(entry);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }
        let encoded = events
            .iter()
            .filter_map(|event| serde_json::to_string(event).ok())
            .collect::<Vec<_>>()
            .join("\n");
        let _ = fs::write(path, format!("{encoded}\n")).await;
        sequence
    }

    pub(crate) async fn read_events(
        &self,
        pane_id: &str,
        after: u64,
        limit: usize,
    ) -> std::io::Result<Vec<ChatEventLogEntry>> {
        let mut events = self.read_legacy_events(pane_id).await?;
        events.retain(|event| event.sequence > after);
        events.truncate(limit);
        Ok(events)
    }

    async fn write_transcript(
        &self,
        pane_id: &str,
        mut messages: Vec<ChatTranscriptMessage>,
    ) -> std::io::Result<()> {
        for message in &mut messages {
            if message.is_streaming == Some(true) {
                message.is_streaming = Some(false);
            }
        }
        atomic_write_json(&self.transcript_path(pane_id), &messages).await
    }

    pub(crate) async fn read_authoritative_transcript(
        &self,
        pane_id: &str,
    ) -> Option<Vec<ChatTranscriptMessage>> {
        self.read_legacy_transcript(pane_id).await
    }

    pub(crate) async fn read_transcript(
        &self,
        pane_id: &str,
    ) -> Option<Vec<ChatTranscriptMessage>> {
        self.read_legacy_snapshot(pane_id).await
    }
}

async fn read_pane_metadata(path: &Path) -> HashMap<String, PaneMetadata> {
    let Some(state) = read_json_value(path).await else {
        return HashMap::new();
    };
    let mut metadata = HashMap::new();
    let Some(groups) = state.get("groups").and_then(Value::as_array) else {
        return metadata;
    };
    for pane in groups
        .iter()
        .filter_map(|group| group.get("panes").and_then(Value::as_array))
        .flatten()
    {
        let Some(id) = pane.get("id").and_then(Value::as_str) else {
            continue;
        };
        let cwd = pane
            .get("cwd")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let title = pane
            .get("title")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .or_else(|| {
                cwd.as_deref()?
                    .pipe(Path::new)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "Archived session".to_string());
        metadata.insert(
            id.to_string(),
            PaneMetadata {
                title,
                agent_kind: if pane.get("agentKind").and_then(Value::as_str) == Some("claude") {
                    "claude".to_string()
                } else {
                    "codex".to_string()
                },
                cwd,
            },
        );
    }
    metadata
}

fn infer_cwd_from_messages(messages: &[ChatTranscriptMessage]) -> Option<String> {
    messages.iter().find_map(|message| {
        if message.role != "tool" {
            return None;
        }
        serde_json::from_str::<Value>(&message.content)
            .ok()?
            .get("cwd")?
            .as_str()
            .map(ToString::to_string)
    })
}

async fn read_json_value(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).await.ok()?).ok()
}

async fn atomic_write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> std::io::Result<()> {
    let encoded = serde_json::to_string_pretty(value)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    crate::atomic_write::overwrite(path, encoded.as_bytes())
        .await
        .map_err(std::io::Error::other)
}

async fn file_modified_millis(path: &Path) -> f64 {
    fs::metadata(path)
        .await
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |duration| duration.as_secs_f64() * 1000.0)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.contains(&value) {
        values.push(value);
    }
}

trait Pipe: Sized {
    fn pipe<T>(self, function: impl FnOnce(Self) -> T) -> T {
        function(self)
    }
}
impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn transcript_message(id: &str, role: &str, content: &str) -> ChatTranscriptMessage {
        serde_json::from_value(json!({ "id": id, "role": role, "content": content })).unwrap()
    }

    #[tokio::test]
    async fn snapshot_is_authoritative_and_events_are_only_the_fallback() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        persistence
            .append_event("pane", "user_message", json!({ "text": "event" }))
            .await;
        persistence
            .write_transcript("pane", vec![transcript_message("1", "user", "snapshot")])
            .await
            .unwrap();
        let transcript = persistence
            .read_authoritative_transcript("pane")
            .await
            .unwrap();
        assert_eq!(transcript[0].content, "snapshot");

        let fallback = persistence
            .read_authoritative_transcript("events-only")
            .await;
        assert!(fallback.is_none());
        persistence
            .append_event(
                "events-only",
                "user_message",
                json!({ "displayText": "shown", "text": "hidden" }),
            )
            .await;
        let fallback = persistence
            .read_authoritative_transcript("events-only")
            .await
            .unwrap();
        assert_eq!(fallback[0].content, "shown");
    }

    #[tokio::test]
    async fn cached_transcript_reads_are_independent_and_writes_end_streaming() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        let mut message = transcript_message("1", "assistant", "answer");
        message.is_streaming = Some(true);
        persistence
            .write_transcript("pane", vec![message])
            .await
            .unwrap();

        let mut first = persistence.read_transcript("pane").await.unwrap();
        assert_eq!(first[0].is_streaming, Some(false));
        first[0].content = "mutated by caller".into();
        let second = persistence.read_transcript("pane").await.unwrap();
        assert_eq!(second[0].content, "answer");
        assert_eq!(second[0].is_streaming, Some(false));

        assert!(persistence.transcript_path("pane").exists());
    }

    #[tokio::test]
    async fn reconnect_preserves_large_transcripts_and_queued_images() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        let messages = (0..1_200)
            .map(|index| {
                transcript_message(&index.to_string(), "user", &format!("message-{index}"))
            })
            .collect();
        persistence
            .write_transcript("pane", messages)
            .await
            .unwrap();
        persistence
            .save_queue(
                "pane",
                &[json!({
                    "id": "queued-1", "text": "inspect", "displayText": "Inspect",
                    "images": ["data:image/png;base64,abc", "/tmp/shot.png"]
                })],
            )
            .await
            .unwrap();

        let snapshot = persistence.persisted_reconnect_snapshot("pane").await;
        let synced = snapshot.sync["messages"].as_array().unwrap();
        assert_eq!(synced.len(), 1_200);
        assert_eq!(synced.first().unwrap()["content"], "message-0");
        assert_eq!(synced.last().unwrap()["content"], "message-1199");
        assert_eq!(
            snapshot.queue["queue"][0]["images"],
            json!(["data:image/png;base64,abc", "/tmp/shot.png"])
        );
    }

    #[tokio::test]
    async fn queue_format_filtering_matches_the_runtime_contract() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        persistence
            .save_queue(
                "pane:1",
                &[
                    json!({ "id": "q1", "text": "one", "displayText": "One" }),
                    json!({ "id": 2, "text": "invalid", "displayText": "invalid" }),
                ],
            )
            .await
            .unwrap();
        assert_eq!(persistence.read_queue("pane:1").await.unwrap().len(), 2);
        let snapshot = persistence.persisted_reconnect_snapshot("pane:1").await;
        assert_eq!(snapshot.queue["queue"].as_array().unwrap().len(), 1);
        assert!(persistence.read_queue("../bad").await.is_err());

        let write_lock = persistence.queue_write_lock("pane:1").await;
        let _guard = write_lock.lock().await;
        persistence
            .save_runtime_queue_unlocked("pane:1", &[])
            .await
            .unwrap();
        drop(_guard);
        assert!(persistence.read_queue("pane:1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn concurrent_runtime_queue_mutations_preserve_every_message_once() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        let mut tasks = Vec::new();
        for index in 0..40 {
            let persistence = persistence.clone();
            tasks.push(tokio::spawn(async move {
                persistence
                    .enqueue_runtime(
                        "pane",
                        json!({
                            "id": format!("q-{index}"),
                            "text": index.to_string(),
                            "displayText": index.to_string()
                        }),
                    )
                    .await
                    .unwrap();
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        let queued = persistence.read_queue("pane").await.unwrap();
        assert_eq!(queued.len(), 40);
        let mut ids = queued
            .iter()
            .filter_map(|message| message.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 40);

        let mut shifted = Vec::new();
        while let Some((message, _)) = persistence.shift_runtime("pane").await.unwrap() {
            shifted.push(message["id"].as_str().unwrap().to_string());
        }
        shifted.sort_unstable();
        shifted.dedup();
        assert_eq!(shifted.len(), 40);
        assert!(persistence.read_queue("pane").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn reads_only_complete_lines_from_the_four_megabyte_event_tail() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        let path = persistence.event_path("pane");
        fs::create_dir_all(path.parent().unwrap()).await.unwrap();
        let padding = "x".repeat(MAX_CHAT_EVENT_READ_BYTES as usize);
        let entry = json!({
            "paneId": "pane", "sequence": 2, "timestamp": 1,
            "type": "system_message", "payload": { "message": "kept" }
        });
        fs::write(&path, format!("{padding}\n{entry}\n"))
            .await
            .unwrap();
        let events = persistence.read_events("pane", 0, 500).await.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].payload["message"], "kept");
    }

    #[tokio::test]
    async fn lists_snapshot_and_event_sessions_with_pane_metadata() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        persistence
            .write_transcript(
                "known",
                vec![transcript_message("1", "assistant", " complete ")],
            )
            .await
            .unwrap();
        persistence
            .append_event(
                "event-only",
                "system_message",
                json!({ "message": "restored" }),
            )
            .await;
        let state_path = root.path().join("agent-state.json");
        fs::write(
            &state_path,
            serde_json::to_vec(&json!({ "groups": [{ "panes": [{
                "id": "known", "title": "Known", "agentKind": "claude", "cwd": "/tmp/work"
            }] }] }))
            .unwrap(),
        )
        .await
        .unwrap();
        let sessions = persistence.list_local_sessions(&state_path).await;
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].pane_id, "known");
        let known = sessions
            .iter()
            .find(|session| session.pane_id == "known")
            .unwrap();
        assert_eq!(known.title, "Known");
        assert_eq!(known.agent_kind, "claude");
        assert_eq!(known.cwd.as_deref(), Some("/tmp/work"));
        assert_eq!(known.message_count, 1);
        assert_eq!(known.last_message.as_deref(), Some("complete"));
        assert_eq!(known.last_role.as_deref(), Some("assistant"));
        assert!(known.updated_at > 0.0);
        assert!(known.in_current_workspace);
        let archived = sessions
            .iter()
            .find(|session| session.pane_id == "event-only")
            .unwrap();
        assert_eq!(archived.title, "Archived session");
        assert_eq!(archived.agent_kind, "codex");
        assert_eq!(archived.message_count, 1);
        assert_eq!(archived.last_message.as_deref(), Some("restored"));
        assert_eq!(archived.last_role.as_deref(), Some("system"));
        assert_eq!(archived.updated_at, 0.0);
        assert!(!archived.in_current_workspace);
    }

    #[tokio::test]
    async fn session_listing_deduplicates_sources_infers_cwd_and_skips_empty_or_corrupt_rows() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().to_path_buf());
        persistence
            .write_transcript(
                "both",
                vec![transcript_message(
                    "tool",
                    "tool",
                    r#"{"cwd":"/tmp/inferred-project"}"#,
                )],
            )
            .await
            .unwrap();
        persistence
            .append_event("both", "system_message", json!({ "message": "duplicate" }))
            .await;
        persistence
            .write_transcript("empty", Vec::new())
            .await
            .unwrap();
        let corrupt = persistence.transcript_path("corrupt");
        fs::write(&corrupt, b"not json").await.unwrap();

        let sessions = persistence
            .list_local_sessions(&root.path().join("missing-agent-state.json"))
            .await;
        assert_eq!(sessions.len(), 1);
        let session = &sessions[0];
        assert_eq!(session.pane_id, "both");
        assert_eq!(session.cwd.as_deref(), Some("/tmp/inferred-project"));
        assert_eq!(session.title, "inferred-project");
        assert_eq!(session.agent_kind, "codex");
        assert_eq!(session.message_count, 1);
        assert_eq!(session.last_role.as_deref(), Some("tool"));
    }
}
