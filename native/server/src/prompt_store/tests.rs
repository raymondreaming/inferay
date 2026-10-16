use super::*;
use serde_json::json;

#[test]
fn corrupt_import_is_preserved_and_can_be_repaired() {
    let root = tempfile::tempdir().unwrap();
    let local = root.path().join("local.json");
    let bundled = root.path().join("bundled.json");
    std::fs::write(&local, b"invalid").unwrap();
    assert!(PromptStore::open(bundled.clone(), local.clone()).is_err());
    assert_eq!(std::fs::read(&local).unwrap(), b"invalid");
    std::fs::write(&local, b"[]").unwrap();
    assert!(
        PromptStore::open(bundled, local)
            .unwrap()
            .load()
            .unwrap()
            .is_empty()
    );
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
    let mut store = PromptStore::open(
        root.path().join("bundled.json"),
        root.path().join("prompts.json"),
    )
    .unwrap();
    assert_eq!(store.load().unwrap()[0].id, prompt.id);
    store.delete(&prompt.id).unwrap();
    drop(store);
    let mut store = PromptStore::open(
        root.path().join("bundled.json"),
        root.path().join("prompts.json"),
    )
    .unwrap();
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

#[test]
fn reads_see_commits_without_waiting_for_an_uncommitted_writer() {
    let root = tempfile::tempdir().unwrap();
    let store = PromptStore::open(
        root.path().join("bundled.json"),
        root.path().join("local.json"),
    )
    .unwrap();
    let writer = rusqlite::Connection::open(root.path().join("skills.sqlite3")).unwrap();
    writer.execute_batch("BEGIN IMMEDIATE").unwrap();
    let prompt = Prompt::custom(
        json!({"name":"Review","command":"review","promptTemplate":"Inspect"})
            .as_object()
            .unwrap(),
        42,
    )
    .unwrap();
    writer
        .execute(
            "INSERT INTO skills VALUES(?,?)",
            rusqlite::params![prompt.id, serde_json::to_string(&prompt).unwrap()],
        )
        .unwrap();
    // WAL readers see the previous committed state while the writer remains active.
    assert!(store.load().unwrap().is_empty());
    writer.execute_batch("COMMIT").unwrap();
    assert_eq!(store.load().unwrap()[0].id, prompt.id);
}
