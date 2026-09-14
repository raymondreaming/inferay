use inferay_presentation::project;
use serde_json::{Value, json};

#[test]
fn diff_request_contract_omits_unrelated_history_and_preserves_review_mode() {
    let input = json!({"active":true,"cwd":"/repo","revision":"r1","selectedFile":{"path":"file.rs","staged":false},
        "viewMode":"hunks","fileSource":{"kind":"commit","commitHash":"abc","comparisonFrom":"ignored"}});
    let value = project("diffRequest", &input).unwrap();
    assert_eq!(
        value,
        json!({"cwd":"/repo","revision":"r1","file":"file.rs","staged":false,"commitHash":"abc","view":"review"})
    );
    let contract: inferay_presentation::diff::DiffRequest =
        serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(contract).unwrap(), value);
    assert_eq!(
        project("diffRequest", &json!({"active":false,"cwd":"/repo"})).unwrap(),
        Value::Null
    );
}

#[test]
fn git_ref_request_contract_retains_native_defaults_for_preflight_requests() {
    let request: inferay_presentation::git_actions::GitRefOperationRequest =
        serde_json::from_value(json!({"source":"topic","target":"main"})).unwrap();
    assert_eq!(request.operation, "");
    assert_eq!(request.action, "start");
    assert_eq!(request.source.as_deref(), Some("topic"));
    assert_eq!(request.target.as_deref(), Some("main"));
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
    assert_eq!(navigate("ArrowUp", -1, json!({}))["selectIndex"], 2);
    assert_eq!(navigate("ArrowDown", -1, json!({}))["selectIndex"], 0);
    assert_eq!(navigate("ArrowDown", 2, json!({}))["selectIndex"], 2);
    assert_eq!(navigate("Home", 2, json!({}))["selectIndex"], 0);
    assert_eq!(navigate("End", 0, json!({}))["selectIndex"], 2);
    assert_eq!(
        navigate(
            "ArrowDown",
            0,
            json!({"branch":true,"branchIndex":2,"branchTarget":"older"})
        )["selectItem"],
        "older"
    );
    assert_eq!(
        navigate(
            "ArrowDown",
            0,
            json!({"branch":true,"branchIndex":-1,"branchTarget":"offscreen"})
        )["selectItem"],
        "offscreen"
    );
    assert_eq!(
        navigate("ArrowDown", 0, json!({"branch":true,"branchIndex":-1}))["selectIndex"],
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
fn graph_viewport_includes_overscan_and_keyboard_scroll_padding() {
    assert_eq!(
        project(
            "graphViewport",
            &json!({"count":100,"scrollTop":483,"height":230})
        )
        .unwrap(),
        json!({"visibleStart":8,"visibleEnd":42})
    );
    assert_eq!(
        project(
            "graphViewport",
            &json!({"count":2,"scrollTop":-20,"height":230})
        )
        .unwrap(),
        json!({"visibleStart":0,"visibleEnd":2})
    );
    assert_eq!(
        project(
            "graphReveal",
            &json!({"index":0,"scrollTop":300,"height":230})
        )
        .unwrap(),
        0.0
    );
    assert_eq!(
        project(
            "graphReveal",
            &json!({"index":20,"scrollTop":0,"height":230})
        )
        .unwrap(),
        299.0
    );
}

#[test]
fn graph_column_resize_uses_the_same_limits_as_stored_preferences() {
    assert_eq!(
        project("resizeGraphColumn", &json!({"column":"message","width":40})).unwrap(),
        160.0
    );
    assert_eq!(
        project("resizeGraphColumn", &json!({"column":"graph","width":900})).unwrap(),
        480.0
    );
}

#[test]
fn file_selection_preserves_historical_sources_and_worktree_ownership() {
    let select = |input| project("repositoryFileSelection", &input).unwrap();
    assert_eq!(
        select(
            json!({"kind":"workingTree","workingTreeCwd":"/linked","file":{"path":"a","staged":true}})
        ),
        json!({"type":"workingTreeFile","cwd":"/linked","path":"a","staged":true})
    );
    assert_eq!(
        select(
            json!({"kind":"commit","activeCwd":"/active","diffViewerCwd":"/history","commitSource":{"commitHash":"old","commitParent":"parent"},"selectedGraphItem":{"hash":"new"},"file":{"path":"a"}})
        ),
        json!({"type":"commitFile","cwd":"/history","path":"a","commitHash":"old","commitParent":"parent"})
    );
    assert_eq!(
        select(
            json!({"kind":"commit","activeCwd":"/active","selectedGraphItem":{"hash":"wip","itemKind":"worktreeWip"},"file":{"path":"a"}})
        ),
        Value::Null
    );
    assert_eq!(
        select(
            json!({"kind":"comparison","comparisonPlan":{"cwd":"/active","from":"a","to":"b"},"file":{"path":"file"}})
        ),
        json!({"type":"comparisonFile","cwd":"/active","path":"file","from":"a","to":"b"})
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
fn repository_preferences_and_resizing_clamp_invalid_and_oversized_widths() {
    let defaults = project("repositoryPreferences", &json!({})).unwrap();
    assert_eq!(
        defaults,
        json!({"sidebarWidth":300.0,"diffWidth":680.0,"fileViewMode":"tree","diffViewMode":"hunks"})
    );
    let stored = project(
        "repositoryPreferences",
        &json!({"sidebarWidth":"900","diffWidth":"1","fileViewMode":"path","diffViewMode":"split"}),
    )
    .unwrap();
    assert_eq!(
        stored,
        json!({"sidebarWidth":420.0,"diffWidth":320.0,"fileViewMode":"path","diffViewMode":"split"})
    );
    assert_eq!(
        project("repositoryResize", &json!({"width":900})).unwrap(),
        420.0
    );
    assert_eq!(
        project(
            "repositoryResize",
            &json!({"diff":true,"availableWidth":100,"width":900})
        )
        .unwrap(),
        320.0
    );
}

#[test]
fn retained_graph_selection_uses_current_records_and_drops_unselected_cache() {
    let selection = project(
        "retainedGraphSelection",
        &json!({"ids":["old","a","b","a"],"selectedIds":["a","b","missing"],"selectedHash":"b"}),
    )
    .unwrap();
    assert_eq!(selection, json!({"indices":[3,2],"index":2}));
    let single = project(
        "retainedGraphSelection",
        &json!({"ids":["a","b"],"selectedIds":[],"selectedHash":"b"}),
    )
    .unwrap();
    assert_eq!(single, json!({"indices":[],"index":1}));
}
