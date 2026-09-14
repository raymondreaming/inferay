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
    acknowledged: Option<(u32, String)>,
    layout: Option<Value>,
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
        let request_key = request.to_owned();
        let previous_revision = self.revision;
        self.revision = self.revision.wrapping_add(1);
        let request: DockRequest = serde_json::from_str(request).map_err(js_error)?;
        let mut request = serde_json::to_value(request).map_err(js_error)?;
        let workspace = request["workspaceId"].as_str().unwrap_or_default();
        let settled = self
            .acknowledged
            .as_ref()
            .is_some_and(|(revision, id)| *revision == previous_revision && id == workspace);
        let saved = SAVED
            .with(|cache| {
                cache
                    .borrow()
                    .iter()
                    .find(|(id, _)| id == workspace)
                    .map(|(_, saved)| saved.clone())
            })
            .or_else(|| parse_optional(stored));
        if let Some(saved) = &saved {
            request["saved"] = saved.clone();
        }
        if let Some(legacy) = parse_optional(legacy) {
            request["legacy"] = legacy;
        }
        let layout = request["action"]
            .is_null()
            .then(|| dock::project(&request))
            .transpose()
            .map_err(|error| JsValue::from_str(&error))?;
        // Display-only changes need no save after the latest mutation is acknowledged.
        let persist = !deduplicate
            || !settled
            || layout
                .as_ref()
                .is_none_or(|layout| saved.as_ref() != Some(&layout["saved"]));
        if deduplicate {
            self.last_request = Some(request_key);
        }
        if !persist {
            self.acknowledged.as_mut().expect("settled request").0 = self.revision;
        }
        let changed = layout != self.layout;
        if layout.is_some() {
            self.layout = layout.clone();
        }
        Ok(json!({"revision": self.revision, "layout": if changed { layout } else { None }, "persist": persist}).to_string())
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
        if revision != self.revision {
            return Ok("null".into());
        }
        self.acknowledged = Some((revision, workspace.into()));
        if self.layout.as_ref() == Some(&layout) {
            return Ok("null".into());
        }
        let result = layout.to_string();
        self.layout = Some(layout);
        Ok(result)
    }

    pub fn fail(&mut self, revision: u32) -> bool {
        if revision != self.revision {
            return false;
        }
        self.last_request = None;
        true
    }

    pub fn is_current(&self, revision: u32) -> bool {
        revision == self.revision
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
