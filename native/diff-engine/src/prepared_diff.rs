//! Native read models consumed directly by diff cards and repository viewers.
use super::{diff_operations, DiffOperation, GitDiffLine, GitDiffLineType};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SequentialEdit {
    pub old_string: String,
    pub new_string: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct LineTextSegment {
    text: String,
    changed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedEditLine {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    old_line_num: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    new_line_num: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    segments: Option<Vec<LineTextSegment>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedEditHunk {
    lines: Vec<PreparedEditLine>,
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
}

#[derive(Debug, Serialize)]
pub struct PreparedEditDiff {
    hunks: Vec<PreparedEditHunk>,
}

fn inline_tokens(text: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut previous = 0;
    for (offset, ch) in text.char_indices() {
        let class = if ch.is_whitespace() {
            1
        } else if ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' {
            2
        } else {
            3
        };
        if offset > start && (class != previous || class == 3) {
            tokens.push(&text[start..offset]);
            start = offset;
        }
        previous = class;
    }
    if !text.is_empty() {
        tokens.push(&text[start..]);
    }
    tokens
}

fn inline_segments(
    old: &str,
    new: &str,
    budget: &mut usize,
) -> (Vec<LineTextSegment>, Vec<LineTextSegment>) {
    let old_tokens = inline_tokens(old);
    let new_tokens = inline_tokens(new);
    let cells = (old_tokens.len() + 1).saturating_mul(new_tokens.len() + 1);
    if cells > *budget {
        return (
            vec![LineTextSegment {
                text: old.to_owned(),
                changed: old != new,
            }],
            vec![LineTextSegment {
                text: new.to_owned(),
                changed: old != new,
            }],
        );
    }
    *budget -= cells.min(1_000_000);

    let mut old_changed = vec![true; old_tokens.len()];
    let mut new_changed = vec![true; new_tokens.len()];
    for (op, old_index, new_index) in diff_operations(&old_tokens, &new_tokens) {
        if matches!(op, DiffOperation::Unchanged) {
            old_changed[old_index.unwrap()] = false;
            new_changed[new_index.unwrap()] = false;
        }
    }
    let merge = |tokens: Vec<&str>, changed: Vec<bool>| {
        let mut result: Vec<LineTextSegment> = Vec::new();
        for (text, changed) in tokens.into_iter().zip(changed) {
            if let Some(last) = result.last_mut().filter(|last| last.changed == changed) {
                last.text.push_str(text);
            } else {
                result.push(LineTextSegment {
                    text: text.to_owned(),
                    changed,
                });
            }
        }
        if result.is_empty() {
            result.push(LineTextSegment {
                text: String::new(),
                changed: false,
            });
        }
        result
    };
    (
        merge(old_tokens, old_changed),
        merge(new_tokens, new_changed),
    )
}

/// Completed edit cards contain changed rows only. Sequential edits preserve the
/// prior client semantics, including replacement when an edit's old text is absent.
pub fn prepare_edit_diff(
    before: &str,
    after: &str,
    edits: &[SequentialEdit],
) -> Result<PreparedEditDiff, String> {
    let bytes = edits
        .iter()
        .fold(before.len().saturating_add(after.len()), |total, edit| {
            total
                .saturating_add(edit.old_string.len())
                .saturating_add(edit.new_string.len())
        });
    if bytes > 2 * 1024 * 1024 || edits.len() > 1024 {
        return Err("Edit input exceeds the supported size".into());
    }
    let (original, final_text);
    let (before, after) = if let Some(first) = edits.first() {
        original = first.old_string.clone();
        let mut current = original.clone();
        let mut composition_bytes = 0usize;
        for edit in edits {
            composition_bytes = composition_bytes.saturating_add(current.len());
            if composition_bytes > 16 * 1024 * 1024 {
                return Err("Sequential edit work exceeds the supported size".into());
            }
            let next_len = current.len().saturating_add(edit.new_string.len());
            if next_len > 2 * 1024 * 1024 {
                return Err("Composed edit exceeds 2 MiB".into());
            }
            current = if let Some(index) = current.find(&edit.old_string) {
                let mut next = String::with_capacity(
                    current.len() - edit.old_string.len() + edit.new_string.len(),
                );
                next.push_str(&current[..index]);
                next.push_str(&edit.new_string);
                next.push_str(&current[index + edit.old_string.len()..]);
                next
            } else {
                edit.new_string.clone()
            };
        }
        final_text = current;
        (original.as_str(), final_text.as_str())
    } else {
        (before, after)
    };
    if before.len().saturating_add(after.len()) > 2 * 1024 * 1024
        || before.split('\n').take(12_001).count() > 12_000
        || after.split('\n').take(12_001).count() > 12_000
    {
        return Err("Edit diff exceeds the supported size".into());
    }
    let old: Vec<&str> = before.split('\n').collect();
    let new: Vec<&str> = after.split('\n').collect();
    let mut hunks = Vec::new();
    let mut removed = Vec::new();
    let mut added = Vec::new();
    let mut inline_budget = 4_000_000usize;
    let mut flush = |removed: &mut Vec<PreparedEditLine>,
                     added: &mut Vec<PreparedEditLine>,
                     hunks: &mut Vec<PreparedEditHunk>,
                     old_cursor: usize,
                     new_cursor: usize| {
        if removed.is_empty() && added.is_empty() {
            return;
        }
        for (old, new) in removed.iter_mut().zip(added.iter_mut()) {
            let (old_segments, new_segments) =
                inline_segments(&old.text, &new.text, &mut inline_budget);
            old.segments = Some(old_segments);
            new.segments = Some(new_segments);
        }
        let old_start = removed
            .first()
            .and_then(|line| line.old_line_num)
            .unwrap_or(old_cursor.saturating_sub(1));
        let new_start = added
            .first()
            .and_then(|line| line.new_line_num)
            .unwrap_or(new_cursor.saturating_sub(1));
        let old_count = removed.len();
        let new_count = added.len();
        let mut lines = std::mem::take(removed);
        lines.append(added);
        hunks.push(PreparedEditHunk {
            lines,
            old_start,
            old_count,
            new_start,
            new_count,
        });
    };
    let (mut old_cursor, mut new_cursor) = (1, 1);
    for (op, i, j) in diff_operations(&old, &new) {
        match op {
            DiffOperation::Unchanged => {
                flush(&mut removed, &mut added, &mut hunks, old_cursor, new_cursor)
            }
            DiffOperation::Removed => removed.push(PreparedEditLine {
                kind: "removed",
                text: old[i.unwrap()].to_owned(),
                old_line_num: i.map(|i| i + 1),
                new_line_num: None,
                segments: None,
            }),
            DiffOperation::Added => added.push(PreparedEditLine {
                kind: "added",
                text: new[j.unwrap()].to_owned(),
                old_line_num: None,
                new_line_num: j.map(|j| j + 1),
                segments: None,
            }),
        }
        if let Some(i) = i {
            old_cursor = i + 2;
        }
        if let Some(j) = j {
            new_cursor = j + 2;
        }
    }
    flush(&mut removed, &mut added, &mut hunks, old_cursor, new_cursor);
    Ok(PreparedEditDiff { hunks })
}

/// Conflict markers are domain syntax; the browser only themes these rows.
pub fn prepare_conflict_lines(content: &str) -> Vec<GitDiffLine> {
    use GitDiffLineType::*;
    let mut section = Context;
    let mut number = 1;
    content
        .split('\n')
        .map(|raw| {
            let line = raw.strip_suffix('\r').unwrap_or(raw);
            let marker = if let Some(label) = line.strip_prefix("<<<<<<<") {
                section = Remove;
                Some(format!("Current change: {}", label.trim_start()))
            } else if line.starts_with("=======") {
                section = Add;
                Some("Incoming change".to_string())
            } else if let Some(label) = line.strip_prefix(">>>>>>>") {
                section = Context;
                Some(format!("End conflict: {}", label.trim_start()))
            } else {
                None
            };
            if let Some(content) = marker {
                GitDiffLine {
                    number: None,
                    content,
                    line_type: Hunk,
                }
            } else {
                let row = GitDiffLine {
                    number: Some(number),
                    content: line.to_owned(),
                    line_type: section,
                };
                number += 1;
                row
            }
        })
        .collect()
}
