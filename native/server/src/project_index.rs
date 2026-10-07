//! Rebuildable projections of project files. Only this module writes definition tables.
use crate::{
    project_definitions::{self as files, DefinitionFile},
    project_store::{Result, hash},
};
use inferay_core::project_files::*;
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

const TABLES: &[&str] = &[
    "projects",
    "resources",
    "plugins",
    "tools",
    "automations",
    "resource_types",
    "project_skills",
];

pub(crate) fn save_definition(
    db: &mut Connection,
    profile: &Path,
    project: &str,
    path: &str,
    bytes: &[u8],
    expected_hash: Option<&str>,
    globals: &BTreeSet<String>,
) -> Result<String> {
    uuid::Uuid::parse_str(project).map_err(|_| "Invalid project ID")?;
    let root = profile.join("projects").join(project);
    // Creating the project directory is harmless; a failed preview never creates
    // a definition, approval or runnable schedule.
    files::managed_path(profile, &format!("projects/{project}/project.json"), true)?;
    files::validate_write(&root, path, bytes, globals)?;
    let hash = files::write(&root, path, bytes, expected_hash)?;
    refresh(db, profile, globals)?;
    Ok(hash)
}

/// Initialize only after the legacy exporter has succeeded and old definition
/// tables have been removed. Durable runtime tables are owned by the run store.
pub(crate) fn create_schema(db: &Connection) -> Result<()> {
    for table in TABLES {
        db.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {table}(
            id TEXT PRIMARY KEY,project_id TEXT NOT NULL,plugin_id TEXT,
            source_path TEXT NOT NULL,source_hash TEXT,valid INTEGER NOT NULL,error TEXT,
            body TEXT CHECK(body IS NULL OR json_valid(body)),
            UNIQUE(project_id,source_path));
            CREATE INDEX IF NOT EXISTS {table}_project ON {table}(project_id,valid);"
        ))?;
    }
    db.execute_batch("CREATE TABLE IF NOT EXISTS automation_state(
        automation_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,
        next_due_at INTEGER,approved_hash TEXT,approved_at INTEGER,
        inputs_changed INTEGER NOT NULL DEFAULT 0,error TEXT);
        CREATE TABLE IF NOT EXISTS plugin_state(plugin_id TEXT PRIMARY KEY,approved_hash TEXT,approved_at INTEGER);
        CREATE TABLE IF NOT EXISTS repository_paths(project_id TEXT NOT NULL,repository_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(project_id,repository_id));
        CREATE TABLE IF NOT EXISTS definition_errors(project_id TEXT NOT NULL,source_path TEXT NOT NULL,error TEXT NOT NULL,PRIMARY KEY(project_id,source_path));")?;
    Ok(())
}

fn table(path: &str) -> Option<&'static str> {
    let parts: Vec<_> = path.split('/').collect();
    match parts.as_slice() {
        ["project.json"] => Some("projects"),
        ["resources", _, _] => Some("resources"),
        ["plugins", _, "plugin.json"] => Some("plugins"),
        ["plugins", _, "automations", _] => Some("automations"),
        ["plugins", _, "tools", _, "tool.json"] => Some("tools"),
        ["plugins", _, "skills", _] => Some("project_skills"),
        ["plugins", _, "types", _] => Some("resource_types"),
        _ => None,
    }
}
fn body(definition: &DefinitionFile) -> Result<Value> {
    Ok(match definition {
        DefinitionFile::Project(v) => serde_json::to_value(v)?,
        DefinitionFile::Resource(v) => serde_json::to_value(v)?,
        DefinitionFile::Plugin(v) => serde_json::to_value(v)?,
        DefinitionFile::Tool(v) => serde_json::to_value(v)?,
        DefinitionFile::Automation(v) => serde_json::to_value(v)?,
        DefinitionFile::Skill(v) => serde_json::to_value(v)?,
        DefinitionFile::ResourceType(v) => v.clone(),
    })
}

/// Capture the exact file inputs used for approval and admission. Read files
/// again instead of trusting the rebuildable index's last observed hashes.
pub(crate) fn execution_inputs(
    db: &Connection,
    profile: &Path,
    automation: &str,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<Value> {
    let (project, path): (String, String) = db.query_row(
        "SELECT project_id,source_path FROM automations WHERE id=? AND valid=1",
        [automation],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let root = profile.join("projects").join(&project);
    let globals = skills.iter().map(|s| format!("global:{}", s.id)).collect();
    let scanned = files::scan(&root, &globals)?;
    let entry = scanned
        .iter()
        .find(|e| e.path == path)
        .ok_or("Automation file is missing")?;
    if let Some(error) = &entry.error {
        return Err(error.clone().into());
    }
    let Some(DefinitionFile::Automation(definition)) = &entry.definition else {
        return Err("Automation file is invalid".into());
    };
    if definition.id != automation || definition.archived {
        return Err("Automation identity changed or was archived".into());
    }
    let project_entry = scanned
        .iter()
        .find(|e| e.path == "project.json")
        .ok_or("Project file is missing")?;
    let Some(DefinitionFile::Project(project_definition)) = &project_entry.definition else {
        return Err("Project file is invalid".into());
    };
    if project_definition.archived || project_definition.id != project {
        return Err("Project identity changed or was archived".into());
    }
    let prefix = path.split('/').take(2).collect::<Vec<_>>().join("/");
    let package = package_files(&root, &prefix)?;
    let mut inputs = package.clone();
    inputs.insert(
        "project.json".into(),
        project_entry.hash.clone().ok_or("Project hash missing")?,
    );
    let mut selected_skills = BTreeMap::new();
    let mut repositories = BTreeMap::new();
    if let DefinitionExecution::Agent {
        skills: selected,
        resources,
        repositories: selected_repositories,
        working_directory,
        ..
    } = &definition.execution
    {
        for id in resources {
            let entry = scanned
                .iter()
                .find(|e| matches!(&e.definition, Some(DefinitionFile::Resource(r)) if &r.id == id))
                .ok_or("Selected resource is missing")?;
            if let Some(error) = &entry.error {
                return Err(error.clone().into());
            }
            if matches!(&entry.definition, Some(DefinitionFile::Resource(resource)) if resource.archived)
            {
                return Err(format!("Selected resource {id} is archived").into());
            }
            inputs.insert(
                entry.path.clone(),
                entry.hash.clone().ok_or("Resource hash missing")?,
            );
        }
        for id in selected {
            if let Some(global) = id.strip_prefix("global:") {
                let skill = skills
                    .iter()
                    .find(|s| s.id == global)
                    .ok_or("Selected global skill is missing")?;
                selected_skills.insert(id.clone(), hash(&serde_json::to_vec(skill)?));
            }
        }
        let mut ids: BTreeSet<_> = selected_repositories.iter().collect();
        if let DefinitionDirectory::Repository { id } = working_directory {
            ids.insert(id);
        }
        for id in ids {
            let path: String = db
                .query_row(
                    "SELECT path FROM repository_paths WHERE project_id=? AND repository_id=?",
                    params![project, id],
                    |r| r.get(0),
                )
                .map_err(|_| format!("Repository {id} is not linked on this machine"))?;
            let path = Path::new(&path)
                .canonicalize()
                .map_err(|_| format!("Repository {id} is unavailable"))?;
            if !path.is_dir() {
                return Err(format!("Repository {id} is not a directory").into());
            }
            repositories.insert(id.clone(), path.to_string_lossy().into_owned());
        }
    }
    // Detect edits during the capture rather than approving a mixed set of files.
    for (path, expected) in &inputs {
        if hash(&files::read(&root, path, PLUGIN_BYTE_LIMIT)?) != *expected {
            return Err(format!("Execution input changed while reading: {path}").into());
        }
    }
    if package_files(&root, &prefix)? != package {
        return Err("Plugin files changed while capturing execution inputs".into());
    }
    Ok(
        json!({"projectId":project,"automation":definition,"files":inputs,"globalSkills":selected_skills,"repositoryPaths":repositories}),
    )
}

/// Hash all package files, including companion scripts. An entrypoint importing
/// another script must not bypass approval invalidation by leaving tool.json unchanged.
pub(crate) fn package_files(root: &Path, prefix: &str) -> Result<BTreeMap<String, String>> {
    relative_path(prefix)?;
    let mut hashes = BTreeMap::new();
    let mut total = 0usize;
    for (count, entry) in walkdir::WalkDir::new(root.join(prefix))
        .follow_links(false)
        .into_iter()
        .enumerate()
    {
        let entry = entry?;
        if count > PLUGIN_ENTRY_LIMIT {
            return Err("Plugin exceeds 1000 entries".into());
        }
        if entry.file_type().is_symlink() {
            return Err("Plugin contains a symlink".into());
        }
        if entry.file_type().is_dir() {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(root)?
            .to_str()
            .ok_or("Plugin path is not UTF-8")?;
        let bytes = files::read(root, path, PLUGIN_BYTE_LIMIT.saturating_sub(total))?;
        total += bytes.len();
        hashes.insert(path.into(), hash(&bytes));
    }
    Ok(hashes)
}

/// Refresh from disk as one index transaction. Malformed/missing definitions
/// replace old index contents, but runtime history and approval records survive.
pub(crate) fn refresh(
    db: &mut Connection,
    profile: &Path,
    globals: &BTreeSet<String>,
) -> Result<()> {
    let directory = profile.join("projects");
    fs::create_dir_all(&directory)?;
    if fs::symlink_metadata(&directory)?.file_type().is_symlink() {
        return Err("Projects directory cannot be a symlink".into());
    }
    let mut projects = Vec::new();
    for entry in fs::read_dir(&directory)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Project directory is not UTF-8")?;
        if name.starts_with('.') {
            continue;
        }
        if projects.len() >= 256 {
            return Err("Profile exceeds 256 project directories".into());
        }
        if uuid::Uuid::parse_str(&name).is_err() {
            continue;
        }
        projects.push((name, entry.path()));
    }
    projects.sort_by(|a, b| a.0.cmp(&b.0));
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    // Save the old source inventory for targeted invalidation before rebuilding.
    let mut previous = BTreeMap::<(String, String), Option<String>>::new();
    for table in TABLES {
        let mut statement = tx.prepare(&format!(
            "SELECT project_id,source_path,source_hash FROM {table}"
        ))?;
        for row in statement.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))? {
            let (key, value) = row?;
            previous.insert(key, value);
        }
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    tx.execute("DELETE FROM definition_errors", [])?;
    let mut current = BTreeMap::new();
    let mut changed = BTreeSet::new();
    for (project_id, root) in projects {
        let scanned = match files::scan(&root, globals) {
            Ok(scanned) => scanned,
            Err(error) => {
                tx.execute("INSERT INTO projects(id,project_id,source_path,valid,error) VALUES(?,?,'project.json',0,?)",params![project_id,project_id,error.to_string()])?;
                changed.insert(project_id);
                continue;
            }
        };
        let plugins: BTreeMap<String, String> = scanned
            .iter()
            .filter_map(|entry| match &entry.definition {
                Some(DefinitionFile::Plugin(plugin)) => Some((
                    entry.path.rsplit_once('/').unwrap().0.into(),
                    plugin.id.clone(),
                )),
                _ => None,
            })
            .collect();
        for entry in scanned {
            let key = (project_id.clone(), entry.path.clone());
            current.insert(key.clone(), entry.hash.clone());
            if previous.get(&key) != Some(&entry.hash) || entry.error.is_some() {
                changed.insert(project_id.clone());
            }
            let Some(table) = table(&entry.path) else {
                if let Some(error) = entry.error {
                    tx.execute(
                        "INSERT INTO definition_errors VALUES(?,?,?)",
                        params![project_id, entry.path, error],
                    )?;
                }
                continue;
            };
            let owner = entry.path.split('/').take(2).collect::<Vec<_>>().join("/");
            let plugin_id = plugins.get(&owner);
            let value = entry.definition.as_ref().map(body).transpose()?;
            let id = if let Some(definition) = &entry.definition {
                match definition {
                    DefinitionFile::Project(_) => project_id.clone(),
                    DefinitionFile::Skill(_) | DefinitionFile::Tool(_) => format!(
                        "{}/{}",
                        plugin_id.map(String::as_str).unwrap_or(&owner),
                        definition.id()
                    ),
                    DefinitionFile::ResourceType(_) => format!(
                        "{}/{}",
                        plugin_id.map(String::as_str).unwrap_or(&owner),
                        entry.path.rsplit('/').next().unwrap()
                    ),
                    _ => definition.id().to_owned(),
                }
            } else {
                format!(
                    "invalid:{}",
                    hash(format!("{project_id}/{}", entry.path).as_bytes())
                )
            };
            // Keep every conflicting path visible, even when two files carry one ID.
            let exists: bool = tx.query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?)"),
                [&id],
                |r| r.get(0),
            )?;
            let id = if exists {
                format!(
                    "invalid:{}",
                    hash(format!("{project_id}/{}", entry.path).as_bytes())
                )
            } else {
                id
            };
            tx.execute(&format!("INSERT INTO {table}(id,project_id,plugin_id,source_path,source_hash,valid,error,body) VALUES(?,?,?,?,?,?,?,?)"),params![id,project_id,plugin_id,entry.path,entry.hash,entry.error.is_none(),entry.error,value.as_ref().map(Value::to_string)])?;
            if table == "automations" {
                tx.execute(
                    "INSERT OR IGNORE INTO automation_state(automation_id) VALUES(?)",
                    [id],
                )?;
            }
        }
        // Script/assets changes are not represented by definition source hashes.
        for (prefix, plugin_id) in plugins {
            let approved: Option<String> = tx
                .query_row(
                    "SELECT approved_hash FROM plugin_state WHERE plugin_id=?",
                    [&plugin_id],
                    |r| r.get(0),
                )
                .optional()?
                .flatten();
            if let Some(approved) = approved {
                let fingerprint = package_files(&root, &prefix)
                    .map(|files| hash(json!(files).to_string().as_bytes()));
                if fingerprint.as_deref().ok() != Some(approved.as_str()) {
                    changed.insert(project_id.clone());
                }
            }
        }
    }
    for ((project, path), _) in previous {
        if !current.contains_key(&(project.clone(), path)) {
            changed.insert(project);
        }
    }
    for project in changed {
        tx.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL,inputs_changed=1,error='Schedule off: inputs changed. Review and enable.' WHERE enabled=1 AND automation_id IN (SELECT id FROM automations WHERE project_id=?)",[project])?;
    }
    tx.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL,inputs_changed=1,error='Automation file is missing' WHERE enabled=1 AND automation_id NOT IN (SELECT id FROM automations WHERE valid=1)",[])?;
    tx.commit()?;
    Ok(())
}
use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests;
