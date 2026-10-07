//! Provider request policy for approved automation inputs. Interactive chats do not use it.
use inferay_core::project_files::Permission;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::Path};

#[derive(Clone)]
pub(crate) struct AutomationSandbox {
    roots: Vec<String>,
    network: bool,
    gpu: bool,
    commit: bool,
    repositories: Vec<String>,
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
        Self {
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
    pub(crate) fn claude(&self, arguments: &mut Vec<String>, output: &Path) -> Result<(), String> {
        // Permission patterns are glob syntax. Reject paths that would widen a literal grant.
        let output = output.to_string_lossy().into_owned();
        let roots = self.roots.iter().chain(std::iter::once(&output));
        let mut allow = vec![
            "Bash".to_owned(),
            "Read".into(),
            "Glob".into(),
            "Grep".into(),
            "mcp__inferay__*".into(),
        ];
        for root in roots {
            if root.contains(['*', '?', '[', ']', '(', ')', '\n', '\r']) {
                return Err(
                    "Automation path contains unsupported permission-pattern characters".into(),
                );
            }
            allow.push(format!("Edit(/{root}/**)"));
        }
        if self.network {
            allow.extend(["WebFetch".into(), "WebSearch".into()]);
        }
        let mut settings_index = None;
        for (index, argument) in arguments.iter().enumerate() {
            if argument == "--settings" {
                settings_index = Some(index + 1);
            }
        }
        let index = settings_index.ok_or("Missing Claude settings argument")?;
        let mut settings: Value =
            serde_json::from_str(arguments.get(index).ok_or("Missing Claude settings")?)
                .map_err(|e| format!("Invalid Claude settings: {e}"))?;
        settings["disableAllHooks"] = json!(true);
        settings["permissions"] = json!({"allow":allow,"deny":if self.network {vec![]} else {vec!["WebFetch","WebSearch"]}});
        settings["sandbox"] = json!({
            "enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":true,
            "allowUnsandboxedCommands":false,"excludedCommands":[],
            "filesystem":{"allowWrite":self.roots},
            "network":{"allowedDomains":if self.network {vec!["*"]} else {vec![]},"strictAllowlist":true,"allowLocalBinding":false}
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
            if self.network {
                "Bash,Read,Glob,Grep,Edit,Write,WebFetch,WebSearch"
            } else {
                "Bash,Read,Glob,Grep,Edit,Write"
            }
            .into(),
        ]);
        for root in &self.roots {
            arguments.extend(["--add-dir".into(), root.clone()]);
        }
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
        let mut command = tokio::process::Command::new("/usr/bin/sandbox-exec");
        let mut profile = String::from(
            "(version 1)\n(deny default)\n(allow file-read*)\n(allow process-exec process-fork sysctl-read)\n(allow signal (target same-sandbox))\n(allow process-info* (target same-sandbox))\n(allow file-write-data (literal \"/dev/null\"))\n",
        );
        for (index, root) in self
            .roots
            .iter()
            .map(Path::new)
            .chain([output, scratch])
            .enumerate()
        {
            let canonical = root
                .canonicalize()
                .map_err(|error| format!("Sandbox write directory is unavailable: {error}"))?;
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
            let protected =
                protected_git_directories(self.repositories.iter().chain(self.roots.iter()))?;
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
        let executable = crate::agent_command::resolve_local_program(
            program,
            &std::env::var_os("PATH").unwrap_or_default(),
        )?;
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

    pub(crate) fn mode(&self) -> &'static str {
        if self.roots.is_empty() {
            "read-only"
        } else {
            "workspace-write"
        }
    }
    pub(crate) fn turn(&self) -> Value {
        if self.roots.is_empty() {
            json!({"type":"readOnly","networkAccess":self.network})
        } else {
            json!({"type":"workspaceWrite","writableRoots":self.roots,"networkAccess":self.network,"excludeSlashTmp":true,"excludeTmpdirEnvVar":true})
        }
    }
    /// Applied after user configuration translation so ambient permissions cannot widen this run.
    pub(crate) fn thread(&self, params: &mut Value, config: &Value) {
        params["sandbox"] = json!(self.mode());
        params["experimentalRawEvents"] = json!(true);
        params["approvalPolicy"] = json!("never");
        params["config"]["sandbox_mode"] = json!(self.mode());
        if let Some(overrides) = params["config"].as_object_mut() {
            overrides.retain(|key, _| !key.starts_with("mcp_servers."));
        }
        params["config"]["sandbox_workspace_write"] = json!({"writable_roots":self.roots,"network_access":self.network,"exclude_slash_tmp":true,"exclude_tmpdir_env_var":true});
        if !self.network {
            params["config"]["web_search"] = json!("disabled");
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

/// Resolve worktree and separate-git-dir pointers without invoking repository
/// hooks or inheriting Git configuration. Invalid metadata blocks the tool.
#[cfg(target_os = "macos")]
fn protected_git_directories<'a>(
    roots: impl Iterator<Item = &'a String>,
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
        path.canonicalize()
            .map_err(|error| format!("Cannot resolve Git metadata directory: {error}"))
    }
    let mut protected = BTreeSet::new();
    for root in roots {
        let root = Path::new(root);
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
            assert!(protected_git_directories(std::iter::once(&root)).is_err());
        }
        std::fs::remove_file(&marker).unwrap();
        std::os::unix::fs::symlink("missing", &marker).unwrap();
        assert!(protected_git_directories(std::iter::once(&root)).is_err());
        std::fs::remove_file(&marker).unwrap();
        std::fs::create_dir(&marker).unwrap();
        std::os::unix::fs::symlink("missing", marker.join("commondir")).unwrap();
        assert!(protected_git_directories(std::iter::once(&root)).is_err());
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
    fn claude_automation_requires_sandbox_without_ambient_permission_bypass() {
        let policy = AutomationSandbox::new(&BTreeSet::new(), &json!({}), Path::new("/project"));
        let mut args = vec![
            "claude".into(),
            "--dangerously-skip-permissions".into(),
            "--settings".into(),
            "{}".into(),
        ];
        policy.claude(&mut args, Path::new("/run/output")).unwrap();
        assert!(
            !args
                .iter()
                .any(|arg| arg == "--dangerously-skip-permissions")
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--permission-prompts", "none"])
        );
        let settings: Value = serde_json::from_str(
            &args[args.iter().position(|arg| arg == "--settings").unwrap() + 1],
        )
        .unwrap();
        assert_eq!(settings["sandbox"]["failIfUnavailable"], true);
        assert_eq!(settings["sandbox"]["allowUnsandboxedCommands"], false);
        assert_eq!(settings["sandbox"]["network"]["allowedDomains"], json!([]));
        assert_eq!(settings["disableAllHooks"], true);
        assert!(
            policy
                .claude(&mut args, Path::new("/run/unsafe*/output"))
                .is_err()
        );
    }

    #[test]
    fn codex_automation_limits_override_ambient_access() {
        let policy = AutomationSandbox::new(
            &BTreeSet::new(),
            &json!({"repo":"/work/repo"}),
            Path::new("/work/project"),
        );
        assert_eq!(
            policy.turn(),
            json!({"type":"readOnly","networkAccess":false})
        );
        let mut thread = json!({"sandbox":"danger-full-access","config":{"mcp_servers.ambient.enabled":true},"approvalPolicy":"on-request"});
        policy.thread(
            &mut thread,
            &json!({"mcp_servers":{"ambient":{"command":"unsafe","enabled":true,"tool_timeout_sec":null}}}),
        );
        assert_eq!(thread["sandbox"], "read-only");
        assert!(
            thread["config"]
                .get("mcp_servers.ambient.enabled")
                .is_none()
        );
        assert_eq!(
            thread["config"]["mcp_servers"]["ambient"],
            json!({"enabled":false})
        );
        assert_eq!(thread["config"]["web_search"], "disabled");
        let policy = AutomationSandbox::new(
            &BTreeSet::from([Permission::WriteRepositories]),
            &json!({"repo":"/work/repo"}),
            Path::new("/work/project"),
        );
        assert_eq!(policy.turn()["writableRoots"], json!(["/work/repo"]));
        assert_eq!(policy.turn()["networkAccess"], false);
        assert_eq!(policy.turn()["excludeSlashTmp"], true);
    }
}
