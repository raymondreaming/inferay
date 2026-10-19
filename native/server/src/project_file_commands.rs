use crate::{
    project_definitions as files, project_index as index, project_runs,
    project_store::{Result, event, hash, now},
};
use inferay_core::{project_files::*, prompts::Prompt};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::path::Path;

pub(crate) fn apply(
    db: &mut Connection,
    profile: &Path,
    command: ProjectFileCommand,
    host: bool,
    skills: &[Prompt],
) -> Result<Value> {
    if !host
        && !matches!(
            &command,
            ProjectFileCommand::ReviewAutomation { .. }
                | ProjectFileCommand::ReviewPlugin { .. }
                | ProjectFileCommand::ReadPlugin { .. }
        )
    {
        return Err("Prepare a proposal for the user to review; agent tools cannot approve or execute project changes.".into());
    }
    if let ProjectFileCommand::CreatePlugin {
        project_id,
        slug,
        files: bundle,
    }
    | ProjectFileCommand::UpdatePlugin {
        project_id,
        slug,
        files: bundle,
        ..
    } = &command
    {
        uuid::Uuid::parse_str(project_id)?;
        let root = profile.join("projects").join(project_id);
        let project: ProjectDefinition = parse(
            "project.json",
            &files::read(&root, "project.json", MANIFEST_LIMIT)?,
        )?;
        if project.id != *project_id || project.archived {
            return Err("Project is missing or archived".into());
        }
        let globals = skills.iter().map(|s| format!("global:{}", s.id)).collect();
        let id = match &command {
            ProjectFileCommand::UpdatePlugin {
                expected_hash,
                remove,
                ..
            } => files::update_plugin(&root, slug, expected_hash, bundle, remove, &globals)?,
            _ => files::create_plugin(&root, slug, bundle, &globals)?,
        };
        index::refresh(db, profile, skills)?;
        return Ok(json!({"id":id}));
    }
    if let ProjectFileCommand::SaveDefinition {
        project_id,
        path,
        content,
        expected_hash,
    } = &command
    {
        let source_hash = index::save_definition(
            db,
            profile,
            project_id,
            path,
            content.as_bytes(),
            expected_hash.as_deref(),
            skills,
        )?;
        return Ok(json!({"sourceHash":source_hash,"sourcePath":path}));
    }
    if let ProjectFileCommand::EditRepository {
        project_id,
        expected_hash,
        change,
    } = command
    {
        uuid::Uuid::parse_str(&project_id)?;
        index::refresh(db, profile, skills)?;
        let root = profile.join("projects").join(&project_id);
        let mut definition: ProjectDefinition = parse(
            "project.json",
            &files::read(&root, "project.json", MANIFEST_LIMIT)?,
        )?;
        let mut paths = std::collections::BTreeMap::new();
        match change {
            catalog::RepositoryChange::Add { path } => {
                let id = uuid::Uuid::new_v4().to_string();
                let name = Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Repository")
                    .to_owned();
                definition.repositories.push(RepositoryDefinition {
                    id: id.clone(),
                    name,
                    remote: None,
                });
                paths.insert(id, path);
            }
            catalog::RepositoryChange::Relink { id, path } => {
                paths.insert(id, path);
            }
            catalog::RepositoryChange::Remove { id } => {
                if index::catalog(db, Some(&project_id))?
                    .repository_users
                    .get(&id)
                    .is_some_and(|users| !users.is_empty())
                {
                    return Err(
                        "Remove this repository from its automations and tools first".into(),
                    );
                }
                if !definition.repositories.iter().any(|r| r.id == id) {
                    return Err("Repository is not declared in this project".into());
                }
                definition.repositories.retain(|r| r.id != id);
            }
        }
        let source_hash = index::save_project(
            db,
            profile,
            &definition,
            Some(&expected_hash),
            paths,
            skills,
        )?;
        return Ok(json!({"sourceHash":source_hash,"sourcePath":"project.json"}));
    }
    if let ProjectFileCommand::SaveProject {
        definition,
        expected_hash,
        repository_paths,
    } = command
    {
        let source_hash = index::save_project(
            db,
            profile,
            &definition,
            expected_hash.as_deref(),
            repository_paths,
            skills,
        )?;
        return Ok(json!({"sourceHash":source_hash,"sourcePath":"project.json"}));
    }
    index::refresh(db, profile, skills)?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let result = match command {
        ProjectFileCommand::ReadPlugin { id, path } => {
            let (project, manifest): (String, String) = tx.query_row(
                "SELECT project_id,source_path FROM plugins WHERE id=?",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let root = profile.join("projects").join(project);
            let prefix = manifest
                .strip_suffix("/plugin.json")
                .ok_or("Invalid plugin location")?;
            match path {
                Some(path) => {
                    relative_path(&path)?;
                    let bytes = files::read(&root, &format!("{prefix}/{path}"), ENTRYPOINT_LIMIT)?;
                    let content = std::str::from_utf8(&bytes).map_err(
                        |_| "This file is binary; use its declared tool to work with it",
                    )?;
                    serde_json::to_value(PluginTextFile {
                        id,
                        path,
                        source_hash: hash(&bytes),
                        content: content.into(),
                    })?
                }
                None => {
                    let package = files::package_files(&root, prefix)?;
                    let source_hash = hash(&serde_json::to_vec(&package)?);
                    let mut counts = [0usize; 3];
                    let entries = package
                        .into_iter()
                        .map(|(path, hash)| {
                            match files::definition_table(&path) {
                                Some("project_skills") => counts[0] += 1,
                                Some("tools") => counts[1] += 1,
                                Some("plugins" | "automations") => {}
                                _ => counts[2] += 1,
                            }
                            PluginLibraryFile {
                                path: path
                                    .strip_prefix(&format!("{prefix}/"))
                                    .unwrap_or(&path)
                                    .into(),
                                source_hash: hash,
                            }
                        })
                        .collect::<Vec<_>>();
                    let summary = [
                        ("skill", "skills"),
                        ("tool", "tools"),
                        ("supporting file", "supporting files"),
                    ]
                    .into_iter()
                    .zip(counts)
                    .filter(|(_, count)| *count > 0)
                    .map(|((singular, plural), count)| {
                        format!("{count} {}", if count == 1 { singular } else { plural })
                    })
                    .collect::<Vec<_>>()
                    .join(" · ");
                    serde_json::to_value(PluginLibrary {
                        id,
                        summary,
                        source_hash,
                        files: entries,
                    })?
                }
            }
        }
        ProjectFileCommand::ReviewPlugin { id } => {
            serde_json::to_value(index::review_plugin(&tx, profile, &id, skills)?)?
        }
        ProjectFileCommand::ApprovePlugin {
            ref id,
            ref expected_inputs_hash,
            enable,
        }
        | ProjectFileCommand::ApproveAutomation {
            ref id,
            ref expected_inputs_hash,
            enable,
        } => {
            let approval = match &command {
                ProjectFileCommand::ApprovePlugin { .. } => index::Approval::Plugin(id),
                _ => index::Approval::Automation(id),
            };
            index::approve(&tx, profile, approval, expected_inputs_hash, enable, skills)?;
            json!({"id":id})
        }
        ProjectFileCommand::DisablePlugin { id } => {
            tx.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL WHERE automation_id IN (SELECT id FROM automations WHERE plugin_id=?)",[&id])?;
            json!({"id":id})
        }
        ProjectFileCommand::ReviewAutomation { id } => {
            let inputs = index::execution_inputs(&tx, profile, &id, skills)?;
            let fingerprint = hash(&serde_json::to_vec(&inputs)?);
            let approved: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM automation_state WHERE automation_id=? AND approved_hash=? AND inputs_changed=0)",
                params![id, fingerprint],
                |row| row.get(0),
            )?;
            serde_json::to_value(AutomationReview {
                connections: inferay_core::connections::ConnectionAccess::from_snapshot(&inputs)?,
                id,
                inputs_hash: fingerprint,
                approved,
                git_write_paths: serde_json::from_value(
                    inputs
                        .get("gitWritePaths")
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                )?,
                inputs,
            })?
        }
        ProjectFileCommand::DisableAutomation { id } => {
            index::disable_automation(&tx, &id)?;
            json!({"id":id})
        }
        ProjectFileCommand::RunAutomation { id, request_id } => {
            json!({"id":project_runs::prepare_file_run(&tx,profile,&id,&request_id,None,None,skills)?})
        }
        ProjectFileCommand::RetryRun { id, request_id } => {
            let automation: String = tx.query_row("SELECT automation_id FROM runs WHERE id=? AND status IN ('failed','interrupted','cancelled','waiting_input')", [&id], |r|r.get(0))?;
            let next = project_runs::prepare_file_run(
                &tx,
                profile,
                &automation,
                &request_id,
                None,
                Some(&id),
                skills,
            )?;
            tx.execute("UPDATE runs SET status='cancelled',stop_requested_at=?1,finished_at=?1 WHERE id=?2 AND status='waiting_input'",params![now(),id])?;
            json!({"id":next})
        }
        ProjectFileCommand::StopRun { id } => {
            if tx.execute("UPDATE runs SET stop_requested_at=?1,status=CASE WHEN status IN ('queued','waiting_input') THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status IN ('queued','waiting_input') THEN ?1 ELSE finished_at END WHERE id=?2 AND status IN ('queued','running','waiting_input')", params![now(),id])? != 1 {
                return Err("Run is no longer active".into());
            }
            event(&tx, &id, "stop_requested", &json!({}))?;
            json!({"id":id})
        }
        ProjectFileCommand::AssociateConversation {
            project_id,
            pane_id,
        } => {
            inferay_core::projects::bounded_text(&pane_id, 200, true)?;
            if !tx.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id=? AND valid=1 AND coalesce(json_extract(body,'$.archived'),0)=0)", [&project_id], |r|r.get::<_,bool>(0))? {
                return Err("Project is missing, invalid or archived".into());
            }
            tx.execute("INSERT INTO project_conversations VALUES(?,?) ON CONFLICT(pane_id) DO UPDATE SET project_id=excluded.project_id",params![pane_id,project_id])?;
            json!({"id":pane_id})
        }
        ProjectFileCommand::EditRepository { .. }
        | ProjectFileCommand::SaveProject { .. }
        | ProjectFileCommand::SaveDefinition { .. }
        | ProjectFileCommand::CreatePlugin { .. }
        | ProjectFileCommand::UpdatePlugin { .. } => {
            unreachable!("definition writes handled before transaction")
        }
    };
    tx.commit()?;
    Ok(result)
}
