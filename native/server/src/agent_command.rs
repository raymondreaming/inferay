use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use inferay_core::agent_kind::AgentKind;

/// Resolve local tools on PATH while preserving virtual-environment launcher paths.
/// macOS app bundles discover resources beside their real executable, so aliases
/// into a bundle must be expanded before handing the path to sandbox-exec.
pub(crate) fn resolve_local_program(program: &str, search_path: &OsStr) -> Result<PathBuf, String> {
    let requested = Path::new(program);
    // Relative paths are interpreted in the invocation's working directory,
    // which is set on the command after this resolver runs.
    if requested.is_relative() && requested.components().count() > 1 {
        return Ok(requested.to_path_buf());
    }
    let candidates: Vec<PathBuf> = if requested.components().count() > 1 {
        vec![requested.to_path_buf()]
    } else {
        std::env::split_paths(search_path)
            .map(|directory| directory.join(program))
            .collect()
    };
    for candidate in candidates {
        let Ok(metadata) = candidate.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                continue;
            }
        }
        let absolute = if candidate.is_absolute() {
            candidate
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(candidate)
        };
        #[cfg(target_os = "macos")]
        {
            let real = absolute.canonicalize().map_err(|e| e.to_string())?;
            if real
                .ancestors()
                .any(|path| path.extension().is_some_and(|extension| extension == "app"))
            {
                return Ok(real);
            }
        }
        return Ok(absolute);
    }
    Err(format!("Program {program} is not executable on PATH"))
}

#[derive(Debug)]
pub struct AgentCommandResolver {
    home_directory: PathBuf,
    is_windows: bool,
    availability_cache: Mutex<[Option<bool>; 2]>,
    mcp_preferences_path: PathBuf,
    mcp_preferences: Mutex<HashMap<String, HashMap<String, bool>>>,
}

impl AgentCommandResolver {
    pub fn new(home_directory: impl Into<PathBuf>, mcp_preferences_path: PathBuf) -> Self {
        Self {
            home_directory: home_directory.into(),
            is_windows: cfg!(target_os = "windows"),
            availability_cache: Mutex::new([None, None]),
            mcp_preferences: Mutex::new(crate::json_file::read_lossy(&mcp_preferences_path)),
            mcp_preferences_path,
        }
    }

    pub fn path_candidates(&self, kind: AgentKind) -> Vec<PathBuf> {
        let environment: HashMap<_, _> = std::env::vars_os().collect();
        let binary = kind.as_str();
        let nvm_bin = environment
            .get(OsStr::new("NVM_BIN"))
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let configured = environment
            .get(OsStr::new(match kind {
                AgentKind::Claude => "CLAUDE_PATH",
                AgentKind::Codex => "CODEX_PATH",
            }))
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let nvm_version = self.find_in_nvm_versions(binary);
        let home = &self.home_directory;
        let candidates = match kind {
            AgentKind::Claude => vec![
                configured,
                Some(home.join(".local/bin").join(binary)),
                Some(home.join(".bun/bin").join(binary)),
                nvm_bin.as_ref().map(|directory| directory.join(binary)),
                nvm_version,
                Some(home.join(".npm-global/bin").join(binary)),
                Some(PathBuf::from("/usr/local/bin/claude")),
                Some(PathBuf::from("/opt/homebrew/bin/claude")),
            ],
            AgentKind::Codex => vec![
                configured,
                nvm_bin.as_ref().map(|directory| directory.join(binary)),
                nvm_version,
                Some(home.join(".npm-global/bin").join(binary)),
                Some(home.join(".local/bin").join(binary)),
                Some(home.join(".bun/bin").join(binary)),
                Some(PathBuf::from("/opt/homebrew/bin/codex")),
                Some(PathBuf::from("/usr/local/bin/codex")),
            ],
        };
        candidates
            .into_iter()
            .flatten()
            .filter(|path| !path.as_os_str().is_empty())
            .map(|path| {
                let text = path.to_string_lossy();
                if !self.is_windows || text.ends_with(".cmd") || text.ends_with(".exe") {
                    path
                } else {
                    PathBuf::from(format!("{text}.cmd"))
                }
            })
            .collect()
    }

    pub fn resolve_agent_binary(&self, kind: AgentKind) -> PathBuf {
        for candidate in self.path_candidates(kind) {
            if candidate.exists() {
                return candidate;
            }
            if kind == AgentKind::Claude
                && self.is_windows
                && candidate.to_string_lossy().ends_with(".cmd")
            {
                let executable = PathBuf::from(format!(
                    "{}.exe",
                    candidate
                        .to_string_lossy()
                        .strip_suffix(".cmd")
                        .unwrap_or(&candidate.to_string_lossy())
                ));
                if executable.exists() {
                    return executable;
                }
            }
        }
        PathBuf::from(if self.is_windows {
            format!("{}.cmd", kind.as_str())
        } else {
            kind.as_str().to_string()
        })
    }

    pub fn create_agent_env(&self, kind: AgentKind) -> HashMap<OsString, OsString> {
        let mut environment: HashMap<_, _> = std::env::vars_os().collect();
        environment.insert(
            "INFERAY_MCP_OVERRIDES".into(),
            serde_json::to_string(&self.mcp_overrides(kind))
                .expect("MCP preferences serialize")
                .into(),
        );
        if kind == AgentKind::Claude {
            environment.remove(OsStr::new("CLAUDECODE"));
        }
        let delimiter = if self.is_windows { ';' } else { ':' };
        let mut path_entries = environment
            .get(OsStr::new("PATH"))
            .map(|path| {
                path.to_string_lossy()
                    .split(delimiter)
                    .filter(|entry| !entry.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut path_entry_set = path_entries.iter().cloned().collect::<HashSet<_>>();
        for candidate in self.path_candidates(kind) {
            let candidate_directory = javascript_dirname(&candidate);
            let candidate_directory = candidate_directory.to_string_lossy().into_owned();
            if !candidate_directory.is_empty() && path_entry_set.insert(candidate_directory.clone())
            {
                path_entries.insert(0, candidate_directory);
            }
        }
        if !path_entries.is_empty() {
            environment.insert(
                OsString::from("PATH"),
                OsString::from(path_entries.join(&delimiter.to_string())),
            );
        }
        environment
    }

    pub fn mcp_overrides(&self, kind: AgentKind) -> HashMap<String, bool> {
        self.mcp_preferences
            .lock()
            .expect("MCP preferences lock")
            .get(kind.as_str())
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_mcp_enabled(
        &self,
        kind: AgentKind,
        name: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let mut preferences = self.mcp_preferences.lock().expect("MCP preferences lock");
        let mut next = preferences.clone();
        next.entry(kind.as_str().into())
            .or_default()
            .insert(name.into(), enabled);
        crate::json_file::write(&self.mcp_preferences_path, &next)?;
        *preferences = next;
        Ok(())
    }

    pub fn has_agent_cli(&self, kind: AgentKind) -> bool {
        let index = kind as usize;
        if let Some(value) = self.availability_cache.lock().expect("cache lock")[index] {
            return value;
        }

        let available = self
            .path_candidates(kind)
            .into_iter()
            .any(|candidate| candidate.exists())
            || Command::new(if self.is_windows { "where" } else { "which" })
                .arg(kind.as_str())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success());
        self.availability_cache.lock().expect("cache lock")[index] = Some(available);
        available
    }

    fn find_in_nvm_versions(&self, binary_name: &str) -> Option<PathBuf> {
        let versions_directory = self.home_directory.join(".nvm/versions/node");
        let mut versions = std::fs::read_dir(&versions_directory)
            .ok()?
            .flatten()
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();
        versions.sort();
        versions.reverse();
        versions.into_iter().find_map(|version| {
            let candidate = versions_directory
                .join(version)
                .join("bin")
                .join(binary_name);
            candidate.exists().then_some(candidate)
        })
    }
}

fn javascript_dirname(path: &Path) -> PathBuf {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[test]
fn mcp_controls_persist_per_provider_and_feed_agent_launches() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("mcp-preferences.json");
    let resolver = AgentCommandResolver::new(root.path(), path.clone());
    resolver
        .set_mcp_enabled(AgentKind::Codex, "linear", false)
        .unwrap();
    resolver
        .set_mcp_enabled(AgentKind::Claude, "linear", true)
        .unwrap();
    let restored = AgentCommandResolver::new(root.path(), path);
    assert_eq!(
        restored.mcp_overrides(AgentKind::Codex).get("linear"),
        Some(&false)
    );
    assert_eq!(
        restored.mcp_overrides(AgentKind::Claude).get("linear"),
        Some(&true)
    );
    assert_eq!(
        crate::agent_mcp::overrides(&restored.create_agent_env(AgentKind::Codex))
            .get("linear"),
        Some(&false)
    );
}

#[cfg(all(test, target_os = "macos"))]
#[test]
fn local_program_resolves_app_bundles_but_preserves_interpreter_aliases() {
    use std::os::unix::{fs::PermissionsExt, fs::symlink};
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    let executable = root.path().join("Render.app/Contents/MacOS/Render");
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::create_dir(&bin).unwrap();
    std::fs::write(&executable, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    symlink(&executable, bin.join("render")).unwrap();
    symlink("/usr/bin/python3", bin.join("python3")).unwrap();
    assert_eq!(
        resolve_local_program("render", bin.as_os_str()).unwrap(),
        executable.canonicalize().unwrap()
    );
    assert_eq!(
        resolve_local_program("python3", bin.as_os_str()).unwrap(),
        bin.join("python3")
    );
    assert!(resolve_local_program("missing", bin.as_os_str()).is_err());
    std::fs::write(bin.join("not-executable"), "text").unwrap();
    assert!(resolve_local_program("not-executable", bin.as_os_str()).is_err());
}
