//! Durable run admission, independent of how definitions are stored.
use crate::project_store::{Result, event, hash, now};
use inferay_core::projects::bounded_text;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

pub(crate) fn existing(db: &Connection, automation: &str, key: &str) -> Result<Option<String>> {
    bounded_text(key, 300, true)?;
    let found: Option<(String, String)> = db
        .query_row(
            "SELECT id,automation_id FROM runs WHERE request_key=?",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match found {
        Some((id, owner)) if owner == automation => Ok(Some(id)),
        Some(_) => Err("Request key belongs to another automation".into()),
        None => Ok(None),
    }
}

pub(crate) struct RunIntent<'a> {
    pub project: &'a str,
    pub automation: &'a str,
    pub name: &'a str,
    pub request_key: &'a str,
    pub occurrence: Option<i64>,
    pub retry: Option<&'a str>,
    pub overlap: &'a str,
    pub snapshot: Value,
    pub preflight_error: Option<String>,
}

/// Called within the project writer's transaction. Failed preflight remains a
/// recorded run with evidence; it never enters the execution queue.
pub(crate) fn enqueue(db: &Connection, intent: RunIntent<'_>) -> Result<String> {
    if let Some(id) = existing(db, intent.automation, intent.request_key)? {
        return Ok(id);
    }
    let RunIntent {
        project,
        automation,
        name,
        request_key,
        occurrence,
        retry,
        overlap,
        snapshot,
        mut preflight_error,
    } = intent;
    if let Some(retry) = retry {
        let owner: String =
            db.query_row("SELECT automation_id FROM runs WHERE id=?", [retry], |r| {
                r.get(0)
            })?;
        if owner != automation {
            return Err("Retry belongs to another automation".into());
        }
    }
    let active: i64 = db.query_row("SELECT count(*) FROM runs WHERE automation_id=? AND status IN ('queued','running','waiting_input')", [automation], |r|r.get(0))?;
    let queued: i64 = db.query_row(
        "SELECT count(*) FROM runs WHERE automation_id=? AND status='queued'",
        [automation],
        |r| r.get(0),
    )?;
    let pending: i64 =
        db.query_row("SELECT count(*) FROM runs WHERE status='queued'", [], |r| {
            r.get(0)
        })?;
    if pending >= 64 && preflight_error.is_none() {
        preflight_error = Some("Queue is full (64 pending runs)".into());
    }
    let status = if preflight_error.is_some() {
        "failed"
    } else if occurrence.is_some()
        && ((overlap == "skip" && active > 0) || (overlap == "queue_one" && queued > 0))
    {
        "skipped"
    } else {
        "queued"
    };
    let id = uuid::Uuid::new_v4().to_string();
    let snapshot = snapshot.to_string();
    let time = now();
    db.execute("INSERT INTO runs(id,project_id,automation_id,name,request_key,occurrence_at,retry_of,status,snapshot,input_hash,requested_at,finished_at,error) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![id,project,automation,name,request_key,occurrence,retry,status,snapshot,hash(snapshot.as_bytes()),time,if status=="queued"{None}else{Some(time)},preflight_error])?;
    event(db, &id, status, &json!({"occurrenceAt":occurrence}))?;
    Ok(id)
}

pub(crate) fn prepare_file_run(
    db: &Connection,
    profile: &std::path::Path,
    automation: &str,
    key: &str,
    occurrence: Option<i64>,
    retry: Option<&str>,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<String> {
    if let Some(id) = existing(db, automation, key)? {
        return Ok(id);
    }
    let (project, body): (String, String) = db.query_row(
        "SELECT project_id,body FROM automations WHERE id=?",
        [automation],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let definition: inferay_core::project_files::AutomationDefinition =
        serde_json::from_str(&body)?;
    let (snapshot, preflight_error) = match crate::project_index::approved_inputs(
        db,
        profile,
        automation,
        occurrence.is_some(),
        skills,
    ) {
        Ok(snapshot) => (snapshot, None),
        Err(error) => (json!({"automation":definition}), Some(error.to_string())),
    };
    enqueue(
        db,
        RunIntent {
            project: &project,
            automation,
            name: &definition.name,
            request_key: key,
            occurrence,
            retry,
            overlap: match definition.overlap {
                inferay_core::project_files::Overlap::Skip => "skip",
                inferay_core::project_files::Overlap::QueueOne => "queue_one",
            },
            snapshot,
            preflight_error,
        },
    )
}

/// Process a bounded batch of due schedules. Failed admission may disable a
/// schedule; do not accidentally assign it another due time afterward.
pub(crate) fn schedule_due(
    db: &mut Connection,
    profile: &std::path::Path,
    skills: &[inferay_core::prompts::Prompt],
    time: i64,
) -> Result<()> {
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let due: Vec<(String, i64, String)> = tx.prepare("SELECT a.id,s.next_due_at,a.body FROM automations a JOIN automation_state s ON s.automation_id=a.id JOIN projects p ON p.id=a.project_id WHERE a.valid=1 AND p.valid=1 AND s.enabled=1 AND s.next_due_at<=? AND coalesce(json_extract(a.body,'$.archived'),0)=0 AND coalesce(json_extract(p.body,'$.archived'),0)=0 ORDER BY s.next_due_at,a.id LIMIT 8")?
        .query_map([time], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<std::result::Result<_,_>>()?;
    for (id, occurrence, body) in due {
        let definition: inferay_core::project_files::AutomationDefinition =
            serde_json::from_str(&body)?;
        if let Err(error) = prepare_file_run(
            &tx,
            profile,
            &id,
            &format!("schedule:{id}:{occurrence}"),
            Some(occurrence),
            None,
            skills,
        ) {
            tx.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL,error=? WHERE automation_id=?",params![error.to_string(),id])?;
            continue;
        }
        let next = match definition.trigger {
            inferay_core::project_files::Trigger::Interval { seconds } => {
                let interval = i64::try_from(seconds)?
                    .checked_mul(1000)
                    .ok_or("Schedule interval overflow")?;
                if interval <= 0 {
                    return Err("Schedule interval must be positive".into());
                }
                let elapsed = time
                    .checked_sub(occurrence)
                    .ok_or("Schedule time overflow")?;
                let steps = (elapsed / interval)
                    .checked_add(1)
                    .ok_or("Schedule time overflow")?;
                Some(
                    occurrence
                        .checked_add(
                            steps
                                .checked_mul(interval)
                                .ok_or("Schedule time overflow")?,
                        )
                        .ok_or("Schedule time overflow")?,
                )
            }
            trigger => trigger.next_after(time)?,
        };
        tx.execute(
            "UPDATE automation_state SET next_due_at=? WHERE automation_id=? AND enabled=1",
            params![next, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Claim only after checking today's files against the captured inputs. A run
/// waiting in the queue cannot gain a newer script or skill without review.
pub(crate) fn claim_next(
    db: &mut Connection,
    profile: &std::path::Path,
    skills: &[inferay_core::prompts::Prompt],
) -> Result<Option<(String, String, Value)>> {
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    for _ in 0..8 {
        let queued: Option<(String,String,String,String,bool)> = tx.query_row("SELECT r.id,r.project_id,r.automation_id,r.snapshot,r.occurrence_at IS NOT NULL FROM runs r WHERE r.status='queued' AND r.stop_requested_at IS NULL AND NOT EXISTS(SELECT 1 FROM runs active WHERE active.automation_id=r.automation_id AND active.status='running') ORDER BY r.requested_at,r.id LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
        let Some((id, project, automation, text, scheduled)) = queued else {
            break;
        };
        let snapshot: Value = serde_json::from_str(&text)?;
        let error = match crate::project_index::approved_inputs(
            &tx,
            profile,
            &automation,
            scheduled,
            skills,
        ) {
            Ok(current) if current == snapshot => None,
            Ok(_) => Some("Inputs changed after this run was queued. Review and retry.".to_owned()),
            Err(error) => Some(error.to_string()),
        };
        if let Some(error) = error {
            tx.execute(
                "UPDATE runs SET status='failed',finished_at=?,error=? WHERE id=?",
                params![now(), error, id],
            )?;
            event(
                &tx,
                &id,
                "failed",
                &json!({"error":error,"phase":"admission"}),
            )?;
            continue;
        }
        tx.execute(
            "UPDATE runs SET status='running',started_at=? WHERE id=?",
            params![now(), id],
        )?;
        event(&tx, &id, "running", &json!({}))?;
        tx.commit()?;
        return Ok(Some((id, project, snapshot)));
    }
    tx.commit()?;
    Ok(None)
}

/// History survives definition deletion and migration; it is never rebuilt from files.
pub(crate) fn history(
    db: &Connection,
    root: &std::path::Path,
    project: &str,
    before: Option<&str>,
) -> Result<inferay_core::projects::ProjectHistory> {
    use crate::project_store::rows;
    use inferay_core::projects::ProjectRun;
    let (before_time, before_id) = match before {
        Some(cursor) => {
            let (time, id) = cursor.split_once(':').ok_or("Invalid run cursor")?;
            (time.parse::<i64>()?, id)
        }
        None => (i64::MAX, ""),
    };
    let projection = "SELECT json_object('id',id,'projectId',project_id,'automationId',automation_id,'name',name,'status',status,'requestedAt',requested_at,'startedAt',started_at,'finishedAt',finished_at,'result',json(result),'error',error,'snapshot',json(snapshot),'directory',?2||'/projects/'||project_id||'/runs/'||id) FROM runs";
    let mut runs = rows::<ProjectRun>(
        db,
        &format!("{projection} WHERE project_id=?1 AND status NOT IN ('queued','running') AND (requested_at<?3 OR (requested_at=?3 AND id<?4)) ORDER BY requested_at DESC,id DESC LIMIT 51"),
        params![project, root.to_string_lossy(), before_time, before_id],
    )?;
    let has_more_runs = runs.len() > 50;
    runs.truncate(50);
    let next_run_cursor = if has_more_runs {
        runs.last()
            .map(|run| format!("{}:{}", run.requested_at, run.id))
    } else {
        None
    };
    // Active work is independent of the past-results cursor and cannot age off
    // the latest page while newer runs finish.
    if before.is_none() {
        let mut active = rows::<ProjectRun>(
            db,
            &format!("{projection} WHERE project_id=?1 AND status IN ('queued','running') ORDER BY requested_at DESC,id DESC"),
            params![project, root.to_string_lossy()],
        )?;
        active.append(&mut runs);
        runs = active;
    }
    attach_usage(db, &mut runs)?;
    for run in &mut runs { run.conversation_available = conversation_available(run); }
    let artifacts = rows(
        db,
        "SELECT json_object('id',id,'runId',run_id,'name',name,'path',path,'byteSize',byte_size) FROM artifacts WHERE project_id=?1 AND run_id IN (SELECT value FROM json_each(?2)) ORDER BY created_at DESC,id LIMIT 5000",
        params![
            project,
            serde_json::to_string(&runs.iter().map(|r| &r.id).collect::<Vec<_>>())?
        ],
    )?;
    Ok(inferay_core::projects::ProjectHistory {
        effects: rows(db,
            "SELECT json_object('id',e.id,'runId',e.run_id,'artifact',e.artifact,'intent',json(e.intent),'createdAt',e.created_at,'intentHash',e.intent_hash,'dismissedAt',d.dismissed_at,'delivery',json((SELECT json_object('id',o.id,'state',o.state,'cancellationRequestedAt',c.requested_at,'receipt',json(o.receipt)) FROM effect_outbox o LEFT JOIN effect_cancellations c ON c.delivery_id=o.id WHERE o.effect_id=e.id))) FROM effect_intents e LEFT JOIN effect_dismissals d ON d.effect_id=e.id WHERE e.project_id=?1 AND e.run_id IN (SELECT value FROM json_each(?2)) ORDER BY e.created_at DESC,e.id LIMIT 5000",
            params![project,serde_json::to_string(&runs.iter().map(|r| &r.id).collect::<Vec<_>>())?])?,
        runs,
        artifacts,
        has_more_runs,
        next_run_cursor,
    })
}

/// Shared by history projection and the continuation endpoint. A preflight failure
/// has no transcript, even when its captured execution was an agent task.
pub(crate) fn conversation_available(run: &inferay_core::projects::ProjectRun) -> bool {
    if run.snapshot["execution"]["kind"] != "agent" {
        return false;
    }
    crate::project_definitions::managed_path(std::path::Path::new(&run.directory), "logs/agent.jsonl", false)
        .ok().and_then(|path| std::fs::metadata(path).ok())
        .is_some_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

#[cfg(test)]
mod conversation_tests {
    use super::*;
    #[test]
    fn continuation_requires_an_agent_with_a_retained_log() {
        let directory = tempfile::tempdir().unwrap();
        let mut run: inferay_core::projects::ProjectRun = serde_json::from_value(json!({
            "id":"run", "projectId":"project", "automationId":"automation", "name":"Research",
            "status":"failed", "requestedAt":0,"startedAt":0,"finishedAt":1,
            "result":null,"error":"Missing dependency", "snapshot":{"execution":{"kind":"agent"}},
            "directory":directory.path().to_string_lossy()
        })).unwrap();
        assert!(!conversation_available(&run));
        std::fs::create_dir(directory.path().join("logs")).unwrap();
        let log = directory.path().join("logs/agent.jsonl");
        std::fs::write(&log, "").unwrap();
        assert!(!conversation_available(&run));
        std::fs::write(&log, "{\"system\":\"Provider stopped after beginning work\"}\n").unwrap();
        assert!(conversation_available(&run));
        for status in ["running", "queued"] {
            run.status = status.into();
            assert!(conversation_available(&run));
        }
        for status in ["succeeded", "failed", "cancelled", "interrupted", "waiting_input"] {
            run.status = status.into();
            assert!(conversation_available(&run));
        }
        run.snapshot["execution"]["kind"] = json!("tool");
        assert!(!conversation_available(&run));
        run.snapshot = json!({"automation":{}});
        assert!(!conversation_available(&run));
    }
}

/// One bounded query for the displayed page, retaining unknown usage on older runs.
pub(crate) fn attach_usage(db: &Connection, runs: &mut [inferay_core::projects::ProjectRun]) -> Result<()> {
    let ids = serde_json::to_string(&runs.iter().map(|run| &run.id).collect::<Vec<_>>())?;
    let mut statement = db.prepare("SELECT e.run_id,e.payload FROM run_events e WHERE e.kind='provider_usage' AND e.run_id IN (SELECT value FROM json_each(?)) AND e.sequence=(SELECT max(latest.sequence) FROM run_events latest WHERE latest.run_id=e.run_id AND latest.kind='provider_usage')")?;
    let rows = statement.query_map([ids], |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?)))?;
    for row in rows {
        let (id, payload) = row?;
        if let Some(run) = runs.iter_mut().find(|run| run.id == id) {
            run.usage = serde_json::from_str::<Value>(&payload).ok().and_then(|event| inferay_core::projects::RunUsage::from_provider(&event));
        }
    }
    Ok(())
}
