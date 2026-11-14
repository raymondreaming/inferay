use super::*;
use std::{collections::VecDeque, sync::Mutex};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Key {
    pub cwd: String,
    pub commit: Option<String>,
    pub path: String,
    pub staged: bool,
}

#[derive(Default)]
pub(super) struct DiffCache {
    entries: VecDeque<(Key, Arc<PreparedDiff>, usize)>,
    bytes: usize,
}

impl DiffCache {
    pub fn get(&mut self, key: &Key) -> Option<Arc<PreparedDiff>> {
        let index = self.entries.iter().position(|entry| &entry.0 == key)?;
        let entry = self.entries.remove(index)?;
        let data = entry.1.clone();
        self.entries.push_back(entry);
        Some(data)
    }

    pub fn put(&mut self, key: Key, data: Arc<PreparedDiff>) {
        if let Some(index) = self.entries.iter().position(|entry| entry.0 == key) {
            self.bytes -= self.entries.remove(index).unwrap().2;
        }
        let bytes = data.bytes();
        const BUDGET: usize = 24 * 1024 * 1024;
        if bytes > BUDGET {
            return;
        }
        while self.entries.len() >= 8 || self.bytes + bytes > BUDGET {
            let Some((_, _, bytes)) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= bytes;
        }
        self.bytes += bytes;
        self.entries.push_back((key, data, bytes));
    }

    pub fn load(cache: &Mutex<Self>, key: &Key, theme: &str) -> Option<Arc<PreparedDiff>> {
        let retained = cache.lock().unwrap().get(key);
        if key.commit.is_some() && retained.is_some() {
            return retained;
        }
        let diff = if let Some(hash) = &key.commit {
            inferay_native_diff::get_git_commit_hunk_diff_for_parent(
                &key.cwd, hash, None, &key.path, false,
            )?
        } else {
            let allowed = AllowedPaths::new(&key.cwd, &key.cwd, &key.cwd).ok()?;
            inferay_native_diff::get_git_hunk_diff(&allowed, &key.cwd, &key.path, key.staged)
        };
        if let Some(data) = retained.filter(|data| *data.diff == diff) {
            return Some(data);
        }
        let data = Arc::new(PreparedDiff::plain(diff, &key.path, theme));
        cache.lock().unwrap().put(key.clone(), data.clone());
        Some(data)
    }

    pub fn publish_colors(&mut self, key: Key, data: Arc<PreparedDiff>) {
        if self
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(&current.diff, &data.diff))
        {
            self.put(key, data);
        }
    }
}

#[cfg(test)]
#[path = "diff_cache_tests.rs"]
mod tests;
