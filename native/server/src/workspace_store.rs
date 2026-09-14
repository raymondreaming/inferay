//! Workspace file adapter. The core owns transitions, validation, and projections.
use inferay_core::{
    agent_state::{Pane, Workspace},
    workspace_action::AgentWorkspaceAction,
};
use serde_json::Value;
use std::path::PathBuf;

#[cfg(test)]
mod tests;

#[derive(Debug)]
pub(crate) struct AgentStateStore {
    path: PathBuf,
}

impl AgentStateStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> Result<Option<Workspace>, String> {
        match std::fs::read(&self.path) {
            Ok(bytes) => {
                let mut state: Workspace =
                    serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
                state.validate()?;
                Ok(Some(state))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn require_state(&self) -> Result<Workspace, String> {
        self.load()?
            .ok_or_else(|| "Workspace not initialized".into())
    }

    pub fn read(&self) -> Result<Value, String> {
        self.load()?
            .map(|state| state.presentation())
            .transpose()
            .map(|state| state.unwrap_or(Value::Null))
    }

    pub fn pane(&self, id: &str) -> Result<Option<Pane>, String> {
        Ok(self.load()?.and_then(|state| state.pane(id).cloned()))
    }

    pub fn active_cwds(&self) -> Result<Vec<String>, String> {
        Ok(self
            .load()?
            .map(|state| state.active_cwds())
            .unwrap_or_default())
    }

    pub fn initialize(&self, default_kind: &str) -> Result<Value, String> {
        self.save(&self.load()?.unwrap_or_else(|| Workspace::new(default_kind)))
    }

    pub fn apply_workspace_action(
        &self,
        action: &AgentWorkspaceAction,
        default_kind: &str,
    ) -> Result<Value, String> {
        let mut state = self.load()?.unwrap_or_else(|| Workspace::new(default_kind));
        state.apply_action(action, default_kind)?;
        state.validate()?;
        self.save(&state)
    }

    pub fn set_pending_workspace(&self, id: &str, paths: Vec<String>) -> Result<Value, String> {
        let mut state = self.require_state()?;
        state.set_pending_workspace(id, paths)?;
        self.save(&state)
    }

    pub fn consume_pending_workspace(
        &self,
        id: &str,
    ) -> Result<Option<(String, Vec<String>)>, String> {
        let mut state = self.require_state()?;
        let selection = state.consume_pending_workspace(id)?;
        if selection.is_some() {
            self.save(&state)?;
        }
        Ok(selection)
    }

    pub fn set_pane_summary(&self, id: &str, summary: Option<String>) -> Result<Value, String> {
        let mut state = self.require_state()?;
        state.set_pane_summary(id, summary)?;
        self.save(&state)
    }

    pub fn set_pane_provider_session(
        &self,
        id: &str,
        session: Option<String>,
    ) -> Result<Value, String> {
        let mut state = self.require_state()?;
        state.set_pane_provider_session(id, session)?;
        self.save(&state)
    }

    fn save(&self, state: &Workspace) -> Result<Value, String> {
        let bytes = serde_json::to_vec(state).map_err(|error| error.to_string())?;
        crate::atomic_write::overwrite_sync(&self.path, &bytes)?;
        state.presentation()
    }
}
