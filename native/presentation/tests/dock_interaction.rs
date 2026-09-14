use inferay_presentation::project;
use serde_json::{Value, json};

#[test]
fn dock_pointer_prioritizes_outer_edges_and_rejects_the_source_cell() {
    let mut input = json!({"x":2,"y":250,"root":{"left":0,"top":0,"width":800,"height":500},
        "mode":"grid","panelCount":2,"source":"a","cellId":"a","cell":{"left":0,"top":0,"width":400,"height":500}});
    assert_eq!(
        project("dockPointerTarget", &input).unwrap(),
        json!({"id":"__workspace-root__","edge":"left"})
    );
    input["x"] = json!(200);
    assert_eq!(project("dockPointerTarget", &input).unwrap(), Value::Null);
    input["insert"] = json!(true);
    assert_eq!(
        project("dockPointerTarget", &input).unwrap(),
        json!({"id":"a","edge":"center"})
    );
    input["mode"] = json!("rows");
    input["rowId"] = json!("b");
    input["rowIndex"] = json!(1);
    assert_eq!(
        project("dockPointerTarget", &input).unwrap(),
        json!({"id":"b","edge":"center","rowIndex":1})
    );
}

#[test]
fn repository_tab_order_preserves_new_tabs_and_rejects_noop_moves() {
    let order = inferay_presentation::workbench::tab_order(
        &json!({"paths":["a","b","c","new"],"pending":["c","a","b"]}),
    );
    assert_eq!(order, json!([2, 0, 1, 3]));
    let mut input = json!({"paths":["c","a","b","new"],"cwd":"a","direction":1});
    assert_eq!(
        json!(inferay_presentation::workbench::reorder_tabs(&input)),
        json!({"before":"new","order":["c","b","a","new"]})
    );
    input["direction"] = Value::Null;
    input["before"] = json!("b");
    assert_eq!(
        json!(inferay_presentation::workbench::reorder_tabs(&input)),
        Value::Null
    );
    input["before"] = Value::Null;
    assert_eq!(
        json!(inferay_presentation::workbench::reorder_tabs(&input)),
        json!({"before":null,"order":["c","b","new","a"]})
    );
}

#[test]
fn dock_wheel_only_delegates_to_the_selected_scrollable_pane() {
    let base = json!({"mode":"grid","deltaY":20,"selected":true,"inner":{"offset":10,"size":100,"extent":200}});
    assert_eq!(project("dockWheel", &base).unwrap()["capture"], false);
    let mut unselected = base.clone();
    unselected["selected"] = json!(false);
    assert_eq!(project("dockWheel", &unselected).unwrap()["delta"], 20.0);
    let mut exhausted = base;
    exhausted["inner"]["offset"] = json!(100);
    assert_eq!(project("dockWheel", &exhausted).unwrap()["capture"], true);
    assert_eq!(
        project(
            "dockWheel",
            &json!({"mode":"rows","deltaX":30,"deltaY":1,"selected":true})
        )
        .unwrap(),
        json!({"capture":true,"horizontal":true,"delta":0.0})
    );
}

#[test]
fn dock_session_keeps_responsive_changes_local_and_deduplicates_acknowledgements() {
    use inferay_presentation::dock_session::DockSession;
    let mut session = DockSession::new();
    let mut input = json!({"workspaceId":"responsive-test", "ids":["a","b"],
        "columns":2,"visibleColumns":2,"mode":"grid","rows":1});
    let initial: Value =
        serde_json::from_str(&session.begin(&input.to_string(), None, None, true).unwrap())
            .unwrap();
    assert_eq!(initial["persist"], true);
    assert_eq!(
        session
            .accept(
                initial["revision"].as_u64().unwrap() as u32,
                "responsive-test",
                &initial["layout"].to_string()
            )
            .unwrap(),
        "null"
    );
    assert_eq!(
        session.begin(&input.to_string(), None, None, true).unwrap(),
        "null"
    );
    for columns in [1, 2, 1, 2] {
        input["visibleColumns"] = json!(columns);
        let next: Value =
            serde_json::from_str(&session.begin(&input.to_string(), None, None, true).unwrap())
                .unwrap();
        assert_eq!(next["persist"], false);
        assert_eq!(next["layout"]["saved"], initial["layout"]["saved"]);
        assert!(next["layout"]["canvas"].is_object());
    }
    input["ids"] = json!(["a", "b", "c"]);
    let changed: Value =
        serde_json::from_str(&session.begin(&input.to_string(), None, None, true).unwrap())
            .unwrap();
    assert_eq!(changed["persist"], true);
}

#[test]
fn dock_session_preserves_pending_actions_retries_and_disposal() {
    use inferay_presentation::dock_session::DockSession;
    let mut session = DockSession::new();
    let input = json!({"workspaceId":"pending-test", "ids":["a","b"],
        "columns":2,"visibleColumns":2,"mode":"grid","rows":1});
    let initial: Value =
        serde_json::from_str(&session.begin(&input.to_string(), None, None, true).unwrap())
            .unwrap();
    session
        .accept(1, "pending-test", &initial["layout"].to_string())
        .unwrap();
    let mut action = input.clone();
    action["action"] = json!({"type":"resize","path":[],"ratio":0.7});
    let edit: Value = serde_json::from_str(
        &session
            .begin(&action.to_string(), None, None, false)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(edit["persist"], true);
    let mut narrower = input.clone();
    narrower["visibleColumns"] = json!(1);
    let pending: Value = serde_json::from_str(
        &session
            .begin(&narrower.to_string(), None, None, true)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        pending["persist"], true,
        "Do not skip a save while a prior mutation is pending"
    );
    assert!(!session.is_current(2));
    assert_eq!(
        session
            .accept(2, "pending-test", &initial["layout"].to_string())
            .unwrap(),
        "null"
    );
    assert!(!session.fail(2));
    assert!(session.fail(3));
    let retry: Value = serde_json::from_str(
        &session
            .begin(&narrower.to_string(), None, None, true)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(retry["persist"], true);
    session.dispose();
    assert!(!session.is_current(4));
    assert_eq!(
        session
            .accept(4, "pending-test", &initial["layout"].to_string())
            .unwrap(),
        "null"
    );
}
