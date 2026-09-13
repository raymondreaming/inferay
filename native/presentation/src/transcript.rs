//! A renderer replica of the native transcript. Revisions and epochs are checked
//! here; JS only applies admitted splices and preserves unchanged object identity.
//! Keep IDs, not transcript bodies: content already lives in the renderer and
//! must not be copied back through JSON for every streaming append.
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

#[cfg(test)]
mod reconnect_tests {
    use super::*;

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

    #[test]
    fn unchanged_acknowledgement_cannot_replace_missing_or_mismatched_history() {
        let acknowledgement = json!({"type":"chat:sync","modelVersion":1,"epoch":"current",
            "revision":4,"unchanged":true});
        let mut replica = ChatReplica::new();
        assert_eq!(replica.admit(&acknowledgement)["kind"], "resync");
        replica.admit(&json!({"type":"chat:sync","modelVersion":1,"epoch":"old",
            "revision":4,"messages":[]}));
        assert_eq!(replica.admit(&acknowledgement)["kind"], "resync");
        replica.admit(
            &json!({"type":"chat:sync","modelVersion":1,"epoch":"current",
            "revision":3,"messages":[]}),
        );
        assert_eq!(replica.admit(&acknowledgement)["kind"], "resync");
    }
}
