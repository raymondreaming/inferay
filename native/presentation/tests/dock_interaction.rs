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

#[test]
fn deleting_first_grid_pane_compacts_rows_and_handles_the_last_pane() {
    let mut input =
        json!({"ids":["a","b","c","d"], "columns":2,"visibleColumns":2,"mode":"grid","rows":2});
    let first = inferay_presentation::dock::project(&input).unwrap();
    input["saved"] = first["saved"].clone();
    input["ids"] = json!(["b", "c", "d"]);
    let next = inferay_presentation::dock::project(&input).unwrap();
    let tree = &next["saved"]["tree"];
    assert_eq!(tree["first"]["first"]["id"], "b");
    assert_eq!(tree["first"]["second"]["id"], "c");
    assert_eq!(tree["second"]["id"], "d");
    input["saved"] = next["saved"].clone();
    input["ids"] = json!([]);
    let empty = inferay_presentation::dock::project(&input).unwrap();
    assert!(empty["tree"].is_null());
    input["saved"] = empty["saved"].clone();
    input["ids"] = json!(["new"]);
    assert_eq!(
        inferay_presentation::dock::project(&input).unwrap()["tree"]["id"],
        "new"
    );
}

#[test]
fn grid_reflows_after_out_of_order_deletions_and_additions() {
    let mut input = json!({"ids":["a","b","c","d","e","f"], "columns":3,"visibleColumns":3,"mode":"grid","rows":2});
    for ids in [
        json!(["a", "b", "c", "d", "e", "f"]),
        json!(["a", "c", "d", "e", "f"]),
        json!(["a", "c", "d", "f"]),
        json!(["a", "c", "d", "f", "g"]),
        json!(["c", "d", "f", "g"]),
    ] {
        input["ids"] = ids;
        let output = inferay_presentation::dock::project(&input).unwrap();
        input["saved"] = output["saved"].clone();
    }
    let tree = &input["saved"]["tree"];
    assert_eq!(tree["first"]["first"]["first"]["id"], "c");
    assert_eq!(tree["first"]["first"]["second"]["id"], "d");
    assert_eq!(tree["first"]["second"]["id"], "f");
    assert_eq!(tree["second"]["id"], "g");
}

#[test]
fn unchanged_membership_retains_custom_splits_and_reordering() {
    let mut input = json!({"ids":["a","b","c"],"columns":3,"visibleColumns":3});
    let initial = inferay_presentation::dock::project(&input).unwrap();
    input["saved"] = initial["saved"].clone();
    input["action"] = json!({"type":"place","source":"c","target":"a","edge":"center"});
    let reordered = inferay_presentation::dock::project(&input).unwrap();
    input["saved"] = reordered["saved"].clone();
    input["action"] = json!({"type":"resize","path":[],"ratio":0.72});
    let resized = inferay_presentation::dock::project(&input).unwrap();
    input["saved"] = resized["saved"].clone();
    input["action"] = Value::Null;
    input["ids"] = json!(["b", "a", "c"]);
    let restored = inferay_presentation::dock::project(&input).unwrap();
    assert_eq!(restored["saved"], resized["saved"]);
    assert_eq!(restored["saved"]["tree"]["ratio"], 0.72);
    assert_eq!(restored["saved"]["tree"]["first"]["first"]["id"], "c");
}

#[test]
fn nine_chats_keep_half_view_height_and_scroll_the_third_row() {
    let mut input = json!({"ids":[], "columns":3,"visibleColumns":3,"rows":3});
    // Old one-column preferences must not lock newly added chats into a stack.
    let old = inferay_presentation::dock::project(
        &json!({"ids":["1"], "columns":1,"visibleColumns":1,"rows":1}),
    )
    .unwrap();
    input["saved"] = old["saved"].clone();
    for count in 2..=9 {
        input["ids"] = json!((1..=count).map(|n| n.to_string()).collect::<Vec<_>>());
        let layout = inferay_presentation::dock::project(&input).unwrap();
        input["saved"] = layout["saved"].clone();
    }
    let layout = inferay_presentation::dock::project(&input).unwrap();
    assert_eq!(layout["canvas"]["minHeight"], "max(150.000%, 540.000px)");
    let tree = &layout["tree"];
    assert_eq!(tree["direction"], "vertical");
    for (row, first) in [
        (&tree["first"]["first"], "1"),
        (&tree["first"]["second"], "4"),
        (&tree["second"], "7"),
    ] {
        assert_eq!(row["direction"], "horizontal");
        assert_eq!(row["first"]["first"]["id"], first);
    }
    // Opening a side panel may narrow the view; closing it restores all columns.
    input["visibleColumns"] = json!(1);
    let narrow = inferay_presentation::dock::project(&input).unwrap();
    let height = narrow["canvas"]["minHeight"].as_str().unwrap();
    let percent: f64 = height
        .strip_prefix("max(")
        .unwrap()
        .split('%')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert!(percent >= 450., "Nine stacked chats each need half a view");
    input["saved"] = narrow["saved"].clone();
    input["visibleColumns"] = json!(3);
    assert_eq!(
        inferay_presentation::dock::project(&input).unwrap()["tree"],
        *tree
    );
}

#[test]
fn row_resizing_preserves_the_minimum_chat_height_during_preview_and_after_save() {
    let mut input = json!({"ids":["a","b"],"columns":1,"visibleColumns":1});
    let initial = inferay_presentation::dock::project(&input).unwrap();
    assert_eq!(initial["canvas"]["minHeight"], "max(100.000%, 360.000px)");
    let preview = project(
        "resizeDockSplit",
        &json!({
            "tree":initial["tree"],"path":[],"ratio":0.75
        }),
    )
    .unwrap();
    assert_eq!(preview["minHeight"], "max(200.000%, 720.000px)");
    input["saved"] = initial["saved"].clone();
    input["action"] = json!({"type":"resize","path":[],"ratio":0.75});
    let saved = inferay_presentation::dock::project(&input).unwrap();
    assert_eq!(saved["tree"], preview["tree"]);
    assert_eq!(saved["canvas"]["minHeight"], preview["minHeight"]);
}
