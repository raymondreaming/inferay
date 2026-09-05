use std::{
    collections::{HashMap, HashSet, VecDeque},
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
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::Mutex,
};

const CHAT_EVENTS_DIR: &str = "chat-events";
const CHAT_QUEUE_DIR: &str = "chat-queues";
const CHAT_TRANSCRIPTS_DIR: &str = "chat-transcripts";
const CHAT_UPDATE_JOURNALS_DIR: &str = "chat-transcript-updates";
const MAX_JOURNAL_RECORD_BYTES: usize = 32 * 1024 * 1024;
const COMPACT_JOURNAL_BYTES: u64 = 8 * 1024 * 1024;
const COMPACT_JOURNAL_RECORDS: usize = 512;

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionReference {
    pub provider: String,
    pub session_id: String,
    pub cwd: PathBuf,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_level: Option<String>,
}

#[derive(Clone)]
pub struct ChatPersistence {
    user_data_dir: PathBuf,
    queue_writes: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    transcript_writes: Arc<Mutex<JournalCache>>,
}

impl ChatPersistence {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            user_data_dir,
            queue_writes: Arc::new(Mutex::new(HashMap::new())),
            transcript_writes: Arc::new(Mutex::new(JournalCache::default())),
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
        if self.journal_path(pane_id).is_err() {
            return None;
        }
        let lock = self.transcript_write_lock(pane_id).await;
        let mut state = lock.lock().await;
        match self.load_journal(pane_id, &mut state).await {
            Ok(()) if state.records > 0 => {
                let mut messages = state.messages.clone();
                for message in &mut messages {
                    message.is_streaming = Some(false);
                }
                return Some(messages);
            }
            Err(error) => eprintln!("Failed to restore chat journal for {pane_id}: {error}"),
            _ => {}
        }
        if let Some(snapshot) = self.read_legacy_snapshot(pane_id).await {
            return Some(snapshot);
        }
        self.read_event_log_transcript(pane_id).await
    }

    pub async fn save_session_reference(
        &self,
        pane_id: &str,
        provider: &str,
        session_id: &str,
        cwd: &Path,
        configuration: (Option<&str>, Option<&str>),
    ) -> Result<(), String> {
        self.journal_path(pane_id)?;
        if provider.trim().is_empty() || session_id.trim().is_empty() {
            return Err("Missing provider session reference".into());
        }
        let lock = self.transcript_write_lock(pane_id).await;
        let _guard = lock.lock().await;
        let path = self
            .user_data_dir
            .join("chat-sessions")
            .join(format!("{pane_id}.json"));
        fs::create_dir_all(path.parent().ok_or("Invalid session path")?)
            .await
            .map_err(|e| e.to_string())?;
        let value = ChatSessionReference {
            provider: provider.into(),
            session_id: session_id.into(),
            cwd: cwd.into(),
            model: configuration.0.map(str::to_owned),
            reasoning_level: configuration.1.map(str::to_owned),
        };
        let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        durable_replace(&path, &bytes)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn read_session_reference(&self, pane_id: &str) -> Option<ChatSessionReference> {
        self.journal_path(pane_id).ok()?;
        let path = self
            .user_data_dir
            .join("chat-sessions")
            .join(format!("{pane_id}.json"));
        let value: ChatSessionReference =
            serde_json::from_value(read_json_value(&path).await?).ok()?;
        (!value.provider.trim().is_empty() && !value.session_id.trim().is_empty()).then_some(value)
    }

    async fn transcript_write_lock(&self, pane_id: &str) -> Arc<Mutex<JournalState>> {
        let mut cache = self.transcript_writes.lock().await;
        if let Some(index) = cache.order.iter().position(|key| key == pane_id) {
            cache.order.remove(index);
        }
        cache.order.push_back(pane_id.into());
        let existing = cache.entries.get(pane_id).cloned();
        let limit = if existing.is_some() { 16 } else { 15 };
        while cache.entries.len() > limit {
            let Some(index) = cache.order.iter().position(|key| {
                cache
                    .entries
                    .get(key)
                    .is_some_and(|entry| Arc::strong_count(entry) == 1)
            }) else {
                break;
            };
            if let Some(key) = cache.order.remove(index) {
                cache.entries.remove(&key);
            }
        }
        if let Some(state) = existing {
            return state;
        }
        let state = Arc::new(Mutex::new(JournalState::default()));
        cache.entries.insert(pane_id.into(), state.clone());
        state
    }

    fn journal_path(&self, pane_id: &str) -> Result<PathBuf, String> {
        if pane_id.is_empty()
            || !pane_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
        {
            return Err("Invalid pane id".into());
        }
        Ok(self
            .user_data_dir
            .join(CHAT_UPDATE_JOURNALS_DIR)
            .join(format!("{pane_id}.jsonl")))
    }

    async fn load_journal(&self, pane_id: &str, state: &mut JournalState) -> Result<(), String> {
        if state.loaded {
            return Ok(());
        }
        let path = self.journal_path(pane_id)?;
        let mut restored = JournalState::default();
        match fs::File::open(&path).await {
            Ok(mut file) => {
                let mut pending = Vec::new();
                let mut chunk = vec![0_u8; 64 * 1024];
                loop {
                    let count = file.read(&mut chunk).await.map_err(|e| e.to_string())?;
                    if count == 0 {
                        break;
                    }
                    let mut start = 0;
                    for (index, byte) in chunk[..count].iter().enumerate() {
                        if *byte != b'\n' {
                            continue;
                        }
                        pending.extend_from_slice(&chunk[start..index]);
                        if pending.len() > MAX_JOURNAL_RECORD_BYTES {
                            return Err("Chat journal record exceeds safety limit".into());
                        }
                        let update: Value = serde_json::from_slice(&pending)
                            .map_err(|e| format!("Invalid complete chat journal record: {e}"))?;
                        if let Some(change) = restored.prepare(&update)? {
                            restored.apply(change);
                        }
                        if let Some(retired) = update.get("retiredEpochs") {
                            for epoch in retired
                                .as_array()
                                .ok_or("Invalid retired transcript epochs")?
                            {
                                restored.retired_epochs.insert(
                                    epoch
                                        .as_str()
                                        .ok_or("Invalid retired transcript epoch")?
                                        .into(),
                                );
                            }
                        }
                        restored.bytes += pending.len() as u64 + 1;
                        if restored.records == 0 {
                            restored.checkpoint_bytes = restored.bytes;
                        }
                        restored.records += 1;
                        pending.clear();
                        start = index + 1;
                    }
                    pending.extend_from_slice(&chunk[start..count]);
                    if pending.len() > MAX_JOURNAL_RECORD_BYTES {
                        return Err("Chat journal record exceeds safety limit".into());
                    }
                }
                // Only an unterminated final record can be discarded. The next
                // write truncates this interrupted tail before appending a record.
                restored.partial_tail = !pending.is_empty();
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        if restored.records == 0 {
            restored.messages = match self.read_legacy_snapshot(pane_id).await {
                Some(messages) => messages,
                None => self
                    .read_event_log_transcript(pane_id)
                    .await
                    .unwrap_or_default(),
            };
        }
        restored.loaded = true;
        *state = restored;
        Ok(())
    }

    /// Durably commit the same suffix update that is about to reach clients.
    /// Token updates append only their delta; bounded journal compaction writes
    /// a complete reset checkpoint occasionally, never once per token.
    pub async fn persist_update(&self, pane_id: &str, update: &Value) -> Result<(), String> {
        let path = self.journal_path(pane_id)?;
        let lock = self.transcript_write_lock(pane_id).await;
        let mut state = lock.lock().await;
        self.load_journal(pane_id, &mut state).await?;
        let Some(change) = state.prepare(update)? else {
            return Ok(());
        };
        let mut encoded = serde_json::to_vec(update).map_err(|e| e.to_string())?;
        if encoded.len() > MAX_JOURNAL_RECORD_BYTES {
            return Err("Chat journal record exceeds safety limit".into());
        }
        encoded.push(b'\n');
        let parent = path.parent().ok_or("Invalid journal path")?;
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
        let result = async {
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .write(true)
                .open(&path)
                .await?;
            if state.partial_tail {
                file.set_len(state.bytes).await?;
            }
            file.write_all(&encoded).await?;
            file.sync_all().await?;
            if state.records == 0 {
                sync_directory(parent).await?;
                if let Some(grandparent) = parent.parent() {
                    sync_directory(grandparent).await?;
                }
            }
            Ok::<_, std::io::Error>(())
        }
        .await;
        if let Err(error) = result {
            state.loaded = false;
            return Err(error.to_string());
        }
        state.apply(change);
        state.bytes += encoded.len() as u64;
        if state.records == 0 {
            state.checkpoint_bytes = state.bytes;
        }
        state.records += 1;
        state.partial_tail = false;
        if state.bytes.saturating_sub(state.checkpoint_bytes) >= COMPACT_JOURNAL_BYTES
            || state.records >= COMPACT_JOURNAL_RECORDS
        {
            let checkpoint = json!({"version":1,"epoch":state.epoch,"retiredEpochs":state.retired_epochs,"baseRevision":0,"revision":state.revision,"reset":true,"start":0,"deleteCount":0,"messages":state.messages.iter().map(|message| json!({"message":message})).collect::<Vec<_>>()});
            let mut bytes = serde_json::to_vec(&checkpoint).map_err(|e| e.to_string())?;
            if bytes.len() <= MAX_JOURNAL_RECORD_BYTES {
                bytes.push(b'\n');
                // Failure leaves the already durable append authoritative.
                match durable_replace(&path, &bytes).await {
                    Ok(()) => {
                        state.bytes = bytes.len() as u64;
                        state.checkpoint_bytes = state.bytes;
                        state.records = 1;
                    }
                    Err(error) => {
                        state.loaded = false;
                        eprintln!("Could not compact chat journal for {pane_id}: {error}");
                    }
                }
            }
        }
        Ok(())
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

    /// Mutate only a queued item under the same lock used by enqueue and drain.
    /// A late edit never recreates an item already consumed by the runtime.
    pub async fn mutate_queue_item(
        &self,
        pane_id: &str,
        id: &str,
        text: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        let write_lock = self.queue_write_lock(pane_id).await;
        let _guard = write_lock.lock().await;
        let mut queue = self.read_queue(pane_id).await?;
        if let Some(index) = queue
            .iter()
            .position(|item| item.get("id").and_then(Value::as_str) == Some(id))
        {
            if let Some(text) = text {
                let text = text.trim();
                if text.is_empty() {
                    return Err("Queued message cannot be empty".into());
                }
                queue[index]["text"] = json!(text);
                queue[index]["displayText"] = json!(text);
            } else {
                queue.remove(index);
            }
            self.save_runtime_queue_unlocked(pane_id, &queue).await?;
        }
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

#[derive(Default)]
struct JournalCache {
    entries: HashMap<String, Arc<Mutex<JournalState>>>,
    order: VecDeque<String>,
}

#[derive(Default)]
struct JournalState {
    loaded: bool,
    epoch: Option<String>,
    revision: u64,
    messages: Vec<ChatTranscriptMessage>,
    bytes: u64,
    checkpoint_bytes: u64,
    retired_epochs: HashSet<String>,
    records: usize,
    partial_tail: bool,
}
struct JournalChange {
    epoch: String,
    revision: u64,
    start: usize,
    delete: usize,
    messages: Vec<ChatTranscriptMessage>,
}
impl JournalState {
    fn prepare(&self, update: &Value) -> Result<Option<JournalChange>, String> {
        let integer = |key: &str| {
            update
                .get(key)
                .and_then(Value::as_u64)
                .ok_or_else(|| format!("Invalid transcript {key}"))
        };
        if integer("version")? != 1 {
            return Err("Unsupported transcript version".into());
        }
        let epoch = update
            .get("epoch")
            .and_then(Value::as_str)
            .filter(|e| !e.is_empty())
            .ok_or("Missing transcript epoch")?;
        if self.retired_epochs.contains(epoch) {
            return Err("Transcript update belongs to a retired epoch".into());
        }
        let revision = integer("revision")?;
        let base = integer("baseRevision")?;
        let reset = update
            .get("reset")
            .and_then(Value::as_bool)
            .ok_or("Invalid transcript reset")?;
        let changes = update
            .get("messages")
            .and_then(Value::as_array)
            .ok_or("Invalid transcript messages")?;
        if reset && changes.is_empty() && !self.messages.is_empty() {
            return Ok(None);
        }
        if self.epoch.as_deref() == Some(epoch) && revision <= self.revision {
            return Ok(None);
        }
        if !reset && (self.epoch.as_deref() != Some(epoch) || base != self.revision) {
            return Err("Transcript update has an epoch or revision gap".into());
        }
        if revision <= base {
            return Err("Transcript revision did not advance".into());
        }
        let raw_start =
            usize::try_from(integer("start")?).map_err(|_| "Transcript start is too large")?;
        let raw_delete = usize::try_from(integer("deleteCount")?)
            .map_err(|_| "Transcript delete count is too large")?;
        let (start, delete) = if reset {
            if raw_start != 0 {
                return Err("Transcript reset must start at zero".into());
            }
            (0, self.messages.len())
        } else {
            (raw_start, raw_delete)
        };
        if start > self.messages.len() || delete > self.messages.len() - start {
            return Err("Transcript splice is outside retained messages".into());
        }
        let mut messages = Vec::with_capacity(changes.len());
        for (offset, change) in changes.iter().enumerate() {
            let mut message = change
                .get("message")
                .and_then(Value::as_object)
                .cloned()
                .ok_or("Invalid transcript message")?;
            let id = message
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .ok_or("Missing transcript message id")?;
            let previous = if reset {
                None
            } else {
                self.messages.get(start + offset).filter(|old| old.id == id)
            };
            let content = if let Some(append) = change.get("appendContent") {
                if message.contains_key("content") {
                    return Err("Transcript patch includes both content and appendContent".into());
                }
                let append = append
                    .as_str()
                    .ok_or("Invalid appended transcript content")?;
                let previous = previous.ok_or("Transcript append has no matching prior message")?;
                let mut content = previous.content.clone();
                content.push_str(append);
                content
            } else if let Some(content) = message.get("content") {
                content
                    .as_str()
                    .ok_or("Invalid transcript content")?
                    .to_owned()
            } else {
                previous
                    .ok_or("Transcript message has no content")?
                    .content
                    .clone()
            };
            message.insert("content".into(), Value::String(content));
            messages.push(
                serde_json::from_value(Value::Object(message))
                    .map_err(|_| "Invalid transcript message fields".to_string())?,
            );
        }
        Ok(Some(JournalChange {
            epoch: epoch.into(),
            revision,
            start,
            delete,
            messages,
        }))
    }
    fn apply(&mut self, change: JournalChange) {
        self.messages
            .splice(change.start..change.start + change.delete, change.messages);
        if self
            .epoch
            .as_ref()
            .is_some_and(|epoch| epoch != &change.epoch)
        {
            self.retired_epochs.insert(self.epoch.take().unwrap());
        }
        self.epoch = Some(change.epoch);
        self.revision = change.revision;
    }
}
async fn sync_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || std::fs::File::open(path)?.sync_all())
            .await
            .map_err(std::io::Error::other)??;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
async fn durable_replace(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = async {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .await?;
        file.write_all(bytes).await?;
        file.sync_all().await?;
        drop(file);
        let source = temporary.clone();
        let destination = path.to_owned();
        tokio::task::spawn_blocking(move || {
            inferay_core::atomic_write::replace(&source, &destination)
        })
        .await
        .map_err(std::io::Error::other)??;
        let parent = path
            .parent()
            .ok_or_else(|| std::io::Error::other("Invalid journal path"))?;
        sync_directory(parent).await?;
        if let Some(grandparent) = parent.parent() {
            sync_directory(grandparent).await?;
        }
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }
    result
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
                if let Some(id) = payload
                    .and_then(|payload| payload.get("messageId"))
                    .and_then(Value::as_str)
                {
                    buffer.push_user_with_id(id, text, images);
                } else {
                    buffer.push_user(text, images);
                }
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
        let mut events = self.read_legacy_events(pane_id).await.unwrap_or_default();
        let sequence =
            (now_millis() * 1_000).max(events.last().map_or(0, |event| event.sequence + 1));
        let entry = ChatEventLogEntry {
            pane_id: pane_id.to_string(),
            sequence,
            timestamp: now_millis(),
            event_type: event_type.to_string(),
            payload,
        };
        let path = self.event_path(pane_id);
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

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn transcript_message(id: &str, role: &str, content: &str) -> ChatTranscriptMessage {
        serde_json::from_value(json!({ "id": id, "role": role, "content": content })).unwrap()
    }

    fn reset_update(epoch: &str, revision: u64, messages: Vec<ChatTranscriptMessage>) -> Value {
        json!({"version":1,"epoch":epoch,"baseRevision":0,"revision":revision,"reset":true,"start":0,"deleteCount":0,"messages":messages.iter().map(|message| json!({"message":message})).collect::<Vec<_>>()})
    }
    fn append_update(epoch: &str, base: u64, text: &str) -> Value {
        json!({"version":1,"epoch":epoch,"baseRevision":base,"revision":base+1,"reset":false,"start":0,"deleteCount":1,"messages":[{"message":{"id":"a","role":"assistant","isStreaming":true},"appendContent":text}]})
    }

    #[tokio::test]
    async fn production_updates_restore_complete_chat_after_restart() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().into());
        let mut buffer = ChatMessageBuffer::default();
        buffer.push_user_with_id("user-1", "Please explain", None);
        persistence
            .persist_update("pane", &buffer.take_update().unwrap())
            .await
            .unwrap();
        buffer.apply_event(
            &json!({"type":"content_block_start","content_block":{"type":"text","text":"Hello"}}),
        );
        persistence
            .persist_update("pane", &buffer.take_update().unwrap())
            .await
            .unwrap();
        buffer.apply_event(
            &json!({"type":"content_block_delta","delta":{"type":"text_delta","text":" 世界"}}),
        );
        persistence
            .persist_update("pane", &buffer.take_update().unwrap())
            .await
            .unwrap();
        buffer.finalize();
        persistence
            .persist_update("pane", &buffer.take_update().unwrap())
            .await
            .unwrap();
        drop(persistence);
        let restarted = ChatPersistence::new(root.path().into());
        let messages = restarted.read_legacy_transcript("pane").await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].id, "user-1");
        assert_eq!(messages[0].content, "Please explain");
        assert_eq!(messages[1].content, "Hello 世界");
        assert_eq!(messages[1].is_streaming, Some(false));
    }

    #[tokio::test]
    async fn journal_rejects_gaps_and_retired_epochs_without_losing_history() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().into());
        let first = reset_update(
            "epoch-1",
            1,
            vec![transcript_message("a", "assistant", "one")],
        );
        persistence.persist_update("pane", &first).await.unwrap();
        persistence
            .persist_update("pane", &append_update("epoch-1", 1, " two"))
            .await
            .unwrap();
        persistence.persist_update("pane", &first).await.unwrap(); // idempotent stale retry
        assert!(
            persistence
                .persist_update("pane", &append_update("epoch-1", 3, "lost"))
                .await
                .is_err()
        );
        assert!(
            persistence
                .persist_update("pane", &append_update("other", 2, "lost"))
                .await
                .is_err()
        );
        persistence
            .persist_update(
                "pane",
                &reset_update(
                    "epoch-2",
                    1,
                    vec![transcript_message("a", "assistant", "one two")],
                ),
            )
            .await
            .unwrap();
        assert!(persistence.persist_update("pane", &first).await.is_err());
        let restarted = ChatPersistence::new(root.path().into());
        assert_eq!(
            restarted.read_legacy_transcript("pane").await.unwrap()[0].content,
            "one two"
        );
        assert!(restarted.persist_update("pane", &first).await.is_err());
    }

    #[tokio::test]
    async fn interrupted_tail_recovers_but_complete_corruption_is_not_skipped() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().into());
        persistence
            .persist_update(
                "pane",
                &reset_update(
                    "epoch",
                    1,
                    vec![transcript_message("a", "assistant", "safe")],
                ),
            )
            .await
            .unwrap();
        let path = persistence.journal_path("pane").unwrap();
        fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .await
            .unwrap()
            .write_all(b"{\"version\":")
            .await
            .unwrap();
        let restarted = ChatPersistence::new(root.path().into());
        assert_eq!(
            restarted.read_legacy_transcript("pane").await.unwrap()[0].content,
            "safe"
        );
        restarted
            .persist_update("pane", &append_update("epoch", 1, " tail"))
            .await
            .unwrap();
        assert_eq!(
            ChatPersistence::new(root.path().into())
                .read_legacy_transcript("pane")
                .await
                .unwrap()[0]
                .content,
            "safe tail"
        );
        fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .await
            .unwrap()
            .write_all(b"invalid complete record\n")
            .await
            .unwrap();
        let before = fs::read(&path).await.unwrap();
        assert!(
            ChatPersistence::new(root.path().into())
                .persist_update("pane", &append_update("epoch", 2, "no"))
                .await
                .is_err()
        );
        assert_eq!(fs::read(&path).await.unwrap(), before);
    }

    #[tokio::test]
    async fn empty_resets_preserve_legacy_snapshot_and_compaction_retains_reset() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().into());
        let messages = vec![transcript_message("a", "assistant", "legacy")];
        persistence
            .write_transcript("pane", messages.clone())
            .await
            .unwrap();
        persistence
            .persist_update("pane", &reset_update("epoch", 1, vec![]))
            .await
            .unwrap();
        assert!(!persistence.journal_path("pane").unwrap().exists());
        assert_eq!(
            persistence.read_legacy_transcript("pane").await.unwrap()[0].content,
            "legacy"
        );
        persistence
            .persist_update("pane", &reset_update("epoch", 1, messages))
            .await
            .unwrap();
        let lock = persistence.transcript_write_lock("pane").await;
        lock.lock().await.records = COMPACT_JOURNAL_RECORDS - 1;
        persistence
            .persist_update("pane", &append_update("epoch", 1, " modern"))
            .await
            .unwrap();
        let journal = fs::read_to_string(persistence.journal_path("pane").unwrap())
            .await
            .unwrap();
        assert_eq!(journal.lines().count(), 1);
        assert_eq!(
            serde_json::from_str::<Value>(&journal).unwrap()["reset"],
            true
        );
        let restarted = ChatPersistence::new(root.path().into());
        assert_eq!(
            restarted.read_legacy_transcript("pane").await.unwrap()[0].content,
            "legacy modern"
        );
        assert_eq!(
            restarted.read_legacy_snapshot("pane").await.unwrap()[0].content,
            "legacy"
        );
    }

    #[tokio::test]
    async fn idle_journal_cache_is_bounded_and_evicted_history_reloads() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().into());
        for index in 0..20 {
            persistence
                .persist_update(
                    &format!("pane-{index}"),
                    &reset_update(
                        "epoch",
                        1,
                        vec![transcript_message("a", "assistant", "kept")],
                    ),
                )
                .await
                .unwrap();
        }
        assert!(persistence.transcript_writes.lock().await.entries.len() <= 16);
        assert_eq!(
            persistence.read_legacy_transcript("pane-0").await.unwrap()[0].content,
            "kept"
        );
        persistence
            .persist_update("pane-0", &append_update("epoch", 1, " after eviction"))
            .await
            .unwrap();
        assert_eq!(
            ChatPersistence::new(root.path().into())
                .read_legacy_transcript("pane-0")
                .await
                .unwrap()[0]
                .content,
            "kept after eviction"
        );
    }

    #[test]
    fn older_provider_references_remain_readable() {
        let reference: ChatSessionReference = serde_json::from_value(
            json!({"provider":"codex","sessionId":"old-session","cwd":"/tmp"}),
        )
        .unwrap();
        assert_eq!(reference.model, None);
        assert_eq!(reference.reasoning_level, None);
    }

    #[tokio::test]
    async fn provider_reference_is_durable_and_validates_pane_ids() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().into());
        persistence
            .save_session_reference(
                "pane",
                "codex",
                "provider-session",
                root.path(),
                (Some("gpt-6-astra"), Some("high")),
            )
            .await
            .unwrap();
        let restarted = ChatPersistence::new(root.path().into());
        assert_eq!(
            restarted.read_session_reference("pane").await.unwrap(),
            ChatSessionReference {
                provider: "codex".into(),
                session_id: "provider-session".into(),
                cwd: root.path().into(),
                model: Some("gpt-6-astra".into()),
                reasoning_level: Some("high".into()),
            }
        );
        assert!(
            persistence
                .save_session_reference("../bad", "codex", "session", root.path(), (None, None))
                .await
                .is_err()
        );
        assert!(persistence.persist_update("", &Value::Null).await.is_err());
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
    async fn edits_and_removals_share_enqueue_and_drain_serialization() {
        let root = tempdir().unwrap();
        let persistence = ChatPersistence::new(root.path().into());
        persistence
            .enqueue_runtime(
                "pane",
                json!({"id":"q1","text":"first","displayText":"first"}),
            )
            .await
            .unwrap();
        persistence.enqueue_runtime("pane", json!({"id":"q2","text":"second","displayText":"second","images":["/tmp/image.png"]})).await.unwrap();
        let (edited, enqueued, drained) = tokio::join!(
            persistence.mutate_queue_item("pane", "q2", Some("  edited  ")),
            persistence.enqueue_runtime(
                "pane",
                json!({"id":"q3","text":"third","displayText":"third"})
            ),
            persistence.shift_runtime("pane"),
        );
        edited.unwrap();
        enqueued.unwrap();
        assert_eq!(drained.unwrap().unwrap().0["id"], "q1");
        let queue = persistence.read_queue("pane").await.unwrap();
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0]["text"], "edited");
        assert_eq!(queue[0]["displayText"], "edited");
        assert_eq!(queue[0]["images"], json!(["/tmp/image.png"]));
        assert_eq!(queue[1]["id"], "q3");
        // An edit from a stale renderer never resurrects an admitted message.
        persistence
            .mutate_queue_item("pane", "q1", Some("too late"))
            .await
            .unwrap();
        assert_eq!(persistence.read_queue("pane").await.unwrap(), queue);
        assert!(
            persistence
                .mutate_queue_item("pane", "q2", Some("  "))
                .await
                .is_err()
        );
        assert_eq!(persistence.read_queue("pane").await.unwrap(), queue);
        let remaining = persistence
            .mutate_queue_item("pane", "q2", None)
            .await
            .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0]["id"], "q3");
        assert_eq!(
            ChatPersistence::new(root.path().into())
                .read_queue("pane")
                .await
                .unwrap(),
            remaining
        );
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
}
