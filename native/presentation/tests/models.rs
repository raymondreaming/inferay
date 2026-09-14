use inferay_presentation::{panels, project, transcript::ChatReplica};
use serde_json::{Value, json};
fn render(op: &str, input: Value) -> Value {
    project(op, &input).unwrap()
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
    assert_eq!(
        render(
            "trigger",
            json!({"value":"🦀 /review","cursorPos":10,"trigger":"/"})
        ),
        json!({"index":3,"query":"review"})
    );
    assert_eq!(
        render(
            "trigger",
            json!({"value":"a/b","cursorPos":3,"trigger":"/"})
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
    let first = inferay_presentation::project("workspaceDock", &input).unwrap();
    assert_eq!(first["horizontal"], 3);
    let resized = inferay_presentation::project(
        "workspaceDock",
        &serde_json::json!({
            "saved":first["saved"], "action":{"type":"resize","path":[],"ratio":0.7},
            "ids":["a","b","c"],"columns":3,"mode":"grid","visibleColumns":3,
        }),
    )
    .unwrap();
    assert_eq!(resized["tree"]["ratio"], 0.7);
    let restored = inferay_presentation::project("workspaceDock", &serde_json::json!({
        "saved":resized["saved"],"ids":["a","b","c"],"columns":3,"mode":"grid","visibleColumns":3,
    })).unwrap();
    assert_eq!(resized, restored);
    let narrow = inferay_presentation::project("workspaceDock", &serde_json::json!({
        "saved":resized["saved"],"ids":["a","b","c"],"columns":3,"mode":"grid","visibleColumns":1,
    })).unwrap();
    assert_eq!(narrow["horizontal"], 1);
    assert_eq!(narrow["vertical"], 3);
    assert_eq!(narrow["saved"], resized["saved"]);
    let changed = inferay_presentation::project(
        "workspaceDock",
        &serde_json::json!({
            "saved":resized["saved"],"ids":["a","d"],"columns":3,"mode":"grid","visibleColumns":3,
        }),
    )
    .unwrap();
    assert_eq!(changed["tree"]["first"]["id"], "a");
    assert_eq!(changed["tree"]["second"]["id"], "d");
    assert!(
        inferay_presentation::project("workspaceDock", &serde_json::json!({"ids":[5]})).is_err()
    );
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
            let layout = project("workspaceDock", &input).unwrap();
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
            let repeated = project("workspaceDock", &repeat_input).unwrap();
            // Persisted geometry projects to the same padded rows on subsequent renders.
            assert_eq!(repeated["tree"], layout["tree"]);
            saved = layout["saved"].clone();
        }
    }
}

#[test]
fn grid_resize_paths_remain_valid_inside_partial_rows() {
    let input = json!({"ids":["a","b","c","d","e"],"columns":3,"mode":"grid"});
    let layout = project("workspaceDock", &input).unwrap();
    let resized = project("workspaceDock", &json!({"ids":input["ids"],"columns":3,"mode":"grid","saved":layout["saved"],"action":{"type":"resize","path":["second","first"],"ratio":0.6}})).unwrap();
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
