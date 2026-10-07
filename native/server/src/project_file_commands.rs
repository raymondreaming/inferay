//! File-definition commands and local execution state. The index is never the
//! source of a saved definition; all definition edits pass through its writer.
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
        let id = files::create_plugin(&root, slug, bundle, &globals)?;
        index::refresh(db, profile, skills)?;
        return Ok(json!({"id":id}));
    }
    if let ProjectFileCommand::UpdatePlugin {
        project_id,
        slug,
        expected_hash,
        files: changes,
        remove,
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
        let id = files::update_plugin(&root, slug, expected_hash, changes, remove, &globals)?;
        index::refresh(db, profile, skills)?;
        return Ok(json!({"id": id}));
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
                    let entries = package
                        .into_iter()
                        .map(|(path, hash)| PluginLibraryFile {
                            path: path
                                .strip_prefix(&format!("{prefix}/"))
                                .unwrap_or(&path)
                                .into(),
                            source_hash: hash,
                        })
                        .collect::<Vec<_>>();
                    serde_json::to_value(PluginLibrary {
                        id,
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
            id,
            expected_inputs_hash,
            enable,
        } => {
            let inputs = index::plugin_inputs(&tx, profile, &id, skills)?;
            if hash(&serde_json::to_vec(&inputs)?) != expected_inputs_hash {
                return Err(
                    "Plugin inputs changed since review. Review again before approving.".into(),
                );
            }
            for (automation_id, snapshot) in inputs["automations"]
                .as_object()
                .ok_or("Plugin automations missing")?
            {
                let definition: AutomationDefinition =
                    serde_json::from_value(snapshot["automation"].clone())?;
                index::approve_automation(
                    &tx,
                    profile,
                    automation_id,
                    &hash(&serde_json::to_vec(snapshot)?),
                    enable && !matches!(definition.trigger, Trigger::Manual),
                    skills,
                )?;
            }
            // Recheck the entire bundle after writing approvals; any conflict rolls
            // back every approval and schedule in this transaction.
            if index::plugin_inputs(&tx, profile, &id, skills)? != inputs {
                return Err("Plugin inputs changed while approving".into());
            }
            tx.execute("INSERT INTO plugin_state(plugin_id,approved_hash,approved_at,approved_inputs) VALUES(?,?,?,?) ON CONFLICT(plugin_id) DO UPDATE SET approved_hash=excluded.approved_hash,approved_at=excluded.approved_at,approved_inputs=excluded.approved_inputs",params![id,expected_inputs_hash,now(),inputs.to_string()])?;
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
            json!({"id":id,"inputsHash":fingerprint,"inputs":inputs,"approved":approved})
        }
        ProjectFileCommand::ApproveAutomation {
            id,
            expected_inputs_hash,
            enable,
        } => {
            index::approve_automation(&tx, profile, &id, &expected_inputs_hash, enable, skills)?;
            json!({"id":id})
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
        ProjectFileCommand::LinkRepository {
            project_id,
            repository_id,
            expected_project_hash,
            path,
        } => {
            uuid::Uuid::parse_str(&project_id)?;
            let root = profile.join("projects").join(&project_id);
            let bytes = files::read(&root, "project.json", MANIFEST_LIMIT)?;
            if hash(&bytes) != expected_project_hash {
                return Err("Project changed since review".into());
            }
            let definition: ProjectDefinition = parse("project.json", &bytes)?;
            if definition.archived
                || !definition
                    .repositories
                    .iter()
                    .any(|r| r.id == repository_id)
            {
                return Err("Repository is not declared in this project".into());
            }
            let path = Path::new(&path).canonicalize()?;
            if !path.is_dir() {
                return Err("Repository path must be a directory".into());
            }
            tx.execute("INSERT INTO repository_paths VALUES(?,?,?) ON CONFLICT(project_id,repository_id) DO UPDATE SET path=excluded.path",params![project_id,repository_id,path.to_string_lossy()])?;
            tx.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL,inputs_changed=1,error='Repository location changed. Review before running.' WHERE automation_id IN (SELECT id FROM automations WHERE project_id=?)",[project_id])?;
            json!({"id":repository_id})
        }
        ProjectFileCommand::SaveDefinition { .. }
        | ProjectFileCommand::CreatePlugin { .. }
        | ProjectFileCommand::UpdatePlugin { .. } => {
            unreachable!("definition writes handled before transaction")
        }
    };
    tx.commit()?;
    Ok(result)
}
