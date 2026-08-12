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

    fn cache_index(self) -> usize {
        match self {
            Self::Claude => 0,
            Self::Codex => 1,
        }
    }
}

#[derive(Debug)]
pub struct AgentCommandResolver {
    home_directory: PathBuf,
    is_windows: bool,
    fixed_environment: Option<HashMap<OsString, OsString>>,
    availability_cache: Mutex<[Option<bool>; 2]>,
}

impl AgentCommandResolver {
    pub fn new(home_directory: impl Into<PathBuf>) -> Self {
        Self {
            home_directory: home_directory.into(),
            is_windows: cfg!(target_os = "windows"),
            fixed_environment: None,
            availability_cache: Mutex::new([None, None]),
        }
    }

    #[cfg(test)]
    fn with_environment(
        home_directory: impl Into<PathBuf>,
        is_windows: bool,
        environment: impl IntoIterator<Item = (OsString, OsString)>,
    ) -> Self {
        Self {
            home_directory: home_directory.into(),
            is_windows,
            fixed_environment: Some(environment.into_iter().collect()),
            availability_cache: Mutex::new([None, None]),
        }
    }

    pub fn path_candidates(&self, kind: AgentKind) -> Vec<PathBuf> {
        let environment = self.environment();
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
        let mut environment = self.environment();
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
        let index = kind.cache_index();
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

    pub fn read_cli_version(&self, kind: AgentKind) -> Option<String> {
        let output = Command::new(self.resolve_agent_binary(kind))
            .arg("--version")
            .envs(self.create_agent_env(kind))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        first_nonempty_line(&String::from_utf8_lossy(&output.stdout))
            .or_else(|| first_nonempty_line(&String::from_utf8_lossy(&output.stderr)))
    }

    fn environment(&self) -> HashMap<OsString, OsString> {
        self.fixed_environment
            .clone()
            .unwrap_or_else(|| std::env::vars_os().collect())
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

fn first_nonempty_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn preserves_agent_candidate_priority_and_resolution() {
        let root = TempDir::new().unwrap();
        let configured = root.path().join("configured/claude");
        let local = root.path().join(".local/bin/claude");
        let codex = root.path().join(".nvm/versions/node/v20/bin/codex");
        std::fs::create_dir_all(configured.parent().unwrap()).unwrap();
        std::fs::create_dir_all(local.parent().unwrap()).unwrap();
        std::fs::create_dir_all(codex.parent().unwrap()).unwrap();
        std::fs::write(&local, "local").unwrap();
        std::fs::write(&codex, "codex").unwrap();
        let resolver = AgentCommandResolver::with_environment(
            root.path(),
            false,
            [
                (
                    OsString::from("CLAUDE_PATH"),
                    configured.as_os_str().to_owned(),
                ),
                (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
            ],
        );

        let claude_candidates = resolver.path_candidates(AgentKind::Claude);
        assert_eq!(claude_candidates[0], configured);
        assert_eq!(claude_candidates[1], local);
        assert_eq!(resolver.resolve_agent_binary(AgentKind::Claude), local);
        assert_eq!(resolver.resolve_agent_binary(AgentKind::Codex), codex);
    }

    #[test]
    fn creates_agent_environment_with_the_existing_prepend_order() {
        let root = TempDir::new().unwrap();
        let explicit = root.path().join("configured/claude");
        let resolver = AgentCommandResolver::with_environment(
            root.path(),
            false,
            [
                (
                    OsString::from("CLAUDE_PATH"),
                    explicit.as_os_str().to_owned(),
                ),
                (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
                (OsString::from("CLAUDECODE"), OsString::from("1")),
            ],
        );

        let environment = resolver.create_agent_env(AgentKind::Claude);
        assert!(!environment.contains_key(OsStr::new("CLAUDECODE")));
        let path = environment[OsStr::new("PATH")].to_string_lossy();
        let entries = path.split(':').collect::<Vec<_>>();
        assert_eq!(entries.last().copied(), Some("/bin"));
        assert!(entries.contains(&explicit.parent().unwrap().to_string_lossy().as_ref()));
        assert_eq!(entries[entries.len() - 2], "/usr/bin");
    }

    #[test]
    fn caches_agent_availability_like_the_typescript_helper() {
        let root = TempDir::new().unwrap();
        let binary = root.path().join("configured/codex");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, "codex").unwrap();
        let resolver = AgentCommandResolver::with_environment(
            root.path(),
            false,
            [
                (OsString::from("CODEX_PATH"), binary.as_os_str().to_owned()),
                (OsString::from("PATH"), OsString::new()),
            ],
        );

        assert!(resolver.has_agent_cli(AgentKind::Codex));
        std::fs::remove_file(binary).unwrap();
        assert!(resolver.has_agent_cli(AgentKind::Codex));
    }

    #[test]
    fn reads_the_first_nonempty_version_line() {
        assert_eq!(
            first_nonempty_line("\n Claude Code 1.2.3 \nother"),
            Some("Claude Code 1.2.3".into())
        );
        assert_eq!(first_nonempty_line("\n \r\n"), None);
    }

    #[cfg(unix)]
    #[test]
    fn reads_cli_version_from_stderr_when_stdout_is_empty() {
        use std::os::unix::fs::PermissionsExt;

        let root = TempDir::new().unwrap();
        let binary = root.path().join("bin/codex");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, "#!/bin/sh\nprintf '\\nCodex CLI 2.3.4\\n' >&2\n").unwrap();
        let mut permissions = std::fs::metadata(&binary).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&binary, permissions).unwrap();
        let resolver = AgentCommandResolver::with_environment(
            root.path(),
            false,
            [
                (OsString::from("CODEX_PATH"), binary.as_os_str().to_owned()),
                (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
            ],
        );

        assert_eq!(
            resolver.read_cli_version(AgentKind::Codex),
            Some("Codex CLI 2.3.4".into())
        );
    }
}
