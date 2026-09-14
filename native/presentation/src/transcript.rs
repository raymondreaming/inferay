//! A renderer replica of the native transcript. Revisions and epochs are checked
//! here; JS only applies admitted splices and preserves unchanged object identity.
//! Keep IDs, not transcript bodies: content already lives in the renderer and
//! must not be copied back through JSON for every streaming append.
use crate::{array, string};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[derive(Default, serde::Deserialize, serde::Serialize, ts_rs::TS)]
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
    fn event(&mut self, message: &Value, pane: &str, current: &Value) -> Value {
        let kind = string(&message["type"]);
        if message["paneId"] != pane
            || !(kind.starts_with("chat:") || kind.starts_with("checkpoint:"))
        {
            return Value::Null;
        }
        let admission =
            serde_json::from_value(self.admit(message)).expect("native transcript admission");
        let mut plan = ChatEventPlan {
            admission,
            ..Default::default()
        };
        if matches!(
            plan.admission,
            TranscriptAdmission::Ignore | TranscriptAdmission::Resync { .. }
        ) {
            return json!(plan);
        }
        if kind == "chat:control" {
            plan.control = matches!(string(&message["action"]), "cleared" | "exit")
                .then(|| string(&message["action"]).into());
            return json!(plan);
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
        json!(plan)
    }
    fn resync(&mut self) -> Value {
        let reconnect = !self.reconnecting;
        self.reconnecting = true;
        json!({"kind":"resync","reconnect":reconnect})
    }
    pub fn admit(&mut self, message: &Value) -> Value {
        if message["type"] == "chat:sync" && message["modelVersion"] == 1 {
            let Some(revision) = valid_integer(&message["revision"]) else {
                return self.resync();
            };
            if message["unchanged"] == true {
                if self.revision != Some(revision) || self.epoch != message["epoch"] {
                    return self.resync();
                }
                self.reconnecting = false;
                return json!({"kind":"none"});
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
                return json!({"kind":"ignore"});
            }
            let delete_count = self.messages.len();
            self.messages = array(&message["messages"])
                .iter()
                .map(|m| string(&m["id"]).to_owned())
                .collect();
            self.epoch = message["epoch"].clone();
            self.revision = Some(revision);
            self.reconnecting = false;
            return json!({"kind":"sync","start":0,"deleteCount":delete_count});
        }
        let Some(update) = message.get("transcriptUpdate") else {
            return json!({"kind":"none"});
        };
        let Some(revision) = valid_integer(&update["revision"]) else {
            return self.resync();
        };
        let Some(start) = valid_integer(&update["start"]).and_then(|v| usize::try_from(v).ok())
        else {
            return self.resync();
        };
        let Some(delete) =
            valid_integer(&update["deleteCount"]).and_then(|v| usize::try_from(v).ok())
        else {
            return self.resync();
        };
        if update["version"] != 1
            || !update["messages"].is_array()
            || (self.revision.is_some() && self.epoch != update["epoch"])
        {
            return self.resync();
        }
        if self.revision.is_some_and(|current| revision <= current) {
            return json!({"kind":"ignore"});
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
        json!({"kind":"patch","start":start,"deleteCount":delete_count})
    }
}

/// Return references by index; never round-trip transcript content to merge a
/// browser interaction notice or unacknowledged send with native messages.
pub fn merge_order(i: &Value) -> Value {
    let local = array(&i["local"]);
    let server = array(&i["server"]);
    let ids: std::collections::HashSet<_> = server.iter().map(|m| string(&m["id"])).collect();
    let mut order: Vec<(bool, usize)> = server
        .iter()
        .enumerate()
        .map(|(index, _)| (false, index))
        .collect();
    for (index, message) in local.iter().enumerate() {
        let browser = (message["optimistic"] == true && message["role"] == "user")
            || message["localOnly"] == true
            || message["role"] == "btw";
        if !browser || ids.contains(string(&message["id"])) {
            continue;
        }
        if message["localOnly"] == true
            && server
                .iter()
                .any(|m| m["role"] == message["role"] && m["content"] == message["content"])
        {
            continue;
        }
        let insertion = (0..index)
            .rev()
            .find_map(|anchor| {
                order.iter().position(|(browser, index)| {
                    let candidate = if *browser {
                        &local[*index]
                    } else {
                        &server[*index]
                    };
                    candidate["id"] == local[anchor]["id"]
                })
            })
            .map(|p| p + 1)
            .unwrap_or(order.len());
        order.insert(insertion, (true, index));
    }
    json!(order)
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

    #[test]
    fn event_plan_rejects_wrong_panes_and_stale_sync_side_effects() {
        let mut replica = ChatReplica::new();
        let idle = json!({"isLoading":false,"status":"idle","startTime":null});
        assert!(
            replica
                .event(&json!({"type":"chat:done","paneId":"other"}), "pane", &idle)
                .is_null()
        );
        let sync = json!({"type":"chat:sync","paneId":"pane","modelVersion":1,"epoch":"one","revision":3,"messages":[],"pendingSteers":[{}, {"id":"valid"}]});
        let plan = replica.event(&sync, "pane", &idle);
        assert_eq!(plan["ready"], true);
        assert_eq!(plan["pendingSteers"], json!([1]));
        let mut stale = sync;
        stale["revision"] = json!(2);
        let plan = replica.event(&stale, "pane", &idle);
        assert_eq!(plan["admission"]["kind"], "ignore");
        assert_eq!(plan["ready"], false);
        assert_eq!(plan["pendingSteers"], json!([]));
    }

    #[test]
    fn unchanged_reconnect_preserves_history_and_accepts_the_next_delta() {
        let mut replica = ChatReplica::new();
        replica.admit(
            &json!({"type":"chat:sync","modelVersion":1,"epoch":"session",
            "revision":4,"messages":[{"id":"a","role":"assistant","content":"retained"}]}),
        );
        replica.reconnect();
        let result = replica.admit(&json!({"type":"chat:sync","modelVersion":1,
            "epoch":"session","revision":4,"unchanged":true,"messages":null}));
        assert_eq!(result, json!({"kind":"none"}));
        assert!(!replica.reconnecting);
        let result = replica.admit(&json!({"transcriptUpdate":{"version":1,"epoch":"session",
            "baseRevision":4,"revision":5,"start":0,"deleteCount":1,
            "messages":[{"message":{"id":"a","role":"assistant"},"appendContent":" tail"}]}}));
        assert_eq!(result["kind"], "patch");
        assert_eq!(replica.messages, ["a"]);
        assert_eq!(result, json!({"kind":"patch","start":0,"deleteCount":1}));
    }
}
