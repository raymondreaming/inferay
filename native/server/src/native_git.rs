//! Typed, transport-free Git service shared by Axum and native callers.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use inferay_core::path_security::AllowedPaths;
use inferay_native_diff::{GitHunkDiff, compact_git_hunk_diff, get_git_hunk_diff};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const FILE_WATCH_DEBOUNCE_MS: u64 = 300;
const MAX_CACHED_DIFFS: usize = 48;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct DiffCacheKey {
    cwd: String,
    file: String,
    staged: bool,
    review: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified_nanos: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DiffFingerprint {
    file: Option<FileStamp>,
    parent: Option<FileStamp>,
    index: Option<FileStamp>,
    head: Option<FileStamp>,
}

#[derive(Clone)]
struct CachedDiff {
    fingerprint: DiffFingerprint,
    value: Option<GitHunkDiff>,
}

#[derive(Default)]
struct DiffCache {
    entries: VecDeque<(DiffCacheKey, CachedDiff)>,
}

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
    diff_cache: Arc<Mutex<DiffCache>>,
}

impl NativeGit {
    pub fn new(allowed_paths: AllowedPaths) -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
            allowed_paths,
            watchers: Arc::new(Mutex::new(HashMap::new())),
            events,
            diff_cache: Arc::new(Mutex::new(DiffCache::default())),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GitFileChangeEvent> {
        self.events.subscribe()
    }

    pub fn full_diff(
        &self,
        cwd: &str,
        file: &str,
        staged: bool,
        review: bool,
    ) -> Result<Option<GitHunkDiff>, NativeGitError> {
        let cwd = self.cwd(cwd)?;
        let key = DiffCacheKey {
            cwd: cwd.clone(),
            file: file.into(),
            staged,
            review,
        };
        let fingerprint = diff_fingerprint(&cwd, file);
        if let Some(cached) = self
            .diff_cache
            .lock()
            .map_err(|_| NativeGitError::Runtime("git diff cache lock poisoned".into()))?
            .entries
            .iter()
            .find(|(candidate, entry)| candidate == &key && entry.fingerprint == fingerprint)
        {
            return Ok(cached.1.value.clone());
        }

        let diff = get_git_hunk_diff(&self.allowed_paths, &cwd, file, staged);
        let changed = diff.is_new
            || diff
                .raw_patch
                .as_deref()
                .is_some_and(|patch| !patch.trim().is_empty())
            || diff.merge_conflict_content.is_some();
        let value = changed.then(|| {
            if review {
                compact_git_hunk_diff(diff)
            } else {
                diff
            }
        });
        let mut cache = self
            .diff_cache
            .lock()
            .map_err(|_| NativeGitError::Runtime("git diff cache lock poisoned".into()))?;
        cache.entries.retain(|(candidate, _)| candidate != &key);
        cache.entries.push_back((
            key,
            CachedDiff {
                fingerprint,
                value: value.clone(),
            },
        ));
        while cache.entries.len() > MAX_CACHED_DIFFS {
            cache.entries.pop_front();
        }
        Ok(value)
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

fn file_stamp(path: PathBuf) -> Option<FileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified_nanos = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(FileStamp {
        len: metadata.len(),
        modified_nanos,
    })
}

fn diff_fingerprint(cwd: &str, file: &str) -> DiffFingerprint {
    let root = PathBuf::from(cwd);
    let path = root.join(file);
    DiffFingerprint {
        file: file_stamp(path.clone()),
        parent: path.parent().map(PathBuf::from).and_then(file_stamp),
        index: file_stamp(root.join(".git/index")),
        head: file_stamp(root.join(".git/HEAD")),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn git(repository: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn full_diff_cache_reuses_and_invalidates_by_repository_fingerprint() {
        let repository = tempfile::tempdir().unwrap();
        git(repository.path(), &["init", "-q"]);
        git(
            repository.path(),
            &["config", "user.email", "test@example.com"],
        );
        git(repository.path(), &["config", "user.name", "Test User"]);
        std::fs::write(
            repository.path().join("app.ts"),
            "export const value = 1;\n",
        )
        .unwrap();
        git(repository.path(), &["add", "app.ts"]);
        git(repository.path(), &["commit", "-qm", "initial"]);
        std::fs::write(
            repository.path().join("app.ts"),
            "export const value = 22;\n",
        )
        .unwrap();

        let allowed =
            AllowedPaths::new(repository.path(), repository.path().canonicalize().unwrap())
                .unwrap();
        let native_git = NativeGit::new(allowed);
        let cwd = repository.path().to_string_lossy();
        let first = native_git.full_diff(&cwd, "app.ts", false, true).unwrap();
        let second = native_git.full_diff(&cwd, "app.ts", false, true).unwrap();
        assert_eq!(first, second);
        assert_eq!(native_git.diff_cache.lock().unwrap().entries.len(), 1);

        std::fs::write(
            repository.path().join("app.ts"),
            "export const value = 333;\n",
        )
        .unwrap();
        let refreshed = native_git.full_diff(&cwd, "app.ts", false, true).unwrap();
        assert_ne!(second, refreshed);
        assert!(
            refreshed
                .unwrap()
                .compact_lines
                .unwrap()
                .iter()
                .any(|line| { line.content.contains("export const value = 333;") })
        );
    }
}
