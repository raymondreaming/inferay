use crate::unix_millis as now_millis;
use inferay_core::utf16_length as js_string_len;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use inferay_core::path_security::{AllowedPaths, is_within_directory, resolve_lexically};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{Mutex, MutexGuard, OnceCell};
use uuid::Uuid;
use walkdir::WalkDir;

const MAX_CHECKPOINTS_PER_PANE: usize = 10;
const MAX_TOTAL_CHECKPOINTS: usize = 50;
const MAX_FILE_SIZE: u64 = 1_000_000;
const MAX_INLINE_DIFFS: usize = 25;
const MAX_INLINE_DIFF_CHARS: usize = 2_000_000;

const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "mp3", "mp4", "wav", "mov", "avi", "zip",
    "tar", "gz", "bz2", "7z", "pdf", "woff", "woff2", "ttf", "eot", "o", "a", "dylib", "so", "dll",
    "exe",
];

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".build",
    "build",
    "dist",
    ".next",
    ".turbo",
    ".cache",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSnapshot {
    relative_path: String,
    blob_before: Option<String>,
    blob_after: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Checkpoint {
    id: String,
    pane_id: String,
    cwd: PathBuf,
    git_root: Option<PathBuf>,
    head_sha: Option<String>,
    timestamp: u64,
    user_message: String,
    #[serde(default, skip_serializing)]
    before_snapshot: HashMap<String, Option<String>>,
    changed_files: Vec<FileSnapshot>,
    reverted: bool,
    #[serde(default)]
    after_message_id: Option<String>,
}

impl Checkpoint {
    fn root(&self) -> &Path {
        self.git_root.as_deref().unwrap_or(&self.cwd)
    }

    fn relative_path(&self, path: &Path) -> Result<Option<String>, String> {
        let absolute =
            resolve_lexically(&self.cwd.join(path)).map_err(|error| error.to_string())?;
        let relative = path_relative(self.root(), &absolute);
        Ok((is_within_directory(&absolute, self.root())
            && !relative.as_os_str().is_empty()
            && !is_skipped_path(&relative)
            && !is_binary(&relative))
        .then(|| path_to_string(&relative)))
    }

    async fn before(&self, path: &str) -> Option<String> {
        if let Some(before) = self.before_snapshot.get(path) {
            before.clone()
        } else if let Some(git_root) = &self.git_root {
            git_snapshot_blob(git_root, self.head_sha.as_deref(), path).await
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointInlineDiff {
    pub path: String,
    pub old_string: String,
    pub new_string: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckpointAction {
    Created,
    Modified,
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CheckpointChangedFile {
    pub path: String,
    pub action: CheckpointAction,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointMeta {
    pub id: String,
    pub pane_id: String,
    pub timestamp: u64,
    pub user_message: String,
    pub changed_file_count: usize,
    pub changed_files: Vec<CheckpointChangedFile>,
    pub reverted: bool,
    pub after_message_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertResult {
    pub ok: bool,
    pub restored_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct CheckpointService {
    allowed_paths: AllowedPaths,
    checkpoints_path: PathBuf,
    client_storage_path: PathBuf,
    store: Arc<OnceCell<Mutex<Vec<Checkpoint>>>>,
    save_lock: Arc<Mutex<()>>,
}

impl CheckpointService {
    pub fn new(
        allowed_paths: AllowedPaths,
        checkpoints_path: PathBuf,
        client_storage_path: PathBuf,
    ) -> Self {
        Self {
            allowed_paths,
            checkpoints_path,
            client_storage_path,
            store: Arc::new(OnceCell::new()),
            save_lock: Arc::new(Mutex::new(())),
        }
    }

    async fn checkpoints(&self) -> MutexGuard<'_, Vec<Checkpoint>> {
        self.store
            .get_or_init(|| async {
                let mut checkpoints: Vec<Checkpoint> =
                    match tokio::fs::read(&self.checkpoints_path).await {
                        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                            eprintln!("[Checkpoint] Failed to load: {error}");
                            Vec::new()
                        }),
                        Err(_) => Vec::new(),
                    };
                // Adopt associations written by older renderers; native snapshots own new links.
                if let Ok(entries) = super::read_client_storage(&self.client_storage_path).await {
                    for checkpoint in &mut checkpoints {
                        if checkpoint.after_message_id.is_some() {
                            continue;
                        }
                        let links = entries
                            .get(&format!("inferay-checkpoints-{}", checkpoint.pane_id))
                            .and_then(serde_json::Value::as_str)
                            .and_then(|text| {
                                serde_json::from_str::<Vec<serde_json::Value>>(text).ok()
                            })
                            .unwrap_or_default();
                        checkpoint.after_message_id = links
                            .iter()
                            .find(|link| link["id"] == checkpoint.id)
                            .and_then(|link| link["afterMessageId"].as_str())
                            .map(str::to_owned);
                    }
                }
                Mutex::new(checkpoints)
            })
            .await
            .lock()
            .await
    }

    pub async fn create_checkpoint(
        &self,
        pane_id: String,
        cwd: &Path,
        user_message: String,
    ) -> Result<String, String> {
        let safe_cwd = self
            .allowed_paths
            .resolve_allowed_local_path(cwd)
            .ok_or_else(|| "Checkpoint cwd is outside allowed roots".to_owned())?;
        let id = Uuid::new_v4().to_string();
        let git_root = get_git_root(&safe_cwd).await;

        let (head_sha, before_snapshot) = if let Some(git_root) = git_root.as_ref() {
            if !is_within_directory(&safe_cwd, git_root) {
                return Err("Checkpoint cwd is outside git root".to_owned());
            }
            let cwd_relative = path_relative(git_root, &safe_cwd);
            (
                get_head_sha(git_root).await,
                capture_git_snapshot(git_root, &cwd_relative).await?,
            )
        } else {
            (None, capture_file_snapshot(&safe_cwd).await?)
        };

        let checkpoint = Checkpoint {
            id: id.clone(),
            pane_id: pane_id.clone(),
            cwd: safe_cwd,
            git_root,
            head_sha,
            timestamp: now_millis(),
            user_message,
            before_snapshot,
            changed_files: Vec::new(),
            reverted: false,
            after_message_id: None,
        };

        let mut store = self.checkpoints().await;
        store.push(checkpoint);
        while store.iter().filter(|cp| cp.pane_id == pane_id).count() > MAX_CHECKPOINTS_PER_PANE {
            let index = store.iter().position(|cp| cp.pane_id == pane_id).unwrap();
            store.remove(index);
        }
        Ok(id)
    }

    pub async fn finalize_checkpoint(
        &self,
        checkpoint_id: &str,
        touched_paths: &[String],
        after_message_id: Option<String>,
    ) -> Result<Option<CheckpointMeta>, String> {
        let checkpoint = {
            let store = self.checkpoints().await;
            store.iter().find(|cp| cp.id == checkpoint_id).cloned()
        };
        let Some(mut checkpoint) = checkpoint else {
            return Ok(None);
        };

        let root = checkpoint.root();
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        for path in touched_paths {
            if let Some(relative) = checkpoint.relative_path(Path::new(path))?
                && seen.insert(relative.clone())
            {
                paths.push(relative);
            }
        }

        let mut changed_files = Vec::new();
        for path in paths {
            let before = checkpoint.before(&path).await;
            let after_content = safe_read_file(&root.join(&path)).await;
            let after = if checkpoint.git_root.is_some() {
                match after_content {
                    Some(content) => Some(store_blob(root, &content).await?),
                    None => None,
                }
            } else {
                after_content
            };
            if before != after {
                changed_files.push(FileSnapshot {
                    relative_path: path,
                    blob_before: before,
                    blob_after: after,
                });
            }
        }

        checkpoint.changed_files = changed_files;
        checkpoint.after_message_id = after_message_id;
        let meta = to_meta(&checkpoint);
        {
            let mut store = self.checkpoints().await;
            if let Some(current) = store.iter_mut().find(|cp| cp.id == checkpoint_id) {
                current.changed_files = checkpoint.changed_files;
                current.after_message_id = checkpoint.after_message_id;
            }
        }
        self.save().await?;
        Ok(Some(meta))
    }

    pub async fn revert_to_checkpoint(&self, checkpoint_id: &str, pane_id: &str) -> RevertResult {
        let checkpoint = {
            let store = self.checkpoints().await;
            store.iter().find(|cp| cp.id == checkpoint_id).cloned()
        };
        let Some(checkpoint) = checkpoint.filter(|checkpoint| checkpoint.pane_id == pane_id) else {
            return revert_error("Checkpoint not found", Vec::new());
        };
        if checkpoint.changed_files.is_empty() {
            return revert_ok(Vec::new());
        }

        let root = checkpoint.root();
        let mut restored_files = Vec::new();
        for file in &checkpoint.changed_files {
            let full_path = root.join(&file.relative_path);
            let result = if file.blob_before.is_none() && file.blob_after.is_some() {
                tokio::fs::remove_file(&full_path).await
            } else if let Some(before) = file.blob_before.as_ref() {
                match resolve_content(&checkpoint, before).await {
                    Some(content) => {
                        if file.blob_after.is_none()
                            && let Some(parent) = full_path.parent()
                            && let Err(error) = tokio::fs::create_dir_all(parent).await
                        {
                            return revert_error(
                                format!("Failed to restore {}: {error}", file.relative_path),
                                restored_files,
                            );
                        }
                        tokio::fs::write(&full_path, content).await
                    }
                    None => continue,
                }
            } else {
                continue;
            };
            if let Err(error) = result {
                return revert_error(
                    format!("Failed to restore {}: {error}", file.relative_path),
                    restored_files,
                );
            }
            restored_files.push(file.relative_path.clone());
        }

        {
            let mut store = self.checkpoints().await;
            if let Some(current) = store.iter_mut().find(|cp| cp.id == checkpoint_id) {
                current.reverted = true;
            }
        }
        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = service.save().await {
                eprintln!("[Checkpoint] save failed: {error}");
            }
        });
        revert_ok(restored_files)
    }

    pub async fn clear_checkpoints(&self, pane_id: &str) -> Result<(), String> {
        self.checkpoints()
            .await
            .retain(|checkpoint| checkpoint.pane_id != pane_id);
        self.save().await
    }

    pub async fn list_checkpoints(&self, pane_id: &str) -> Vec<CheckpointMeta> {
        let mut seen = HashSet::new();
        self.checkpoints()
            .await
            .iter()
            .filter(|cp| {
                cp.pane_id == pane_id
                    && !cp.changed_files.is_empty()
                    && cp
                        .after_message_id
                        .as_ref()
                        .is_some_and(|id| seen.insert(id.clone()))
            })
            .map(to_meta)
            .collect()
    }

    pub async fn get_inline_diffs(
        &self,
        checkpoint_id: &str,
        touched_paths: Option<&[PathBuf]>,
    ) -> Vec<CheckpointInlineDiff> {
        let checkpoint = self
            .checkpoints()
            .await
            .iter()
            .find(|cp| cp.id == checkpoint_id)
            .cloned();
        let Some(checkpoint) = checkpoint else {
            return Vec::new();
        };
        let files: Vec<_> = if let Some(paths) = touched_paths {
            let mut seen = HashSet::new();
            paths
                .iter()
                .filter_map(|path| checkpoint.relative_path(path).ok().flatten())
                .filter(|path| seen.insert(path.clone()))
                .map(|path| (path, None))
                .collect()
        } else {
            checkpoint
                .changed_files
                .iter()
                .map(|file| (file.relative_path.clone(), Some(file)))
                .collect()
        };
        let mut diffs = Vec::new();
        let mut total_chars = 0;
        for (path, saved) in files {
            if diffs.len() >= MAX_INLINE_DIFFS {
                break;
            }
            let before_ref = match saved {
                Some(file) => file.blob_before.clone(),
                None => checkpoint.before(&path).await,
            };
            let Some(before_ref) = before_ref else {
                continue;
            };
            let after = match saved {
                Some(file) => match &file.blob_after {
                    Some(blob) => resolve_content(&checkpoint, blob).await,
                    None => None,
                },
                None => safe_read_file(&checkpoint.root().join(&path)).await,
            };
            let (Some(before), Some(after)) =
                (resolve_content(&checkpoint, &before_ref).await, after)
            else {
                continue;
            };
            if before == after {
                continue;
            }
            let chars = js_string_len(&before) + js_string_len(&after);
            if chars > MAX_FILE_SIZE as usize || total_chars + chars > MAX_INLINE_DIFF_CHARS {
                continue;
            }
            diffs.push(CheckpointInlineDiff {
                path,
                old_string: before,
                new_string: after,
            });
            total_chars += chars;
        }
        diffs
    }

    pub async fn save(&self) -> Result<(), String> {
        let _save_guard = self.save_lock.lock().await;
        let value = {
            let mut store = self.checkpoints().await;
            store.sort_by_key(|cp| cp.timestamp);
            let excess = store.len().saturating_sub(MAX_TOTAL_CHECKPOINTS);
            store.drain(..excess);
            serde_json::to_vec(&*store).map_err(|error| error.to_string())?
        };
        crate::atomic_write::overwrite(&self.checkpoints_path, &value).await
    }
}

fn to_meta(checkpoint: &Checkpoint) -> CheckpointMeta {
    CheckpointMeta {
        id: checkpoint.id.clone(),
        pane_id: checkpoint.pane_id.clone(),
        timestamp: checkpoint.timestamp,
        user_message: checkpoint.user_message.clone(),
        changed_file_count: checkpoint.changed_files.len(),
        changed_files: checkpoint
            .changed_files
            .iter()
            .map(|file| CheckpointChangedFile {
                path: file.relative_path.clone(),
                action: if file.blob_before.is_none() {
                    CheckpointAction::Created
                } else if file.blob_after.is_none() {
                    CheckpointAction::Deleted
                } else {
                    CheckpointAction::Modified
                },
            })
            .collect(),
        reverted: checkpoint.reverted,
        after_message_id: checkpoint.after_message_id.clone(),
    }
}

fn parse_porcelain(output: &str) -> Vec<(String, String)> {
    output
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut path = line.get(3..).unwrap_or_default().trim().to_owned();
            if let Some((_, renamed)) = path.split_once(" -> ") {
                path = renamed.to_owned();
            }
            if path.starts_with('"') && path.ends_with('"') {
                path = path[1..path.len() - 1].to_owned();
            }
            (line.get(..2).unwrap_or_default().to_owned(), path)
        })
        .collect()
}

async fn capture_git_snapshot(
    git_root: &Path,
    cwd_relative: &Path,
) -> Result<HashMap<String, Option<String>>, String> {
    let mut args = vec!["-c", "core.fsmonitor=false", "status", "--porcelain"];
    let relative_string = path_to_string(cwd_relative);
    if !relative_string.is_empty() {
        args.extend(["--", &relative_string]);
    }
    let output = run_git(&args, git_root, None)
        .await
        .map_err(|_| "Unable to capture Git working tree state".to_owned())?;
    let mut snapshot = HashMap::new();
    for (status, path) in parse_porcelain(&output) {
        if is_binary(Path::new(&path)) || is_skipped_path(Path::new(&path)) {
            continue;
        }
        if status.as_bytes().first() == Some(&b'D') || status.as_bytes().get(1) == Some(&b'D') {
            snapshot.insert(path, None);
        } else {
            let content = safe_read_file(&git_root.join(&path)).await;
            let blob = match content {
                Some(content) => Some(store_blob(git_root, &content).await?),
                None => None,
            };
            snapshot.insert(path, blob);
        }
    }
    Ok(snapshot)
}

async fn capture_file_snapshot(cwd: &Path) -> Result<HashMap<String, Option<String>>, String> {
    let root = cwd.to_owned();
    let files = tokio::task::spawn_blocking(move || {
        if !root.is_dir() {
            return Err("Checkpoint directory is unavailable".to_owned());
        }
        WalkDir::new(root)
            .min_depth(1)
            .into_iter()
            .filter_entry(|entry| !SKIP_DIRS.iter().any(|name| entry.file_name() == *name))
            .filter_map(|entry| match entry {
                Ok(entry) if entry.file_type().is_file() && !is_binary(entry.path()) => {
                    Some(Ok(entry.into_path()))
                }
                Ok(_) => None,
                Err(error) => Some(Err(error.to_string())),
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|error| error.to_string())??;
    let mut snapshot = HashMap::new();
    for path in files {
        if let Some(content) = safe_read_file(&path).await {
            snapshot.insert(path_to_string(&path_relative(cwd, &path)), Some(content));
        }
    }
    Ok(snapshot)
}

async fn safe_read_file(path: &Path) -> Option<String> {
    if is_binary(path) {
        return None;
    }
    let metadata = tokio::fs::metadata(path).await.ok()?;
    if metadata.len() > MAX_FILE_SIZE {
        return None;
    }
    let bytes = tokio::fs::read(path).await.ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

async fn get_git_root(cwd: &Path) -> Option<PathBuf> {
    let output = run_git(&["rev-parse", "--show-toplevel"], cwd, None)
        .await
        .ok()?;
    (!output.trim().is_empty()).then(|| PathBuf::from(output.trim()))
}

async fn get_head_sha(git_root: &Path) -> Option<String> {
    let output = run_git(&["rev-parse", "HEAD"], git_root, None).await.ok()?;
    (!output.trim().is_empty()).then(|| output.trim().to_owned())
}

async fn git_snapshot_blob(
    git_root: &Path,
    commit_sha: Option<&str>,
    relative_path: &str,
) -> Option<String> {
    let spec = format!("{}:{relative_path}", commit_sha.unwrap_or("HEAD"));
    let content = run_git(&["show", &spec], git_root, None).await.ok()?;
    store_blob(git_root, &content).await.ok()
}

async fn store_blob(git_root: &Path, content: &str) -> Result<String, String> {
    run_git(&["hash-object", "-w", "--stdin"], git_root, Some(content))
        .await
        .map(|output| output.trim().to_owned())
}

async fn resolve_content(checkpoint: &Checkpoint, blob_or_content: &str) -> Option<String> {
    if let Some(git_root) = &checkpoint.git_root {
        run_git(&["cat-file", "-p", blob_or_content], git_root, None)
            .await
            .ok()
    } else {
        Some(blob_or_content.to_owned())
    }
}

async fn run_git(args: &[&str], cwd: &Path, input: Option<&str>) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .kill_on_drop(true)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    if let Some(input) = input {
        child
            .stdin
            .take()
            .expect("piped stdin")
            .write_all(input.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Git command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn is_binary(path: &Path) -> bool {
    let value = path_to_string(path);
    let extension = value
        .rfind('.')
        .map_or(value.as_str(), |index| &value[index + 1..]);
    BINARY_EXTENSIONS
        .iter()
        .any(|binary| extension.eq_ignore_ascii_case(binary))
}

fn is_skipped_path(path: &Path) -> bool {
    path_to_string(path)
        .split(['/', '\\'])
        .any(|component| SKIP_DIRS.contains(&component))
}

fn path_relative(root: &Path, path: &Path) -> PathBuf {
    path.strip_prefix(root).unwrap_or(path).to_path_buf()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn revert_ok(restored_files: Vec<String>) -> RevertResult {
    RevertResult {
        ok: true,
        restored_files,
        error: None,
    }
}

fn revert_error(error: impl Into<String>, restored_files: Vec<String>) -> RevertResult {
    RevertResult {
        ok: false,
        restored_files,
        error: Some(error.into()),
    }
}
