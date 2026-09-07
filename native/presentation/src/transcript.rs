//! A renderer replica of the native transcript. Revisions and epochs are checked
//! here; JS only applies admitted splices and preserves unchanged object identity.
use crate::{array, string};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

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
    messages: Vec<Value>,
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
    pub fn reconnect(&mut self) {
        self.reconnecting = true;
    }
    pub fn receive(&mut self, message: &str) -> Result<String, JsValue> {
        let message = serde_json::from_str(message)
            .map_err(|e: serde_json::Error| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&self.admit(&message)).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
impl ChatReplica {
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
            self.messages = array(&message["messages"]).to_vec();
            self.epoch = message["epoch"].clone();
            self.revision = Some(revision);
            self.reconnecting = false;
            return json!({"kind":"sync","start":0,"deleteCount":delete_count,"messages":self.messages});
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
            let mut message = change["message"].clone();
            if !valid_message(&message) {
                return self.resync();
            }
            if change.get("appendContent").is_none() && message["content"].is_string() {
                inserted.push(message);
                continue;
            }
            let Some(append) = change["appendContent"].as_str() else {
                return self.resync();
            };
            let Some(previous) = before
                .get(start + index)
                .filter(|m| m["id"] == message["id"])
            else {
                return self.resync();
            };
            message["content"] = json!(format!("{}{append}", string(&previous["content"])));
            inserted.push(message);
        }
        let delete_count = if reset { self.messages.len() } else { delete };
        if reset {
            self.messages = inserted.clone();
        } else {
            self.messages
                .splice(start..start + delete, inserted.clone());
        }
        self.revision = Some(revision);
        self.epoch = update["epoch"].clone();
        json!({"kind":"patch","start":start,"deleteCount":delete_count,"messages":inserted})
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
