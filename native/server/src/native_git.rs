//! Typed, transport-free Git service shared by Axum and native callers.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use inferay_core::path_security::AllowedPaths;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const FILE_WATCH_DEBOUNCE_MS: u64 = 300;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeGitError {
    InvalidDirectory,
    Runtime(String),
}

impl std::fmt::Display for NativeGitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidDirectory => formatter.write_str("Missing cwd parameter"),
            Self::Runtime(error) => formatter.write_str(error),
        }
    }
}

impl std::error::Error for NativeGitError {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChangeEvent {
    pub cwd: String,
    pub file: String,
    pub event_type: String,
}

#[derive(Clone)]
pub struct NativeGit {
    allowed_paths: AllowedPaths,
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
    events: broadcast::Sender<GitFileChangeEvent>,
}

impl NativeGit {
    pub fn new(allowed_paths: AllowedPaths) -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
            allowed_paths,
            watchers: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GitFileChangeEvent> {
        self.events.subscribe()
    }

    fn cwd(&self, value: &str) -> Result<String, NativeGitError> {
        if value.trim().is_empty() {
            return Err(NativeGitError::InvalidDirectory);
        }
        self.allowed_paths
            .resolve_allowed_local_path(value)
            .map(|path| path.to_string_lossy().into_owned())
            .ok_or(NativeGitError::InvalidDirectory)
    }

    pub fn watch(&self, cwd: &str) -> Result<(), NativeGitError> {
        let cwd = self.cwd(cwd)?;
        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| NativeGitError::Runtime("git watcher lock poisoned".into()))?;
        if watchers.contains_key(&cwd) {
            return Ok(());
        }
        let event_root = PathBuf::from(&cwd);
        let event_cwd = cwd.clone();
        let sender = self.events.clone();
        let last_event = Arc::new(AtomicU64::new(0));
        let event_clock = last_event.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let Ok(event) = result else { return };
                let event_type = match event.kind {
                    EventKind::Create(_)
                    | EventKind::Remove(_)
                    | EventKind::Modify(notify::event::ModifyKind::Name(_)) => "rename",
                    EventKind::Modify(_) => "change",
                    _ => return,
                };
                for path in event.paths {
                    let Ok(relative) = path.strip_prefix(&event_root) else {
                        continue;
                    };
                    let filename = relative.to_string_lossy();
                    if !should_broadcast_file_change(&filename) {
                        continue;
                    }
                    let now = unix_millis();
                    let previous = event_clock.load(Ordering::Relaxed);
                    if now.saturating_sub(previous) < FILE_WATCH_DEBOUNCE_MS {
                        continue;
                    }
                    event_clock.store(now, Ordering::Relaxed);
                    let _ = sender.send(GitFileChangeEvent {
                        cwd: event_cwd.clone(),
                        file: filename.into_owned(),
                        event_type: event_type.into(),
                    });
                }
            })
            .map_err(|error| NativeGitError::Runtime(error.to_string()))?;
        watcher
            .watch(PathBuf::from(&cwd).as_path(), RecursiveMode::Recursive)
            .map_err(|error| NativeGitError::Runtime(error.to_string()))?;
        watchers.insert(cwd, watcher);
        Ok(())
    }

    pub fn unwatch(&self, cwd: &str) -> Result<(), NativeGitError> {
        let cwd = self.cwd(cwd)?;
        self.watchers
            .lock()
            .map_err(|_| NativeGitError::Runtime("git watcher lock poisoned".into()))?
            .remove(&cwd);
        Ok(())
    }
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn should_broadcast_file_change(filename: &str) -> bool {
    if filename.starts_with('.')
        || filename.contains("node_modules")
        || filename.contains(".git")
        || filename.starts_with("data/")
        || filename.ends_with(".json")
    {
        return false;
    }
    [".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".md"]
        .iter()
        .any(|extension| filename.ends_with(extension))
}
