//! Durable delivery admission. Handler execution belongs to the existing callable runner.
use crate::project_store::Result;
use inferay_core::projects::EffectReceipt as Receipt;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Limit {
    pub project: String,
    pub kind: String,
    pub target: String,
    pub maximum: u32,
    pub window_ms: i64,
    pub handler_hash: String,
}
impl Limit {
    fn validate(&self) -> Result<()> {
        if self.maximum == 0
            || self.maximum > 10_000
            || !(60_000..=31_536_000_000).contains(&self.window_ms)
        {
            return Err(
                "Effect limit needs a count of 1–10000 and a window from one minute to one year"
                    .into(),
            );
        }
        if [&self.project, &self.kind, &self.target]
            .iter()
            .any(|value| {
                value.is_empty() || value.len() > 512 || value.chars().any(char::is_control)
            })
        {
            return Err("Effect limit requires exact project, kind and target identities".into());
        }
        if self.handler_hash.len() != 64
            || !self.handler_hash.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err("Effect handler inputs must have a SHA-256 hash".into());
        }
        Ok(())
    }
}

pub(super) fn create_schema(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS effect_limits(
        project_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
        revision TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(project_id,kind,target));
        CREATE TABLE IF NOT EXISTS effect_outbox(
        id TEXT PRIMARY KEY, effect_id TEXT NOT NULL UNIQUE REFERENCES effect_intents(id),
        project_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
        intent_hash TEXT NOT NULL, limit_revision TEXT NOT NULL, handler_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','in_flight','uncertain','delivered','cancelled')),
        queued_at INTEGER NOT NULL, not_before INTEGER NOT NULL,
        reserved_at INTEGER, receipt TEXT);
        CREATE TABLE IF NOT EXISTS effect_cancellations(
        delivery_id TEXT PRIMARY KEY REFERENCES effect_outbox(id), requested_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS effect_outbox_scope ON effect_outbox(project_id,kind,target,state,reserved_at);")?;
    Ok(())
}

/// Host review owns calling this; a copied definition never grants local authority.
/// Every approval gets a fresh revision, even if the values equal an earlier approval.
pub(super) fn approve_limit(
    db: &mut Connection,
    limit: &Limit,
    expected_revision: Option<&str>,
) -> Result<String> {
    limit.validate()?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let previous: Option<String> = tx
        .query_row(
            "SELECT revision FROM effect_limits WHERE project_id=?1 AND kind=?2 AND target=?3",
            params![limit.project, limit.kind, limit.target],
            |r| r.get(0),
        )
        .optional()?;
    if previous.as_deref() != expected_revision {
        return Err("Effect limit changed since review".into());
    }
    let revision = uuid::Uuid::new_v4().to_string();
    tx.execute("INSERT INTO effect_limits VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(project_id,kind,target) DO UPDATE SET revision=excluded.revision,body=excluded.body",
        params![limit.project,limit.kind,limit.target,revision,serde_json::to_string(limit)?])?;
    tx.commit()?;
    Ok(revision)
}

/// Queue an already-reviewed intent; no invocation or reservation happens here.
pub(super) fn enqueue(
    db: &mut Connection,
    effect: &str,
    intent_hash: &str,
    revision: &str,
    time: i64,
) -> Result<String> {
    if time < 0 {
        return Err("Invalid delivery time".into());
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (project,kind,target,digest,not_before): (String,String,String,String,i64) = tx.query_row(
        "SELECT project_id,json_extract(intent,'$.kind'),json_extract(intent,'$.target'),intent_hash,coalesce(json_extract(intent,'$.notBefore'),0) FROM effect_intents WHERE id=?",[effect],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
    if digest != intent_hash {
        return Err("Effect changed since review".into());
    }
    let dismissed: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM effect_dismissals WHERE effect_id=?)",
        [effect],
        |r| r.get(0),
    )?;
    if dismissed {
        return Err("Dismissed effects cannot be queued".into());
    }
    let (current, body): (String, String) = tx.query_row(
        "SELECT revision,body FROM effect_limits WHERE project_id=?1 AND kind=?2 AND target=?3",
        params![project, kind, target],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if current != revision {
        return Err("Effect limit changed since review".into());
    }
    let limit: Limit = serde_json::from_str(&body)?;
    limit.validate()?;
    let previous: Option<(String, String)> = tx
        .query_row(
            "SELECT id,limit_revision FROM effect_outbox WHERE effect_id=?",
            [effect],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((id, prior)) = previous {
        if prior != revision {
            return Err("Effect is already queued under another approval".into());
        }
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute("INSERT INTO effect_outbox(id,effect_id,project_id,kind,target,intent_hash,limit_revision,handler_hash,state,queued_at,not_before)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'queued',?9,?10)",params![id,effect,project,kind,target,digest,revision,limit.handler_hash,time,not_before])?;
    tx.commit()?;
    Ok(id)
}

/// The caller must recompute handler inputs before admission. Counts are shared by
/// exact project/kind/target, including across approval revisions and automations.
pub(super) fn claim(
    db: &mut Connection,
    id: &str,
    current_handler_hash: &str,
    time: i64,
) -> Result<bool> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (state,project,kind,target,revision,handler,not_before): (String,String,String,String,String,String,i64) = tx.query_row(
        "SELECT state,project_id,kind,target,limit_revision,handler_hash,not_before FROM effect_outbox WHERE id=?",[id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)))?;
    if state != "queued" {
        return Ok(false);
    }
    if handler != current_handler_hash {
        return Err("Effect handler changed after approval".into());
    }
    let (current, body): (String, String) = tx.query_row(
        "SELECT revision,body FROM effect_limits WHERE project_id=?1 AND kind=?2 AND target=?3",
        params![project, kind, target],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if current != revision {
        return Err("Effect delivery approval changed".into());
    }
    let limit: Limit = serde_json::from_str(&body)?;
    limit.validate()?;
    if time < not_before {
        return Ok(false);
    }
    let count: u32 = tx.query_row(
        "SELECT count(*) FROM effect_outbox WHERE project_id=?1 AND kind=?2 AND target=?3
        AND (state IN ('in_flight','uncertain') OR (state='delivered' AND reserved_at>?4))",
        params![project, kind, target, time.saturating_sub(limit.window_ms)],
        |r| r.get(0),
    )?;
    if count >= limit.maximum {
        return Ok(false);
    }
    tx.execute(
        "UPDATE effect_outbox SET state='in_flight',reserved_at=?1 WHERE id=?2 AND state='queued'",
        params![time, id],
    )?;
    tx.commit()?;
    Ok(true)
}

/// Lost replies and startup recovery preserve reservations and never resend.
pub(crate) fn recover(db: &Connection) -> Result<usize> {
    Ok(db.execute(
        "UPDATE effect_outbox SET state='uncertain' WHERE state='in_flight'",
        [],
    )?)
}

/// Only an invoked/reconciled handler may supply this evidence, never a chat claim.
pub(super) fn complete(db: &mut Connection, receipt: &Receipt) -> Result<()> {
    if receipt.completed_at < 0
        || receipt.destination_id.is_empty()
        || receipt.destination_id.len() > 512
        || receipt.destination_id.chars().any(char::is_control)
    {
        return Err("Invalid effect receipt".into());
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (state, digest, previous): (String, String, Option<String>) = tx.query_row(
        "SELECT state,intent_hash,receipt FROM effect_outbox WHERE id=?",
        [&receipt.delivery_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if digest != receipt.intent_hash {
        return Err("Receipt does not match the approved intent".into());
    }
    let body = serde_json::to_string(receipt)?;
    if let Some(previous) = previous {
        if previous != body {
            return Err("Conflicting effect receipt".into());
        }
        return Ok(());
    }
    if state != "in_flight" && state != "uncertain" {
        return Err("Effect has no delivery attempt to reconcile".into());
    }
    tx.execute(
        "UPDATE effect_outbox SET state='delivered',receipt=?1 WHERE id=?2",
        params![body, receipt.delivery_id],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_store::hash;
    fn intent(db: &Connection, key: &str, at: i64) -> (String, String) {
        super::super::capture(db,"project","run","effect.json",serde_json::json!({"schema":"inferay.effect/1","key":key,"kind":"fixture","target":"local","payload":{},"notBefore":at}).to_string().as_bytes()).unwrap();
        db.query_row(
            "SELECT id,intent_hash FROM effect_intents WHERE intent_key=?",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }
    fn limit() -> Limit {
        Limit {
            project: "project".into(),
            kind: "fixture".into(),
            target: "local".into(),
            maximum: 2,
            window_ms: 86_400_000,
            handler_hash: hash(b"handler"),
        }
    }
    #[test]
    fn outbox_reserves_atomically_and_reconciles_without_resending() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.sqlite3");
        let mut db = Connection::open(&path).unwrap();
        super::super::create_schema(&db).unwrap();
        let rule = limit();
        let revision = approve_limit(&mut db, &rule, None).unwrap();
        let (first, digest) = intent(&db, "first", 100);
        assert!(enqueue(&mut db, &first, "stale", &revision, 0).is_err());
        assert!(enqueue(&mut db, &first, &digest, "stale", 0).is_err());
        let id = enqueue(&mut db, &first, &digest, &revision, 0).unwrap();
        assert_eq!(enqueue(&mut db, &first, &digest, &revision, 0).unwrap(), id);
        assert!(!claim(&mut db, &id, &rule.handler_hash, 99).unwrap());
        assert!(claim(&mut db, &id, &hash(b"changed"), 100).is_err());
        assert!(claim(&mut db, &id, &rule.handler_hash, 100).unwrap());
        assert!(!claim(&mut db, &id, &rule.handler_hash, 100).unwrap());
        assert!(
            super::super::dismiss(
                &db,
                &inferay_core::projects::EffectReviewRequest {
                    id: first,
                    intent_hash: digest.clone()
                }
            )
            .is_err()
        );
        let (second, second_hash) = intent(&db, "second", 0);
        let second = enqueue(&mut db, &second, &second_hash, &revision, 0).unwrap();
        assert!(claim(&mut db, &second, &rule.handler_hash, 100).unwrap());
        let (third, third_hash) = intent(&db, "third", 0);
        let third = enqueue(&mut db, &third, &third_hash, &revision, 0).unwrap();
        assert!(!claim(&mut db, &third, &rule.handler_hash, 100).unwrap());
        drop(db);
        let mut db = Connection::open(&path).unwrap();
        assert_eq!(recover(&db).unwrap(), 2);
        assert_eq!(recover(&db).unwrap(), 0);
        assert!(!claim(&mut db, &id, &rule.handler_hash, 200).unwrap());
        // Uncertainty retains capacity even after the rolling window has elapsed.
        assert!(!claim(&mut db, &third, &rule.handler_hash, 86_400_200).unwrap());
        let receipt = Receipt {
            delivery_id: id.clone(),
            intent_hash: digest,
            destination_id: "local-receipt".into(),
            completed_at: 100,
        };
        complete(&mut db, &receipt).unwrap();
        complete(&mut db, &receipt).unwrap();
        assert!(
            complete(
                &mut db,
                &Receipt {
                    destination_id: "conflict".into(),
                    ..receipt
                }
            )
            .is_err()
        );
        assert!(claim(&mut db, &third, &rule.handler_hash, 86_400_200).unwrap());
        let retained: String = db
            .query_row("SELECT receipt FROM effect_outbox WHERE id=?", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(retained.contains("local-receipt"));
    }
    #[test]
    fn outbox_refuses_dismissal_scope_and_approval_changes() {
        let mut db = Connection::open_in_memory().unwrap();
        super::super::create_schema(&db).unwrap();
        let rule = limit();
        let revision = approve_limit(&mut db, &rule, None).unwrap();
        let (effect, digest) = intent(&db, "key", 0);
        super::super::dismiss(
            &db,
            &inferay_core::projects::EffectReviewRequest {
                id: effect.clone(),
                intent_hash: digest.clone(),
            },
        )
        .unwrap();
        assert!(enqueue(&mut db, &effect, &digest, &revision, 0).is_err());
        let (effect, digest) = intent(&db, "queued", 0);
        let id = enqueue(&mut db, &effect, &digest, &revision, 0).unwrap();
        assert!(approve_limit(&mut db, &rule, None).is_err());
        let new_revision = approve_limit(&mut db, &rule, Some(&revision)).unwrap();
        assert_ne!(revision, new_revision);
        assert!(claim(&mut db, &id, &rule.handler_hash, 100).is_err());
        assert!(enqueue(&mut db, &effect, &digest, &new_revision, 0).is_err());
        assert!(
            complete(
                &mut db,
                &Receipt {
                    delivery_id: id,
                    intent_hash: digest,
                    destination_id: "not-sent".into(),
                    completed_at: 100
                }
            )
            .is_err()
        );
        let invalid = Limit { maximum: 0, ..rule };
        assert!(approve_limit(&mut db, &invalid, Some(&new_revision)).is_err());
    }
    #[test]
    fn outbox_cancellation_preserves_uncertain_outcomes_and_receipts() {
        use inferay_core::projects::{EffectDeliveryState, EffectReviewRequest};
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.sqlite3");
        let mut db = Connection::open(&path).unwrap();
        super::super::create_schema(&db).unwrap();
        let rule = Limit {
            maximum: 1,
            ..limit()
        };
        let revision = approve_limit(&mut db, &rule, None).unwrap();
        let (effect, digest) = intent(&db, "cancel-before", 0);
        let id = enqueue(&mut db, &effect, &digest, &revision, 0).unwrap();
        let request = EffectReviewRequest {
            id: effect,
            intent_hash: digest,
        };
        assert!(
            cancel(
                &mut db,
                &EffectReviewRequest {
                    intent_hash: "stale".into(),
                    ..request.clone()
                },
                100
            )
            .is_err()
        );
        let cancelled = cancel(&mut db, &request, 100).unwrap();
        assert_eq!(cancelled.state, EffectDeliveryState::Cancelled);
        assert_eq!(
            cancel(&mut db, &request, 200)
                .unwrap()
                .cancellation_requested_at,
            Some(100)
        );
        assert!(!claim(&mut db, &id, &rule.handler_hash, 300).unwrap());
        assert!(
            complete(
                &mut db,
                &Receipt {
                    delivery_id: id,
                    intent_hash: request.intent_hash,
                    destination_id: "never-delivered".into(),
                    completed_at: 100
                }
            )
            .is_err()
        );
        let (effect, digest) = intent(&db, "cancel-after", 0);
        let id = enqueue(&mut db, &effect, &digest, &revision, 0).unwrap();
        assert!(claim(&mut db, &id, &rule.handler_hash, 100).unwrap());
        let request = EffectReviewRequest {
            id: effect,
            intent_hash: digest.clone(),
        };
        assert_eq!(
            cancel(&mut db, &request, 200).unwrap().state,
            EffectDeliveryState::Uncertain
        );
        let (other, other_digest) = intent(&db, "capacity", 0);
        let other = enqueue(&mut db, &other, &other_digest, &revision, 0).unwrap();
        assert!(!claim(&mut db, &other, &rule.handler_hash, 86_400_200).unwrap());
        drop(db);
        let mut db = Connection::open(&path).unwrap();
        let receipt = Receipt {
            delivery_id: id.clone(),
            intent_hash: digest,
            destination_id: "actually-delivered".into(),
            completed_at: 100,
        };
        complete(&mut db, &receipt).unwrap();
        assert!(cancel(&mut db, &request, 300).is_err());
        assert_eq!(
            db.query_row(
                "SELECT requested_at FROM effect_cancellations WHERE delivery_id=?",
                [&id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            200
        );
        assert!(claim(&mut db, &other, &rule.handler_hash, 86_400_200).unwrap());
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use crate::project_store::hash;
    use std::io::Write;
    #[test]
    fn outbox_reconciles_destination_commit_after_lost_reply() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("inferay.sqlite3");
        let destination = temp.path().join("destination.sqlite3");
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../scripts/tests/fixtures/plugins/effects/destination.py");
        let invoke = |input: serde_json::Value| {
            let mut child = std::process::Command::new("python3")
                .arg(&fixture)
                .arg(&destination)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(input.to_string().as_bytes())
                .unwrap();
            child.wait_with_output().unwrap()
        };
        let mut db = Connection::open(&source).unwrap();
        super::super::create_schema(&db).unwrap();
        super::super::capture(&db,"project","run","intent.json",br#"{"schema":"inferay.effect/1","key":"only-once","kind":"fixture","target":"local","payload":{"message":"local only"}}"#).unwrap();
        let (effect, digest): (String, String) = db
            .query_row("SELECT id,intent_hash FROM effect_intents", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        let limit = Limit {
            project: "project".into(),
            kind: "fixture".into(),
            target: "local".into(),
            maximum: 2,
            window_ms: 86_400_000,
            handler_hash: hash(b"fixture-handler"),
        };
        let revision = approve_limit(&mut db, &limit, None).unwrap();
        let id = enqueue(&mut db, &effect, &digest, &revision, 100).unwrap();
        assert!(claim(&mut db, &id, &limit.handler_hash, 100).unwrap());
        let reply = invoke(
            serde_json::json!({"operation":"deliver","deliveryId":id,"intentHash":digest,"payload":{"message":"local only"},"time":100,"loseReply":true}),
        );
        assert_eq!(reply.status.code(), Some(75));
        assert!(reply.stdout.is_empty());
        drop(db);
        let mut db = Connection::open(&source).unwrap();
        assert_eq!(recover(&db).unwrap(), 1);
        assert!(!claim(&mut db, &id, &limit.handler_hash, 200).unwrap());
        let reply = invoke(serde_json::json!({"operation":"reconcile","deliveryId":id}));
        assert!(reply.status.success());
        let reply: serde_json::Value = serde_json::from_slice(&reply.stdout).unwrap();
        assert_eq!(reply["state"], "delivered");
        let receipt: Receipt = serde_json::from_value(reply["receipt"].clone()).unwrap();
        complete(&mut db, &receipt).unwrap();
        assert_eq!(
            db.query_row("SELECT state FROM effect_outbox WHERE id=?", [&id], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "delivered"
        );
        let ledger = Connection::open(&destination).unwrap();
        assert_eq!(
            ledger
                .query_row("SELECT count(*) FROM receipts", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            1
        );
        // The destination itself rejects a retry with a changed payload.
        let conflict = invoke(
            serde_json::json!({"operation":"deliver","deliveryId":id,"intentHash":digest,"payload":{"message":"different"},"time":200}),
        );
        assert!(!conflict.status.success());
        assert_eq!(
            ledger
                .query_row("SELECT count(*) FROM receipts", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            1
        );
    }
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    use crate::project_store::hash;
    #[test]
    fn outbox_concurrent_claims_share_one_limit() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.sqlite3");
        let mut db = Connection::open(&path).unwrap();
        super::super::create_schema(&db).unwrap();
        let rule = Limit {
            project: "project".into(),
            kind: "fixture".into(),
            target: "local".into(),
            maximum: 1,
            window_ms: 60_000,
            handler_hash: hash(b"handler"),
        };
        let revision = approve_limit(&mut db, &rule, None).unwrap();
        let mut ids = Vec::new();
        for index in 0..3 {
            super::super::capture(&db,"project","run","intent.json",serde_json::json!({"schema":"inferay.effect/1","key":index.to_string(),"kind":"fixture","target":"local","payload":{}}).to_string().as_bytes()).unwrap();
            let (effect, digest): (String, String) = db
                .query_row(
                    "SELECT id,intent_hash FROM effect_intents WHERE intent_key=?",
                    [index.to_string()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            ids.push(enqueue(&mut db, &effect, &digest, &revision, 100).unwrap());
        }
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let threads: Vec<_> = ids
            .into_iter()
            .map(|id| {
                let path = path.clone();
                let barrier = barrier.clone();
                let handler = rule.handler_hash.clone();
                std::thread::spawn(move || {
                    let mut db = Connection::open(path).unwrap();
                    db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
                    barrier.wait();
                    claim(&mut db, &id, &handler, 100).unwrap()
                })
            })
            .collect();
        assert_eq!(
            threads
                .into_iter()
                .filter_map(|t| t.join().unwrap().then_some(()))
                .count(),
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM effect_outbox WHERE state='in_flight'",
                [],
                |r| r.get::<_, u32>(0)
            )
            .unwrap(),
            1
        );
    }
}

/// Cancellation is serialized with claim: before launch it prevents dispatch;
/// after launch the outcome stays unknown and the reservation remains charged.
pub(super) fn cancel(
    db: &mut Connection,
    request: &inferay_core::projects::EffectReviewRequest,
    time: i64,
) -> Result<inferay_core::projects::EffectDelivery> {
    if time < 0 {
        return Err("Invalid cancellation time".into());
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (id, digest, state): (String, String, String) = tx.query_row(
        "SELECT id,intent_hash,state FROM effect_outbox WHERE effect_id=?",
        [&request.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if digest != request.intent_hash {
        return Err("Effect changed since review".into());
    }
    if state == "delivered" {
        return Err("Delivered effects cannot be cancelled".into());
    }
    tx.execute(
        "INSERT INTO effect_cancellations VALUES(?1,?2) ON CONFLICT(delivery_id) DO NOTHING",
        params![id, time],
    )?;
    tx.execute("UPDATE effect_outbox SET state=CASE WHEN state='queued' THEN 'cancelled' WHEN state='in_flight' THEN 'uncertain' ELSE state END WHERE id=?",[&id])?;
    let body: String=tx.query_row("SELECT json_object('id',o.id,'state',o.state,'cancellationRequestedAt',c.requested_at,'receipt',json(o.receipt)) FROM effect_outbox o LEFT JOIN effect_cancellations c ON c.delivery_id=o.id WHERE o.id=?",[id],|r|r.get(0))?;
    let delivery = serde_json::from_str(&body)?;
    tx.commit()?;
    Ok(delivery)
}
