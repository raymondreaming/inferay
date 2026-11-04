//! Coordinate background fetches with explicit repository operations.
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
pub(super) struct RemoteState {
    last_fetch: Option<Instant>,
    failures: u32,
}

pub(super) fn state(cwd: &str) -> Arc<Mutex<RemoteState>> {
    static REPOSITORIES: LazyLock<Mutex<HashMap<String, Arc<Mutex<RemoteState>>>>> =
        LazyLock::new(Default::default);
    let common = super::run_git(
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd,
    )
    .map(|path| path.trim().to_owned())
    .unwrap_or_else(|| cwd.to_owned());
    REPOSITORIES
        .lock()
        .unwrap()
        .entry(common)
        .or_default()
        .clone()
}

impl RemoteState {
    pub(super) fn fetch(&mut self, cwd: &str) -> Result<(), String> {
        let result = super::git_exec::run_git_bytes(
            &["fetch", "--all", "--prune"],
            cwd,
            Duration::from_secs(60),
        )
        .map(|_| ());
        self.last_fetch = Some(Instant::now());
        self.failures = if result.is_ok() {
            0
        } else {
            self.failures.saturating_add(1)
        };
        result
    }
}

/// Fetch at most once a minute, without overlapping another operation or
/// repeatedly retrying an offline/authentication failure. Worktrees share state.
pub fn fetch_git_remotes_if_due(cwd: &str) -> Option<Result<(), String>> {
    let state = state(cwd);
    let mut state = state.try_lock().ok()?;
    let interval = Duration::from_secs(60 * (1u64 << state.failures.min(4)));
    if state
        .last_fetch
        .is_some_and(|last| last.elapsed() < interval)
    {
        return None;
    }
    Some(state.fetch(cwd))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_retries_after_one_minute_and_backs_off_on_failure() {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().to_str().unwrap();
        assert!(
            super::super::git_command()
                .args(["init", "-q", cwd])
                .status()
                .unwrap()
                .success()
        );
        assert!(fetch_git_remotes_if_due(cwd).unwrap().is_ok());
        let state = state(cwd);
        state.lock().unwrap().last_fetch = Some(Instant::now() - Duration::from_secs(61));
        assert!(fetch_git_remotes_if_due(cwd).unwrap().is_ok());
        assert!(
            super::super::git_command()
                .current_dir(cwd)
                .args([
                    "remote",
                    "add",
                    "origin",
                    "/nonexistent-inferay-test-remote"
                ])
                .status()
                .unwrap()
                .success()
        );
        state.lock().unwrap().last_fetch = Some(Instant::now() - Duration::from_secs(61));
        assert!(fetch_git_remotes_if_due(cwd).unwrap().is_err());
        state.lock().unwrap().last_fetch = Some(Instant::now() - Duration::from_secs(61));
        assert!(fetch_git_remotes_if_due(cwd).is_none());
        state.lock().unwrap().last_fetch = Some(Instant::now() - Duration::from_secs(121));
        assert!(fetch_git_remotes_if_due(cwd).unwrap().is_err());
    }
}
