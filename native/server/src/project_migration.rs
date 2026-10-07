//! One-time export of database-owned definitions. Sources are preserved until the
//! index schema replaces them; exported files are never overwritten on retry.
use crate::{
    project_definitions as files,
    project_store::{Result, hash, now, rows},
};
use inferay_core::{
    project_files::*,
    projects::{LocalTool, ProjectExecution, ProjectPath},
    prompts::Prompt,
};
use rusqlite::{Connection, params};
use serde_json::Value;
use std::{collections::BTreeSet, fs, path::Path};
use uuid::Uuid;

/// Commit the ownership handover only after the export completed. Runtime IDs
/// deliberately have no foreign keys to the rebuildable definition index.
pub(crate) fn replace_definition_tables(db: &mut Connection) -> Result<()> {
    if !db.is_autocommit() {
        return Err("Definition migration requires its own transaction".into());
    }
    let exported: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM project_migrations WHERE name='file-definitions-export-v1')",
        [],
        |r| r.get(0),
    )?;
    if !exported {
        return Err("Definitions must be exported before replacing their tables".into());
    }
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version >= 3 {
        return Ok(());
    }
    db.pragma_update(None, "foreign_keys", false)?;
    let result = (|| -> Result<()> {
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        // Preserve column definitions, checks, indexes and every row while
        // removing only references to definition tables. Child references to
        // runs remain intact because the original table is never renamed.
        for table in ["runs", "artifacts", "project_conversations"] {
            let sql: String = tx.query_row(
                "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?",
                [table],
                |r| r.get(0),
            )?;
            let indexes: Vec<String> = tx.prepare(
                "SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
            )?.query_map([table], |r|r.get(0))?.collect::<std::result::Result<_,_>>()?;
            let replacement = sql
                .replacen(
                    &format!("CREATE TABLE {table}"),
                    &format!("CREATE TABLE migration_{table}"),
                    1,
                )
                .replace(" REFERENCES projects(id)", "")
                .replace(" REFERENCES automations(id)", "");
            if replacement == sql {
                return Err(format!("Unexpected legacy schema for {table}").into());
            }
            tx.execute_batch(&replacement)?;
            tx.execute_batch(&format!("INSERT INTO migration_{table} SELECT * FROM {table}; DROP TABLE {table}; ALTER TABLE migration_{table} RENAME TO {table};"))?;
            for index in indexes {
                tx.execute_batch(&index)?;
            }
        }
        tx.execute_batch(
            "DROP TABLE automation_approvals;
            DROP TABLE resource_revisions;
            DROP TABLE resource_types;
            DROP TABLE resources;
            DROP TABLE automations;
            DROP TABLE plugins;
            DROP TABLE projects;",
        )?;
        crate::project_index::create_schema(&tx)?;
        let broken: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |r| r.get(0),
        )?;
        if broken {
            return Err("Run history failed its integrity check; migration rolled back".into());
        }
        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;
        Ok(())
    })();
    db.pragma_update(None, "foreign_keys", true)?;
    result
}

fn derived_id(kind: &str, id: &str) -> String {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("inferay:{kind}:{id}").as_bytes(),
    )
    .to_string()
}
fn publish(root: &Path, path: &str, bytes: &[u8]) -> Result<()> {
    match files::read(root, path, PLUGIN_BYTE_LIMIT) {
        Ok(existing) if existing == bytes => Ok(()),
        Ok(_) => Err(format!("Migration conflict at {path}; existing file was preserved").into()),
        Err(e)
            if e.downcast_ref::<std::io::Error>()
                .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) =>
        {
            files::write(root, path, bytes, None)?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}
fn definition(root: &Path, path: &str, value: &impl serde::Serialize) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    files::decode(path, &bytes)?;
    publish(root, path, &bytes)
}
fn copy_tree(source: &Path, root: &Path, destination: &str) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    let canonical_source = source.canonicalize()?;
    if root.join(destination).starts_with(&canonical_source) {
        return Err("Migration destination cannot be inside the copied source".into());
    }
    let mut bytes = 0;
    for (count, entry) in walkdir::WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .enumerate()
    {
        let entry = entry?;
        if count > PLUGIN_ENTRY_LIMIT || entry.file_type().is_symlink() {
            return Err(format!(
                "Cannot migrate {}: too many entries or a symlink",
                source.display()
            )
            .into());
        }
        if entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() {
            return Err("Only ordinary files can be migrated".into());
        }
        bytes += entry.metadata()?.len();
        if bytes > PLUGIN_BYTE_LIMIT as u64 {
            return Err("Migration bundle exceeds 50 MB".into());
        }
        let relative = entry
            .path()
            .strip_prefix(source)?
            .to_str()
            .ok_or("Non-UTF-8 filename")?;
        let content = fs::read(entry.path())?;
        publish(root, &format!("{destination}/{relative}"), &content)?;
    }
    Ok(())
}
fn tool(
    db: &Connection,
    project: &Path,
    project_id: &str,
    plugin: &str,
    id: &str,
    warnings: &mut Vec<String>,
) -> Result<()> {
    let (name, text): (String, String) = db.query_row("SELECT r.name,v.body FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.id=? AND r.project_id=? AND r.type_id='inferay.tool'", params![id,project_id], |r| Ok((r.get(0)?,r.get(1)?)))?;
    let old: LocalTool = serde_json::from_str(&text)?;
    let source = match &old.entrypoint {
        ProjectPath::Project { path } => project.join(path),
        ProjectPath::External { path } => Path::new(path).to_owned(),
    };
    if fs::symlink_metadata(&source)?.file_type().is_symlink() {
        return Err("Tool entrypoint is a symlink".into());
    }
    if fs::metadata(&source)?.len() > ENTRYPOINT_LIMIT as u64 {
        return Err("Tool entrypoint exceeds 1 MB".into());
    }
    let filename = source
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Tool entrypoint filename missing")?;
    let prefix = format!("plugins/{plugin}/tools/{id}");
    // Copy companion scripts/assets, with the same bundle limits as plugin installation.
    copy_tree(
        source.parent().ok_or("Tool parent missing")?,
        project,
        &prefix,
    )?;
    let value = ToolDefinition {
        schema: "inferay.tool/1".into(),
        id: id.into(),
        name,
        program: old.program,
        entrypoint: filename.into(),
        args: old.arguments,
        timeout_seconds: old.timeout_seconds,
        input_schema: old.input_schema,
        output_schema: old.output_schema,
    };
    definition(project, &format!("{prefix}/tool.json"), &value)?;
    if !matches!(&old.working_directory, ProjectPath::Project {path} if path == ".") {
        warnings.push(format!("Tool {id}: review working directory {:?}; migrated tools run in their plugin tool directory",old.working_directory));
    }
    Ok(())
}

/// Called before replacing the legacy schema, never by normal definition writes.
/// A backup made through SQLite includes committed WAL contents.
pub(crate) fn export(db: &mut Connection, root: &Path, skills: &[Prompt]) -> Result<()> {
    let canonical_root = root.canonicalize()?;
    let root = canonical_root.as_path();
    if db.query_row(
        "SELECT EXISTS(SELECT 1 FROM project_migrations WHERE name='file-definitions-export-v1')",
        [],
        |r| r.get::<_, bool>(0),
    )? {
        return Ok(());
    }
    let backup = root.join("projects.pre-files.sqlite3");
    if !backup.exists() {
        let temporary = tempfile::NamedTempFile::new_in(root)?;
        db.backup("main", temporary.path(), None)?;
        temporary.as_file().sync_all()?;
        temporary.persist_noclobber(&backup)?;
        #[cfg(unix)]
        fs::File::open(root)?.sync_all()?;
    }
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS repository_paths(project_id TEXT NOT NULL,repository_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(project_id,repository_id));")?;
    let projects: Vec<Value> = rows(
        &tx,
        "SELECT json_object('id',id,'name',name,'description',description,'instructions',instructions,'archived',archived) FROM projects ORDER BY id",
        [],
    )?;
    for project in projects {
        let id = project["id"].as_str().ok_or("Project ID missing")?;
        Uuid::parse_str(id)?;
        let directory = root.join("projects").join(id);
        fs::create_dir_all(&directory)?;
        if fs::symlink_metadata(&directory)?.file_type().is_symlink() {
            return Err("Project directory is a symlink".into());
        }
        let resources: Vec<Value> = rows(
            &tx,
            "SELECT json_object('id',r.id,'name',r.name,'type',r.type_id,'typeVersion',v.schema_version,'body',json(v.body),'archived',r.archived) FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id=? ORDER BY r.id",
            [id],
        )?;
        let mut repositories = Vec::new();
        let mut warnings = Vec::new();
        for resource in &resources {
            if resource["type"] != "inferay.repository" {
                continue;
            }
            let repo_id = resource["id"].as_str().ok_or("Repository ID missing")?;
            let path = resource["body"]["location"]["path"]
                .as_str()
                .ok_or("Repository path missing")?;
            tx.execute("INSERT INTO repository_paths VALUES(?,?,?) ON CONFLICT(project_id,repository_id) DO NOTHING",params![id,repo_id,path])?;
            if resource["archived"] == 0 {
                repositories.push(RepositoryDefinition {
                    id: repo_id.into(),
                    name: resource["name"].as_str().unwrap_or("Repository").into(),
                    remote: None,
                });
            }
            if resource["body"]["instructions"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
            {
                warnings.push(format!("Repository {repo_id}: review existing repository instructions in the migration backup"));
            }
        }
        let definition_value = ProjectDefinition {
            schema: "inferay.project/1".into(),
            id: id.into(),
            name: project["name"].as_str().unwrap_or("").into(),
            description: project["description"].as_str().unwrap_or("").into(),
            instructions: project["instructions"].as_str().unwrap_or("").into(),
            repositories: repositories.clone(),
            archived: project["archived"] == 1,
        };
        definition(&directory, "project.json", &definition_value)?;
        for resource in &resources {
            let kind = resource["type"].as_str().ok_or("Resource type missing")?;
            if ["inferay.repository", "inferay.tool", "inferay.skill"].contains(&kind) {
                continue;
            }
            let value = ResourceDefinition {
                schema: "inferay.resource/1".into(),
                id: resource["id"].as_str().ok_or("Resource ID missing")?.into(),
                type_id: kind.into(),
                type_version: resource["typeVersion"]
                    .as_u64()
                    .ok_or("Resource version missing")?
                    .try_into()?,
                name: resource["name"].as_str().unwrap_or("").into(),
                archived: resource["archived"] == 1,
                body: resource["body"].clone(),
            };
            definition(
                &directory,
                &format!("resources/{kind}/{}.json", value.id),
                &value,
            )?;
        }
        // Copy first; removal happens only after successful schema handover.
        copy_tree(&directory.join("files"), &directory, "resources/documents")?;
        let automations: Vec<Value> = rows(
            &tx,
            "SELECT json_object('id',id,'name',name,'execution',json(execution),'interval',interval_seconds,'calendar',json(calendar),'overlap',overlap_policy,'archived',archived) FROM automations WHERE project_id=? ORDER BY id",
            [id],
        )?;
        let mut migrated_tools = BTreeSet::new();
        for automation in automations {
            let automation_id = automation["id"].as_str().ok_or("Automation ID missing")?;
            let slug = format!("automation-{automation_id}");
            let plugin = PluginDefinition {schema:"inferay.plugin/1".into(),id:derived_id("automation-plugin",automation_id),name:automation["name"].as_str().unwrap_or("Automation").into(),version:"1".into(),description:"Migrated capability. Review instructions and declare permissions before enabling.".into(),may:BTreeSet::new()};
            definition(&directory, &format!("plugins/{slug}/plugin.json"), &plugin)?;
            let execution = match serde_json::from_value::<ProjectExecution>(
                automation["execution"].clone(),
            )? {
                ProjectExecution::Tool { tool_id, input } => {
                    tool(&tx, &directory, id, &slug, &tool_id, &mut warnings)?;
                    migrated_tools.insert(tool_id.clone());
                    DefinitionExecution::Tool {
                        tool: tool_id,
                        input,
                    }
                }
                ProjectExecution::Agent {
                    instructions,
                    provider,
                    model,
                    reasoning_level,
                    skill_ids,
                    resource_ids,
                    working_directory,
                    timeout_seconds,
                } => {
                    let mut selected = Vec::new();
                    for skill_id in skill_ids {
                        let skill = skills.iter().find(|s| s.id == skill_id).ok_or_else(|| {
                            format!(
                                "Missing skill {skill_id}; migration has not changed its source"
                            )
                        })?;
                        let local_id = if Uuid::parse_str(&skill.id).is_ok() {
                            skill.id.clone()
                        } else {
                            derived_id("skill", &skill.id)
                        };
                        let text = format!(
                            "---\nid: {}\nname: {}\ndescription: {}\ncommand: {}\n---\n{}",
                            local_id,
                            serde_json::to_string(&skill.name)?,
                            serde_json::to_string(&skill.description)?,
                            serde_json::to_string(&skill.command)?,
                            skill.prompt_template
                        );
                        let path = format!("plugins/{slug}/skills/{local_id}.md");
                        files::decode(&path, text.as_bytes())?;
                        publish(&directory, &path, text.as_bytes())?;
                        selected.push(local_id);
                    }
                    let working_directory = match working_directory {
                        ProjectPath::Project { path } => DefinitionDirectory::Project {
                            path: if path == "files" {
                                "resources/documents".into()
                            } else if let Some(suffix) = path.strip_prefix("files/") {
                                format!("resources/documents/{suffix}")
                            } else {
                                path
                            },
                        },
                        ProjectPath::External { path } => {
                            let repository = tx.query_row("SELECT repository_id FROM repository_paths WHERE project_id=? AND path=? LIMIT 1",params![id,path],|r|r.get::<_,String>(0));
                            match repository {
                                Ok(id) => DefinitionDirectory::Repository{id},
                                Err(rusqlite::Error::QueryReturnedNoRows) => return Err(format!("Automation {automation_id}: link working directory {path} to this project before migration").into()),
                                Err(e) => return Err(e.into()),
                            }
                        }
                    };
                    if instructions.contains("/Users/") || instructions.contains("/home/") {
                        warnings.push(format!("Automation {automation_id}: instructions contain absolute paths; replace them with repository references after review"));
                    }
                    DefinitionExecution::Agent {
                        provider,
                        model,
                        reasoning_level,
                        instructions,
                        skills: selected,
                        resources: resource_ids,
                        repositories: repositories.iter().map(|r| r.id.clone()).collect(),
                        working_directory,
                        timeout_seconds,
                    }
                }
            };
            let trigger = if !automation["calendar"].is_null() {
                let calendar: inferay_core::projects::CalendarSchedule =
                    serde_json::from_value(automation["calendar"].clone())?;
                Trigger::Calendar {
                    timezone: calendar.timezone,
                    times: vec![calendar.time],
                    days: calendar
                        .weekday
                        .map(|d| vec![d + 1])
                        .unwrap_or_else(|| (1..=7).collect()),
                }
            } else if let Some(seconds) = automation["interval"].as_u64() {
                Trigger::Interval { seconds }
            } else {
                Trigger::Manual
            };
            let value = AutomationDefinition {
                schema: "inferay.automation/1".into(),
                id: automation_id.into(),
                name: plugin.name.clone(),
                trigger,
                overlap: if automation["overlap"] == "queue_one" {
                    Overlap::QueueOne
                } else {
                    Overlap::Skip
                },
                execution,
                may: BTreeSet::new(),
                archived: automation["archived"] == 1,
            };
            definition(
                &directory,
                &format!("plugins/{slug}/automations/{automation_id}.json"),
                &value,
            )?;
        }
        // Preserve standalone tools as capabilities too.
        for resource in &resources {
            let tool_id = resource["id"].as_str().unwrap();
            if resource["type"] != "inferay.tool" || migrated_tools.contains(tool_id) {
                continue;
            }
            let slug = format!("tool-{tool_id}");
            let plugin = PluginDefinition {
                schema: "inferay.plugin/1".into(),
                id: derived_id("tool-plugin", tool_id),
                name: resource["name"].as_str().unwrap_or("Tool").into(),
                version: "1".into(),
                description: "Migrated local tool".into(),
                may: BTreeSet::new(),
            };
            definition(&directory, &format!("plugins/{slug}/plugin.json"), &plugin)?;
            tool(&tx, &directory, id, &slug, tool_id, &mut warnings)?;
        }
        let plugins: Vec<Value> = rows(
            &tx,
            "SELECT json_object('id',id,'name',name,'version',version,'directory',directory,'manifestHash',manifest_hash) FROM plugins WHERE project_id=? ORDER BY id",
            [id],
        )?;
        for plugin in plugins {
            let plugin_id = plugin["id"].as_str().unwrap();
            let source = Path::new(plugin["directory"].as_str().unwrap());
            let relative = source
                .strip_prefix(&directory)?
                .to_str()
                .ok_or("Invalid plugin path")?;
            if relative.split('/').count() != 2 || !relative.starts_with("plugins/") {
                return Err(
                    "Installed plugin must be directly inside the project's plugins directory"
                        .into(),
                );
            }
            let slug = relative.split('/').nth(1).unwrap();
            let value = PluginDefinition {
                schema: "inferay.plugin/1".into(),
                id: plugin_id.into(),
                name: plugin["name"].as_str().unwrap().into(),
                version: plugin["version"].as_str().unwrap().into(),
                description: "Migrated installed plugin".into(),
                may: BTreeSet::new(),
            };
            let manifest_path = format!("plugins/{slug}/plugin.json");
            let bytes = serde_json::to_vec_pretty(&value)?;
            files::decode(&manifest_path, &bytes)?;
            let existing = files::read(&directory, &manifest_path, MANIFEST_LIMIT)?;
            if existing != bytes {
                let expected = plugin["manifestHash"]
                    .as_str()
                    .ok_or("Missing installed manifest hash")?;
                if hash(&existing) != expected {
                    return Err(format!(
                        "{manifest_path}: installed manifest changed; review before migration"
                    )
                    .into());
                }
                publish(
                    &directory,
                    &format!("plugins/{slug}/.legacy-plugin.json"),
                    &existing,
                )?;
                files::write(&directory, &manifest_path, &bytes, Some(expected))?;
            }
            let types: Vec<Value> = rows(
                &tx,
                "SELECT json_object('id',type_id,'version',version,'schema',json(schema)) FROM resource_types WHERE plugin_id=? ORDER BY type_id,version",
                [plugin_id],
            )?;
            for value in types {
                let type_id = value["id"].as_str().unwrap();
                let version = value["version"].as_u64().ok_or("Invalid schema version")?;
                let path = format!("plugins/{slug}/types/{type_id}@{version}.schema.json");
                definition(&directory, &path, &value["schema"])?;
            }
        }
        if !warnings.is_empty() {
            publish(
                &directory,
                "resources/documents/migration-review.txt",
                warnings.join("\n").as_bytes(),
            )?;
        }
    }
    // Export never carries authorization forward. Old approvals remain only in the backup.
    tx.execute_batch("UPDATE automations SET enabled=0,next_due_at=NULL,inputs_changed=1; DELETE FROM automation_approvals; UPDATE plugins SET enabled=0;")?;
    tx.execute(
        "INSERT INTO project_migrations VALUES('file-definitions-export-v1',?)",
        [now()],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests;
