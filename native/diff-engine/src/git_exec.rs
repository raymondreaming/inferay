use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

thread_local! {
    static GIT_DEADLINE: std::cell::Cell<Option<std::time::Instant>> = const { std::cell::Cell::new(None) };
}

pub fn with_git_deadline<T>(duration: Duration, work: impl FnOnce() -> T) -> T {
    struct Restore(Option<std::time::Instant>);
    impl Drop for Restore {
        fn drop(&mut self) {
            GIT_DEADLINE.with(|deadline| deadline.set(self.0));
        }
    }
    let previous =
        GIT_DEADLINE.with(|deadline| deadline.replace(Some(std::time::Instant::now() + duration)));
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
    let command = format!("git {}", args.first().copied().unwrap_or("command"));
    let failure = |kind, detail: &str| git_failure(&command, kind, detail);
    if timeout.is_zero() {
        return Err(failure("timed out", "request deadline exceeded"));
    }
    let mut command_builder = Command::new("git");
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
    let status = match child.wait_timeout(timeout) {
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
