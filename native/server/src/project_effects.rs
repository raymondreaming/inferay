//! Durable effect proposals captured with run artifacts. No delivery authority is implied.
use crate::project_store::{Result, hash, now};
use inferay_core::projects::EffectIntent;
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) fn create_schema(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS effect_intents(
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
        artifact TEXT NOT NULL, intent_key TEXT NOT NULL, intent TEXT NOT NULL,
        intent_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
        UNIQUE(project_id,intent_key));
        CREATE INDEX IF NOT EXISTS effect_intents_run ON effect_intents(project_id,run_id);")?;
    Ok(())
}

/// Called inside the run's artifact transaction. Conflicting retries fail atomically.
pub(crate) fn capture(db: &Connection, project: &str, run: &str, artifact: &str, bytes: &[u8]) -> Result<()> {
    if !artifact.ends_with(".json") { return Ok(()); }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else { return Ok(()); };
    if value["schema"] != "inferay.effect/1" { return Ok(()); }
    if bytes.len() > 70_000 { return Err("Effect intent artifact exceeds 70 KB".into()); }
    let intent: EffectIntent = serde_json::from_value(value)?;
    intent.validate()?;
    let body = serde_json::to_string(&intent)?;
    let digest = hash(body.as_bytes());
    let previous: Option<String> = db.query_row(
        "SELECT intent_hash FROM effect_intents WHERE project_id=?1 AND intent_key=?2",
        params![project,intent.key], |row| row.get(0),
    ).optional()?;
    if let Some(previous) = previous {
        if previous != digest { return Err("Effect key already exists with different contents; use a new key for a different intent".into()); }
        return Ok(());
    }
    db.execute("INSERT INTO effect_intents VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![uuid::Uuid::new_v4().to_string(),project,run,artifact,intent.key,body,digest,now()])?;
    Ok(())
}
