//! Shared process execution for direct tools and granted agent tool calls.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::AsyncReadExt;

pub(crate) struct Invocation<'a> {
    pub id: &'a str,
    pub root: &'a Path,
    pub dir: &'a Path,
    pub call: Option<&'a str>,
    pub tool: LocalTool,
    pub input: Value,
    pub snapshot: &'a Value,
    pub entrypoint_hash: &'a str,
    pub active: Option<&'a AtomicBool>,
}

/// Own process cleanup even when the execution future is dropped mid-await.
struct ToolProcess<'a> {
    pid: Option<u32>,
    tracker: &'a RuntimePidTracker,
    exited: bool,
}
impl ToolProcess<'_> {
    fn stop(&mut self) {
        if let Some(pid) = self.pid.take() {
            if !self.exited {
                agent_runner::tree_kill(pid);
            }
            #[cfg(unix)]
            {
                // The tool starts a private process group. Kill helpers even
                // after its leader exits or when they ignore SIGTERM.
                let _ = std::process::Command::new("/bin/kill")
                    .args(["-KILL", "--", &format!("-{pid}")])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
            self.tracker.untrack_pid(pid);
        }
    }
}
impl Drop for ToolProcess<'_> {
    fn drop(&mut self) {
        self.stop();
    }
}

pub(crate) async fn execute(runtime: &ProjectRuntime, invocation: Invocation<'_>) -> Result<Value> {
    let Invocation {
        id,
        root,
        dir,
        call,
        tool,
        input,
        snapshot,
        entrypoint_hash,
        active,
    } = invocation;
    let subdir = call.map(|id| format!("tools/{id}")).unwrap_or_default();
    let inputs = dir.join("inputs").join(&subdir);
    let logs = dir.join("logs").join(&subdir);
    let output_dir = dir.join("output").join(&subdir);
    let scratch = dir.join("tmp").join(&subdir);
    for path in [&inputs, &logs, &output_dir, &scratch] {
        std::fs::create_dir_all(path)?;
        if !path.canonicalize()?.starts_with(root) {
            return Err("Tool directory escapes project".into());
        }
    }
    std::fs::write(inputs.join("input.json"), serde_json::to_vec(&input)?)?;
    let file = resolve_path(&root, &tool.entrypoint)?;
    let bytes = std::fs::read(&file)?;
    if entrypoint_hash != project_store::hash(&bytes) {
        return Err(
            "Tool changed after this run was queued. Retry to capture the new input.".into(),
        );
    }
    std::fs::write(inputs.join("entrypoint"), &bytes)?;
    let cwd = resolve_path(&root, &tool.working_directory)?;
    let definition: inferay_core::project_files::AutomationDefinition =
        serde_json::from_value(snapshot["automation"].clone())?;
    let policy = crate::automation_sandbox::AutomationSandbox::new(
        &definition.may,
        &snapshot["repositoryPaths"],
        root,
    );
    let arguments: Vec<_> = tool
        .arguments
        .iter()
        .map(|arg| arg.resolve(&output_dir.to_string_lossy()))
        .collect();
    let mut command = policy.tool_command(&tool.program, &arguments, &output_dir, &scratch)?;
    command
        .current_dir(cwd)
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some("PATH" | "HOME" | "LANG" | "LC_ALL" | "LC_CTYPE")
            )
        }))
        .env("TMPDIR", &scratch)
        .env("TMP", &scratch)
        .env("TEMP", &scratch)
        .env("INFERAY_PROJECT_DIR", &root)
        .env("INFERAY_RUN_OUTPUT", output_dir.clone())
        .env("INFERAY_RUN_ID", id)
        .stdin(if tool.interface == ToolInterface::JsonStdin {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;
    let pid = child.id();
    if let Some(pid) = pid {
        runtime.tracker.track_pid(pid);
    }
    let mut process = ToolProcess {
        pid,
        tracker: &runtime.tracker,
        exited: false,
    };
    let write = if tool.interface == ToolInterface::JsonStdin {
        let mut stdin = child.stdin.take().ok_or("No process stdin")?;
        let data = serde_json::to_vec(&input)?;
        Some(tokio::spawn(async move {
            stdin.write_all(&data).await?;
            stdin.shutdown().await
        }))
    } else {
        None
    };
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;
    let mut out = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stdout
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .await
            .map(|_| bytes)
    });
    let mut err = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .await
            .map(|_| bytes)
    });
    let deadline = tokio::time::Instant::now() + Duration::from_secs(tool.timeout_seconds);
    let mut failure = None;
    let status = loop {
        tokio::select! {
            result = child.wait() => match result {
                Ok(status) => { process.exited = true; break Some(status); },
                Err(_) => { failure = Some("Could not wait for tool process"); break None; }
            },
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                let cancelled = runtime.stopped(id) || active.is_some_and(|flag| !flag.load(Ordering::Acquire));
                if cancelled || tokio::time::Instant::now() >= deadline {
                    failure = Some(if cancelled { "Cancelled" } else { "Tool timed out" });
                    process.stop();
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    break None;
                }
            }
        }
    };
    if let Some(write) = write {
        write.abort();
    }
    drop(process);
    let output = tokio::time::timeout(Duration::from_secs(2), &mut out).await;
    let errors = tokio::time::timeout(Duration::from_secs(2), &mut err).await;
    if output.is_err() || errors.is_err() {
        out.abort();
        err.abort();
        return Err("Tool streams did not close".into());
    }
    let output = output???;
    let errors = errors???;
    std::fs::write(logs.join("stdout.txt"), &output)?;
    std::fs::write(logs.join("stderr.txt"), &errors)?;
    if let Some(error) = failure {
        return Err(error.into());
    }
    if output.len() > 1_048_576 || errors.len() > 1_048_576 {
        return Err("Tool output exceeded 1 MiB per stream".into());
    }
    if !status.is_some_and(|s| s.success()) {
        return Err(format!(
            "Tool failed ({}): {}",
            status
                .map(|status| status.to_string())
                .unwrap_or_else(|| "unknown status".into()),
            String::from_utf8_lossy(&errors)
                .chars()
                .take(2000)
                .collect::<String>()
        )
        .into());
    }
    let mut result: Value = match tool.interface {
        ToolInterface::JsonStdin => serde_json::from_slice(&output)
            .map_err(|e| format!("Tool must return JSON on stdout: {e}"))?,
        ToolInterface::Cli => json!({
            "stdout": String::from_utf8_lossy(&output),
            "stderr": String::from_utf8_lossy(&errors),
            "exitCode": 0,
        }),
    };
    if tool.interface == ToolInterface::Cli {
        let artifacts = collect_outputs(&output_dir)?;
        if !artifacts.is_empty() {
            result["artifacts"] = json!(artifacts);
        }
    }
    validate_json(&tool.output_schema, &result)?;
    Ok(result)
}

// CLI programs need no Inferay-specific stdout protocol to produce artifacts.
// Bound traversal before indexing; finalization owns size/hash validation.
fn collect_outputs(root: &Path) -> Result<Vec<String>> {
    let mut pending = vec![(root.to_path_buf(), 0)];
    let mut artifacts = Vec::new();
    let mut entries = 0;
    while let Some((directory, depth)) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            entries += 1;
            if entries > 1000 {
                return Err("Tool output exceeds 1000 filesystem entries".into());
            }
            let kind = entry.file_type()?;
            if kind.is_symlink() || (!kind.is_file() && !kind.is_dir()) {
                return Err("Tool output must contain only regular files and directories".into());
            }
            if kind.is_dir() {
                if depth >= 32 {
                    return Err("Tool output directories exceed depth 32".into());
                }
                pending.push((entry.path(), depth + 1));
            } else {
                if artifacts.len() >= 100 {
                    return Err("At most 100 artifacts per run".into());
                }
                let path = entry.path();
                artifacts.push(
                    path.strip_prefix(root)?
                        .to_str()
                        .ok_or("Tool output paths must be UTF-8")?
                        .replace('\\', "/"),
                );
            }
        }
    }
    artifacts.sort();
    Ok(artifacts)
}
