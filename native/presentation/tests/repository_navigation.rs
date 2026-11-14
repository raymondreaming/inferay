mod support;
use serde_json::{Value, json};
use support::project;

fn panel_session(saved: &Value) -> Value {
    json!(inferay_presentation::panels::PanelSession::read(saved))
}
fn apply_panel(session: &mut Value, action: &Value, now: u64) -> Result<(), String> {
    *session = project(
        "panelPreview",
        &json!({"session":session,"action":action,"now":now}),
    )?;
    Ok(())
}

#[test]
fn graph_navigation_opens_wip_and_preserves_branch_and_boundary_rules() {
    let navigate = |key: &str, current: i64, extra: Value| {
        let items = ["wip", "middle", "older"];
        let mut input = json!({"key":key,"current":items.get(current as usize),"items":items});
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        project("graphNavigation", &input).unwrap()
    };
    assert_eq!(
        navigate("ArrowRight", 0, json!({"canOpen":true}))["openItem"],
        "wip"
    );
    assert_eq!(
        navigate("ArrowRight", -1, json!({"canOpen":true}))["openItem"],
        Value::Null
    );
    assert_eq!(
        project(
            "graphNavigation",
            &json!({"key":"ArrowRight","current":"wip","items":["older"],"canOpen":true})
        )
        .unwrap()["openItem"],
        "wip"
    );
    assert_eq!(navigate("ArrowUp", -1, json!({}))["selectIndex"], 2);
    assert_eq!(navigate("ArrowDown", -1, json!({}))["selectIndex"], 0);
    assert_eq!(navigate("ArrowDown", 2, json!({}))["selectIndex"], 2);
    assert_eq!(navigate("Home", 2, json!({}))["selectIndex"], 0);
    assert_eq!(navigate("End", 0, json!({}))["selectIndex"], 2);
    assert_eq!(
        navigate("ArrowDown", 0, json!({"alt":true,"branchTarget":"older"}))["selectItem"],
        "older"
    );
    assert_eq!(
        navigate(
            "ArrowDown",
            0,
            json!({"alt":true,"branchTarget":"offscreen"})
        )["selectItem"],
        "offscreen"
    );
    assert_eq!(
        navigate("ArrowDown", 0, json!({"alt":true}))["selectIndex"],
        Value::Null
    );
    assert_eq!(
        navigate("ArrowLeft", 0, json!({}))["selectIndex"],
        Value::Null
    );
    assert_eq!(navigate("Enter", 0, json!({}))["handled"], false);
    assert_eq!(
        project("graphNavigation", &json!({"key":"Home","items":[]})).unwrap()["handled"],
        false
    );
}

#[test]
fn hidden_graph_keeps_file_keyboard_navigation_after_closing_and_reopening_diff() {
    for (current, expected) in [(-1, 0), (1, 1)] {
        assert_eq!(
            project(
                "adjacentFile",
                &json!({"count":3,"current":current,"direction":0,"repeatBoundary":true})
            )
            .unwrap(),
            expected,
        );
    }
    for selection in [
        json!({"type":"workingTreeFile","cwd":"/repo","path":"a.rs","staged":false}),
        json!({"type":"commitFile","cwd":"/repo","path":"a.rs","commitHash":"commit","commitParent":null}),
        json!({"type":"comparisonFile","cwd":"/repo","path":"a.rs","from":"base","to":"head"}),
    ] {
        let mut session = panel_session(
            &json!({"graphVisible":false,"sidebarVisible":true,"mainViewMode":"diff"}),
        );
        apply_panel(&mut session, &selection, 1).unwrap();
        let navigate = |session: &Value, key: &str| {
            project(
                "repositoryKeyboardAction",
                &json!({
                    "key":key, "focusedPanelId":session["focusedAuxiliaryPanel"]["id"],
                    "mainViewMode":session["mainViewMode"], "graphVisible":false,
                    "sidebarVisible":true, "hasFile":true,
                }),
            )
            .unwrap()
        };
        assert_eq!(navigate(&session, "ArrowLeft"), json!({"type":"close"}));
        let selected = session["selectedFile"].clone();
        apply_panel(&mut session, &json!({"type":"dismissDiff"}), 2).unwrap();
        assert_eq!(navigate(&session, "ArrowRight"), json!({"type":"open"}));
        assert_eq!(navigate(&session, "Enter"), Value::Null);
        apply_panel(&mut session, &json!({"type":"mode","mode":"diff"}), 3).unwrap();
        assert_eq!(session["selectedFile"], selected);
        assert_eq!(
            navigate(&session, "ArrowDown"),
            json!({"type":"cycle","direction":1})
        );
        assert_eq!(
            navigate(&session, "ArrowUp"),
            json!({"type":"cycle","direction":-1})
        );
        session["focusedAuxiliaryPanel"] = Value::Null;
        assert_eq!(navigate(&session, "ArrowDown"), Value::Null);
    }
    for guard in [json!({"editable":true}), json!({"blocked":true})] {
        let mut input = json!({"key":"ArrowRight","focusedPanelId":"workspace-diff-viewer","mainViewMode":"graph","graphVisible":false,"sidebarVisible":true,"hasFile":true});
        input
            .as_object_mut()
            .unwrap()
            .extend(guard.as_object().unwrap().clone());
        assert_eq!(
            project("repositoryKeyboardAction", &input).unwrap(),
            Value::Null
        );
    }
}

#[test]
fn sidebar_keys_work_before_a_file_preview_or_graph_focus() {
    let mut input = json!({
        "mainViewMode":"graph", "graphVisible":true, "sidebarVisible":true,
        "sidebarFocused":true, "focusedPanelId":null, "hasFile":false,
    });
    for (key, action) in [
        ("ArrowLeft", json!({"type":"focusGraph"})),
        ("ArrowRight", json!({"type":"enterSidebar"})),
        ("ArrowUp", json!({"type":"cycle","direction":-1})),
        ("ArrowDown", json!({"type":"cycle","direction":1})),
    ] {
        input["key"] = json!(key);
        assert_eq!(project("repositoryKeyboardAction", &input).unwrap(), action);
        for guard in ["editable", "blocked"] {
            input[guard] = json!(true);
            assert_eq!(
                project("repositoryKeyboardAction", &input).unwrap(),
                Value::Null
            );
            input[guard] = json!(false);
        }
    }
    input["sidebarFocused"] = json!(false);
    assert_eq!(
        project("repositoryKeyboardAction", &input).unwrap(),
        json!({"type":"navigateGraph"})
    );
}

#[test]
fn right_from_chat_enters_sidebar_again_after_returning_to_chat() {
    let mut session = panel_session(&json!({"graphVisible":false,"sidebarVisible":true}));
    for empty_composer in [false, true] {
        for _ in 0..2 {
            let mut input = json!({"key":"ArrowRight","chatFocused":true,"sidebarVisible":true,
                "focusedPanelId":session["focusedAuxiliaryPanel"]["id"],
                "editable":empty_composer,"emptyComposer":empty_composer});
            assert_eq!(
                project("repositoryKeyboardAction", &input).unwrap(),
                json!({"type":"enterSidebar"})
            );
            for guard in [
                json!({"sidebarVisible":false}),
                json!({"blocked":true}),
                json!({"editable":true,"emptyComposer":false}),
            ] {
                let mut guarded = input.clone();
                guarded
                    .as_object_mut()
                    .unwrap()
                    .extend(guard.as_object().unwrap().clone());
                assert_eq!(
                    project("repositoryKeyboardAction", &guarded).unwrap(),
                    Value::Null
                );
            }
            input["key"] = json!("ArrowDown");
            assert_eq!(
                project("repositoryKeyboardAction", &input).unwrap(),
                Value::Null
            );
            apply_panel(
                &mut session,
                &json!({"type":"workingTreeFile","cwd":"/repo","path":"first.rs","staged":false}),
                1,
            )
            .unwrap();
            apply_panel(&mut session, &json!({"type":"dismissDiff"}), 2).unwrap();
            apply_panel(&mut session, &json!({"type":"focusChat","cwd":"/repo"}), 3).unwrap();
        }
    }
}

#[test]
fn left_after_repository_switch_uses_visible_panel_instead_of_old_focus() {
    let mut input = json!({
        "key":"ArrowLeft", "repositoryTabFocused":true,
        "focusedPanelId":null, "mainViewMode":"diff", "graphVisible":true,
        "sidebarVisible":true, "hasFile":true,
    });
    assert_eq!(
        project("repositoryKeyboardAction", &input).unwrap(),
        json!({"type":"close"})
    );
    input["mainViewMode"] = json!("graph");
    assert_eq!(
        project("repositoryKeyboardAction", &input).unwrap(),
        json!({"type":"closeGraph"})
    );
    input["repositoryTabFocused"] = json!(false);
    input["focusedPanelId"] = json!("workspace-diff-viewer");
    assert_eq!(
        project("repositoryKeyboardAction", &input).unwrap(),
        json!({"type":"closeGraph"})
    );
    input["sidebarFocused"] = json!(true);
    assert_eq!(
        project("repositoryKeyboardAction", &input).unwrap(),
        json!({"type":"focusGraph"})
    );
    input["editable"] = json!(true);
    assert_eq!(
        project("repositoryKeyboardAction", &input).unwrap(),
        Value::Null
    );
}

#[test]
fn space_steps_changes_from_sidebar_without_moving_focus_or_selection() {
    let mut input = json!({"key":" ","sidebarFocused":true,"sidebarVisible":true,
        "mainViewMode":"diff","hasFile":true,"historical":true});
    for repeat in [false, true] {
        input["repeat"] = json!(repeat);
        for (shift, direction) in [(false, 1), (true, -1)] {
            input["shift"] = json!(shift);
            assert_eq!(
                project("repositoryKeyboardAction", &input).unwrap(),
                json!({"type":"stepDiffChange","direction":direction})
            );
        }
    }
    for guard in ["editable", "overlay", "button", "composing", "blocked"] {
        input[guard] = json!(true);
        assert_eq!(
            project("repositoryKeyboardAction", &input).unwrap(),
            Value::Null
        );
        input[guard] = json!(false);
    }
    input["hasFile"] = json!(false);
    assert_eq!(
        project("repositoryKeyboardAction", &input).unwrap(),
        Value::Null
    );
}

#[test]
fn leaving_wip_diff_preserves_graph_selection_and_repository() {
    for file_disappears in [false, true] {
        let mut session = panel_session(&json!({"mainViewMode":"graph","graphVisible":true,
            "sidebarVisible":true,"diffViewerCwd":"/repo","selectedCommitHash":"wip"}));
        apply_panel(
            &mut session,
            &json!({"type":"workingTreeFile","cwd":"/repo","path":"a.rs","staged":false}),
            1,
        )
        .unwrap();
        let input = json!({"key":"ArrowLeft","mainViewMode":"diff","graphVisible":true,
            "sidebarVisible":true,"sidebarFocused":true,"hasFile":true});
        assert_eq!(
            project("repositoryKeyboardAction", &input).unwrap(),
            json!({"type":"focusGraph"})
        );
        if file_disappears {
            let file = session["selectedFile"].clone();
            apply_panel(
                &mut session,
                &json!({"type":"reconcileFile","expected":file,"staged":null}),
                2,
            )
            .unwrap();
        }
        apply_panel(&mut session, &json!({"type":"dismissDiff"}), 3).unwrap();
        assert_eq!(session["mainViewMode"], "graph");
        assert_eq!(session["graphVisible"], true);
        assert_eq!(session["diffViewerCwd"], "/repo");
        assert_eq!(session["selectedCommitHash"], "wip");
        assert_eq!(
            project(
                "repositoryKeyboardAction",
                &json!({"key":"ArrowLeft","repeat":true,
            "mainViewMode":"graph","graphVisible":true,"graphFocused":true})
            )
            .unwrap(),
            Value::Null
        );
    }
}

#[test]
fn sidebar_left_reopens_hidden_graph_after_browsing_files() {
    let mut session = panel_session(&json!({"mainViewMode":"graph","graphVisible":true,
        "sidebarVisible":true,"diffViewerCwd":"/repo","selectedCommitHash":"commit"}));
    apply_panel(
        &mut session,
        &json!({"type":"toggleGraph","cwd":"/repo"}),
        1,
    )
    .unwrap();
    assert_eq!(session["graphVisible"], false);
    for file in [None, Some("a.rs"), Some("b.rs")] {
        if let Some(path) = file {
            apply_panel(
                &mut session,
                &json!({"type":"workingTreeFile","cwd":"/repo","path":path,"staged":false}),
                2,
            )
            .unwrap();
        }
        let input = json!({"key":"ArrowLeft","sidebarFocused":true,"sidebarVisible":true,
            "graphVisible":false,"mainViewMode":session["mainViewMode"],"hasFile":file.is_some()});
        assert_eq!(
            project("repositoryKeyboardAction", &input).unwrap(),
            json!({"type":"focusGraph"})
        );
    }
    apply_panel(&mut session, &json!({"type":"openGraph","cwd":"/repo"}), 3).unwrap();
    assert_eq!(session["graphVisible"], true);
    assert_eq!(session["mainViewMode"], "graph");
    assert_eq!(session["selectedCommitHash"], "commit");
}

#[test]
fn changes_panel_groups_canonical_files_without_losing_both_sides_of_a_path() {
    let presentation = inferay_core::repository::GitFilePresentation::from_paths(
        ["a.z", "a/b", "new"].map(str::to_owned).to_vec(),
    );
    let mut input = json!({"files":[
        {"path":"a.z","staged":false,"status":"M","additions":2,"deletions":1},
        {"path":"a/b","staged":true,"status":"M","additions":5,"deletions":3},
        {"path":"a/b","staged":false,"status":"M","additions":1,"deletions":0},
        {"path":"new","staged":false,"status":"?","additions":4,"deletions":0}
    ], "filePresentation":presentation, "fileViewMode":"tree", "content":"workingTree"});
    let model = project("changesPanel", &input).unwrap();
    assert_eq!(model["stagedFiles"], json!([1]));
    assert_eq!(model["unstagedFiles"], json!([0, 2, 3]));
    assert_eq!(model["navigableFiles"], json!([2, 0, 3, 1]));
    assert_eq!(model["additions"], 12.0);
    assert_eq!(model["deletions"], 4.0);
    input["fileViewMode"] = json!("path");
    assert_eq!(
        project("changesPanel", &input).unwrap()["navigableFiles"],
        json!([0, 2, 3, 1])
    );
    input["historyFiles"] = json!([{"path":"a/b","additions":2,"deletions":1},{"path":"a.z","additions":4,"deletions":3}]);
    input["historyFilePresentation"] = input["filePresentation"].clone();
    input["content"] = json!("history");
    input["selectedCommitCount"] = json!(2);
    let model = project("changesPanel", &input).unwrap();
    assert_eq!(model["historyDetails"], "comparison");
    assert_eq!(model["navigableHistoricalFiles"], json!([1, 0]));
    assert_eq!(model["additions"], 6.0);
    assert_eq!(model["deletions"], 4.0);
}

#[test]
fn compact_history_keeps_branch_before_graph_and_enabled_columns() {
    let mut input = json!({"columns": {"graph":true,"message":true,"refs":true,"date":true,"author":true,"sha":true},
        "order":["refs","graph","message","date","author","sha"],
        "widths":{"refs":216,"graph":96,"message":340,"date":132,"author":136,"sha":76},
        "maxColumn":12,"count":10,"availableWidth":520,"stretch":true});
    for width in [360., 520., 759.] {
        input["availableWidth"] = json!(width);
        let compact = project("graphLayout", &input).unwrap();
        assert_eq!(
            compact["visibleOrder"],
            json!(["refs", "graph", "message", "date", "author", "sha"])
        );
        let widths = &compact["columnWidths"];
        let date_right = widths["refs"].as_f64().unwrap()
            + widths["graph"].as_f64().unwrap()
            + widths["message"].as_f64().unwrap()
            + widths["date"].as_f64().unwrap();
        if width >= 520. {
            assert!(date_right <= width);
        }
        assert_eq!(widths["date"], 160.);
        assert!(compact["tableWidth"].as_f64().unwrap() > width);
        assert_eq!(compact["graphLeft"], widths["refs"]);
    }
    input["columns"]["date"] = json!(false);
    input["columns"]["author"] = json!(false);
    let hidden = project("graphLayout", &input).unwrap();
    assert_eq!(
        hidden["visibleOrder"],
        json!(["refs", "graph", "message", "sha"])
    );
    input["columns"]["date"] = json!(true);
    input["columns"]["author"] = json!(true);
    input["availableWidth"] = json!(1200);
    let full = project("graphLayout", &input).unwrap();
    assert_eq!(full["visibleOrder"], input["order"]);
    assert_eq!(full["columnWidths"]["refs"], 216.);
    assert_eq!(full["tableWidth"], 1200.);
}
