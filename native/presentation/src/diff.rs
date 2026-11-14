//! Pure diff presentation, request translation, and change navigation.
use serde_json::{Value, json};

#[derive(Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum DiffViewMode {
    Split,
    Hunks,
}

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum DiffScrollSource {
    Left,
    Right,
    All,
}

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct DiffScroll {
    pub source: DiffScrollSource,
    pub top: f64,
}

#[derive(Clone, Default, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct DiffNavigation {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scroll: Option<DiffScroll>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub highlight: Option<usize>,
}

#[derive(serde::Deserialize, ts_rs::TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DiffNavigationAction {
    ClearHighlight,
    ClearScroll,
    JumpToChange { change_idx: usize, top: f64 },
    JumpToPosition { source: DiffScrollSource, top: f64 },
}

pub fn navigation(input: &Value) -> Result<Value, String> {
    let state: DiffNavigation =
        serde_json::from_value(input["state"].clone()).map_err(|e| e.to_string())?;
    let action: DiffNavigationAction =
        serde_json::from_value(input["action"].clone()).map_err(|e| e.to_string())?;
    let mut next = state.clone();
    match action {
        DiffNavigationAction::ClearHighlight => next.highlight = None,
        DiffNavigationAction::ClearScroll => next.scroll = None,
        DiffNavigationAction::JumpToChange { change_idx, top } => {
            next.scroll = Some(DiffScroll {
                source: DiffScrollSource::All,
                top,
            });
            next.highlight = Some(change_idx);
        }
        DiffNavigationAction::JumpToPosition { source, top } => {
            next.scroll = Some(DiffScroll { source, top })
        }
    }
    Ok(if next == state {
        Value::Null
    } else {
        json!(next)
    })
}

pub fn next_change_index(ranges: &[[usize; 2]], line: f64, direction: i32) -> Option<usize> {
    if ranges.is_empty() {
        return None;
    }
    Some(if direction > 0 {
        ranges
            .iter()
            .position(|range| range[0] as f64 > line)
            .unwrap_or(0)
    } else {
        ranges
            .iter()
            .rposition(|range| (range[0] as f64) < line)
            .unwrap_or(ranges.len() - 1)
    })
}

fn grouped(n: usize) -> String {
    let text = n.to_string();
    text.chars()
        .enumerate()
        .fold(String::new(), |mut s, (i, c)| {
            if i > 0 && (text.len() - i).is_multiple_of(3) {
                s.push(',');
            }
            s.push(c);
            s
        })
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct DiffViewerModel {
    #[serde(rename = "fullWidth")]
    full_width: bool,
    extension: String,
    conflict: bool,
    message: Option<String>,
    markdown: Option<String>,
    navigable: bool,
}

/// Prepare presentation once, beside the native diff response.
pub fn viewer(
    diff: &inferay_core::repository::GitHunkDiff,
    file_path: &str,
    longest: usize,
) -> DiffViewerModel {
    use inferay_core::repository::GitDiffLineType;
    let extension = file_path
        .rsplit_once('.')
        .map_or("", |(_, extension)| extension);
    let compact = diff.compact_lines.as_deref();
    let status_line = match compact {
        Some([line]) => Some(line),
        _ if diff.old_lines.is_empty() && diff.new_lines.len() == 1 => diff.new_lines.first(),
        _ => None,
    };
    let status = status_line
        .filter(|line| {
            let content = line.content.to_lowercase();
            line.line_type == GitDiffLineType::Context
                && (content.contains("too large") || content.contains("cannot read"))
        })
        .map(|line| line.content.trim().to_owned());
    let total = compact.map_or_else(
        || diff.old_lines.len().max(diff.new_lines.len()),
        <[_]>::len,
    );
    let message = status.or_else(|| if total > 100_000 {
        Some(format!("Diff is too large to render safely ({} lines). Use the Editor/agent to inspect this file in smaller chunks.", grouped(total)))
    } else if longest > 8000 {
        Some(format!("Diff contains a very long line ({} characters). Rendering is limited to keep the app responsive.", grouped(longest)))
    } else { None });
    let markdown = (compact.is_none() && matches!(extension, "md" | "mdx")).then(|| {
        diff.new_lines
            .iter()
            .filter(|line| {
                !matches!(
                    line.line_type,
                    GitDiffLineType::Hunk | GitDiffLineType::Spacer
                )
            })
            .map(|line| line.content.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    });
    let conflict = diff
        .merge_conflict_content
        .as_ref()
        .is_some_and(|content| !content.is_empty())
        && markdown.is_none();
    DiffViewerModel {
        full_width: diff.is_new
            || diff
                .raw_patch
                .as_ref()
                .is_some_and(|patch| patch.lines().any(|line| line == "+++ /dev/null")),
        extension: extension.into(),
        conflict,
        navigable: !diff.is_binary && (conflict || (message.is_none() && markdown.is_none())),
        message,
        markdown,
    }
}

/// Warm adjacent keyboard targets in the caller's visible order.
pub fn diff_prefetch_files(i: &Value) -> Value {
    let count = i["count"].as_u64().unwrap_or(0) as usize;
    let current = i["current"]
        .as_u64()
        .map(|index| index as usize)
        .filter(|index| *index < count);
    let mut targets = if let Some(index) = current {
        [(index + 1) % count, (index + count - 1) % count]
            .into_iter()
            .filter(|next| *next != index)
            .collect::<Vec<_>>()
    } else {
        (0..count.min(2)).collect()
    };
    targets.dedup();
    json!(targets)
}

#[cfg(test)]
mod prefetch_tests {
    use super::*;
    #[test]
    fn neighbor_indices_wrap_without_prefetching_the_selected_file_twice() {
        for (count, current, expected) in [
            (3, 0, vec![1, 2]),
            (3, 2, vec![0, 1]),
            (2, 0, vec![1]),
            (1, 0, vec![]),
            (0, -1, vec![]),
            (1, -1, vec![0]),
            (3, -1, vec![0, 1]),
            (3, 3, vec![0, 1]),
        ] {
            assert_eq!(
                diff_prefetch_files(&json!({"count": count, "current": current})),
                json!(expected)
            );
        }
    }
}
