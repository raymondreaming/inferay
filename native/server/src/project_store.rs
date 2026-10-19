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

pub(crate) fn database_version(db: &Connection) -> Result<i64> {
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version == 3 {
        return Ok(version);
    }
    if version > 3 {
        return Err("Project database is newer than this Inferay build".into());
    }
    let empty: bool = db.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%')",
        [],
        |r| r.get(0),
    )?;
    if version != 3 && (version != 0 || !empty) {
        return Err("This profile uses an old project format. Open it with the previous Inferay build to finish migration, then reopen it here. No project data was changed.".into());
    }
    Ok(version)
}

pub(crate) fn open_database(root: &Path) -> Result<Connection> {
    let mut db = Connection::open(root.join("projects.sqlite3"))?;
    let version = database_version(&db)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")?;
    if version == 0 {
        let tx = db.transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,automation_id TEXT NOT NULL,name TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,occurrence_at INTEGER,retry_of TEXT REFERENCES runs(id),status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','waiting_input','cancelled','interrupted','skipped')),snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),input_hash TEXT NOT NULL,requested_at INTEGER NOT NULL,started_at INTEGER,finished_at INTEGER,stop_requested_at INTEGER,result TEXT,error TEXT);
CREATE INDEX IF NOT EXISTS project_runs ON runs(project_id,requested_at DESC,id);
CREATE INDEX IF NOT EXISTS pending_runs ON runs(status,requested_at);
CREATE TABLE IF NOT EXISTS run_events(run_id TEXT NOT NULL REFERENCES runs(id),sequence INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,sequence));
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),name TEXT NOT NULL,path TEXT NOT NULL,byte_size INTEGER NOT NULL,content_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_conversations(pane_id TEXT PRIMARY KEY,project_id TEXT NOT NULL);
")?;
        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;
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
