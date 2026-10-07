use inferay_presentation::{panels, project, transcript::ChatReplica};
use serde_json::{Value, json};
fn render(op: &str, input: Value) -> Value {
    project(op, &input).unwrap()
}

#[test]
fn added_and_deleted_files_use_full_width_but_modified_files_stay_split() {
    use inferay_core::repository::GitHunkDiff;
    for (is_new, patch, full_width) in [
        (true, "", true),
        (false, "--- a/file.ts\n+++ /dev/null\n", true),
        (false, "--- a/file.ts\n+++ b/file.ts\n", false),
    ] {
        let diff = GitHunkDiff {
            is_new,
            raw_patch: Some(patch.into()),
            ..Default::default()
        };
        let viewer =
            serde_json::to_value(inferay_presentation::diff::viewer(&diff, "file.ts", 0)).unwrap();
        assert_eq!(viewer["fullWidth"], full_width);
    }
}

#[test]
fn conversation_grid_keeps_repository_contexts_together_and_isolates_projects() {
    let key = |group: &str, scope: &str| json!([group, scope]).to_string();
    let mut input = json!({
        "scopeId":"aivre",
        "groups":[{"id":"first", "selectedPaneId":"a", "panes":[
            {"id":"a", "cwd":"/core"},
            {"id":"b", "cwd":"/web"},
            {"id":"c", "cwd":"/project"},
            {"id":"loose", "cwd":null}
        ]}],
        "activeKey":key("first", "aivre"),
        "previous":[key("first", "other-project")]
    });
    let expected = json!([{
        "key":key("first", "aivre"), "groupIndex":0, "paneIndices":[0,1,2,3]
    }]);
    assert_eq!(render("retainedWorkspaces", input.clone()), expected);
    input["groups"][0]["selectedPaneId"] = json!("b");
    assert_eq!(render("retainedWorkspaces", input.clone()), expected);
    input["groups"][0]["panes"]
        .as_array_mut()
        .unwrap()
        .remove(1);
    assert_eq!(
        render("retainedWorkspaces", input.clone())[0]["paneIndices"],
        json!([0, 1, 2])
    );
    input["activeKey"] = json!(key("missing", "aivre"));
    assert_eq!(render("retainedWorkspaces", input), json!([]));
}

#[test]
fn retained_workspaces_evict_only_inactive_views() {
    let key = |group: &str| json!([group, "project"]).to_string();
    let mut input = json!({"scopeId":"project", "groups":[], "previous":[]});
    for i in 0..10 {
        let group = format!("group-{i}");
        input["groups"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":group,"panes":[]}));
        input["previous"]
            .as_array_mut()
            .unwrap()
            .push(json!(key(&group)));
    }
    input["activeKey"] = json!(key("group-0"));
    let retained = render("retainedWorkspaces", input.clone());
    assert_eq!(retained.as_array().unwrap().len(), 8);
    assert_eq!(retained[0]["groupIndex"], 3);
    assert_eq!(retained[7]["groupIndex"], 0);
    for i in 0..25 {
        input["groups"][0]["panes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":format!("pane-{i}")}));
    }
    let retained = render("retainedWorkspaces", input);
    assert_eq!(retained.as_array().unwrap().len(), 1);
    assert_eq!(retained[0]["paneIndices"].as_array().unwrap().len(), 25);
}
#[test]
fn panel_transitions_preserve_historical_context_and_validate_commands() {
    let mut session = panels::normalize(&Value::Null);
    panels::apply_action(&mut session, &json!({"type":"openGraph","cwd":"/repo"}), 10).unwrap();
    panels::apply_action(
        &mut session,
        &json!({"type":"selectGraph","id":"a","orderedIds":["a","b","c"]}),
        11,
    )
    .unwrap();
    panels::apply_action(&mut session,&json!({"type":"selectGraph","id":"c","orderedIds":["a","b","c"],"intent":{"range":true,"additive":false}}),12).unwrap();
    assert_eq!(session["selectedCommitIds"], json!(["a", "b", "c"]));
    panels::apply_action(&mut session,&json!({"type":"commitFile","cwd":"/repo","path":"a.rs","commitHash":"a","commitParent":null}),13).unwrap();
    session = panels::normalize(&session);
    assert_eq!(session["historicalDiff"], true);
    assert_eq!(session["graphDrillIn"], true);
    let _: panels::PanelSession = serde_json::from_value(session.clone()).unwrap();
    panels::apply_action(&mut session, &json!({"type":"dismissDiff"}), 14).unwrap();
    assert_eq!(session["mainViewMode"], "graph");
    let before = session.clone();
    assert!(
        panels::apply_action(
            &mut session,
            &json!({"type":"commitFile","path":"a.rs"}),
            15
        )
        .is_err()
    );
    assert_eq!(session, before);
}
#[test]
fn transcript_rejects_gaps_wrong_epochs_and_invalid_append_targets() {
    let mut replica = ChatReplica::new();
    replica.reconnect();
    let initial = json!({"type":"chat:sync","modelVersion":1,"epoch":"one","revision":1,"messages":[{"id":"a","role":"assistant","content":"Hi"}]});
    assert_eq!(replica.admit(&initial)["kind"], "sync");
    let update = json!({"version":1,"epoch":"one","baseRevision":1,"revision":2,"reset":false,"start":0,"deleteCount":1,"messages":[{"message":{"id":"a","role":"assistant"},"appendContent":" there"}]});
    let result = replica.admit(&json!({"transcriptUpdate":update}));
    assert_eq!(result, json!({"kind":"patch","start":0,"deleteCount":1}));
    assert_eq!(
        replica.admit(&json!({"transcriptUpdate":update}))["kind"],
        "ignore"
    );
    let mut gap = update.clone();
    gap["revision"] = json!(4);
    assert_eq!(
        replica.admit(&json!({"transcriptUpdate":gap})),
        json!({"kind":"resync","reconnect":true})
    );
    assert_eq!(
        replica.admit(&json!({"transcriptUpdate":gap}))["reconnect"],
        false
    );
    let mut next = initial.clone();
    next["epoch"] = json!("two");
    assert_eq!(replica.admit(&next)["kind"], "sync");
    assert_eq!(
        replica.admit(&json!({"transcriptUpdate":update}))["kind"],
        "resync"
    );
}
#[test]
fn diff_change_navigation_is_strict_and_wraps_at_both_ends() {
    for (line, direction, expected) in [
        (0, 1, 0),
        (10, 1, 1),
        (20, -1, 0),
        (40, 1, 0),
        (0, -1, 2),
        (21, -1, 1),
    ] {
        assert_eq!(
            project(
                "nextDiffChange",
                &json!({
                    "ranges":[[10,11],[20,22],[40,45]], "line":line, "direction":direction
                })
            )
            .unwrap(),
            expected
        );
    }
    assert_eq!(
        project(
            "nextDiffChange",
            &json!({"ranges":[], "line":0, "direction":1})
        )
        .unwrap(),
        json!(null)
    );
}
