use super::*;

fn fixture() -> (tempfile::TempDir, String, String) {
    let profile = tempfile::tempdir().unwrap();
    let project = uuid::Uuid::new_v4().to_string();
    let automation = uuid::Uuid::new_v4().to_string();
    let root = profile.path().join("projects").join(&project);
    fs::create_dir_all(&root).unwrap();
    for (path, value) in [
        (
            "project.json",
            json!({"schema":"inferay.project/1","id":project,"name":"Research","description":"","instructions":"","repositories":[]}),
        ),
        (
            "plugins/daily/plugin.json",
            json!({"schema":"inferay.plugin/1","id":uuid::Uuid::new_v4().to_string(),"name":"Daily","version":"1","description":"","may":[]}),
        ),
        (
            "plugins/daily/automations/daily.json",
            json!({"schema":"inferay.automation/1","id":automation,"name":"Daily","trigger":{"kind":"interval","seconds":86400},"overlap":"skip","execution":{"kind":"agent","provider":"codex","instructions":"Read sources","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300},"may":[]}),
        ),
    ] {
        files::write(&root, path, value.to_string().as_bytes(), None).unwrap();
    }
    (profile, project, automation)
}

// Standalone fixtures exercise the same transaction-bound approval operation.
fn approve_fixture(
    db: &Connection,
    profile: &Path,
    id: &str,
    expected: &str,
    enable: bool,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<()> {
    let tx = db.unchecked_transaction()?;
    approve(
        &tx,
        profile,
        Approval::Automation(id),
        expected,
        enable,
        skills,
    )?;
    tx.commit()?;
    Ok(())
}

#[test]
fn rebuild_restores_definitions_disabled_without_local_database() {
    let (profile, _, automation) = fixture();
    let path = profile.path().join("index.sqlite3");
    {
        let mut db = Connection::open(&path).unwrap();
        create_schema(&db).unwrap();
        refresh(&mut db, profile.path(), &[]).unwrap();
        db.execute(
            "UPDATE automation_state SET enabled=1,approved_hash='approved'",
            [],
        )
        .unwrap();
    }
    fs::remove_file(&path).unwrap();
    let mut db = Connection::open(&path).unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let restored: (String, bool, Option<String>) = db.query_row("SELECT json_extract(a.body,'$.name'),s.enabled,s.approved_hash FROM automations a JOIN automation_state s ON s.automation_id=a.id WHERE a.id=? AND a.valid=1", [&automation], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(restored, ("Daily".into(), false, None));
}

#[test]
fn invalid_and_deleted_files_replace_index_without_erasing_history_or_approval() {
    let (profile, project, automation) = fixture();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    db.execute_batch("CREATE TABLE runs(id TEXT PRIMARY KEY,automation_id TEXT,result TEXT);")
        .unwrap();
    db.execute(
        "INSERT INTO runs VALUES('run',?,'finished evidence')",
        [&automation],
    )
    .unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let view = catalog(&db, Some(&project)).unwrap();
    assert_eq!(view.projects.len(), 1);
    assert_eq!(
        view.automations[0].file.definition.as_ref().unwrap().name,
        "Daily"
    );
    assert!(view.issues.is_empty());
    let digest = hash(
        &serde_json::to_vec(&execution_inputs(&db, profile.path(), &automation, &[]).unwrap())
            .unwrap(),
    );
    approve_fixture(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    assert!(
        db.query_row("SELECT enabled FROM automation_state", [], |r| r
            .get::<_, bool>(0))
            .unwrap()
    );
    let path = profile
        .path()
        .join("projects")
        .join(&project)
        .join("plugins/daily/automations/daily.json");
    fs::write(&path, "{broken").unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let invalid = catalog(&db, Some(&project)).unwrap();
    assert!(invalid.automations[0].file.definition.is_none());
    assert!(invalid.automations[0].file.source_hash.is_some());
    assert!(
        invalid
            .issues
            .iter()
            .any(|issue| issue.source_path.ends_with("daily.json"))
    );
    assert!(!invalid.automations[0].enabled);
    assert!(catalog(&db, None).unwrap().automations.is_empty());
    let state: (bool, Option<i64>, String) = db
        .query_row(
            "SELECT enabled,next_due_at,approved_hash FROM automation_state WHERE automation_id=?",
            [&automation],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, (false, None, digest));
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM automations WHERE valid=0 AND error IS NOT NULL AND body IS NULL",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    fs::remove_file(&path).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM automations", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT result FROM runs WHERE id='run'", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "finished evidence"
    );
}

#[test]
fn companion_script_edit_invalidates_approved_package() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(project);
    files::write(
        &root,
        "plugins/daily/helpers/check.py",
        b"print('original')",
        None,
    )
    .unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let digest = hash(
        &serde_json::to_vec(&execution_inputs(&db, profile.path(), &automation, &[]).unwrap())
            .unwrap(),
    );
    approve_fixture(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    assert!(
        db.query_row("SELECT enabled FROM automation_state", [], |r| r
            .get::<_, bool>(0))
            .unwrap()
    );
    fs::write(
        root.join("plugins/daily/helpers/check.py"),
        "print('changed')",
    )
    .unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let state: (bool, bool, Option<i64>) = db
        .query_row(
            "SELECT enabled,inputs_changed,next_due_at FROM automation_state",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, (false, true, None));
}

#[test]
fn admission_reads_current_files_and_requires_repository_binding() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(&project);
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let before = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    files::write(
        &root,
        "plugins/daily/helper.py",
        b"print('new dependency')",
        None,
    )
    .unwrap();
    let after = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    assert_ne!(before["files"], after["files"]);
    let repository = uuid::Uuid::new_v4().to_string();
    let mut project_file: Value =
        serde_json::from_slice(&fs::read(root.join("project.json")).unwrap()).unwrap();
    project_file["repositories"] = json!([{"id":repository,"name":"Source"}]);
    fs::write(root.join("project.json"), project_file.to_string()).unwrap();
    let path = root.join("plugins/daily/automations/daily.json");
    let mut definition: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    definition["execution"]["workingDirectory"] = json!({"base":"repository","id":repository});
    fs::write(&path, definition.to_string()).unwrap();
    assert!(
        execution_inputs(&db, profile.path(), &automation, &[])
            .unwrap_err()
            .to_string()
            .contains("not linked")
    );
    let checkout = tempfile::tempdir().unwrap();
    db.execute(
        "INSERT INTO repository_paths VALUES(?,?,?)",
        params![project, repository, checkout.path().to_string_lossy()],
    )
    .unwrap();
    let linked = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    assert_eq!(
        linked["repositoryPaths"][&repository],
        checkout
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .as_ref()
    );
    fs::write(&path, "{broken").unwrap();
    assert!(execution_inputs(&db, profile.path(), &automation, &[]).is_err());
}

#[test]
fn definition_saves_validate_before_publication_and_refuse_stale_hashes() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(&project);
    let path = "plugins/daily/automations/daily.json";
    let original = fs::read(root.join(path)).unwrap();
    let original_hash = hash(&original);
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let mut definition: Value = serde_json::from_slice(&original).unwrap();
    definition["execution"]["skills"] = json!([uuid::Uuid::new_v4().to_string()]);
    assert!(
        save_definition(
            &mut db,
            profile.path(),
            &project,
            path,
            definition.to_string().as_bytes(),
            Some(&original_hash),
            &[]
        )
        .is_err()
    );
    assert_eq!(fs::read(root.join(path)).unwrap(), original);
    definition["execution"]["skills"] = json!([]);
    definition["name"] = json!("Updated daily");
    db.execute("UPDATE automation_state SET enabled=1", [])
        .unwrap();
    let saved = save_definition(
        &mut db,
        profile.path(),
        &project,
        path,
        definition.to_string().as_bytes(),
        Some(&original_hash),
        &[],
    )
    .unwrap();
    assert_ne!(saved, original_hash);
    let indexed: (String, String, bool) = db.query_row("SELECT json_extract(a.body,'$.name'),a.source_hash,s.enabled FROM automations a JOIN automation_state s ON s.automation_id=a.id WHERE a.id=?", [&automation], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(indexed, ("Updated daily".into(), saved, false));
    assert!(
        save_definition(
            &mut db,
            profile.path(),
            &project,
            path,
            &original,
            Some(&original_hash),
            &[]
        )
        .is_err()
    );
    assert_eq!(
        fs::read(root.join(path)).unwrap(),
        definition.to_string().as_bytes()
    );
}

#[test]
fn approval_rejects_stale_review_and_manual_runs_cannot_bypass_input_changes() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(project);
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let reviewed = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    let digest = hash(&serde_json::to_vec(&reviewed).unwrap());
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_err());
    approve_fixture(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
    assert_eq!(
        approved_inputs(&db, profile.path(), &automation, true, &[]).unwrap(),
        reviewed
    );
    disable_automation(&db, &automation).unwrap();
    assert!(approved_inputs(&db, profile.path(), &automation, true, &[]).is_err());
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_ok());
    files::write(&root, "plugins/daily/helper.py", b"print('changed')", None).unwrap();
    assert!(approve_fixture(&db, profile.path(), &automation, &digest, true, &[]).is_err());
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_err());
    let state: (bool, Option<i64>, bool) = db
        .query_row(
            "SELECT enabled,next_due_at,inputs_changed FROM automation_state",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, (false, None, true));
    let current = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    approve_fixture(
        &db,
        profile.path(),
        &automation,
        &hash(&serde_json::to_vec(&current).unwrap()),
        false,
        &[],
    )
    .unwrap();
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_ok());
    assert!(approved_inputs(&db, profile.path(), &automation, true, &[]).is_err());
}

#[test]
fn captured_skill_instructions_remain_pinned_after_library_edit() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(project);
    let skill = uuid::Uuid::new_v4().to_string();
    let markdown = format!(
        "---\nid: {skill}\nname: Daily research\ndescription: Research procedure\n---\nUse the original research procedure."
    );
    files::write(
        &root,
        "plugins/daily/skills/research.md",
        markdown.as_bytes(),
        None,
    )
    .unwrap();
    let path = root.join("plugins/daily/automations/daily.json");
    let mut definition: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    definition["execution"]["skills"] = json!([skill]);
    fs::write(path, definition.to_string()).unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let captured = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    assert!(
        captured["skills"][0]["instructions"]
            .as_str()
            .unwrap()
            .contains("original research procedure")
    );
    let digest = hash(&serde_json::to_vec(&captured).unwrap());
    approve_fixture(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
    fs::write(
        root.join("plugins/daily/skills/research.md"),
        markdown.replace("original research procedure", "changed research procedure"),
    )
    .unwrap();
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_err());
    assert!(
        captured["skills"][0]["instructions"]
            .as_str()
            .unwrap()
            .contains("original research procedure")
    );
}

#[test]
fn refresh_checks_selected_inputs_without_disabling_for_unrelated_resources() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(project);
    let path = root.join("plugins/daily/automations/daily.json");
    let mut definition: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    definition["execution"]["skills"] = json!(["global:research"]);
    fs::write(&path, definition.to_string()).unwrap();
    let mut skills = vec![inferay_core::prompts::Prompt {
        id: "research".into(),
        name: "Research".into(),
        description: "Review evidence".into(),
        command: "research".into(),
        prompt_template: "Read the original sources".into(),
        is_built_in: false,
        created_at: 1,
        updated_at: 1,
    }];
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &skills).unwrap();
    let digest = hash(
        &serde_json::to_vec(&execution_inputs(&db, profile.path(), &automation, &skills).unwrap())
            .unwrap(),
    );
    approve_fixture(&db, profile.path(), &automation, &digest, true, &skills).unwrap();
    let resource = json!({"schema":"inferay.resource/1","id":uuid::Uuid::new_v4().to_string(),"type":"brand.brand","typeVersion":1,"name":"Unrelated","body":{"name":"Other","description":"Other project context"}});
    files::write(
        &root,
        "memory/brand.brand/other.json",
        resource.to_string().as_bytes(),
        None,
    )
    .unwrap();
    refresh(&mut db, profile.path(), &skills).unwrap();
    assert!(
        db.query_row("SELECT enabled FROM automation_state", [], |r| r
            .get::<_, bool>(0))
            .unwrap()
    );
    skills[0].prompt_template = "New procedure requiring review".into();
    refresh(&mut db, profile.path(), &skills).unwrap();
    let state: (bool, bool, Option<i64>) = db
        .query_row(
            "SELECT enabled,inputs_changed,next_due_at FROM automation_state",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, (false, true, None));
    skills[0].prompt_template = "Read the original sources".into();
    refresh(&mut db, profile.path(), &skills).unwrap();
    assert!(approved_inputs(&db, profile.path(), &automation, false, &skills).is_err());
}

#[test]
fn plugin_approval_is_host_only_hash_bound_and_disables_after_file_change() {
    let (profile, project, automation) = fixture();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let plugin = catalog(&db, Some(&project)).unwrap().plugins[0]
        .file
        .id
        .clone();
    let review = review_plugin(&db, profile.path(), &plugin, &[]).unwrap();
    assert_eq!(review.automations.len(), 1);
    assert!(review.files.iter().all(|f| f.previous_hash.is_none()));
    let command = ProjectFileCommand::ApprovePlugin {
        id: plugin.clone(),
        expected_inputs_hash: review.inputs_hash.clone(),
        enable: true,
    };
    assert!(
        crate::project_file_commands::apply(&mut db, profile.path(), command.clone(), false, &[])
            .is_err()
    );
    crate::project_file_commands::apply(&mut db, profile.path(), command.clone(), true, &[])
        .unwrap();
    assert!(catalog(&db, Some(&project)).unwrap().automations[0].enabled);
    let root = profile.path().join("projects").join(&project);
    files::write(
        &root,
        "plugins/daily/helper.py",
        b"print('new input')",
        None,
    )
    .unwrap();
    assert!(
        crate::project_file_commands::apply(&mut db, profile.path(), command, true, &[]).is_err()
    );
    let state = catalog(&db, Some(&project)).unwrap();
    assert!(!state.automations[0].enabled);
    assert!(state.automations[0].inputs_changed);
    let changed = review_plugin(&db, profile.path(), &plugin, &[]).unwrap();
    assert_ne!(changed.inputs_hash, review.inputs_hash);
    let new_file = changed
        .files
        .iter()
        .find(|f| f.path.ends_with("helper.py"))
        .unwrap();
    assert!(new_file.previous_hash.is_none());
    assert_eq!(new_file.content.as_deref(), Some("print('new input')"));
    assert!(
        changed
            .files
            .iter()
            .any(|f| f.hash.is_some() && f.hash == f.previous_hash)
    );
    crate::project_file_commands::apply(
        &mut db,
        profile.path(),
        ProjectFileCommand::ApprovePlugin {
            id: plugin.clone(),
            expected_inputs_hash: changed.inputs_hash,
            enable: true,
        },
        true,
        &[],
    )
    .unwrap();
    crate::project_file_commands::apply(
        &mut db,
        profile.path(),
        ProjectFileCommand::DisablePlugin { id: plugin },
        true,
        &[],
    )
    .unwrap();
    assert!(!catalog(&db, Some(&project)).unwrap().automations[0].enabled);
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_ok());
}

#[test]
fn library_approval_rolls_back_all_jobs_and_keeps_manual_jobs_disabled() {
    let (profile, project, scheduled) = fixture();
    let root = profile.path().join("projects").join(&project);
    let manual = uuid::Uuid::new_v4().to_string();
    let mut definition: Value = serde_json::from_slice(
        &fs::read(root.join("plugins/daily/automations/daily.json")).unwrap(),
    )
    .unwrap();
    definition["id"] = json!(manual);
    definition["trigger"] = json!({"kind":"manual"});
    files::write(
        &root,
        "plugins/daily/automations/manual.json",
        &serde_json::to_vec(&definition).unwrap(),
        None,
    )
    .unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let plugin = catalog(&db, Some(&project)).unwrap().plugins[0]
        .file
        .id
        .clone();
    let review = review_plugin(&db, profile.path(), &plugin, &[]).unwrap();
    let command = ProjectFileCommand::ApprovePlugin {
        id: plugin.clone(),
        expected_inputs_hash: review.inputs_hash,
        enable: true,
    };
    // Fail the final write, after both automation approval writes succeeded.
    db.execute_batch("CREATE TRIGGER reject_approval BEFORE INSERT ON plugin_state BEGIN SELECT RAISE(ABORT,'injected approval failure'); END;").unwrap();
    let error =
        crate::project_file_commands::apply(&mut db, profile.path(), command.clone(), true, &[])
            .unwrap_err();
    assert!(error.to_string().contains("injected approval failure"));
    let approved: i64 = db.query_row("SELECT count(*) FROM automation_state WHERE enabled=1 OR approved_hash IS NOT NULL OR next_due_at IS NOT NULL", [], |row| row.get(0)).unwrap();
    assert_eq!(approved, 0);
    assert!(
        catalog(&db, Some(&project)).unwrap().plugins[0]
            .approved_hash
            .is_none()
    );
    db.execute_batch("DROP TRIGGER reject_approval").unwrap();
    crate::project_file_commands::apply(&mut db, profile.path(), command, true, &[]).unwrap();
    let snapshot = plugin_inputs(&db, profile.path(), &plugin, &[]).unwrap();
    for id in [&scheduled, &manual] {
        let (enabled, next, approved): (bool, Option<i64>, String) = db.query_row(
            "SELECT enabled,next_due_at,approved_hash FROM automation_state WHERE automation_id=?", [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(enabled, id == &scheduled);
        assert_eq!(next.is_some(), enabled);
        assert_eq!(
            approved,
            hash(&serde_json::to_vec(&snapshot["automations"][id]).unwrap())
        );
    }
    let manual_hash = hash(&serde_json::to_vec(&snapshot["automations"][&manual]).unwrap());
    assert!(
        approve_fixture(&db, profile.path(), &manual, &manual_hash, true, &[])
            .unwrap_err()
            .to_string()
            .contains("Choose a schedule")
    );
}

#[test]
fn code_only_library_edits_revoke_approval_even_after_reverting() {
    let (profile, project, _) = fixture();
    let root = profile.path().join("projects").join(&project);
    fs::remove_file(root.join("plugins/daily/automations/daily.json")).unwrap();
    files::write(&root, "plugins/daily/library.py", b"VERSION = 1", None).unwrap();
    files::write(&root, "plugins/daily/raw.bin", &[255, 0], None).unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let plugin = catalog(&db, Some(&project)).unwrap().plugins[0]
        .file
        .id
        .clone();
    let review = review_plugin(&db, profile.path(), &plugin, &[]).unwrap();
    assert!(review.automations.is_empty());
    let binary = review
        .files
        .iter()
        .find(|file| file.path.ends_with("raw.bin"))
        .unwrap();
    assert!(binary.hash.is_some());
    assert!(binary.content.is_none());
    crate::project_file_commands::apply(
        &mut db,
        profile.path(),
        ProjectFileCommand::ApprovePlugin {
            id: plugin.clone(),
            expected_inputs_hash: review.inputs_hash,
            enable: false,
        },
        true,
        &[],
    )
    .unwrap();
    assert!(
        catalog(&db, Some(&project)).unwrap().plugins[0]
            .approved_hash
            .is_some()
    );
    let original_hash = hash(b"VERSION = 1");
    save_definition(
        &mut db,
        profile.path(),
        &project,
        "plugins/daily/library.py",
        b"VERSION = 2",
        Some(&original_hash),
        &[],
    )
    .unwrap();
    assert!(
        save_definition(
            &mut db,
            profile.path(),
            &project,
            "plugins/daily/library.py",
            b"stale editor",
            Some(&original_hash),
            &[]
        )
        .is_err()
    );
    assert_eq!(
        fs::read(root.join("plugins/daily/library.py")).unwrap(),
        b"VERSION = 2"
    );
    let changed = catalog(&db, Some(&project)).unwrap();
    assert!(changed.plugins[0].approved_hash.is_none());
    assert!(changed.plugins[0].approved_at.is_some());
    let diff = review_plugin(&db, profile.path(), &plugin, &[]).unwrap();
    let script = diff
        .files
        .iter()
        .find(|file| file.path.ends_with("library.py"))
        .unwrap();
    assert_eq!(script.previous_content.as_deref(), Some("VERSION = 1"));
    assert_eq!(script.content.as_deref(), Some("VERSION = 2"));
    fs::write(root.join("plugins/daily/library.py"), b"VERSION = 1").unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    assert!(
        catalog(&db, Some(&project)).unwrap().plugins[0]
            .approved_hash
            .is_none()
    );
    fs::remove_file(root.join("plugins/daily/library.py")).unwrap();
    let review = review_plugin(&db, profile.path(), &plugin, &[]).unwrap();
    let removed = review
        .files
        .iter()
        .find(|file| file.path.ends_with("library.py"))
        .unwrap();
    assert!(removed.hash.is_none());
    assert!(removed.content.is_none());
    assert_eq!(removed.previous_content.as_deref(), Some("VERSION = 1"));
}

#[test]
fn agents_can_discover_and_read_library_files_without_approval_or_execution() {
    let (profile, project, _) = fixture();
    let root = profile.path().join("projects").join(&project);
    files::write(
        &root,
        "plugins/daily/README.md",
        b"Use the scene helper.",
        None,
    )
    .unwrap();
    files::write(&root, "plugins/daily/assets/raw.bin", &[255, 0], None).unwrap();
    let repository = uuid::Uuid::new_v4().to_string();
    let mut project_file: Value =
        serde_json::from_slice(&fs::read(root.join("project.json")).unwrap()).unwrap();
    project_file["repositories"] = json!([{"id":repository,"name":"Source"}]);
    fs::write(root.join("project.json"), project_file.to_string()).unwrap();
    let automation_path = root.join("plugins/daily/automations/daily.json");
    let mut automation: Value =
        serde_json::from_slice(&fs::read(&automation_path).unwrap()).unwrap();
    automation["execution"]["workingDirectory"] = json!({"base":"repository","id":repository});
    fs::write(automation_path, automation.to_string()).unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let plugin = catalog(&db, Some(&project)).unwrap().plugins[0]
        .file
        .id
        .clone();
    assert!(
        review_plugin(&db, profile.path(), &plugin, &[])
            .unwrap_err()
            .to_string()
            .contains("not linked")
    );
    let list = crate::project_file_commands::apply(
        &mut db,
        profile.path(),
        ProjectFileCommand::ReadPlugin {
            id: plugin.clone(),
            path: None,
        },
        false,
        &[],
    )
    .unwrap();
    assert!(
        list["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["path"] == "README.md")
    );
    assert_eq!(list["sourceHash"].as_str().unwrap().len(), 64);
    fs::write(root.join("plugins/daily/assets/raw.bin"), [255, 0, 1]).unwrap();
    let updated = crate::project_file_commands::apply(
        &mut db,
        profile.path(),
        ProjectFileCommand::ReadPlugin {
            id: plugin.clone(),
            path: None,
        },
        false,
        &[],
    )
    .unwrap();
    assert_ne!(
        list["sourceHash"], updated["sourceHash"],
        "Binary assets participate in library identity"
    );
    let note = crate::project_file_commands::apply(
        &mut db,
        profile.path(),
        ProjectFileCommand::ReadPlugin {
            id: plugin.clone(),
            path: Some("README.md".into()),
        },
        false,
        &[],
    )
    .unwrap();
    assert_eq!(note["content"], "Use the scene helper.");
    for path in ["../../project.json", "/etc/passwd", "assets/raw.bin"] {
        assert!(
            crate::project_file_commands::apply(
                &mut db,
                profile.path(),
                ProjectFileCommand::ReadPlugin {
                    id: plugin.clone(),
                    path: Some(path.into())
                },
                false,
                &[]
            )
            .is_err()
        );
    }
    let state = catalog(&db, Some(&project)).unwrap();
    assert!(state.plugins[0].approved_hash.is_none());
    assert!(!state.automations[0].enabled);
}

#[test]
fn memory_records_are_indexed_from_the_current_library_directory() {
    let (profile, project, _) = fixture();
    let root = profile.path().join("projects").join(&project);
    let record = uuid::Uuid::new_v4().to_string();
    let path = format!("memory/brand.genome/{record}.json");
    files::write(&root, &path, json!({"schema":"inferay.resource/1","id":record,"type":"brand.genome","typeVersion":1,"name":"Brand genome","archived":false,"body":{"brandId":"test-brand"}}).to_string().as_bytes(), None).unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let view = catalog(&db, Some(&project)).unwrap();
    assert_eq!(view.resources.len(), 1);
    assert_eq!(view.resources[0].id, record);
    assert_eq!(view.resources[0].source_path, path);
    assert!(view.resources[0].definition.is_some());
}

#[test]
fn broken_plugin_manifest_can_be_read_and_repaired_without_reapproval() {
    let (profile, project, _) = fixture();
    let root = profile.path().join("projects").join(&project);
    let manifest_path = "plugins/daily/plugin.json";
    let original = fs::read(root.join(manifest_path)).unwrap();
    let original_id = serde_json::from_slice::<Value>(&original).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    fs::write(root.join(manifest_path), b"{broken").unwrap();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let broken = catalog(&db, Some(&project)).unwrap().plugins.remove(0);
    assert!(broken.file.definition.is_none());
    assert!(broken.file.error.is_some());
    let content = crate::project_file_commands::apply(
        &mut db,
        profile.path(),
        ProjectFileCommand::ReadPlugin {
            id: broken.file.id.clone(),
            path: Some("plugin.json".into()),
        },
        false,
        &[],
    )
    .unwrap();
    assert_eq!(content["content"], "{broken");
    assert!(review_plugin(&db, profile.path(), &broken.file.id, &[]).is_err());
    save_definition(
        &mut db,
        profile.path(),
        &project,
        manifest_path,
        &original,
        content["sourceHash"].as_str(),
        &[],
    )
    .unwrap();
    let repaired = catalog(&db, Some(&project)).unwrap();
    assert_eq!(repaired.plugins[0].file.id, original_id);
    assert!(repaired.plugins[0].file.error.is_none());
    assert!(repaired.plugins[0].approved_hash.is_none());
    assert!(!repaired.automations[0].enabled);
}

#[test]
fn shared_genome_edit_revokes_every_reader_but_preserves_unrelated_approval() {
    let (profile, project, original) = fixture();
    let root = profile.path().join("projects").join(&project);
    let template: Value = serde_json::from_slice(
        &fs::read(root.join("plugins/daily/automations/daily.json")).unwrap(),
    )
    .unwrap();
    fs::remove_file(root.join("plugins/daily/automations/daily.json")).unwrap();
    let record = uuid::Uuid::new_v4().to_string();
    let record_path = format!("memory/brand.genome/{record}.json");
    let genome = json!({"schema":"inferay.resource/1","id":record,"type":"brand.genome","typeVersion":1,"name":"Shared identity","archived":false,"body":{"brandId":"brand","rules":["Cite sources"]}});
    files::write(&root, &record_path, genome.to_string().as_bytes(), None).unwrap();
    let ids = [
        original,
        uuid::Uuid::new_v4().to_string(),
        uuid::Uuid::new_v4().to_string(),
    ];
    for (index, id) in ids.iter().enumerate() {
        let mut definition = template.clone();
        definition["id"] = json!(id);
        definition["name"] = json!(format!("Job {index}"));
        definition["execution"]["resources"] = if index < 2 {
            json!([record])
        } else {
            json!([])
        };
        files::write(
            &root,
            &format!("automations/{id}/automation.json"),
            definition.to_string().as_bytes(),
            None,
        )
        .unwrap();
    }
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    for id in &ids {
        let inputs = execution_inputs(&db, profile.path(), id, &[]).unwrap();
        let digest = hash(&serde_json::to_vec(&inputs).unwrap());
        approve_fixture(&db, profile.path(), id, &digest, true, &[]).unwrap();
        assert!(approved_inputs(&db, profile.path(), id, true, &[]).is_ok());
    }
    let mut edited = genome.clone();
    edited["body"]["rules"] = json!(["Cite sources", "Review financial claims"]);
    fs::write(root.join(&record_path), edited.to_string()).unwrap();
    assert!(approved_inputs(&db, profile.path(), &ids[0], true, &[]).is_err());
    assert!(
        db.query_row(
            "SELECT enabled FROM automation_state WHERE automation_id=?",
            [&ids[1]],
            |r| r.get::<_, bool>(0)
        )
        .unwrap()
    );
    assert!(approved_inputs(&db, profile.path(), &ids[2], true, &[]).is_ok());
    refresh(&mut db, profile.path(), &[]).unwrap();
    for (index, id) in ids.iter().enumerate() {
        let state: (bool, bool, Option<i64>) = db.query_row("SELECT enabled,inputs_changed,next_due_at FROM automation_state WHERE automation_id=?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(state.0, index == 2);
        assert_eq!(state.1, index < 2);
        assert_eq!(state.2.is_some(), index == 2);
    }
    fs::write(root.join(&record_path), genome.to_string()).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    for id in &ids[..2] {
        assert!(approved_inputs(&db, profile.path(), id, false, &[]).is_err());
    }
    assert!(approved_inputs(&db, profile.path(), &ids[2], true, &[]).is_ok());
}

#[test]
fn changed_git_metadata_binding_invalidates_automation_approval() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(&project);
    let first = profile.path().join("git-first");
    let second = profile.path().join("git-second");
    let common = profile.path().join("git-common");
    for directory in [&first, &second, &common] {
        fs::create_dir(directory).unwrap();
    }
    for directory in [&first, &second, &common] {
        fs::write(directory.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::create_dir(directory.join("objects")).unwrap();
    }
    fs::write(first.join("commondir"), "../git-common\n").unwrap();
    fs::write(root.join(".git"), format!("gitdir: {}\n", first.display())).unwrap();
    for path in [
        "plugins/daily/plugin.json",
        "plugins/daily/automations/daily.json",
    ] {
        let path = root.join(path);
        let mut definition: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        definition["may"] = json!(["write_project_files", "commit"]);
        fs::write(path, definition.to_string()).unwrap();
    }
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let before = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    assert_eq!(before["gitWritePaths"], before["gitMetadataPaths"]);
    let plugin: Value =
        serde_json::from_slice(&fs::read(root.join("plugins/daily/plugin.json")).unwrap()).unwrap();
    let review = review_plugin(&db, profile.path(), plugin["id"].as_str().unwrap(), &[]).unwrap();
    assert_eq!(json!(review.git_write_paths), before["gitWritePaths"]);
    let paths: BTreeSet<std::path::PathBuf> =
        serde_json::from_value(before["gitMetadataPaths"].clone()).unwrap();
    assert_eq!(
        paths,
        BTreeSet::from([
            first.canonicalize().unwrap(),
            common.canonicalize().unwrap()
        ])
    );
    approve_fixture(
        &db,
        profile.path(),
        &automation,
        &hash(&serde_json::to_vec(&before).unwrap()),
        true,
        &[],
    )
    .unwrap();
    fs::write(first.join("commondir"), "../git-second\n").unwrap();
    let after = execution_inputs(&db, profile.path(), &automation, &[]).unwrap();
    assert_eq!(before["files"], after["files"]);
    assert_ne!(before["gitMetadataPaths"], after["gitMetadataPaths"]);
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_err());
    refresh(&mut db, profile.path(), &[]).unwrap();
    let state: (bool, bool) = db
        .query_row(
            "SELECT enabled,inputs_changed FROM automation_state WHERE automation_id=?",
            [&automation],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(state, (false, true));
    fs::write(root.join(".git"), "gitdir: missing\n").unwrap();
    assert!(execution_inputs(&db, profile.path(), &automation, &[]).is_err());
}

#[test]
fn catalog_excludes_folder_bindings_removed_from_project() {
    let (profile, project, _) = fixture();
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    let path = profile
        .path()
        .join("projects")
        .join(&project)
        .join("project.json");
    let mut definition: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let kept = uuid::Uuid::new_v4().to_string();
    let removed = uuid::Uuid::new_v4().to_string();
    definition["repositories"] = json!([{"id":kept,"name":"Point"}]);
    fs::write(path, definition.to_string()).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    for id in [&kept, &removed] {
        db.execute(
            "INSERT INTO repository_paths VALUES(?,?,?)",
            params![project, id, "/Point"],
        )
        .unwrap();
    }
    let result = catalog(&db, Some(&project)).unwrap();
    assert_eq!(result.repository_paths.len(), 1);
    assert_eq!(
        result.repository_paths.get(&kept).map(String::as_str),
        Some("/Point")
    );
}

#[test]
fn shared_review_capture_rejects_changes_before_returning() {
    let (profile, project, automation) = fixture();
    let root = profile.path().join("projects").join(&project);
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    for path in ["plugins/daily/new.txt", "project.json"] {
        let capture = InputCapture::new(profile.path(), &project, &[]).unwrap();
        let captured = capture.execution(&db, &automation).unwrap();
        assert_eq!(
            captured,
            execution_inputs(&db, profile.path(), &automation, &[]).unwrap()
        );
        capture.verify().unwrap();
        let file = root.join(path);
        let original = fs::read(&file).ok();
        let mut changed = original.clone().unwrap_or_default();
        changed.push(b' ');
        fs::write(&file, changed).unwrap();
        assert!(capture.verify().is_err(), "must detect changes to {path}");
        if let Some(original) = original {
            fs::write(file, original).unwrap();
        } else {
            fs::remove_file(file).unwrap();
        }
    }
}

#[test]
#[ignore = "isolated approval/review benchmark; run with --ignored --nocapture --test-threads=1"]
fn measure_plugin_approval_and_review() {
    let review_only = std::env::var_os("INFERAY_BENCH_REVIEW_MEMORY").is_some();
    let (profile, project, _) = fixture();
    let root = profile.path().join("projects").join(&project);
    let template: Value = serde_json::from_slice(
        &fs::read(root.join("plugins/daily/automations/daily.json")).unwrap(),
    )
    .unwrap();
    for index in 0..19 {
        let mut automation = template.clone();
        automation["id"] = json!(uuid::Uuid::new_v4().to_string());
        files::write(
            &root,
            &format!("plugins/daily/automations/{index}.json"),
            &serde_json::to_vec(&automation).unwrap(),
            None,
        )
        .unwrap();
    }
    for index in 0..100 {
        files::write(
            &root,
            &format!("plugins/daily/data/{index}.txt"),
            &vec![b'x'; if review_only { 262_144 } else { 32_768 }],
            None,
        )
        .unwrap();
    }
    let mut db = Connection::open_in_memory().unwrap();
    create_schema(&db).unwrap();
    refresh(&mut db, profile.path(), &[]).unwrap();
    let plugin: String = db
        .query_row("SELECT id FROM plugins WHERE valid=1", [], |row| row.get(0))
        .unwrap();
    let capture_only = std::env::var_os("INFERAY_BENCH_INPUT_CAPTURE").is_some();
    // Keep the same approved before/after contents available in the review.
    let inputs = plugin_inputs(&db, profile.path(), &plugin, &[]).unwrap();
    let digest = hash(&serde_json::to_vec(&inputs).unwrap());
    db.execute("INSERT INTO plugin_state(plugin_id,approved_hash,approved_at,approved_inputs) VALUES(?,?,?,?)",params![plugin,digest,crate::project_store::now(),inputs.to_string()]).unwrap();
    drop(inputs);
    let mut samples = Vec::new();
    for iteration in 0..12 {
        let start = std::time::Instant::now();
        if capture_only {
            let snapshot = plugin_inputs(&db, profile.path(), &plugin, &[]).unwrap();
            assert_eq!(snapshot["automations"].as_object().unwrap().len(), 20);
        } else if review_only {
            let review = review_plugin(&db, profile.path(), &plugin, &[]).unwrap();
            assert_eq!(review.automations.len(), 20);
            assert!(
                review
                    .files
                    .iter()
                    .all(|file| file.content == file.previous_content)
            );
        } else {
            crate::project_file_commands::apply(
                &mut db,
                profile.path(),
                ProjectFileCommand::ApprovePlugin {
                    id: plugin.clone(),
                    expected_inputs_hash: digest.clone(),
                    enable: true,
                },
                true,
                &[],
            )
            .unwrap();
            let enabled: u32 = db
                .query_row(
                    "SELECT count(*) FROM automation_state WHERE enabled=1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(enabled, 20);
        }
        if iteration >= 2 {
            samples.push(start.elapsed().as_secs_f64() * 1000.);
        }
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{}: 20 automations, 100 supporting files; 10 warm samples p50={:.3} ms p95={:.3} ms",
        if capture_only {
            "input capture 3.125 MiB"
        } else if review_only {
            "review 25 MiB"
        } else {
            "approval 3.125 MiB"
        },
        (samples[4] + samples[5]) / 2.,
        samples[9]
    );
}
