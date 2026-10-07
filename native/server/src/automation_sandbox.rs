//! Provider request policy for approved automation inputs. Interactive chats do not use it.
use inferay_core::project_files::Permission;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::Path};

#[derive(Clone)]
pub(crate) struct AutomationSandbox {
    roots: Vec<String>,
    reads: BTreeSet<std::path::PathBuf>,
    network: bool,
    gpu: bool,
    commit: bool,
    repositories: Vec<String>,
    git_writes: BTreeSet<std::path::PathBuf>,
}
impl AutomationSandbox {
    pub(crate) fn new(may: &BTreeSet<Permission>, repositories: &Value, project: &Path) -> Self {
        let mut roots = BTreeSet::new();
        if may.contains(&Permission::WriteRepositories) {
            if let Some(paths) = repositories.as_object() {
                roots.extend(paths.values().filter_map(Value::as_str).map(str::to_owned));
            }
        }
        if may.contains(&Permission::WriteProjectFiles) {
            roots.insert(project.to_string_lossy().into_owned());
        }
        let mut reads = BTreeSet::from([project.to_path_buf()]);
        if may.contains(&Permission::ReadRepositories)
            || may.contains(&Permission::WriteRepositories)
        {
            reads.extend(
                repositories
                    .as_object()
                    .into_iter()
                    .flat_map(|paths| paths.values())
                    .filter_map(Value::as_str)
                    .map(std::path::PathBuf::from),
            );
        }
        Self {
            reads,
            git_writes: BTreeSet::new(),
            roots: roots.into_iter().collect(),
            network: may.contains(&Permission::Network),
            gpu: may.contains(&Permission::Gpu),
            commit: may.contains(&Permission::Commit),
            repositories: repositories
                .as_object()
                .map(|paths| {
                    paths
                        .values()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
    pub(crate) fn git_write_paths(&self) -> Result<BTreeSet<std::path::PathBuf>, String> {
        if self.commit {
            let paths = git_metadata_directories(self.roots.iter())?;
            for path in &paths {
                if !path.join("HEAD").is_file()
                    || !(path.join("objects").is_dir() || path.join("commondir").is_file())
                {
                    return Err("Git write target is not a Git metadata directory".into());
                }
            }
            Ok(paths)
        } else {
            Ok(BTreeSet::new())
        }
    }
    pub(crate) fn with_reviewed_git_paths(mut self, reviewed: &Value) -> Result<Self, String> {
        let approved: BTreeSet<std::path::PathBuf> =
            serde_json::from_value(if reviewed.is_null() {
                json!([])
            } else {
                reviewed.clone()
            })
            .map_err(|error| format!("Invalid reviewed Git paths: {error}"))?;
        let current = self.git_write_paths()?;
        if current != approved {
            return Err(
                "Git write locations changed since approval; review the automation again".into(),
            );
        }
        self.git_writes = approved;
        Ok(self)
    }
    pub(crate) fn claude(&self, arguments: &mut Vec<String>) -> Result<(), String> {
        let index = arguments
            .iter()
            .rposition(|argument| argument == "--settings")
            .map(|index| index + 1)
            .ok_or("Missing Claude settings argument")?;
        let mut settings: Value =
            serde_json::from_str(arguments.get(index).ok_or("Missing Claude settings")?)
                .map_err(|error| format!("Invalid Claude settings: {error}"))?;
        settings["disableAllHooks"] = json!(true);
        // Mutations and shell commands share Inferay's bounded process runner.
        settings["permissions"] = json!({"allow":["mcp__inferay__*"],"deny":["Bash","Edit","Write","Read","Glob","Grep","WebFetch","WebSearch"]});
        settings["sandbox"] = json!({
            "enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":false,
            "allowUnsandboxedCommands":false,"excludedCommands":[],
            "filesystem":{"allowWrite":[]},
            "network":{"allowedDomains":[],"strictAllowlist":true,"allowLocalBinding":false}
        });
        arguments[index] = settings.to_string();
        arguments.retain(|arg| arg != "--dangerously-skip-permissions");
        arguments.extend([
            "--restricted".into(),
            "--permission-mode".into(),
            "dontAsk".into(),
            "--permission-prompts".into(),
            "none".into(),
            "--setting-sources".into(),
            "".into(),
            "--tools".into(),
            "".into(),
        ]);
        Ok(())
    }
    /// Local tools and their children share an OS boundary; never silently run unsandboxed.
    #[cfg(target_os = "macos")]
    pub(crate) fn tool_command(
        &self,
        program: &str,
        args: &[String],
        output: &Path,
        scratch: &Path,
    ) -> Result<tokio::process::Command, String> {
        // Tool subprocesses never inherit the operator's home or automatic user config.
        // Provider credentials stay with the provider process, outside this environment.
        let home = scratch.join("home");
        for path in [
            &home,
            &home.join(".config"),
            &home.join(".cache"),
            &home.join(".local/share"),
            &home.join(".local/state"),
        ] {
            std::fs::create_dir_all(path)
                .map_err(|error| format!("Cannot create private tool home: {error}"))?;
        }
        let mut command = tokio::process::Command::new("/usr/bin/sandbox-exec");
        command
            .env_clear()
            .envs(std::env::vars_os().filter(|(key, _)| {
                matches!(key.to_str(), Some("PATH" | "LANG" | "LC_ALL" | "LC_CTYPE"))
            }))
            .env("HOME", &home)
            .env("XDG_CONFIG_HOME", home.join(".config"))
            .env("XDG_CACHE_HOME", home.join(".cache"))
            .env("XDG_DATA_HOME", home.join(".local/share"))
            .env("XDG_STATE_HOME", home.join(".local/state"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("TMPDIR", &scratch)
            .env("TMP", &scratch)
            .env("TEMP", &scratch);
        let mut profile = String::from(
            "(version 1)\n(deny default)\n(allow file-read-metadata)\n(allow process-exec process-fork sysctl-read)\n(allow signal (target same-sandbox))\n(allow process-info* (target same-sandbox))\n(allow file-write-data (literal \"/dev/null\"))\n",
        );
        let executable = crate::agent_command::resolve_local_program(
            program,
            &std::env::var_os("PATH").unwrap_or_default(),
        )?;
        if executable.is_absolute() {
            let path = executable
                .canonicalize()
                .map_err(|error| format!("Cannot resolve tool executable: {error}"))?;
            command
                .arg("-D")
                .arg(format!("TOOL_EXECUTABLE={}", path.display()));
            profile.push_str("(allow file-read-data (literal (param \"TOOL_EXECUTABLE\")))\n");
        }
        if let Some(bundle) = executable
            .ancestors()
            .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        {
            let bundle = bundle
                .canonicalize()
                .map_err(|error| format!("Cannot resolve runtime bundle: {error}"))?;
            command
                .arg("-D")
                .arg(format!("RUNTIME_BUNDLE={}", bundle.display()));
            profile.push_str("(allow file-read-data (subpath (param \"RUNTIME_BUNDLE\")))\n");
        }
        // Runtime code is readable; user data is limited to the approved project
        // and explicitly selected repositories. Metadata access supports path lookup.
        let mut reads = self.reads.clone();
        reads.extend([output.to_path_buf(), scratch.to_path_buf()]);
        reads.extend(git_metadata_directories(self.reads.iter())?);
        for directory in [
            "/System/Library",
            "/usr/bin",
            "/usr/sbin",
            "/usr/lib",
            "/usr/libexec",
            "/usr/share",
            "/usr/local/bin",
            "/usr/local/lib",
            "/usr/local/Cellar",
            "/usr/local/opt",
            "/bin",
            "/sbin",
            "/Applications/Xcode.app",
            "/Library/Developer",
            "/Library/Frameworks",
            "/Library/Apple",
            "/Library/Fonts",
            "/opt/homebrew/Cellar",
            "/opt/homebrew/opt",
            "/opt/homebrew/lib",
            "/opt/homebrew/bin",
        ] {
            if Path::new(directory).exists() {
                reads.insert(directory.into());
            }
        }
        for (index, path) in reads.iter().enumerate() {
            let canonical = path
                .canonicalize()
                .map_err(|error| format!("Sandbox read directory is unavailable: {error}"))?;
            let name = format!("READ_{index}");
            command
                .arg("-D")
                .arg(format!("{name}={}", canonical.display()));
            profile.push_str(&format!(
                "(allow file-read-data (subpath (param \"{name}\")))\n"
            ));
        }
        for (index, file) in [
            "/",
            "/dev/null",
            "/dev/urandom",
            "/dev/random",
            "/Library/Preferences/com.apple.dt.Xcode.plist",
            "/private/etc/localtime",
            "/private/etc/hosts",
            "/private/etc/resolv.conf",
        ]
        .iter()
        .enumerate()
        {
            if Path::new(file).exists() {
                let canonical = Path::new(file)
                    .canonicalize()
                    .map_err(|error| format!("Cannot resolve runtime file: {error}"))?;
                let name = format!("RUNTIME_FILE_{index}");
                command
                    .arg("-D")
                    .arg(format!("{name}={}", canonical.display()));
                profile.push_str(&format!(
                    "(allow file-read-data (literal (param \"{name}\")))\n"
                ));
            }
        }
        let mut writable_roots = Vec::new();
        for (index, root) in self
            .roots
            .iter()
            .map(Path::new)
            .chain(self.git_writes.iter().map(|path| path.as_path()))
            .chain([output, scratch])
            .enumerate()
        {
            let canonical = root
                .canonicalize()
                .map_err(|error| format!("Sandbox write directory is unavailable: {error}"))?;
            if self.git_writes.contains(root) && canonical != root {
                return Err("Reviewed Git write location changed before execution".into());
            }
            writable_roots.push(canonical.clone());
            let name = format!("WRITE_{index}");
            command
                .arg("-D")
                .arg(format!("{name}={}", canonical.display()));
            profile.push_str(&format!(
                "(allow file-write* (subpath (param \"{name}\")))\n"
            ));
        }
        if !self.commit {
            // Git's ordinary metadata stays protected even when a tool creates
            // another checkout inside an approved writable directory.
            profile.push_str(
                r##"(deny file-write* (regex #"(^|/)\.git(/|$)"))
"##,
            );
            let mut protected =
                git_metadata_directories(self.repositories.iter().chain(self.roots.iter()))?;
            protected.extend(git_metadata_aliases(&protected, &writable_roots)?);
            // Seatbelt path rules do not follow a renamed ancestor. Keep each
            // containing directory in place while allowing edits to its other files.
            let ancestors = protected
                .iter()
                .flat_map(|path| path.ancestors().skip(1))
                .collect::<BTreeSet<_>>();
            for (index, path) in ancestors.iter().enumerate() {
                let name = format!("GIT_PARENT_{index}");
                command.arg("-D").arg(format!("{name}={}", path.display()));
                profile.push_str(&format!(
                    "(deny file-write-unlink (literal (param \"{name}\")))\n"
                ));
            }
            for (index, path) in protected.iter().enumerate() {
                let name = format!("GIT_{index}");
                command.arg("-D").arg(format!("{name}={}", path.display()));
                profile.push_str(&format!(
                    "(deny file-write* (subpath (param \"{name}\")))\n"
                ));
            }
        }
        if self.network {
            profile.push_str("(allow network*)\n(allow mach-lookup (global-name \"com.apple.system.opendirectoryd.libinfo\") (global-name \"com.apple.SystemConfiguration.configd\"))\n");
        }
        if self.gpu {
            // Apple Silicon graphics device/surface access and the application
            // registration required by Metal's AppKit-backed context creation.
            profile.push_str(
                r#"(allow iokit-open
    (iokit-user-client-class "AGXDeviceUserClient")
    (iokit-user-client-class "IOSurfaceRootUserClient"))
(allow mach-lookup
    (global-name "com.apple.system.notification_center")
    (global-name "com.apple.system.opendirectoryd.libinfo")
    (global-name "com.apple.coreservices.launchservicesd")
    (global-name "com.apple.lsd.mapdb")
    (global-name "com.apple.lsd.modifydb")
    (global-name "com.apple.windowserver.active")
    (global-name "com.apple.MTLCompilerService"))
"#,
            );
        }
        command
            .args(["-p", &profile, "--"])
            .arg(executable)
            .args(args);
        Ok(command)
    }
    #[cfg(not(target_os = "macos"))]
    pub(crate) fn tool_command(
        &self,
        _program: &str,
        _args: &[String],
        _output: &Path,
        _scratch: &Path,
    ) -> Result<tokio::process::Command, String> {
        Err(
            "Local tool sandboxing is not available on this platform; the tool was not started"
                .into(),
        )
    }

    pub(crate) fn turn(&self) -> Value {
        json!({"type":"readOnly","networkAccess":false})
    }
    /// Applied after user configuration translation so ambient permissions cannot widen this run.
    pub(crate) fn thread(&self, params: &mut Value, config: &Value) {
        params["sandbox"] = json!("read-only");
        params["experimentalRawEvents"] = json!(true);
        params["approvalPolicy"] = json!("never");
        params["config"]["sandbox_mode"] = json!("read-only");
        if let Some(overrides) = params["config"].as_object_mut() {
            overrides.retain(|key, _| !key.starts_with("mcp_servers."));
        }
        params["config"]["sandbox_workspace_write"] = json!({"writable_roots":[],"network_access":false,"exclude_slash_tmp":true,"exclude_tmpdir_env_var":true});
        params["config"]["web_search"] = json!("disabled");
        // Ambient optional executors must not add authority outside the run's tools.
        for feature in [
            "shell_tool",
            "js_repl",
            "js_repl_tools_only",
            "apps",
            "plugins",
            "hooks",
            "multi_agent",
            "multi_agent_v2",
            "browser_use",
            "browser_use_external",
            "computer_use",
            "image_generation",
            "request_permissions_tool",
        ] {
            params["config"]["features"][feature] = json!(false);
        }
        // Automation MCP capabilities are supplied through the run's explicit dynamic tools.
        if let Some(servers) = config["mcp_servers"].as_object() {
            let disabled: serde_json::Map<String, Value> = servers
                .keys()
                .map(|name| (name.clone(), json!({"enabled":false})))
                .collect();
            params["config"]["mcp_servers"] = json!(disabled);
        }
    }
}

/// Seatbelt rules name paths, not inodes. Include existing writable hard-link
/// aliases and metadata symlink targets before granting broad working-file writes.
#[cfg(target_os = "macos")]
fn git_metadata_aliases(
    directories: &BTreeSet<std::path::PathBuf>,
    writable_roots: &[std::path::PathBuf],
) -> Result<BTreeSet<std::path::PathBuf>, String> {
    use std::os::unix::fs::MetadataExt;
    let mut aliases = BTreeSet::new();
    let mut linked = BTreeSet::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let mut remaining = 200_000usize;
    let mut check_budget = || -> Result<(), String> {
        if remaining == 0 || std::time::Instant::now() >= deadline {
            return Err(
                "Git metadata alias inspection exceeded its limit; the tool was not started".into(),
            );
        }
        remaining -= 1;
        Ok(())
    };
    for directory in directories {
        for entry in walkdir::WalkDir::new(directory).follow_links(true) {
            check_budget()?;
            let entry =
                entry.map_err(|error| format!("Cannot inspect Git metadata aliases: {error}"))?;
            if entry.path_is_symlink() {
                aliases.insert(
                    entry
                        .path()
                        .canonicalize()
                        .map_err(|error| format!("Cannot resolve Git metadata alias: {error}"))?,
                );
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Cannot inspect Git metadata file: {error}"))?;
            if metadata.is_file() && metadata.nlink() > 1 {
                linked.insert((metadata.dev(), metadata.ino()));
            }
        }
    }
    if linked.is_empty() {
        return Ok(aliases);
    }
    let roots = writable_roots.iter().collect::<BTreeSet<_>>();
    for root in &roots {
        if roots
            .iter()
            .any(|parent| root != parent && root.starts_with(parent))
        {
            continue;
        }
        // Targets outside these canonical write roots are already read-only.
        // Metadata directories and ordinary .git paths are already protected.
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.file_name() != ".git"
                    && !directories
                        .iter()
                        .any(|directory| entry.path().starts_with(directory))
            })
        {
            check_budget()?;
            let entry =
                entry.map_err(|error| format!("Cannot inspect writable Git aliases: {error}"))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Cannot inspect writable file: {error}"))?;
            if linked.contains(&(metadata.dev(), metadata.ino())) {
                aliases.insert(entry.into_path());
            }
        }
    }
    Ok(aliases)
}

/// Resolve worktree and separate-git-dir pointers without invoking repository
/// hooks or inheriting Git configuration. Invalid metadata blocks execution.
pub(crate) fn git_metadata_directories<'a, P: AsRef<Path> + 'a>(
    roots: impl Iterator<Item = &'a P>,
) -> Result<BTreeSet<std::path::PathBuf>, String> {
    fn pointer(path: &Path) -> Result<String, String> {
        use std::io::Read;
        let file = std::fs::File::open(path)
            .map_err(|error| format!("Cannot inspect Git metadata: {error}"))?;
        let mut text = String::new();
        file.take(4097)
            .read_to_string(&mut text)
            .map_err(|error| format!("Cannot read Git metadata pointer: {error}"))?;
        if text.len() > 4096 {
            return Err("Git metadata pointer exceeds 4096 bytes".into());
        }
        Ok(text.trim_end_matches(['\r', '\n']).into())
    }
    fn canonical(path: &Path) -> Result<std::path::PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Cannot resolve Git metadata directory: {error}"))?;
        if !canonical.is_dir() {
            return Err("Git metadata pointer must name a directory".into());
        }
        Ok(canonical)
    }
    let mut protected = BTreeSet::new();
    for root in roots {
        let root = root.as_ref();
        let marker = root.join(".git");
        let git = match std::fs::metadata(&marker) {
            Ok(metadata) if metadata.is_dir() => canonical(&marker)?,
            Ok(metadata) if metadata.is_file() => {
                let text = pointer(&marker)?;
                let path = text
                    .strip_prefix("gitdir: ")
                    .filter(|path| !path.is_empty())
                    .ok_or("Invalid Git directory pointer")?;
                canonical(&root.join(path))?
            }
            Ok(_) => return Err("Git metadata marker is not a file or directory".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if std::fs::symlink_metadata(&marker).is_ok() {
                    return Err("Git metadata symlink has no target".into());
                }
                if root.join("HEAD").is_file() && root.join("objects").is_dir() {
                    canonical(root)?
                } else {
                    continue;
                }
            }
            Err(error) => return Err(format!("Cannot inspect Git metadata: {error}")),
        };
        let common = git.join("commondir");
        match std::fs::metadata(&common) {
            Ok(metadata) if metadata.is_file() => {
                protected.insert(canonical(&git.join(pointer(&common)?))?);
            }
            Ok(_) => return Err("Git common directory pointer is not a file".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if std::fs::symlink_metadata(&common).is_ok() {
                    return Err("Git common directory symlink has no target".into());
                }
            }
            Err(error) => return Err(format!("Cannot inspect Git common directory: {error}")),
        }
        protected.insert(git);
    }
    Ok(protected)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn native_reads_are_limited_to_project_and_granted_repositories() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let repo = temp.path().join("repository");
        let output = temp.path().join("output");
        let scratch = temp.path().join("scratch");
        for path in [&project, &repo, &output, &scratch] {
            std::fs::create_dir(path).unwrap();
        }
        std::fs::write(project.join("context.txt"), "project").unwrap();
        std::fs::write(repo.join("context.txt"), "repository").unwrap();
        let outside = temp.path().join("private.txt");
        std::fs::write(&outside, "private").unwrap();
        std::os::unix::fs::symlink(&outside, project.join("escape.txt")).unwrap();
        let script = r#"import errno, pathlib, sys
project, repo, outside, allowed = sys.argv[1:]
assert pathlib.Path(project, 'context.txt').read_text() == 'project'
paths = [(pathlib.Path(repo, 'context.txt'), allowed == 'yes'), (pathlib.Path(outside), False), (pathlib.Path(project, 'escape.txt'), False)]
volume_alias = pathlib.Path('/System/Volumes/Data') / pathlib.Path(outside).relative_to('/')
if volume_alias.exists():
    paths.append((volume_alias, False))
for path, permitted in paths:
    try:
        value = path.read_text()
    except OSError as error:
        assert not permitted and error.errno in [errno.EPERM, errno.EACCES], (path, error)
    else:
        assert permitted and value == 'repository', path
"#;
        for read in [false, true] {
            let permissions = if read {
                BTreeSet::from([Permission::ReadRepositories])
            } else {
                BTreeSet::new()
            };
            let policy = AutomationSandbox::new(&permissions, &json!({"repo": repo}), &project);
            let args = vec![
                "-c".into(),
                script.into(),
                project.to_string_lossy().into_owned(),
                repo.to_string_lossy().into_owned(),
                outside.to_string_lossy().into_owned(),
                if read { "yes" } else { "no" }.into(),
            ];
            let result = policy
                .tool_command("/usr/bin/python3", &args, &output, &scratch)
                .unwrap()
                .current_dir(&project)
                .output()
                .await
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn external_git_metadata_needs_reviewed_paths_and_commit_permission() {
        for worktree in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let project = temp.path().join("project");
            let repo = temp.path().join("repo");
            let mut metadata = temp.path().join("metadata");
            let output = temp.path().join("output");
            let scratch = temp.path().join("scratch");
            for path in [&project, &repo, &output, &scratch] {
                std::fs::create_dir(path).unwrap();
            }
            if worktree {
                assert!(
                    std::process::Command::new("/usr/bin/git")
                        .arg("init")
                        .arg(&metadata)
                        .output()
                        .unwrap()
                        .status
                        .success()
                );
                assert!(
                    std::process::Command::new("/usr/bin/git")
                        .arg("-C")
                        .arg(&metadata)
                        .args([
                            "-c",
                            "user.name=Fixture",
                            "-c",
                            "user.email=fixture@example.invalid",
                            "-c",
                            "commit.gpgSign=false",
                            "-c",
                            "core.hooksPath=/dev/null",
                            "commit",
                            "--allow-empty",
                            "-m",
                            "fixture"
                        ])
                        .output()
                        .unwrap()
                        .status
                        .success()
                );
                assert!(
                    std::process::Command::new("/usr/bin/git")
                        .arg("-C")
                        .arg(&metadata)
                        .args(["worktree", "add"])
                        .arg(&repo)
                        .output()
                        .unwrap()
                        .status
                        .success()
                );
                metadata = metadata.join(".git");
            } else {
                assert!(
                    std::process::Command::new("/usr/bin/git")
                        .args(["init", "--separate-git-dir"])
                        .arg(&metadata)
                        .arg(&repo)
                        .output()
                        .unwrap()
                        .status
                        .success()
                );
            }
            std::fs::write(repo.join("file.txt"), "content").unwrap();
            let may = BTreeSet::from([Permission::WriteRepositories, Permission::Commit]);
            let repositories = json!({"repo":repo});
            let paths = AutomationSandbox::new(&may, &repositories, &project)
                .git_write_paths()
                .unwrap();
            assert!(paths.contains(&metadata.canonicalize().unwrap()));
            assert_eq!(paths.len(), if worktree { 2 } else { 1 });
            assert!(
                AutomationSandbox::new(
                    &BTreeSet::from([Permission::Commit]),
                    &repositories,
                    &project
                )
                .with_reviewed_git_paths(&json!(paths))
                .is_err()
            );
            assert!(
                AutomationSandbox::new(&may, &repositories, &project)
                    .with_reviewed_git_paths(&json!([project]))
                    .is_err()
            );
            let script = r#"import errno, pathlib, subprocess, sys
repo, outside, approved = sys.argv[1:]
def git(*args):
    return subprocess.run(['/usr/bin/git', '-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', *args], capture_output=True)
staged = git('add', 'file.txt')
assert (staged.returncode == 0) == (approved == 'yes'), staged.stderr
if approved == 'yes':
    committed = git('commit', '-m', 'approved external metadata')
    assert committed.returncode == 0, committed.stderr
try: pathlib.Path(outside).write_text('must not widen parent access')
except OSError as error: assert error.errno in (errno.EPERM, errno.EACCES), repr(error)
else: raise AssertionError('unapproved parent became writable')
"#;
            for approved in [false, true] {
                let policy = AutomationSandbox::new(&may, &repositories, &project);
                let policy = if approved {
                    policy.with_reviewed_git_paths(&json!(paths)).unwrap()
                } else {
                    policy
                };
                let args = vec![
                    "-c".into(),
                    script.into(),
                    repo.display().to_string(),
                    temp.path().join("unapproved.txt").display().to_string(),
                    if approved { "yes" } else { "no" }.into(),
                ];
                let result = policy
                    .tool_command("/usr/bin/python3", &args, &output, &scratch)
                    .unwrap()
                    .current_dir(&project)
                    .env_clear()
                    .env("PATH", "/usr/bin:/bin")
                    .env("HOME", &scratch)
                    .output()
                    .await
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{}",
                    String::from_utf8_lossy(&result.stderr)
                );
            }
            // Approval of one binding cannot follow a replaced pointer.
            let other = temp.path().join("other-metadata");
            std::fs::create_dir(&other).unwrap();
            let reviewed = AutomationSandbox::new(&may, &repositories, &project)
                .with_reviewed_git_paths(&json!(paths))
                .unwrap();
            std::fs::rename(&metadata, temp.path().join("original-metadata")).unwrap();
            std::os::unix::fs::symlink(&other, &metadata).unwrap();
            let error = reviewed
                .tool_command("/usr/bin/true", &[], &output, &scratch)
                .unwrap_err();
            assert!(
                error.contains("changed before execution")
                    || error.contains("Cannot resolve Git metadata directory"),
                "{error}"
            );
            std::fs::write(repo.join(".git"), format!("gitdir: {}", other.display())).unwrap();
            assert!(
                AutomationSandbox::new(&may, &repositories, &project)
                    .with_reviewed_git_paths(&json!(paths))
                    .is_err()
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn local_tools_and_children_obey_write_and_network_grants() {
        let temp = tempfile::tempdir().unwrap();
        let output = temp.path().join("output");
        let scratch = temp.path().join("scratch");
        let project = temp.path().join("project");
        for dir in [&output, &scratch, &project] {
            std::fs::create_dir(dir).unwrap();
        }
        let script = r#"import errno, pathlib, socket, subprocess, sys
out, project, outside, writable, network = sys.argv[1:]
pathlib.Path(out, 'ok').write_text('ok')
def attempt(path, allowed):
    try: pathlib.Path(path).write_text('probe')
    except OSError as e:
        assert not allowed and e.errno in (errno.EPERM, errno.EACCES), repr(e)
    else: assert allowed, 'unexpected write: ' + path
attempt(str(pathlib.Path(project, 'probe')), writable == 'yes')
attempt(outside, False)
child = subprocess.run(['/bin/sh', '-c', 'echo escape > "$1"', 'probe', outside], capture_output=True)
assert child.returncode != 0
assert not pathlib.Path(outside).exists()
try:
    sock = socket.socket()
    sock.connect(('127.0.0.1', 9))
except OSError as e:
    if network == 'yes': assert e.errno == errno.ECONNREFUSED, repr(e)
    else: assert e.errno in (errno.EPERM, errno.EACCES), repr(e)
else: assert network == 'yes'
print('verified')
"#;
        for (granted, gpu) in [(false, false), (false, true), (true, false), (true, true)] {
            let mut may = if granted {
                BTreeSet::from([Permission::WriteProjectFiles, Permission::Network])
            } else {
                BTreeSet::new()
            };
            if gpu {
                may.insert(Permission::Gpu);
            }
            let policy = AutomationSandbox::new(&may, &json!({}), &project);
            let flag = if granted { "yes" } else { "no" };
            let args = vec![
                "-c".into(),
                script.into(),
                output.display().to_string(),
                project.display().to_string(),
                temp.path().join("outside").display().to_string(),
                flag.into(),
                flag.into(),
            ];
            let result = policy
                .tool_command("/usr/bin/python3", &args, &output, &scratch)
                .unwrap()
                .current_dir(&project)
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .output()
                .await
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            assert_eq!(String::from_utf8_lossy(&result.stdout).trim(), "verified");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn invalid_git_metadata_blocks_policy_instead_of_omitting_protection() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().display().to_string();
        let marker = temp.path().join(".git");
        for text in [
            "not a gitdir pointer".to_owned(),
            "gitdir: missing".into(),
            "x".repeat(4097),
        ] {
            std::fs::write(&marker, text).unwrap();
            assert!(git_metadata_directories(std::iter::once(&root)).is_err());
        }
        std::fs::write(temp.path().join("not-a-directory"), "data").unwrap();
        std::fs::write(&marker, "gitdir: not-a-directory").unwrap();
        assert!(git_metadata_directories(std::iter::once(&root)).is_err());
        std::fs::remove_file(&marker).unwrap();
        std::os::unix::fs::symlink("missing", &marker).unwrap();
        assert!(git_metadata_directories(std::iter::once(&root)).is_err());
        std::fs::remove_file(&marker).unwrap();
        std::fs::create_dir(&marker).unwrap();
        std::os::unix::fs::symlink("missing", marker.join("commondir")).unwrap();
        assert!(git_metadata_directories(std::iter::once(&root)).is_err());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn local_tool_git_metadata_requires_commit_permission() {
        use std::process::Command;
        fn git(root: &Path, args: &[&str]) -> String {
            let result = Command::new("git")
                .arg("-C")
                .arg(root)
                .args([
                    "-c",
                    "user.name=Sandbox test",
                    "-c",
                    "user.email=sandbox@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            String::from_utf8(result.stdout).unwrap().trim().into()
        }
        for layout in ["ordinary", "separate", "worktree"] {
            let temp = tempfile::tempdir().unwrap();
            let project = temp.path().canonicalize().unwrap().join("project");
            std::fs::create_dir(&project).unwrap();
            let base = project.join("base");
            std::fs::create_dir(&base).unwrap();
            if layout == "ordinary" {
                git(&base, &["init"]);
            } else {
                std::fs::create_dir(project.join("admin")).unwrap();
                git(
                    &base,
                    &[
                        "init",
                        "--separate-git-dir",
                        project.join("admin/metadata").to_str().unwrap(),
                    ],
                );
            }
            std::fs::write(base.join("README.md"), "original").unwrap();
            git(&base, &["add", "README.md"]);
            git(&base, &["commit", "-m", "Initial"]);
            let repo = if layout == "worktree" {
                let repo = project.join("linked");
                git(
                    &base,
                    &["worktree", "add", "-b", "test", repo.to_str().unwrap()],
                );
                repo
            } else {
                base
            };
            let head = git(&repo, &["rev-parse", "HEAD"]);
            let metadata = git(&repo, &["rev-parse", "--absolute-git-dir"]);
            std::fs::hard_link(
                Path::new(&metadata).join("HEAD"),
                project.join("existing-head-alias"),
            )
            .unwrap();
            std::fs::write(project.join("shared-metadata"), "keep").unwrap();
            std::os::unix::fs::symlink(
                project.join("shared-metadata"),
                Path::new(&metadata).join("metadata-link"),
            )
            .unwrap();
            let output = project.join("output");
            let scratch = project.join("tmp");
            std::fs::create_dir(&output).unwrap();
            std::fs::create_dir(&scratch).unwrap();
            let script = r#"import errno, os, pathlib, subprocess, sys
repo, metadata, output, granted = sys.argv[1:]
pathlib.Path(repo, 'README.md').write_text('approved working tree edit')
def git(*args):
    return subprocess.run(['/usr/bin/git', '-C', repo, '-c', 'user.name=Sandbox test', '-c', 'user.email=sandbox@example.invalid', '-c', 'commit.gpgsign=false', *args], capture_output=True)
result = git('add', 'README.md')
assert (result.returncode == 0) == (granted == 'yes'), result.stderr
result = git('commit', '-m', 'Tool commit')
assert (result.returncode == 0) == (granted == 'yes'), result.stderr
if granted == 'no':
    def denied_write(path):
        try: pathlib.Path(path).write_text('must not overwrite metadata')
        except OSError as e: assert e.errno in (errno.EPERM, errno.EACCES), repr(e)
        else: raise AssertionError('metadata write escaped: ' + str(path))
    head = pathlib.Path(metadata, 'HEAD')
    denied_write(head)
    denied_write(pathlib.Path(repo).parent / "existing-head-alias")
    denied_write(pathlib.Path(repo).parent / "shared-metadata")
    alias = pathlib.Path(output, 'head-alias')
    try: os.link(head, alias)
    except OSError as e: assert e.errno in (errno.EPERM, errno.EACCES), repr(e)
    else: denied_write(alias)
    # Moving a containing directory must not move metadata out of its deny rule.
    for parent in pathlib.Path(metadata).parents:
        if parent.name == 'admin':
            try: parent.rename(parent.with_name('admin-moved'))
            except OSError as e: assert e.errno in (errno.EPERM, errno.EACCES), repr(e)
            else: raise AssertionError('metadata ancestor rename escaped')
print('verified')
"#;
            for granted in [false, true] {
                let mut may =
                    BTreeSet::from([Permission::WriteRepositories, Permission::WriteProjectFiles]);
                if granted {
                    may.insert(Permission::Commit);
                }
                let policy = AutomationSandbox::new(&may, &json!({"repo": repo}), &project);
                let args = vec![
                    "-c".into(),
                    script.into(),
                    repo.display().to_string(),
                    metadata.clone(),
                    output.display().to_string(),
                    if granted { "yes" } else { "no" }.into(),
                ];
                let result = policy
                    .tool_command("/usr/bin/python3", &args, &output, &scratch)
                    .unwrap()
                    .current_dir(&project)
                    .env_clear()
                    .env("PATH", "/usr/bin:/bin")
                    .env("HOME", &scratch)
                    .output()
                    .await
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{layout}, commit={granted}: {}",
                    String::from_utf8_lossy(&result.stderr)
                );
                assert_eq!(String::from_utf8_lossy(&result.stdout).trim(), "verified");
                assert_eq!(git(&repo, &["rev-parse", "HEAD"]) != head, granted);
            }
        }
    }

    #[test]
    fn automation_providers_cannot_bypass_native_execution() {
        let policy = AutomationSandbox::new(
            &BTreeSet::from([
                Permission::WriteRepositories,
                Permission::WriteProjectFiles,
                Permission::Commit,
                Permission::Network,
            ]),
            &json!({"repo":"/work/repo"}),
            Path::new("/project"),
        );
        let mut args = vec![
            "claude".into(),
            "--dangerously-skip-permissions".into(),
            "--settings".into(),
            "{}".into(),
        ];
        policy.claude(&mut args).unwrap();
        assert!(
            !args
                .iter()
                .any(|arg| arg == "--dangerously-skip-permissions")
        );
        assert!(args.windows(2).any(|pair| pair == ["--tools", ""]));
        let settings: Value = serde_json::from_str(
            &args[args.iter().position(|arg| arg == "--settings").unwrap() + 1],
        )
        .unwrap();
        assert_eq!(
            settings["permissions"]["deny"],
            json!([
                "Bash",
                "Edit",
                "Write",
                "Read",
                "Glob",
                "Grep",
                "WebFetch",
                "WebSearch"
            ])
        );
        assert_eq!(settings["disableAllHooks"], true);
        assert_eq!(settings["sandbox"]["allowUnsandboxedCommands"], false);
        assert_eq!(
            policy.turn(),
            json!({"type":"readOnly","networkAccess":false})
        );
        let mut thread = json!({"sandbox":"danger-full-access","config":{"mcp_servers.ambient.enabled":true},"approvalPolicy":"on-request"});
        policy.thread(
            &mut thread,
            &json!({"mcp_servers":{"ambient":{"command":"unsafe"}}}),
        );
        assert_eq!(thread["sandbox"], "read-only");
        assert_eq!(thread["approvalPolicy"], "never");
        assert_eq!(thread["config"]["features"]["shell_tool"], false);
        for feature in [
            "js_repl",
            "apps",
            "plugins",
            "hooks",
            "multi_agent",
            "multi_agent_v2",
            "browser_use",
            "computer_use",
            "image_generation",
        ] {
            assert_eq!(thread["config"]["features"][feature], false);
        }
        assert_eq!(thread["config"]["web_search"], "disabled");
        assert!(
            thread["config"]
                .get("mcp_servers.ambient.enabled")
                .is_none()
        );
        assert_eq!(
            thread["config"]["mcp_servers"]["ambient"],
            json!({"enabled":false})
        );
    }
}
