use super::*;
use serde_json::json;

#[test]
fn skill_changes_survive_reopening_and_proposals_write_only_on_approval() {
    let root = tempfile::tempdir().unwrap();
    let bundled = root.path().join("bundled.json");
    let local = root.path().join("local.json");
    let store = PromptStore::new(bundled.clone(), local.clone());
    let proposal = json!({"action":"create","name":"Review","command":"review","promptTemplate":"Inspect {args}"});
    store.proposal(&proposal, &Value::Null, None, 41).unwrap();
    assert!(!local.exists());
    let (_, rejected) = store
        .proposal(&proposal, &Value::Null, Some("reject"), 41)
        .unwrap();
    store
        .proposal(&proposal, &rejected.unwrap(), Some("approve"), 42)
        .unwrap();
    assert!(!local.exists());
    let (_, record) = store
        .proposal(&proposal, &Value::Null, Some("approve"), 42)
        .unwrap();
    let reopened = PromptStore::new(bundled, local.clone());
    let skills = reopened.load().unwrap();
    // Replaying a decision must not rewrite even an equivalent compact file.
    let saved = serde_json::to_vec(&skills).unwrap();
    std::fs::write(&local, &saved).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(
        reopened
            .expand_chat_command_chain("/review", Some(&skills[0].id), Some("changes"))
            .unwrap()[0]
            .text,
        "Inspect changes"
    );
    reopened
        .proposal(&proposal, &record.unwrap(), Some("approve"), 43)
        .unwrap();
    assert_eq!(std::fs::read(&local).unwrap(), saved);
    reopened
        .update(
            &skills[0].id,
            json!({"name":"Updated"}).as_object().unwrap(),
            44,
        )
        .unwrap();
    assert_eq!(store.load().unwrap()[0].name, "Updated");
    reopened.delete(&skills[0].id).unwrap();
    assert!(store.load().unwrap().is_empty());
}

#[test]
fn corruption_cannot_be_overwritten_and_storage_free_decisions_still_work() {
    let root = tempfile::tempdir().unwrap();
    let local = root.path().join("local.json");
    std::fs::write(&local, b"invalid").unwrap();
    let store = PromptStore::new(root.path().join("bundled.json"), local.clone());
    let proposal =
        json!({"action":"create","name":"Review","command":"review","promptTemplate":"Inspect"});
    assert!(store.create(proposal.as_object().unwrap(), 42).is_err());
    assert!(
        store
            .proposal(&proposal, &Value::Null, Some("approve"), 42)
            .is_err()
    );
    assert_eq!(std::fs::read(&local).unwrap(), b"invalid");
    assert_eq!(
        store
            .create(json!({}).as_object().unwrap(), 42)
            .unwrap_err()
            .status,
        400
    );
    assert_eq!(
        store
            .proposal(&Value::Null, &Value::Null, None, 42)
            .unwrap_err()
            .status,
        400
    );
    store.proposal(&proposal, &Value::Null, None, 42).unwrap();
    let (_, record) = store
        .proposal(&proposal, &Value::Null, Some("reject"), 42)
        .unwrap();
    store
        .proposal(&proposal, &record.unwrap(), Some("approve"), 43)
        .unwrap();
    assert!(
        store
            .call_tool("unknown", &Value::Null)
            .unwrap_err()
            .starts_with("Unknown Inferay tool:")
    );
    assert_eq!(std::fs::read(&local).unwrap(), b"invalid");
}
