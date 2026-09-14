//! Dock request ordering and retained layout previews. Storage and HTTP stay in the renderer.
use crate::dock;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::VecDeque;
use wasm_bindgen::prelude::*;

thread_local! {
    static SAVED: RefCell<VecDeque<(String, Value)>> = const { RefCell::new(VecDeque::new()) };
}

#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DockRequest {
    workspace_id: String,
    #[ts(optional)]
    legacy_workspace_id: Option<String>,
    ids: Vec<String>,
    columns: usize,
    mode: String,
    visible_columns: usize,
    #[ts(optional)]
    rows: Option<usize>,
    #[ts(optional, type = "Record<string, unknown>")]
    action: Option<Value>,
}

#[wasm_bindgen]
#[derive(Default)]
pub struct DockSession {
    revision: u32,
    last_request: Option<String>,
}

#[wasm_bindgen]
impl DockSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin(
        &mut self,
        request: &str,
        stored: Option<String>,
        legacy: Option<String>,
        deduplicate: bool,
    ) -> Result<String, JsValue> {
        if deduplicate && self.last_request.as_deref() == Some(request) {
            return Ok("null".into());
        }
        if deduplicate {
            self.last_request = Some(request.into());
        }
        self.revision = self.revision.wrapping_add(1);
        let request: DockRequest = serde_json::from_str(request).map_err(js_error)?;
        let mut request = serde_json::to_value(request).map_err(js_error)?;
        let workspace = request["workspaceId"].as_str().unwrap_or_default();
        let saved = SAVED
            .with(|cache| {
                cache
                    .borrow()
                    .iter()
                    .find(|(id, _)| id == workspace)
                    .map(|(_, saved)| saved.clone())
            })
            .or_else(|| parse_optional(stored));
        if let Some(saved) = saved {
            request["saved"] = saved;
        }
        if let Some(legacy) = parse_optional(legacy) {
            request["legacy"] = legacy;
        }
        let layout = request["action"]
            .is_null()
            .then(|| dock::project(&request))
            .transpose()
            .map_err(|error| JsValue::from_str(&error))?;
        Ok(json!({"revision": self.revision, "layout": layout}).to_string())
    }

    pub fn accept(
        &mut self,
        revision: u32,
        workspace: &str,
        layout: &str,
    ) -> Result<String, JsValue> {
        let layout: Value = serde_json::from_str(layout).map_err(js_error)?;
        SAVED.with(|cache| {
            let mut cache = cache.borrow_mut();
            cache.retain(|(id, _)| id != workspace);
            cache.push_back((workspace.into(), layout["saved"].clone()));
            if cache.len() > 32 {
                cache.pop_front();
            }
        });
        Ok(if revision == self.revision {
            layout.to_string()
        } else {
            "null".into()
        })
    }

    pub fn fail(&mut self, revision: u32) -> bool {
        if revision != self.revision {
            return false;
        }
        self.last_request = None;
        true
    }

    pub fn dispose(&mut self) {
        self.revision = self.revision.wrapping_add(1);
    }
}

fn parse_optional(value: Option<String>) -> Option<Value> {
    value.and_then(|value| serde_json::from_str(&value).ok())
}
fn js_error(error: serde_json::Error) -> JsValue {
    JsValue::from_str(&error.to_string())
}
