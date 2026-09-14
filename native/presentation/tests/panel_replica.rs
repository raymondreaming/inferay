use inferay_presentation::panels::{PanelReplica, normalize};
use serde_json::{Value, json};

fn select(replica: &mut PanelReplica, sequence: u32, id: &str) -> Value {
    let action = json!({"type":"selectGraph","id":id,"orderedIds":[]}).to_string();
    let current = replica
        .load("repo", u32::MAX, &normalize(&Value::Null).to_string())
        .unwrap();
    let result: Value = serde_json::from_str(
        &replica
            .preview("repo", &action, sequence as f64, &current)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(result["sequence"], sequence);
    result["session"].clone()
}
fn settle(replica: &mut PanelReplica, sequence: u32, session: Option<Value>) -> Value {
    serde_json::from_str(
        &replica
            .settle("repo", sequence, session.map(|s| s.to_string()))
            .unwrap(),
    )
    .unwrap()
}
fn load(replica: &mut PanelReplica, revision: u32) -> Value {
    serde_json::from_str(
        &replica
            .load("repo", revision, &normalize(&Value::Null).to_string())
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn acknowledgements_and_failures_preserve_newer_navigation() {
    let mut replica = PanelReplica::new();
    let first = select(&mut replica, 1, "a");
    select(&mut replica, 2, "b");
    let session = settle(&mut replica, 1, Some(first));
    assert_eq!(session["selectedCommitHash"], "b");
    let session = settle(&mut replica, 2, None);
    assert_eq!(session["selectedCommitHash"], "a");
}

#[test]
fn reads_started_before_a_save_cannot_replace_the_saved_session() {
    let mut replica = PanelReplica::new();
    let revision = replica.revision("repo");
    let first = select(&mut replica, 1, "a");
    settle(&mut replica, 1, Some(first));
    let session = load(&mut replica, revision);
    assert_eq!(session["selectedCommitHash"], "a");
}

#[test]
fn failed_pending_actions_roll_back_and_reads_replay_pending_actions() {
    let mut replica = PanelReplica::new();
    select(&mut replica, 1, "a");
    select(&mut replica, 2, "b");
    let session = load(&mut replica, 0);
    assert_eq!(session["selectedCommitHash"], "b");
    settle(&mut replica, 1, None);
    let session = settle(&mut replica, 2, None);
    assert!(session["selectedCommitHash"].is_null());
}
