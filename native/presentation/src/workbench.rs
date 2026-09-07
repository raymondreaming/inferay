use crate::{array, flag, number, string};
use serde_json::{Value, json};

fn ordered<'a>(files: Vec<&'a Value>, presentation: &Value, mode: &Value) -> Vec<&'a Value> {
    if presentation.is_null() {
        return files;
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
        array(&input["files"]).iter().collect(),
        &input["presentation"],
        &input["mode"]
    ))
}
pub fn adjacent_file(input: &Value) -> Value {
    let files = array(&input["files"]);
    let current = input["current"].as_i64().unwrap_or(-1);
    let direction = input["direction"].as_i64().unwrap_or(1);
    if files.is_empty() {
        return Value::Null;
    }
    let next = if current < 0 {
        if direction > 0 {
            0
        } else {
            files.len() as i64 - 1
        }
    } else {
        (current + direction).clamp(0, files.len() as i64 - 1)
    };
    if flag(&input["repeatBoundary"]) || next != current {
        files[next as usize].clone()
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
    let mode = &i["fileViewMode"];
    let unstaged = ordered(
        array(&i["modified"])
            .iter()
            .chain(array(&i["untracked"]))
            .collect(),
        presentation,
        &json!("path"),
    );
    let staged = ordered(
        array(&i["staged"]).iter().collect(),
        presentation,
        &json!("path"),
    );
    let working: Vec<_> = unstaged.iter().chain(&staged).copied().collect();
    let navigable: Vec<_> = ordered(unstaged.clone(), presentation, mode)
        .into_iter()
        .chain(ordered(staged.clone(), presentation, mode))
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
    let displayed = if showing { &working } else { &historical_files };
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
    json!({"unstagedFiles":unstaged, "stagedFiles":staged, "workingFiles":working,
        "navigableFiles":navigable, "showingWorkingTree":showing, "comparing":comparing,
        "historyDetails":details, "historyLoading":loading, "historyMessage":message,
        "navigableHistoricalFiles":ordered(historical_files.clone(), &history["filePresentation"], &i["fileViewMode"]),
        "additions":displayed.iter().map(|f|number(&f["additions"])).sum::<f64>(),
        "deletions":displayed.iter().map(|f|number(&f["deletions"])).sum::<f64>()})
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
pub fn diff_viewer(i: &Value) -> Value {
    let diff = &i["diff"];
    let metadata = &diff["metadata"];
    let ranges = &metadata[if i["viewMode"] == "hunks" {
        "inlineChangeRanges"
    } else {
        "splitChangeRanges"
    }];
    let extension = string(&i["filePath"])
        .rsplit_once('.')
        .map(|(_, e)| e)
        .unwrap_or_default();
    let compact_count = diff["compactLineCount"]
        .as_u64()
        .map(|count| count as usize)
        .or_else(|| diff["compactLines"].as_array().map(Vec::len));
    let compact = compact_count.is_some();
    let old = array(&diff["oldLines"]);
    let new = array(&diff["newLines"]);
    let old_count = diff["oldLineCount"]
        .as_u64()
        .map_or(old.len(), |count| count as usize);
    let new_count = diff["newLineCount"]
        .as_u64()
        .map_or(new.len(), |count| count as usize);
    let status_line = if compact_count == Some(1) {
        diff.get("firstCompactLine")
            .or_else(|| array(&diff["compactLines"]).first())
    } else if old_count == 0 && new_count == 1 {
        diff.get("firstNewLine").or_else(|| new.first())
    } else {
        None
    };
    let status = status_line
        .filter(|line| {
            let content = string(&line["content"]).to_lowercase();
            line["type"] == "context"
                && (content.contains("too large") || content.contains("cannot read"))
        })
        .map(|line| string(&line["content"]).trim().to_owned());
    let total = compact_count.unwrap_or_else(|| old_count.max(new_count));
    let longest = [
        "maxOldLineChars",
        "maxNewLineChars",
        "maxInlineLineChars",
        "maxConflictLineChars",
    ]
    .iter()
    .map(|key| number(&metadata[key]) as usize)
    .max()
    .unwrap_or(0);
    let message = status.or_else(|| if total > 100_000 {
        Some(format!("Diff is too large to render safely ({} lines). Use the Editor/agent to inspect this file in smaller chunks.", grouped(total)))
    } else if longest > 8000 {
        Some(format!("Diff contains a very long line ({} characters). Rendering is limited to keep the app responsive.", grouped(longest)))
    } else { None });
    let markdown = !compact && matches!(extension, "md" | "mdx");
    let conflict = (flag(&diff["hasConflict"])
        || !string(&diff["mergeConflictContent"]).is_empty())
        && !markdown;
    json!({"changeRanges":ranges, "changePositions":array(ranges).iter().map(|r| &r[0]).collect::<Vec<_>>(),
        "extension":extension, "conflict":conflict, "message":message, "isMarkdown":markdown,
        "markdownContent":if markdown { new.iter().filter(|l| l["type"] != "hunk" && l["type"] != "spacer").map(|l|string(&l["content"])).collect::<Vec<_>>().join("\n") } else { String::new() },
        "navigable":!flag(&diff["isBinary"]) && (conflict || (message.is_none() && !markdown))})
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
pub fn diff_request(i: &Value) -> Value {
    if !flag(&i["active"]) || string(&i["cwd"]).is_empty() || i["selectedFile"].is_null() {
        return Value::Null;
    }
    let mut result = json!({"cwd":i["cwd"], "file":i["selectedFile"]["path"],"staged":i["selectedFile"]["staged"],"view":if i["viewMode"] == "split" { "full" } else { "review" }});
    if !i["revision"].is_null() {
        result["revision"] = i["revision"].clone();
    }
    let source = &i["fileSource"];
    let fields: &[&str] = match string(&source["kind"]) {
        "commit" => &["commitHash", "commitParent"],
        "comparison" => &["comparisonFrom", "comparisonTo"],
        _ => &[],
    };
    for field in fields {
        if !source[field].is_null() {
            result[field] = source[field].clone();
        }
    }
    result
}
pub fn repository_selection(i: &Value) -> Value {
    let state = &i["state"];
    let groups = array(&state["groups"]);
    let target = array(&state["repositories"]["workspaces"])
        .iter()
        .find(|workspace| workspace["cwd"] == i["cwd"])
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
    target.map_or(
        Value::Null,
        |entry| json!({"groupId":entry["groupId"],"paneId":entry["pane"]["id"]}),
    )
}

pub fn workspace_selection(i: &Value) -> Value {
    let mut state = i["state"].clone();
    if let Some(groups) = state["groups"].as_array_mut() {
        for group in groups.iter_mut() {
            if group["id"] == i["groupId"] && !i["paneId"].is_null() {
                group["selectedPaneId"] = i["paneId"].clone();
            }
        }
    }
    let group = array(&state["groups"])
        .iter()
        .find(|g| g["id"] == i["groupId"]);
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
    state["selectedGroupId"] = i["groupId"].clone();
    state["repositories"]["activePath"] = json!(cwd);
    state["repositories"]["visibleEntries"] = if active.is_null() {
        state["repositories"]["unassignedEntries"].clone()
    } else {
        active["entries"].clone()
    };
    state["repositories"]["activeWorkspace"] = active;
    state
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
        "recoveryTitle":resumable.then(|| format!("{kind} in progress")),
        "recoveryMessage":if remaining == 0 {"Ready to continue".into()} else {format!("{remaining} conflicted file{}", if remaining == 1 {""} else {"s"})}})
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

    #[test]
    fn branch_choices_and_conflict_recovery_follow_native_capabilities() {
        let dialog = git_operation_model(
            &json!({"preflight":{"canRebase":true,"canFastForward":true,"canMerge":true}}),
        );
        assert_eq!(
            dialog["actions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| a["operation"].clone())
                .collect::<Vec<_>>(),
            vec![
                Value::Null,
                json!("rebase"),
                json!("fastForward"),
                json!("merge")
            ]
        );
        for operation in ["merge", "rebase", "cherryPick"] {
            let dialog = git_operation_model(
                &json!({"result":{"operation":operation,"conflicts":["file"]}}),
            );
            let actions = dialog["actions"].as_array().unwrap();
            assert_eq!(actions.len(), if operation == "merge" { 2 } else { 3 });
            assert_eq!(actions.first().unwrap()["phase"], "abort");
            assert_eq!(actions.last().unwrap()["phase"], "continue");
            assert_eq!(
                dialog["conflictMessage"],
                "Resolve 1 conflicted file, then continue or abort."
            );
        }
        let blocked = git_operation_model(
            &json!({"preflight":{"reasons":["No shared ancestor", "Source unavailable"]}}),
        );
        assert_eq!(
            blocked["blockedReason"],
            "No shared ancestor. Source unavailable"
        );
        assert_eq!(blocked["actions"].as_array().unwrap().len(), 1);
        assert!(
            git_operation_model(&json!({"preflight":{"canFastForward":true}}))["blockedReason"]
                .is_null()
        );
    }
}

/// Warm only the two adjacent keyboard targets, preserving staged identity and
/// the caller's visible ordering. With no selection, prime the first two rows.
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
