use crate::{array, flag, number, string};
use serde_json::{Value, json};

fn ordered(files: &Value, presentation: &Value, mode: &Value) -> Value {
    if presentation.is_null() {
        return files.clone();
    }
    let order = &presentation[if mode == "tree" {
        "treeOrder"
    } else {
        "pathOrder"
    }];
    let by_path: std::collections::HashMap<_, _> = array(files)
        .iter()
        .map(|f| (string(&f["path"]), f))
        .collect();
    json!(
        array(order)
            .iter()
            .filter_map(|path| by_path.get(string(path)))
            .collect::<Vec<_>>()
    )
}
pub fn visible_files(input: &Value) -> Value {
    ordered(&input["files"], &input["presentation"], &input["mode"])
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
    let unstaged = json!(
        array(&i["modified"])
            .iter()
            .chain(array(&i["untracked"]))
            .collect::<Vec<_>>()
    );
    let unstaged = ordered(&unstaged, &i["filePresentation"], &json!("path"));
    let staged = ordered(&i["staged"], &i["filePresentation"], &json!("path"));
    let working = json!(
        array(&unstaged)
            .iter()
            .chain(array(&staged))
            .collect::<Vec<_>>()
    );
    let navigable = json!(
        array(&ordered(
            &unstaged,
            &i["filePresentation"],
            &i["fileViewMode"]
        ))
        .iter()
        .chain(array(&ordered(
            &staged,
            &i["filePresentation"],
            &i["fileViewMode"]
        )))
        .collect::<Vec<_>>()
    );
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
    let historical_files = if history["files"].is_array() {
        history["files"].clone()
    } else {
        json!([])
    };
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
        "navigableHistoricalFiles":ordered(&historical_files, &history["filePresentation"], &i["fileViewMode"]),
        "additions":array(displayed).iter().map(|f|number(&f["additions"])).sum::<f64>(),
        "deletions":array(displayed).iter().map(|f|number(&f["deletions"])).sum::<f64>()})
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
    let mut result =
        json!({"commitSource":commit,"comparisonSource":comparison,"commit":{},"comparison":{}});
    // Omitted query fields are intentionally absent, rather than JSON null.
    for (target, fields) in [
        (
            "commit",
            vec![
                (
                    "cwd",
                    if diff && !string(&commit["commitHash"]).is_empty() {
                        &i["diffViewerCwd"]
                    } else {
                        &i["graphCwd"]
                    },
                ),
                (
                    "hash",
                    if diff {
                        &commit["commitHash"]
                    } else if array(&i["selectedCommitIds"]).len() <= 1
                        && i["selectedGraphItem"]["itemKind"] != "worktreeWip"
                    {
                        &i["selectedGraphItem"]["hash"]
                    } else {
                        &Value::Null
                    },
                ),
                (
                    "parent",
                    if diff {
                        &commit["commitParent"]
                    } else {
                        &i["selectedCommitParent"]
                    },
                ),
            ],
        ),
        (
            "comparison",
            vec![
                (
                    "cwd",
                    if diff {
                        &i["diffViewerCwd"]
                    } else {
                        &i["graphCwd"]
                    },
                ),
                (
                    "from",
                    if diff {
                        &comparison["comparisonFrom"]
                    } else {
                        &Value::Null
                    },
                ),
                (
                    "to",
                    if diff {
                        &comparison["comparisonTo"]
                    } else {
                        &Value::Null
                    },
                ),
            ],
        ),
    ] {
        for (key, value) in fields {
            if !value.is_null() {
                result[target][key] = value.clone();
            }
        }
    }
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
