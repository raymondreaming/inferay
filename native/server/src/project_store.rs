//! One writer for durable projects, resources and automation intent.
use inferay_core::projects::*;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    path::{Path, PathBuf},
};
use uuid::Uuid;
pub(crate) type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub(crate) fn now() -> i64 {
    crate::unix_millis() as i64
}
pub(crate) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(crate) struct ProjectStore {
    pub db: Connection,
    pub root: PathBuf,
    _lease: File,
}
impl ProjectStore {
    pub fn open(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root)?;
        let lease = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("projects.lock"))?;
        lease
            .try_lock()
            .map_err(|_| "This Inferay profile is already open in another process")?;
        let db = open_database(root)?;
        db.execute_batch("UPDATE runs SET status=CASE WHEN stop_requested_at IS NULL THEN 'interrupted' ELSE 'cancelled' END, finished_at=CAST(strftime('%s','now') AS INTEGER)*1000, error='Execution interrupted; inspect its output before retrying' WHERE status='running';")?;
        Ok(Self {
            db,
            root: root.canonicalize()?,
            _lease: lease,
        })
    }
    pub fn project_dir(&self, id: &str) -> Result<PathBuf> {
        project_directory(&self.db, &self.root, id)
    }
    pub fn catalog(&self, project: Option<&str>, before: Option<&str>) -> Result<ProjectCatalog> {
        let projects = rows(
            &self.db,
            "SELECT json_object('id',id,'name',name,'description',description,'instructions',instructions,'revision',revision,'createdAt',created_at,'updatedAt',updated_at,'archived',json(CASE WHEN archived=1 THEN 'true' ELSE 'false' END),'directory',?1||'/projects/'||id) FROM projects ORDER BY created_at,id LIMIT 256",
            [self.root.to_string_lossy().as_ref()],
        )?;
        let project = project.unwrap_or("");
        let resources = rows(
            &self.db,
            "SELECT json_object('id',r.id,'projectId',coalesce(r.project_id,''),'typeId',r.type_id,'name',r.name,'revision',r.revision,'schemaVersion',v.schema_version,'body',json(v.body),'archived',json(CASE WHEN r.archived=1 THEN 'true' ELSE 'false' END)) FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id=?1 ORDER BY r.type_id,r.name,r.id LIMIT 512",
            [project],
        )?;
        let automations = rows(
            &self.db,
            "SELECT json_object('id',id,'projectId',project_id,'name',name,'revision',revision,'execution',json(execution),'inputsChanged',json(CASE WHEN inputs_changed=1 THEN 'true' ELSE 'false' END),'intervalSeconds',interval_seconds,'calendar',json(calendar),'enabled',json(CASE WHEN enabled=1 THEN 'true' ELSE 'false' END),'nextDueAt',next_due_at,'overlapPolicy',overlap_policy,'archived',json(CASE WHEN archived=1 THEN 'true' ELSE 'false' END)) FROM automations WHERE project_id=?1 ORDER BY name,id LIMIT 256",
            [project],
        )?;
        let ProjectHistory {
            runs,
            artifacts,
            has_more_runs,
            next_run_cursor,
        } = crate::project_runs::history(&self.db, &self.root, project, before)?;
        let plugins = rows(
            &self.db,
            "SELECT json_object('id',id,'projectId',project_id,'name',name,'version',version,'enabled',json(CASE WHEN enabled=1 THEN 'true' ELSE 'false' END),'directory',directory) FROM plugins WHERE project_id=?1 ORDER BY name LIMIT 100",
            [project],
        )?;
        let conversation_projects = self
            .db
            .prepare("SELECT pane_id,project_id FROM project_conversations LIMIT 4096")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<std::collections::BTreeMap<_, _>, _>>()?;
        let repository_paths = self.db.prepare("SELECT json_extract(v.body,'$.location.path') FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id=? AND r.type_id='inferay.repository' AND r.archived=0 LIMIT 512")?.query_map([project],|r|r.get(0))?.collect::<std::result::Result<Vec<String>,_>>()?;
        let resource_types = rows(
            &self.db,
            "SELECT json_object('id',t.type_id,'version',t.version,'schema',json(t.schema),'enabled',json(CASE WHEN p.enabled=1 THEN 'true' ELSE 'false' END)) FROM resource_types t JOIN plugins p ON p.id=t.plugin_id WHERE p.project_id=? ORDER BY t.type_id,t.version LIMIT 256",
            [project],
        )?;
        Ok(ProjectCatalog {
            resource_types,
            conversation_projects,
            repository_paths,
            projects,
            resources,
            automations,
            runs,
            artifacts,
            plugins,
            has_more_runs,
            next_run_cursor,
            root: self.root.to_string_lossy().into(),
        })
    }
    /// Validate an automation using the save path, rolling back all writes.
    pub fn preview_automation(&mut self, command: ProjectCommand) -> Result<()> {
        if !matches!(command, ProjectCommand::SaveAutomation { .. }) {
            return Err("Only automation saves can be previewed".into());
        }
        let tx = self.db.transaction()?;
        apply(&tx, &self.root, command, &[])?;
        tx.rollback()?;
        Ok(())
    }
    pub fn command(
        &mut self,
        command: ProjectCommand,
        host: bool,
        skills: &[inferay_core::prompts::Prompt],
    ) -> Result<Value> {
        if !host
            && matches!(
                command,
                ProjectCommand::EnableAutomation { .. }
                    | ProjectCommand::RunAutomation { .. }
                    | ProjectCommand::RetryRun { .. }
                    | ProjectCommand::EnablePlugin { .. }
                    | ProjectCommand::InstallPlugin { .. }
                    | ProjectCommand::ArchiveProject { .. }
            )
        {
            return Err("This action requires the user's Projects panel. Prepare the definition, then ask the user to run or enable it there.".into());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let invalidates = match &command {
            ProjectCommand::SaveResource { project_id, .. }
            | ProjectCommand::WriteFile { project_id, .. } => Some(project_id.clone()),
            ProjectCommand::SaveProject { id, .. } => id.clone(),
            _ => None,
        };
        if !host
            && matches!(&command, ProjectCommand::SaveResource{type_id,..} if type_id=="inferay.skill")
        {
            return Err("Use the existing skill proposal tool and approval card".into());
        }
        let out = apply(&tx, &self.root, command, skills)?;
        if let Some(project) = invalidates {
            tx.execute("UPDATE automations SET enabled=0,inputs_changed=1,next_due_at=NULL,revision=revision+1 WHERE project_id=? AND enabled=1",[project])?;
        }
        tx.commit()?;
        Ok(out)
    }
}
pub(crate) fn open_database(root: &Path) -> Result<Connection> {
    let db = Connection::open(root.join("projects.sqlite3"))?;
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > 3 {
        return Err("Project database is newer than this Inferay build".into());
    }
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    if version == 3 {
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )?;
        return Ok(db);
    }
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,instructions TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS plugins(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,version TEXT NOT NULL,directory TEXT NOT NULL,manifest_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS resource_types(type_id TEXT NOT NULL,version INTEGER NOT NULL,plugin_id TEXT REFERENCES plugins(id),schema TEXT NOT NULL CHECK(json_valid(schema)),PRIMARY KEY(plugin_id,type_id,version));
CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),type_id TEXT NOT NULL,name TEXT NOT NULL,revision INTEGER NOT NULL,plugin_id TEXT REFERENCES plugins(id),archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS resource_revisions(resource_id TEXT NOT NULL REFERENCES resources(id),revision INTEGER NOT NULL,schema_version INTEGER NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),content_hash TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(resource_id,revision));
CREATE INDEX IF NOT EXISTS project_resources ON resources(project_id,type_id,archived,id);
CREATE TABLE IF NOT EXISTS automations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,revision INTEGER NOT NULL,execution TEXT NOT NULL CHECK(json_valid(execution)),interval_seconds INTEGER,enabled INTEGER NOT NULL DEFAULT 0,next_due_at INTEGER,overlap_policy TEXT NOT NULL CHECK(overlap_policy IN ('skip','queue_one')),archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS automation_approvals(automation_id TEXT PRIMARY KEY REFERENCES automations(id),snapshot_hash TEXT NOT NULL,approved_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS due_automations ON automations(enabled,next_due_at);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),automation_id TEXT NOT NULL REFERENCES automations(id),name TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,occurrence_at INTEGER,retry_of TEXT REFERENCES runs(id),status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','waiting_input','cancelled','interrupted','skipped')),snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),input_hash TEXT NOT NULL,requested_at INTEGER NOT NULL,started_at INTEGER,finished_at INTEGER,stop_requested_at INTEGER,result TEXT,error TEXT);
CREATE INDEX IF NOT EXISTS project_runs ON runs(project_id,requested_at DESC,id);
CREATE INDEX IF NOT EXISTS pending_runs ON runs(status,requested_at);
CREATE TABLE IF NOT EXISTS run_events(run_id TEXT NOT NULL REFERENCES runs(id),sequence INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,sequence));
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),run_id TEXT NOT NULL REFERENCES runs(id),name TEXT NOT NULL,path TEXT NOT NULL,byte_size INTEGER NOT NULL,content_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_conversations(pane_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id));
CREATE TABLE IF NOT EXISTS project_migrations(name TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
")?;
    if version < 2 {
        db.execute_batch("ALTER TABLE automations ADD COLUMN calendar TEXT CHECK(calendar IS NULL OR json_valid(calendar)); PRAGMA user_version=2;")?;
    }
    let has_inputs_changed: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('automations') WHERE name='inputs_changed')",
        [],
        |r| r.get(0),
    )?;
    if !has_inputs_changed {
        db.execute_batch(
            "ALTER TABLE automations ADD COLUMN inputs_changed INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    Ok(db)
}
pub(crate) fn rows<T: serde::de::DeserializeOwned>(
    db: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<Vec<T>> {
    let mut stmt = db.prepare(sql)?;
    let values = stmt.query_map(params, |r| r.get::<_, String>(0))?;
    values.map(|s| Ok(serde_json::from_str(&s?)?)).collect()
}
pub(crate) fn active_project(db: &Connection, id: &str) -> Result<()> {
    if !db.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id=? AND archived=0)",
        [id],
        |r| r.get::<_, bool>(0),
    )? {
        return Err("Project is missing or archived".into());
    }
    Ok(())
}
pub(crate) fn project_directory(db: &Connection, root: &Path, id: &str) -> Result<PathBuf> {
    active_project(db, id)?;
    if Uuid::parse_str(id).is_err() {
        return Err("Invalid project ID".into());
    }
    let dir = root.join("projects").join(id);
    std::fs::create_dir_all(&dir)?;
    let canonical = dir.canonicalize()?;
    if !canonical.starts_with(root) {
        return Err("Project path escapes managed storage".into());
    }
    Ok(canonical)
}
pub(crate) fn resolve_path(root: &Path, path: &ProjectPath) -> Result<PathBuf> {
    match path {
        ProjectPath::External { path } => {
            let p = PathBuf::from(path);
            if !p.is_absolute() {
                return Err("External path must be absolute".into());
            }
            Ok(p.canonicalize()?)
        }
        ProjectPath::Project { path } => {
            if path != "." && !inferay_core::path_security::is_safe_relative_path(path) {
                return Err("Use a project-relative path without parent traversal".into());
            }
            let p = root.join(path).canonicalize()?;
            if !p.starts_with(root) {
                return Err("Path escapes the project directory".into());
            }
            Ok(p)
        }
    }
}
pub(crate) fn resource(db: &Connection, id: &str, project: &str) -> Result<ProjectResource> {
    let mut result = rows(
        db,
        "SELECT json_object('id',r.id,'projectId',coalesce(r.project_id,''),'typeId',r.type_id,'name',r.name,'revision',r.revision,'schemaVersion',v.schema_version,'body',json(v.body),'archived',json('false')) FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision LEFT JOIN plugins p ON p.id=r.plugin_id WHERE r.id=?1 AND (r.project_id=?2 OR r.project_id IS NULL) AND r.archived=0 AND (p.id IS NULL OR p.enabled=1)",
        params![id, project],
    )?;
    result.pop().ok_or_else(|| {
        "Resource is missing, archived, disabled, or belongs to another project".into()
    })
}
fn changed(n: usize) -> Result<()> {
    if n == 1 {
        Ok(())
    } else {
        Err("Record changed or is unavailable. Refresh before saving.".into())
    }
}
pub(crate) fn event(db: &Connection, id: &str, kind: &str, payload: &Value) -> Result<()> {
    db.execute("INSERT INTO run_events SELECT ?1,coalesce(max(sequence),0)+1,?2,?3,?4 FROM run_events WHERE run_id=?1",params![id,kind,payload.to_string(),now()])?;
    Ok(())
}
// One shared write boundary for UI resources and plugin imports.
#[allow(clippy::too_many_arguments)]
pub(crate) fn save_resource(
    db: &Connection,
    project: &str,
    id: Option<String>,
    expected: Option<i64>,
    kind: &str,
    name: &str,
    body: Value,
    version: i64,
    plugin: Option<&str>,
) -> Result<String> {
    active_project(db, project)?;
    bounded_text(name, 200, true)?;
    if body.to_string().len() > 131_072 || !body.is_object() {
        return Err("Resource must be a JSON object under 128 KiB".into());
    }
    let mut schema_plugin = None;
    if kind.starts_with("brand.") {
        let schema = match kind {
            "brand.brand" => {
                json!({"type":"object","properties":{"description":{"type":"string"},"voice":{"type":"string"},"parentBrandId":{"type":"string"}}})
            }
            "brand.mind" => {
                json!({"type":"object","required":["brandId"],"properties":{"brandId":{"type":"string"},"instructions":{"type":"string"},"knowledge":{"type":"array","maxItems":1000}}})
            }
            "brand.genome" => {
                json!({"type":"object","required":["brandId"],"properties":{"brandId":{"type":"string"},"colors":{"type":"array","items":{"type":"string"}},"typography":{"type":"array","items":{"type":"string"}},"rules":{"type":"array","items":{"type":"string"}}}})
            }
            _ => return Err("Unknown brand resource type".into()),
        };
        validate_json(&schema, &body)?;
    }
    match kind {
        "inferay.repository" => {
            let p: ProjectPath = serde_json::from_value(
                body.get("location")
                    .cloned()
                    .ok_or("Repository location required")?,
            )?;
            if let ProjectPath::External { path } = p
                && !Path::new(&path).is_absolute()
            {
                return Err("Absolute repository path required".into());
            }
        }
        "inferay.tool" => {
            let tool: LocalTool = serde_json::from_value(body.clone())?;
            bounded_text(&tool.program, 1024, true)?;
            if !(1..=3600).contains(&tool.timeout_seconds) || tool.arguments.len() > 64 {
                return Err("Invalid tool limits".into());
            }
            for arg in &tool.arguments {
                bounded_text(arg, 8000, false)?;
            }
            validate_schema_definition(&tool.input_schema, 0)?;
            validate_schema_definition(&tool.output_schema, 0)?;
        }
        "brand.brand" => {
            if let Some(parent) = body["parentBrandId"].as_str() {
                let mut cursor = Some(parent.to_string());
                let mut seen = std::collections::HashSet::new();
                while let Some(key) = cursor {
                    if id.as_deref() == Some(&key) || !seen.insert(key.clone()) {
                        return Err("Brand parent cycle".into());
                    }
                    let p = resource(db, &key, project)?;
                    if p.type_id != "brand.brand" {
                        return Err("Parent must be a Brand".into());
                    }
                    cursor = p.body["parentBrandId"].as_str().map(str::to_owned);
                }
            }
        }
        "brand.mind" | "brand.genome" => {
            let brand = body["brandId"].as_str().ok_or("Select a Brand")?;
            if resource(db, brand, project)?.type_id != "brand.brand" {
                return Err("brandId must name a Brand".into());
            }
            let count:i64=db.query_row("SELECT count(*) FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id=?1 AND r.type_id=?2 AND r.archived=0 AND json_extract(v.body,'$.brandId')=?3 AND r.id<>?4",params![project,kind,brand,id.as_deref().unwrap_or("")],|r|r.get(0))?;
            if count > 0 {
                return Err("This Brand already has a primary record of this type".into());
            }
        }
        "inferay.skill" => {
            return Err("Create or edit skills through the existing Skills library".into());
        }
        _ => {
            let (schema,owner):(String,String)=db.query_row("SELECT t.schema,t.plugin_id FROM resource_types t JOIN plugins p ON p.id=t.plugin_id WHERE t.type_id=?1 AND t.version=?2 AND p.project_id=?3",params![kind,version,project],|r|Ok((r.get(0)?,r.get(1)?))).optional()?.ok_or("Unknown resource type/version")?;
            schema_plugin = Some(owner);
            validate_json(&serde_json::from_str::<Value>(&schema)?, &body)?;
        }
    }
    if (kind.starts_with("inferay.") || kind.starts_with("brand.")) && version != 1 {
        return Err("Unsupported built-in schema version".into());
    }
    let plugin = plugin.or(schema_plugin.as_deref());
    let key = id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let revision = expected.unwrap_or(0) + 1;
    if let Some(old) = expected {
        changed(db.execute("UPDATE resources SET name=?1,revision=?2,plugin_id=coalesce(?7,plugin_id) WHERE id=?3 AND project_id=?4 AND type_id=?5 AND revision=?6 AND archived=0",params![name,revision,key,project,kind,old,plugin])?)?;
    } else {
        db.execute("INSERT INTO resources(id,project_id,type_id,name,revision,plugin_id) VALUES(?1,?2,?3,?4,1,?5)",params![key,project,kind,name,plugin])?;
    }
    let text = body.to_string();
    db.execute(
        "INSERT INTO resource_revisions VALUES(?1,?2,?3,?4,?5,?6)",
        params![key, revision, version, text, hash(text.as_bytes()), now()],
    )?;
    Ok(key)
}
fn apply(
    db: &Connection,
    root: &Path,
    command: ProjectCommand,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<Value> {
    match command {
        ProjectCommand::SaveProject {
            id,
            expected_revision,
            name,
            description,
            instructions,
            repository_paths,
        } => {
            bounded_text(&name, 200, true)?;
            bounded_text(&description, 8000, false)?;
            bounded_text(&instructions, 64_000, false)?;
            let key = id.unwrap_or_else(|| Uuid::new_v4().to_string());
            if let Some(revision) = expected_revision {
                changed(db.execute("UPDATE projects SET name=?1,description=?2,instructions=?3,revision=revision+1,updated_at=?4 WHERE id=?5 AND revision=?6 AND archived=0",params![name,description,instructions,now(),key,revision])?)?;
            } else {
                db.execute(
                    "INSERT INTO projects VALUES(?1,?2,?3,?4,1,?5,?5,0)",
                    params![key, name, description, instructions, now()],
                )?;
            }
            if let Some(paths) = repository_paths {
                if paths.len() > 128 {
                    return Err("Choose at most 128 repositories".into());
                }
                let paths: std::collections::BTreeSet<_> = paths.into_iter().collect();
                for path in &paths {
                    bounded_text(path, 4096, true)?;
                    if !Path::new(path).is_absolute() {
                        return Err("Absolute repository path required".into());
                    }
                }
                let linked: Vec<(String, Option<String>)> = db.prepare("SELECT r.id,json_extract(v.body,'$.location.path') FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id=? AND r.type_id='inferay.repository' AND r.archived=0")?
                    .query_map([&key], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
                for (id, path) in &linked {
                    if !path.as_ref().is_some_and(|p| paths.contains(p)) {
                        db.execute("UPDATE resources SET archived=1 WHERE id=?", [id])?;
                    }
                }
                for path in &paths {
                    if !linked.iter().any(|(_, p)| p.as_ref() == Some(path)) {
                        let name = Path::new(path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("Repository");
                        save_resource(
                            db,
                            &key,
                            None,
                            None,
                            "inferay.repository",
                            name,
                            json!({"location":{"base":"external","path":path},"instructions":""}),
                            1,
                            None,
                        )?;
                    }
                }
            }
            let dir = project_directory(db, root, &key)?;
            for p in ["tools", "files", "plugins", "runs"] {
                std::fs::create_dir_all(dir.join(p))?;
            }
            Ok(json!({"id":key}))
        }
        ProjectCommand::ArchiveProject {
            id,
            expected_revision,
        } => {
            changed(db.execute("UPDATE projects SET archived=1,revision=revision+1,updated_at=? WHERE id=? AND revision=?",params![now(),id,expected_revision])?)?;
            db.execute(
                "UPDATE automations SET enabled=0,revision=revision+1 WHERE project_id=?",
                [&id],
            )?;
            db.execute("UPDATE runs SET stop_requested_at=?1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE project_id=?2 AND status IN ('queued','running')",params![now(),id])?;
            Ok(json!({"id":id}))
        }
        ProjectCommand::SaveResource {
            id,
            project_id,
            expected_revision,
            type_id,
            name,
            body,
            schema_version,
        } => Ok(
            json!({"id":save_resource(db,&project_id,id,expected_revision,&type_id,&name,body,schema_version,None)?}),
        ),
        ProjectCommand::ArchiveResource {
            id,
            expected_revision,
        } => {
            changed(db.execute(
                "UPDATE resources SET archived=1 WHERE id=? AND revision=? AND archived=0 AND project_id IS NOT NULL",
                params![id, expected_revision],
            )?)?;
            Ok(json!({"id":id}))
        }
        ProjectCommand::WriteFile {
            project_id,
            path,
            content,
            expected_hash,
        } => {
            bounded_text(&content, 1_000_000, false)?;
            let dir = project_directory(db, root, &project_id)?;
            write_file(&dir, &path, &content, expected_hash.as_deref())?;
            Ok(json!({"path":dir.join(path)}))
        }
        ProjectCommand::SaveAutomation {
            id,
            project_id,
            expected_revision,
            name,
            execution,
            interval_seconds,
            calendar,
            overlap_policy,
        } => {
            active_project(db, &project_id)?;
            bounded_text(&name, 200, true)?;
            validate_execution(&execution)?;
            if let Some(schedule) = &calendar {
                schedule.next_after(now())?;
                if interval_seconds
                    != Some(if schedule.weekday.is_some() {
                        604800
                    } else {
                        86400
                    })
                {
                    return Err("Calendar schedule must match daily or weekly frequency".into());
                }
            }
            let calendar_json = calendar.as_ref().map(serde_json::to_string).transpose()?;
            if interval_seconds.is_some_and(|s| !(60..=31_536_000).contains(&s)) {
                return Err("Interval must be between 60 seconds and one year".into());
            }
            if !["skip", "queue_one"].contains(&overlap_policy.as_str()) {
                return Err("Unsupported overlap policy".into());
            }
            if let ProjectExecution::Tool { tool_id, .. } = &execution
                && resource(db, tool_id, &project_id)?.type_id != "inferay.tool"
            {
                return Err("Choose a Tool resource".into());
            }
            let key = id.unwrap_or_else(|| Uuid::new_v4().to_string());
            let text = serde_json::to_string(&execution)?;
            if let Some(rev) = expected_revision {
                changed(db.execute("UPDATE automations SET name=?1,execution=?2,interval_seconds=?3,overlap_policy=?4,revision=revision+1,enabled=0,inputs_changed=1,next_due_at=NULL WHERE id=?5 AND project_id=?6 AND revision=?7 AND archived=0",params![name,text,interval_seconds,overlap_policy,key,project_id,rev])?)?;
            } else {
                db.execute("INSERT INTO automations(id,project_id,name,revision,execution,interval_seconds,overlap_policy) VALUES(?1,?2,?3,1,?4,?5,?6)",params![key,project_id,name,text,interval_seconds,overlap_policy])?;
            }
            db.execute(
                "UPDATE automations SET calendar=? WHERE id=?",
                params![calendar_json, key],
            )?;
            Ok(json!({"id":key}))
        }
        ProjectCommand::EnableAutomation {
            id,
            expected_revision,
            enabled,
        } => {
            let next = if enabled {
                let (interval, calendar): (Option<i64>, Option<String>) = db.query_row(
                    "SELECT interval_seconds,calendar FROM automations WHERE id=?",
                    [&id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                Some(match calendar {
                    Some(text) => {
                        serde_json::from_str::<CalendarSchedule>(&text)?.next_after(now())?
                    }
                    None => now() + interval.ok_or("Choose a schedule first")? * 1000,
                })
            } else {
                None
            };
            changed(db.execute("UPDATE automations SET enabled=?1,inputs_changed=CASE WHEN ?1 THEN 0 ELSE inputs_changed END,next_due_at=?2,revision=revision+1 WHERE id=?3 AND revision=?4 AND archived=0 AND (NOT ?1 OR interval_seconds IS NOT NULL) AND project_id IN (SELECT id FROM projects WHERE archived=0)",params![enabled,next,id,expected_revision])?)?;
            if enabled {
                let (project, revision, text): (String, i64, String) = db.query_row(
                    "SELECT project_id,revision,execution FROM automations WHERE id=?",
                    [&id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?;
                let snapshot = capture_snapshot(db, root, &project, revision, &text, skills)?;
                db.execute("INSERT INTO automation_approvals VALUES(?1,?2,?3) ON CONFLICT(automation_id) DO UPDATE SET snapshot_hash=excluded.snapshot_hash,approved_at=excluded.approved_at",params![id,hash(snapshot.to_string().as_bytes()),now()])?;
            }
            Ok(json!({"id":id}))
        }
        ProjectCommand::ArchiveAutomation {
            id,
            expected_revision,
        } => {
            changed(db.execute("UPDATE automations SET enabled=0,archived=1,revision=revision+1,next_due_at=NULL WHERE id=? AND revision=?",params![id,expected_revision])?)?;
            Ok(json!({"id":id}))
        }
        ProjectCommand::RunAutomation { id, request_id } => {
            Ok(json!({"id":prepare_run(db,root,&id,&request_id,None,None,skills)?}))
        }
        ProjectCommand::RetryRun { id, request_id } => {
            let automation:String=db.query_row("SELECT automation_id FROM runs WHERE id=? AND status IN ('failed','interrupted','cancelled','waiting_input')",[&id],|r|r.get(0))?;
            db.execute("UPDATE runs SET status='cancelled',stop_requested_at=?1,finished_at=?1 WHERE id=?2 AND status='waiting_input'",params![now(),id])?;
            Ok(json!({"id":prepare_run(db,root,&automation,&request_id,None,Some(&id),skills)?}))
        }
        ProjectCommand::StopRun { id } => {
            changed(db.execute("UPDATE runs SET stop_requested_at=?1,status=CASE WHEN status IN ('queued','waiting_input') THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status IN ('queued','waiting_input') THEN ?1 ELSE finished_at END WHERE id=?2 AND status IN ('queued','running','waiting_input')",params![now(),id])?)?;
            event(db, &id, "stop_requested", &json!({}))?;
            Ok(json!({"id":id}))
        }
        ProjectCommand::AssociateConversation {
            project_id,
            pane_id,
        } => {
            active_project(db, &project_id)?;
            bounded_text(&pane_id, 200, true)?;
            db.execute("INSERT INTO project_conversations VALUES(?1,?2) ON CONFLICT(pane_id) DO UPDATE SET project_id=excluded.project_id",params![pane_id,project_id])?;
            Ok(json!({"id":pane_id}))
        }
        ProjectCommand::InstallPlugin { project_id, path } => {
            install_plugin(db, root, &project_id, &path)
        }
        ProjectCommand::EnablePlugin { id, enabled } => {
            changed(db.execute(
                "UPDATE plugins SET enabled=? WHERE id=?",
                params![enabled, id],
            )?)?;
            Ok(json!({"id":id}))
        }
        ProjectCommand::CreateExample { project_id } => create_example(db, root, &project_id),
    }
}
pub(crate) fn write_file(
    root: &Path,
    path: &str,
    content: &str,
    expected: Option<&str>,
) -> Result<()> {
    if !inferay_core::path_security::is_safe_relative_path(path)
        || !["tools/", "files/", "plugins/"]
            .iter()
            .any(|p| path.starts_with(p))
    {
        return Err("Write inside tools/, files/, or plugins/ using a relative path".into());
    }
    crate::project_definitions::write(root, path, content.as_bytes(), expected)?;
    Ok(())
}
fn capture_snapshot(
    db: &Connection,
    root: &Path,
    project: &str,
    revision: i64,
    text: &str,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<Value> {
    let dir = project_directory(db, root, project)?;
    let execution: ProjectExecution = serde_json::from_str(text)?;
    let mut snapshot = json!({"execution":execution,"automationRevision":revision,"projectInstructions":db.query_row("SELECT instructions FROM projects WHERE id=?",[&project],|r|r.get::<_,String>(0))?});
    match &execution {
        ProjectExecution::Tool { tool_id, input } => {
            let res = resource(db, tool_id, project)?;
            let tool: LocalTool = serde_json::from_value(res.body.clone())?;
            validate_json(&tool.input_schema, input)?;
            let file = resolve_path(&dir, &tool.entrypoint)?;
            let bytes = std::fs::read(&file)?;
            if bytes.len() > 1_000_000 {
                return Err("Tool entrypoint exceeds 1 MB".into());
            }
            snapshot["tool"] = serde_json::to_value(tool)?;
            snapshot["toolRevision"] = json!(res.revision);
            snapshot["entrypointHash"] = json!(hash(&bytes));
            snapshot["entrypoint"] = json!(file);
        }
        ProjectExecution::Agent {
            resource_ids,
            skill_ids,
            ..
        } => {
            let mut context = Vec::new();
            for id in resource_ids {
                context.push(serde_json::to_value(resource(db, id, project)?)?);
            }
            snapshot["resources"] = json!(context);
            let mut selected = Vec::new();
            for id in skill_ids {
                selected.push(
                    skills
                        .iter()
                        .find(|s| &s.id == id)
                        .ok_or("Selected skill is missing from the Skills library")?,
                );
            }
            snapshot["skills"] = serde_json::to_value(selected)?;
        }
    }
    Ok(snapshot)
}

pub(crate) fn prepare_run(
    db: &Connection,
    root: &Path,
    automation: &str,
    key: &str,
    occurrence: Option<i64>,
    retry: Option<&str>,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<String> {
    if let Some(id) = crate::project_runs::existing(db, automation, key)? {
        return Ok(id);
    }
    let (project,name,revision,text,overlap):(String,String,i64,String,String)=db.query_row("SELECT project_id,name,revision,execution,overlap_policy FROM automations WHERE id=? AND archived=0",[automation],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
    active_project(db, &project)?;
    let (snapshot, mut preflight_error) = match capture_snapshot(
        db, root, &project, revision, &text, skills,
    ) {
        Ok(snapshot) => (snapshot, None),
        Err(error) => (
            json!({"execution":serde_json::from_str::<Value>(&text)?,"automationRevision":revision}),
            Some(error.to_string()),
        ),
    };
    let approved: Option<String> = db
        .query_row(
            "SELECT snapshot_hash FROM automation_approvals WHERE automation_id=?",
            [automation],
            |r| r.get(0),
        )
        .optional()?;
    // Run now is not a way around invalidated approval. A new manual task can
    // run on the user's direct request; a previously approved/changed task must
    // first have its current inputs reviewed through the enable action.
    if occurrence.is_some() || approved.is_some() {
        if approved.as_deref() != Some(hash(snapshot.to_string().as_bytes()).as_str()) {
            preflight_error =
                Some("Execution inputs need approval. Review and enable before running.".into());
            db.execute(
                "UPDATE automations SET enabled=0,inputs_changed=1,next_due_at=NULL,revision=revision+1 WHERE id=?",
                [automation],
            )?;
        }
    }
    crate::project_runs::enqueue(
        db,
        crate::project_runs::RunIntent {
            project: &project,
            automation,
            name: &name,
            request_key: key,
            occurrence,
            retry,
            overlap: &overlap,
            snapshot,
            preflight_error,
        },
    )
}

fn create_example(db: &Connection, root: &Path, project: &str) -> Result<Value> {
    let dir = project_directory(db, root, project)?;
    let script = "import json, os, pathlib, sys\ndata = json.load(sys.stdin)\nout = pathlib.Path(os.environ['INFERAY_RUN_OUTPUT'])\nreport = out / 'report.txt'\nreport.write_text('Project report\\n' + data.get('message', 'Hello from Inferay') + '\\n')\nprint(json.dumps({'message': 'Report created', 'artifacts': ['report.txt']}))\n";
    let path = format!("tools/report-{}/main.py", Uuid::new_v4());
    write_file(&dir, &path, script, None)?;
    let tool = save_resource(
        db,
        project,
        None,
        None,
        "inferay.tool",
        "Local report",
        json!({"program":"python3","entrypoint":{"base":"project","path":path},"arguments":[],"timeoutSeconds":30,"inputSchema":{"type":"object"},"outputSchema":{"type":"object"}}),
        1,
        None,
    )?;
    let execution = ProjectExecution::Tool {
        tool_id: tool.clone(),
        input: json!({"message":"A local project, a reusable tool, and a durable run."}),
    };
    let id = Uuid::new_v4().to_string();
    db.execute("INSERT INTO automations(id,project_id,name,revision,execution,interval_seconds,overlap_policy) VALUES(?1,?2,'Weekly report example',1,?3,604800,'skip')",params![id,project,serde_json::to_string(&execution)?])?;
    Ok(json!({"id":id,"toolId":tool}))
}
fn install_plugin(db: &Connection, root: &Path, project: &str, path: &str) -> Result<Value> {
    let dir = project_directory(db, root, project)?;
    let source = Path::new(path).canonicalize()?;
    let bytes = std::fs::read(source.join("plugin.json"))?;
    if bytes.len() > 131072 {
        return Err("Plugin manifest too large".into());
    }
    let manifest: Value = serde_json::from_slice(&bytes)?;
    let name = manifest["name"].as_str().ok_or("Plugin name required")?;
    let version = manifest["version"]
        .as_str()
        .ok_or("Plugin version required")?;
    let id = Uuid::new_v4().to_string();
    let target = dir.join("plugins").join(&id);
    if target.starts_with(&source) {
        return Err("Plugin source cannot contain its installation directory".into());
    }
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(dir.join("plugins"))?;
    let mut total = 0u64;
    for (count, entry) in walkdir::WalkDir::new(&source)
        .follow_links(false)
        .into_iter()
        .enumerate()
    {
        let entry = entry?;
        if count > 1000 || entry.file_type().is_symlink() {
            return Err("Plugin must contain at most 1000 entries and no symlinks".into());
        }
        let relative = entry.path().strip_prefix(&source)?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let dest = staging.path().join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(dest)?;
        } else {
            total += entry.metadata()?.len();
            if total > 50_000_000 {
                return Err("Plugin exceeds 50 MB".into());
            }
            std::fs::copy(entry.path(), dest)?;
        }
    }
    db.execute(
        "INSERT INTO plugins VALUES(?1,?2,?3,?4,?5,?6,0)",
        params![
            id,
            project,
            name,
            version,
            target.to_string_lossy(),
            hash(&bytes)
        ],
    )?;
    if let Some(types) = manifest["types"].as_array() {
        for t in types {
            let kind = t["id"].as_str().ok_or("Type id required")?;
            if kind.starts_with("inferay.") || kind.starts_with("brand.") {
                return Err("Reserved type namespace".into());
            }
            bounded_text(kind, 200, true)?;
            if !kind.contains('.')
                || !kind
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
            {
                return Err("Use a namespaced type ID such as studio.brief".into());
            }
            let schema_version = t["version"].as_i64().unwrap_or(1);
            if schema_version < 1 {
                return Err("Schema version must be positive".into());
            }
            if db.query_row("SELECT EXISTS(SELECT 1 FROM resource_types t JOIN plugins p ON p.id=t.plugin_id WHERE p.project_id=?1 AND t.type_id=?2 AND t.version=?3)",params![project,kind,schema_version],|r|r.get::<_,bool>(0))? {return Err("Type version already installed in this project; use a new version".into());}
            validate_schema_definition(&t["schema"], 0)?;
            db.execute(
                "INSERT INTO resource_types VALUES(?1,?2,?3,?4)",
                params![
                    kind,
                    t["version"].as_i64().unwrap_or(1),
                    id,
                    t["schema"].to_string()
                ],
            )?;
        }
    }
    if let Some(resources) = manifest["resources"].as_array() {
        for r in resources {
            let kind = r["typeId"].as_str().ok_or("Resource typeId required")?;
            let mut body = r["body"].clone();
            if kind == "inferay.tool" {
                let path = body["entrypoint"]["path"]
                    .as_str()
                    .ok_or("Tool entrypoint path required")?;
                if !inferay_core::path_security::is_safe_relative_path(path) {
                    return Err("Plugin entrypoint must be relative".into());
                }
                body["entrypoint"] =
                    json!({"base":"project","path":format!("plugins/{id}/{path}")});
            }
            save_resource(
                db,
                project,
                None,
                None,
                kind,
                r["name"].as_str().ok_or("Resource name required")?,
                body,
                r["schemaVersion"].as_i64().unwrap_or(1),
                Some(&id),
            )?;
        }
    }
    std::fs::rename(staging.path(), &target)?;
    Ok(json!({"id":id,"message":"Installed disabled. Enable in Projects when ready."}))
}
