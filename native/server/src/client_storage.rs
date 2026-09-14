//! Shared JSON preferences with keyed reads and atomic publication. Retain the
//! existing file format; stat checks detect changes made outside this process.
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
type Changes = BTreeMap<String, Option<Value>>;

#[derive(PartialEq, Eq)]
struct Version {
    bytes: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
impl Version {
    fn from_metadata(metadata: std::fs::Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Self {
            bytes: metadata.len(),
            modified: metadata.modified().ok(),
            #[cfg(unix)]
            identity: (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            ),
        }
    }
}
async fn version(path: &Path) -> Result<Option<Version>, String> {
    match tokio::fs::metadata(path).await {
        Ok(metadata) => Ok(Some(Version::from_metadata(metadata))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) struct ClientStorage {
    path: PathBuf,
    entries: Arc<Map<String, Value>>,
    version: Option<Version>,
    loaded: bool,
}
impl ClientStorage {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            entries: Arc::new(Map::new()),
            version: None,
            loaded: false,
        }
    }
    pub async fn read(&mut self) -> Result<&Map<String, Value>, String> {
        let observed = version(&self.path).await?;
        if !self.loaded || observed != self.version {
            let entries = match tokio::fs::read(&self.path).await {
                Ok(bytes) => tokio::task::spawn_blocking(move || {
                    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
                })
                .await
                .map_err(|error| error.to_string())??,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
                Err(error) => return Err(error.to_string()),
            };
            self.entries = Arc::new(entries);
            // Use the pre-read fingerprint. If an external writer replaced the
            // file during the read, the next read must validate it again.
            self.version = observed;
            self.loaded = true;
        }
        Ok(&self.entries)
    }
    pub async fn select(&mut self, keys: &[&str]) -> Result<Map<String, Value>, String> {
        let entries = self.read().await?;
        Ok(keys
            .iter()
            .filter_map(|key| {
                entries
                    .get(*key)
                    .map(|value| ((*key).to_owned(), value.clone()))
            })
            .collect())
    }
    /// None removes a key; Some(Null) stores an explicit null preference.
    pub async fn update(&mut self, changes: Changes) -> Result<(), String> {
        self.read().await?;
        if changes
            .iter()
            .all(|(key, value)| self.entries.get(key) == value.as_ref())
        {
            return Ok(());
        }
        let (committed, changes) = write(self.path.clone(), self.entries.clone(), changes).await?;
        // Publish only after successful replacement. The fingerprint comes from
        // our open file handle, never a possibly externally replaced path.
        let entries = Arc::make_mut(&mut self.entries);
        for (key, value) in changes {
            if let Some(value) = value {
                entries.insert(key, value);
            } else {
                entries.remove(&key);
            }
        }
        self.loaded = committed.is_some();
        self.version = committed;
        Ok(())
    }
}

async fn write(
    path: PathBuf,
    entries: Arc<Map<String, Value>>,
    changes: Changes,
) -> Result<(Option<Version>, Changes), String> {
    tokio::task::spawn_blocking(move || {
        // Borrow unchanged values on the worker. Only the small changes map is
        // moved; neither parsing nor full-file serialization runs on an async worker.
        let mut merged: BTreeMap<&str, &Value> = entries
            .iter()
            .map(|(key, value)| (key.as_str(), value))
            .collect();
        for (key, value) in &changes {
            if let Some(value) = value {
                merged.insert(key, value);
            } else {
                merged.remove(key.as_str());
            }
        }
        let bytes = serde_json::to_vec_pretty(&merged).map_err(|error| error.to_string())?;
        drop(merged);
        let parent = path.parent().ok_or("Invalid preferences path")?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary = parent.join(format!("client-storage.{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| error.to_string())?;
            file.write_all(&bytes).map_err(|error| error.to_string())?;
            // Preserve the existing close-before-replace behavior on Windows.
            #[cfg(windows)]
            drop(file);
            crate::atomic_write::replace(&temporary, &path).map_err(|error| error.to_string())?;
            #[cfg(not(windows))]
            {
                file.metadata()
                    .map(Version::from_metadata)
                    .map(Some)
                    .map_err(|error| error.to_string())
            }
            #[cfg(windows)]
            {
                Ok(None)
            }
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map(|version| (version, changes))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn keyed_reads_reuse_large_values_and_detect_external_replacement_and_deletion() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("preferences.json");
        std::fs::write(
            &path,
            json!({"large":"a".repeat(5_000_000),"model":"first"}).to_string(),
        )
        .unwrap();
        let mut store = ClientStorage::new(path.clone());
        let large = store.read().await.unwrap()["large"]
            .as_str()
            .unwrap()
            .as_ptr();
        assert_eq!(
            store.select(&["model"]).await.unwrap(),
            serde_json::from_value::<Map<String, Value>>(json!({"model":"first"})).unwrap()
        );
        assert_eq!(
            store.read().await.unwrap()["large"]
                .as_str()
                .unwrap()
                .as_ptr(),
            large
        );
        store
            .update(BTreeMap::from([("model".into(), Some(json!("saved")))]))
            .await
            .unwrap();
        #[cfg(not(windows))]
        assert_eq!(
            store.read().await.unwrap()["large"]
                .as_str()
                .unwrap()
                .as_ptr(),
            large
        );
        crate::atomic_write::overwrite_sync(&path, br#"{"model":"other"}"#).unwrap();
        assert_eq!(store.select(&["model"]).await.unwrap()["model"], "other");
        std::fs::remove_file(&path).unwrap();
        assert!(store.read().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn saves_preserve_unrelated_values_and_distinguish_null_from_removal() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("preferences.json");
        let mut store = ClientStorage::new(path.clone());
        store
            .update(BTreeMap::from([
                ("draft".into(), Some(json!("keep"))),
                ("model".into(), Some(json!("old"))),
            ]))
            .await
            .unwrap();
        store
            .update(BTreeMap::from([
                ("model".into(), Some(Value::Null)),
                ("absent".into(), None),
            ]))
            .await
            .unwrap();
        let mut reopened = ClientStorage::new(path);
        assert_eq!(
            reopened.read().await.unwrap(),
            &serde_json::from_value::<Map<String, Value>>(json!({"draft":"keep","model":null}))
                .unwrap()
        );
        store
            .update(BTreeMap::from([("model".into(), None)]))
            .await
            .unwrap();
        assert!(!reopened.read().await.unwrap().contains_key("model"));
    }

    #[tokio::test]
    async fn malformed_files_and_failed_saves_do_not_publish_unsaved_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let parent = directory.path().join("nested");
        let path = parent.join("preferences.json");
        let mut store = ClientStorage::new(path.clone());
        store
            .update(BTreeMap::from([("model".into(), Some(json!("saved")))]))
            .await
            .unwrap();
        assert_eq!(store.read().await.unwrap()["model"], "saved");
        std::fs::write(&path, b"malformed").unwrap();
        assert!(store.read().await.is_err());
        assert!(
            store
                .update(BTreeMap::from([("model".into(), Some(json!("unsaved")))]))
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"malformed");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&parent).unwrap();
        std::fs::write(&parent, b"cannot create a directory here").unwrap();
        assert!(
            store
                .update(BTreeMap::from([("model".into(), Some(json!("unsaved")))]))
                .await
                .is_err()
        );
    }
}
