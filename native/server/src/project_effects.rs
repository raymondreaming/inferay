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
        CREATE INDEX IF NOT EXISTS effect_intents_run ON effect_intents(project_id,run_id);
        CREATE TABLE IF NOT EXISTS effect_dismissals(
            effect_id TEXT PRIMARY KEY REFERENCES effect_intents(id),
            intent_hash TEXT NOT NULL, dismissed_at INTEGER NOT NULL);")?;
    Ok(())
}

pub(crate) fn dismiss(db: &Connection, request: &inferay_core::projects::EffectReviewRequest) -> Result<i64> {
    let digest: String = db.query_row("SELECT intent_hash FROM effect_intents WHERE id=?", [&request.id], |row| row.get(0))?;
    if digest != request.intent_hash { return Err("Effect contents do not match the reviewed intent".into()); }
    db.execute("INSERT INTO effect_dismissals(effect_id,intent_hash,dismissed_at) VALUES(?1,?2,?3) ON CONFLICT(effect_id) DO NOTHING",
        params![request.id,request.intent_hash,now()])?;
    Ok(db.query_row("SELECT dismissed_at FROM effect_dismissals WHERE effect_id=?", [&request.id], |row| row.get(0))?)
}

pub(crate) async fn dismiss_http(state: &crate::ServerState, request: crate::Request) -> crate::ApiResult {
    let input = crate::api_body::<inferay_core::projects::EffectReviewRequest>(request).await?;
    let store = state.projects.store.lock().map_err(|_| crate::api_error(crate::StatusCode::INTERNAL_SERVER_ERROR, "Project store lock failed"))?;
    let dismissed_at = dismiss(&store.db, &input).map_err(|error| crate::api_error(crate::StatusCode::BAD_REQUEST, error))?;
    Ok(serde_json::json!({"dismissedAt":dismissed_at}))
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

/// Pending reviews have their own cursor: old proposals must not age out with runs.
pub(crate) fn inbox(db: &Connection, project: &str, automation: Option<&str>, before: Option<&str>) -> Result<inferay_core::projects::EffectInboxPage> {
    let cursor = before.map(|value| {
        let (time, id) = value.split_once(':').ok_or("Invalid effect cursor")?;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>((time.parse::<i64>()?, id.to_owned()))
    }).transpose()?;
    let mut effects: Vec<inferay_core::projects::ProjectEffectIntent> = crate::project_store::rows(db,
        "SELECT json_object('id',e.id,'runId',e.run_id,'artifact',e.artifact,'intent',json(e.intent),'createdAt',e.created_at,'intentHash',e.intent_hash,'dismissedAt',NULL)
         FROM effect_intents e WHERE e.project_id=?1
         AND NOT EXISTS(SELECT 1 FROM effect_dismissals d WHERE d.effect_id=e.id)
         AND (?2 IS NULL OR EXISTS(SELECT 1 FROM runs r WHERE r.id=e.run_id AND r.automation_id=?2))
         AND (?3 IS NULL OR e.created_at<?3 OR (e.created_at=?3 AND e.id<?4))
         ORDER BY e.created_at DESC,e.id DESC LIMIT 51",
        params![project,automation,cursor.as_ref().map(|c| c.0),cursor.as_ref().map(|c| &c.1)])?;
    let more = effects.len()>50;
    effects.truncate(50);
    let next_cursor = if more { effects.last().map(|e| format!("{}:{}",e.created_at,e.id)) } else { None };
    Ok(inferay_core::projects::EffectInboxPage { effects, next_cursor })
}

pub(crate) async fn inbox_http(state: &crate::ServerState, request: crate::Request) -> crate::ApiResult {
    let project = crate::query_value(&request,"projectId").ok_or_else(|| crate::api_error(crate::StatusCode::BAD_REQUEST,"projectId is required"))?;
    let automation = crate::query_value(&request,"automationId");
    let before = crate::query_value(&request,"before");
    let store = state.projects.store.lock().map_err(|_| crate::api_error(crate::StatusCode::INTERNAL_SERVER_ERROR,"Project store lock failed"))?;
    let page = inbox(&store.db,&project,automation.as_deref(),before.as_deref()).map_err(|e| crate::api_error(crate::StatusCode::BAD_REQUEST,e))?;
    serde_json::to_value(page).map_err(|e| crate::api_error(crate::StatusCode::INTERNAL_SERVER_ERROR,e))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inbox_retains_old_reviews_with_stable_pagination_and_scope() {
        let db = Connection::open_in_memory().unwrap();
        create_schema(&db).unwrap();
        db.execute_batch("CREATE TABLE runs(id TEXT PRIMARY KEY,automation_id TEXT); INSERT INTO runs VALUES('run','job'),('other-run','other-job');").unwrap();
        for index in 0..53 {
            let bytes = serde_json::to_vec(&serde_json::json!({"schema":"inferay.effect/1","key":format!("key-{index}"),"kind":"fixture","target":"test","payload":{}})).unwrap();
            capture(&db,"project","run","intent.json",&bytes).unwrap();
        }
        let bytes = br#"{"schema":"inferay.effect/1","key":"separate","kind":"fixture","target":"test","payload":{}}"#;
        capture(&db,"other-project","other-run","intent.json",bytes).unwrap();
        // Equal timestamps still paginate exactly once using the stable ID tie-break.
        db.execute("UPDATE effect_intents SET created_at=1",[]).unwrap();
        let first = inbox(&db,"project",Some("job"),None).unwrap();
        assert_eq!(first.effects.len(),50);
        let second = inbox(&db,"project",Some("job"),first.next_cursor.as_deref()).unwrap();
        assert_eq!(second.effects.len(),3);
        assert!(second.next_cursor.is_none());
        assert!(second.effects.iter().all(|e| !first.effects.iter().any(|f| f.id==e.id)));
        assert!(inbox(&db,"project",Some("other-job"),None).unwrap().effects.is_empty());
        assert_eq!(inbox(&db,"other-project",None,None).unwrap().effects.len(),1);
        let effect = &second.effects[0];
        dismiss(&db,&inferay_core::projects::EffectReviewRequest{id:effect.id.clone(),intent_hash:effect.intent_hash.clone()}).unwrap();
        assert_eq!(inbox(&db,"project",None,first.next_cursor.as_deref()).unwrap().effects.len(),2);
        assert!(inbox(&db,"project",None,Some("invalid")).is_err());
    }
}
