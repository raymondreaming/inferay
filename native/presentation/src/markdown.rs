//! Streaming transport cursor. Parsing is already native; block objects stay in JS.
use crate::wasm_json;
use serde_json::{Value, json};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Clone)]
struct Cursor {
    id: String,
    text: String,
    chat: bool,
    revision: u64,
    blocks: u64,
}
struct Request {
    cursor: Cursor,
    reset: bool,
    retried: bool,
    streaming: bool,
    append: String,
}
impl Request {
    fn wire(&self) -> String {
        let cursor = &self.cursor;
        let mut request =
            json!({"streamId":cursor.id,"chat":cursor.chat,"streaming":self.streaming});
        if self.reset {
            request["text"] = json!(cursor.text);
        } else {
            request["baseRevision"] = json!(cursor.revision);
            request["append"] = json!(self.append);
        }
        request.to_string()
    }
}
#[wasm_bindgen]
#[derive(Default)]
pub struct MarkdownCursor {
    current: Option<Cursor>,
    requests: HashMap<u32, Request>,
    attempt: u32,
}
#[wasm_bindgen]
impl MarkdownCursor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    pub fn active(&self) -> bool {
        self.current.is_some()
    }
    pub fn begin(&mut self, text: String, chat: bool, streaming: bool, id: String) -> u32 {
        self.attempt += 1;
        let before = self
            .current
            .as_ref()
            .filter(|c| c.chat == chat && text.starts_with(&c.text));
        let append = before
            .map(|c| text[c.text.len()..].to_owned())
            .unwrap_or_default();
        let cursor = Cursor {
            id: before.map(|c| c.id.clone()).unwrap_or(id),
            text,
            chat,
            revision: before.map_or(0, |c| c.revision),
            blocks: before.map_or(0, |c| c.blocks),
        };
        self.requests.insert(
            self.attempt,
            Request {
                cursor,
                reset: before.is_none(),
                retried: false,
                streaming,
                append,
            },
        );
        self.attempt
    }
    pub fn request(&self, attempt: u32) -> String {
        self.requests[&attempt].wire()
    }
    pub fn restart(&mut self, attempt: u32, id: String) -> String {
        let request = self
            .requests
            .get_mut(&attempt)
            .expect("active Markdown request");
        request.reset = true;
        request.retried = true;
        request.cursor.id = id;
        request.wire()
    }
    pub fn retry(&mut self, attempt: u32, status: u16, id: String) -> Option<String> {
        let retry = status == 409 && !self.requests.get(&attempt)?.retried;
        retry.then(|| self.restart(attempt, id))
    }
    pub fn finish(&mut self, attempt: u32, status: u16, metadata: &str) -> Result<String, JsValue> {
        let metadata: Value = wasm_json::parse(metadata)?;
        wasm_json::result(self.settle(attempt, status, &metadata)).map(|result| result.to_string())
    }
    pub fn discard(&mut self, attempt: u32) {
        self.requests.remove(&attempt);
    }
}

impl MarkdownCursor {
    fn settle(&mut self, attempt: u32, status: u16, patch: &Value) -> Result<Value, String> {
        if !(200..300).contains(&status) {
            self.requests.remove(&attempt);
            return Err(patch["error"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("Markdown request failed ({status})")));
        }
        let accepted = self.admit(attempt, patch).map_err(str::to_owned)?;
        Ok(json!({"accepted":accepted,"start":patch["start"]}))
    }

    fn admit(&mut self, attempt: u32, patch: &Value) -> Result<bool, &'static str> {
        let request = self
            .requests
            .remove(&attempt)
            .ok_or("Unknown Markdown request")?;
        let integer = |key: &str| patch[key].as_u64().filter(|v| *v <= 9_007_199_254_740_991);
        let revision = if request.reset {
            1
        } else {
            request.cursor.revision + 1
        };
        let (Some(start), Some(delete), Some(blocks)) =
            (integer("start"), integer("deleteCount"), integer("blocks"))
        else {
            return Err("Unsupported Markdown stream response");
        };
        if patch["version"] != 1
            || patch["reset"] != request.reset
            || integer("revision") != Some(revision)
            || if request.reset {
                start != 0
            } else {
                start.checked_add(delete) != Some(request.cursor.blocks)
            }
        {
            return Err("Unsupported Markdown stream response");
        }
        let accepted = attempt == self.attempt;
        if accepted {
            self.current = request.streaming.then(|| Cursor {
                revision,
                blocks: start + blocks,
                ..request.cursor
            });
        }
        Ok(accepted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(reset: bool, revision: u64, start: u64, delete: u64, blocks: u64) -> Value {
        json!({"version":1,"reset":reset,"revision":revision,"start":start,
            "deleteCount":delete,"blocks":blocks})
    }

    #[test]
    fn late_or_malformed_responses_cannot_replace_the_retained_cursor() {
        let mut cursor = MarkdownCursor::new();
        let old = cursor.begin("old".into(), true, true, "old".into());
        let fresh = cursor.begin("new".into(), true, true, "fresh".into());
        assert!(cursor.admit(fresh, &patch(true, 1, 0, 0, 1)).unwrap());
        assert!(!cursor.admit(old, &patch(true, 1, 0, 0, 1)).unwrap());
        let bad = cursor.begin("new!".into(), true, true, "unused".into());
        assert!(cursor.admit(bad, &patch(false, 2, 2, 0, 1)).is_err());
        let retry = cursor.begin("new!".into(), true, true, "unused".into());
        let request: Value = serde_json::from_str(&cursor.request(retry)).unwrap();
        assert_eq!(request["append"], "!");
        assert_eq!(request["baseRevision"], 1);
        assert_eq!(request["streamId"], "fresh");
    }
}
