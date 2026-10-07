use super::*;
use serde_json::json;

#[test]
fn startup_reopens_and_rebuilds_file_definitions_without_database_ownership() {
    let root = tempfile::tempdir().unwrap();
    let project = uuid::Uuid::new_v4().to_string();
    let content = json!({"schema":"inferay.project/1","id":project,"name":"Portable","description":"","instructions":"Retain these instructions","repositories":[]}).to_string();
    let saved_hash;
    {
        let mut store = FileProjectStore::open(root.path(), &[]).unwrap();
        assert!(FileProjectStore::open(root.path(), &[]).is_err());
        let result = store
            .command(
                ProjectFileCommand::SaveDefinition {
                    project_id: project.clone(),
                    path: "project.json".into(),
                    content: content.clone(),
                    expected_hash: None,
                },
                true,
                &[],
            )
            .unwrap();
        saved_hash = result["sourceHash"].as_str().unwrap().to_owned();
        assert_eq!(
            store.catalog(Some(&project), &[]).unwrap().projects[0]
                .source_hash
                .as_deref(),
            Some(saved_hash.as_str())
        );
    }
    {
        let mut store = FileProjectStore::open(root.path(), &[]).unwrap();
        let catalog = store.catalog(Some(&project), &[]).unwrap();
        assert_eq!(
            catalog.projects[0]
                .definition
                .as_ref()
                .unwrap()
                .instructions,
            "Retain these instructions"
        );
        assert_eq!(
            catalog.projects[0].source_hash.as_deref(),
            Some(saved_hash.as_str())
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
            0
        );
    }
    std::fs::remove_file(root.path().join("projects.sqlite3")).unwrap();
    let mut rebuilt = FileProjectStore::open(root.path(), &[]).unwrap();
    let catalog = rebuilt.catalog(Some(&project), &[]).unwrap();
    assert_eq!(
        catalog.projects[0].source_hash.as_deref(),
        Some(saved_hash.as_str())
    );
    assert_eq!(
        std::fs::read_to_string(
            root.path()
                .join("projects")
                .join(project)
                .join("project.json")
        )
        .unwrap(),
        content
    );
}

#[test]
fn chat_context_reads_current_files_and_does_not_guess_shared_repository_ownership() {
    let root = tempfile::tempdir().unwrap();
    let repository = tempfile::tempdir().unwrap();
    let mut store = FileProjectStore::open(root.path(), &[]).unwrap();
    let mut projects = Vec::new();
    for name in ["First", "Second"] {
        let id = uuid::Uuid::new_v4().to_string();
        let repo = uuid::Uuid::new_v4().to_string();
        let content = json!({"schema":"inferay.project/1","id":id,"name":name,"description":"","instructions":format!("{name} instructions"),"repositories":[{"id":repo,"name":"Shared"}]}).to_string();
        let saved = store
            .command(
                ProjectFileCommand::SaveDefinition {
                    project_id: id.clone(),
                    path: "project.json".into(),
                    content,
                    expected_hash: None,
                },
                true,
                &[],
            )
            .unwrap();
        store
            .command(
                ProjectFileCommand::LinkRepository {
                    project_id: id.clone(),
                    repository_id: repo,
                    expected_project_hash: saved["sourceHash"].as_str().unwrap().into(),
                    path: repository.path().to_string_lossy().into(),
                },
                true,
                &[],
            )
            .unwrap();
        projects.push(id);
    }
    assert!(
        store
            .context("unassociated", repository.path(), &[])
            .unwrap()
            .is_none()
    );
    store
        .command(
            ProjectFileCommand::AssociateConversation {
                project_id: projects[1].clone(),
                pane_id: "chat".into(),
            },
            true,
            &[],
        )
        .unwrap();
    let (id, instructions, directory) = store
        .context("chat", repository.path(), &[])
        .unwrap()
        .unwrap();
    assert_eq!(id, projects[1]);
    assert!(instructions.contains("Second instructions"));
    assert!(instructions.contains(repository.path().canonicalize().unwrap().to_str().unwrap()));
    let file = directory.join("project.json");
    let mut definition: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    definition["instructions"] = json!("Externally edited instructions");
    std::fs::write(&file, definition.to_string()).unwrap();
    assert!(
        store
            .context("chat", repository.path(), &[])
            .unwrap()
            .unwrap()
            .1
            .starts_with("Externally edited instructions")
    );
    definition["archived"] = json!(true);
    std::fs::write(&file, definition.to_string()).unwrap();
    // An explicit archived association must not fall through to First.
    assert!(
        store
            .context("chat", repository.path(), &[])
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store
            .context("unassociated", repository.path(), &[])
            .unwrap()
            .unwrap()
            .0,
        projects[0]
    );
    assert!(store.history(&projects[1], None).unwrap().runs.is_empty());
}

#[test]
fn point_proof_uses_native_validation_bindings_and_approval_inputs() {
    const PROJECT: &str = "c99b436f-71e0-5942-ac44-146262266d52";
    const AUTOMATION: &str = "d1404e25-8629-5302-8297-d2dd6cb0d0a2";
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/tests/fixtures/plugins/point");
    let profile = tempfile::tempdir().unwrap();
    let root = profile.path().join("projects").join(PROJECT);
    for entry in walkdir::WalkDir::new(&source) {
        let entry = entry.unwrap();
        let target = root.join(entry.path().strip_prefix(&source).unwrap());
        if entry.file_type().is_dir() { std::fs::create_dir_all(target).unwrap(); }
        else { std::fs::copy(entry.path(), target).unwrap(); }
    }
    let mut store = FileProjectStore::open(profile.path(), &[]).unwrap();
    assert_eq!(store.db.query_row("SELECT count(*) FROM definition_errors", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    let unlinked = crate::project_index::execution_inputs(&store.db, profile.path(), AUTOMATION, &[]).unwrap_err();
    assert!(unlinked.to_string().contains("not linked on this machine"));
    let repository = tempfile::tempdir().unwrap();
    store.command(ProjectFileCommand::LinkRepository {
        project_id: PROJECT.into(), repository_id: "49e00196-55b9-58ff-b970-c626c85392bb".into(),
        expected_project_hash: crate::project_store::hash(&std::fs::read(root.join("project.json")).unwrap()),
        path: repository.path().display().to_string(),
    }, true, &[]).unwrap();
    let before = crate::project_index::execution_inputs(&store.db, profile.path(), AUTOMATION, &[]).unwrap();
    assert_eq!(before["automation"]["trigger"]["times"], json!(["08:00"]));
    assert_eq!(before["automation"]["trigger"]["timezone"], "America/Chicago");
    let skill = root.join("plugins/point-autobuild/skills/daily-autobuild.md");
    std::fs::write(&skill, format!("{}\nRecord the selected branch.\n", std::fs::read_to_string(&skill).unwrap())).unwrap();
    let after = crate::project_index::execution_inputs(&store.db, profile.path(), AUTOMATION, &[]).unwrap();
    assert_ne!(crate::project_store::hash(&serde_json::to_vec(&before).unwrap()), crate::project_store::hash(&serde_json::to_vec(&after).unwrap()));
    assert!(crate::project_index::approved_inputs(&store.db, profile.path(), AUTOMATION, false, &[]).is_err());
    let path = root.join("plugins/point-autobuild/automations/daily-0800.json");
    let original = std::fs::read(&path).unwrap();
    for mutation in ["unknown", "permission", "absolute"] {
        let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
        match mutation {
            "unknown" => value["enabled"] = json!(true),
            "permission" => value["may"].as_array_mut().unwrap().push(json!("push")),
            _ => value["execution"]["workingDirectory"] = json!({"base":"external","path":"/tmp/repository"}),
        }
        std::fs::write(&path, value.to_string()).unwrap();
        let entries = crate::project_definitions::scan(&root, &Default::default()).unwrap();
        assert!(entries.iter().any(|entry| entry.path.ends_with("daily-0800.json") && entry.error.is_some()), "{mutation} was accepted");
    }
}

#[test]
fn studio_library_fixture_has_separate_disabled_workflow_and_required_tools() {
    const PROJECT: &str = "4b3ed31d-1e35-55af-94af-2968a11bc10b";
    const AUTOMATION: &str = "f5b40ea3-3aea-5319-b295-dca7f110827b";
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/tests/fixtures/plugins/origin-studio");
    let profile = tempfile::tempdir().unwrap();
    let root = profile.path().join("projects").join(PROJECT);
    for entry in walkdir::WalkDir::new(&source) {
        let entry = entry.unwrap();
        let target = root.join(entry.path().strip_prefix(&source).unwrap());
        if entry.file_type().is_dir() { std::fs::create_dir_all(target).unwrap(); }
        else { std::fs::copy(entry.path(), target).unwrap(); }
    }
    let mut store = FileProjectStore::open(profile.path(), &[]).unwrap();
    assert_eq!(store.db.query_row("SELECT count(*) FROM definition_errors", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    assert_eq!(store.db.query_row("SELECT count(*) FROM plugins", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert_eq!(store.db.query_row("SELECT count(*) FROM automations", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert_eq!(store.db.query_row("SELECT count(*) FROM automation_state WHERE enabled<>0 OR coalesce(approved_hash,'')<>''", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    let catalog = store.catalog(Some(PROJECT), &[]).unwrap();
    assert_eq!(catalog.skills.len(), 1);
    let skill = catalog.skills[0].definition.as_ref().unwrap();
    assert_eq!(skill.name, "Procedural studio");
    assert!(catalog.skills[0].source_path.starts_with("plugins/procedural-studio/skills/"));
    let error: Option<String> = store.db.query_row("SELECT error FROM automations", [], |r| r.get(0)).unwrap();
    assert!(error.is_none(), "{error:?}");
    let definition: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join("automations/daily-studio/automation.json")).unwrap()).unwrap();
    assert_eq!(definition["execution"]["tools"].as_array().unwrap().len(), 2);
    assert!(definition["execution"]["tools"].as_array().unwrap().iter().all(|grant| grant["required"] == true));
    assert!(!root.join("plugins/procedural-studio/automations").exists());
    let error = crate::project_index::execution_inputs(&store.db, profile.path(), AUTOMATION, &[]).unwrap_err();
    assert!(error.to_string().contains("not linked on this machine"), "{error}");
    // Selecting knowledge alone does not require the kit's executable or a repo binding.
    let path = root.join("automations/daily-studio/automation.json");
    let mut knowledge = definition;
    knowledge["execution"]["tools"] = json!([]);
    knowledge["may"] = json!([]);
    std::fs::write(&path, knowledge.to_string()).unwrap();
    crate::project_index::refresh(&mut store.db, profile.path(), &[]).unwrap();
    let before = crate::project_index::execution_inputs(&store.db, profile.path(), AUTOMATION, &[]).unwrap();
    assert_eq!(before["requirements"], json!([]));
    assert_eq!(before["skills"][0]["name"], "Procedural studio");
    let skill = root.join("plugins/procedural-studio/skills/studio.md");
    std::fs::write(&skill, format!("{}\nUse a different seed.\n", std::fs::read_to_string(&skill).unwrap())).unwrap();
    let after = crate::project_index::execution_inputs(&store.db, profile.path(), AUTOMATION, &[]).unwrap();
    assert_ne!(before, after, "An edit to the shared library skill must change approval inputs");

}

#[test]
fn profile_lease_releases_when_an_inherited_descriptor_remains_open() {
    let profile = tempfile::tempdir().unwrap();
    let store = FileProjectStore::open(profile.path(), &[]).unwrap();
    // A fork temporarily shares the open file description before exec closes it.
    // A duplicate models that lifetime without forking the test process.
    let inherited = store._lease.0.try_clone().unwrap();
    assert!(FileProjectStore::open(profile.path(), &[]).is_err());
    drop(store);
    let reopened = FileProjectStore::open(profile.path(), &[]).unwrap();
    drop(inherited);
    assert!(FileProjectStore::open(profile.path(), &[]).is_err());
    drop(reopened);
    FileProjectStore::open(profile.path(), &[]).unwrap();
}
