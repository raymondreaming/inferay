//! Optimistic workspace selection and acknowledgement policy. HTTP ordering stays in JS.
use crate::workbench::{WorkspaceSelection, workspace_mutation_plan, workspace_selection};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;
use ts_rs::TS;
use wasm_bindgen::prelude::*;

#[derive(Default, Serialize, Deserialize, TS)]
pub struct WorkspaceSnapshot {
    #[ts(as = "Option<inferay_core::agent_state::AgentSavedState<'static>>")]
    state: Value,
    error: Option<String>,
}
#[wasm_bindgen]
#[derive(Default)]
pub struct WorkspaceReplica {
    snapshot: WorkspaceSnapshot,
    canonical: Value,
    pending: Option<(u32, WorkspaceSelection)>,
    structural: HashSet<u32>,
    sequence: u32,
}
#[wasm_bindgen]
impl WorkspaceReplica {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    pub fn snapshot(&self) -> String {
        serde_json::to_string(&self.snapshot).expect("workspace snapshot")
    }
    pub fn publish(&mut self, snapshot: &str) -> Result<String, JsValue> {
        self.snapshot =
            serde_json::from_str(snapshot).map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(self.snapshot())
    }
    pub fn begin(&mut self, action: &str) -> Result<String, JsValue> {
        let action: Value =
            serde_json::from_str(action).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let plan = workspace_mutation_plan(&self.snapshot.state, &action);
        if plan.unchanged && self.structural.is_empty() && self.snapshot.error.is_none() {
            return Ok("null".into());
        }
        self.sequence += 1;
        let selecting = plan.selection.is_some();
        if let Some(selection) = plan.selection {
            self.pending = Some((self.sequence, selection));
            self.overlay();
        } else {
            self.structural.insert(self.sequence);
        }
        Ok(json!({"id":self.sequence,"selecting":selecting}).to_string())
    }
    pub fn accept(&mut self, state: &str, request: Option<u32>) -> Result<String, JsValue> {
        let state = serde_json::from_str(state).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.clear(request);
        self.canonical = state;
        self.snapshot.state = self.canonical.clone();
        self.snapshot.error = None;
        self.overlay();
        Ok(self.snapshot())
    }
    pub fn fail(&mut self, request: Option<u32>) -> String {
        self.clear(request);
        if request.is_some() && !self.canonical.is_null() {
            self.snapshot.state = self.canonical.clone();
            self.overlay();
        }
        self.snapshot.error = Some(
            if request.is_some() {
                "Workspace changes could not be saved."
            } else {
                "Saved workspaces could not be loaded."
            }
            .into(),
        );
        self.snapshot()
    }
    pub fn settled(&mut self, request: u32) {
        self.structural.remove(&request);
    }
}
impl WorkspaceReplica {
    fn clear(&mut self, request: Option<u32>) {
        if self
            .pending
            .as_ref()
            .is_some_and(|(id, _)| Some(*id) == request)
        {
            self.pending = None;
        }
    }
    fn overlay(&mut self) {
        if let Some((_, selection)) = &self.pending
            && !self.snapshot.state.is_null()
        {
            workspace_selection(&mut self.snapshot.state, selection);
        }
    }
}
