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
fn a_fresh_install_starts_at_the_first_step_and_finishes_once() {
    let first = tour(Value::Null, json!({}));
    assert_eq!(first["active"], true);
    assert_eq!(first["step"]["id"], "repository");
    assert_eq!(first["position"], 1);
    assert_eq!(first["step"]["card"], false);
    assert_eq!(first["step"]["sidebar"], false);
    assert_eq!(first["step"]["changes"], false);
    assert_eq!(first["step"]["graph"], false);
    let chat = tour(
        json!({"status":"running","step":"chat"}),
        json!({"repositoryChosen":true}),
    );
    assert_eq!(chat["step"]["card"], false);
    assert_eq!(chat["step"]["placeholder"], "Send your first message");
    assert_eq!(
        tour(
            json!({"status":"running","step":"newChat"}),
            json!({"repositoryChosen":true,"hasMessage":true})
        )["step"]["sidebar"],
        true
    );
    assert_eq!(
        tour(
            json!({"status":"running","step":"newChat"}),
            json!({"repositoryChosen":true,"hasMessage":true})
        )["step"]["graph"],
        false
    );

    let mut progress = advance(Value::Null, "next");
    assert_eq!(progress["status"], "running");
    assert_eq!(progress["step"], "chat");
    assert_eq!(progress["visited"], json!(["repository"]));

    let total = first["total"].as_u64().unwrap() as usize;
    for _ in 1..total {
        progress = advance(progress, "next");
    }
    assert_eq!(progress["status"], "done");
    assert_eq!(progress["step"], "graphPanel");
    assert_eq!(tour(progress.clone(), json!({}))["active"], false);
    assert_eq!(tour(progress, json!({}))["step"], Value::Null);
}

#[test]
fn a_step_waits_for_its_task_and_offers_the_action_until_it_is_done() {
    let waiting = tour(json!({"status":"running","step":"repository"}), json!({}));
    assert_eq!(waiting["step"]["task"], "Choose a folder to continue");
    assert_eq!(waiting["step"]["taskDone"], false);
    assert_eq!(waiting["step"]["canAdvance"], false);

    let satisfied = tour(
        json!({"status":"running","step":"repository"}),
        json!({"repositoryChosen":true}),
    );
    assert_eq!(satisfied["step"]["taskDone"], true);
    assert_eq!(satisfied["step"]["canAdvance"], true);
    assert_eq!(satisfied["step"]["action"], Value::Null);

    let opened = tour(
        json!({"status":"running","step":"graphPanel"}),
        json!({"repositoryChosen":true,"hasMessage":true,"secondChat":true,
            "changesVisible":true,"graphOpen":true}),
    );
    assert_eq!(opened["step"]["taskDone"], true);
    assert_eq!(opened["step"]["canAdvance"], true);
    assert_eq!(opened["step"]["last"], true);
}

#[test]
fn undoing_a_setup_step_returns_the_tour_to_it() {
    let chosen = json!({"repositoryChosen":true});
    let on_chat = json!({"status":"running","step":"chat","visited":["repository"]});
    assert_eq!(tour(on_chat.clone(), chosen)["step"]["id"], "chat");
    assert_eq!(tour(on_chat, json!({}))["step"]["id"], "repository");

    let teaching = json!({"status":"running","step":"graphPanel","visited":[]});
    assert_eq!(tour(teaching, json!({}))["step"]["id"], "repository");
    let late = json!({"status":"running","step":"graphPanel","visited":[]});
    assert_eq!(
        tour(
            late,
            json!({"repositoryChosen":true,"hasMessage":true,"secondChat":true,"changesVisible":true})
        )["step"]["id"],
        "graphPanel"
    );
}

#[test]
fn skipping_ends_the_tour_and_restarting_replays_it_from_the_beginning() {
    let skipped = advance(json!({"status":"running","step":"chat"}), "skip");
    assert_eq!(skipped["status"], "skipped");
    assert_eq!(tour(skipped.clone(), json!({}))["active"], false);

    let replayed = advance(skipped, "restart");
    assert_eq!(replayed["status"], "running");
    assert_eq!(replayed["step"], "repository");
    assert_eq!(tour(replayed.clone(), json!({}))["active"], true);

    let back = advance(replayed, "back");
    assert_eq!(back["step"], "repository");

    let unknown = tour(json!({"status":"running","step":"removed"}), json!({}));
    assert_eq!(unknown["step"]["id"], "repository");
}

#[test]
fn saved_progress_answers_what_the_workspace_should_show() {
    let chrome = |progress: Value| project("onboardingChrome", &json!({"progress":progress})).unwrap();
    assert_eq!(
        chrome(json!({"status":"running","step":"chat"})),
        json!({"sidebar":false,"changes":false,"graph":false})
    );
    assert_eq!(
        chrome(json!({"status":"running","step":"changesPanel"})),
        json!({"sidebar":null,"changes":null,"graph":false})
    );
    assert_eq!(
        chrome(json!({"status":"done","step":"chat"})),
        json!({"sidebar":null,"changes":null,"graph":null})
    );
}

#[test]
fn a_callout_prefers_its_side_then_flips_and_clamps_inside_the_viewport() {
    let place = |anchor: Value, placement: &str| {
        project(
            "onboardingCallout",
            &json!({"anchor":anchor,"placement":placement,
                "card":{"width":320,"height":200},"viewport":{"width":1200,"height":800}}),
        )
        .unwrap()
    };
    let right = place(json!({"x":40,"y":300,"width":200,"height":120}), "right");
    assert_eq!(right["side"], "right");
    assert_eq!(right["card"]["x"], 260.0);
    assert_eq!(right["spotlight"], json!({"x":34.0,"y":294.0,"width":212.0,"height":132.0}));

    let flipped = place(json!({"x":40,"y":300,"width":200,"height":120}), "left");
    assert_eq!(flipped["side"], "right");

    let tight = project(
        "onboardingCallout",
        &json!({"anchor":{"x":100,"y":100,"width":80,"height":28},"placement":"bottom","tight":true,
            "card":{"width":320,"height":200},"viewport":{"width":1200,"height":800}}),
    )
    .unwrap();
    assert_eq!(
        tight["spotlight"],
        json!({"x":100.0,"y":100.0,"width":80.0,"height":28.0})
    );

    let over = place(json!({"x":600,"y":100,"width":500,"height":600}), "over");
    assert_eq!(over["side"], "center");
    assert_eq!(over["arrow"], Value::Null);
    assert_eq!(over["card"]["x"], 690.0);
    assert_eq!(over["card"]["y"], 300.0);
    assert!(over["spotlight"].is_object());

    let edge = place(json!({"x":0,"y":0,"width":260,"height":800}), "right");
    assert_eq!(
        edge["spotlight"],
        json!({"x":0.0,"y":0.0,"width":266.0,"height":800.0})
    );

    let clamped = place(json!({"x":1100,"y":20,"width":80,"height":40}), "bottom");
    assert_eq!(clamped["side"], "bottom");
    assert_eq!(clamped["card"]["x"], 864.0);
    assert_eq!(clamped["arrow"]["x"], 276.0);

    let centered = project(
        "onboardingCallout",
        &json!({"anchor":Value::Null,"placement":"center",
            "card":{"width":320,"height":200},"viewport":{"width":1200,"height":800}}),
    )
    .unwrap();
    assert_eq!(centered["side"], "center");
    assert_eq!(centered["card"]["x"], 440.0);
    assert_eq!(centered["spotlight"], Value::Null);
}
