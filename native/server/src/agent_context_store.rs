//! Context file persistence and platform-specific project-key normalization.
use inferay_core::{
    agent_context::{AgentContextState, AgentContextUpdate, EffectiveAgentContext},
    prompts::Prompt,
};
use std::path::PathBuf;

#[derive(Debug)]
pub(crate) struct AgentContextStore {
    path: PathBuf,
}

impl AgentContextStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn resolve(&self, cwd: Option<&str>, pane_id: Option<&str>) -> EffectiveAgentContext {
        self.load().resolve(project_key(cwd).as_deref(), pane_id)
    }

    pub fn resolve_for_agent(
        &self,
        cwd: Option<&str>,
        pane_id: Option<&str>,
        text: &str,
        skills: &[Prompt],
    ) -> EffectiveAgentContext {
        self.load()
            .resolve_for_agent(project_key(cwd).as_deref(), pane_id, text, skills)
    }

    pub fn update(&self, mut update: AgentContextUpdate, now: u64) -> Result<(), String> {
        update.cwd = project_key(update.cwd.as_deref());
        let mut state = self.load();
        state.update(update, now)?;
        let bytes = serde_json::to_vec_pretty(&state).map_err(|error| error.to_string())?;
        crate::atomic_write::overwrite_sync(&self.path, &bytes)
    }

    fn load(&self) -> AgentContextState {
        std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
}

fn project_key(cwd: Option<&str>) -> Option<String> {
    let cwd = cwd?.trim();
    if cwd.is_empty() {
        return None;
    }
    std::path::absolute(cwd)
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_keys_are_normalized_at_the_storage_boundary() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("context.json");
        AgentContextStore::new(path.clone())
            .update(
                AgentContextUpdate {
                    scope: "project".into(),
                    cwd: Some(" . ".into()),
                    pane_id: None,
                    instructions: " Project instructions ".into(),
                    mode: Some("replace".into()),
                },
                42,
            )
            .unwrap();
        let cwd = std::env::current_dir().unwrap();
        let context = AgentContextStore::new(path).resolve(cwd.to_str(), None);
        assert_eq!(context.effective_instructions, "Project instructions");
        assert_eq!(context.project.unwrap().updated_at, 42);
    }
}
