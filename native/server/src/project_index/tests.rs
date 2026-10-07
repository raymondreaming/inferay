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
    approve_automation(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
    // Merely opening/refreshing does not change permission or scheduling state.
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
    approve_automation(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
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
    approve_automation(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
    assert_eq!(
        approved_inputs(&db, profile.path(), &automation, true, &[]).unwrap(),
        reviewed
    );
    disable_automation(&db, &automation).unwrap();
    assert!(approved_inputs(&db, profile.path(), &automation, true, &[]).is_err());
    assert!(approved_inputs(&db, profile.path(), &automation, false, &[]).is_ok());
    files::write(&root, "plugins/daily/helper.py", b"print('changed')", None).unwrap();
    assert!(approve_automation(&db, profile.path(), &automation, &digest, true, &[]).is_err());
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
    approve_automation(
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
    approve_automation(&db, profile.path(), &automation, &digest, true, &[]).unwrap();
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
    approve_automation(&db, profile.path(), &automation, &digest, true, &skills).unwrap();
    // Another resource is not an input to this automation.
    let resource = json!({"schema":"inferay.resource/1","id":uuid::Uuid::new_v4().to_string(),"type":"brand.brand","typeVersion":1,"name":"Unrelated","body":{"name":"Other","description":"Other project context"}});
    files::write(
        &root,
        "resources/brand.brand/other.json",
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
    // Reverting the source never silently grants approval again.
    skills[0].prompt_template = "Read the original sources".into();
    refresh(&mut db, profile.path(), &skills).unwrap();
    assert!(approved_inputs(&db, profile.path(), &automation, false, &skills).is_err());
}
