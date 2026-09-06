//! Typed, transport-free project file access for native views.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use inferay_core::agent_state::AgentStateStore;
use inferay_core::path_security::{AllowedPaths, is_within_directory, resolve_lexically};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

const MAX_FILE_CONTENT_BYTES: u64 = 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 50;
const MAX_DIRECTORY_DEPTH: usize = 4;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub cwd: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileContent {
    pub content: String,
    pub cwd: String,
    pub path: String,
}

#[derive(thiserror::Error, Clone, Debug, PartialEq, Eq)]
pub enum NativeProjectFilesError {
    #[error("Invalid directory")]
    InvalidDirectory,
    #[error("No path provided")]
    MissingPath,
    #[error("Access denied")]
    AccessDenied,
    #[error("File not found")]
    NotFound,
    #[error("Not a file")]
    NotFile,
    #[error("File too large")]
    FileTooLarge,
    #[error("{0}")]
    Runtime(String),
}

#[derive(Clone)]
pub struct NativeProjectFiles {
    allowed_paths: AllowedPaths,
    agent_state: Arc<Mutex<AgentStateStore>>,
}

impl NativeProjectFiles {
    pub fn new(allowed_paths: AllowedPaths, agent_state: Arc<Mutex<AgentStateStore>>) -> Self {
        Self {
            allowed_paths,
            agent_state,
        }
    }

    /// Returns the selected pane's project first, then the other unique projects in its group.
    pub async fn active_cwds(&self) -> Result<Vec<String>, NativeProjectFilesError> {
        let agent_state = self.agent_state.clone();
        let allowed_paths = self.allowed_paths.clone();
        tokio::task::spawn_blocking(move || {
            let paths = agent_state
                .lock()
                .map_err(|_| NativeProjectFilesError::Runtime("agent state lock poisoned".into()))?
                .active_cwds()
                .map_err(NativeProjectFilesError::Runtime)?;
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
        .map_err(|error| NativeProjectFilesError::Runtime(error.to_string()))?
    }

    fn cwd(&self, cwd: &str) -> Result<PathBuf, NativeProjectFilesError> {
        if cwd.is_empty() {
            return Err(NativeProjectFilesError::InvalidDirectory);
        }
        let cwd = resolve_lexically(Path::new(cwd))
            .map_err(|_| NativeProjectFilesError::InvalidDirectory)?;
        self.allowed_paths
            .is_allowed_local_path(&cwd)
            .then_some(cwd)
            .ok_or(NativeProjectFilesError::InvalidDirectory)
    }

    fn child(&self, cwd: &Path, path: &str) -> Result<PathBuf, NativeProjectFilesError> {
        let child = resolve_lexically(&cwd.join(path))
            .map_err(|_| NativeProjectFilesError::AccessDenied)?;
        if self.allowed_paths.is_allowed_local_path(&child) && is_within_directory(&child, cwd) {
            Ok(child)
        } else {
            Err(NativeProjectFilesError::AccessDenied)
        }
    }

    pub fn resolve_cwd(&self, cwd: &str) -> Result<String, NativeProjectFilesError> {
        self.cwd(cwd)
            .map(|path| path.to_string_lossy().into_owned())
    }

    pub async fn search(
        &self,
        cwd: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ProjectFileEntry>, NativeProjectFilesError> {
        let cwd = self.cwd(cwd)?;
        let query = query.to_lowercase();
        let limit = limit.min(MAX_SEARCH_RESULTS);
        tokio::task::spawn_blocking(move || search_files_in_cwd(&cwd, &query, limit))
            .await
            .map_err(|error| NativeProjectFilesError::Runtime(error.to_string()))
    }

    pub async fn list(
        &self,
        cwd: &str,
        path: &str,
    ) -> Result<Vec<ProjectFileEntry>, NativeProjectFilesError> {
        let cwd = self.cwd(cwd)?;
        let directory = self.child(&cwd, path)?;
        tokio::task::spawn_blocking(move || list_project_directory(&cwd, &directory))
            .await
            .map_err(|error| NativeProjectFilesError::Runtime(error.to_string()))?
    }

    pub async fn read(
        &self,
        cwd: &str,
        path: &str,
    ) -> Result<ProjectFileContent, NativeProjectFilesError> {
        let cwd = self.cwd(cwd)?;
        if path.is_empty() {
            return Err(NativeProjectFilesError::MissingPath);
        }
        let file = self.child(&cwd, path)?;
        let metadata = tokio::fs::metadata(&file).await.map_err(map_io_error)?;
        if !metadata.is_file() {
            return Err(NativeProjectFilesError::NotFile);
        }
        if metadata.len() > MAX_FILE_CONTENT_BYTES {
            return Err(NativeProjectFilesError::FileTooLarge);
        }
        let bytes = tokio::fs::read(&file).await.map_err(map_io_error)?;
        Ok(ProjectFileContent {
            content: String::from_utf8_lossy(&bytes).into_owned(),
            cwd: cwd.to_string_lossy().into_owned(),
            path: file
                .strip_prefix(&cwd)
                .unwrap_or(&file)
                .to_string_lossy()
                .into_owned(),
        })
    }
}

fn map_io_error(error: std::io::Error) -> NativeProjectFilesError {
    if error.kind() == std::io::ErrorKind::NotFound {
        NativeProjectFilesError::NotFound
    } else {
        NativeProjectFilesError::Runtime(error.to_string())
    }
}

fn list_project_directory(
    cwd: &Path,
    directory: &Path,
) -> Result<Vec<ProjectFileEntry>, NativeProjectFilesError> {
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
