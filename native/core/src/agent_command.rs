use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AgentKind {
    Claude,
    Codex,
}

impl AgentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug)]
pub struct AgentCommandResolver {
    home_directory: PathBuf,
    is_windows: bool,
    availability_cache: Mutex<[Option<bool>; 2]>,
}

impl AgentCommandResolver {
    pub fn new(home_directory: impl Into<PathBuf>) -> Self {
        Self {
            home_directory: home_directory.into(),
            is_windows: cfg!(target_os = "windows"),
            availability_cache: Mutex::new([None, None]),
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
