use super::*;
use serde_json::json;

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
