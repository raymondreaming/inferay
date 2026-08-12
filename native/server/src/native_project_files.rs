//! Typed, transport-free project file access for native views.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use inferay_core::agent_state::AgentStateStore;
use inferay_core::path_security::{AllowedPaths, is_within_directory, resolve_lexically};
use serde::{Deserialize, Serialize};

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
    pub size: u64,
    pub updated_at: f64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeProjectFilesError {
    InvalidDirectory,
    MissingPath,
    AccessDenied,
    NotFound,
    NotFile,
    FileTooLarge,
    Runtime(String),
}

impl std::fmt::Display for NativeProjectFilesError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidDirectory => formatter.write_str("Invalid directory"),
            Self::MissingPath => formatter.write_str("No path provided"),
            Self::AccessDenied => formatter.write_str("Access denied"),
            Self::NotFound => formatter.write_str("File not found"),
            Self::NotFile => formatter.write_str("Not a file"),
            Self::FileTooLarge => formatter.write_str("File too large"),
            Self::Runtime(error) => formatter.write_str(error),
        }
    }
}

impl std::error::Error for NativeProjectFilesError {}

#[derive(Clone)]
pub struct NativeProjectFiles {
    allowed_paths: AllowedPaths,
    agent_state: Option<Arc<Mutex<AgentStateStore>>>,
    owner: tokio::runtime::Handle,
}

impl NativeProjectFiles {
    pub fn new(allowed_paths: AllowedPaths) -> Self {
        Self {
            allowed_paths,
            agent_state: None,
            owner: tokio::runtime::Handle::current(),
        }
    }

    pub fn with_agent_state(
        allowed_paths: AllowedPaths,
        agent_state: Arc<Mutex<AgentStateStore>>,
    ) -> Self {
        Self {
            allowed_paths,
            agent_state: Some(agent_state),
            owner: tokio::runtime::Handle::current(),
        }
    }

    /// Returns the selected pane's project first, then the other unique projects in its group.
    pub async fn active_cwds(&self) -> Result<Vec<String>, NativeProjectFilesError> {
        let Some(agent_state) = self.agent_state.clone() else {
            return Ok(vec![
                self.allowed_paths
                    .project_root()
                    .to_string_lossy()
                    .into_owned(),
            ]);
        };
        let allowed_paths = self.allowed_paths.clone();
        self.owner
            .spawn_blocking(move || {
                let state = agent_state
                    .lock()
                    .map_err(|_| {
                        NativeProjectFilesError::Runtime("agent state lock poisoned".into())
                    })?
                    .read();
                let fallback = || vec![allowed_paths.project_root().to_string_lossy().into_owned()];
                let Some(groups) = state.get("groups").and_then(serde_json::Value::as_array) else {
                    return Ok(fallback());
                };
                let selected_group_id = state
                    .get("selectedGroupId")
                    .and_then(serde_json::Value::as_str);
                let selected_group = selected_group_id
                    .and_then(|id| {
                        groups.iter().find(|group| {
                            group.get("id").and_then(serde_json::Value::as_str) == Some(id)
                        })
                    })
                    .or_else(|| groups.first());
                let Some(panes) = selected_group
                    .and_then(|group| group.get("panes"))
                    .and_then(serde_json::Value::as_array)
                else {
                    return Ok(fallback());
                };
                let selected_pane_id = selected_group
                    .and_then(|group| group.get("selectedPaneId"))
                    .and_then(serde_json::Value::as_str);
                let ordered = panes
                    .iter()
                    .filter(|pane| {
                        selected_pane_id.is_some_and(|id| {
                            pane.get("id").and_then(serde_json::Value::as_str) == Some(id)
                        })
                    })
                    .chain(panes.iter().filter(|pane| {
                        selected_pane_id.is_none_or(|id| {
                            pane.get("id").and_then(serde_json::Value::as_str) != Some(id)
                        })
                    }));
                let mut seen = HashSet::new();
                let mut cwds = Vec::new();
                for pane in ordered {
                    let Some(cwd) = pane
                        .get("cwd")
                        .and_then(serde_json::Value::as_str)
                        .filter(|cwd| !cwd.is_empty())
                    else {
                        continue;
                    };
                    let Ok(cwd) = resolve_lexically(Path::new(cwd)) else {
                        continue;
                    };
                    if allowed_paths.is_allowed_local_path(&cwd) && seen.insert(cwd.clone()) {
                        cwds.push(cwd.to_string_lossy().into_owned());
                    }
                }
                Ok(if cwds.is_empty() { fallback() } else { cwds })
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
        self.owner
            .spawn_blocking(move || search_files_in_cwd(&cwd, &query, limit))
            .await
            .map_err(|error| NativeProjectFilesError::Runtime(error.to_string()))
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
        let candidate = PathBuf::from(path);
        let candidate = if candidate.is_absolute() {
            candidate
        } else {
            cwd.join(candidate)
        };
        let file =
            resolve_lexically(&candidate).map_err(|_| NativeProjectFilesError::AccessDenied)?;
        if !self.allowed_paths.is_allowed_local_path(&file) || !is_within_directory(&file, &cwd) {
            return Err(NativeProjectFilesError::AccessDenied);
        }
        self.owner
            .spawn(async move {
                let metadata = tokio::fs::metadata(&file).await.map_err(map_io_error)?;
                if !metadata.is_file() {
                    return Err(NativeProjectFilesError::NotFile);
                }
                if metadata.len() > MAX_FILE_CONTENT_BYTES {
                    return Err(NativeProjectFilesError::FileTooLarge);
                }
                let bytes = tokio::fs::read(&file).await.map_err(map_io_error)?;
                let updated_at = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);
                Ok(ProjectFileContent {
                    content: String::from_utf8_lossy(&bytes).into_owned(),
                    cwd: cwd.to_string_lossy().into_owned(),
                    path: file
                        .strip_prefix(&cwd)
                        .unwrap_or(&file)
                        .to_string_lossy()
                        .into_owned(),
                    size: metadata.len(),
                    updated_at,
                })
            })
            .await
            .map_err(|error| NativeProjectFilesError::Runtime(error.to_string()))?
    }
}

fn map_io_error(error: std::io::Error) -> NativeProjectFilesError {
    if error.kind() == std::io::ErrorKind::NotFound {
        NativeProjectFilesError::NotFound
    } else {
        NativeProjectFilesError::Runtime(error.to_string())
    }
}

fn search_files_in_cwd(cwd: &Path, query: &str, limit: usize) -> Vec<ProjectFileEntry> {
    let cwd_string = cwd.to_string_lossy().into_owned();
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    if let Ok(output) = std::process::Command::new("git")
        .args(["-C"])
        .arg(cwd)
        .args(["ls-files", "-co", "--exclude-standard"])
        .output()
        && output.status.success()
    {
        for path in String::from_utf8_lossy(&output.stdout).split('\n') {
            add_result(
                &mut results,
                &mut seen,
                path,
                None,
                &cwd_string,
                query,
                limit,
            );
        }
        if !results.is_empty() || !query.is_empty() {
            return results;
        }
    }
    search_directory(cwd, cwd, 0, query, limit, &mut results, &mut seen);
    results
}

fn search_directory(
    root: &Path,
    directory: &Path,
    depth: usize,
    query: &str,
    limit: usize,
    results: &mut Vec<ProjectFileEntry>,
    seen: &mut HashSet<String>,
) {
    if depth > MAX_DIRECTORY_DEPTH || results.len() >= limit {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        if results.len() >= limit {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "build" | "dist") {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();
        let is_directory = entry.file_type().is_ok_and(|kind| kind.is_dir());
        if !is_directory {
            add_result(
                results,
                seen,
                &relative,
                Some(&name),
                &root.to_string_lossy(),
                query,
                limit,
            );
        }
        if is_directory && depth < MAX_DIRECTORY_DEPTH {
            search_directory(root, &path, depth + 1, query, limit, results, seen);
        }
    }
}

fn add_result(
    results: &mut Vec<ProjectFileEntry>,
    seen: &mut HashSet<String>,
    path: &str,
    name: Option<&str>,
    cwd: &str,
    query: &str,
    limit: usize,
) {
    if results.len() >= limit
        || path.is_empty()
        || (!query.is_empty() && !path.to_lowercase().contains(query))
        || !seen.insert(path.to_owned())
    {
        return;
    }
    results.push(ProjectFileEntry {
        name: name.map(str::to_owned).unwrap_or_else(|| {
            Path::new(path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_owned())
        }),
        path: path.to_owned(),
        is_dir: false,
        cwd: cwd.to_owned(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn searches_and_reads_only_inside_the_selected_project() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir_all(project.join("src")).unwrap();
        std::fs::write(project.join("src/main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(root.path().join("outside.txt"), "secret").unwrap();
        let service = NativeProjectFiles::new(AllowedPaths::new(root.path(), root.path()).unwrap());

        let entries = service
            .search(&project.to_string_lossy(), "MAIN", 50)
            .await
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "src/main.rs");

        let content = service
            .read(&project.to_string_lossy(), "src/main.rs")
            .await
            .unwrap();
        assert_eq!(content.content, "fn main() {}\n");
        assert_eq!(content.path, "src/main.rs");
        assert_eq!(
            service
                .read(&project.to_string_lossy(), "../outside.txt")
                .await,
            Err(NativeProjectFilesError::AccessDenied)
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn preserves_the_fifty_result_and_one_megabyte_limits() {
        let root = tempfile::tempdir().unwrap();
        for index in 0..55 {
            std::fs::write(root.path().join(format!("file-{index:02}.txt")), "x").unwrap();
        }
        std::fs::write(
            root.path().join("large.bin"),
            vec![0_u8; MAX_FILE_CONTENT_BYTES as usize + 1],
        )
        .unwrap();
        let service = NativeProjectFiles::new(AllowedPaths::new(root.path(), root.path()).unwrap());
        assert_eq!(
            service
                .search(&root.path().to_string_lossy(), "file", 500)
                .await
                .unwrap()
                .len(),
            50
        );
        assert_eq!(
            service
                .read(&root.path().to_string_lossy(), "large.bin")
                .await,
            Err(NativeProjectFilesError::FileTooLarge)
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn active_projects_follow_selected_pane_then_group_order() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first");
        let second = root.path().join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let store = Arc::new(Mutex::new(AgentStateStore::new(
            root.path().join("agent-state.json"),
            root.path().join("terminal-state.json"),
        )));
        store
            .lock()
            .unwrap()
            .write_guarded(serde_json::json!({
                "selectedGroupId": "group",
                "groups": [{
                    "id": "group",
                    "selectedPaneId": "second-pane",
                    "panes": [
                        {"id": "first-pane", "cwd": first},
                        {"id": "second-pane", "cwd": second},
                        {"id": "duplicate", "cwd": first}
                    ]
                }]
            }))
            .unwrap();
        let service = NativeProjectFiles::with_agent_state(
            AllowedPaths::new(root.path(), root.path()).unwrap(),
            store,
        );
        assert_eq!(
            service.active_cwds().await.unwrap(),
            vec![
                second.to_string_lossy().into_owned(),
                first.to_string_lossy().into_owned()
            ]
        );
    }
}
