use inferay_core::projects::ProjectPath;
use rusqlite::{Connection, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
pub(crate) type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub(crate) fn now() -> i64 {
    crate::unix_millis() as i64
}
pub(crate) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
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

pub(crate) fn event(db: &Connection, id: &str, kind: &str, payload: &Value) -> Result<()> {
    db.execute("INSERT INTO run_events SELECT ?1,coalesce(max(sequence),0)+1,?2,?3,?4 FROM run_events WHERE run_id=?1",params![id,kind,payload.to_string(),now()])?;
    Ok(())
}
