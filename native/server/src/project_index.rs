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

fn indexed<T: serde::de::DeserializeOwned>(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<IndexedDefinition<T>> {
    let body: Option<String> = row.get(6)?;
    let definition = body
        .map(|body| serde_json::from_str(&body))
        .transpose()
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e))
        })?;
    Ok(IndexedDefinition {
        id: row.get(0)?,
        project_id: row.get(1)?,
        plugin_id: row.get(2)?,
        source_path: row.get(3)?,
        source_hash: row.get(4)?,
        error: row.get(5)?,
        definition,
    })
}

/// Read the indexed file catalog, retaining invalid entries for repair. This
/// does not scan, create directories, approve inputs or advance scheduling.
pub(crate) fn catalog(db: &Connection, project: Option<&str>) -> Result<ProjectFileCatalog> {
    let projects = db.prepare("SELECT id,project_id,plugin_id,source_path,source_hash,error,body FROM projects ORDER BY id LIMIT 256")?
        .query_map([], indexed)?.collect::<std::result::Result<_,_>>()?;
    let project = project.unwrap_or("");
    let resources = db.prepare("SELECT id,project_id,plugin_id,source_path,source_hash,error,body FROM resources WHERE project_id=? ORDER BY source_path LIMIT 512")?
        .query_map([project], indexed)?.collect::<std::result::Result<_,_>>()?;
    let plugins = db.prepare("SELECT p.id,p.project_id,p.plugin_id,p.source_path,p.source_hash,p.error,p.body,s.approved_hash,s.approved_at FROM plugins p LEFT JOIN plugin_state s ON s.plugin_id=p.id WHERE p.project_id=? ORDER BY p.source_path LIMIT 100")?
        .query_map([project], |r| Ok(IndexedPlugin {file:indexed(r)?,approved_hash:r.get(7)?,approved_at:r.get(8)?}))?.collect::<std::result::Result<_,_>>()?;
    let automations = db.prepare("SELECT a.id,a.project_id,a.plugin_id,a.source_path,a.source_hash,a.error,a.body,coalesce(s.enabled,0),s.next_due_at,coalesce(s.inputs_changed,0),s.error FROM automations a LEFT JOIN automation_state s ON s.automation_id=a.id WHERE a.project_id=? ORDER BY a.source_path LIMIT 256")?
        .query_map([project], |r| Ok(IndexedAutomation {file:indexed(r)?,enabled:r.get(7)?,next_due_at:r.get(8)?,inputs_changed:r.get(9)?,execution_error:r.get(10)?}))?.collect::<std::result::Result<_,_>>()?;
    let mut issues = Vec::new();
    for table in TABLES
        .iter()
        .copied()
        .chain(std::iter::once("definition_errors"))
    {
        issues.extend(db.prepare(&format!("SELECT project_id,source_path,error FROM {table} WHERE project_id=? AND error IS NOT NULL ORDER BY source_path"))?
            .query_map([project], |r|Ok(DefinitionIssue {project_id:r.get(0)?,source_path:r.get(1)?,error:r.get(2)?}))?.collect::<std::result::Result<Vec<_>,_>>()?);
    }
    issues.sort_by(|a, b| a.source_path.cmp(&b.source_path));
    let repository_paths = db.prepare("SELECT repository_id,path FROM repository_paths WHERE project_id=? ORDER BY repository_id")?
        .query_map([project], |r|Ok((r.get(0)?,r.get(1)?)))?.collect::<std::result::Result<_,_>>()?;
    Ok(ProjectFileCatalog {
        projects,
        resources,
        plugins,
        automations,
        issues,
        repository_paths,
    })
}

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
    skills: &[inferay_core::prompts::Prompt],
) -> Result<String> {
    uuid::Uuid::parse_str(project).map_err(|_| "Invalid project ID")?;
    let root = profile.join("projects").join(project);
    // Creating the project directory is harmless; a failed preview never creates
    // a definition, approval or runnable schedule.
    files::managed_path(profile, &format!("projects/{project}/project.json"), true)?;
    let globals = skills.iter().map(|s| format!("global:{}", s.id)).collect();
    files::validate_write(&root, path, bytes, &globals)?;
    let hash = files::write(&root, path, bytes, expected_hash)?;
    refresh(db, profile, skills)?;
    Ok(hash)
}

/// Approval is over every captured input, not only automation.json. The caller
/// supplies the digest shown in the user's review, so unseen edits cannot be
/// approved by a stale card. This operation never writes a definition file.
pub(crate) fn approve_automation(
    db: &Connection,
    profile: &Path,
    automation: &str,
    expected_inputs_hash: &str,
    enable: bool,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<()> {
    let inputs = execution_inputs(db, profile, automation, skills)?;
    let fingerprint = hash(&serde_json::to_vec(&inputs)?);
    if fingerprint != expected_inputs_hash {
        return Err(
            "Execution inputs changed since review. Refresh the proposal before approving.".into(),
        );
    }
    let definition: AutomationDefinition = serde_json::from_value(inputs["automation"].clone())?;
    let now = crate::project_store::now();
    let next = if enable {
        Some(
            definition
                .trigger
                .next_after(now)?
                .ok_or("Choose a schedule before enabling")?,
        )
    } else {
        None
    };
    db.execute("INSERT INTO automation_state(automation_id,enabled,next_due_at,approved_hash,approved_at,inputs_changed,error) VALUES(?,?,?,?,?,0,NULL) ON CONFLICT(automation_id) DO UPDATE SET enabled=excluded.enabled,next_due_at=excluded.next_due_at,approved_hash=excluded.approved_hash,approved_at=excluded.approved_at,inputs_changed=0,error=NULL", params![automation,enable,next,fingerprint,now])?;
    Ok(())
}

pub(crate) fn disable_automation(db: &Connection, automation: &str) -> Result<()> {
    if db.execute(
        "UPDATE automation_state SET enabled=0,next_due_at=NULL WHERE automation_id=?",
        [automation],
    )? != 1
    {
        return Err("Automation not found".into());
    }
    Ok(())
}

/// Both Run now and the scheduler use the same approval check. Disabling a
/// schedule preserves its approval and permits an explicitly requested run.
pub(crate) fn approved_inputs(
    db: &Connection,
    profile: &Path,
    automation: &str,
    scheduled: bool,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<Value> {
    let (enabled, approved, changed): (bool, Option<String>, bool) = db.query_row(
        "SELECT enabled,approved_hash,inputs_changed FROM automation_state WHERE automation_id=?",
        [automation],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if scheduled && !enabled {
        return Err("Schedule is off".into());
    }
    let captured = execution_inputs(db, profile, automation, skills);
    let error = match &captured {
        Ok(inputs)
            if !changed
                && approved.as_deref() == Some(hash(&serde_json::to_vec(inputs)?).as_str()) =>
        {
            return captured;
        }
        Ok(_) => "Execution inputs changed or need approval. Review before running.".to_string(),
        Err(error) => error.to_string(),
    };
    db.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL,inputs_changed=1,error=? WHERE automation_id=?", params![error,automation])?;
    Err(error.into())
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
    let root = profile.canonicalize()?.join("projects").join(&project);
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
    for entry in scanned
        .iter()
        .filter(|entry| entry.path.starts_with(&format!("{prefix}/")))
    {
        if entry.hash.as_ref() != package.get(&entry.path) {
            return Err(format!(
                "Definition changed while capturing execution inputs: {}",
                entry.path
            )
            .into());
        }
    }
    let mut inputs = package.clone();
    inputs.insert(
        "project.json".into(),
        project_entry.hash.clone().ok_or("Project hash missing")?,
    );
    let mut selected_skills = BTreeMap::new();
    let mut skill_context = Vec::new();
    let mut resource_context = Vec::new();
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
            if let Some(DefinitionFile::Resource(resource)) = &entry.definition {
                resource_context.push(resource.clone());
            }
        }
        for id in selected {
            if let Some(global) = id.strip_prefix("global:") {
                let skill = skills
                    .iter()
                    .find(|s| s.id == global)
                    .ok_or("Selected global skill is missing")?;
                selected_skills.insert(id.clone(), hash(&serde_json::to_vec(skill)?));
                skill_context
                    .push(json!({"id":id,"name":skill.name,"instructions":skill.prompt_template}));
            } else {
                let skill = scanned
                    .iter()
                    .find_map(|entry| {
                        if entry.path.starts_with(&format!("{prefix}/skills/")) {
                            if let Some(DefinitionFile::Skill(skill)) = &entry.definition {
                                if &skill.id == id {
                                    return Some(skill);
                                }
                            }
                        }
                        None
                    })
                    .ok_or("Selected plugin skill is missing")?;
                skill_context.push(serde_json::to_value(skill)?);
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
    let mut snapshot = json!({"projectId":project,"automation":definition,"files":inputs,"globalSkills":selected_skills,"repositoryPaths":repositories,"projectInstructions":project_definition.instructions,"resources":resource_context,"skills":skill_context});
    use inferay_core::projects::{LocalTool, ProjectExecution, ProjectPath};
    let execution = match &definition.execution {
        DefinitionExecution::Agent {
            provider,
            model,
            reasoning_level,
            instructions,
            skills,
            resources,
            working_directory,
            timeout_seconds,
            ..
        } => {
            let directory = match working_directory {
                DefinitionDirectory::Repository { id } => ProjectPath::External {
                    path: repositories
                        .get(id)
                        .ok_or("Repository binding missing")?
                        .clone(),
                },
                DefinitionDirectory::Project { path } => {
                    ProjectPath::Project { path: path.clone() }
                }
                DefinitionDirectory::Plugin { path } => ProjectPath::Project {
                    path: if path == "." {
                        prefix.clone()
                    } else {
                        format!("{prefix}/{path}")
                    },
                },
            };
            crate::project_store::resolve_path(&root, &directory)?;
            ProjectExecution::Agent {
                instructions: instructions.clone(),
                provider: provider.clone(),
                model: model.clone(),
                reasoning_level: reasoning_level.clone(),
                skill_ids: skills.clone(),
                resource_ids: resources.clone(),
                working_directory: directory,
                timeout_seconds: *timeout_seconds,
            }
        }
        DefinitionExecution::Tool { tool, input } => {
            let directory = format!("{prefix}/tools/{tool}");
            let entry = scanned
                .iter()
                .find(|entry| entry.path == format!("{directory}/tool.json"))
                .ok_or("Selected tool is missing")?;
            let Some(DefinitionFile::Tool(tool)) = &entry.definition else {
                return Err("Selected tool is invalid".into());
            };
            inferay_core::projects::validate_json(&tool.input_schema, input)?;
            let path = format!("{directory}/{}", tool.entrypoint);
            snapshot["entrypointHash"] =
                json!(inputs.get(&path).ok_or("Tool entrypoint hash is missing")?);
            snapshot["entrypoint"] = json!(root.join(&path));
            snapshot["tool"] = serde_json::to_value(LocalTool {
                program: tool.program.clone(),
                entrypoint: ProjectPath::Project { path },
                arguments: tool.args.clone(),
                working_directory: ProjectPath::Project { path: directory },
                timeout_seconds: tool.timeout_seconds,
                input_schema: tool.input_schema.clone(),
                output_schema: tool.output_schema.clone(),
            })?;
            ProjectExecution::Tool {
                tool_id: tool.id.clone(),
                input: input.clone(),
            }
        }
    };
    snapshot["execution"] = serde_json::to_value(execution)?;
    Ok(snapshot)
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
    skills: &[inferay_core::prompts::Prompt],
) -> Result<()> {
    let globals = skills.iter().map(|s| format!("global:{}", s.id)).collect();
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
    for table in TABLES {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    tx.execute("DELETE FROM definition_errors", [])?;
    for (project_id, root) in projects {
        let scanned = match files::scan(&root, &globals) {
            Ok(scanned) => scanned,
            Err(error) => {
                tx.execute("INSERT INTO projects(id,project_id,source_path,valid,error) VALUES(?,?,'project.json',0,?)",params![project_id,project_id,error.to_string()])?;
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
    }
    // Approval covers execution inputs, including selected global skills and
    // companion scripts. Index source hashes alone cannot detect those edits.
    let approved = tx.prepare("SELECT automation_id,approved_hash FROM automation_state WHERE inputs_changed=0 AND (approved_hash IS NOT NULL OR enabled=1)")?
        .query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?)))?
        .collect::<std::result::Result<Vec<_>,_>>()?;
    for (id, expected) in approved {
        let current = execution_inputs(&tx, profile, &id, skills)
            .and_then(|inputs| Ok(hash(&serde_json::to_vec(&inputs)?)));
        if current.as_ref().ok() != expected.as_ref() || expected.is_none() {
            let error = current
                .err()
                .map(|e| e.to_string())
                .unwrap_or_else(|| "Execution inputs changed. Review before running.".into());
            tx.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL,inputs_changed=1,error=? WHERE automation_id=?",params![error,id])?;
        }
    }
    tx.commit()?;
    Ok(())
}
#[cfg(test)]
mod tests;
