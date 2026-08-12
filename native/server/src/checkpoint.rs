use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use inferay_core::path_security::{AllowedPaths, is_within_directory, resolve_lexically};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertResult {
    pub ok: bool,
    pub restored_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Default)]
struct CheckpointStore {
    by_pane: HashMap<String, Vec<Checkpoint>>,
    pane_by_id: HashMap<String, String>,
    pane_order: Vec<String>,
}

#[derive(Clone)]
pub struct CheckpointService {
    allowed_paths: AllowedPaths,
    checkpoints_path: PathBuf,
    store: Arc<Mutex<CheckpointStore>>,
    save_lock: Arc<Mutex<()>>,
}

impl CheckpointService {
    pub fn new(allowed_paths: AllowedPaths, checkpoints_path: PathBuf) -> Self {
        Self {
            allowed_paths,
            checkpoints_path,
            store: Arc::new(Mutex::new(CheckpointStore::default())),
            save_lock: Arc::new(Mutex::new(())),
        }
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
        };

        let mut store = self.store.lock().await;
        if !store.by_pane.contains_key(&pane_id) {
            store.pane_order.push(pane_id.clone());
        }
        store
            .by_pane
            .entry(pane_id.clone())
            .or_default()
            .push(checkpoint);
        store.pane_by_id.insert(id.clone(), pane_id.clone());
        let mut removed_ids = Vec::new();
        if let Some(list) = store.by_pane.get_mut(&pane_id) {
            while list.len() > MAX_CHECKPOINTS_PER_PANE {
                removed_ids.push(list.remove(0).id);
            }
        }
        for removed_id in removed_ids {
            store.pane_by_id.remove(&removed_id);
        }
        Ok(id)
    }

    pub async fn finalize_checkpoint(
        &self,
        checkpoint_id: &str,
        touched_paths: &[String],
    ) -> Result<Option<CheckpointMeta>, String> {
        let checkpoint = {
            let store = self.store.lock().await;
            find_checkpoint(&store, checkpoint_id).cloned()
        };
        let Some(mut checkpoint) = checkpoint else {
            return Ok(None);
        };

        let root = checkpoint
            .git_root
            .as_deref()
            .unwrap_or(checkpoint.cwd.as_path());
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        for path in touched_paths {
            let candidate = Path::new(path);
            let unresolved = if candidate.is_absolute() {
                candidate.to_path_buf()
            } else {
                checkpoint.cwd.join(candidate)
            };
            let absolute = resolve_lexically(&unresolved).map_err(|error| error.to_string())?;
            let relative = path_relative(root, &absolute);
            if is_within_directory(&absolute, root)
                && !relative.as_os_str().is_empty()
                && !is_skipped_path(&relative)
                && !is_binary(&relative)
            {
                let relative = path_to_string(&relative);
                if seen.insert(relative.clone()) {
                    paths.push(relative);
                }
            }
        }

        let mut changed_files = Vec::new();
        for path in paths {
            let before = if let Some(before) = checkpoint.before_snapshot.get(&path) {
                before.clone()
            } else if let Some(git_root) = checkpoint.git_root.as_ref() {
                git_snapshot_blob(git_root, checkpoint.head_sha.as_deref(), &path).await
            } else {
                None
            };
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
        let meta = to_meta(&checkpoint);
        {
            let mut store = self.store.lock().await;
            if let Some(current) = find_checkpoint_mut(&mut store, checkpoint_id) {
                current.changed_files = checkpoint.changed_files;
            }
        }
        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = service.save().await {
                eprintln!("[Checkpoint] save failed: {error}");
            }
        });
        Ok(Some(meta))
    }

    pub async fn revert_to_checkpoint(&self, checkpoint_id: &str, pane_id: &str) -> RevertResult {
        let checkpoint = {
            let store = self.store.lock().await;
            find_checkpoint(&store, checkpoint_id).cloned()
        };
        let Some(checkpoint) = checkpoint.filter(|checkpoint| checkpoint.pane_id == pane_id) else {
            return revert_error("Checkpoint not found", Vec::new());
        };
        if checkpoint.changed_files.is_empty() {
            return revert_ok(Vec::new());
        }

        let root = checkpoint
            .git_root
            .as_deref()
            .unwrap_or(checkpoint.cwd.as_path());
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
            let mut store = self.store.lock().await;
            if let Some(current) = find_checkpoint_mut(&mut store, checkpoint_id) {
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

    pub async fn list_checkpoints(&self, pane_id: &str) -> Vec<CheckpointMeta> {
        self.store
            .lock()
            .await
            .by_pane
            .get(pane_id)
            .map(|list| list.iter().map(to_meta).collect())
            .unwrap_or_default()
    }

    pub async fn get_checkpoint_meta(&self, checkpoint_id: &str) -> Option<CheckpointMeta> {
        let store = self.store.lock().await;
        find_checkpoint(&store, checkpoint_id).map(to_meta)
    }

    pub async fn get_inline_diffs(&self, checkpoint_id: &str) -> Vec<CheckpointInlineDiff> {
        let checkpoint = {
            let store = self.store.lock().await;
            find_checkpoint(&store, checkpoint_id).cloned()
        };
        let Some(checkpoint) = checkpoint else {
            return Vec::new();
        };
        let mut diffs = Vec::new();
        let mut total_chars = 0;
        for file in &checkpoint.changed_files {
            if diffs.len() >= MAX_INLINE_DIFFS {
                break;
            }
            let (Some(before_ref), Some(after_ref)) =
                (file.blob_before.as_ref(), file.blob_after.as_ref())
            else {
                continue;
            };
            let (Some(before), Some(after)) = (
                resolve_content(&checkpoint, before_ref).await,
                resolve_content(&checkpoint, after_ref).await,
            ) else {
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
                path: file.relative_path.clone(),
                old_string: before,
                new_string: after,
            });
            total_chars += chars;
        }
        diffs
    }

    pub async fn preview_inline_diffs(
        &self,
        checkpoint_id: &str,
        touched_paths: &[PathBuf],
    ) -> Vec<CheckpointInlineDiff> {
        let checkpoint = {
            let store = self.store.lock().await;
            find_checkpoint(&store, checkpoint_id).cloned()
        };
        let Some(checkpoint) = checkpoint else {
            return Vec::new();
        };
        let root = checkpoint
            .git_root
            .as_deref()
            .unwrap_or(checkpoint.cwd.as_path());
        let mut seen = HashSet::new();
        let mut diffs = Vec::new();
        let mut total_chars = 0;
        for path in touched_paths {
            let unresolved = if path.is_absolute() {
                path.clone()
            } else {
                checkpoint.cwd.join(path)
            };
            let Ok(absolute) = resolve_lexically(&unresolved) else {
                continue;
            };
            let relative = path_relative(root, &absolute);
            if !is_within_directory(&absolute, root)
                || relative.as_os_str().is_empty()
                || is_skipped_path(&relative)
                || is_binary(&relative)
            {
                continue;
            }
            let relative = path_to_string(&relative);
            if !seen.insert(relative.clone()) || diffs.len() >= MAX_INLINE_DIFFS {
                continue;
            }
            let before_ref = if let Some(before) = checkpoint.before_snapshot.get(&relative) {
                before.clone()
            } else if let Some(git_root) = checkpoint.git_root.as_ref() {
                git_snapshot_blob(git_root, checkpoint.head_sha.as_deref(), &relative).await
            } else {
                None
            };
            let (Some(before_ref), Some(after)) =
                (before_ref, safe_read_file(&root.join(&relative)).await)
            else {
                continue;
            };
            let Some(before) = resolve_content(&checkpoint, &before_ref).await else {
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
                path: relative,
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
            let mut store = self.store.lock().await;
            while store.by_pane.values().map(Vec::len).sum::<usize>() > MAX_TOTAL_CHECKPOINTS {
                let mut oldest_time = u64::MAX;
                let mut oldest_pane = None;
                for pane in &store.pane_order {
                    let Some(oldest) = store.by_pane.get(pane).and_then(|list| list.first()) else {
                        continue;
                    };
                    if oldest.timestamp < oldest_time {
                        oldest_time = oldest.timestamp;
                        oldest_pane = Some(pane.clone());
                    }
                }
                let Some(oldest_pane) = oldest_pane else {
                    break;
                };
                let list = store.by_pane.get_mut(&oldest_pane).expect("pane exists");
                let removed = list.remove(0);
                let empty = list.is_empty();
                store.pane_by_id.remove(&removed.id);
                if empty {
                    store.by_pane.remove(&oldest_pane);
                    store.pane_order.retain(|pane| pane != &oldest_pane);
                }
            }
            serde_json::to_value(&store.by_pane).map_err(|error| error.to_string())?
        };
        atomic_write_json(&self.checkpoints_path, &value).await
    }

    pub async fn load(&self) {
        let bytes = match tokio::fs::read(&self.checkpoints_path).await {
            Ok(bytes) => bytes,
            Err(_) => return,
        };
        let raw: Value = match serde_json::from_slice(&bytes) {
            Ok(raw) => raw,
            Err(_) => return,
        };
        let result = async {
            let Some(panes) = raw.as_object() else {
                return Ok::<_, Box<dyn std::error::Error + Send + Sync>>(());
            };
            let mut store = self.store.lock().await;
            for (pane_id, list) in panes {
                let Some(list) = list.as_array() else {
                    continue;
                };
                let mut valid = Vec::new();
                for raw_checkpoint in list {
                    if has_legacy_content_before(raw_checkpoint) {
                        continue;
                    }
                    let mut value = raw_checkpoint.clone();
                    let Some(object) = value.as_object_mut() else {
                        continue;
                    };
                    object.entry("headSha").or_insert(Value::Null);
                    object
                        .entry("beforeSnapshot")
                        .or_insert_with(|| Value::Object(Map::new()));
                    if let Ok(checkpoint) = serde_json::from_value::<Checkpoint>(value) {
                        valid.push(checkpoint);
                    }
                }
                if !valid.is_empty() {
                    for checkpoint in &valid {
                        store
                            .pane_by_id
                            .insert(checkpoint.id.clone(), checkpoint.pane_id.clone());
                    }
                    if !store.by_pane.contains_key(pane_id) {
                        store.pane_order.push(pane_id.clone());
                    }
                    store.by_pane.insert(pane_id.clone(), valid);
                }
            }
            Ok(())
        }
        .await;
        if let Err(error) = result {
            eprintln!("[Checkpoint] Failed to load: {error}");
        }
    }
}

fn find_checkpoint<'a>(store: &'a CheckpointStore, id: &str) -> Option<&'a Checkpoint> {
    let pane = store.pane_by_id.get(id)?;
    store.by_pane.get(pane)?.iter().find(|cp| cp.id == id)
}

fn find_checkpoint_mut<'a>(store: &'a mut CheckpointStore, id: &str) -> Option<&'a mut Checkpoint> {
    let pane = store.pane_by_id.get(id)?.clone();
    store
        .by_pane
        .get_mut(&pane)?
        .iter_mut()
        .find(|cp| cp.id == id)
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
    let output = run_git(&args, git_root, false).await;
    if output.code != 0 {
        return Err("Unable to capture Git working tree state".to_owned());
    }
    let mut snapshot = HashMap::new();
    for (status, path) in parse_porcelain(&output.stdout) {
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
    let mut files = Vec::new();
    walk_dir(cwd, cwd, &mut files).await?;
    let mut snapshot = HashMap::new();
    for relative in files {
        if let Some(content) = safe_read_file(&cwd.join(&relative)).await {
            snapshot.insert(path_to_string(&relative), Some(content));
        }
    }
    Ok(snapshot)
}

fn walk_dir<'a>(
    dir: &'a Path,
    base: &'a Path,
    files: &'a mut Vec<PathBuf>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let mut entries = tokio::fs::read_dir(dir)
            .await
            .map_err(|error| error.to_string())?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            let name = entry.file_name();
            if SKIP_DIRS.iter().any(|skip| name == *skip) {
                continue;
            }
            let file_type = entry.file_type().await.map_err(|error| error.to_string())?;
            let full_path = entry.path();
            if file_type.is_dir() {
                walk_dir(&full_path, base, files).await?;
            } else if file_type.is_file()
                && !is_binary(&full_path)
                && let Ok(relative) = full_path.strip_prefix(base)
            {
                files.push(relative.to_path_buf());
            }
        }
        Ok(())
    })
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
    let result = run_git(&["rev-parse", "--show-toplevel"], cwd, true).await;
    (result.code == 0 && !result.stdout.is_empty()).then(|| PathBuf::from(result.stdout))
}

async fn get_head_sha(git_root: &Path) -> Option<String> {
    let result = run_git(&["rev-parse", "HEAD"], git_root, true).await;
    (result.code == 0 && !result.stdout.is_empty()).then_some(result.stdout)
}

async fn git_snapshot_blob(
    git_root: &Path,
    commit_sha: Option<&str>,
    relative_path: &str,
) -> Option<String> {
    let spec = format!("{}:{relative_path}", commit_sha.unwrap_or("HEAD"));
    let result = run_git(&["show", &spec], git_root, false).await;
    if result.code == 0 {
        store_blob(git_root, &result.stdout).await.ok()
    } else {
        None
    }
}

async fn store_blob(git_root: &Path, content: &str) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(["hash-object", "-w", "--stdin"])
        .current_dir(git_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(content.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

async fn resolve_content(checkpoint: &Checkpoint, blob_or_content: &str) -> Option<String> {
    if let Some(git_root) = checkpoint.git_root.as_ref() {
        let result = run_git(&["cat-file", "-p", blob_or_content], git_root, false).await;
        (result.code == 0).then_some(result.stdout)
    } else {
        Some(blob_or_content.to_owned())
    }
}

struct GitOutput {
    code: i32,
    stdout: String,
}

async fn run_git(args: &[&str], cwd: &Path, trim_stdout: bool) -> GitOutput {
    let result = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;
    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            GitOutput {
                code: output.status.code().unwrap_or(1),
                stdout: if trim_stdout {
                    stdout.trim().to_owned()
                } else {
                    stdout
                },
            }
        }
        Err(_) => GitOutput {
            code: 1,
            stdout: String::new(),
        },
    }
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

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn js_string_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn has_legacy_content_before(value: &Value) -> bool {
    value
        .get("changedFiles")
        .and_then(Value::as_array)
        .is_some_and(|files| {
            files.iter().any(|file| {
                file.as_object()
                    .is_some_and(|object| object.contains_key("contentBefore"))
            })
        })
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

async fn atomic_write_json(path: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    crate::atomic_write::overwrite(path, &bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn service(root: &TempDir) -> CheckpointService {
        CheckpointService::new(
            AllowedPaths::new(root.path(), root.path()).unwrap(),
            root.path().join("checkpoints.json"),
        )
    }

    #[test]
    fn parses_porcelain_with_the_existing_rename_and_quote_rules() {
        assert_eq!(
            parse_porcelain(" M src/main.rs\nR  old.ts -> new.ts\n?? \"space name.ts\"\n"),
            vec![
                (" M".to_owned(), "src/main.rs".to_owned()),
                ("R ".to_owned(), "new.ts".to_owned()),
                ("??".to_owned(), "space name.ts".to_owned()),
            ]
        );
    }

    #[tokio::test]
    async fn non_git_checkpoint_records_and_reverts_created_modified_and_deleted_files() {
        let root = TempDir::new().unwrap();
        tokio::fs::write(root.path().join("modified.txt"), "before")
            .await
            .unwrap();
        tokio::fs::write(root.path().join("deleted.txt"), "deleted")
            .await
            .unwrap();
        let service = service(&root);
        let id = service
            .create_checkpoint("pane".into(), root.path(), "message".into())
            .await
            .unwrap();

        tokio::fs::write(root.path().join("modified.txt"), "after")
            .await
            .unwrap();
        tokio::fs::remove_file(root.path().join("deleted.txt"))
            .await
            .unwrap();
        tokio::fs::write(root.path().join("created.txt"), "created")
            .await
            .unwrap();
        let meta = service
            .finalize_checkpoint(
                &id,
                &[
                    "modified.txt".into(),
                    "deleted.txt".into(),
                    "created.txt".into(),
                ],
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(meta.changed_file_count, 3);

        let result = service.revert_to_checkpoint(&id, "pane").await;
        assert!(result.ok);
        assert_eq!(
            tokio::fs::read_to_string(root.path().join("modified.txt"))
                .await
                .unwrap(),
            "before"
        );
        assert_eq!(
            tokio::fs::read_to_string(root.path().join("deleted.txt"))
                .await
                .unwrap(),
            "deleted"
        );
        assert!(!root.path().join("created.txt").exists());
    }

    #[tokio::test]
    async fn git_checkpoint_uses_blobs_and_restores_the_original_content() {
        let root = TempDir::new().unwrap();
        let git_root = root.path().canonicalize().unwrap();
        run_git(&["init"], &git_root, true).await;
        run_git(
            &["config", "user.email", "test@example.com"],
            &git_root,
            true,
        )
        .await;
        run_git(&["config", "user.name", "Test"], &git_root, true).await;
        tokio::fs::write(git_root.join("tracked.txt"), "committed\n")
            .await
            .unwrap();
        run_git(&["add", "tracked.txt"], &git_root, true).await;
        run_git(&["commit", "-m", "initial"], &git_root, true).await;

        let service = CheckpointService::new(
            AllowedPaths::new(&git_root, &git_root).unwrap(),
            git_root.join("checkpoints.json"),
        );
        let id = service
            .create_checkpoint("pane".into(), &git_root, "message".into())
            .await
            .unwrap();
        tokio::fs::write(git_root.join("tracked.txt"), "changed\n")
            .await
            .unwrap();
        let meta = service
            .finalize_checkpoint(&id, &["tracked.txt".into()])
            .await
            .unwrap()
            .unwrap();
        assert_eq!(meta.changed_files[0].action, CheckpointAction::Modified);
        assert_eq!(
            service.get_inline_diffs(&id).await[0].old_string,
            "committed\n"
        );

        assert!(service.revert_to_checkpoint(&id, "pane").await.ok);
        assert_eq!(
            tokio::fs::read_to_string(git_root.join("tracked.txt"))
                .await
                .unwrap(),
            "committed\n"
        );
    }

    #[tokio::test]
    async fn finalize_only_records_explicitly_touched_paths() {
        let root = TempDir::new().unwrap();
        tokio::fs::write(root.path().join("touched.txt"), "before")
            .await
            .unwrap();
        tokio::fs::write(root.path().join("unrelated.txt"), "before")
            .await
            .unwrap();
        let service = service(&root);
        let id = service
            .create_checkpoint("pane".into(), root.path(), "message".into())
            .await
            .unwrap();

        tokio::fs::write(root.path().join("touched.txt"), "after")
            .await
            .unwrap();
        tokio::fs::write(root.path().join("unrelated.txt"), "also after")
            .await
            .unwrap();
        let meta = service
            .finalize_checkpoint(&id, &["touched.txt".into()])
            .await
            .unwrap()
            .unwrap();

        assert_eq!(meta.changed_file_count, 1);
        assert_eq!(meta.changed_files[0].path, "touched.txt");
    }

    #[tokio::test]
    async fn enforces_the_exact_per_pane_and_global_limits_when_saving() {
        let root = TempDir::new().unwrap();
        let service = service(&root);
        for pane_index in 0..6 {
            let pane = format!("pane-{pane_index}");
            for checkpoint_index in 0..10 {
                service
                    .create_checkpoint(
                        pane.clone(),
                        root.path(),
                        format!("{pane_index}-{checkpoint_index}"),
                    )
                    .await
                    .unwrap();
            }
        }
        service.save().await.unwrap();
        let total: usize = {
            let store = service.store.lock().await;
            store.by_pane.values().map(Vec::len).sum()
        };
        assert_eq!(total, MAX_TOTAL_CHECKPOINTS);

        for checkpoint_index in 0..12 {
            service
                .create_checkpoint(
                    "limited".into(),
                    root.path(),
                    format!("limited-{checkpoint_index}"),
                )
                .await
                .unwrap();
        }
        assert_eq!(service.list_checkpoints("limited").await.len(), 10);
    }

    #[tokio::test]
    async fn load_skips_legacy_content_snapshots_and_defaults_missing_fields() {
        let root = TempDir::new().unwrap();
        let path = root.path().join("checkpoints.json");
        let raw = serde_json::json!({
            "pane": [
                {
                    "id": "legacy", "paneId": "pane", "cwd": root.path(),
                    "gitRoot": null, "timestamp": 1, "userMessage": "old",
                    "changedFiles": [{"relativePath": "a", "contentBefore": "x"}],
                    "reverted": false
                },
                {
                    "id": "valid", "paneId": "pane", "cwd": root.path(),
                    "gitRoot": null, "timestamp": 2, "userMessage": "new",
                    "changedFiles": [], "reverted": false
                }
            ]
        });
        tokio::fs::write(&path, serde_json::to_vec(&raw).unwrap())
            .await
            .unwrap();
        let service =
            CheckpointService::new(AllowedPaths::new(root.path(), root.path()).unwrap(), path);
        service.load().await;
        let listed = service.list_checkpoints("pane").await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "valid");
    }

    #[test]
    fn inline_character_accounting_matches_javascript_utf16_length() {
        assert_eq!(js_string_len("a😀"), 3);
    }

    #[test]
    fn binary_and_skipped_path_checks_match_javascript_string_splitting() {
        assert!(is_binary(Path::new(".PNG")));
        assert!(is_binary(Path::new("folder/archive.tar.gz")));
        assert!(!is_binary(Path::new("README")));
        assert!(is_skipped_path(Path::new("src\\node_modules\\file.ts")));
        assert!(is_skipped_path(Path::new("src/.cache/file.ts")));
        assert!(!is_skipped_path(Path::new("src/cache/file.ts")));
    }
}
