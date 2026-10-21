//! Workspace file adapter. The core owns transitions and validation.
use inferay_core::{
    agent_state::{Pane, Workspace},
    workspace_action::AgentWorkspaceAction,
};
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

    pub fn read(&self) -> Result<Option<Workspace>, String> {
        let mut state = crate::json_file::read::<Workspace>(&self.path)?;
        if let Some(state) = &mut state {
            state.validate()?;
        }
        Ok(state)
    }

    fn require_state(&self) -> Result<Workspace, String> {
        self.read()?
            .ok_or_else(|| "Workspace not initialized".into())
    }

    pub fn pane(&self, id: &str) -> Result<Option<Pane>, String> {
        Ok(self.read()?.and_then(|state| state.pane(id).cloned()))
    }

    pub fn active_cwds(&self) -> Result<Vec<String>, String> {
        Ok(self
            .read()?
            .map(|state| state.active_cwds())
            .unwrap_or_default())
    }

    pub fn initialize(&self, default_kind: &str) -> Result<Workspace, String> {
        self.save(self.read()?.unwrap_or_else(|| Workspace::new(default_kind)))
    }

    pub fn apply_workspace_action(
        &self,
        action: &AgentWorkspaceAction,
        default_kind: &str,
    ) -> Result<Workspace, String> {
        let mut state = self.read()?.unwrap_or_else(|| Workspace::new(default_kind));
        state.apply_action(action, default_kind)?;
        state.validate()?;
        self.save(state)
    }

    pub fn restore_pane(&self, pane: Pane) -> Result<Workspace, String> {
        let mut state = self
            .read()?
            .unwrap_or_else(|| Workspace::new(&pane.agent_kind));
        state.restore_pane(pane)?;
        state.validate()?;
        self.save(state)
    }

    pub fn set_pending_workspace(&self, id: &str, paths: Vec<String>) -> Result<(), String> {
        let mut state = self.require_state()?;
        state.set_pending_workspace(id, paths)?;
        crate::json_file::write(&self.path, &state)
    }

    pub fn consume_pending_workspace(
        &self,
        id: &str,
    ) -> Result<Option<(String, Vec<String>)>, String> {
        let mut state = self.require_state()?;
        let selection = state.consume_pending_workspace(id)?;
        if selection.is_some() {
            crate::json_file::write(&self.path, &state)?;
        }
        Ok(selection)
    }

    pub fn set_pane_summary(&self, id: &str, summary: Option<String>) -> Result<(), String> {
        let mut state = self.require_state()?;
        state.set_pane_summary(id, summary)?;
        crate::json_file::write(&self.path, &state)
    }

    pub fn set_pane_provider_session(
        &self,
        id: &str,
        session: Option<String>,
    ) -> Result<(), String> {
        let mut state = self.require_state()?;
        state.set_pane_provider_session(id, session)?;
        crate::json_file::write(&self.path, &state)
    }

    fn save(&self, state: Workspace) -> Result<Workspace, String> {
        crate::json_file::write(&self.path, &state)?;
        Ok(state)
    }
}
