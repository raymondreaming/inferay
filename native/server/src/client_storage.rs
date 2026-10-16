//! Durable per-key preferences. Legacy JSON is imported once and retained as a backup.
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
type Changes = BTreeMap<String, Option<Value>>;

pub(crate) fn decode_json(entries: &Map<String, Value>, key: &str) -> Option<Value> {
    entries
        .get(key)
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str(text).ok())
}

pub(crate) fn encode_json(value: &Value) -> Value {
    Value::String(value.to_string())
}

fn read_values(
    db: &Connection,
    keys: impl IntoIterator<Item = rusqlite::Result<String>>,
) -> Result<Map<String, Value>> {
    let mut statement = db.prepare_cached("SELECT value FROM entries WHERE key = ?1")?;
    let mut entries = Map::new();
    for key in keys {
        let key = key?;
        if let Some(value) = statement
            .query_row([&key], |row| row.get::<_, String>(0))
            .optional()?
        {
            entries.insert(key, serde_json::from_str(&value)?);
        }
    }
    Ok(entries)
}

pub(crate) struct ClientStorage {
    legacy_path: PathBuf,
    connection: Arc<Mutex<Option<Connection>>>,
}
impl ClientStorage {
    pub fn new(legacy_path: PathBuf) -> Self {
        Self {
            legacy_path,
            connection: Arc::new(Mutex::new(None)),
        }
    }
    async fn query<T: Send + 'static>(
        &self,
        query: impl FnOnce(&mut Connection) -> Result<T> + Send + 'static,
    ) -> std::result::Result<T, String> {
        let legacy_path = self.legacy_path.clone();
        let connection = self.connection.clone();
        tokio::task::spawn_blocking(move || -> Result<T> {
            let mut slot = connection.lock().map_err(|_| "Preferences lock poisoned")?;
            if slot.is_none() {
                std::fs::create_dir_all(legacy_path.parent().ok_or("Invalid preferences path")?)?;
                let mut db = Connection::open(legacy_path.with_extension("sqlite3"))?;
                db.busy_timeout(std::time::Duration::from_secs(5))?;
                db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")?;
                let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
                match transaction.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))? {
                    0 => {
                        let entries: Map<String, Value> = match std::fs::read(&legacy_path) {
                            Ok(bytes) => serde_json::from_slice(&bytes)?,
                            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
                            Err(error) => return Err(error.into()),
                        };
                        transaction.execute_batch("CREATE TABLE entries (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));")?;
                        for (key, value) in entries {
                            transaction.execute("INSERT INTO entries VALUES (?1, ?2)", params![key, value.to_string()])?;
                        }
                        transaction.pragma_update(None, "user_version", 1)?;
                    }
                    1 => {}
                    version => return Err(format!("Unsupported preferences schema {version}").into()),
                }
                transaction.commit()?;
                *slot = Some(db);
            }
            query(slot.as_mut().unwrap())
        }).await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())
    }
    /// Enumerate the key index before loading values, so excluded archives never
    /// enter the snapshot or need to be parsed. Both queries share one read transaction.
    pub async fn read_matching(
        &self,
        include: fn(&str) -> bool,
    ) -> std::result::Result<Map<String, Value>, String> {
        self.query(move |db| {
            let transaction = db.transaction()?;
            let mut statement = transaction.prepare("SELECT key FROM entries")?;
            let keys = statement.query_map([], |row| row.get::<_, String>(0))?;
            read_values(
                &transaction,
                keys.filter(|key| key.as_ref().map_or(true, |key| include(key))),
            )
        })
        .await
    }
    pub async fn select(&self, keys: &[&str]) -> std::result::Result<Map<String, Value>, String> {
        let keys: Vec<String> = keys.iter().map(|key| (*key).to_owned()).collect();
        self.query(move |db| {
            let transaction = db.transaction()?;
            read_values(&transaction, keys.into_iter().map(Ok))
        })
        .await
    }
    /// None removes a key; Some(Null) stores an explicit null preference.
    pub async fn update(&self, changes: Changes) -> std::result::Result<(), String> {
        self.query(move |db| {
            let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            for (key, value) in changes {
                if let Some(value) = value {
                    transaction.execute("INSERT INTO entries VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE entries.value <> excluded.value", params![key, value.to_string()])?;
                } else {
                    transaction.execute("DELETE FROM entries WHERE key = ?1", [key])?;
                }
            }
            transaction.commit()?;
            Ok(())
        }).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn migration_preserves_values_and_never_resurrects_removed_keys() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("client-storage.json");
        let original =
            json!({"archive": "x".repeat(100_000), "nested": {"a": [1, null]}, "null": null});
        let bytes = serde_json::to_vec_pretty(&original).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let store = ClientStorage::new(path.clone());
        assert_eq!(
            json!(store.read_matching(|_| true).await.unwrap()),
            original
        );
        store
            .update(BTreeMap::from([
                ("archive".into(), None),
                ("selected".into(), Some(json!(null))),
            ]))
            .await
            .unwrap();
        for i in 0..20 {
            store
                .update(BTreeMap::from([("selected".into(), Some(json!(i)))]))
                .await
                .unwrap();
        }
        drop(store);
        let restored = ClientStorage::new(path.clone())
            .read_matching(|_| true)
            .await
            .unwrap();
        assert!(!restored.contains_key("archive"));
        assert_eq!(restored["nested"], original["nested"]);
        assert_eq!(restored["null"], Value::Null);
        assert_eq!(restored["selected"], 19);
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }

    #[tokio::test]
    async fn failed_import_and_failed_batches_are_retryable_and_atomic() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("client-storage.json");
        std::fs::write(&path, "malformed").unwrap();
        let store = ClientStorage::new(path.clone());
        assert!(store.read_matching(|_| true).await.is_err());
        assert!(
            store
                .update(BTreeMap::from([("model".into(), Some(json!("unsaved")))]))
                .await
                .is_err()
        );
        std::fs::write(&path, r#"{"model":"saved"}"#).unwrap();
        assert_eq!(
            store.read_matching(|_| true).await.unwrap()["model"],
            "saved"
        );
        let external = Connection::open(path.with_extension("sqlite3")).unwrap();
        let version: i64 = external
            .pragma_query_value(None, "data_version", |row| row.get(0))
            .unwrap();
        store
            .update(BTreeMap::from([
                ("model".into(), Some(json!("saved"))),
                ("missing".into(), None),
            ]))
            .await
            .unwrap();
        assert_eq!(
            external
                .pragma_query_value(None, "data_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            version
        );
        external.execute_batch("CREATE TRIGGER fail_save BEFORE INSERT ON entries WHEN NEW.key = 'z' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;").unwrap();
        assert!(
            store
                .update(BTreeMap::from([
                    ("model".into(), Some(json!("unsaved"))),
                    ("z".into(), Some(json!(1)))
                ]))
                .await
                .is_err()
        );
        assert_eq!(store.select(&["model"]).await.unwrap()["model"], "saved");
        external
            .execute(
                "UPDATE entries SET value = '\"external\"' WHERE key = 'model'",
                [],
            )
            .unwrap();
        assert_eq!(store.select(&["model"]).await.unwrap()["model"], "external");
        store
            .update(BTreeMap::from([("model".into(), Some(Value::Null))]))
            .await
            .unwrap();
        assert_eq!(
            store.read_matching(|_| true).await.unwrap()["model"],
            Value::Null
        );
    }
}
