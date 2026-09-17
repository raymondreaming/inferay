use inferay_presentation::project;
use serde_json::{Value, json};

fn tour(progress: Value, facts: Value) -> Value {
    project("onboardingTour", &json!({"progress":progress,"facts":facts})).unwrap()
}

fn advance(progress: Value, action: &str) -> Value {
    project(
        "onboardingAdvance",
        &json!({"progress":progress,"action":action}),
    )
    .unwrap()
}

#[test]
fn the_tour_runs_only_once_it_has_been_started() {
    assert_eq!(tour(Value::Null, json!({}))["active"], false);
    assert_eq!(tour(Value::Null, json!({}))["step"], Value::Null);

    let started = advance(Value::Null, "start");
    assert_eq!(started, json!({"status":"running","step":"repository"}));
    let first = tour(started.clone(), json!({}));
    assert_eq!(first["active"], true);
    assert_eq!(first["step"]["task"], "Choose a folder to continue");
    assert_eq!(first["step"]["taskDone"], false);

    let dismissed = advance(Value::Null, "dismiss");
    assert_eq!(dismissed["status"], "done");
    assert_eq!(tour(dismissed, json!({}))["active"], false);
}

#[test]
fn a_step_waits_for_the_app_to_show_its_result_and_hands_back_on_undo() {
    let chosen = json!({"repositoryChosen":true});
    let on_repository = json!({"status":"running","step":"repository"});
    assert_eq!(tour(on_repository.clone(), chosen.clone())["step"]["taskDone"], true);

    let next = advance(on_repository, "next");
    assert_eq!(next["step"], "chat");
    let chat = tour(next.clone(), chosen);
    assert_eq!(chat["step"]["id"], "chat");
    assert_eq!(chat["step"]["placeholder"], "Send your first message");

    assert_eq!(tour(next.clone(), json!({}))["step"]["id"], "repository");
    assert_eq!(advance(next, "next")["status"], "done");
}

#[test]
fn saved_progress_answers_what_the_workspace_should_show() {
    let chrome =
        |progress: Value| project("onboardingChrome", &json!({"progress":progress})).unwrap();
    assert_eq!(
        chrome(json!({"status":"running","step":"chat"})),
        json!({"sidebar":false,"changes":false,"graph":false})
    );
    assert_eq!(
        chrome(json!({"status":"done","step":"chat"})),
        json!({"sidebar":null,"changes":null,"graph":null})
    );
    assert_eq!(
        chrome(Value::Null),
        json!({"sidebar":null,"changes":null,"graph":null})
    );
}

#[test]
fn a_spotlight_pads_its_anchor_and_stops_at_the_window_edge() {
    let spotlight = |anchor: Value| {
        project(
            "onboardingSpotlight",
            &json!({"anchor":anchor,"viewport":{"width":1200,"height":800}}),
        )
        .unwrap()
    };
    assert_eq!(
        spotlight(json!({"x":40,"y":300,"width":200,"height":120})),
        json!({"x":34.0,"y":294.0,"width":212.0,"height":132.0})
    );
    assert_eq!(
        spotlight(json!({"x":0,"y":0,"width":260,"height":800})),
        json!({"x":0.0,"y":0.0,"width":266.0,"height":800.0})
    );
    assert_eq!(spotlight(json!({"x":0,"y":0,"width":0,"height":0})), Value::Null);
}
