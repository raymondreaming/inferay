//! Bounded, disposable parser sessions. A missing/stale session requests a full
//! reset; correctness never depends on a session staying cached.
use crate::markdown::{IncrementalMarkdown, MarkdownPatch};
use serde::Deserialize;
use std::collections::VecDeque;
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicUsize, Ordering},
};
use std::time::{Duration, Instant};

#[derive(Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "MarkdownStreamRequest")]
pub(crate) struct Input {
    pub stream_id: String,
    #[ts(optional)]
    pub base_revision: Option<u64>,
    #[ts(optional)]
    pub text: Option<String>,
    #[ts(optional)]
    pub append: Option<String>,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub chat: bool,
}

pub(crate) enum Error {
    Resync,
    Invalid(&'static str),
}
struct Session {
    model: Mutex<IncrementalMarkdown>,
    weight: AtomicUsize,
}
struct Entry {
    id: String,
    session: Arc<Session>,
    used: Instant,
}
struct StreamCache {
    entries: Mutex<VecDeque<Entry>>,
    max_entries: usize,
    max_bytes: usize,
}
impl StreamCache {
    fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: Mutex::new(VecDeque::new()),
            max_entries,
            max_bytes,
        }
    }
    fn prune(&self, entries: &mut VecDeque<Entry>) {
        while entries.len() > self.max_entries
            || entries
                .iter()
                .map(|entry| entry.session.weight.load(Ordering::Relaxed) + entry.id.len())
                .sum::<usize>()
                > self.max_bytes
            || entries
                .front()
                .is_some_and(|entry| entry.used.elapsed() > Duration::from_secs(300))
        {
            if entries.pop_front().is_none() {
                break;
            }
        }
    }
    fn apply(&self, input: Input) -> Result<MarkdownPatch, Error> {
        if input.stream_id.is_empty()
            || input.stream_id.len() > 128
            || input.text.is_some() == input.append.is_some()
        {
            return Err(Error::Invalid(
                "Expected a stream ID and exactly one of text or append",
            ));
        }
        let reset = input.text.is_some();
        let session = {
            let mut entries = self
                .entries
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            self.prune(&mut entries);
            let existing = entries.iter().position(|entry| entry.id == input.stream_id);
            let session = if let Some(index) = existing {
                entries.remove(index).unwrap().session
            } else if reset {
                Arc::new(Session {
                    model: Mutex::new(IncrementalMarkdown::default()),
                    weight: AtomicUsize::new(0),
                })
            } else {
                return Err(Error::Resync);
            };
            entries.push_back(Entry {
                id: input.stream_id,
                session: session.clone(),
                used: Instant::now(),
            });
            self.prune(&mut entries);
            session
        };
        let result = {
            // Rendering jobs acquire the global bounded worker permit before
            // entering here. Separate chats never hold a shared parser lock.
            let mut model = session
                .model
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if !reset && (model.revision == 0 || input.base_revision != Some(model.revision)) {
                return Err(Error::Resync);
            }
            let result = model
                .update(
                    input.text.as_deref().or(input.append.as_deref()).unwrap(),
                    reset,
                    input.streaming,
                    input.chat,
                )
                .map_err(Error::Invalid);
            session.weight.store(model.weight(), Ordering::Relaxed);
            result
        };
        self.prune(
            &mut self
                .entries
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        );
        result
    }
}
pub(crate) fn apply(input: Input) -> Result<MarkdownPatch, Error> {
    static CACHE: OnceLock<StreamCache> = OnceLock::new();
    CACHE
        .get_or_init(|| StreamCache::new(64, 32 * 1024 * 1024))
        .apply(input)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(id: &str, revision: Option<u64>) -> Input {
        Input {
            stream_id: id.into(),
            base_revision: revision,
            text: revision.is_none().then(|| "hello".into()),
            append: revision.map(|_| " tail".into()),
            streaming: true,
            chat: true,
        }
    }
    #[test]
    fn stale_and_evicted_cursors_request_reset_without_corrupting_other_sessions() {
        let cache = StreamCache::new(1, 1024);
        assert!(cache.apply(input("a", None)).is_ok());
        assert!(matches!(
            cache.apply(input("a", Some(0))),
            Err(Error::Resync)
        ));
        assert_eq!(cache.apply(input("a", Some(1))).ok().unwrap().revision, 2);
        assert!(cache.apply(input("b", None)).is_ok());
        assert!(matches!(
            cache.apply(input("a", Some(2))),
            Err(Error::Resync)
        ));
        assert!(cache.apply(input("b", Some(1))).is_ok());
    }
}
