//! Pure diff presentation, request translation, and change navigation.
use crate::{array, flag, number, string};
use serde_json::{Value, json};

#[derive(Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum DiffViewMode {
    Split,
    Hunks,
}

#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    cwd: String,
    file: String,
    staged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    commit_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    commit_parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    comparison_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    comparison_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "'full' | 'review'")]
    view: Option<String>,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct EditDiffWindow {
    start: usize,
    end: usize,
    r#virtual: bool,
    padding_top: usize,
    padding_bottom: usize,
}

/// Scroll projections take row counts only; native diff contents stay in the renderer.
pub fn edit_window(input: &Value) -> EditDiffWindow {
    let count = number(&input["count"]) as usize;
    let virtualized = flag(&input["virtualized"]);
    let start = if virtualized {
        (number(&input["first"]) as usize)
            .min(count - 1)
            .saturating_sub(8)
    } else {
        0
    };
    let end = if virtualized {
        count.min(start.saturating_add(40))
    } else {
        count
    };
    EditDiffWindow {
        start,
        end,
        r#virtual: virtualized,
        padding_top: start.saturating_mul(15),
        padding_bottom: (count - end).saturating_mul(15),
    }
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

pub fn next_change(input: &Value) -> Value {
    let ranges = array(&input["ranges"]);
    if ranges.is_empty() {
        return Value::Null;
    }
    let line = number(&input["line"]);
    let index = if number(&input["direction"]) > 0. {
        ranges
            .iter()
            .position(|position| number(&position[0]) > line)
            .unwrap_or(0)
    } else {
        ranges
            .iter()
            .rposition(|position| number(&position[0]) < line)
            .unwrap_or(ranges.len() - 1)
    };
    json!(index)
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

pub fn diff_request(i: &Value) -> Value {
    if !flag(&i["active"]) || string(&i["cwd"]).is_empty() || i["selectedFile"].is_null() {
        return Value::Null;
    }
    let source = &i["fileSource"];
    let parameter = |kind: &str, key: &str| {
        (source["kind"] == kind)
            .then(|| source[key].as_str().map(str::to_owned))
            .flatten()
    };
    json!(DiffRequest {
        cwd: string(&i["cwd"]).into(),
        file: string(&i["selectedFile"]["path"]).into(),
        staged: flag(&i["selectedFile"]["staged"]),
        revision: i["revision"].as_str().map(str::to_owned),
        commit_hash: parameter("commit", "commitHash"),
        commit_parent: parameter("commit", "commitParent"),
        comparison_from: parameter("comparison", "comparisonFrom"),
        comparison_to: parameter("comparison", "comparisonTo"),
        view: Some(
            if i["viewMode"] == "split" {
                "full"
            } else {
                "review"
            }
            .into()
        ),
    })
}

/// Warm adjacent keyboard targets in the caller's visible order.
pub fn diff_prefetch_files(i: &Value) -> Value {
    let files = array(&i["files"]);
    let selected = &i["selected"];
    let current = files
        .iter()
        .position(|f| f["path"] == selected["path"] && f["staged"] == selected["staged"]);
    let mut targets = Vec::new();
    if let Some(index) = current {
        for next in [
            (index + 1) % files.len(),
            (index + files.len() - 1) % files.len(),
        ] {
            if next != index && !targets.contains(&files[next]) {
                targets.push(files[next].clone());
            }
        }
    } else {
        targets.extend(files.iter().take(2).cloned());
    }
    json!(targets)
}

#[cfg(test)]
mod prefetch_tests {
    use super::*;
    #[test]
    fn neighbors_preserve_stage_identity_wrap_and_remain_bounded() {
        let files = json!([{"path":"a","staged":false},{"path":"a","staged":true},{"path":"b","staged":true}]);
        assert_eq!(
            diff_prefetch_files(&json!({"files":files,"selected":files[0]})),
            json!([files[1], files[2]])
        );
        assert_eq!(
            diff_prefetch_files(&json!({"files":files,"selected":files[2]})),
            json!([files[0], files[1]])
        );
        assert_eq!(
            diff_prefetch_files(&json!({"files":[files[0]],"selected":files[0]})),
            json!([])
        );
        assert_eq!(diff_prefetch_files(&json!({"files":[]})), json!([]));
    }
}
