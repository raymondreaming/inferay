use super::*;
use crate::project_store::ProjectStore;
use serde_json::json;

fn command(store: &mut ProjectStore, value: Value) -> Value {
    store
        .command(serde_json::from_value(value).unwrap(), true, &[])
        .unwrap()
}

#[test]
fn file_scheduler_deduplicates_due_runs_and_rechecks_waiting_inputs() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let project = command(
        &mut store,
        json!({"type":"saveProject","name":"Schedule","description":"","instructions":""}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let automation = command(
        &mut store,
        json!({"type":"createExample","projectId":project}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    export(&mut store.db, root.path(), &[]).unwrap();
    replace_definition_tables(&mut store.db).unwrap();
    crate::project_index::refresh(&mut store.db, root.path(), &BTreeSet::new()).unwrap();
    let inputs =
        crate::project_index::execution_inputs(&store.db, root.path(), &automation, &[]).unwrap();
    crate::project_index::approve_automation(
        &store.db,
        root.path(),
        &automation,
        &hash(&serde_json::to_vec(&inputs).unwrap()),
        true,
        &[],
    )
    .unwrap();
    let time = now();
    store
        .db
        .execute("UPDATE automation_state SET next_due_at=?", [time - 1000])
        .unwrap();
    crate::project_runs::schedule_due(&mut store.db, root.path(), &[], time).unwrap();
    crate::project_runs::schedule_due(&mut store.db, root.path(), &[], time).unwrap();
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM runs WHERE status='queued'", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(
        store
            .db
            .query_row("SELECT next_due_at FROM automation_state", [], |r| r
                .get::<_, i64>(0))
            .unwrap()
            > time
    );
    // Turning off a schedule also prevents its already queued occurrence from
    // starting. A later direct Run now remains a separate user action.
    crate::project_index::disable_automation(&store.db, &automation).unwrap();
    assert!(
        crate::project_runs::claim_next(&mut store.db, root.path(), &[])
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT status FROM runs", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "failed"
    );
    crate::project_index::approve_automation(
        &store.db,
        root.path(),
        &automation,
        &hash(&serde_json::to_vec(&inputs).unwrap()),
        true,
        &[],
    )
    .unwrap();
    crate::project_runs::prepare_file_run(
        &store.db,
        root.path(),
        &automation,
        "second-occurrence",
        Some(time),
        None,
        &[],
    )
    .unwrap();
    let directory = root.path().join("projects").join(project);
    files::write(
        &directory,
        &format!("plugins/automation-{automation}/helper.py"),
        b"print('changed while queued')",
        None,
    )
    .unwrap();
    assert!(
        crate::project_runs::claim_next(&mut store.db, root.path(), &[])
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT status FROM runs WHERE request_key='second-occurrence'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "failed"
    );
    let state: (bool, Option<i64>) = store
        .db
        .query_row(
            "SELECT enabled,next_due_at FROM automation_state",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(state, (false, None));
    crate::project_runs::schedule_due(&mut store.db, root.path(), &[], time + 86400000).unwrap();
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM runs", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[test]
fn handover_removes_definition_ownership_and_preserves_runtime_relations() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    assert!(replace_definition_tables(&mut store.db).is_err());
    let project = command(
        &mut store,
        json!({"type":"saveProject","name":"History","description":"","instructions":""}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let automation = command(
        &mut store,
        json!({"type":"createExample","projectId":project}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let run = command(
        &mut store,
        json!({"type":"runAutomation","id":automation,"requestId":"preserved"}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    store
        .db
        .execute(
            "INSERT INTO artifacts VALUES('artifact',?,?,'Report','report.txt',3,'hash',1)",
            rusqlite::params![project, run],
        )
        .unwrap();
    store
        .db
        .execute(
            "INSERT INTO project_conversations VALUES('pane',?)",
            [&project],
        )
        .unwrap();
    export(&mut store.db, root.path(), &[]).unwrap();
    replace_definition_tables(&mut store.db).unwrap();
    replace_definition_tables(&mut store.db).unwrap();
    assert_eq!(
        store
            .db
            .query_row("SELECT status FROM runs WHERE id=?", [&run], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "interrupted"
    );
    crate::project_index::refresh(&mut store.db, root.path(), &BTreeSet::new()).unwrap();
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT count(*) FROM automations WHERE id=? AND valid=1",
                [&automation],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    use inferay_core::project_files::ProjectFileCommand;
    let review = crate::project_file_commands::apply(
        &mut store.db,
        root.path(),
        ProjectFileCommand::ReviewAutomation {
            id: automation.clone(),
        },
        false,
        &[],
    )
    .unwrap();
    let inputs = review["inputs"].clone();
    let approve = ProjectFileCommand::ApproveAutomation {
        id: automation.clone(),
        expected_inputs_hash: review["inputsHash"].as_str().unwrap().into(),
        enable: false,
    };
    assert!(
        crate::project_file_commands::apply(
            &mut store.db,
            root.path(),
            approve.clone(),
            false,
            &[]
        )
        .is_err()
    );
    crate::project_file_commands::apply(&mut store.db, root.path(), approve, true, &[]).unwrap();
    let retry = ProjectFileCommand::RetryRun {
        id: run.clone(),
        request_id: "after-migration".into(),
    };
    assert!(
        crate::project_file_commands::apply(&mut store.db, root.path(), retry.clone(), false, &[])
            .is_err()
    );
    let result =
        crate::project_file_commands::apply(&mut store.db, root.path(), retry.clone(), true, &[])
            .unwrap();
    let queued = result["id"].as_str().unwrap().to_owned();
    assert_eq!(
        result,
        crate::project_file_commands::apply(&mut store.db, root.path(), retry, true, &[]).unwrap()
    );
    let persisted: (String, String, Value) = store
        .db
        .query_row(
            "SELECT status,retry_of,snapshot FROM runs WHERE id=?",
            [&queued],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    serde_json::from_str(&r.get::<_, String>(2)?).unwrap(),
                ))
            },
        )
        .unwrap();
    assert_eq!(persisted, ("queued".into(), run.clone(), inputs));
    // Deleting every definition must leave evidence and conversation links intact.
    fs::remove_dir_all(root.path().join("projects").join(&project)).unwrap();
    crate::project_index::refresh(&mut store.db, root.path(), &BTreeSet::new()).unwrap();
    for (table, expected) in [
        ("runs", 2),
        ("run_events", 3),
        ("artifacts", 1),
        ("project_conversations", 1),
        ("automations", 0),
        ("projects", 0),
    ] {
        assert_eq!(
            store
                .db
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            expected,
            "{table}"
        );
    }
    assert_eq!(store.db.query_row("SELECT count(*) FROM sqlite_schema WHERE name IN ('resource_revisions','automation_approvals')", [], |r|r.get::<_,i64>(0)).unwrap(),0);
    assert!(
        store
            .db
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0))
            .unwrap()
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
    assert!(
        store
            .db
            .execute(
                "INSERT INTO run_events VALUES('missing',1,'bad','{}',1)",
                []
            )
            .is_err()
    );
}

#[test]
fn failed_handover_rolls_back_schema_and_restores_foreign_keys() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    export(&mut store.db, root.path(), &[]).unwrap();
    // Simulate old corrupt evidence: the migration must refuse it without
    // leaving half the schema converted or foreign-key checks disabled.
    store.db.pragma_update(None, "foreign_keys", false).unwrap();
    store
        .db
        .execute(
            "INSERT INTO run_events VALUES('missing',1,'bad','{}',1)",
            [],
        )
        .unwrap();
    store.db.pragma_update(None, "foreign_keys", true).unwrap();
    assert!(
        replace_definition_tables(&mut store.db)
            .unwrap_err()
            .to_string()
            .contains("integrity")
    );
    assert_eq!(
        store
            .db
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(
        store
            .db
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0))
            .unwrap()
    );
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='resource_revisions'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'migration_%'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM run_events", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
#[test]
fn export_preserves_ids_history_and_documents_and_disables_schedules() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let project = command(&mut store,json!({"type":"saveProject","name":"Research","description":"","instructions":"Read sources"}))["id"].as_str().unwrap().to_owned();
    let automation = command(
        &mut store,
        json!({"type":"createExample","projectId":project}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    command(
        &mut store,
        json!({"type":"enableAutomation","id":automation,"expectedRevision":1,"enabled":true}),
    );
    let run = command(
        &mut store,
        json!({"type":"runAutomation","id":automation,"requestId":"before-migration"}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let directory = store.project_dir(&project).unwrap();
    crate::project_store::write_file(&directory, "files/reference.md", "Reference", None).unwrap();
    export(&mut store.db, root.path(), &[]).unwrap();
    let backup = Connection::open(root.path().join("projects.pre-files.sqlite3")).unwrap();
    assert_eq!(
        backup
            .query_row("SELECT count(*) FROM runs WHERE id=?", [&run], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM runs WHERE id=?", [&run], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT enabled FROM automations WHERE id=?",
                [&automation],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM automation_approvals", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        fs::read_to_string(directory.join("resources/documents/reference.md")).unwrap(),
        "Reference"
    );
    let indexed = files::scan(&directory, &BTreeSet::new()).unwrap();
    assert!(indexed.iter().all(|f| f.error.is_none()), "{indexed:?}");
    assert!(
        indexed
            .iter()
            .any(|f| f.definition.as_ref().is_some_and(|d| d.id() == automation))
    );
    // Removing the marker simulates interruption after file publication but before commit.
    store
        .db
        .execute(
            "DELETE FROM project_migrations WHERE name='file-definitions-export-v1'",
            [],
        )
        .unwrap();
    export(&mut store.db, root.path(), &[]).unwrap();
    let second = files::scan(&directory, &BTreeSet::new()).unwrap();
    assert_eq!(
        indexed
            .iter()
            .map(|f| (&f.path, &f.hash))
            .collect::<Vec<_>>(),
        second
            .iter()
            .map(|f| (&f.path, &f.hash))
            .collect::<Vec<_>>()
    );
}
#[test]
fn migration_conflict_keeps_existing_bytes_and_legacy_rows() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let id = command(
        &mut store,
        json!({"type":"saveProject","name":"Original","description":"","instructions":""}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let directory = store.project_dir(&id).unwrap();
    fs::write(directory.join("project.json"), b"user data").unwrap();
    assert!(
        export(&mut store.db, root.path(), &[])
            .unwrap_err()
            .to_string()
            .contains("conflict")
    );
    assert_eq!(
        fs::read(directory.join("project.json")).unwrap(),
        b"user data"
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT name FROM projects WHERE id=?", [id], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "Original"
    );
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT count(*) FROM project_migrations WHERE name='file-definitions-export-v1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn installed_plugin_schema_and_source_manifest_survive_conversion() {
    let root = tempfile::tempdir().unwrap();
    let package = tempfile::tempdir().unwrap();
    let original = json!({"name":"Briefs","version":"1","types":[{"id":"studio.brief","version":2,"schema":{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}}],"resources":[{"typeId":"studio.brief","schemaVersion":2,"name":"Launch","body":{"title":"Hello"}}]}).to_string();
    fs::write(package.path().join("plugin.json"), &original).unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let project = command(
        &mut store,
        json!({"type":"saveProject","name":"Studio","description":"","instructions":""}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let plugin = command(
        &mut store,
        json!({"type":"installPlugin","projectId":project,"path":package.path()}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    export(&mut store.db, root.path(), &[]).unwrap();
    let directory = store.project_dir(&project).unwrap();
    assert_eq!(
        fs::read_to_string(directory.join(format!("plugins/{plugin}/.legacy-plugin.json")))
            .unwrap(),
        original
    );
    let indexed = files::scan(&directory, &BTreeSet::new()).unwrap();
    assert!(indexed.iter().all(|f| f.error.is_none()), "{indexed:?}");
    store
        .db
        .execute(
            "DELETE FROM project_migrations WHERE name='file-definitions-export-v1'",
            [],
        )
        .unwrap();
    export(&mut store.db, root.path(), &[]).unwrap();
}
