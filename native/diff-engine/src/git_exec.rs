use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

/// Keep Git selection at the process boundary. Avoid Apple's repeated tool
/// selection overhead without overriding a custom PATH Git.
pub fn command() -> Command {
    #[cfg(target_os = "macos")]
    {
        static SYSTEM_GIT: std::sync::OnceLock<Option<std::path::PathBuf>> =
            std::sync::OnceLock::new();
        if apple_git_on_path(std::env::var_os("PATH").as_deref()) {
            if let Some(path) = SYSTEM_GIT
                .get_or_init(resolve_apple_git)
                .as_ref()
                .filter(|path| path.is_file())
            {
                return Command::new(path);
            }
        }
    }
    Command::new("git")
}

#[cfg(target_os = "macos")]
fn apple_git_on_path(search_path: Option<&std::ffi::OsStr>) -> bool {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    let Some(search_path) = search_path else {
        return false;
    };
    for directory in std::env::split_paths(search_path) {
        // Relative PATH entries depend on each command's repository directory.
        if !directory.is_absolute() {
            return false;
        }
        let candidate = directory.join("git");
        let Ok(metadata) = candidate.metadata() else {
            continue;
        };
        if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
            continue;
        }
        return candidate == Path::new("/usr/bin/git");
    }
    false
}

#[cfg(target_os = "macos")]
fn resolve_apple_git() -> Option<std::path::PathBuf> {
    let mut child = Command::new("/usr/bin/xcrun")
        .args(["--find", "git"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    if !matches!(child.wait_timeout(remaining_git_time(Duration::from_secs(1))), Ok(Some(status)) if status.success())
    {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    }
    let output = child.wait_with_output().ok()?;
    let path = std::path::PathBuf::from(String::from_utf8(output.stdout).ok()?.trim());
    (path.is_absolute() && path != std::path::Path::new("/usr/bin/git") && path.is_file())
        .then_some(path)
}

thread_local! {
    static GIT_DEADLINE: std::cell::Cell<Option<std::time::Instant>> = const { std::cell::Cell::new(None) };
}

pub fn with_git_deadline<T>(duration: Duration, work: impl FnOnce() -> T) -> T {
    with_git_deadline_until(Some(std::time::Instant::now() + duration), work)
}

pub(crate) fn current_git_deadline() -> Option<std::time::Instant> {
    GIT_DEADLINE.with(std::cell::Cell::get)
}

pub(crate) fn with_git_deadline_until<T>(
    deadline: Option<std::time::Instant>,
    work: impl FnOnce() -> T,
) -> T {
    struct Restore(Option<std::time::Instant>);
    impl Drop for Restore {
        fn drop(&mut self) {
            GIT_DEADLINE.with(|deadline| deadline.set(self.0));
        }
    }
    let previous = GIT_DEADLINE.with(|cell| cell.replace(deadline));
    let _restore = Restore(previous);
    work()
}

pub(crate) fn remaining_git_time(timeout: Duration) -> Duration {
    GIT_DEADLINE.with(|deadline| {
        deadline
            .get()
            .map(|end| timeout.min(end.saturating_duration_since(std::time::Instant::now())))
            .unwrap_or(timeout)
    })
}

pub(crate) fn run_git(args: &[&str], cwd: &str) -> Option<String> {
    run_git_timed(args, cwd, Duration::from_secs(10))
}

pub(crate) fn git_failure(command: &str, kind: &str, detail: &str) -> String {
    if detail.is_empty() {
        format!("{command} {kind}")
    } else {
        format!("{command} {kind}: {detail}")
    }
}

fn sanitized_git_error(stderr: &[u8]) -> String {
    let first_line = String::from_utf8_lossy(stderr)
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect::<String>();
    let Some(scheme) = first_line.find("://") else {
        return first_line;
    };
    let credentials_start = scheme + 3;
    let Some(at_offset) = first_line[credentials_start..].find('@') else {
        return first_line;
    };
    let at = credentials_start + at_offset;
    let credential = &first_line[credentials_start..at];
    if credential.contains(':') || credential.len() > 20 {
        format!(
            "{}***{}",
            &first_line[..credentials_start],
            &first_line[at..]
        )
    } else {
        first_line
    }
}

pub(crate) fn run_git_timed(args: &[&str], cwd: &str, timeout: Duration) -> Option<String> {
    run_git_bytes(args, cwd, timeout)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

pub(crate) fn run_git_bytes(
    args: &[&str],
    cwd: &str,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    run_git_bytes_with_index(args, cwd, timeout, None)
}

pub(crate) fn run_git_bytes_with_index(
    args: &[&str],
    cwd: &str,
    timeout: Duration,
    index: Option<&std::path::Path>,
) -> Result<Vec<u8>, String> {
    let timeout = remaining_git_time(timeout);
    let label = format!("git {}", args.first().copied().unwrap_or("command"));
    let failure = |kind, detail: &str| git_failure(&label, kind, detail);
    if timeout.is_zero() {
        return Err(failure("timed out", "request deadline exceeded"));
    }
    let mut command_builder = command();
    if let Some(index) = index {
        command_builder.env("GIT_INDEX_FILE", index);
    }
    let mut child = command_builder
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| failure("could not start", &error.to_string()))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("could not start", "stdout was unavailable"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| failure("could not start", "stderr was unavailable"))?;
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
    let status = match child.wait_timeout(remaining_git_time(timeout)) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            drop(stdout_reader);
            drop(stderr_reader);
            return Err(failure(
                "timed out",
                &format!("after {} ms", timeout.as_millis()),
            ));
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            drop(stdout_reader);
            drop(stderr_reader);
            return Err(failure("failed", &error.to_string()));
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| failure("returned invalid output", "stdout reader failed"))?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(failure("failed", &sanitized_git_error(&stderr)));
    }
    Ok(stdout)
}

#[cfg(all(test, target_os = "macos"))]
mod selection_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn custom_and_relative_path_entries_keep_normal_git_selection() {
        let root = tempfile::tempdir().unwrap();
        let git = root.path().join("git");
        std::fs::write(&git, "#!/bin/sh\nexit 19\n").unwrap();
        std::fs::set_permissions(&git, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = std::env::join_paths([root.path(), std::path::Path::new("/usr/bin")]).unwrap();
        assert!(!apple_git_on_path(Some(&path)));
        assert!(!apple_git_on_path(Some(std::ffi::OsStr::new(".:/usr/bin"))));
        assert!(!apple_git_on_path(None));
    }
}
