//! A renderer replica of the native transcript. Revisions and epochs are checked
//! here; JS only applies admitted splices and preserves unchanged object identity.
//! Keep IDs, not transcript bodies: content already lives in the renderer and
//! must not be copied back through JSON for every streaming append.
use crate::{array, string};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[derive(Default, serde::Serialize, ts_rs::TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TranscriptAdmission {
    #[default]
    None,
    Ignore,
    Resync {
        reconnect: bool,
    },
    Sync {
        start: usize,
        delete_count: usize,
    },
    Patch {
        start: usize,
        delete_count: usize,
    },
}

#[derive(serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatLoadingState {
    is_loading: bool,
    status: String,
    start_time: Option<f64>,
}

#[derive(Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatEventPlan {
    admission: TranscriptAdmission,
    ready: bool,
    refresh_workspace: bool,
    #[ts(type = "'cleared' | 'exit' | null")]
    control: Option<String>,
    status: Option<ChatLoadingState>,
    finish: bool,
    checkpoints: bool,
    pending_steers: Vec<usize>,
    stage_steer: bool,
    resolve_steer: Option<String>,
    queue: bool,
    notice: Option<String>,
}

fn valid_integer(value: &Value) -> Option<u64> {
    value.as_u64().filter(|v| *v <= 9_007_199_254_740_991)
}
fn valid_message(message: &Value) -> bool {
    message["id"].is_string()
        && matches!(
            string(&message["role"]),
            "user" | "assistant" | "tool" | "system" | "btw"
        )
}
#[wasm_bindgen]
#[derive(Default)]
pub struct ChatReplica {
    messages: Vec<String>,
    revision: Option<u64>,
    epoch: Value,
    reconnecting: bool,
}
#[wasm_bindgen]
impl ChatReplica {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    pub fn cursor(&self) -> String {
        json!({"epoch":self.epoch,"revision":self.revision}).to_string()
    }
    pub fn reconnect(&mut self) {
        self.reconnecting = true;
    }
    /// Resolve browser-only insertions against the already admitted native IDs.
    /// Ordinary local rows carry only an ID; only notices carry content.
    pub fn merge(&self, local: &str, notices: &str) -> Result<String, JsValue> {
        let local: Vec<Value> = serde_json::from_str(local)
            .map_err(|e| JsValue::from_str(&format!("Invalid local transcript: {e}")))?;
        let notices: Vec<Value> = serde_json::from_str(notices)
            .map_err(|e| JsValue::from_str(&format!("Invalid native notices: {e}")))?;
        Ok(crate::wasm_json::stringify(
            &self.merge_insertions(&local, &notices),
            "transcript insertions",
        ))
    }
    pub fn receive(&mut self, message: &str, pane: &str, current: &str) -> Result<String, JsValue> {
        let message = serde_json::from_str(message)
            .map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))?;
        let current = serde_json::from_str(current)
            .map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&self.event(&message, pane, &current))
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
impl ChatReplica {
    fn event(&mut self, message: &Value, pane: &str, current: &Value) -> Option<ChatEventPlan> {
        let kind = string(&message["type"]);
        if message["paneId"] != pane
            || !(kind.starts_with("chat:") || kind.starts_with("checkpoint:"))
        {
            return None;
        }
        let mut plan = ChatEventPlan {
            admission: self.admit(message),
            ..Default::default()
        };
        if matches!(
            plan.admission,
            TranscriptAdmission::Ignore | TranscriptAdmission::Resync { .. }
        ) {
            return Some(plan);
        }
        if kind == "chat:control" {
            plan.control = matches!(string(&message["action"]), "cleared" | "exit")
                .then(|| string(&message["action"]).into());
            return Some(plan);
        }
        plan.ready = kind == "chat:sync";
        plan.refresh_workspace = matches!(kind, "chat:summary" | "chat:workspace");
        plan.finish = kind == "chat:done";
        plan.checkpoints = message["checkpoints"].is_array();
        plan.pending_steers = if plan.ready {
            array(&message["pendingSteers"])
                .iter()
                .enumerate()
                .filter_map(|(index, steer)| steer["id"].is_string().then_some(index))
                .collect()
        } else {
            Vec::new()
        };
        plan.stage_steer = kind == "chat:steer_pending" && message["message"]["id"].is_string();
        plan.resolve_steer = (kind == "chat:steered")
            .then(|| message["messageId"].as_str().map(str::to_owned))
            .flatten();
        plan.queue = kind == "chat:queue" && message["queue"].is_array();
        let status = if message["runStatus"].is_object() {
            run_status(
                &json!({"current":current,"incoming":message["runStatus"],"terminal":matches!(kind,"chat:done"|"chat:error")}),
            )
        } else if kind == "chat:error" {
            json!({"isLoading":false,"status":"error","startTime":null})
        } else {
            Value::Null
        };
        if !status.is_null() && status != *current {
            plan.status = serde_json::from_value(status).ok();
        }
        plan.notice = match kind {
            "chat:error" if message["modelVersion"] != 1 => {
                Some(message["error"].as_str().unwrap_or("Chat failed").into())
            }
            "checkpoint:reverted" => Some(format!(
                "Reverted {} file(s) to checkpoint",
                array(&message["restoredFiles"]).len()
            )),
            "checkpoint:error" => Some(format!("Revert failed: {}", string(&message["error"]))),
            _ => None,
        };
        Some(plan)
    }
    fn resync(&mut self) -> TranscriptAdmission {
        let reconnect = !self.reconnecting;
        self.reconnecting = true;
        TranscriptAdmission::Resync { reconnect }
    }
    fn admit(&mut self, message: &Value) -> TranscriptAdmission {
        if message["type"] == "chat:sync" && message["modelVersion"] == 1 {
            let Some(revision) = valid_integer(&message["revision"]) else {
                return self.resync();
            };
            if message["unchanged"] == true {
                if self.revision != Some(revision) || self.epoch != message["epoch"] {
                    return self.resync();
                }
                self.reconnecting = false;
                return TranscriptAdmission::None;
            }
            if !message["messages"].is_array()
                || array(&message["messages"])
                    .iter()
                    .any(|m| !valid_message(m) || !m["content"].is_string())
            {
                return self.resync();
            }
            if !self.reconnecting && self.revision.is_some() && self.epoch != message["epoch"] {
                return self.resync();
            }
            if !self.reconnecting && self.revision.is_some_and(|current| revision < current) {
                return TranscriptAdmission::Ignore;
            }
            let delete_count = self.messages.len();
            self.messages = array(&message["messages"])
                .iter()
                .map(|m| string(&m["id"]).to_owned())
                .collect();
            self.epoch = message["epoch"].clone();
            self.revision = Some(revision);
            self.reconnecting = false;
            return TranscriptAdmission::Sync {
                start: 0,
                delete_count,
            };
        }
        let Some(update) = message.get("transcriptUpdate") else {
            return TranscriptAdmission::None;
        };
        let (Some(revision), Some(start), Some(delete)) = (
            valid_integer(&update["revision"]),
            valid_integer(&update["start"]).and_then(|v| usize::try_from(v).ok()),
            valid_integer(&update["deleteCount"]).and_then(|v| usize::try_from(v).ok()),
        ) else {
            return self.resync();
        };
        if update["version"] != 1
            || !update["messages"].is_array()
            || (self.revision.is_some() && self.epoch != update["epoch"])
        {
            return self.resync();
        }
        if self.revision.is_some_and(|current| revision <= current) {
            return TranscriptAdmission::Ignore;
        }
        let reset = update["reset"] == true;
        if !reset
            && (self.revision.is_none() || self.revision != valid_integer(&update["baseRevision"]))
        {
            return self.resync();
        }
        let before = if reset {
            &[][..]
        } else {
            self.messages.as_slice()
        };
        if start > before.len() || (!reset && delete > before.len() - start) {
            return self.resync();
        }
        let mut inserted = Vec::new();
        for (index, change) in array(&update["messages"]).iter().enumerate() {
            let message = &change["message"];
            if !valid_message(message) {
                return self.resync();
            }
            if change.get("appendContent").is_none() && message["content"].is_string() {
                inserted.push(string(&message["id"]).to_owned());
                continue;
            }
            if !change["appendContent"].is_string() {
                return self.resync();
            }
            if before
                .get(start + index)
                .is_none_or(|id| id != string(&message["id"]))
            {
                return self.resync();
            }
            inserted.push(string(&message["id"]).to_owned());
        }
        let delete_count = if reset { self.messages.len() } else { delete };
        if reset {
            self.messages = inserted;
        } else {
            self.messages.splice(start..start + delete, inserted);
        }
        self.revision = Some(revision);
        self.epoch = update["epoch"].clone();
        TranscriptAdmission::Patch {
            start,
            delete_count,
        }
    }
}

impl ChatReplica {
    fn merge_insertions(&self, local: &[Value], notices: &[Value]) -> Vec<(usize, usize)> {
        let mut positions = std::collections::HashMap::with_capacity(self.messages.len());
        for (index, id) in self.messages.iter().enumerate() {
            positions.entry(id.as_str()).or_insert((index, true));
        }
        let mut insertions: Vec<(usize, usize)> = Vec::new();
        for (index, message) in local.iter().enumerate() {
            let browser = (message["optimistic"] == true && message["role"] == "user")
                || message["localOnly"] == true
                || message["role"] == "btw";
            if !browser
                || positions
                    .get(string(&message["id"]))
                    .is_some_and(|(_, native)| *native)
            {
                continue;
            }
            if message["localOnly"] == true
                && notices
                    .iter()
                    .any(|m| m[0] == message["role"] && m[1] == message["content"])
            {
                continue;
            }
            let insertion = (0..index)
                .rev()
                .find_map(|anchor| {
                    let message = &local[anchor];
                    let id = message.as_str().unwrap_or_else(|| string(&message["id"]));
                    positions.get(id).map(|(position, _)| position + 1)
                })
                .unwrap_or(self.messages.len() + insertions.len());
            for (position, _) in positions.values_mut() {
                if *position >= insertion {
                    *position += 1;
                }
            }
            for (position, _) in &mut insertions {
                if *position >= insertion {
                    *position += 1;
                }
            }
            positions
                .entry(string(&message["id"]))
                .and_modify(|(position, _)| *position = (*position).min(insertion))
                .or_insert((insertion, false));
            insertions.push((insertion, index));
        }
        // Ascending final positions can be spliced directly into the native array.
        insertions.sort_unstable_by_key(|(position, _)| *position);
        insertions
    }
}

/// Local submission starts activity immediately; provider acknowledgement keeps
/// that start time. A reconnect's old idle snapshot cannot cancel a pending send.
pub fn run_status(input: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let current = &input["current"];
    if input["begin"] == true {
        return if current["isLoading"] == true {
            current.clone()
        } else {
            json!({"isLoading":true,"status":"sending","startTime":input["now"]})
        };
    }
    let mut next = input["incoming"].clone();
    if current["status"] == "sending" && next["status"] == "idle" && input["terminal"] != true {
        return current.clone();
    }
    if next["isLoading"] == true
        && current["isLoading"] == true
        && let Some(start) = current["startTime"].as_u64()
    {
        next["startTime"] = json!(
            next["startTime"]
                .as_u64()
                .map_or(start, |native| native.min(start))
        );
    }
    next
}

#[cfg(test)]
mod reconnect_tests {
    use super::*;
    use TranscriptAdmission::*;

    #[test]
    fn local_insertions_keep_anchors_and_deduplicate_native_acknowledgements() {
        let replica = ChatReplica {
            messages: vec!["a".into(), "b".into(), "ack".into()],
            ..Default::default()
        };
        let local = json!([
            "a",
            {"id":"notice","role":"system","content":"local","localOnly":true},
            "removed",
            {"id":"pending","role":"user","optimistic":true},
            "b",
            {"id":"ack","role":"user","optimistic":true},
            {"id":"duplicate","role":"system","content":"saved","localOnly":true},
            {"id":"aside","role":"btw"}
        ]);
        assert_eq!(
            replica.merge_insertions(local.as_array().unwrap(), &[json!(["system", "saved"])]),
            [(1, 1), (2, 3), (5, 7)]
        );
        let reversed = ChatReplica {
            messages: vec!["b".into(), "a".into()],
            ..Default::default()
        };
        let duplicates = json!(["a", {"id":"same","role":"btw"}, "b", {"id":"same","role":"btw"}, {"id":"last","role":"btw"}]);
        assert_eq!(
            reversed.merge_insertions(duplicates.as_array().unwrap(), &[]),
            [(1, 3), (2, 4), (4, 1)]
        );
        // Replaced history has no surviving anchor: keep browser entries at the end.
        let replacement = ChatReplica {
            messages: vec!["new".into()],
            ..Default::default()
        };
        assert_eq!(
            replacement.merge_insertions(local.as_array().unwrap(), &[json!(["system", "saved"])]),
            [(1, 1), (2, 3), (3, 5), (4, 7)]
        );
        assert!(
            replica
                .merge_insertions(&[json!({"id":"ack","role":"user","optimistic":true})], &[])
                .is_empty()
        );
    }

    #[test]
    fn event_plan_rejects_wrong_panes_and_stale_sync_side_effects() {
        let mut replica = ChatReplica::new();
        let idle = json!({"isLoading":false,"status":"idle","startTime":null});
        assert!(
            replica
                .event(&json!({"type":"chat:done","paneId":"other"}), "pane", &idle)
                .is_none()
        );
        let mut sync = json!({"type":"chat:sync","paneId":"pane","modelVersion":1,"epoch":"one","revision":3,"messages":[],"pendingSteers":[{}, {"id":"valid"}]});
        let plan = replica.event(&sync, "pane", &idle).unwrap();
        assert!(plan.ready);
        assert_eq!(plan.pending_steers, [1]);
        sync["revision"] = json!(2);
        let plan = replica.event(&sync, "pane", &idle).unwrap();
        assert!(matches!(plan.admission, Ignore));
        assert!(!plan.ready);
        assert!(plan.pending_steers.is_empty());
    }

    #[test]
    fn reconnect_preserves_history_and_rejects_stale_or_gapped_updates() {
        let mut replica = ChatReplica::new();
        let mut sync = json!({"type":"chat:sync","modelVersion":1,"epoch":"session",
            "revision":4,"messages":[{"id":"a","role":"assistant","content":"retained"}]});
        assert!(matches!(
            replica.admit(&sync),
            Sync {
                start: 0,
                delete_count: 0
            }
        ));
        replica.reconnect();
        assert!(matches!(
            replica.admit(&json!({"type":"chat:sync","modelVersion":1,
            "epoch":"session","revision":4,"unchanged":true,"messages":null})),
            None
        ));
        assert!(!replica.reconnecting);
        let mut update = json!({"transcriptUpdate":{"version":1,"epoch":"session",
            "baseRevision":4,"revision":5,"start":0,"deleteCount":1,
            "messages":[{"message":{"id":"a","role":"assistant"},"appendContent":" tail"}]}});
        assert!(matches!(
            replica.admit(&update),
            Patch {
                start: 0,
                delete_count: 1
            }
        ));
        assert_eq!(replica.messages, ["a"]);
        assert!(matches!(replica.admit(&update), Ignore));
        update["transcriptUpdate"]["revision"] = json!(7);
        assert!(matches!(replica.admit(&update), Resync { reconnect: true }));
        assert!(matches!(
            replica.admit(&update),
            Resync { reconnect: false }
        ));
        sync["epoch"] = json!("next");
        assert!(matches!(replica.admit(&sync), Sync { .. }));
        assert!(matches!(replica.admit(&update), Resync { .. }));
    }
}
