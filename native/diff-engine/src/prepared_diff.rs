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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sequential_edits_and_unicode_spans_are_prepared_without_context() {
        let result = prepare_edit_diff(
            "",
            "",
            &[
                SequentialEdit {
                    old_string: "const café = 41;\nunchanged".into(),
                    new_string: "const café = 42;\nunchanged".into(),
                },
                SequentialEdit {
                    old_string: "42".into(),
                    new_string: "43".into(),
                },
            ],
        )
        .unwrap();
        assert_eq!(result.hunks.len(), 1);
        let lines = &result.hunks[0].lines;
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "const café = 41;");
        assert_eq!(lines[1].text, "const café = 43;");
        for line in lines {
            let segments = line.segments.as_ref().unwrap();
            assert_eq!(
                segments
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect::<String>(),
                line.text
            );
            assert_eq!(segments.iter().filter(|segment| segment.changed).count(), 1);
        }
        assert!(prepare_edit_diff("same", "same", &[])
            .unwrap()
            .hunks
            .is_empty());
    }
    #[test]
    fn separated_insertions_and_deletions_keep_each_side_coordinates() {
        let inserted = prepare_edit_diff("a\nb\nc", "a\nx\nb\ny\nc", &[]).unwrap();
        assert_eq!(
            inserted
                .hunks
                .iter()
                .map(|hunk| (hunk.old_start, hunk.new_start))
                .collect::<Vec<_>>(),
            [(1, 2), (2, 4)]
        );
        let removed = prepare_edit_diff("a\nx\nb\ny\nc", "a\nb\nc", &[]).unwrap();
        assert_eq!(
            removed
                .hunks
                .iter()
                .map(|hunk| (hunk.old_start, hunk.new_start))
                .collect::<Vec<_>>(),
            [(2, 1), (4, 2)]
        );
    }
    #[test]
    fn conflict_markers_become_prepared_rows() {
        let rows = prepare_conflict_lines(
            "before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch\nafter",
        );
        assert_eq!(rows[1].content, "Current change: HEAD");
        assert_eq!(rows[2].line_type, GitDiffLineType::Remove);
        assert_eq!(rows[4].line_type, GitDiffLineType::Add);
        assert_eq!(rows[5].content, "End conflict: branch");
        assert_eq!(rows[6].number, Some(4));
    }
    #[test]
    fn input_and_composed_edits_are_bounded() {
        assert!(prepare_edit_diff(&"x".repeat(2 * 1024 * 1024 + 1), "", &[]).is_err());
        assert!(prepare_edit_diff(
            "",
            "",
            &[SequentialEdit {
                old_string: "x".repeat(2 * 1024 * 1024 + 1),
                new_string: String::new()
            }]
        )
        .is_err());
        assert!(prepare_edit_diff(&"\n".repeat(12_000), "", &[]).is_err());
        let mut budget = 0;
        let (old, new) = inline_segments("old text", "new text", &mut budget);
        assert_eq!(old[0].text, "old text");
        assert_eq!(new[0].text, "new text");
        assert!(old[0].changed && new[0].changed);
    }
    #[test]
    fn inline_repository_context_and_replacement_order_are_native() {
        let old: Vec<GitDiffLine> = (0..12)
            .map(|index| GitDiffLine {
                number: Some(index + 1),
                content: if index == 6 {
                    "old".into()
                } else {
                    format!("line {index}")
                },
                line_type: if index == 6 {
                    GitDiffLineType::Remove
                } else {
                    GitDiffLineType::Context
                },
            })
            .collect();
        let mut new = old.clone();
        new[6].content = "new".into();
        new[6].line_type = GitDiffLineType::Add;
        let rows = crate::prepare_inline_lines(&old, &new);
        assert!(rows
            .iter()
            .any(|row| row.line_type == GitDiffLineType::Hunk));
        let changes: Vec<&str> = rows
            .iter()
            .filter(|row| {
                matches!(
                    row.line_type,
                    GitDiffLineType::Add | GitDiffLineType::Remove
                )
            })
            .map(|row| row.content.as_str())
            .collect();
        assert_eq!(changes, ["old", "new"]);
    }
    #[test]
    fn large_unrelated_inputs_remain_lossless() {
        let before = (0..5000)
            .map(|i| format!("old{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let after = (0..5000)
            .map(|i| format!("new{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let result = prepare_edit_diff(&before, &after, &[]).unwrap();
        assert_eq!(result.hunks[0].old_count, 5000);
        assert_eq!(result.hunks[0].new_count, 5000);
    }
}
