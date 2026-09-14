//! Native read models consumed directly by diff cards and repository viewers.
use super::{diff_operations, DiffOperation, GitDiffLine, GitDiffLineType};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, ts_rs::TS)]
pub struct SequentialEdit {
    pub old_string: String,
    pub new_string: String,
}

#[derive(Clone, Debug, Serialize, ts_rs::TS)]
pub struct LineTextSegment {
    text: String,
    changed: bool,
}

#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PreparedEditLine {
    #[serde(rename = "type")]
    line_type: GitDiffLineType,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    old_line_num: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    new_line_num: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    segments: Option<Vec<LineTextSegment>>,
}

#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PreparedEditDiff {
    lines: Vec<PreparedEditLine>,
    line_count: usize,
    content_width_chars: usize,
    virtualized: bool,
    has_changes: bool,
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
    let mut lines = Vec::new();
    let mut removed = Vec::new();
    let mut added = Vec::new();
    let mut inline_budget = 4_000_000usize;
    let mut flush = |removed: &mut Vec<PreparedEditLine>,
                     added: &mut Vec<PreparedEditLine>,
                     lines: &mut Vec<PreparedEditLine>| {
        if removed.is_empty() && added.is_empty() {
            return;
        }
        for (old, new) in removed.iter_mut().zip(added.iter_mut()) {
            let (old_segments, new_segments) =
                inline_segments(&old.text, &new.text, &mut inline_budget);
            old.segments = Some(old_segments);
            new.segments = Some(new_segments);
        }
        lines.append(removed);
        lines.append(added);
    };
    for (op, i, j) in diff_operations(&old, &new) {
        match op {
            DiffOperation::Unchanged => flush(&mut removed, &mut added, &mut lines),
            DiffOperation::Removed => removed.push(PreparedEditLine {
                line_type: GitDiffLineType::Remove,
                text: old[i.unwrap()].to_owned(),
                old_line_num: i.map(|i| i + 1),
                new_line_num: None,
                segments: None,
            }),
            DiffOperation::Added => added.push(PreparedEditLine {
                line_type: GitDiffLineType::Add,
                text: new[j.unwrap()].to_owned(),
                old_line_num: None,
                new_line_num: j.map(|j| j + 1),
                segments: None,
            }),
        }
    }
    flush(&mut removed, &mut added, &mut lines);
    let content_width_chars = lines
        .iter()
        .map(|line| {
            line.text
                .chars()
                .map(|ch| if ch == '\t' { 4 } else { ch.len_utf16() })
                .sum::<usize>()
        })
        .max()
        .unwrap_or(0)
        .saturating_add(10)
        .clamp(34, 8000);
    let line_count = lines.len();
    Ok(PreparedEditDiff {
        lines,
        line_count,
        content_width_chars,
        virtualized: line_count > 80,
        has_changes: line_count > 0,
    })
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

#[cfg(test)]
mod edit_card_tests {
    use super::*;

    #[test]
    fn changed_rows_preserve_order_numbers_and_inline_segments_across_hunks() {
        let prepared = serde_json::to_value(
            prepare_edit_diff(
                "old one\nunchanged\nold two",
                "new one\nunchanged\nnew two",
                &[],
            )
            .unwrap(),
        )
        .unwrap();
        let lines = prepared["lines"].as_array().expect("flat changed rows");
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0]["text"], "old one");
        assert_eq!(lines[0]["oldLineNum"], 1);
        assert_eq!(lines[1]["newLineNum"], 1);
        assert_eq!(lines[2]["oldLineNum"], 3);
        assert_eq!(lines[3]["text"], "new two");
        assert_eq!(lines[0]["segments"][0]["changed"], true);
        assert_eq!(lines[0]["segments"][1]["changed"], false);
        assert!(prepared.get("hunks").is_none());
        assert_eq!(prepared["contentWidthChars"], 34);
    }

    #[test]
    fn width_uses_browser_units_tab_expansion_and_a_rendering_cap() {
        for (text, width) in [("😀\t".repeat(5), 40), ("x".repeat(9000), 8000)] {
            let prepared =
                serde_json::to_value(prepare_edit_diff("", &text, &[]).unwrap()).unwrap();
            assert_eq!(prepared["contentWidthChars"], width);
        }
        let unchanged =
            serde_json::to_value(prepare_edit_diff("same", "same", &[]).unwrap()).unwrap();
        assert_eq!(unchanged["lines"], serde_json::json!([]));
    }
}
