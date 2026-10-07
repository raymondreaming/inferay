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
