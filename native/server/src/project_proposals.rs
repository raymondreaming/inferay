//! Durable chat decisions. A saved intent precedes filesystem publication so
//! retries can recognize completed writes without applying the proposal twice.
use crate::{
    project_definitions as files, project_file_commands,
    project_file_store::FileProjectStore,
    project_index,
    project_store::{Result, hash},
};
use inferay_core::{project_files::*, prompts::Prompt};
use rusqlite::{OptionalExtension, params};
use std::collections::BTreeMap;

pub(crate) fn resolve(
    store: &mut FileProjectStore,
    request: ProjectProposalRequest,
    skills: &[Prompt],
) -> Result<ProjectProposalView> {
    if request.message_id.is_empty() || request.message_id.len() > 2048 {
        return Err("Proposal message identity is required and must fit within 2048 bytes".into());
    }
    let (project_id, target, package) = match &request.command {
        ProjectFileCommand::CreatePlugin {
            project_id, slug, ..
        }
        | ProjectFileCommand::UpdatePlugin {
            project_id, slug, ..
        } => {
            relative_path(slug)?;
            if slug.contains('/') || slug.starts_with('.') {
                return Err("Invalid plugin folder".into());
            }
            (project_id, format!("plugins/{slug}"), true)
        }
        command @ ProjectFileCommand::SaveDefinition {
            project_id, path, ..
        } => {
            proposed_automation(command)?;
            (project_id, path.clone(), false)
        }
        _ => {
            return Err(
                "Only plugin and automation definition proposals have save decisions".into(),
            );
        }
    };
    uuid::Uuid::parse_str(project_id)?;
    let command_hash = hash(&serde_json::to_vec(&request.command)?);
    let receipt: Option<(String, String, Option<String>, Option<String>)> = store.db.query_row(
        "SELECT command_hash,state,output_hash,entity_id FROM project_proposals WHERE message_id=?",
        [&request.message_id],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
    ).optional()?;
    if let Some((previous_hash, state, output_hash, entity_id)) = receipt {
        if previous_hash != command_hash {
            return Err(
                "This proposal message already refers to different contents; prepare a new card"
                    .into(),
            );
        }
        match state.as_str() {
            "saved" => {
                return Ok(ProjectProposalView {
                    status: ProjectProposalStatus::Saved,
                    entity_id,
                });
            }
            "declined" => {
                return Ok(ProjectProposalView {
                    status: ProjectProposalStatus::Declined,
                    entity_id: None,
                });
            }
            "applying" => {
                let root = store.project_dir(project_id)?;
                let path = files::managed_path(&root, &target, false)?;
                if path.try_exists()? {
                    let actual = if package {
                        hash(&serde_json::to_vec(&files::package_files(&root, &target)?)?)
                    } else {
                        hash(&files::read(&root, &target, MANIFEST_LIMIT)?)
                    };
                    if output_hash.as_deref() == Some(&actual) {
                        // Publication succeeded before a crash or failed response.
                        // Reindex first so approvals are revoked before reporting success.
                        project_index::refresh(&mut store.db, &store.root, skills)?;
                        store.db.execute(
                            "UPDATE project_proposals SET state='saved' WHERE message_id=?",
                            [&request.message_id],
                        )?;
                        return Ok(ProjectProposalView {
                            status: ProjectProposalStatus::Saved,
                            entity_id,
                        });
                    }
                }
            }
            _ => return Err("Invalid stored proposal state".into()),
        }
    }
    let Some(decision) = request.decision else {
        return Ok(ProjectProposalView {
            status: ProjectProposalStatus::Pending,
            entity_id: None,
        });
    };
    if decision == ProjectProposalDecision::Decline {
        store.db.execute(
            "INSERT INTO project_proposals(message_id,command_hash,project_id,state) VALUES(?,?,?,'declined')
             ON CONFLICT(message_id) DO UPDATE SET state='declined',output_hash=NULL,entity_id=NULL",
            params![request.message_id, command_hash, project_id],
        )?;
        return Ok(ProjectProposalView {
            status: ProjectProposalStatus::Declined,
            entity_id: None,
        });
    }
    let root = store.project_dir(project_id)?;
    let globals = skills
        .iter()
        .map(|skill| format!("global:{}", skill.id))
        .collect();
    let (output_hash, entity_id) = match &request.command {
        ProjectFileCommand::CreatePlugin {
            slug,
            files: bundle,
            ..
        } => {
            files::validate_bundle(&root, slug, bundle, &globals)?;
            let manifest: PluginDefinition =
                parse("plugin.json", bundle["plugin.json"].as_bytes())?;
            let hashes: BTreeMap<_, _> = bundle
                .iter()
                .map(|(path, content)| (format!("{target}/{path}"), hash(content.as_bytes())))
                .collect();
            (hash(&serde_json::to_vec(&hashes)?), manifest.id)
        }
        ProjectFileCommand::UpdatePlugin {
            slug,
            expected_hash,
            files: changes,
            remove,
            ..
        } => {
            let candidate = files::prepare_plugin_update(
                &root,
                slug,
                expected_hash,
                changes,
                remove,
                &globals,
            )?;
            let manifest: PluginDefinition = parse("plugin.json", &candidate["plugin.json"])?;
            let hashes: BTreeMap<_, _> = candidate
                .iter()
                .map(|(path, bytes)| (format!("{target}/{path}"), hash(bytes)))
                .collect();
            (hash(&serde_json::to_vec(&hashes)?), manifest.id)
        }
        command @ ProjectFileCommand::SaveDefinition {
            content,
            expected_hash,
            ..
        } => {
            let definition = proposed_automation(command)?;
            files::validate_write(&root, &target, content.as_bytes(), &globals)?;
            let path = files::managed_path(&root, &target, false)?;
            let current = if path.try_exists()? {
                Some(hash(&files::read(&root, &target, MANIFEST_LIMIT)?))
            } else {
                None
            };
            if current.as_deref() != expected_hash.as_deref() {
                return Err(
                    "Automation changed; prepare a proposal from its current sourceHash".into(),
                );
            }
            (hash(content.as_bytes()), definition.id)
        }
        _ => unreachable!(),
    };
    // The mutex and profile lease serialize application writers. The durable
    // intent survives a crash between publishing files and recording completion.
    store.db.execute(
        "INSERT INTO project_proposals(message_id,command_hash,project_id,state,output_hash,entity_id)
         VALUES(?,?,?,'applying',?,?)
         ON CONFLICT(message_id) DO UPDATE SET state='applying',output_hash=excluded.output_hash,entity_id=excluded.entity_id",
        params![request.message_id, command_hash, project_id, output_hash, entity_id],
    )?;
    project_file_commands::apply(&mut store.db, &store.root, request.command, true, skills)?;
    store.db.execute(
        "UPDATE project_proposals SET state='saved' WHERE message_id=?",
        [&request.message_id],
    )?;
    Ok(ProjectProposalView {
        status: ProjectProposalStatus::Saved,
        entity_id: Some(entity_id),
    })
}

#[cfg(test)]
mod tests;
