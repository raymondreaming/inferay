//! Optimistic workspace selection and acknowledgement policy. HTTP ordering stays in JS.
use crate::json_wire;
use inferay_core::{
    agent_state::{Workspace, WorkspaceSelection},
    workspace_action::AgentWorkspaceAction,
};
use serde::Serialize;
use serde_json::json;
use std::{collections::HashSet, rc::Rc};
use ts_rs::TS;

#[derive(Default, Serialize, TS)]
pub struct WorkspaceSnapshot {
    #[ts(as = "Option<Workspace>")]
    state: Option<Rc<Workspace>>,
    error: Option<String>,
}

#[derive(Default)]
pub struct WorkspaceReplica {
    snapshot: WorkspaceSnapshot,
    canonical: Option<Rc<Workspace>>,
    pending: Option<(u32, WorkspaceSelection)>,
    structural: HashSet<u32>,
    sequence: u32,
}

impl WorkspaceReplica {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn snapshot(&self) -> String {
        json_wire::stringify(&self.snapshot, "workspace snapshot")
    }
    pub fn begin(&mut self, action: &str) -> Result<String, String> {
        let action: AgentWorkspaceAction = json_wire::parse(action)?;
        let selection = self
            .snapshot
            .state
            .as_ref()
            .and_then(|state| state.selection_for(&action));
        let unchanged = selection.as_ref().is_some_and(|selection| {
            !Rc::make_mut(self.snapshot.state.as_mut().unwrap()).select(selection)
        });
        if unchanged && self.structural.is_empty() && self.snapshot.error.is_none() {
            return Ok("null".into());
        }
        self.sequence += 1;
        let selecting = selection.is_some();
        if let Some(selection) = selection {
            self.pending = Some((self.sequence, selection));
        } else {
            self.structural.insert(self.sequence);
        }
        Ok(json!({"id":self.sequence,"selecting":selecting}).to_string())
    }
    pub fn accept(&mut self, state: &str, request: Option<u32>) -> Result<String, String> {
        let state = json_wire::parse(state)?;
        self.clear(request);
        self.canonical = state;
        self.snapshot.state = self.canonical.clone();
        self.snapshot.error = None;
        self.overlay();
        Ok(self.snapshot())
    }
    pub fn fail(&mut self, request: Option<u32>) -> String {
        self.clear(request);
        if request.is_some() && self.canonical.is_some() {
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
            && let Some(state) = &mut self.snapshot.state
        {
            Rc::make_mut(state).select(selection);
        }
    }
}
