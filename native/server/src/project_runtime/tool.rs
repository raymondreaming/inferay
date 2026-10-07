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
    pub entrypoint_hash: &'a str,
    pub active: Option<&'a AtomicBool>,
}
pub(crate) async fn execute(runtime: &ProjectRuntime, invocation: Invocation<'_>) -> Result<Value> {
    let Invocation {
        id,
        root,
        dir,
        call,
        tool,
        input,
        entrypoint_hash,
        active,
    } = invocation;
    let subdir = call.map(|id| format!("tools/{id}")).unwrap_or_default();
    let inputs = dir.join("inputs").join(&subdir);
    let logs = dir.join("logs").join(&subdir);
    let output_dir = dir.join("output").join(&subdir);
    for path in [&inputs, &logs, &output_dir] {
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
    let mut command = tokio::process::Command::new(&tool.program);
    command
        .args(&tool.arguments)
        .current_dir(cwd)
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
                Ok(status) => break Some(status),
                Err(_) => { failure = Some("Could not wait for tool process"); break None; }
            },
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                let cancelled = runtime.stopped(id) || active.is_some_and(|flag| !flag.load(Ordering::Acquire));
                if cancelled || tokio::time::Instant::now() >= deadline {
                    failure = Some(if cancelled { "Cancelled" } else { "Tool timed out" });
                    if let Some(pid) = pid { agent_runner::tree_kill(pid); }
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
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("/bin/kill")
                .args(["-KILL", "--", &format!("-{pid}")])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        runtime.tracker.untrack_pid(pid);
    }
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
            "Tool failed (exit {}): {}",
            status
                .and_then(|status| status.code())
                .map(|code| code.to_string())
                .unwrap_or_else(|| "signal".into()),
            String::from_utf8_lossy(&errors)
                .chars()
                .take(2000)
                .collect::<String>()
        )
        .into());
    }
    let result: Value = match tool.interface {
        ToolInterface::JsonStdin => serde_json::from_slice(&output)
            .map_err(|e| format!("Tool must return JSON on stdout: {e}"))?,
        ToolInterface::Cli => json!({
            "stdout": String::from_utf8_lossy(&output),
            "stderr": String::from_utf8_lossy(&errors),
            "exitCode": 0,
        }),
    };
    validate_json(&tool.output_schema, &result)?;
    Ok(result)
}
