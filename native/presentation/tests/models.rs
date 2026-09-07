use inferay_presentation::{panels, project, transcript::ChatReplica};
use serde_json::{Value, json};
fn render(op: &str, input: Value) -> Value {
    project(op, &input).unwrap()
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
            "decoratedTokens",
            json!({"text":"🦀 /REVIEW a/b @docs/🦀.md /unknown","commands":["review"]})
        ),
        json!([{"start":3,"end":10},{"start":15,"end":26}])
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
            json!({"files":files,"current":2,"direction":1,"repeatBoundary":false})
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
    assert_eq!(result["messages"][0]["content"], "Hi there");
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
fn liquid_morphs_settle_after_irregular_frames() {
    let mut body = inferay_presentation::liquid::LiquidBody::new();
    let mut settled = false;
    for index in 0..300 {
        let tick=serde_json::from_value(json!({"frame":{"x":if index==0{0}else{100},"y":0,"w":if index==0{40}else{200},"h":40},"dt":0.1,"now":100+index*100,"radius":20,"dynamics":{"evolve":true}})).unwrap();
        let frame = body.advance(tick);
        assert!(frame.paint.w.parse::<f64>().unwrap().is_finite());
        settled = frame.settled;
    }
    assert!(settled);
}
