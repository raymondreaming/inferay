use inferay_core::chat_protocol::ChatTranscriptMessage;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QueuedMessageInfo {
    pub id: String,
    pub text: String,
    #[serde(rename = "displayText")]
    pub display_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
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
    path: PathBuf,
    connection: Arc<tokio::sync::Mutex<Option<Connection>>>,
}

type StoreResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const MAX_UPDATE_BYTES: usize = 32 * 1024 * 1024;

impl ChatPersistence {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            path: user_data_dir.join("chat.sqlite3"),
            connection: Arc::default(),
        }
    }

    // SQLite owns synchronization and recovery; no operation blocks the async runtime.
    async fn transaction<T: Send + 'static>(
        &self,
        pane_id: &str,
        operation: impl FnOnce(&Connection, &str) -> StoreResult<T> + Send + 'static,
    ) -> Result<T, String> {
        if pane_id.is_empty()
            || !pane_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
        {
            return Err("Invalid pane id".into());
        }
        let path = self.path.clone();
        let pane_id = pane_id.to_owned();
        let mut guard = self.connection.clone().lock_owned().await;
        tokio::task::spawn_blocking(move || -> StoreResult<T> {
            if guard.is_none() {
                std::fs::create_dir_all(path.parent().ok_or("Invalid chat database path")?)?;
                let connection = Connection::open(&path)?;
                connection.busy_timeout(std::time::Duration::from_secs(5))?;
                let started = std::time::Instant::now();
                loop {
                    // SQLite can bypass the busy handler during lock upgrades.
                    // Only these idempotent setup statements may be replayed.
                    let initialized = connection.execute_batch(
                    "PRAGMA journal_mode=WAL;
                     PRAGMA synchronous=FULL;
                     PRAGMA fullfsync=ON;
                     PRAGMA cache_size=-2048;
                     PRAGMA wal_autocheckpoint=256;
                     CREATE TABLE IF NOT EXISTS documents (
                         pane TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
                         PRIMARY KEY(pane, kind));
                     CREATE TABLE IF NOT EXISTS transcripts (
                         pane TEXT PRIMARY KEY NOT NULL, epoch TEXT NOT NULL, revision TEXT NOT NULL);
                     CREATE TABLE IF NOT EXISTS retired_epochs (
                         pane TEXT NOT NULL, epoch TEXT NOT NULL, PRIMARY KEY(pane, epoch));
                     CREATE TABLE IF NOT EXISTS transcript_messages (
                         pane TEXT NOT NULL, position INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
                         PRIMARY KEY(pane, position));"
                    );
                    match initialized {
                        Ok(()) => break,
                        Err(error) if error.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy)
                            && started.elapsed() < std::time::Duration::from_secs(5) => {
                            std::thread::sleep(std::time::Duration::from_millis(10));
                        }
                        Err(error) => return Err(format!("Chat database initialization failed: {error}").into()),
                    }
                }
                *guard = Some(connection);
            }
            let transaction = guard.as_mut().unwrap().transaction_with_behavior(TransactionBehavior::Immediate)?;
            let result = operation(&transaction, &pane_id)?;
            transaction.commit()?;
            Ok(result)
        }).await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())
    }

    async fn edit_document<D, T>(
        &self,
        pane_id: &str,
        kind: &'static str,
        edit: impl FnOnce(&mut D) -> StoreResult<T> + Send + 'static,
    ) -> Result<T, String>
    where
        D: Serialize + serde::de::DeserializeOwned + Default,
        T: Send + 'static,
    {
        self.transaction(pane_id, move |connection, pane| {
            let mut document: D = read_document(connection, pane, kind)?;
            let result = edit(&mut document)?;
            write_document(connection, pane, kind, &document)?;
            Ok(result)
        })
        .await
    }

    pub async fn read_transcript(&self, pane_id: &str) -> Option<Vec<ChatTranscriptMessage>> {
        let result = self
            .transaction(pane_id, |connection, pane| {
                let exists: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM transcripts WHERE pane=?1)",
                    [pane],
                    |row| row.get(0),
                )?;
                if !exists {
                    return Ok(None);
                }
                let mut statement = connection.prepare(
                    "SELECT body FROM transcript_messages WHERE pane=?1 ORDER BY position",
                )?;
                let messages = statement
                    .query_map([pane], |row| row.get::<_, String>(0))?
                    .map(|body| {
                        let mut message: ChatTranscriptMessage = serde_json::from_str(&body?)?;
                        message.is_streaming = Some(false);
                        Ok(message)
                    })
                    .collect::<StoreResult<Vec<_>>>()?;
                Ok(Some(messages))
            })
            .await;
        match result {
            Ok(messages) => messages,
            Err(error) => {
                eprintln!("Failed to restore chat for {pane_id}: {error}");
                None
            }
        }
    }

    /// Persist only changed message rows, atomically with their epoch and revision.
    pub async fn persist_update(&self, pane_id: &str, update: &Value) -> Result<(), String> {
        let encoded = serde_json::to_vec(update).map_err(|error| error.to_string())?;
        if encoded.len() > MAX_UPDATE_BYTES {
            return Err("Chat update exceeds safety limit".into());
        }
        self.transaction(pane_id, move |connection, pane| {
            apply_update(connection, pane, &serde_json::from_slice(&encoded)?)
        })
        .await
    }

    pub async fn contains_message(&self, pane_id: &str, id: &str) -> bool {
        let id = id.to_owned();
        self.transaction(pane_id, move |connection, pane| {
            let queue: Vec<Value> = read_document(connection, pane, "queue")?;
            if queue.iter().any(|item| item["id"] == id) { return Ok(true); }
            Ok(connection.query_row("SELECT EXISTS(SELECT 1 FROM transcript_messages WHERE pane=?1 AND json_extract(body,'$.id')=?2)", [pane, &id], |row| row.get(0))?)
        }).await.unwrap_or(false)
    }

    pub async fn receive_handoff(
        &self,
        pane_id: &str,
        request_id: &str,
        request: Value,
    ) -> Result<Value, String> {
        if !request_id.starts_with(&format!("{}:{pane_id}:", pane_id.len()))
            || request_id.len() > 128
            || !request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
        {
            return Err("Invalid image chat request ID".into());
        }
        let request_id = request_id.to_owned();
        self.edit_document(pane_id, "handoffs", move |entries: &mut serde_json::Map<String, Value>| {
            if let Some(receipt) = entries.get(&request_id) {
                if receipt["request"] != request { return Err("Request ID was already used for a different handoff".into()); }
                return Ok(receipt.clone());
            }
            if entries.values().any(|receipt| matches!(receipt["status"].as_str(), Some("pending" | "accepted"))) {
                return Err("Another image chat handoff is pending; wait for it before starting another".into());
            }
            if entries.len() >= 256 { return Err("Image chat receipt limit reached; start a new chat".into()); }
            let receipt = json!({"requestId":request_id,"status":"pending","request":request});
            entries.insert(request_id, receipt.clone());
            Ok(receipt)
        }).await
    }

    pub async fn handoff_receipts(&self, pane_id: &str) -> Result<Vec<Value>, String> {
        self.transaction(pane_id, |connection, pane| {
            let entries: serde_json::Map<String, Value> =
                read_document(connection, pane, "handoffs")?;
            Ok(entries.into_values().collect())
        })
        .await
    }

    /// Commit the claim before any provider side effect; accepted work is never replayed after a crash.
    pub async fn claim_handoff(
        &self,
        pane_id: &str,
        request_id: &str,
    ) -> Result<Option<Value>, String> {
        let request_id = request_id.to_owned();
        self.edit_document(
            pane_id,
            "handoffs",
            move |entries: &mut serde_json::Map<String, Value>| {
                let Some(receipt) = entries
                    .get_mut(&request_id)
                    .filter(|receipt| receipt["status"] == "pending")
                else {
                    return Ok(None);
                };
                receipt["status"] = json!("accepted");
                Ok(Some(receipt["request"].clone()))
            },
        )
        .await
    }

    pub async fn mark_handoff(
        &self,
        pane_id: &str,
        request_id: &str,
        status: &str,
    ) -> Result<(), String> {
        let (request_id, status) = (request_id.to_owned(), status.to_owned());
        self.edit_document(
            pane_id,
            "handoffs",
            move |entries: &mut serde_json::Map<String, Value>| {
                if let Some(receipt) = entries.get_mut(&request_id) {
                    receipt["status"] = json!(status);
                }
                Ok(())
            },
        )
        .await
    }

    pub async fn save_session_reference(
        &self,
        pane_id: &str,
        provider: &str,
        session_id: &str,
        cwd: &Path,
        configuration: (Option<&str>, Option<&str>),
    ) -> Result<(), String> {
        if provider.trim().is_empty() || session_id.trim().is_empty() {
            return Err("Missing provider session reference".into());
        }
        let reference = ChatSessionReference {
            provider: provider.into(),
            session_id: session_id.into(),
            cwd: cwd.into(),
            model: configuration.0.map(str::to_owned),
            reasoning_level: configuration.1.map(str::to_owned),
        };
        self.transaction(pane_id, move |connection, pane| {
            write_document(connection, pane, "session", &reference)
        })
        .await
    }

    pub async fn read_session_reference(&self, pane_id: &str) -> Option<ChatSessionReference> {
        self.transaction(pane_id, |connection, pane| {
            read_document::<Option<ChatSessionReference>>(connection, pane, "session")
        })
        .await
        .ok()
        .flatten()
        .filter(|reference| {
            !reference.provider.trim().is_empty() && !reference.session_id.trim().is_empty()
        })
    }

    pub async fn read_queue(&self, pane_id: &str) -> Result<Vec<Value>, String> {
        self.transaction(pane_id, |connection, pane| {
            read_document(connection, pane, "queue")
        })
        .await
    }

    pub async fn enqueue_runtime(
        &self,
        pane_id: &str,
        message: Value,
    ) -> Result<Vec<Value>, String> {
        self.edit_document(pane_id, "queue", move |queue: &mut Vec<Value>| {
            queue.push(message);
            Ok(queue.clone())
        })
        .await
    }

    /// Queue edits, enqueue, and drain commit through the same transaction boundary.
    pub async fn mutate_queue_item(
        &self,
        pane_id: &str,
        id: &str,
        text: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        let (id, text) = (id.to_owned(), text.map(str::to_owned));
        self.edit_document(pane_id, "queue", move |queue: &mut Vec<Value>| {
            if let Some(index) = queue.iter().position(|item| item["id"] == id) {
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
            }
            Ok(queue.clone())
        })
        .await
    }

    pub async fn shift_runtime(
        &self,
        pane_id: &str,
    ) -> Result<Option<(Value, Vec<Value>)>, String> {
        self.edit_document(pane_id, "queue", |queue: &mut Vec<Value>| {
            if queue.is_empty() {
                return Ok(None);
            }
            Ok(Some((queue.remove(0), queue.clone())))
        })
        .await
    }

    pub async fn delete_queue(&self, pane_id: &str) -> Result<(), String> {
        self.transaction(pane_id, |connection, pane| {
            connection.execute(
                "DELETE FROM documents WHERE pane=?1 AND kind='queue'",
                [pane],
            )?;
            Ok(())
        })
        .await
    }
}

fn read_document<T: serde::de::DeserializeOwned + Default>(
    connection: &Connection,
    pane: &str,
    kind: &str,
) -> StoreResult<T> {
    let body: Option<String> = connection
        .query_row(
            "SELECT body FROM documents WHERE pane=?1 AND kind=?2",
            [pane, kind],
            |row| row.get(0),
        )
        .optional()?;
    Ok(body
        .map(|body| serde_json::from_str(&body))
        .transpose()?
        .unwrap_or_default())
}

fn write_document(
    connection: &Connection,
    pane: &str,
    kind: &str,
    value: &impl Serialize,
) -> StoreResult<()> {
    let body = serde_json::to_string(value)?;
    if kind == "handoffs" && body.len() > 4 * 1024 * 1024 {
        return Err("Image chat handoff storage is full; start a new chat".into());
    }
    connection.execute("INSERT INTO documents(pane,kind,body) VALUES(?1,?2,?3) ON CONFLICT(pane,kind) DO UPDATE SET body=excluded.body", [pane, kind, &body])?;
    Ok(())
}

fn apply_update(connection: &Connection, pane: &str, update: &Value) -> StoreResult<()> {
    let integer = |key: &str| {
        update[key]
            .as_u64()
            .ok_or_else(|| format!("Invalid transcript {key}"))
    };
    if integer("version")? != 1 {
        return Err("Unsupported transcript version".into());
    }
    let epoch = update["epoch"]
        .as_str()
        .filter(|epoch| !epoch.is_empty())
        .ok_or("Missing transcript epoch")?;
    let retired: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM retired_epochs WHERE pane=?1 AND epoch=?2)",
        [pane, epoch],
        |row| row.get(0),
    )?;
    if retired {
        return Err("Transcript update belongs to a retired epoch".into());
    }
    let revision = integer("revision")?;
    let base = integer("baseRevision")?;
    let reset = update["reset"]
        .as_bool()
        .ok_or("Invalid transcript reset")?;
    let changes = update["messages"]
        .as_array()
        .ok_or("Invalid transcript messages")?;
    let prior: Option<(String, String)> = connection
        .query_row(
            "SELECT epoch,revision FROM transcripts WHERE pane=?1",
            [pane],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let prior_revision = prior
        .as_ref()
        .map(|(_, revision)| revision.parse::<u64>())
        .transpose()?
        .unwrap_or(0);
    let prior_epoch = prior.as_ref().map(|(epoch, _)| epoch.as_str());
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM transcript_messages WHERE pane=?1",
        [pane],
        |row| row.get(0),
    )?;
    if reset && changes.is_empty() && count > 0
        || prior_epoch == Some(epoch) && revision <= prior_revision
    {
        return Ok(());
    }
    if !reset && (prior_epoch != Some(epoch) || base != prior_revision) {
        return Err("Transcript update has an epoch or revision gap".into());
    }
    if revision <= base {
        return Err("Transcript revision did not advance".into());
    }
    let start = i64::try_from(integer("start")?)?;
    let delete = if reset {
        if start != 0 {
            return Err("Transcript reset must start at zero".into());
        }
        integer("deleteCount")?;
        count
    } else {
        i64::try_from(integer("deleteCount")?)?
    };
    if start > count || delete > count - start {
        return Err("Transcript splice is outside retained messages".into());
    }
    let mut messages = Vec::with_capacity(changes.len());
    for (offset, change) in changes.iter().enumerate() {
        let mut message = change["message"]
            .as_object()
            .cloned()
            .ok_or("Invalid transcript message")?;
        let id = message
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or("Missing transcript message id")?;
        let previous: Option<String> = if reset {
            None
        } else {
            connection.query_row("SELECT body FROM transcript_messages WHERE pane=?1 AND position=?2 AND json_extract(body,'$.id')=?3", params![pane, start + i64::try_from(offset)?, id], |row| row.get(0)).optional()?
        };
        let previous = previous
            .map(|body| serde_json::from_str::<ChatTranscriptMessage>(&body))
            .transpose()?;
        let content = if let Some(append) = change.get("appendContent") {
            if message.contains_key("content") {
                return Err("Transcript patch includes both content and appendContent".into());
            }
            let append = append
                .as_str()
                .ok_or("Invalid appended transcript content")?;
            let mut content = previous
                .ok_or("Transcript append has no matching prior message")?
                .content;
            content.push_str(append);
            content
        } else if let Some(content) = message.get("content") {
            content
                .as_str()
                .ok_or("Invalid transcript content")?
                .to_owned()
        } else {
            previous.ok_or("Transcript message has no content")?.content
        };
        message.insert("content".into(), Value::String(content));
        let message: ChatTranscriptMessage = serde_json::from_value(Value::Object(message))?;
        messages.push(serde_json::to_string(&message)?);
    }
    connection.execute(
        "DELETE FROM transcript_messages WHERE pane=?1 AND position>=?2 AND position<?3",
        params![pane, start, start + delete],
    )?;
    let shift = i64::try_from(messages.len())? - delete;
    if shift != 0 {
        // Move the suffix out of the positive index range before shifting to avoid key collisions.
        connection.execute(
            "UPDATE transcript_messages SET position=-position-1 WHERE pane=?1 AND position>=?2",
            params![pane, start + delete],
        )?;
        connection.execute(
            "UPDATE transcript_messages SET position=-position-1+?2 WHERE pane=?1 AND position<0",
            params![pane, shift],
        )?;
    }
    let mut insert = connection
        .prepare("INSERT INTO transcript_messages(pane,position,body) VALUES(?1,?2,?3)")?;
    for (offset, body) in messages.iter().enumerate() {
        insert.execute(params![pane, start + i64::try_from(offset)?, body])?;
    }
    if let Some(old_epoch) = prior_epoch.filter(|old| *old != epoch) {
        connection.execute(
            "INSERT INTO retired_epochs(pane,epoch) VALUES(?1,?2)",
            [pane, old_epoch],
        )?;
    }
    connection.execute("INSERT INTO transcripts(pane,epoch,revision) VALUES(?1,?2,?3) ON CONFLICT(pane) DO UPDATE SET epoch=excluded.epoch,revision=excluded.revision", [pane, epoch, &revision.to_string()])?;
    Ok(())
}
