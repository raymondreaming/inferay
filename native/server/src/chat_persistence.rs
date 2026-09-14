use inferay_core::chat_protocol::ChatTranscriptMessage;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    any::Any,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
pub struct QueuedMessageInfo {
    pub id: String,
    pub text: String,
    #[serde(rename = "displayText")]
    pub display_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub images: Option<Vec<PathBuf>>,
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
    writer: Arc<OnceLock<StoreWriter>>,
}

type StoreResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const MAX_UPDATE_BYTES: usize = 32 * 1024 * 1024;

// Requests retain their order, but concurrently waiting requests share a durable
// commit. Reply only after commit succeeds: publication never outruns storage.
type StoredValue = Box<dyn Any + Send>;
type StoreOperation = Box<dyn FnOnce(&Connection) -> StoreResult<StoredValue> + Send>;
struct StoreJob {
    operation: Option<StoreOperation>,
    reply: tokio::sync::oneshot::Sender<Result<StoredValue, String>>,
}
struct StoreWriter {
    sender: Option<tokio::sync::mpsc::Sender<StoreJob>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl StoreWriter {
    fn start(path: PathBuf) -> Self {
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<StoreJob>(64);
        let thread = std::thread::Builder::new()
            .name("inferay-chat-storage".into())
            .spawn(move || {
                let mut connection = None;
                while let Some(first) = receiver.blocking_recv() {
                    let mut jobs = vec![first];
                    // No timer on the quiet path. Work arriving during a commit is
                    // naturally grouped into the next transaction, up to this bound.
                    while jobs.len() < 64 {
                        let Ok(job) = receiver.try_recv() else { break };
                        jobs.push(job);
                    }
                    let result = (|| -> StoreResult<Vec<StoreResult<StoredValue>>> {
                        if connection.is_none() {
                            connection = Some(open_connection(&path)?);
                        }
                        commit_jobs(connection.as_mut().unwrap(), &mut jobs)
                    })();
                    match result {
                        Ok(results) => {
                            for (job, result) in jobs.into_iter().zip(results) {
                                let _ = job.reply.send(result.map_err(|error| error.to_string()));
                            }
                        }
                        Err(error) => {
                            let error = error.to_string();
                            for job in jobs {
                                let _ = job.reply.send(Err(error.clone()));
                            }
                        }
                    }
                }
            })
            .expect("Could not start chat storage worker");
        Self {
            sender: Some(sender),
            thread: Some(thread),
        }
    }
}
impl Drop for StoreWriter {
    fn drop(&mut self) {
        // Drain accepted jobs and close SQLite before the final store is released.
        self.sender.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
fn commit_jobs(
    connection: &mut Connection,
    jobs: &mut [StoreJob],
) -> StoreResult<Vec<StoreResult<StoredValue>>> {
    let mut transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut results = Vec::with_capacity(jobs.len());
    for job in jobs {
        // A malformed update rolls back only its own changes. Failure of the
        // outer commit fails every acknowledgement, including successful reads.
        let savepoint = transaction.savepoint()?;
        let result = job.operation.take().unwrap()(&savepoint);
        if result.is_ok() {
            savepoint.commit()?;
        } else {
            savepoint.finish()?;
        }
        results.push(result);
    }
    transaction.commit()?;
    Ok(results)
}
fn open_connection(path: &Path) -> StoreResult<Connection> {
    std::fs::create_dir_all(path.parent().ok_or("Invalid chat database path")?)?;
    let connection = Connection::open(path)?;
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
            Err(error)
                if error.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy)
                    && started.elapsed() < std::time::Duration::from_secs(5) =>
            {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(error) => {
                return Err(format!("Chat database initialization failed: {error}").into());
            }
        }
    }
    Ok(connection)
}

impl ChatPersistence {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            path: user_data_dir.join("chat.sqlite3"),
            writer: Arc::default(),
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
        let pane_id = pane_id.to_owned();
        let writer = self
            .writer
            .get_or_init(|| StoreWriter::start(self.path.clone()));
        let (reply, received) = tokio::sync::oneshot::channel();
        writer
            .sender
            .as_ref()
            .unwrap()
            .send(StoreJob {
                operation: Some(Box::new(move |connection| {
                    operation(connection, &pane_id).map(|value| Box::new(value) as StoredValue)
                })),
                reply,
            })
            .await
            .map_err(|_| "Chat storage worker stopped".to_string())?;
        received
            .await
            .map_err(|_| "Chat storage worker stopped".to_string())??
            .downcast::<T>()
            .map(|value| *value)
            .map_err(|_| "Invalid chat storage result".to_string())
    }

    async fn edit_queue<T>(
        &self,
        pane_id: &str,
        edit: impl FnOnce(&mut Vec<QueuedMessageInfo>) -> StoreResult<T> + Send + 'static,
    ) -> Result<T, String>
    where
        T: Send + 'static,
    {
        self.transaction(pane_id, move |connection, pane| {
            let mut document = read_queue_document(connection, pane)?;
            let result = edit(&mut document)?;
            write_document(connection, pane, "queue", &document)?;
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

    pub async fn clear_session(&self, pane_id: &str, epoch: Option<String>) -> Result<(), String> {
        self.transaction(pane_id, move |connection, pane| {
            connection.execute("INSERT OR IGNORE INTO retired_epochs SELECT pane,epoch FROM transcripts WHERE pane=?1", [pane])?;
            if let Some(epoch) = epoch {
                connection.execute("INSERT OR IGNORE INTO retired_epochs(pane,epoch) VALUES(?1,?2)", [pane, &epoch])?;
            }
            connection.execute("DELETE FROM transcript_messages WHERE pane=?1", [pane])?;
            connection.execute("DELETE FROM documents WHERE pane=?1 AND kind IN ('session','queue','agentContext')", [pane])?;
            write_document(connection, pane, "legacySummaryCleared", &true)?;
            // Retain an empty transcript so legacy provider history cannot restore a cleared chat.
            connection.execute("INSERT INTO transcripts(pane,epoch,revision) VALUES(?1,?2,'0') ON CONFLICT(pane) DO UPDATE SET epoch=excluded.epoch,revision='0'", [pane, &uuid::Uuid::new_v4().to_string()])?;
            Ok(())
        }).await
    }

    pub async fn legacy_summary(&self, pane_id: &str) -> Option<String> {
        if self
            .transaction(pane_id, |connection, pane| {
                read_document::<bool>(connection, pane, "legacySummaryCleared")
            })
            .await
            .ok()?
        {
            return None;
        }
        super::read_client_storage(&self.path.with_file_name("client-storage.json"))
            .await
            .ok()?
            .get(&format!("inferay-chat-summary-{pane_id}"))?
            .as_str()
            .map(str::to_owned)
    }

    pub async fn save_agent_context(&self, pane_id: &str, context: String) -> Result<(), String> {
        self.transaction(pane_id, move |connection, pane| {
            write_document(connection, pane, "agentContext", &context)
        })
        .await
    }

    pub async fn read_agent_context(&self, pane_id: &str) -> Option<String> {
        self.transaction(pane_id, |connection, pane| {
            read_document::<Option<String>>(connection, pane, "agentContext")
        })
        .await
        .ok()
        .flatten()
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

    pub async fn read_queue(&self, pane_id: &str) -> Result<Vec<QueuedMessageInfo>, String> {
        self.transaction(pane_id, |connection, pane| {
            read_queue_document(connection, pane)
        })
        .await
    }

    pub async fn enqueue_runtime(
        &self,
        pane_id: &str,
        message: QueuedMessageInfo,
    ) -> Result<(), String> {
        self.edit_queue(pane_id, move |queue| {
            queue.push(message);
            Ok(())
        })
        .await
    }

    /// Queue edits, enqueue, and drain commit through the same transaction boundary.
    pub async fn mutate_queue_item(
        &self,
        pane_id: &str,
        id: &str,
        text: Option<&str>,
    ) -> Result<Vec<QueuedMessageInfo>, String> {
        let (id, text) = (id.to_owned(), text.map(str::to_owned));
        self.edit_queue(pane_id, move |queue| {
            if let Some(index) = queue.iter().position(|item| item.id == id) {
                if let Some(text) = text {
                    let text = text.trim();
                    if text.is_empty() {
                        return Err("Queued message cannot be empty".into());
                    }
                    queue[index].text = text.into();
                    queue[index].display_text = text.into();
                } else {
                    queue.remove(index);
                }
            }
            Ok(queue.clone())
        })
        .await
    }

    pub async fn shift_runtime(&self, pane_id: &str) -> Result<Option<QueuedMessageInfo>, String> {
        self.edit_queue(pane_id, |queue| {
            if queue.is_empty() {
                return Ok(None);
            }
            Ok(Some(queue.remove(0)))
        })
        .await
    }
}

fn read_queue_document(connection: &Connection, pane: &str) -> StoreResult<Vec<QueuedMessageInfo>> {
    Ok(read_document::<Vec<Value>>(connection, pane, "queue")?
        .into_iter()
        .filter_map(|message| serde_json::from_value(message).ok())
        .collect())
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

#[cfg(test)]
mod group_commit_tests {
    use super::*;

    fn job(operation: impl FnOnce(&Connection) -> StoreResult<()> + Send + 'static) -> StoreJob {
        let (reply, _) = tokio::sync::oneshot::channel();
        StoreJob {
            operation: Some(Box::new(move |connection| {
                operation(connection).map(|()| Box::new(()) as StoredValue)
            })),
            reply,
        }
    }

    #[test]
    fn failed_operation_rolls_back_without_discarding_neighbors() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE items (value TEXT)")
            .unwrap();
        let mut jobs = vec![
            job(|connection| {
                connection.execute("INSERT INTO items VALUES ('first')", [])?;
                Ok(())
            }),
            job(|connection| {
                connection.execute("INSERT INTO items VALUES ('invalid')", [])?;
                Err("invalid update".into())
            }),
            job(|connection| {
                let count: i64 =
                    connection.query_row("SELECT count(*) FROM items", [], |r| r.get(0))?;
                assert_eq!(count, 1, "Later operations must not see rolled-back writes");
                connection.execute("INSERT INTO items VALUES ('last')", [])?;
                Ok(())
            }),
        ];
        let results = commit_jobs(&mut connection, &mut jobs).unwrap();
        assert!(results[0].is_ok());
        assert!(results[1].is_err());
        assert!(results[2].is_ok());
        let values: String = connection
            .query_row("SELECT group_concat(value, ',') FROM items", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(values, "first,last");
    }

    #[test]
    fn failed_outer_commit_rolls_back_every_operation() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
            CREATE TABLE parent(id INTEGER PRIMARY KEY);
            CREATE TABLE child(parent INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
            CREATE TABLE items(value TEXT);",
            )
            .unwrap();
        let mut jobs = vec![
            job(|connection| {
                connection.execute("INSERT INTO items VALUES ('must roll back')", [])?;
                Ok(())
            }),
            job(|connection| {
                connection.execute("INSERT INTO child VALUES (42)", [])?;
                Ok(())
            }),
        ];
        assert!(commit_jobs(&mut connection, &mut jobs).is_err());
        let count: i64 = connection
            .query_row("SELECT count(*) FROM items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
