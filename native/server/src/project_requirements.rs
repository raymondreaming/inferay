//! Bounded machine preflight, executed inside the same OS boundary as local tools.
use crate::{automation_sandbox::AutomationSandbox, project_store::Result};
use inferay_core::project_requirements::Requirement;
use serde_json::Value;
use std::{collections::BTreeSet, path::Path, time::Duration};
use tokio::io::AsyncReadExt;

pub(crate) async fn check(snapshot: &Value, project: &Path, run: &Path) -> Result<()> {
    let requirements: Vec<String> = serde_json::from_value(snapshot["requirements"].clone())?;
    if requirements.is_empty() {
        return Ok(());
    }
    let scratch = run.join("tmp/requirements");
    std::fs::create_dir_all(&scratch)?;
    if !scratch.canonicalize()?.starts_with(project) {
        return Err("Requirements directory escapes project".into());
    }
    let policy = AutomationSandbox::new(&BTreeSet::new(), &serde_json::json!({}), project);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    for value in requirements {
        if tokio::time::Instant::now() >= deadline {
            return Err("Machine requirements exceeded the 30-second preflight limit".into());
        }
        let parsed = Requirement::parse(&value)?;
        if let Requirement::Program {
            name,
            minimum: None,
        } = &parsed
        {
            let found = std::env::var_os("PATH").is_some_and(|path| {
                std::env::split_paths(&path).any(|dir| {
                    let Ok(metadata) = std::fs::metadata(dir.join(name)) else {
                        return false;
                    };
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                    }
                    #[cfg(not(unix))]
                    {
                        metadata.is_file()
                    }
                })
            });
            if !found {
                return Err(format!("Requirement {value}: program is not on PATH").into());
            }
            continue;
        }
        let (program, args, minimum) = match parsed {
            Requirement::Program { name, minimum } => (name, vec!["--version".into()], minimum),
            Requirement::PythonModule { interpreter, module } => (interpreter, vec!["-I".into(), "-c".into(), "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) is not None else 1)".into(), module.into()], None),
        };
        let mut command = policy.tool_command(program, &args, &scratch, &scratch)?;
        command
            .current_dir(&scratch)
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
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Requirement {value} is unavailable: {e}"))?;
        let pid = child.id();
        let mut stdout = child
            .stdout
            .take()
            .ok_or("Missing requirement stdout")?
            .take(65537);
        let mut stderr = child
            .stderr
            .take()
            .ok_or("Missing requirement stderr")?
            .take(65537);
        let result = tokio::time::timeout(
            deadline
                .saturating_duration_since(tokio::time::Instant::now())
                .min(Duration::from_secs(5)),
            async {
                let mut out = Vec::new();
                let mut err = Vec::new();
                let (status, _, _) = tokio::try_join!(
                    child.wait(),
                    stdout.read_to_end(&mut out),
                    stderr.read_to_end(&mut err)
                )?;
                Ok::<_, std::io::Error>((status, out, err))
            },
        )
        .await;
        if let Some(pid) = pid {
            crate::agent_runner::tree_kill(pid);
        }
        let _ = child.kill().await;
        let _ = child.wait().await;
        let (status, out, err) =
            result.map_err(|_| format!("Requirement {value} check timed out"))??;
        if out.len() > 65536 || err.len() > 65536 {
            return Err(format!("Requirement {value} check produced too much output").into());
        }
        if !status.success() {
            return Err(format!(
                "Requirement {value} is unavailable (check exited {})",
                status
            )
            .into());
        }
        if let Some(minimum) = minimum {
            let text = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out),
                String::from_utf8_lossy(&err)
            );
            let version = regex::Regex::new(r"\b([0-9]+(?:\.[0-9]+){1,3})\b")?
                .captures(&text)
                .and_then(|c| {
                    c[1].split('.')
                        .map(str::parse::<u32>)
                        .collect::<std::result::Result<Vec<_>, _>>()
                        .ok()
                })
                .ok_or_else(|| format!("Requirement {value}: could not read program version"))?;
            if (0..version.len().max(minimum.len()))
                .map(|i| *version.get(i).unwrap_or(&0))
                .cmp((0..version.len().max(minimum.len())).map(|i| *minimum.get(i).unwrap_or(&0)))
                .is_lt()
            {
                return Err(format!(
                    "Requirement {value} is not met; found {}",
                    version
                        .iter()
                        .map(u32::to_string)
                        .collect::<Vec<_>>()
                        .join(".")
                )
                .into());
            }
        }
    }
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[tokio::test]
    async fn preflight_checks_presence_versions_and_modules() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().canonicalize().unwrap();
        for (requirements, expected) in [
            (
                serde_json::json!(["python3", "python3>=3.0", "python3:json"]),
                None,
            ),
            (
                serde_json::json!(["inferay_missing_program_90374"]),
                Some("not on PATH"),
            ),
            (
                serde_json::json!(["python3>=999.0"]),
                Some("not met; found"),
            ),
            (
                serde_json::json!(["python3:inferay_missing_module_90374"]),
                Some("unavailable"),
            ),
        ] {
            let result = check(
                &serde_json::json!({"requirements":requirements}),
                &project,
                &project.join("run"),
            )
            .await;
            if let Some(expected) = expected {
                assert!(result.unwrap_err().to_string().contains(expected));
            } else {
                result.unwrap();
            }
        }
    }
}
