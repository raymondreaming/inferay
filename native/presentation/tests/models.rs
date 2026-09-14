use inferay_presentation::{panels, project, transcript::ChatReplica};
use serde_json::{Value, json};
fn render(op: &str, input: Value) -> Value {
    project(op, &input).unwrap()
}
fn dock(input: &Value) -> Result<Value, String> {
    inferay_presentation::dock::project(input)
}

#[test]
fn ui_timing_summaries_group_comparable_ready_samples_and_compute_percentiles() {
    let context = json!({"retained":false,"alreadySelected":false,"visibleChats":1,
        "activeRuns":0,"viewportWidth":1200,"viewportHeight":800,"targetWidth":900});
    let mut samples = (1..=20)
        .map(|frame| {
            json!({"kind":"repository","result":"frame-ready","target":"repo",
            "context":context,"frameReadyMs":frame})
        })
        .collect::<Vec<_>>();
    samples.push(
        json!({"kind":"repository","result":"timeout","target":"repo",
        "context":context,"frameReadyMs":1000}),
    );
    let mut selected_context = context.clone();
    selected_context["alreadySelected"] = json!(true);
    samples.push(
        json!({"kind":"repository","result":"frame-ready","target":"repo",
        "context":selected_context,"frameReadyMs":1000}),
    );
    assert_eq!(
        render("uiTimingSummaries", json!(samples)),
        json!([{"kind":"repository","target":"repo","context":context,
            "count":20,"medianMs":10.5,"p95Ms":19.0}])
    );
}

#[test]
fn workspace_mutation_plan_distinguishes_selection_from_structure() {
    let plan = |state: &Value, action: Value| {
        json!(inferay_presentation::workbench::workspace_mutation_plan(
            state, &action
        ))
    };
    let state = json!({"selectedGroupId":"g", "groups":[{"id":"g","selectedPaneId":"a"}],
        "repositories":{"workspaces":[{"cwd":"/repo","entries":[{"groupId":"g","pane":{"id":"a"}}]}]}});
    for action in [
        json!({"type":"selectPane","groupId":"g","paneId":"a"}),
        json!({"type":"selectRepository","cwd":"/repo"}),
    ] {
        assert_eq!(
            plan(&state, action),
            json!({"selection":{"groupId":"g","paneId":"a"},"unchanged":true})
        );
    }
    assert_eq!(
        plan(&state, json!({"type":"selectWorkspace","groupId":"g"})),
        json!({"selection":{"groupId":"g"},"unchanged":true})
    );
    assert_eq!(
        plan(
            &state,
            json!({"type":"selectPane","groupId":"g","paneId":"b"})
        ),
        json!({"selection":{"groupId":"g","paneId":"b"},"unchanged":false})
    );
    for action in [
        Value::Null,
        json!({"type":"addPane","groupId":"g"}),
        json!({"type":"selectRepository","cwd":"/missing"}),
    ] {
        assert_eq!(
            plan(&state, action),
            json!({"selection":null,"unchanged":false})
        );
    }
}

#[test]
fn retained_workspaces_follow_group_membership_and_evict_only_inactive_views() {
    let key = |group: &str, cwd: Option<&str>| json!([group, cwd]).to_string();
    let mut input = json!({
        "groups": [
            {"id":"first", "panes":[{"id":"b"},{"id":"a"},{"id":"loose"}]},
            {"id":"empty", "panes":[]},
            {"id":"second", "panes":[{"id":"c"}]}
        ],
        "repositories": {
            "workspaces":[{"cwd":"/repo", "entries":[
                {"groupId":"first","pane":{"id":"a"}},
                {"groupId":"second","pane":{"id":"c"}},
                {"groupId":"first","pane":{"id":"b"}}
            ]}],
            "unassignedEntries":[{"groupId":"first","pane":{"id":"loose"}}]
        },
        "activeKey":key("first", Some("/repo")), "previous":[]
    });
    let first = render("retainedWorkspaces", input.clone());
    assert_eq!(
        first,
        json!([{
            "key":key("first", Some("/repo")), "groupIndex":0,
            "cwd":"/repo", "paneIndices":[0,1]
        }])
    );
    input["previous"] = json!([
        key("first", Some("/repo")),
        "deleted",
        key("first", Some("/repo"))
    ]);
    input["activeKey"] = json!(key("empty", None));
    let next = render("retainedWorkspaces", input.clone());
    assert_eq!(next.as_array().unwrap().len(), 2);
    assert_eq!(
        next[1],
        json!({"key":key("empty", None), "groupIndex":1, "cwd":null, "paneIndices":[]})
    );
    input["activeKey"] = json!(key("first", None));
    assert_eq!(
        render("retainedWorkspaces", input.clone())[1]["paneIndices"],
        json!([2])
    );
    input["activeKey"] = json!(key("second", Some("/repo")));
    assert_eq!(
        render("retainedWorkspaces", input.clone())[1]["groupIndex"],
        2
    );
    input["activeKey"] = json!("missing");
    assert_eq!(render("retainedWorkspaces", input), json!([]));

    let mut input = json!({"groups":[], "repositories":{"workspaces":[],"unassignedEntries":[]}, "previous":[]});
    for i in 0..10 {
        let group = format!("group-{i}");
        input["groups"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":group,"panes":[]}));
        input["previous"]
            .as_array_mut()
            .unwrap()
            .push(json!(key(&group, None)));
    }
    input["activeKey"] = json!(key("group-0", None));
    let retained = render("retainedWorkspaces", input.clone());
    assert_eq!(retained.as_array().unwrap().len(), 8);
    assert_eq!(retained[0]["groupIndex"], 3);
    assert_eq!(retained[7]["groupIndex"], 0);

    // The active workspace survives even when its pane count alone exceeds the budget.
    for i in 0..25 {
        let pane = json!({"id":format!("pane-{i}")});
        input["groups"][0]["panes"]
            .as_array_mut()
            .unwrap()
            .push(pane.clone());
        input["repositories"]["unassignedEntries"]
            .as_array_mut()
            .unwrap()
            .push(json!({"groupId":"group-0","pane":pane}));
    }
    let retained = render("retainedWorkspaces", input);
    assert_eq!(retained.as_array().unwrap().len(), 1);
    assert_eq!(retained[0]["paneIndices"].as_array().unwrap().len(), 25);
}

#[test]
fn decorated_segments_preserve_unicode_text_and_only_highlight_known_tokens() {
    let text = "🦀 /REVIEW a/b @docs/🦀.md /unknown";
    let segments = render(
        "decoratedTextSegments",
        json!({"text":text,"commands":["review"]}),
    );
    assert_eq!(
        segments,
        json!([
            {"text":"🦀 ","highlighted":false},
            {"text":"/REVIEW","highlighted":true},
            {"text":" a/b ","highlighted":false},
            {"text":"@docs/🦀.md","highlighted":true},
            {"text":" /unknown","highlighted":false}
        ])
    );
    for text in ["", "plain 🦀 text", "@one @two", "/review", "a@b", "@", "/"] {
        let result = render(
            "decoratedTextSegments",
            json!({"text":text,"commands":["review"]}),
        );
        let joined: String = result
            .as_array()
            .unwrap()
            .iter()
            .map(|segment| segment["text"].as_str().unwrap())
            .collect();
        assert_eq!(joined, text);
        assert!(
            result
                .as_array()
                .unwrap()
                .iter()
                .all(|segment| segment["text"] != "")
        );
    }
}

#[test]
fn composer_offsets_follow_utf16_and_tokens_respect_word_boundaries() {
    let state = json!({"show":false,"selectedIdx":0,"query":"","index":-1});
    assert_eq!(
        render(
            "completionMenuInput",
            json!({"state":state,"value":"🦀 /review","cursorPos":10,"trigger":"/"})
        ),
        json!({"show":true,"selectedIdx":0,"index":3,"query":"review"})
    );
    assert_eq!(
        render(
            "completionMenuInput",
            json!({"state":state,"value":"a/b","cursorPos":3,"trigger":"/"})
        ),
        Value::Null
    );
}
#[test]
fn malformed_graph_preferences_cannot_duplicate_or_hide_required_columns() {
    let prefs = render(
        "graphPreferences",
        json!({"order":["graph","graph","bogus"],"widths":{"graph":-200,"date":5000},"columns":{"author":"yes"}}),
    );
    assert_eq!(
        prefs["order"],
        json!(["graph", "date", "refs", "message", "author", "sha"])
    );
    assert_eq!(prefs["widths"]["graph"], 48.);
    assert_eq!(prefs["widths"]["date"], 480.);
    assert_eq!(prefs["columns"]["author"], true);
}
#[test]
fn file_navigation_preserves_staging_and_tree_order() {
    let files = json!([{"path":"z","staged":false},{"path":"a/b","staged":false},{"path":"a","staged":true}]);
    let presentation = json!({"treeOrder":["a/b","a","z"],"pathOrder":["a","a/b","z"]});
    let ordered = render(
        "visibleFiles",
        json!({"files":files,"presentation":presentation,"mode":"tree"}),
    );
    assert_eq!(ordered[0]["path"], "a/b");
    assert_eq!(
        render(
            "selectionAfterToggle",
            json!({"files":files,"selected":{"path":"a","staged":true}})
        ),
        json!({"path":"a","staged":false})
    );
    assert_eq!(
        render(
            "adjacentFile",
            json!({"count":3,"current":2,"direction":1,"repeatBoundary":false})
        ),
        Value::Null
    );
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
fn transcript_local_notices_keep_their_anchor_and_acknowledged_sends_disappear() {
    let local = json!([{"id":"a","role":"assistant"},{"id":"notice","role":"system","localOnly":true,"content":"Saved"},{"id":"send","role":"user","optimistic":true}]);
    let server = json!([{"id":"a","role":"assistant"},{"id":"send","role":"user"},{"id":"b","role":"assistant"}]);
    assert_eq!(
        render(
            "mergeTranscriptOrder",
            json!({"local":local,"server":server})
        ),
        json!([[false, 0], [true, 1], [false, 1], [false, 2]])
    );
}
#[test]
fn dock_preview_preserves_saved_geometry_and_reconciles_membership() {
    let input =
        serde_json::json!({"ids":["a","b","c"],"columns":3,"mode":"grid","visibleColumns":3});
    let first = dock(&input).unwrap();
    assert_eq!(first["canvas"]["width"], "100%");
    let resized = dock(&serde_json::json!({
        "saved":first["saved"], "action":{"type":"resize","path":[],"ratio":0.7},
        "ids":["a","b","c"],"columns":3,"mode":"grid","visibleColumns":3,
    }))
    .unwrap();
    assert_eq!(resized["tree"]["ratio"], 0.7);
    let restored = dock(&serde_json::json!({
        "saved":resized["saved"],"ids":["a","b","c"],"columns":3,"mode":"grid","visibleColumns":3,
    }))
    .unwrap();
    assert_eq!(resized, restored);
    let narrow = dock(&serde_json::json!({
        "saved":resized["saved"],"ids":["a","b","c"],"columns":3,"mode":"grid","visibleColumns":1,
    }))
    .unwrap();
    assert_eq!(narrow["canvas"]["width"], "100%");
    assert_eq!(narrow["canvas"]["minHeight"], "max(300%, 1020px)");
    assert_eq!(narrow["saved"], resized["saved"]);
    let changed = dock(&serde_json::json!({
        "saved":resized["saved"],"ids":["a","d"],"columns":3,"mode":"grid","visibleColumns":3,
    }))
    .unwrap();
    assert_eq!(changed["tree"]["first"]["id"], "a");
    assert_eq!(changed["tree"]["second"]["id"], "d");
    assert!(dock(&serde_json::json!({"ids":[5]})).is_err());
}

#[test]
fn activity_starts_locally_and_timer_survives_delayed_acknowledgement() {
    use serde_json::json;
    let apply = |input| inferay_presentation::project("chatRunStatus", &input).unwrap();
    let sending = apply(
        json!({"current":{"isLoading":false,"status":"idle","startTime":null},"begin":true,"now":1000}),
    );
    assert_eq!(
        sending,
        json!({"isLoading":true,"status":"sending","startTime":1000})
    );
    assert_eq!(
        apply(
            json!({"current":sending,"incoming":{"isLoading":false,"status":"idle","startTime":null}})
        ),
        sending
    );
    let acknowledged = apply(
        json!({"current":sending,"incoming":{"isLoading":true,"status":"thinking","startTime":8000}}),
    );
    assert_eq!(acknowledged["startTime"], 1000);
    assert_eq!(acknowledged["status"], "thinking");
    assert_eq!(
        apply(json!({"current":acknowledged,"begin":true,"now":9000})),
        acknowledged
    );
    for status in ["idle", "error"] {
        let terminal = json!({"isLoading":false,"status":status,"startTime":null});
        assert_eq!(
            apply(json!({"current":sending,"incoming":terminal,"terminal":true})),
            terminal
        );
    }
    for text in ["/help", "/clear", "/exit", "/btw question"] {
        assert_eq!(
            inferay_presentation::project("prepareChatSend", &json!({"text":text})).unwrap()["startsRun"],
            false
        );
    }
    assert_eq!(
        inferay_presentation::project("prepareChatSend", &json!({"text":"hello"})).unwrap()["startsRun"],
        true
    );
}

#[test]
fn grid_uses_available_chats_then_preserves_columns_in_partial_rows() {
    fn widths(tree: &Value, width: f64, result: &mut Vec<f64>) {
        match tree["type"].as_str() {
            Some("panel") => result.push(width),
            Some("split") => {
                let horizontal = tree["direction"] == "horizontal";
                let ratio = tree["ratio"].as_f64().unwrap();
                widths(
                    &tree["first"],
                    width * if horizontal { ratio } else { 1.0 },
                    result,
                );
                widths(
                    &tree["second"],
                    width * if horizontal { 1.0 - ratio } else { 1.0 },
                    result,
                );
            }
            _ => {}
        }
    }
    for columns in 1..=4 {
        let mut saved = Value::Null;
        for count in 1..=10 {
            let ids: Vec<_> = (0..count).map(|i| i.to_string()).collect();
            let input = json!({"ids":ids,"columns":columns,"visibleColumns":columns,"mode":"grid","saved":saved});
            let layout = dock(&input).unwrap();
            let mut actual = vec![];
            widths(&layout["tree"], 1.0, &mut actual);
            assert_eq!(actual.len(), count);
            let expected = 1.0 / columns.min(count) as f64;
            assert!(
                actual.iter().all(|width| (width - expected).abs() < 1e-9),
                "columns={columns}, count={count}, widths={actual:?}"
            );
            assert!(!layout["saved"].to_string().contains("empty"));
            let mut repeat_input = input.clone();
            repeat_input["saved"] = layout["saved"].clone();
            let repeated = dock(&repeat_input).unwrap();
            // Persisted geometry projects to the same padded rows on subsequent renders.
            assert_eq!(repeated["tree"], layout["tree"]);
            saved = layout["saved"].clone();
        }
    }
}

#[test]
fn grid_resize_paths_remain_valid_inside_partial_rows() {
    let input = json!({"ids":["a","b","c","d","e"],"columns":3,"mode":"grid"});
    let layout = dock(&input).unwrap();
    let resized = dock(&json!({"ids":input["ids"],"columns":3,"mode":"grid","saved":layout["saved"],"action":{"type":"resize","path":["second","first"],"ratio":0.6}})).unwrap();
    assert_eq!(resized["tree"]["second"]["first"]["ratio"], 0.6);
    assert!(!resized["saved"].to_string().contains("empty"));
}

#[test]
fn sidebar_without_graph_defaults_to_current_changes() {
    for mode in ["graph", "diff"] {
        let mut session = panels::normalize(&json!({
            "mainViewMode": mode, "graphVisible": true, "sidebarVisible": true,
            "selectedCommitHash": "abc123", "selectedCommitIds": ["abc123"],
            "selectedFile": {"path":"file.rs","staged":false,"source":{"kind":"commit","commitHash":"abc123","commitParent":null}}
        }));
        assert_eq!(session["sidebarContent"], "history");
        session["graphVisible"] = json!(false);
        assert_eq!(
            project("panelSidebarContent", &session).unwrap(),
            "workingTree"
        );
        assert_eq!(panels::normalize(&session)["sidebarContent"], "workingTree");
        // Restoring the graph retains the user's previous history selection.
        session["graphVisible"] = json!(true);
        assert_eq!(project("panelSidebarContent", &session).unwrap(), "history");
        assert_eq!(session["selectedCommitHash"], "abc123");
    }
}

#[test]
fn graph_and_changes_sidebar_toggle_independently() {
    let mut session = panels::normalize(&json!({"mainViewMode":"graph","sidebarVisible":true}));
    assert_eq!(session["graphVisible"], true);
    panels::apply_action(&mut session, &json!({"type":"toggleSidebar"}), 1).unwrap();
    assert_eq!(session["sidebarVisible"], false);
    assert_eq!(session["graphVisible"], true);
    panels::apply_action(
        &mut session,
        &json!({"type":"toggleGraph","cwd":"/repo"}),
        2,
    )
    .unwrap();
    assert_eq!(session["graphVisible"], false);
    panels::apply_action(&mut session, &json!({"type":"toggleSidebar"}), 3).unwrap();
    assert_eq!(session["sidebarVisible"], true);
    assert_eq!(session["graphVisible"], false);
    panels::apply_action(
        &mut session,
        &json!({"type":"toggleGraph","cwd":"/repo"}),
        4,
    )
    .unwrap();
    assert_eq!(session["sidebarVisible"], true);
    assert_eq!(session["graphVisible"], true);
    assert_eq!(
        panels::normalize(&json!({"mainViewMode":"graph","sidebarVisible":false}))["graphVisible"],
        false
    );
}
#[test]
fn queue_actions_replace_optimistic_messages_and_preserve_persisted_order() {
    let current = json!([
        {"id":"saved", "text":"persisted"},
        {"id":"pending", "text":"old", "transient":true}
    ]);
    let staged = project(
        "chatQueue",
        &json!({
            "action":"stage", "current":current, "message":{"id":"pending", "text":"new"}
        }),
    )
    .unwrap();
    assert_eq!(
        staged,
        json!([
            {"id":"saved", "text":"persisted"},
            {"id":"pending", "text":"new", "transient":true}
        ])
    );
    let resolved = project(
        "chatQueue",
        &json!({
            "action":"resolve", "current":staged, "id":"pending"
        }),
    )
    .unwrap();
    assert_eq!(resolved, json!([{"id":"saved", "text":"persisted"}]));
    assert_eq!(
        project(
            "chatQueue",
            &json!({
                "action":"resolve", "current":resolved, "id":"missing"
            })
        )
        .unwrap(),
        resolved
    );
    assert_eq!(
        project(
            "chatQueue",
            &json!({
                "action":"merge", "current":staged,
                "persisted":[{"id":"pending", "text":"accepted"}]
            })
        )
        .unwrap(),
        json!([{"id":"pending", "text":"accepted"}])
    );
    assert!(project("chatQueue", &json!({"action":"unknown"})).is_err());
}
#[test]
fn empty_graph_uses_the_native_snapshot_and_presentation_contract() {
    let response = project("emptyGitGraph", &json!(null)).unwrap();
    let snapshot: inferay_core::repository::GitGraphSnapshot =
        serde_json::from_value(response.clone()).unwrap();
    assert_eq!(
        snapshot.state,
        inferay_core::repository::GitRepositorySnapshotState::Empty
    );
    assert_eq!(
        snapshot.operation.kind,
        inferay_core::repository::GitRepositoryOperationKind::Idle
    );
    assert!(snapshot.commits.is_empty());
    assert_eq!(response["presentation"]["selectableItems"], json!([]));
    assert_eq!(response["presentation"]["containingBranches"], json!({}));
    assert!(response.get("stateError").is_none());
    assert!(response["actions"]["fetch"]["title"].is_string());
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
#[test]
fn diff_navigation_clears_scroll_and_highlight_independently() {
    let update = |state: Value, action: Value| {
        project("diffNavigation", &json!({"state":state,"action":action})).unwrap()
    };
    let jumped = update(
        json!({}),
        json!({"type":"jumpToChange","changeIdx":2,"top":90}),
    );
    assert_eq!(
        jumped,
        json!({"scroll":{"source":"all","top":90.0},"highlight":2})
    );
    let cleared = update(jumped.clone(), json!({"type":"clearScroll"}));
    assert_eq!(cleared, json!({"highlight":2}));
    assert_eq!(
        update(cleared.clone(), json!({"type":"clearScroll"})),
        json!(null)
    );
    let synced = update(
        cleared,
        json!({"type":"jumpToPosition","source":"left","top":120}),
    );
    assert_eq!(
        synced,
        json!({"scroll":{"source":"left","top":120.0},"highlight":2})
    );
    assert_eq!(
        update(synced, json!({"type":"clearHighlight"})),
        json!({"scroll":{"source":"left","top":120.0}})
    );
    assert_eq!(
        update(json!({"highlight":2}), json!({"type":"clearHighlight"})),
        json!({})
    );
    assert!(
        project(
            "diffNavigation",
            &json!({"state":{},"action":{"type":"unknown"}})
        )
        .is_err()
    );
}
