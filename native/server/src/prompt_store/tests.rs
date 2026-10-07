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

#[test]
fn global_skills_migrate_once_and_survive_project_database_removal() {
    let root = tempfile::tempdir().unwrap();
    let prompt = Prompt::custom(
        json!({"name":"Research","command":"research","promptTemplate":"Read the sources"})
            .as_object()
            .unwrap(),
        42,
    )
    .unwrap();
    let db = crate::project_store::open_database(root.path()).unwrap();
    db.execute("INSERT INTO resources(id,project_id,type_id,name,revision) VALUES(?,NULL,'inferay.skill',?,1)", rusqlite::params![prompt.id, prompt.name]).unwrap();
    db.execute(
        "INSERT INTO resource_revisions VALUES(?,1,1,?,'legacy',42)",
        rusqlite::params![prompt.id, serde_json::to_string(&prompt).unwrap()],
    )
    .unwrap();
    db.execute("INSERT INTO project_migrations VALUES('skills-v1',42)", [])
        .unwrap();
    let store = PromptStore::new(
        root.path().join("bundled.json"),
        root.path().join("prompts.json"),
    );
    store.migrate().unwrap();
    assert_eq!(store.load().unwrap()[0].id, prompt.id);
    store.delete(&prompt.id).unwrap();
    store.migrate().unwrap();
    assert!(
        store.load().unwrap().is_empty(),
        "old source must not resurrect deleted skills"
    );
    let saved = store
        .create(
            json!({"name":"New skill","command":"new","promptTemplate":"Work"})
                .as_object()
                .unwrap(),
            43,
        )
        .unwrap();
    drop(db);
    std::fs::remove_file(root.path().join("projects.sqlite3")).unwrap();
    let loaded = store.load().unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, saved.id);
    assert!(!root.path().join("projects.sqlite3").exists());
}
