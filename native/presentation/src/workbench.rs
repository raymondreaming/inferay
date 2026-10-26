use crate::{array, flag, number, string};
use inferay_core::agent_state::repository_path;
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

pub fn changes_layout(input: &Value) -> Value {
    let available = number(&input["availableHeight"]).max(0.);
    let minimum = 120_f64.min(available / 2.);
    let maximum = (available - 120.).max(minimum);
    let preferred = input["height"]
        .as_f64()
        .or_else(|| string(&input["height"]).trim().parse::<f64>().ok())
        .filter(|height| height.is_finite())
        .unwrap_or(available * 0.4);
    json!({"height": preferred.clamp(minimum, maximum), "minimum": minimum, "maximum": maximum})
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

pub fn file_selection(input: &Value) -> Option<crate::panels::PanelAction> {
    let required = |value: &Value| {
        value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    let path = required(&input["file"]["path"])?;
    Some(match string(&input["kind"]) {
        "workingTree" => crate::panels::PanelAction::WorkingTreeFile {
            cwd: required(&input["workingTreeCwd"])?,
            path,
            staged: flag(&input["file"]["staged"]),
        },
        "commit" => {
            let source = &input["commitSource"];
            let historical = !string(&source["commitHash"]).is_empty();
            crate::panels::PanelAction::CommitFile {
                cwd: required(
                    &input[if historical {
                        "diffViewerCwd"
                    } else {
                        "activeCwd"
                    }],
                )?,
                path,
                commit_hash: required(if !source["commitHash"].is_null() {
                    &source["commitHash"]
                } else if input["selectedGraphItem"]["itemKind"] != "worktreeWip" {
                    &input["selectedGraphItem"]["hash"]
                } else {
                    &Value::Null
                })?,
                commit_parent: (if historical {
                    &source["commitParent"]
                } else {
                    &input["selectedCommitParent"]
                })
                .as_str()
                .map(str::to_owned),
            }
        }
        "comparison" => {
            let source = &input["comparisonSource"];
            let plan = &input["comparisonPlan"];
            crate::panels::PanelAction::ComparisonFile {
                cwd: required(if !string(&source["comparisonFrom"]).is_empty() {
                    &input["diffViewerCwd"]
                } else {
                    &plan["cwd"]
                })?,
                path,
                from: required(if source["comparisonFrom"].is_null() {
                    &plan["from"]
                } else {
                    &source["comparisonFrom"]
                })?,
                to: required(if source["comparisonTo"].is_null() {
                    &plan["to"]
                } else {
                    &source["comparisonTo"]
                })?,
            }
        }
        _ => return None,
    })
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct GraphFileOpen {
    ready: bool,
    action: Option<crate::panels::PanelAction>,
}

pub fn graph_file_open(input: &Value) -> GraphFileOpen {
    let mut result = GraphFileOpen {
        ready: true,
        action: None,
    };
    if input["mainViewMode"] != "graph" || input["selectedCommitHash"] != input["request"] {
        return result;
    }
    let working_tree = input["selectedGraphItem"]["itemKind"] == "worktreeWip";
    if !working_tree && flag(&input["loading"]) {
        result.ready = false;
        return result;
    }
    let file = &input["file"];
    if working_tree && file.is_null() {
        result.ready = false;
        return result;
    }
    if !file.is_null() {
        let mut selection = input.clone();
        selection["kind"] = json!(if working_tree {
            "workingTree"
        } else if number(&input["selectedCommitCount"]) > 1. {
            "comparison"
        } else {
            "commit"
        });
        result.action = file_selection(&selection);
    }
    result
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

pub fn historical_query(i: &Value) -> Value {
    let source = &i["fileSource"];
    let commit = if source["kind"] == "commit" {
        source
    } else {
        &Value::Null
    };
    let comparison = if source["kind"] == "comparison" {
        source
    } else {
        &Value::Null
    };
    let diff = i["mainViewMode"] == "diff";
    let mut commit_query = json!({
        "cwd": if diff && !string(&commit["commitHash"]).is_empty() { &i["diffViewerCwd"] } else { &i["graphCwd"] },
        "hash": if diff { &commit["commitHash"] } else if number(&i["selectedCommitCount"]) <= 1. && i["selectedCommitKind"] != "worktreeWip" { &i["selectedCommitHash"] } else { &Value::Null },
        "parent": if diff { &commit["commitParent"] } else { &i["selectedCommitParent"] },
    });
    let mut comparison_query = json!({
        "cwd": if diff { &i["diffViewerCwd"] } else { &i["graphCwd"] },
        "from": if diff { &comparison["comparisonFrom"] } else { &Value::Null },
        "to": if diff { &comparison["comparisonTo"] } else { &Value::Null },
    });
    // Absent query parameters must remain omitted, not JSON null.
    for query in [&mut commit_query, &mut comparison_query] {
        query
            .as_object_mut()
            .unwrap()
            .retain(|_, value| !value.is_null());
    }
    let mut result = json!({"commitSource":commit, "comparisonSource":comparison,
        "commit":commit_query, "comparison":comparison_query});
    let revision = if diff && !string(&i["diffViewerCwd"]).is_empty() {
        &i["diffRevision"]
    } else {
        &i["graphRevision"]
    };
    if !revision.is_null() {
        result["revision"] = revision.clone();
    }
    result
}
/// Indices into the supplied snapshot, never copies of its pane records.
pub fn workspace_chat_entries(state: &Value) -> Vec<[usize; 2]> {
    let groups = array(&state["groups"]);
    let selected = groups
        .iter()
        .find(|g| g["id"] == state["selectedGroupId"])
        .and_then(|g| {
            array(&g["panes"])
                .iter()
                .find(|p| p["id"] == g["selectedPaneId"])
                .or_else(|| array(&g["panes"]).first())
        });
    let cwd = selected.map_or("", |p| repository_path(string(&p["cwd"])));
    groups
        .iter()
        .enumerate()
        .flat_map(|(g, group)| {
            array(&group["panes"])
                .iter()
                .enumerate()
                .filter(move |(_, pane)| repository_path(string(&pane["cwd"])) == cwd)
                .map(move |(p, _)| [g, p])
        })
        .collect()
}

pub fn git_operation_model(input: &Value) -> Value {
    let result = &input["result"];
    let preflight = &input["preflight"];
    let conflicts = array(&result["conflicts"]).len();
    let operation = string(&result["operation"]);
    let mut actions = Vec::new();
    if conflicts > 0 {
        actions = recovery_actions(operation, false);
    } else {
        actions.push(json!({"label":"Cancel","operation":null,"phase":"start","primary":false}));
        for (operation, allowed, label) in [
            ("rebase", "canRebase", "Rebase source onto target"),
            ("fastForward", "canFastForward", "Fast-forward target"),
            ("merge", "canMerge", "Merge source into target"),
        ] {
            if flag(&preflight[allowed]) {
                actions.push(json!({"label":label,"operation":operation,"phase":"start","primary":operation == "merge"}));
            }
        }
    }
    let conflict_message = (conflicts > 0).then(|| {
        format!(
            "Resolve {conflicts} conflicted file{}, then continue or abort.",
            if conflicts == 1 { "" } else { "s" }
        )
    });
    let blocked_reason = (conflicts == 0
        && !preflight.is_null()
        && !flag(&preflight["canMerge"])
        && !flag(&preflight["canRebase"])
        && !flag(&preflight["canFastForward"]))
    .then(|| {
        array(&preflight["reasons"])
            .iter()
            .map(string)
            .collect::<Vec<_>>()
            .join(". ")
    });
    let repository = &input["repository"];
    let kind = string(&repository["kind"]);
    let resumable = !kind.is_empty() && kind != "idle";
    let remaining = array(&repository["conflicts"]).len();
    let last = if input["graphResult"].is_object() {
        &input["graphResult"]
    } else {
        result
    };
    let (phase, message) = if flag(&input["running"]) {
        ("running", "Git operation running".into())
    } else if repository["phase"] == "conflicted" {
        ("conflicted", "Git operation has conflicts".into())
    } else if repository["phase"] == "awaitingContinuation" {
        (
            "awaitingContinuation",
            "Git operation is ready to continue".into(),
        )
    } else if last.is_object() {
        if flag(&last["ok"]) {
            (
                "completed",
                format!("Git {} completed", string(&last["operation"])),
            )
        } else {
            (
                "failed",
                last["errorLabel"]
                    .as_str()
                    .unwrap_or("Git command failed")
                    .into(),
            )
        }
    } else if flag(&input["preflightFailed"]) {
        ("failed", "Git command failed".into())
    } else {
        ("idle", String::new())
    };
    json!({"actions":actions,"conflictMessage":conflict_message,"blockedReason":blocked_reason,
        "operationActivity":{"phase":phase,"message":message},
        "recoveryActions":if resumable {recovery_actions(kind, remaining > 0)} else {Vec::new()},
        "recoveryTitle":resumable.then(|| format!("{} in progress", operation_name(kind))),
        "recoveryMessage":if remaining == 0 {"Ready to continue".into()} else {format!("{remaining} conflicted file{}", if remaining == 1 {""} else {"s"})}})
}

fn operation_name(kind: &str) -> &str {
    match kind {
        "merge" => "Merge",
        "rebase" => "Rebase",
        "cherryPick" => "Cherry-pick",
        "revert" => "Revert",
        other => other,
    }
}

fn recovery_actions(operation: &str, blocked: bool) -> Vec<Value> {
    [
        ("abort", "Abort"),
        ("skip", "Skip commit"),
        ("continue", "Continue"),
    ]
    .into_iter()
    .filter(|(phase, _)| *phase != "skip" || operation != "merge")
    .map(|(phase, label)| {
        json!({"operation":operation,"phase":phase,"label":label,
            "primary":phase == "continue","disabled":blocked && phase == "continue"})
    })
    .collect()
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView<'a> {
    key: &'a str,
    group_index: usize,
    pane_indices: Vec<usize>,
}

/// Resolve only visited views, retaining selectors into the renderer's current pane objects.
pub fn retained_workspaces(input: &Value) -> Value {
    let active = string(&input["activeKey"]);
    let scope = string(&input["scopeId"]);
    let mut seen = std::collections::HashSet::new();
    let mut retained = std::collections::VecDeque::new();
    for key in array(&input["previous"])
        .iter()
        .map(string)
        .filter(|key| *key != active)
        .chain([active])
    {
        if !seen.insert(key) {
            continue;
        }
        let Ok((group_id, scope_id)) = serde_json::from_str::<(String, String)>(key) else {
            continue;
        };
        if scope_id != scope {
            continue;
        }
        let Some((group_index, group)) = array(&input["groups"])
            .iter()
            .enumerate()
            .find(|(_, group)| group["id"] == group_id)
        else {
            continue;
        };
        retained.push_back(WorkspaceView {
            key,
            group_index,
            pane_indices: (0..array(&group["panes"]).len()).collect(),
        });
    }
    if retained.back().is_none_or(|view| view.key != active) {
        return json!([]);
    }
    let mut panes: usize = retained.iter().map(|view| view.pane_indices.len()).sum();
    while retained.len() > 1 && (retained.len() > 8 || panes > 24) {
        panes -= retained.pop_front().unwrap().pane_indices.len();
    }
    json!(retained)
}

#[cfg(test)]
mod ref_dialog_tests {
    use super::*;
    #[test]
    fn changes_area_resizes_and_keeps_both_panes_reachable() {
        assert_eq!(
            changes_layout(&json!({"availableHeight": 800}))["height"],
            320.
        );
        assert_eq!(
            changes_layout(&json!({"availableHeight": 800, "height": "480"}))["height"],
            480.
        );
        assert_eq!(
            changes_layout(&json!({"availableHeight": 800, "height": 9999}))["height"],
            680.
        );
        assert_eq!(
            changes_layout(&json!({"availableHeight": 800, "height": -100}))["height"],
            120.
        );
        assert_eq!(
            changes_layout(&json!({"availableHeight": 180, "height": 480})),
            json!({"height":90., "minimum":90., "maximum":90.})
        );
        assert_eq!(changes_layout(&json!({"availableHeight": 0}))["height"], 0.);
        assert_eq!(
            changes_layout(&json!({"availableHeight": 800, "height": "NaN"}))["height"],
            320.
        );
    }

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
    #[test]
    fn historical_queries_use_selection_scalars_and_preserve_diff_sources() {
        let mut input = json!({"mainViewMode":"graph", "graphCwd":"/repo", "graphRevision":"r1",
            "selectedCommitCount":1, "selectedCommitHash":"abc", "selectedCommitKind":"commit"});
        assert_eq!(
            historical_query(&input)["commit"],
            json!({"cwd":"/repo", "hash":"abc"})
        );
        input["selectedCommitCount"] = json!(2);
        assert_eq!(historical_query(&input)["commit"], json!({"cwd":"/repo"}));
        input["selectedCommitCount"] = json!(1);
        input["selectedCommitKind"] = json!("worktreeWip");
        assert_eq!(historical_query(&input)["commit"], json!({"cwd":"/repo"}));
        input["mainViewMode"] = json!("diff");
        input["diffViewerCwd"] = json!("/other");
        input["diffRevision"] = json!("r2");
        input["fileSource"] =
            json!({"kind":"commit", "commitHash":"older", "commitParent":"parent"});
        let query = historical_query(&input);
        assert_eq!(
            query["commit"],
            json!({"cwd":"/other", "hash":"older", "parent":"parent"})
        );
        assert_eq!(query["revision"], "r2");
        input["fileSource"] =
            json!({"kind":"comparison", "comparisonFrom":"a", "comparisonTo":"b"});
        assert_eq!(
            historical_query(&input)["comparison"],
            json!({"cwd":"/other", "from":"a", "to":"b"})
        );
    }
    #[test]
    fn activity_precedence_and_recovery_use_repository_state() {
        let mut input = json!({"repository":{"kind":"rebase","phase":"conflicted","conflicts":["a","b"]},
            "result":{"ok":true,"operation":"merge"},"graphResult":{"ok":false,"errorLabel":"Invalid Git action"},"running":true});
        assert_eq!(
            git_operation_model(&input)["operationActivity"]["phase"],
            "running"
        );
        input["running"] = json!(false);
        let model = git_operation_model(&input);
        assert_eq!(model["operationActivity"]["phase"], "conflicted");
        assert_eq!(model["recoveryMessage"], "2 conflicted files");
        assert_eq!(model["recoveryActions"][2]["disabled"], true);
        input["repository"]["phase"] = json!("awaitingContinuation");
        input["repository"]["conflicts"] = json!([]);
        let model = git_operation_model(&input);
        assert_eq!(model["operationActivity"]["phase"], "awaitingContinuation");
        assert_eq!(model["recoveryActions"][2]["disabled"], false);
        input["repository"] = json!({"kind":"idle","phase":"idle"});
        let model = git_operation_model(&input);
        assert_eq!(model["operationActivity"]["message"], "Invalid Git action");
        assert!(model["recoveryActions"].as_array().unwrap().is_empty());
        assert!(model["recoveryTitle"].is_null());
        input["graphResult"] = Value::Null;
        assert_eq!(
            git_operation_model(&input)["operationActivity"]["message"],
            "Git merge completed"
        );
        input["result"] = Value::Null;
        input["preflightFailed"] = json!(true);
        assert_eq!(
            git_operation_model(&input)["operationActivity"]["phase"],
            "failed"
        );
        assert_eq!(
            git_operation_model(&json!({}))["operationActivity"]["phase"],
            "idle"
        );
    }
}
