mod support;
use serde_json::{Value, json};
use support::project;

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
