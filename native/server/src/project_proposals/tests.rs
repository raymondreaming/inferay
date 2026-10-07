use super::*;
use serde_json::json;

fn fixture() -> (tempfile::TempDir, String, FileProjectStore) {
    let profile = tempfile::tempdir().unwrap();
    let project = uuid::Uuid::new_v4().to_string();
    let mut store = FileProjectStore::open(profile.path(), &[]).unwrap();
    store.command(ProjectFileCommand::SaveDefinition {
        project_id: project.clone(), path: "project.json".into(), expected_hash: None,
        content: json!({"schema":"inferay.project/1","id":project,"name":"Studio","description":"","instructions":"","repositories":[]}).to_string(),
    }, true, &[]).unwrap();
    (profile, project, store)
}
fn proposal(project: &str, message: &str) -> ProjectProposalRequest {
    ProjectProposalRequest {
        edited_command: None,
        message_id: message.into(),
        command: ProjectFileCommand::CreatePlugin {
            project_id: project.into(), slug: "render-kit".into(),
            files: BTreeMap::from([
                ("plugin.json".into(), json!({"schema":"inferay.plugin/1","id":uuid::Uuid::new_v4().to_string(),"name":"Render kit","version":"1","description":"Scene helpers","may":[]}).to_string()),
                ("README.md".into(), "Render a scene.".into()),
            ]),
        },
        decision: None,
    }
}

#[test]
fn decisions_survive_reopen_and_cannot_be_replayed_with_other_contents() {
    let (profile, project, mut store) = fixture();
    let mut declined = proposal(&project, "chat:declined");
    assert_eq!(
        resolve(&mut store, declined.clone(), &[]).unwrap().status,
        ProjectProposalStatus::Pending
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM project_proposals", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    declined.decision = Some(ProjectProposalDecision::Decline);
    assert_eq!(
        resolve(&mut store, declined.clone(), &[]).unwrap().status,
        ProjectProposalStatus::Declined
    );
    drop(store);
    let mut store = FileProjectStore::open(profile.path(), &[]).unwrap();
    declined.decision = Some(ProjectProposalDecision::Save);
    assert_eq!(
        resolve(&mut store, declined.clone(), &[]).unwrap().status,
        ProjectProposalStatus::Declined
    );
    assert!(
        !store
            .project_dir(&project)
            .unwrap()
            .join("plugins/render-kit")
            .exists()
    );
    if let ProjectFileCommand::CreatePlugin { files, .. } = &mut declined.command {
        files.insert("README.md".into(), "Different work.".into());
    }
    assert!(resolve(&mut store, declined, &[]).is_err());

    let mut accepted = proposal(&project, "chat:accepted");
    accepted.decision = Some(ProjectProposalDecision::Save);
    let saved = resolve(&mut store, accepted.clone(), &[]).unwrap();
    assert_eq!(saved.status, ProjectProposalStatus::Saved);
    let readme = store
        .project_dir(&project)
        .unwrap()
        .join("plugins/render-kit/README.md");
    std::fs::write(&readme, "Later edit").unwrap();
    drop(store);
    let mut store = FileProjectStore::open(profile.path(), &[]).unwrap();
    let repeated = resolve(&mut store, accepted, &[]).unwrap();
    assert_eq!(repeated.status, ProjectProposalStatus::Saved);
    assert_eq!(repeated.entity_id, saved.entity_id);
    assert_eq!(
        std::fs::read_to_string(readme).unwrap(),
        "Later edit",
        "Retry never reapplies saved files"
    );
}

#[test]
fn interrupted_receipt_recovers_published_bytes_without_reapplying() {
    let (profile, project, mut store) = fixture();
    let mut request = proposal(&project, "chat:recover");
    request.decision = Some(ProjectProposalDecision::Save);
    let saved = resolve(&mut store, request.clone(), &[]).unwrap();
    // Model process death after the directory rename, before the final DB update.
    store
        .db
        .execute(
            "UPDATE project_proposals SET state='applying' WHERE message_id=?",
            [&request.message_id],
        )
        .unwrap();
    drop(store);
    let mut store = FileProjectStore::open(profile.path(), &[]).unwrap();
    request.decision = None;
    let recovered = resolve(&mut store, request.clone(), &[]).unwrap();
    assert_eq!(recovered.status, ProjectProposalStatus::Saved);
    assert_eq!(recovered.entity_id, saved.entity_id);
    assert_eq!(store.catalog(Some(&project), &[]).unwrap().plugins.len(), 1);
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT state FROM project_proposals WHERE message_id=?",
                [&request.message_id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "saved"
    );
}

#[test]
fn stale_identical_automation_is_not_recorded_as_a_successful_save() {
    let (_profile, project, mut store) = fixture();
    let id = uuid::Uuid::new_v4().to_string();
    let command = ProjectFileCommand::SaveDefinition {
        project_id: project, path: format!("automations/{id}/automation.json"), expected_hash: None,
        content: json!({"schema":"inferay.automation/1","id":id,"name":"Briefing","trigger":{"kind":"manual"},"overlap":"skip","execution":{"kind":"agent","provider":"codex","instructions":"Read notes","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300},"may":[]}).to_string(),
    };
    store.command(command.clone(), true, &[]).unwrap();
    let request = ProjectProposalRequest {
        edited_command: None,
        message_id: "chat:stale".into(),
        command,
        decision: Some(ProjectProposalDecision::Save),
    };
    assert!(resolve(&mut store, request.clone(), &[]).is_err());
    assert_eq!(
        resolve(
            &mut store,
            ProjectProposalRequest {
                decision: None,
                ..request
            },
            &[]
        )
        .unwrap()
        .status,
        ProjectProposalStatus::Pending
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM project_proposals", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn library_comparison_is_read_only_and_rejects_stale_inputs() {
    let (_profile, project, mut store) = fixture();
    let request = proposal(&project, "chat:comparison");
    let root = store.project_dir(&project).unwrap();
    let globals = Default::default();
    let created = review::plugin(&root, &request.command, &globals).unwrap();
    assert_eq!(created.files.len(), 2);
    assert!(
        created
            .files
            .iter()
            .all(|file| file.previous_hash.is_none())
    );
    assert!(!root.join("plugins/render-kit").exists());
    store.command(request.command.clone(), true, &[]).unwrap();
    let package = root.join("plugins/render-kit");
    std::fs::write(package.join("image.bin"), [0xff, 0x00, 0x81]).unwrap();
    std::fs::write(package.join("keep.txt"), "Keep this").unwrap();
    let original = files::package_files(&root, "plugins/render-kit").unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(package.join("plugin.json")).unwrap()).unwrap();
    manifest["may"] = json!(["network"]);
    let command = ProjectFileCommand::UpdatePlugin {
        project_id: project,
        slug: "render-kit".into(),
        expected_hash: hash(&serde_json::to_vec(&original).unwrap()),
        files: BTreeMap::from([
            ("plugin.json".into(), manifest.to_string()),
            ("README.md".into(), "Updated instructions".into()),
            ("new.txt".into(), "New file".into()),
        ]),
        remove: vec!["image.bin".into()],
    };
    let comparison = review::plugin(&root, &command, &globals).unwrap();
    assert_eq!(comparison.files.len(), 4);
    assert!(comparison.previous_permissions.is_empty());
    assert!(comparison.permissions.contains(&Permission::Network));
    let readme = comparison
        .files
        .iter()
        .find(|file| file.path.ends_with("README.md"))
        .unwrap();
    assert_eq!(readme.previous_content.as_deref(), Some("Render a scene."));
    assert_eq!(readme.content.as_deref(), Some("Updated instructions"));
    let removed = comparison
        .files
        .iter()
        .find(|file| file.path.ends_with("image.bin"))
        .unwrap();
    assert!(removed.hash.is_none());
    assert!(removed.previous_hash.is_some());
    assert!(removed.previous_content.is_none());
    assert_eq!(
        files::package_files(&root, "plugins/render-kit").unwrap(),
        original
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM project_proposals", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    std::fs::write(package.join("keep.txt"), "Outside edit").unwrap();
    assert!(review::plugin(&root, &command, &globals).is_err());
}

#[test]
fn edited_library_save_keeps_card_identity_and_recovers_exact_contents() {
    let (profile, project, mut store) = fixture();
    let original = proposal(&project, "chat:edited");
    let mut edited = original.command.clone();
    if let ProjectFileCommand::CreatePlugin { files, .. } = &mut edited {
        files.insert("README.md".into(), "Instructions edited by the user".into());
        files.insert("notes.txt".into(), "Added during review".into());
    }
    let mut request = original.clone();
    request.decision = Some(ProjectProposalDecision::Save);
    request.edited_command = Some(edited.clone());
    assert_eq!(
        resolve(&mut store, request.clone(), &[]).unwrap().status,
        ProjectProposalStatus::Saved
    );
    let package = store
        .project_dir(&project)
        .unwrap()
        .join("plugins/render-kit");
    assert_eq!(
        std::fs::read_to_string(package.join("README.md")).unwrap(),
        "Instructions edited by the user"
    );
    // A persisted intent must carry the edited payload even if publication has
    // not happened and the original chat card is all the renderer reloaded.
    store
        .db
        .execute(
            "UPDATE project_proposals SET state='applying' WHERE message_id=?",
            [&request.message_id],
        )
        .unwrap();
    std::fs::remove_dir_all(&package).unwrap();
    drop(store);
    let mut store = FileProjectStore::open(profile.path(), &[]).unwrap();
    let mut conflicting = request.clone();
    if let Some(ProjectFileCommand::CreatePlugin { files, .. }) = &mut conflicting.edited_command {
        files.insert("README.md".into(), "A different edit".into());
    }
    assert!(resolve(&mut store, conflicting, &[]).is_err());
    request.edited_command = None;
    assert_eq!(
        resolve(&mut store, request, &[]).unwrap().status,
        ProjectProposalStatus::Saved
    );
    assert_eq!(
        std::fs::read_to_string(package.join("notes.txt")).unwrap(),
        "Added during review"
    );
    assert_eq!(
        std::fs::read_to_string(package.join("README.md")).unwrap(),
        "Instructions edited by the user"
    );
    assert_eq!(
        resolve(&mut store, original, &[]).unwrap().status,
        ProjectProposalStatus::Saved
    );
}

#[test]
fn proposal_edits_cannot_redirect_or_weaken_a_save() {
    let (_profile, project, mut store) = fixture();
    let original = proposal(&project, "chat:edit-scope");
    let mut redirected = original.clone();
    redirected.decision = Some(ProjectProposalDecision::Save);
    let mut edited = original.command.clone();
    if let ProjectFileCommand::CreatePlugin { slug, .. } = &mut edited {
        *slug = "another-library".into();
    }
    redirected.edited_command = Some(edited);
    assert!(resolve(&mut store, redirected, &[]).is_err());
    let mut changed_id = original.clone();
    changed_id.decision = Some(ProjectProposalDecision::Save);
    let mut edited = original.command.clone();
    if let ProjectFileCommand::CreatePlugin { files, .. } = &mut edited {
        let mut manifest: serde_json::Value = serde_json::from_str(&files["plugin.json"]).unwrap();
        manifest["id"] = json!(uuid::Uuid::new_v4().to_string());
        files.insert("plugin.json".into(), manifest.to_string());
    }
    changed_id.edited_command = Some(edited);
    assert!(resolve(&mut store, changed_id, &[]).is_err());
    let update = ProjectFileCommand::UpdatePlugin {
        project_id: project,
        slug: "render-kit".into(),
        expected_hash: "original-hash".into(),
        files: BTreeMap::new(),
        remove: vec![],
    };
    let mut weaker = update.clone();
    if let ProjectFileCommand::UpdatePlugin { expected_hash, .. } = &mut weaker {
        *expected_hash = "new-hash".into();
    }
    assert!(edits::validate(&update, &weaker).is_err());
    assert_eq!(
        store
            .db
            .query_row("SELECT count(*) FROM project_proposals", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
