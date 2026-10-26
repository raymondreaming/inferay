//! Transcript admission and reconnect state, independent of transport and rendering.
//! Retain IDs and revisions here; message bodies remain with their native owner.
use crate::{array, string};
use inferay_core::chat_status::ChatRunStatus;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Default)]
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

#[derive(Default)]
pub struct ChatEventPlan {
    pub admission: TranscriptAdmission,
    pub control: Option<String>,
    pub status: Option<ChatRunStatus>,
    pub pending_steers: Vec<usize>,
    pub stage_steer: bool,
    pub resolve_steer: Option<String>,
    pub queue: bool,
    pub notice: Option<String>,
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

#[derive(Default)]
pub struct ChatReplica {
    messages: Vec<String>,
    revision: Option<u64>,
    epoch: Value,
    reconnecting: bool,
}

impl ChatReplica {
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    pub fn reconnect(&mut self, pane: &str) -> Value {
        self.reconnecting = true;
        json!({"type":"chat:reconnect", "paneId":pane, "epoch":self.epoch, "revision":self.revision})
    }
    pub fn event(
        &mut self,
        message: &Value,
        pane: &str,
        current: &ChatRunStatus,
    ) -> Option<ChatEventPlan> {
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
        plan.pending_steers = if kind == "chat:sync" {
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
        let incoming = if message["runStatus"].is_object() {
            ChatRunStatus::deserialize(&message["runStatus"]).ok()
        } else if kind == "chat:error" {
            Some(ChatRunStatus {
                status: "error".into(),
                ..Default::default()
            })
        } else {
            None
        };
        if let Some(incoming) = incoming {
            let mut status = current.clone();
            status.admit(incoming, matches!(kind, "chat:done" | "chat:error"));
            if status != *current {
                plan.status = Some(status);
            }
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

#[cfg(test)]
mod reconnect_tests {
    use super::*;
    use TranscriptAdmission::*;

    #[test]
    fn event_plan_rejects_wrong_panes_and_stale_sync_side_effects() {
        let mut replica = ChatReplica::default();
        let idle = ChatRunStatus::default();
        assert!(
            replica
                .event(&json!({"type":"chat:done","paneId":"other"}), "pane", &idle)
                .is_none()
        );
        let mut sync = json!({"type":"chat:sync","paneId":"pane","modelVersion":1,"epoch":"one","revision":3,"messages":[],"pendingSteers":[{}, {"id":"valid"}]});
        let plan = replica.event(&sync, "pane", &idle).unwrap();
        assert_eq!(plan.pending_steers, [1]);
        sync["revision"] = json!(2);
        let plan = replica.event(&sync, "pane", &idle).unwrap();
        assert!(matches!(plan.admission, Ignore));
        assert!(plan.pending_steers.is_empty());
    }

    #[test]
    fn reconnect_preserves_history_and_rejects_stale_or_gapped_updates() {
        let mut replica = ChatReplica::default();
        let mut sync = json!({"type":"chat:sync","modelVersion":1,"epoch":"session",
            "revision":4,"messages":[{"id":"a","role":"assistant","content":"retained"}]});
        assert!(matches!(
            replica.admit(&sync),
            Sync {
                start: 0,
                delete_count: 0
            }
        ));
        assert_eq!(
            replica.reconnect("pane"),
            json!({
                "type":"chat:reconnect", "paneId":"pane", "epoch":"session", "revision":4
            })
        );
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
