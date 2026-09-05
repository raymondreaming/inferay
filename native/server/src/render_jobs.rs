//! Bounded native rendering work and byte-budgeted, coalesced response reuse.
use axum::body::Bytes;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 128;
struct Entry {
    key: String,
    body: Bytes,
    at: Instant,
}
#[derive(Default)]
struct Cache {
    entries: VecDeque<Entry>,
    bytes: usize,
}
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
static KEYS: OnceLock<Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>> = OnceLock::new();
static JOBS: OnceLock<Arc<Semaphore>> = OnceLock::new();
static QUEUE: OnceLock<Arc<Semaphore>> = OnceLock::new();
fn lookup(key: &str, ttl: Duration) -> Option<Bytes> {
    let mut cache = CACHE.get_or_init(Default::default).lock().ok()?;
    let index = cache.entries.iter().position(|entry| entry.key == key)?;
    let entry = cache.entries.remove(index)?;
    if entry.at.elapsed() > ttl {
        cache.bytes -= entry.body.len() + entry.key.len();
        return None;
    }
    let body = entry.body.clone();
    cache.entries.push_back(entry);
    Some(body)
}
fn store(key: String, body: Bytes) {
    let size = key.len() + body.len();
    if size > MAX_BYTES {
        return;
    }
    let mut cache = CACHE
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(index) = cache.entries.iter().position(|entry| entry.key == key)
        && let Some(old) = cache.entries.remove(index)
    {
        cache.bytes -= old.key.len() + old.body.len();
    }
    cache.bytes += size;
    cache.entries.push_back(Entry {
        key,
        body,
        at: Instant::now(),
    });
    while cache.bytes > MAX_BYTES || cache.entries.len() > MAX_ENTRIES {
        if let Some(old) = cache.entries.pop_front() {
            cache.bytes -= old.key.len() + old.body.len();
        }
    }
}
pub async fn run<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let queued = QUEUE
        .get_or_init(|| Arc::new(Semaphore::new(32)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Rendering queue is full".to_string())?;
    let permit = JOBS
        .get_or_init(|| Arc::new(Semaphore::new(4)))
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        // The running job owns its permit, including after an HTTP timeout.
        let _permit = permit;
        let _queued = queued;
        inferay_native_diff::with_git_deadline(Duration::from_secs(9), job)
    })
    .await
    .map_err(|e| e.to_string())
}
pub async fn cached(
    key: String,
    ttl: Duration,
    job: impl FnOnce() -> Option<Vec<u8>> + Send + 'static,
) -> Result<(Option<Bytes>, bool), String> {
    if ttl.is_zero() {
        return run(move || (job().map(Bytes::from), false)).await;
    }
    if let Some(body) = lookup(&key, ttl) {
        return Ok((Some(body), true));
    }
    let lock = {
        let mut locks = KEYS
            .get_or_init(Default::default)
            .lock()
            .map_err(|e| e.to_string())?;
        locks.retain(|_, value| value.strong_count() > 0);
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(tokio::sync::Mutex::new(()));
            locks.insert(key.clone(), Arc::downgrade(&lock));
            lock
        }
    };
    let guard = lock.lock_owned().await;
    if let Some(body) = lookup(&key, ttl) {
        return Ok((Some(body), true));
    }
    run(move || {
        let _guard = guard;
        let body = job().map(Bytes::from);
        if let Some(bytes) = &body {
            store(key, bytes.clone());
        }
        (body, false)
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MinimapSegment {
    r#type: &'static str,
    side: &'static str,
    start_line: usize,
    end_line: usize,
}

fn minimap_segments(
    lines: &[inferay_native_diff::GitDiffLine],
    side: &'static str,
    row_count: usize,
) -> Vec<MinimapSegment> {
    use inferay_native_diff::GitDiffLineType;
    if row_count == 0 || row_count >= 3000 {
        return Vec::new();
    }
    let mut segments = Vec::new();
    let mut current = None;
    let mut start = 0;
    for index in 0..=lines.len() {
        let next = lines.get(index).and_then(|line| match line.line_type {
            GitDiffLineType::Add => Some("add"),
            GitDiffLineType::Remove => Some("remove"),
            _ => None,
        });
        if next == current {
            continue;
        }
        if let Some(kind) = current {
            segments.push(MinimapSegment {
                r#type: kind,
                side,
                start_line: start,
                end_line: index,
            });
            if segments.len() == 100 {
                break;
            }
        }
        current = next;
        start = index;
    }
    segments
}

fn max_line_chars(lines: &[inferay_native_diff::GitDiffLine]) -> usize {
    lines
        .iter()
        .map(|line| line.content.encode_utf16().count())
        .max()
        .unwrap_or(0)
}

// Half-open row ranges, in the coordinate system of the displayed view.
fn change_ranges(changed: impl Iterator<Item = bool>) -> Vec<[usize; 2]> {
    let mut ranges: Vec<[usize; 2]> = Vec::new();
    for (index, changed) in changed.enumerate() {
        if changed {
            if let Some(last) = ranges.last_mut().filter(|last| last[1] == index) {
                last[1] = index + 1;
            } else {
                ranges.push([index, index + 1]);
            }
        }
    }
    ranges
}

/// The UI gets prepared summary data without duplicating the raw patch text.
/// Callers that need a patch keep the original endpoint contract.
pub fn diff_bytes(mut diff: inferay_native_diff::GitHunkDiff, render: bool) -> Vec<u8> {
    if !render {
        return serde_json::to_vec(&diff).expect("diff serialization");
    }
    use inferay_native_diff::GitDiffLineType;
    #[derive(serde::Serialize)]
    struct Stats {
        added: usize,
        removed: usize,
        hunks: usize,
        lines: usize,
    }
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Metadata {
        stats: Stats,
        tokenization_disabled: bool,
        max_old_line_chars: usize,
        max_new_line_chars: usize,
        max_inline_line_chars: usize,
        max_conflict_line_chars: usize,
        split_change_ranges: Vec<[usize; 2]>,
        inline_change_ranges: Vec<[usize; 2]>,
        split_minimap: Vec<MinimapSegment>,
        inline_minimap: Vec<MinimapSegment>,
        conflict_minimap: Vec<MinimapSegment>,
    }
    #[derive(serde::Serialize)]
    struct Payload {
        #[serde(flatten)]
        diff: inferay_native_diff::GitHunkDiff,
        metadata: Metadata,
        #[serde(rename = "inlineLines")]
        inline_lines: Vec<inferay_native_diff::GitDiffLine>,
        #[serde(rename = "conflictLines", skip_serializing_if = "Option::is_none")]
        conflict_lines: Option<Vec<inferay_native_diff::GitDiffLine>>,
    }
    let old_max = max_line_chars(&diff.old_lines);
    let new_max = max_line_chars(&diff.new_lines);
    let mut stats = Stats {
        added: 0,
        removed: 0,
        hunks: 0,
        lines: diff.old_lines.len().max(diff.new_lines.len()),
    };
    let mut changed_before = false;
    let mut disabled = old_max.max(new_max) > 1000
        || diff
            .raw_patch
            .as_ref()
            .is_some_and(|patch| patch.lines().any(|line| line.encode_utf16().count() > 1000));
    if let Some(lines) = &diff.compact_lines {
        stats.lines = lines.len();
        for line in lines {
            let added = line.line_type == GitDiffLineType::Add;
            let removed = line.line_type == GitDiffLineType::Remove;
            stats.added += usize::from(added);
            stats.removed += usize::from(removed);
            let changed = added || removed;
            stats.hunks += usize::from(changed && !changed_before);
            changed_before = changed;
            disabled |= line.content.encode_utf16().count() > 1000;
        }
    } else {
        for index in 0..stats.lines {
            let added = diff
                .new_lines
                .get(index)
                .is_some_and(|line| line.line_type == GitDiffLineType::Add);
            let removed = diff
                .old_lines
                .get(index)
                .is_some_and(|line| line.line_type == GitDiffLineType::Remove);
            stats.added += usize::from(added);
            stats.removed += usize::from(removed);
            let changed = added || removed;
            stats.hunks += usize::from(changed && !changed_before);
            changed_before = changed;
        }
    }
    let inline_lines = diff.compact_lines.clone().unwrap_or_else(|| {
        inferay_native_diff::prepare_inline_lines(&diff.old_lines, &diff.new_lines)
    });
    let conflict_lines = diff
        .merge_conflict_content
        .as_deref()
        .map(inferay_native_diff::prepare_conflict_lines);
    let max_inline_line_chars = max_line_chars(&inline_lines);
    let max_conflict_line_chars = conflict_lines.as_deref().map(max_line_chars).unwrap_or(0);
    let split_change_ranges = change_ranges(
        (0..diff.old_lines.len().max(diff.new_lines.len())).map(|index| {
            diff.old_lines
                .get(index)
                .is_some_and(|line| line.line_type == GitDiffLineType::Remove)
                || diff
                    .new_lines
                    .get(index)
                    .is_some_and(|line| line.line_type == GitDiffLineType::Add)
        }),
    );
    let inline_change_ranges = change_ranges(inline_lines.iter().map(|line| {
        matches!(
            line.line_type,
            GitDiffLineType::Add | GitDiffLineType::Remove
        )
    }));
    let split_rows = diff.old_lines.len().max(diff.new_lines.len());
    let mut split_minimap = if diff.is_new {
        Vec::new()
    } else {
        minimap_segments(&diff.old_lines, "left", split_rows)
    };
    split_minimap.extend(minimap_segments(&diff.new_lines, "right", split_rows));
    let inline_minimap = minimap_segments(&inline_lines, "full", inline_lines.len());
    let conflict_minimap = conflict_lines
        .as_ref()
        .map(|lines| minimap_segments(lines, "full", lines.len()))
        .unwrap_or_default();
    disabled |= max_inline_line_chars.max(max_conflict_line_chars) > 1000;
    diff.raw_patch = None;
    serde_json::to_vec(&Payload {
        diff,
        inline_lines,
        conflict_lines,
        metadata: Metadata {
            stats,
            tokenization_disabled: disabled,
            max_old_line_chars: old_max,
            max_new_line_chars: new_max,
            max_inline_line_chars,
            max_conflict_line_chars,
            split_change_ranges,
            inline_change_ranges,
            split_minimap,
            inline_minimap,
            conflict_minimap,
        },
    })
    .expect("render diff serialization")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn minimap_runs_are_bounded_and_exclusive() {
        let lines: Vec<inferay_native_diff::GitDiffLine> = (0..2999).map(|index| serde_json::from_value(serde_json::json!({"number":index+1,"content":"x","type":if index % 2 == 0 {"add"} else {"context"}})).unwrap()).collect();
        let segments = minimap_segments(&lines, "right", lines.len());
        assert_eq!(segments.len(), 100);
        assert_eq!(segments[0].start_line, 0);
        assert_eq!(segments[0].end_line, 1);
        assert_eq!(segments[99].start_line, 198);
        assert_eq!(segments[99].end_line, 199);
        assert!(minimap_segments(&lines, "left", 3000).is_empty());
        assert!(serde_json::to_vec(&segments).unwrap().len() < 8000);
    }

    #[test]
    fn native_render_contract_prepares_inline_rows_and_summary() {
        let diff: inferay_native_diff::GitHunkDiff = serde_json::from_value(serde_json::json!({
            "oldLines": [{"number": 1, "content": "old", "type": "remove"}],
            "newLines": [{"number": 1, "content": "new", "type": "add"}],
            "isBinary": false, "isNew": false,
            "rawPatch": format!("+{}", "x".repeat(1001))
        }))
        .unwrap();
        let rendered: serde_json::Value =
            serde_json::from_slice(&super::diff_bytes(diff.clone(), true)).unwrap();
        assert_eq!(
            rendered["metadata"]["stats"],
            serde_json::json!({"added": 1, "removed": 1, "hunks": 1, "lines": 1})
        );
        assert_eq!(rendered["metadata"]["tokenizationDisabled"], true);
        assert_eq!(
            rendered["metadata"]["splitMinimap"],
            serde_json::json!([
                {"type":"remove","side":"left","startLine":0,"endLine":1},
                {"type":"add","side":"right","startLine":0,"endLine":1}
            ])
        );
        assert_eq!(
            rendered["metadata"]["inlineMinimap"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(rendered["inlineLines"][0]["type"], "remove");
        assert_eq!(rendered["inlineLines"][1]["type"], "add");
        assert!(rendered.get("rawPatch").is_none());
        let legacy: serde_json::Value =
            serde_json::from_slice(&super::diff_bytes(diff, false)).unwrap();
        assert!(legacy.get("rawPatch").is_some());
        assert!(legacy.get("inlineLines").is_none());
    }

    #[test]
    fn render_dimensions_and_navigation_use_each_views_rows() {
        let diff = serde_json::from_value(serde_json::json!({
            "oldLines": [
                {"number": 1, "content": "😀", "type": "remove"},
                {"number": 2, "content": "context", "type": "context"},
                {"number": 3, "content": "gone", "type": "remove"}
            ],
            "newLines": [
                {"number": 1, "content": "added", "type": "add"},
                {"number": 2, "content": "context", "type": "context"},
                {"number": null, "content": "", "type": "spacer"}
            ],
            "isBinary": false, "isNew": false,
            "mergeConflictContent": "😀😀😀😀😀"
        }))
        .unwrap();
        let rendered: serde_json::Value = serde_json::from_slice(&diff_bytes(diff, true)).unwrap();
        let metadata = &rendered["metadata"];
        assert_eq!(
            metadata["splitChangeRanges"],
            serde_json::json!([[0, 1], [2, 3]])
        );
        assert_eq!(
            metadata["inlineChangeRanges"],
            serde_json::json!([[0, 2], [3, 4]])
        );
        assert_eq!(metadata["maxOldLineChars"], 7);
        assert_eq!(metadata["maxInlineLineChars"], 7);
        assert_eq!(metadata["maxConflictLineChars"], 10);
        assert!(change_ranges([false, false].into_iter()).is_empty());
    }

    #[tokio::test]
    async fn coalesces_identical_jobs_and_expires_results() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let key = format!("test-{}", uuid::Uuid::new_v4());
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let (key, calls) = (key.clone(), calls.clone());
            tasks.push(tokio::spawn(cached(
                key,
                Duration::from_secs(60),
                move || {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(10));
                    Some(b"ok".to_vec())
                },
            )));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap().unwrap().0.unwrap().as_ref(), b"ok");
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        let refreshed = cached(key, Duration::ZERO, || Some(b"new".to_vec()))
            .await
            .unwrap();
        assert_eq!(refreshed.0.unwrap().as_ref(), b"new");
        assert!(!refreshed.1);
    }
}
