use super::*;
use rusqlite::params;
use serde_json::json;
use std::path::PathBuf;

struct LegacyFixture {
    db: Connection,
    root: PathBuf,
}
impl LegacyFixture {
    fn open(root: &Path) -> Self {
        Self {
            db: crate::project_store::open_database(root).unwrap(),
            root: root.canonicalize().unwrap(),
        }
    }
    fn project_dir(&self, id: &str) -> PathBuf {
        self.root.join("projects").join(id)
    }
    fn project(&self, name: &str, instructions: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.db
            .execute(
                "INSERT INTO projects VALUES(?,?, '',?,1,1,1,0)",
                params![id, name, instructions],
            )
            .unwrap();
        for child in ["files", "tools", "plugins"] {
            fs::create_dir_all(self.project_dir(&id).join(child)).unwrap();
        }
        id
    }
    fn automation(&self, project: &str) -> String {
        let tool = uuid::Uuid::new_v4().to_string();
        let id = uuid::Uuid::new_v4().to_string();
        fs::write(
            self.project_dir(project).join("tools/report.py"),
            "print('{}')",
        )
        .unwrap();
        let body = json!({"program":"python3","entrypoint":{"base":"project","path":"tools/report.py"},"arguments":[],"timeoutSeconds":30,"inputSchema":{"type":"object"},"outputSchema":{"type":"object"}}).to_string();
        self.db
            .execute(
                "INSERT INTO resources VALUES(?,?,'inferay.tool','Report',1,NULL,0)",
                params![tool, project],
            )
            .unwrap();
        self.db
            .execute(
                "INSERT INTO resource_revisions VALUES(?,1,1,?,?,1)",
                params![tool, body, hash(body.as_bytes())],
            )
            .unwrap();
        let execution = json!({"kind":"tool","toolId":tool,"input":{}}).to_string();
        self.db.execute("INSERT INTO automations(id,project_id,name,revision,execution,interval_seconds,overlap_policy) VALUES(?,?,'Report',1,?,604800,'skip')",params![id,project,execution]).unwrap();
        id
    }
    fn run(&self, automation: &str, key: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.db.execute("INSERT INTO runs(id,project_id,automation_id,name,request_key,status,snapshot,input_hash,requested_at) SELECT ?,project_id,id,name,?,'queued','{}','legacy-hash',1 FROM automations WHERE id=?",params![id,key,automation]).unwrap();
        self.db
            .execute("INSERT INTO run_events VALUES(?,1,'queued','{}',1)", [&id])
            .unwrap();
        id
    }
}

#[test]
fn file_scheduler_deduplicates_due_runs_and_rechecks_waiting_inputs() {
    let root = tempfile::tempdir().unwrap();
    let mut store = LegacyFixture::open(root.path());
    let project = store.project("Schedule", "");
    let automation = store.automation(&project);
    export(&mut store.db, root.path(), &[]).unwrap();
    replace_definition_tables(&mut store.db).unwrap();
    crate::project_index::refresh(&mut store.db, root.path(), &[]).unwrap();
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
    let mut store = LegacyFixture::open(root.path());
    assert!(replace_definition_tables(&mut store.db).is_err());
    let project = store.project("History", "");
    let automation = store.automation(&project);
    let run = store.run(&automation, "preserved");
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
    crate::project_index::refresh(&mut store.db, root.path(), &[]).unwrap();
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
    fs::remove_dir_all(root.path().join("projects").join(&project)).unwrap();
    crate::project_index::refresh(&mut store.db, root.path(), &[]).unwrap();
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
    let mut store = LegacyFixture::open(root.path());
    export(&mut store.db, root.path(), &[]).unwrap();
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
    let mut store = LegacyFixture::open(root.path());
    let project = store.project("Research", "Read sources");
    let automation = store.automation(&project);
    store
        .db
        .execute(
            "UPDATE automations SET enabled=1,next_due_at=1 WHERE id=?",
            [&automation],
        )
        .unwrap();
    store
        .db
        .execute(
            "INSERT INTO automation_approvals VALUES(?,'legacy-approved',1)",
            [&automation],
        )
        .unwrap();
    let run = store.run(&automation, "before-migration");
    let directory = store.project_dir(&project);
    fs::write(directory.join("files/reference.md"), "Reference").unwrap();
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
        fs::read_to_string(directory.join("memory/documents/reference.md")).unwrap(),
        "Reference"
    );
    let indexed = files::scan(&directory, &BTreeSet::new()).unwrap();
    assert!(indexed.iter().all(|f| f.error.is_none()), "{indexed:?}");
    assert!(
        indexed
            .iter()
            .any(|f| f.definition.as_ref().is_some_and(|d| d.id() == automation))
    );
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
    let mut store = LegacyFixture::open(root.path());
    let id = store.project("Original", "");
    let directory = store.project_dir(&id);
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
    let original = json!({"name":"Briefs","version":"1","types":[{"id":"studio.brief","version":2,"schema":{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}}],"resources":[{"typeId":"studio.brief","schemaVersion":2,"name":"Launch","body":{"title":"Hello"}}]}).to_string();
    let mut store = LegacyFixture::open(root.path());
    let project = store.project("Studio", "");
    let plugin = uuid::Uuid::new_v4().to_string();
    let directory = store.project_dir(&project).join("plugins").join(&plugin);
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("plugin.json"), &original).unwrap();
    store
        .db
        .execute(
            "INSERT INTO plugins VALUES(?,?,'Briefs','1',?,?,0)",
            params![
                plugin,
                project,
                directory.to_string_lossy(),
                hash(original.as_bytes())
            ],
        )
        .unwrap();
    let schema =
        json!({"type":"object","required":["title"],"properties":{"title":{"type":"string"}}})
            .to_string();
    store
        .db
        .execute(
            "INSERT INTO resource_types VALUES('studio.brief',2,?,?)",
            params![plugin, schema],
        )
        .unwrap();
    let resource = uuid::Uuid::new_v4().to_string();
    store
        .db
        .execute(
            "INSERT INTO resources VALUES(?,?,'studio.brief','Launch',1,?,0)",
            params![resource, project, plugin],
        )
        .unwrap();
    let body = json!({"title":"Hello"}).to_string();
    store
        .db
        .execute(
            "INSERT INTO resource_revisions VALUES(?,1,2,?,?,1)",
            params![resource, body, hash(body.as_bytes())],
        )
        .unwrap();
    export(&mut store.db, root.path(), &[]).unwrap();
    let directory = store.project_dir(&project);
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

#[test]
fn workspace_chats_migrate_once_and_keep_existing_associations() {
    let profile = tempfile::tempdir().unwrap();
    let repository = tempfile::tempdir().unwrap();
    let mut store = crate::project_file_store::FileProjectStore::open(profile.path(), &[]).unwrap();
    let state = json!({"groups":[{"panes":[{"id":"first","cwd":repository.path()},{"id":"second","cwd":repository.path()}]}]});
    workspace_projects(&mut store.db, profile.path(), &state, &[]).unwrap();
    let catalog = store.catalog(None, &[]).unwrap();
    assert_eq!(catalog.projects.len(), 1);
    let project = &catalog.projects[0].id;
    let definition = fs::read(
        profile
            .path()
            .join("projects")
            .join(project)
            .join("project.json"),
    )
    .unwrap();
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT count(*) FROM project_conversations WHERE project_id=?",
                [project],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    workspace_projects(&mut store.db, profile.path(), &state, &[]).unwrap();
    assert_eq!(store.catalog(None, &[]).unwrap().projects.len(), 1);
    store
        .db
        .execute(
            "DELETE FROM project_migrations WHERE name='repositories-v1'",
            [],
        )
        .unwrap();
    let updated = json!({"groups":[{"panes":[{"id":"first","cwd":"/different/repo"},{"id":"third","cwd":repository.path()}]}]});
    workspace_projects(&mut store.db, profile.path(), &updated, &[]).unwrap();
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT count(*) FROM project_conversations WHERE project_id=?",
                [project],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        3
    );
    assert_eq!(
        fs::read(
            profile
                .path()
                .join("projects")
                .join(project)
                .join("project.json")
        )
        .unwrap(),
        definition
    );
    assert_eq!(store.catalog(None, &[]).unwrap().projects.len(), 1);
}

#[test]
fn workspace_migration_preserves_conflicting_files_without_marking_complete() {
    let profile = tempfile::tempdir().unwrap();
    let repository = tempfile::tempdir().unwrap();
    let mut store = crate::project_file_store::FileProjectStore::open(profile.path(), &[]).unwrap();
    let key = repository
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let id = derived_id("workspace-project", &key);
    let directory = profile.path().join("projects").join(id);
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("project.json"), b"existing user file").unwrap();
    let state = json!({"groups":[{"panes":[{"id":"first","cwd":repository.path()}]}]});
    assert!(
        workspace_projects(&mut store.db, profile.path(), &state, &[])
            .unwrap_err()
            .to_string()
            .contains("conflict")
    );
    assert_eq!(
        fs::read(directory.join("project.json")).unwrap(),
        b"existing user file"
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM project_conversations", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT count(*) FROM project_migrations WHERE name='repositories-v1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn legacy_repository_context_migrates_as_repository_not_missing_resource() {
    let root = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let mut legacy = LegacyFixture::open(root.path());
    let project = legacy.project("Research", "");
    let repository = uuid::Uuid::new_v4().to_string();
    let automation = uuid::Uuid::new_v4().to_string();
    let body =
        json!({"location":{"base":"external","path":repo.path()},"instructions":""}).to_string();
    legacy
        .db
        .execute(
            "INSERT INTO resources VALUES(?,?,'inferay.repository','Research repository',1,NULL,0)",
            params![repository, project],
        )
        .unwrap();
    legacy
        .db
        .execute(
            "INSERT INTO resource_revisions VALUES(?,1,1,?,?,1)",
            params![repository, body, hash(body.as_bytes())],
        )
        .unwrap();
    let execution = json!({"kind":"agent","instructions":"Review recent changes","provider":"codex","model":null,"resourceIds":[repository],"workingDirectory":{"base":"external","path":repo.path()},"timeoutSeconds":300}).to_string();
    legacy.db.execute("INSERT INTO automations(id,project_id,name,revision,execution,interval_seconds,overlap_policy) VALUES(?,?,'Daily research',1,?,86400,'skip')",params![automation,project,execution]).unwrap();
    export(&mut legacy.db, root.path(), &[]).unwrap();
    replace_definition_tables(&mut legacy.db).unwrap();
    crate::project_index::refresh(&mut legacy.db, root.path(), &[]).unwrap();
    let catalog = crate::project_index::catalog(&legacy.db, Some(&project)).unwrap();
    assert!(catalog.issues.is_empty(), "{:?}", catalog.issues);
    let migrated = &catalog.automations[0];
    assert!(!migrated.enabled);
    assert!(migrated.file.error.is_none());
    let definition = migrated.file.definition.as_ref().unwrap();
    assert_eq!(definition.id, automation);
    let DefinitionExecution::Agent {
        resources,
        repositories,
        working_directory,
        ..
    } = &definition.execution
    else {
        panic!("expected agent")
    };
    assert!(resources.is_empty());
    assert_eq!(repositories, std::slice::from_ref(&repository));
    assert!(
        matches!(working_directory, DefinitionDirectory::Repository { id } if id == &repository)
    );
}
