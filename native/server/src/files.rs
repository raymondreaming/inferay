//! File access and directory discovery under the server's allowed roots.

use crate::unix_millis as now_millis;
use inferay_core::config::DEFAULT_SEARCH_FOLDERS;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::{ApiError, ServerState, api_error};
use axum::http::StatusCode;
use inferay_core::path_security::{is_within_directory, resolve_lexically};
use serde::Serialize;
use walkdir::WalkDir;

const MAX_FILE_CONTENT_BYTES: u64 = 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 50;
const MAX_DIRECTORY_DEPTH: usize = 4;

#[derive(Serialize)]
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

    pub(super) async fn list_project_files(
        &self,
        cwd: &str,
        path: &str,
    ) -> Result<Vec<ProjectFileEntry>, ApiError> {
        let cwd = self.project_cwd(cwd)?;
        let directory = self.child(&cwd, path)?;
        tokio::task::spawn_blocking(move || list_project_directory(&cwd, &directory))
            .await
            .map_err(|error| ApiError::from(error.to_string()))?
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
        Ok(serde_json::json!({
            "content": String::from_utf8_lossy(&bytes),
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

fn list_project_directory(cwd: &Path, directory: &Path) -> Result<Vec<ProjectFileEntry>, ApiError> {
    let mut entries = std::fs::read_dir(directory)
        .map_err(map_io_error)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if matches!(name.as_str(), ".git" | "node_modules" | "target" | "dist") {
                return None;
            }
            let is_dir = entry.file_type().ok()?.is_dir();
            let path = entry
                .path()
                .strip_prefix(cwd)
                .ok()?
                .to_string_lossy()
                .into_owned();
            Some(ProjectFileEntry {
                name,
                path,
                is_dir,
                cwd: cwd.to_string_lossy().into_owned(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by_cached_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
    Ok(entries)
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
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".bmp" | ".ico"
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
        _ => "application/octet-stream",
    }
}

#[derive(Serialize)]
struct AgentDirectory {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentQuickPick {
    name: String,
    path: String,
    is_git_repo: bool,
}

pub(super) async fn get_agent_directories(
    state: &ServerState,
    request: axum::extract::Request,
) -> super::ApiResult {
    use super::query_value;
    use serde_json::json;
    let query = query_value(&request, "q").unwrap_or_default();
    let home = state.allowed_paths.home_directory();
    if let Some(path) = query_value(&request, "path").filter(|path| !path.is_empty()) {
        let path = state
            .allowed_paths
            .resolve_allowed_local_path(path)
            .ok_or_else(|| {
                api_error(StatusCode::FORBIDDEN, "Path is outside allowed local roots")
            })?;
        let parent = path
            .parent()
            .filter(|parent| *parent != path && state.allowed_paths.is_allowed_local_path(parent));
        return Ok(
            json!({"directories": agent_directories(&path, 1).collect::<Vec<_>>(), "parent": parent.map(|path| path.to_string_lossy())}),
        );
    }
    if !query.is_empty() {
        let directories = search_agent_directories(
            &query,
            home,
            state.configured_search_paths().await,
            state.allowed_paths.project_root().join("apps"),
        );
        return Ok(json!({"directories": directories, "parent": null}));
    }
    if query_value(&request, "quickPicks").as_deref() == Some("true") {
        return Ok(
            json!({"quickPicks": find_agent_quick_picks(state.configured_search_paths().await), "home": home.to_string_lossy()}),
        );
    }
    Ok(
        json!({"directories": agent_directories(home, 1).collect::<Vec<_>>(), "parent": null, "home": home.to_string_lossy()}),
    )
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
        .sort_by_key(|entry| entry.file_name().to_string_lossy().into_owned())
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            entry.file_type().is_dir() && !name.starts_with('.') && is_real_agent_folder(&name)
        })
        .filter_map(Result::ok)
        .map(|entry| AgentDirectory {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
        })
}

fn search_agent_directories(
    query: &str,
    home: &Path,
    configured_paths: Vec<PathBuf>,
    project_apps: PathBuf,
) -> Vec<AgentDirectory> {
    let lower_query = query.to_lowercase();
    let (mut exact, mut prefix, mut contains) = (Vec::new(), Vec::new(), Vec::new());
    let mut search_paths = Vec::with_capacity(configured_paths.len() + 2);
    search_paths.push(home.to_path_buf());
    search_paths.extend(configured_paths);
    search_paths.push(project_apps);
    for search_path in search_paths {
        if !search_path.exists() {
            continue;
        }
        let depth = if search_path == home { 1 } else { 3 };
        for directory in agent_directories(&search_path, depth) {
            let name = directory.name.to_lowercase();
            if name == lower_query {
                exact.push(directory);
            } else if name.starts_with(&lower_query) {
                prefix.push(directory);
            } else if name.contains(&lower_query) {
                contains.push(directory);
            }
        }
    }
    let mut seen = HashSet::new();
    exact
        .into_iter()
        .chain(prefix)
        .chain(contains)
        .filter(|entry| seen.insert(entry.path.clone()))
        .take(20)
        .collect()
}

fn find_agent_quick_picks(configured_paths: Vec<PathBuf>) -> Vec<AgentQuickPick> {
    let mut results = Vec::new();
    for directory in configured_paths.into_iter().filter(|path| path.is_dir()) {
        let mut entries = WalkDir::new(directory)
            .min_depth(1)
            .max_depth(3)
            .into_iter()
            .filter_entry(|entry| {
                entry.file_type().is_dir() && !entry.file_name().to_string_lossy().starts_with('.')
            });
        while let Some(entry) = entries.next() {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if path.join(".git").is_dir() {
                let modified = entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .unwrap_or(UNIX_EPOCH);
                results.push((
                    modified,
                    AgentQuickPick {
                        name: entry.file_name().to_string_lossy().into_owned(),
                        path: path.to_string_lossy().into_owned(),
                        is_git_repo: true,
                    },
                ));
                entries.skip_current_dir();
            }
        }
    }
    results.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    let mut seen = HashSet::new();
    results
        .into_iter()
        .map(|(_, entry)| entry)
        .filter(|entry| seen.insert(entry.path.clone()))
        .take(8)
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
