//! File access and directory discovery under the server's allowed roots.

use crate::unix_millis as now_millis;
use inferay_core::config::DEFAULT_SEARCH_FOLDERS;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::{ApiError, ServerState, api_error};
use crate::path_resolution::{is_within_directory, resolve_lexically};
use axum::http::StatusCode;
use serde::Serialize;
use walkdir::WalkDir;

const MAX_FILE_CONTENT_BYTES: u64 = 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 50;
const MAX_DIRECTORY_DEPTH: usize = 4;

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectFileEntry {
    name: String,
    path: String,
    is_dir: bool,
    cwd: String,
}

impl ServerState {
    /// Returns the selected pane's project first, then the other unique projects in its group.
    pub(super) async fn active_cwds(&self) -> Result<Vec<String>, ApiError> {
        let agent_state = self.agent_state_store.clone();
        let allowed_paths = self.allowed_paths.clone();
        tokio::task::spawn_blocking(move || {
            let paths = agent_state
                .lock()
                .map_err(|_| ApiError::from(String::from("agent state lock poisoned")))?
                .active_cwds()
                .map_err(ApiError::from)?;
            let mut seen = HashSet::new();
            let cwds: Vec<_> = paths
                .into_iter()
                .filter_map(|cwd| resolve_lexically(Path::new(&cwd)).ok())
                .filter(|cwd| allowed_paths.is_allowed_local_path(cwd) && seen.insert(cwd.clone()))
                .map(|cwd| cwd.to_string_lossy().into_owned())
                .collect();
            Ok(if cwds.is_empty() {
                vec![allowed_paths.project_root().to_string_lossy().into_owned()]
            } else {
                cwds
            })
        })
        .await
        .map_err(|error| ApiError::from(error.to_string()))?
    }

    pub(super) fn project_cwd(&self, cwd: &str) -> Result<PathBuf, ApiError> {
        if cwd.is_empty() {
            return Err(api_error(StatusCode::BAD_REQUEST, "Invalid directory"));
        }
        let cwd = resolve_lexically(Path::new(cwd))
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid directory"))?;
        self.allowed_paths
            .is_allowed_local_path(&cwd)
            .then_some(cwd)
            .ok_or(api_error(StatusCode::BAD_REQUEST, "Invalid directory"))
    }

    fn child(&self, cwd: &Path, path: &str) -> Result<PathBuf, ApiError> {
        let child = resolve_lexically(&cwd.join(path))
            .map_err(|_| api_error(StatusCode::FORBIDDEN, "Access denied"))?;
        if self.allowed_paths.is_allowed_local_path(&child) && is_within_directory(&child, cwd) {
            Ok(child)
        } else {
            Err(api_error(StatusCode::FORBIDDEN, "Access denied"))
        }
    }

    pub(super) async fn read_project_file(&self, cwd: &str, path: &str) -> super::ApiResult {
        let cwd = self.project_cwd(cwd)?;
        if path.is_empty() {
            return Err(api_error(StatusCode::BAD_REQUEST, "No path provided"));
        }
        let file = self.child(&cwd, path)?;
        let metadata = tokio::fs::metadata(&file).await.map_err(map_io_error)?;
        if !metadata.is_file() {
            return Err(api_error(StatusCode::BAD_REQUEST, "Not a file"));
        }
        if metadata.len() > MAX_FILE_CONTENT_BYTES {
            return Err(api_error(StatusCode::PAYLOAD_TOO_LARGE, "File too large"));
        }
        let bytes = tokio::fs::read(&file).await.map_err(map_io_error)?;
        let content = String::from_utf8_lossy(&bytes);
        let (table, table_error) =
            match inferay_core::table_preview::TablePreview::from_content(path, &content) {
                Ok(table) => (table, None),
                Err(error) => (None, Some(error)),
            };
        let (draft, draft_error) =
            match inferay_core::draft_preview::DraftPreview::from_content(path, &content) {
                Ok(draft) => (draft, None),
                Err(error) => (None, Some(error)),
            };
        Ok(serde_json::json!({
            "draft": draft,
            "draftError": draft_error,
            "content": content,
            "table": table,
            "tableError": table_error,
            "hash": crate::project_store::hash(&bytes),
            "cwd": cwd.to_string_lossy(),
            "path": file.strip_prefix(&cwd).unwrap_or(&file).to_string_lossy(),
        }))
    }
}

fn map_io_error(error: std::io::Error) -> ApiError {
    if error.kind() == std::io::ErrorKind::NotFound {
        api_error(StatusCode::NOT_FOUND, "File not found")
    } else {
        ApiError::from(error.to_string())
    }
}

fn search_files_in_cwd(cwd: &Path, query: &str, limit: usize) -> Vec<ProjectFileEntry> {
    let cwd_string = cwd.to_string_lossy().into_owned();
    if let Ok(output) = std::process::Command::new("git")
        .args(["-C"])
        .arg(cwd)
        .args(["ls-files", "-co", "--exclude-standard"])
        .output()
        && output.status.success()
    {
        let results = search_results(
            String::from_utf8_lossy(&output.stdout)
                .split('\n')
                .map(str::to_owned),
            &cwd_string,
            query,
            limit,
        );
        if !results.is_empty() || !query.is_empty() {
            return results;
        }
    }
    let paths = WalkDir::new(cwd)
        .min_depth(1)
        .max_depth(MAX_DIRECTORY_DEPTH + 1)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !name.starts_with('.') && !matches!(name.as_ref(), "node_modules" | "build" | "dist")
        })
        .filter_map(Result::ok)
        .filter(|entry| !entry.file_type().is_dir())
        .map(|entry| {
            entry
                .path()
                .strip_prefix(cwd)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .into_owned()
        });
    search_results(paths, &cwd_string, query, limit)
}

fn search_results(
    paths: impl Iterator<Item = String>,
    cwd: &str,
    query: &str,
    limit: usize,
) -> Vec<ProjectFileEntry> {
    let mut seen = HashSet::new();
    paths
        .filter(|path| {
            !path.is_empty()
                && (query.is_empty() || path.to_lowercase().contains(query))
                && seen.insert(path.clone())
        })
        .take(limit)
        .map(|path| ProjectFileEntry {
            name: Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone()),
            path,
            is_dir: false,
            cwd: cwd.to_owned(),
        })
        .collect()
}

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
impl ServerState {
    pub(super) async fn store_image(&self, name: &str, bytes: &[u8]) -> Result<PathBuf, ApiError> {
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err(api_error(StatusCode::PAYLOAD_TOO_LARGE, "File too large"));
        }
        if !is_image_extension(name) {
            return Err(api_error(StatusCode::BAD_REQUEST, "Unsupported file type"));
        }
        tokio::fs::create_dir_all(&self.temp_dir).await?;
        let timestamp = now_millis();
        let safe_name = safe_upload_name(name);
        let path = self.temp_dir.join(format!("{timestamp}-{safe_name}"));
        tokio::fs::write(&path, bytes).await?;
        Ok(path)
    }
}

pub(crate) fn safe_upload_name(name: &str) -> String {
    name.encode_utf16()
        .map(|unit| match u8::try_from(unit) {
            Ok(byte) if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-') => {
                char::from(byte)
            }
            _ => '_',
        })
        .collect()
}

pub(crate) fn is_image_extension(path: &str) -> bool {
    let extension = path
        .rfind('.')
        .map(|index| path[index..].to_lowercase())
        .unwrap_or_else(|| path.to_lowercase());
    matches!(
        extension.as_str(),
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".bmp" | ".ico" | ".svg"
    )
}

pub(crate) fn image_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentDirectory {
    name: String,
    path: String,
    is_git_repo: bool,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryQuickPicks {
    quick_picks: Vec<AgentDirectory>,
    home: String,
}

pub(super) async fn get_agent_directories(
    state: &ServerState,
    request: axum::extract::Request,
) -> super::ApiResult {
    use super::query_value;
    use serde_json::json;
    let query = query_value(&request, "q").unwrap_or_default();
    let allowed_paths = state.allowed_paths.clone();
    let mut search_paths = state.configured_search_paths().await;
    tokio::task::spawn_blocking(move || {
        let home = allowed_paths.home_directory();
        if let Some(path) = query_value(&request, "path").filter(|path| !path.is_empty()) {
            let path = allowed_paths
                .resolve_allowed_local_path(path)
                .ok_or_else(|| {
                    api_error(StatusCode::FORBIDDEN, "Path is outside allowed local roots")
                })?;
            let parent = path
                .parent()
                .filter(|parent| *parent != path && allowed_paths.is_allowed_local_path(parent));
            return Ok(json!({
                "directories": agent_directories(&path, 1).collect::<Vec<_>>(),
                "parent": parent.map(|path| path.to_string_lossy())
            }));
        }
        if !query.is_empty() {
            search_paths.insert(0, home.to_path_buf());
            search_paths.push(allowed_paths.project_root().join("apps"));
            return Ok(json!({
                "directories": discover_directories(search_paths, Some(&query)),
                "parent": null
            }));
        }
        if query_value(&request, "quickPicks").as_deref() == Some("true") {
            return Ok(json!(DirectoryQuickPicks {
                quick_picks: discover_directories(search_paths, None),
                home: home.to_string_lossy().into_owned()
            }));
        }
        Ok(json!({
            "directories": agent_directories(home, 1).collect::<Vec<_>>(),
            "parent": null,
            "home": home.to_string_lossy()
        }))
    })
    .await
    .map_err(|error| ApiError::from(error.to_string()))?
}

impl ServerState {
    async fn configured_search_paths(&self) -> Vec<PathBuf> {
        let configured_search_folders = self
            .config_manager
            .lock()
            .await
            .search_folders()
            .unwrap_or_default();
        if configured_search_folders.is_empty() {
            return default_agent_search_paths(self.allowed_paths.home_directory());
        }
        configured_search_folders
            .iter()
            .filter_map(|folder| {
                let path = if let Some(relative) = folder.strip_prefix("~/") {
                    self.allowed_paths.home_directory().join(relative)
                } else {
                    resolve_lexically(Path::new(folder)).ok()?
                };
                self.allowed_paths
                    .is_allowed_local_path(&path)
                    .then_some(path)
            })
            .collect()
    }
}

fn default_agent_search_paths(home: &Path) -> Vec<PathBuf> {
    DEFAULT_SEARCH_FOLDERS
        .iter()
        .map(|folder| home.join(folder.trim_start_matches("~/")))
        .collect()
}

fn is_real_agent_folder(name: &str) -> bool {
    let lower = name.to_lowercase();
    ![".app", ".bundle", ".plugin", ".kext", ".framework"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn agent_directories(base: &Path, depth: usize) -> impl Iterator<Item = AgentDirectory> {
    WalkDir::new(base)
        .min_depth(1)
        .max_depth(depth)
        .sort_by(|a, b| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        })
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            entry.file_type().is_dir() && !name.starts_with('.') && is_real_agent_folder(&name)
        })
        .filter_map(Result::ok)
        .map(|entry| AgentDirectory {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_git_repo: false,
        })
}

/// Folders that never hold a checkout but are expensive or protected to walk.
const UNSEARCHED_FOLDERS: &[&str] = &[
    "Library",
    "Applications",
    "Pictures",
    "Movies",
    "Music",
    "Public",
    "node_modules",
    "vendor",
    "target",
    "venv",
];
const MAX_SEARCH_DEPTH: usize = 3;
const MAX_SCANNED_ENTRIES: usize = 40_000;
const MAX_SCAN_TIME: std::time::Duration = std::time::Duration::from_millis(600);
const MAX_DIRECTORY_RESULTS: usize = 30;

/// Rank matching folders without retaining or reading timestamps for unrelated entries.
fn discover_directories(paths: Vec<PathBuf>, query: Option<&str>) -> Vec<AgentDirectory> {
    let query = query.map(str::to_lowercase);
    let mut results = Vec::new();
    for path in paths {
        let mut walker = WalkDir::new(path)
            .min_depth(1)
            .max_depth(MAX_SEARCH_DEPTH)
            .sort_by(|a, b| {
                a.file_name()
                    .to_string_lossy()
                    .cmp(&b.file_name().to_string_lossy())
            })
            .into_iter()
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy();
                entry.file_type().is_dir()
                    && !name.starts_with('.')
                    && is_real_agent_folder(&name)
                    && !UNSEARCHED_FOLDERS.contains(&name.as_ref())
            });
        let deadline = std::time::Instant::now() + MAX_SCAN_TIME;
        for _ in 0..MAX_SCANNED_ENTRIES {
            let Some(entry) = walker.next() else { break };
            if std::time::Instant::now() > deadline {
                break;
            }
            let Ok(entry) = entry else { continue };
            let is_git_repo = entry.path().join(".git").exists();
            if is_git_repo {
                walker.skip_current_dir();
            }
            let (rank, modified) = if let Some(query) = &query {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                let rank = if name == *query {
                    0
                } else if name.starts_with(query) {
                    2
                } else if name.contains(query) {
                    4
                } else {
                    continue;
                };
                (rank + u8::from(!is_git_repo), UNIX_EPOCH)
            } else if is_git_repo {
                (
                    0,
                    entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .unwrap_or(UNIX_EPOCH),
                )
            } else {
                continue;
            };
            results.push((rank, std::cmp::Reverse(modified), entry, is_git_repo));
        }
    }
    results.sort_by_key(|(rank, modified, _, _)| (*rank, *modified));
    let mut seen = HashSet::new();
    results
        .into_iter()
        .filter(|(_, _, entry, _)| seen.insert(entry.path().to_path_buf()))
        .take(MAX_DIRECTORY_RESULTS)
        .map(|(_, _, entry, is_git_repo)| AgentDirectory {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_git_repo,
        })
        .collect()
}

pub(super) async fn search_project_files(
    cwd: PathBuf,
    query: &str,
    limit: usize,
) -> Result<Vec<ProjectFileEntry>, ApiError> {
    let query = query.to_lowercase();
    let limit = limit.min(MAX_SEARCH_RESULTS);
    tokio::task::spawn_blocking(move || search_files_in_cwd(&cwd, &query, limit))
        .await
        .map_err(|error| ApiError::from(error.to_string()))
}

/// Bound both the decoded bitmap and concurrent decoding, not just compressed bytes.
/// The original file remains the agent attachment; this is only its UI preview.
pub(super) async fn image_thumbnail(path: PathBuf) -> Result<Vec<u8>, String> {
    static DECODERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let permit = DECODERS
        .acquire()
        .await
        .map_err(|error| error.to_string())?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        use image::ImageDecoder;
        let mut reader = image::ImageReader::open(path)
            .map_err(|error| error.to_string())?
            .with_guessed_format()
            .map_err(|error| error.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(256 * 1024 * 1024);
        limits.max_image_width = Some(16_384);
        limits.max_image_height = Some(16_384);
        reader.limits(limits);
        let mut decoder = reader.into_decoder().map_err(|error| error.to_string())?;
        let orientation = decoder.orientation().map_err(|error| error.to_string())?;
        let bitmap =
            image::DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
        let mut thumbnail = bitmap.thumbnail(512.min(bitmap.width()), 512.min(bitmap.height()));
        drop(bitmap);
        thumbnail.apply_orientation(orientation);
        let mut bytes = std::io::Cursor::new(Vec::new());
        thumbnail
            .write_to(&mut bytes, image::ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        Ok(bytes.into_inner())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod directory_tests {
    use super::*;

    #[test]
    fn discovery_preserves_ranking_pruning_and_unique_results() {
        let root = tempfile::tempdir().unwrap();
        for path in [
            "a/needle/.git",
            "b/needle",
            "needle-prefix/.git",
            "needle-plain",
            "x-needle/.git",
            "x-needle-plain",
            "a/needle/needle-hidden",
            ".hidden/needle",
            "node_modules/needle",
            "App.app/needle",
            "deep/one/two/needle",
            "Library/needle",
        ] {
            std::fs::create_dir_all(root.path().join(path)).unwrap();
        }
        // Worktrees use a .git file rather than a directory.
        std::fs::write(root.path().join("needle-plain/.git"), "gitdir: elsewhere").unwrap();
        let paths = vec![root.path().to_path_buf(), root.path().to_path_buf()];
        let result = discover_directories(paths.clone(), Some("NEEDLE"));
        let relative: Vec<_> = result
            .iter()
            .map(|entry| {
                (
                    Path::new(&entry.path)
                        .strip_prefix(root.path())
                        .unwrap()
                        .to_str()
                        .unwrap(),
                    entry.is_git_repo,
                )
            })
            .collect();
        assert_eq!(
            relative,
            [
                ("a/needle", true),
                ("b/needle", false),
                ("needle-plain", true),
                ("needle-prefix", true),
                ("x-needle", true),
                ("x-needle-plain", false),
            ]
        );
        assert!(discover_directories(paths.clone(), Some("absent")).is_empty());
        for i in 0..40 {
            std::fs::create_dir(root.path().join(format!("item{i:02}"))).unwrap();
        }
        let result = discover_directories(paths, Some("item"));
        assert_eq!(result.len(), 30);
        assert_eq!(result.last().unwrap().name, "item29");
    }

    #[test]
    #[cfg(unix)]
    fn quick_picks_order_repositories_by_recency() {
        let root = tempfile::tempdir().unwrap();
        for (name, seconds) in [("older", 10), ("newer", 20)] {
            let directory = root.path().join(name);
            std::fs::create_dir_all(directory.join(".git")).unwrap();
            std::fs::File::open(directory)
                .unwrap()
                .set_times(
                    std::fs::FileTimes::new()
                        .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(seconds)),
                )
                .unwrap();
        }
        std::fs::create_dir(root.path().join("ordinary")).unwrap();
        let result = discover_directories(vec![root.path().to_path_buf(); 2], None);
        assert_eq!(
            result
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["newer", "older"]
        );
        assert!(result.iter().all(|entry| entry.is_git_repo));
    }
}
