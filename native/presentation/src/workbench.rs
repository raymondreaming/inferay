use crate::{array, flag, number, string};
use serde_json::{Value, json};

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPreferences {
    sidebar_width: f64,
    diff_width: f64,
    #[ts(type = "'path' | 'tree'")]
    file_view_mode: String,
    diff_view_mode: crate::diff::DiffViewMode,
}

pub fn preferences(input: &Value) -> RepositoryPreferences {
    let width = |key: &str, default: f64| {
        input[key]
            .as_f64()
            .or_else(|| string(&input[key]).trim().parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value > 0.)
            .unwrap_or(default)
    };
    RepositoryPreferences {
        sidebar_width: width("sidebarWidth", 230.).clamp(230., 420.),
        diff_width: width("diffWidth", 680.).max(320.),
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
    json!(if flag(&input["diff"]) {
        number(&input["width"]).clamp(320., number(&input["availableWidth"]).max(320.))
    } else {
        number(&input["width"]).clamp(230., 420.)
    })
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

pub fn selected_worktree(input: &Value) -> Value {
    if !flag(&input["graphVisible"]) || input["item"]["itemKind"] != "worktreeWip" {
        return Value::Null;
    }
    array(&input["worktrees"])
        .iter()
        .position(|worktree| worktree["path"] == input["item"]["worktreePath"])
        .map_or(Value::Null, |index| json!(index))
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
        Some(action @ ("pageDown" | "pageUp"))
            if diff && flag(&input["hasFile"]) && !flag(&input["button"]) =>
        {
            json!({"type":"scrollDiff","direction":if action == "pageDown" { 1 } else { -1 }})
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

pub fn resize_start(input: &Value) -> Value {
    let diff = flag(&input["diff"]);
    let sidebar_width = number(&input["sidebarWidth"]);
    let diff_width = number(&input["diffWidth"]);
    json!({
        "availableWidth": number(&input["containerWidth"])
            - if flag(&input["sidebarVisible"]) { sidebar_width } else { 0. }
            - number(&input["minimumPaneWidth"]),
        "startWidth": if diff && input["railWidth"].as_f64().is_some() {
            number(&input["railWidth"])
        } else if diff { diff_width } else { sidebar_width },
        "width": if diff { diff_width } else { sidebar_width },
    })
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct RetainedGraphSelection {
    indices: Vec<usize>,
    index: Option<usize>,
}

/// Return positions into caller-owned records so renderer identity stays intact.
pub fn retained_graph_selection(input: &Value) -> RetainedGraphSelection {
    let indices: std::collections::HashMap<_, _> = array(&input["ids"])
        .iter()
        .enumerate()
        .map(|(index, id)| (string(id), index))
        .collect();
    RetainedGraphSelection {
        indices: array(&input["selectedIds"])
            .iter()
            .filter_map(|id| indices.get(string(id)).copied())
            .collect(),
        index: input["selectedHash"]
            .as_str()
            .and_then(|id| indices.get(id).copied()),
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
    let files = array(&input["files"]);
    if working_tree && files.is_empty() {
        result.ready = false;
        return result;
    }
    if let Some(file) = files.first() {
        let mut selection = input.clone();
        selection["file"] = file.clone();
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

fn ordered<'a>(
    files: impl IntoIterator<Item = &'a Value>,
    presentation: &Value,
    mode: &str,
) -> Vec<&'a Value> {
    if presentation.is_null() {
        return files.into_iter().collect();
    }
    let order = &presentation[if mode == "tree" {
        "treeOrder"
    } else {
        "pathOrder"
    }];
    let by_path: std::collections::HashMap<_, _> = files
        .into_iter()
        .map(|file| (string(&file["path"]), file))
        .collect();
    array(order)
        .iter()
        .filter_map(|path| by_path.get(string(path)).copied())
        .collect()
}
pub fn visible_files(input: &Value) -> Value {
    if input["presentation"].is_null() {
        return input["files"].clone();
    }
    json!(ordered(
        array(&input["files"]).iter(),
        &input["presentation"],
        string(&input["mode"])
    ))
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
pub fn changes_panel(i: &Value) -> Value {
    let presentation = &i["filePresentation"];
    let mode = string(&i["fileViewMode"]);
    let unstaged = ordered(
        array(&i["modified"]).iter().chain(array(&i["untracked"])),
        presentation,
        "path",
    );
    let staged = ordered(array(&i["staged"]).iter(), presentation, "path");
    let navigable: Vec<_> = ordered(unstaged.iter().copied(), presentation, mode)
        .into_iter()
        .chain(ordered(staged.iter().copied(), presentation, mode))
        .collect();
    let showing = i["content"] == "workingTree";
    let comparing = number(&i["selectedCommitCount"]) > 1.;
    let has_commit = !string(&i["selectedCommitHash"]).is_empty();
    let details = if comparing {
        &i["comparisonDetails"]
    } else if has_commit {
        &i["commitDetails"]
    } else {
        &Value::Null
    };
    let loading = if comparing {
        flag(&i["comparisonDetailsLoading"])
    } else {
        has_commit && flag(&i["commitDetailsLoading"])
    };
    let history = if !i["comparisonDetails"].is_null() {
        &i["comparisonDetails"]
    } else {
        &i["commitDetails"]
    };
    let historical_files: Vec<_> = array(&history["files"]).iter().collect();
    let displayed = if showing {
        [unstaged.as_slice(), staged.as_slice()]
    } else {
        [historical_files.as_slice(), &[]]
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
    json!({"unstagedFiles":unstaged, "stagedFiles":staged,
        "navigableFiles":navigable, "showingWorkingTree":showing, "comparing":comparing,
        "historyDetails":details, "historyLoading":loading, "historyMessage":message,
        "navigableHistoricalFiles":ordered(historical_files.iter().copied(), &history["filePresentation"], mode),
        "additions":displayed.iter().flat_map(|files| *files).map(|f|number(&f["additions"])).sum::<f64>(),
        "deletions":displayed.iter().flat_map(|files| *files).map(|f|number(&f["deletions"])).sum::<f64>()})
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
        "hash": if diff { &commit["commitHash"] } else if array(&i["selectedCommitIds"]).len() <= 1 && i["selectedGraphItem"]["itemKind"] != "worktreeWip" { &i["selectedGraphItem"]["hash"] } else { &Value::Null },
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
        &i["storedRevision"]
    } else {
        &i["graphRevision"]
    };
    if !revision.is_null() {
        result["revision"] = revision.clone();
    }
    result
}
fn repository_selection(state: &Value, cwd: &Value) -> Option<WorkspaceSelection> {
    let groups = array(&state["groups"]);
    let target = array(&state["repositories"]["workspaces"])
        .iter()
        .find(|workspace| workspace["cwd"] == *cwd)
        .map(|workspace| array(&workspace["entries"]))
        .unwrap_or(&[])
        .iter()
        .min_by_key(|entry| {
            if entry["groupId"] == state["selectedGroupId"] {
                0
            } else if groups.iter().any(|group| {
                group["id"] == entry["groupId"] && group["selectedPaneId"] == entry["pane"]["id"]
            }) {
                1
            } else {
                2
            }
        });
    target.and_then(|entry| {
        Some(WorkspaceSelection {
            group_id: entry["groupId"].as_str()?.to_owned(),
            pane_id: Some(entry["pane"]["id"].as_str()?.to_owned()),
        })
    })
}

#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSelection {
    group_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pane_id: Option<String>,
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct WorkspaceMutationPlan {
    pub(crate) selection: Option<WorkspaceSelection>,
    pub(crate) unchanged: bool,
}

pub fn workspace_mutation_plan(state: &Value, action: &Value) -> WorkspaceMutationPlan {
    let selection: Option<WorkspaceSelection> = match string(&action["type"]) {
        "selectRepository" => repository_selection(state, &action["cwd"]),
        "selectPane" | "selectWorkspace" => Some(WorkspaceSelection {
            group_id: string(&action["groupId"]).to_owned(),
            pane_id: action["paneId"].as_str().map(str::to_owned),
        }),
        _ => None,
    };
    let unchanged = selection.as_ref().is_some_and(|selection| {
        state["selectedGroupId"] == selection.group_id
            && array(&state["groups"]).iter().any(|group| {
                group["id"] == selection.group_id
                    && selection
                        .pane_id
                        .as_ref()
                        .is_none_or(|id| group["selectedPaneId"] == *id)
            })
    });
    WorkspaceMutationPlan {
        selection,
        unchanged,
    }
}

pub(crate) fn workspace_selection(state: &mut Value, selection: &WorkspaceSelection) {
    if let Some(groups) = state["groups"].as_array_mut() {
        for group in groups.iter_mut() {
            if group["id"] == selection.group_id && selection.pane_id.is_some() {
                group["selectedPaneId"] = json!(selection.pane_id);
            }
        }
    }
    let group = array(&state["groups"])
        .iter()
        .find(|g| g["id"] == selection.group_id);
    let pane = group.and_then(|g| {
        array(&g["panes"])
            .iter()
            .find(|p| p["id"] == g["selectedPaneId"])
            .or_else(|| array(&g["panes"]).first())
    });
    let cwd = pane
        .and_then(|p| p["cwd"].as_str())
        .map(|s| {
            let s = s.trim();
            if s == "/" {
                s
            } else {
                s.trim_end_matches(['/', '\\'])
            }
        })
        .map(str::to_owned);
    let active = array(&state["repositories"]["workspaces"])
        .iter()
        .find(|w| w["cwd"].as_str() == cwd.as_deref())
        .cloned()
        .unwrap_or(Value::Null);
    state["selectedGroupId"] = json!(selection.group_id);
    state["repositories"]["activePath"] = json!(cwd);
    state["repositories"]["visibleEntries"] = if active.is_null() {
        state["repositories"]["unassignedEntries"].clone()
    } else {
        active["entries"].clone()
    };
    state["repositories"]["activeWorkspace"] = active;
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
    cwd: Option<String>,
    pane_indices: Vec<usize>,
}

/// Resolve only visited views, retaining selectors into the renderer's current pane objects.
pub fn retained_workspaces(input: &Value) -> Value {
    let active = string(&input["activeKey"]);
    let repositories = &input["repositories"];
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
        let Ok((group_id, cwd)) = serde_json::from_str::<(String, Option<String>)>(key) else {
            continue;
        };
        let Some((group_index, group)) = array(&input["groups"])
            .iter()
            .enumerate()
            .find(|(_, group)| group["id"] == group_id)
        else {
            continue;
        };
        let entries = if let Some(cwd) = &cwd {
            let Some(workspace) = array(&repositories["workspaces"])
                .iter()
                .find(|workspace| workspace["cwd"] == *cwd)
            else {
                continue;
            };
            &workspace["entries"]
        } else {
            &repositories["unassignedEntries"]
        };
        let belongs = |entry: &&Value| entry["groupId"] == group_id;
        let ids: std::collections::HashSet<_> = array(entries)
            .iter()
            .filter(belongs)
            .map(|entry| string(&entry["pane"]["id"]))
            .collect();
        if ids.is_empty()
            && (cwd.is_some()
                || array(&repositories["workspaces"]).iter().any(|workspace| {
                    array(&workspace["entries"])
                        .iter()
                        .any(|entry| belongs(&entry))
                }))
        {
            continue;
        }
        retained.push_back(WorkspaceView {
            key,
            group_index,
            cwd,
            pane_indices: array(&group["panes"])
                .iter()
                .enumerate()
                .filter_map(|(index, pane)| ids.contains(string(&pane["id"])).then_some(index))
                .collect(),
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

/// One ordering policy for keyboard moves, pointer drops, and native persistence.
pub fn tab_order(input: &Value) -> Value {
    let pending = array(&input["pending"]);
    let ranks: std::collections::HashMap<_, _> = pending
        .iter()
        .enumerate()
        .map(|(index, path)| (string(path), index))
        .collect();
    let paths = array(&input["paths"]);
    let mut indices: Vec<_> = (0..paths.len()).collect();
    indices.sort_by_key(|index| {
        ranks
            .get(string(&paths[*index]))
            .copied()
            .unwrap_or(pending.len())
    });
    json!(indices)
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct RepositoryTabMove {
    pub(crate) order: Vec<String>,
    pub(crate) before: Option<String>,
}

pub fn reorder_tabs(input: &Value) -> Option<RepositoryTabMove> {
    let paths: Vec<String> = array(&input["paths"])
        .iter()
        .map(|p| string(p).to_owned())
        .collect();
    let cwd = string(&input["cwd"]);
    let before = if let Some(direction) = input["direction"].as_i64() {
        let from = paths.iter().position(|p| p == cwd)?;
        let to = from as i64 + direction;
        if to < 0 || to >= paths.len() as i64 {
            return None;
        }
        paths
            .get((if direction < 0 { to } else { to + 1 }) as usize)
            .map(String::as_str)
    } else {
        input["before"].as_str()
    };
    match inferay_core::agent_state::reorder_repositories(paths.clone(), cwd, before) {
        Ok(next) if next != paths => Some(RepositoryTabMove {
            order: next,
            before: before.map(str::to_owned),
        }),
        _ => None,
    }
}

/// DOM measurements enter here; hit testing and edge-scroll speed are pure.
#[derive(serde::Serialize, ts_rs::TS)]
pub struct RepositoryTabDrag {
    pub(crate) valid: bool,
    pub(crate) before: Option<String>,
    scroll: f64,
}

pub fn tab_drag(input: &Value) -> RepositoryTabDrag {
    let rect = &input["rect"];
    let left = number(&rect["left"]);
    let right = number(&rect["right"]);
    let x = number(&input["x"]);
    let y = number(&input["y"]);
    let valid = x >= left - 24.
        && x <= right + 24.
        && y >= number(&rect["top"]) - 24.
        && y <= number(&rect["bottom"]) + 24.;
    let edge = (number(&rect["width"]) / 3.).min(40.);
    let speed = if !valid || edge <= 0. {
        0.
    } else if x < left + edge {
        -((left + edge - x) / edge).min(1.)
    } else if x > right - edge {
        ((x - right + edge) / edge).min(1.)
    } else {
        0.
    };
    let before = array(&input["tabs"])
        .iter()
        .find(|tab| {
            tab["cwd"] != input["cwd"] && x < number(&tab["left"]) + number(&tab["width"]) / 2.
        })
        .and_then(|tab| tab["cwd"].as_str())
        .map(str::to_owned);
    RepositoryTabDrag {
        valid,
        before,
        scroll: speed * number(&input["elapsed"]) * 0.6,
    }
}
