use crate::{array, flag, number, string};
use serde_json::{Value, json};

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPreferences {
    #[ts(type = "'path' | 'tree'")]
    file_view_mode: String,
    diff_view_mode: crate::diff::DiffViewMode,
}

pub fn preferences(input: &Value) -> RepositoryPreferences {
    RepositoryPreferences {
        file_view_mode: if input["fileViewMode"] == "path" {
            "path"
        } else {
            "tree"
        }
        .into(),
        diff_view_mode: if input["diffViewMode"] == "split" {
            crate::diff::DiffViewMode::Split
        } else {
            crate::diff::DiffViewMode::Hunks
        },
    }
}

pub fn resize(input: &Value) -> Value {
    let available = number(&input["availableWidth"]).max(0.);
    let maximum = (available - 320.).max(360.).min(available);
    let width = input["width"]
        .as_f64()
        .or_else(|| string(&input["width"]).trim().parse::<f64>().ok())
        .filter(|width| width.is_finite() && *width > 0.)
        .unwrap_or(520.);
    json!(width.clamp(360.0_f64.min(maximum), maximum))
}

pub fn context(input: &Value) -> Value {
    let active_cwd = input["focusedCwd"]
        .as_str()
        .or_else(|| input["cwd"].as_str());
    let graph_cwd = (input["mainViewMode"] == "graph" && flag(&input["graphVisible"]))
        .then(|| input["diffViewerCwd"].as_str())
        .flatten();
    let mut tracked = Vec::new();
    for cwd in [
        input["cwd"].as_str(),
        input["fileViewerCwd"].as_str(),
        input["diffViewerCwd"].as_str(),
        input["focusedCwd"].as_str(),
    ]
    .into_iter()
    .flatten()
    .chain(
        array(&input["detachedCwds"])
            .iter()
            .filter_map(Value::as_str),
    )
    .filter(|cwd| !cwd.is_empty())
    {
        if !tracked.contains(&cwd) {
            tracked.push(cwd);
        }
    }
    json!({
        "activeCwd": active_cwd,
        "trackedCwds": tracked,
        "graphCwd": graph_cwd,
        "diffVisible": input["diffViewerCwd"].is_string()
            && if input["mainViewMode"] == "graph" {
                flag(&input["graphVisible"])
            } else {
                flag(&input["hasSelectedFile"])
            },
        "selectedFileVisible": input["focusedPanelId"] == "workspace-diff-viewer",
    })
}

pub fn interaction(input: &Value) -> Option<crate::panels::PanelAction> {
    use crate::panels::{FocusedPanel, MainView, PanelAction};
    match string(&input["type"]) {
        "mode" if input["mode"] == "graph" => Some(PanelAction::OpenGraph {
            cwd: input["activeCwd"].as_str()?.to_owned(),
            reset: None,
        }),
        "mode" => Some(PanelAction::Mode {
            mode: MainView::Diff,
        }),
        "focusWorkbench" => {
            let requested = input["cwd"].as_str();
            if requested.is_some_and(|cwd| input["repositoryCwd"] != cwd)
                || (!flag(&input["hasFocusedPanel"])
                    && (requested.is_none()
                        || input["mainViewMode"] != "graph"
                        || input["diffViewerCwd"] == input["cwd"]))
            {
                None
            } else {
                Some(PanelAction::FocusChat {
                    cwd: requested.map(str::to_owned),
                })
            }
        }
        "focusDiff" => input["diffViewerCwd"]
            .as_str()
            .map(|cwd| PanelAction::Focus {
                panel: Some(FocusedPanel {
                    id: "workspace-diff-viewer".into(),
                    cwd: cwd.into(),
                }),
            }),
        _ => None,
    }
}

pub fn keyboard_action(input: &Value) -> Value {
    let sidebar = flag(&input["sidebarFocused"]) && flag(&input["sidebarVisible"]);
    let diff = input["mainViewMode"] == "diff";
    let scope = if flag(&input["chatFocused"]) {
        "chat"
    } else if sidebar && !diff {
        "sidebar"
    } else if sidebar
        || flag(&input["repositoryTabFocused"])
        || flag(&input["graphFocused"])
        || (flag(&input["windowFocused"]) && flag(&input["graphVisible"]))
        || input["focusedPanelId"] == "workspace-diff-viewer"
    {
        if diff {
            "diff"
        } else if flag(&input["graphVisible"]) {
            "graph"
        } else if flag(&input["sidebarVisible"]) {
            "sidebar"
        } else {
            return Value::Null;
        }
    } else if flag(&input["graphVisible"]) && !diff {
        "graph"
    } else if flag(&input["windowFocused"]) {
        "chat"
    } else {
        return Value::Null;
    };
    match crate::shortcuts::action(input, scope) {
        Some("enterSidebar") if flag(&input["sidebarVisible"]) => json!({"type":"enterSidebar"}),
        Some(
            "previousCommit"
            | "nextCommit"
            | "previousBranchCommit"
            | "nextBranchCommit"
            | "firstCommit"
            | "lastCommit"
            | "openSelection"
            | "consume",
        ) => json!({"type":"navigateGraph"}),
        Some("closeGraph") => json!({"type":"closeGraph"}),
        Some("focusGraph") => json!({"type":"focusGraph"}),
        Some("close") if sidebar => json!({"type":"focusGraph"}),
        Some("openFile") if !flag(&input["graphVisible"]) && flag(&input["hasFile"]) => {
            json!({"type":"open"})
        }
        Some("openFile") => json!({"type":"enterSidebar"}),
        Some("close") if flag(&input["hasFile"]) => json!({"type":"close"}),
        Some(action @ ("nextChange" | "previousChange"))
            if diff && flag(&input["hasFile"]) && !flag(&input["button"]) =>
        {
            json!({"type":"stepDiffChange","direction":if action == "nextChange" { 1 } else { -1 }})
        }
        Some("previousFile") => json!({"type":"cycle","direction":-1}),
        Some("nextFile") => json!({"type":"cycle","direction":1}),
        Some("toggleFile")
            if ((scope == "diff" && !flag(&input["historical"]))
                || (scope == "sidebar" && flag(&input["workingTree"])))
                && flag(&input["hasFile"])
                && !flag(&input["button"]) =>
        {
            json!({"type":"toggle"})
        }
        _ => Value::Null,
    }
}

fn ordered(
    files: &[Value],
    indices: impl IntoIterator<Item = usize>,
    presentation: &Value,
    mode: &str,
) -> Vec<usize> {
    if presentation.is_null() {
        return indices.into_iter().collect();
    }
    let order = &presentation[if mode == "tree" {
        "treeOrder"
    } else {
        "pathOrder"
    }];
    let by_path: std::collections::HashMap<_, _> = indices
        .into_iter()
        .map(|index| (string(&files[index]["path"]), index))
        .collect();
    array(order)
        .iter()
        .filter_map(|path| by_path.get(string(path)).copied())
        .collect()
}
pub fn adjacent_file(input: &Value) -> Value {
    let count = input["count"].as_i64().unwrap_or(0);
    let current = input["current"].as_i64().unwrap_or(-1);
    let direction = input["direction"].as_i64().unwrap_or(1);
    if count <= 0 {
        return Value::Null;
    }
    let next = if current < 0 {
        if direction >= 0 { 0 } else { count - 1 }
    } else {
        current.saturating_add(direction).clamp(0, count - 1)
    };
    if flag(&input["repeatBoundary"]) || next != current {
        json!(next)
    } else {
        Value::Null
    }
}
pub fn selection_after_toggle(input: &Value) -> Value {
    let selected = &input["selected"];
    let section: Vec<_> = array(&input["files"])
        .iter()
        .filter(|file| file["staged"] == selected["staged"])
        .collect();
    let Some(index) = section
        .iter()
        .position(|file| file["path"] == selected["path"])
    else {
        return Value::Null;
    };
    if let Some(next) = section
        .get(index + 1)
        .or_else(|| index.checked_sub(1).and_then(|i| section.get(i)))
    {
        return (*next).clone();
    }
    let mut next = section[index].clone();
    next["staged"] = json!(!flag(&next["staged"]));
    next
}
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangesPanelProjection {
    unstaged_files: Vec<usize>,
    staged_files: Vec<usize>,
    navigable_files: Vec<usize>,
    showing_working_tree: bool,
    comparing: bool,
    #[ts(type = "'commit' | 'comparison' | null")]
    history_details: Option<&'static str>,
    history_loading: bool,
    history_message: String,
    navigable_historical_files: Vec<usize>,
    additions: f64,
    deletions: f64,
}

pub fn changes_panel(i: &Value) -> ChangesPanelProjection {
    let files = array(&i["files"]);
    let presentation = &i["filePresentation"];
    let mode = string(&i["fileViewMode"]);
    let unstaged = ordered(
        files,
        (0..files.len())
            .filter(|&n| !flag(&files[n]["staged"]) && files[n]["status"] != "?")
            .chain(
                (0..files.len())
                    .filter(|&n| !flag(&files[n]["staged"]) && files[n]["status"] == "?"),
            ),
        presentation,
        "path",
    );
    let staged = ordered(
        files,
        (0..files.len()).filter(|&n| flag(&files[n]["staged"])),
        presentation,
        "path",
    );
    let navigable = ordered(files, unstaged.iter().copied(), presentation, mode)
        .into_iter()
        .chain(ordered(files, staged.iter().copied(), presentation, mode))
        .collect();
    let showing = i["content"] == "workingTree";
    let comparing = number(&i["selectedCommitCount"]) > 1.;
    let has_commit = !string(&i["selectedCommitHash"]).is_empty();
    let details = if comparing {
        Some("comparison")
    } else if has_commit {
        Some("commit")
    } else {
        None
    };
    let loading = (comparing || has_commit) && flag(&i["historyLoading"]);
    let historical_files = array(&i["historyFiles"]);
    let displayed: Vec<_> = if showing {
        unstaged.iter().chain(&staged).map(|&n| &files[n]).collect()
    } else {
        historical_files.iter().collect()
    };
    let message = if loading {
        if comparing {
            "Comparing…"
        } else {
            "Loading…"
        }
    } else if comparing {
        "The selected items cannot be compared"
    } else if has_commit {
        if string(&i["commitDetailsError"]).is_empty() {
            "No details available for this commit"
        } else {
            string(&i["commitDetailsError"])
        }
    } else {
        "Select a commit to view details"
    };
    ChangesPanelProjection {
        additions: displayed.iter().map(|f| number(&f["additions"])).sum(),
        deletions: displayed.iter().map(|f| number(&f["deletions"])).sum(),
        unstaged_files: unstaged,
        staged_files: staged,
        navigable_files: navigable,
        showing_working_tree: showing,
        comparing,
        history_details: details,
        history_loading: loading,
        history_message: message.into(),
        navigable_historical_files: ordered(
            historical_files,
            0..historical_files.len(),
            &i["historyFilePresentation"],
            mode,
        ),
    }
}

#[cfg(test)]
mod ref_dialog_tests {
    use super::*;

    #[test]
    fn repository_panel_width_keeps_room_for_chat_and_fits_small_windows() {
        assert_eq!(resize(&json!({"availableWidth": 1200})), 520.);
        assert_eq!(
            resize(&json!({"availableWidth": 1200, "width": "700"})),
            700.
        );
        assert_eq!(
            resize(&json!({"availableWidth": 1200, "width": 5000})),
            880.
        );
        assert_eq!(resize(&json!({"availableWidth": 1200, "width": 1})), 360.);
        assert_eq!(resize(&json!({"availableWidth": 450, "width": 700})), 360.);
        assert_eq!(resize(&json!({"availableWidth": 280, "width": 700})), 280.);
        assert_eq!(resize(&json!({"availableWidth": 0})), 0.);
        assert_eq!(
            resize(&json!({"availableWidth": 1200, "width": "NaN"})),
            520.
        );
    }
}
