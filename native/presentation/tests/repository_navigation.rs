use inferay_presentation::project;
use serde_json::{Value, json};

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
fn graph_file_open_waits_for_history_but_opens_wip_in_sidebar_order() {
    let mut input = json!({"request":"wip","mainViewMode":"graph","selectedCommitHash":"wip","selectedCommitCount":1,
        "selectedGraphItem":{"itemKind":"worktreeWip"},"workingTreeCwd":"/linked",
        "files":[{"path":"b","staged":false},{"path":"a","staged":true}],"loading":true});
    let first = project("graphFileOpen", &input).unwrap();
    assert_eq!(first["ready"], true);
    assert_eq!(
        first["action"],
        json!({"type":"workingTreeFile","cwd":"/linked","path":"b","staged":false})
    );
    input["selectedFile"] = json!({"path":"a","staged":true});
    assert_eq!(
        project("graphFileOpen", &input).unwrap()["action"]["path"],
        "a"
    );
    input["selectedGraphItem"] = json!({"itemKind":"commit","hash":"commit"});
    assert_eq!(project("graphFileOpen", &input).unwrap()["ready"], false);
    input["selectedCommitHash"] = json!("different");
    assert_eq!(
        project("graphFileOpen", &input).unwrap(),
        json!({"ready":true,"action":null})
    );
}

#[test]
fn hidden_graph_keeps_file_keyboard_navigation_after_closing_and_reopening_diff() {
    use inferay_presentation::panels;
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
        let mut session = panels::normalize(
            &json!({"graphVisible":false,"sidebarVisible":true,"mainViewMode":"diff"}),
        );
        panels::apply_action(&mut session, &selection, 1).unwrap();
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
        panels::apply_action(&mut session, &json!({"type":"dismissDiff"}), 2).unwrap();
        assert_eq!(navigate(&session, "ArrowRight"), json!({"type":"open"}));
        assert_eq!(navigate(&session, "Enter"), Value::Null);
        panels::apply_action(&mut session, &json!({"type":"mode","mode":"diff"}), 3).unwrap();
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
    for guard in [
        json!({"editable":true}),
        json!({"blocked":true}),
        json!({"graphVisible":true}),
    ] {
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
        Value::Null
    );
}

#[test]
fn right_from_chat_enters_sidebar_again_after_returning_to_chat() {
    use inferay_presentation::panels;
    let mut session = panels::normalize(&json!({"graphVisible":false,"sidebarVisible":true}));
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
            panels::apply_action(
                &mut session,
                &json!({"type":"workingTreeFile","cwd":"/repo","path":"first.rs","staged":false}),
                1,
            )
            .unwrap();
            panels::apply_action(&mut session, &json!({"type":"dismissDiff"}), 2).unwrap();
            panels::apply_action(&mut session, &json!({"type":"focusChat","cwd":"/repo"}), 3)
                .unwrap();
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
fn space_pages_current_diff_from_sidebar_without_moving_focus_or_selection() {
    let mut input = json!({"key":" ","sidebarFocused":true,"sidebarVisible":true,
        "mainViewMode":"diff","hasFile":true,"historical":true});
    for repeat in [false, true] {
        input["repeat"] = json!(repeat);
        for (shift, direction) in [(false, 1), (true, -1)] {
            input["shift"] = json!(shift);
            assert_eq!(
                project("repositoryKeyboardAction", &input).unwrap(),
                json!({"type":"scrollDiff","direction":direction})
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
