//! Typed, transport-free directory discovery for native clients.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use inferay_core::config::{ConfigManager, DEFAULT_SEARCH_FOLDERS};
use inferay_core::path_security::{AllowedPaths, resolve_lexically};
use serde::Serialize;
use tokio::sync::Mutex;
use walkdir::WalkDir;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AgentDirectory {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuickPick {
    pub name: String,
    pub path: String,
    pub is_git_repo: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AgentDirectoryListing {
    pub directories: Vec<AgentDirectory>,
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuickPicks {
    pub quick_picks: Vec<AgentQuickPick>,
    pub home: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeAgentDirectoriesError {
    PathOutsideAllowedRoots,
}

impl std::fmt::Display for NativeAgentDirectoriesError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Path is outside allowed local roots")
    }
}

impl std::error::Error for NativeAgentDirectoriesError {}

/// Directory discovery reads the shared settings store on each request.
#[derive(Clone, Debug)]
pub struct NativeAgentDirectories {
    allowed_paths: AllowedPaths,
    search_folders: Arc<Mutex<ConfigManager>>,
}

impl NativeAgentDirectories {
    pub fn with_config_manager(
        allowed_paths: AllowedPaths,
        config_manager: Arc<Mutex<ConfigManager>>,
    ) -> Self {
        Self {
            allowed_paths,
            search_folders: config_manager,
        }
    }

    pub fn home(&self) -> AgentDirectoryListing {
        AgentDirectoryListing {
            directories: agent_directories(self.allowed_paths.home_directory(), 1).collect(),
            parent: None,
            home: Some(self.home_path()),
        }
    }

    pub async fn quick_picks(&self) -> AgentQuickPicks {
        AgentQuickPicks {
            quick_picks: find_agent_quick_picks(self.configured_search_paths().await),
            home: self.home_path(),
        }
    }

    pub async fn search(&self, query: &str) -> AgentDirectoryListing {
        AgentDirectoryListing {
            directories: search_agent_directories(
                query,
                self.allowed_paths.home_directory(),
                self.configured_search_paths().await,
                self.allowed_paths.project_root().join("apps"),
            ),
            parent: None,
            home: None,
        }
    }

    pub fn browse(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<AgentDirectoryListing, NativeAgentDirectoriesError> {
        let Some(path) = self.allowed_paths.resolve_allowed_local_path(path) else {
            return Err(NativeAgentDirectoriesError::PathOutsideAllowedRoots);
        };
        let parent = path.parent().and_then(|parent| {
            (parent != path && self.allowed_paths.is_allowed_local_path(parent))
                .then(|| parent.to_string_lossy().into_owned())
        });
        Ok(AgentDirectoryListing {
            directories: agent_directories(&path, 1).collect(),
            parent,
            home: None,
        })
    }

    fn home_path(&self) -> String {
        self.allowed_paths
            .home_directory()
            .to_string_lossy()
            .into_owned()
    }

    async fn configured_search_paths(&self) -> Vec<PathBuf> {
        let configured_search_folders = self
            .search_folders
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

struct QuickPickWithMtime {
    entry: AgentQuickPick,
    mtime: SystemTime,
}

fn find_agent_quick_picks(configured_paths: Vec<PathBuf>) -> Vec<AgentQuickPick> {
    let mut results = Vec::new();
    for path in configured_paths {
        if path.is_dir() {
            scan_quick_picks(&path, 3, &mut results);
        }
    }
    results.sort_by_key(|result| std::cmp::Reverse(result.mtime));
    let mut seen = HashSet::new();
    results
        .into_iter()
        .filter(|result| seen.insert(result.entry.path.clone()))
        .take(8)
        .map(|result| result.entry)
        .collect()
}

fn scan_quick_picks(directory: &Path, depth: usize, results: &mut Vec<QuickPickWithMtime>) {
    let mut entries = WalkDir::new(directory)
        .min_depth(1)
        .max_depth(depth)
        .into_iter()
        .filter_entry(|entry| {
            entry.file_type().is_dir() && !entry.file_name().to_string_lossy().starts_with('.')
        });
    while let Some(entry) = entries.next() {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.join(".git").is_dir() {
            results.push(QuickPickWithMtime {
                entry: AgentQuickPick {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    is_git_repo: true,
                },
                mtime: entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .unwrap_or(UNIX_EPOCH),
            });
            entries.skip_current_dir();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn service(root: &TempDir, search: &Path) -> NativeAgentDirectories {
        let config = ConfigManager::new(root.path().join("settings.json"));
        config
            .set_search_folders(vec![search.to_string_lossy().into_owned()])
            .unwrap();
        NativeAgentDirectories::with_config_manager(
            AllowedPaths::new(root.path(), root.path()).unwrap(),
            Arc::new(Mutex::new(config)),
        )
    }

    #[tokio::test]
    async fn preserves_browse_search_and_quick_pick_contracts() {
        let root = TempDir::new().unwrap();
        let search = root.path().join("workspaces");
        std::fs::create_dir_all(search.join("AlphaProject/.git")).unwrap();
        std::fs::create_dir_all(search.join("nested/BetaProject")).unwrap();
        std::fs::create_dir_all(search.join("Hidden.app")).unwrap();
        for hidden_repository in [
            "AlphaProject/nested/NestedRepo/.git",
            ".hidden/.git",
            "nested/deep/too-deep/Repo/.git",
        ] {
            std::fs::create_dir_all(search.join(hidden_repository)).unwrap();
        }

        let service = service(&root, &search);

        let browse = service.browse(&search).unwrap();
        assert_eq!(
            browse
                .directories
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["AlphaProject", "nested"]
        );
        assert_eq!(browse.parent.as_deref(), root.path().to_str());
        assert_eq!(
            service.search("beta").await.directories[0].name,
            "BetaProject"
        );
        let picks = service.quick_picks().await;
        assert_eq!(picks.quick_picks.len(), 1);
        assert!(picks.quick_picks[0].is_git_repo);
    }

    #[test]
    fn rejects_browse_outside_allowed_roots() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let service = service(&root, root.path());
        assert_eq!(
            service.browse(outside.path()),
            Err(NativeAgentDirectoriesError::PathOutsideAllowedRoots)
        );
    }

    #[tokio::test]
    async fn expands_tilde_configured_folder() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("Code/Repo/.git")).unwrap();
        let service = service(&root, Path::new("~/Code"));
        assert_eq!(service.quick_picks().await.quick_picks[0].name, "Repo");
    }

    #[test]
    fn serializes_the_existing_route_dto_shape() {
        let listing = AgentDirectoryListing {
            directories: vec![],
            parent: None,
            home: None,
        };
        assert_eq!(
            serde_json::to_value(listing).unwrap(),
            json!({"directories": [], "parent": null})
        );
        let picks = AgentQuickPicks {
            quick_picks: vec![AgentQuickPick {
                name: "Repo".into(),
                path: "/Repo".into(),
                is_git_repo: true,
            }],
            home: "/home".into(),
        };
        assert_eq!(
            serde_json::to_value(picks).unwrap(),
            json!({"quickPicks":[{"name":"Repo","path":"/Repo","isGitRepo":true}],"home":"/home"})
        );
    }
}
