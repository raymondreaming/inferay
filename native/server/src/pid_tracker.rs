use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::Mutex;

use crate::agent_runner::PidTracker;

#[derive(Clone)]
pub struct RuntimePidTracker {
    path: PathBuf,
    active: Arc<std::sync::Mutex<HashSet<u32>>>,
    save_pending: Arc<AtomicBool>,
    save_lock: Arc<Mutex<()>>,
}

impl RuntimePidTracker {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            active: Arc::new(std::sync::Mutex::new(HashSet::new())),
            save_pending: Arc::new(AtomicBool::new(false)),
            save_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn cleanup_orphans(&self) {
        if let Ok(bytes) = tokio::fs::read(&self.path).await
            && let Ok(values) = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes)
        {
            for value in values {
                if let Some(pid) = value.as_u64().and_then(|pid| u32::try_from(pid).ok())
                    && pid > 0
                {
                    tree_kill(pid);
                }
            }
        }
        self.active
            .lock()
            .expect("PID tracker lock poisoned")
            .clear();
        self.write_pids().await;
    }

    #[cfg(test)]
    async fn flush(&self) {
        self.save_pending.store(false, Ordering::Release);
        self.write_pids().await;
    }

    fn schedule_save(&self) {
        if self.save_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let tracker = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            tracker.save_pending.store(false, Ordering::Release);
            tracker.write_pids().await;
        });
    }

    async fn write_pids(&self) {
        let _guard = self.save_lock.lock().await;
        let mut pids = self
            .active
            .lock()
            .expect("PID tracker lock poisoned")
            .iter()
            .copied()
            .collect::<Vec<_>>();
        pids.sort_unstable();
        let Ok(bytes) = serde_json::to_vec_pretty(&pids) else {
            return;
        };
        let _ = crate::atomic_write::overwrite(&self.path, &bytes).await;
    }
}

impl PidTracker for RuntimePidTracker {
    fn track_pid(&self, pid: u32) {
        if pid == 0 {
            return;
        }
        self.active
            .lock()
            .expect("PID tracker lock poisoned")
            .insert(pid);
        self.schedule_save();
    }

    fn untrack_pid(&self, pid: u32) {
        if pid == 0 {
            return;
        }
        self.active
            .lock()
            .expect("PID tracker lock poisoned")
            .remove(&pid);
        self.schedule_save();
    }

    fn kill_pid_tree(&self, pid: u32) {
        tree_kill(pid);
    }
}

#[cfg(windows)]
fn tree_kill(pid: u32) {
    if pid == 0 {
        return;
    }
    let _ = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(not(windows))]
fn tree_kill(pid: u32) {
    if pid == 0 {
        return;
    }
    if let Ok(output) = std::process::Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
    {
        for child in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(child) = child.trim().parse::<u32>() {
                tree_kill(child);
            }
        }
    }
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn persists_tracks_untracks_and_clears_the_runtime_pid_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("runtime-pids.json");
        let tracker = RuntimePidTracker::new(path.clone());
        tracker.track_pid(17);
        tracker.track_pid(12);
        tracker.flush().await;
        let stored: Vec<u32> =
            serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert_eq!(stored, [12, 17]);
        tracker.untrack_pid(12);
        tracker.flush().await;
        let stored: Vec<u32> =
            serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert_eq!(stored, [17]);
    }
}
