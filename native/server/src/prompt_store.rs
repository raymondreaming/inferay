//! File adapter for the pure skill library, command expansion, and agent tools.
use inferay_core::prompts::{
    Prompt, PromptError, SkillProposalView,
    commands::{self, ChainStep},
    library::{PromptLibrary, ProposalRequest},
    merge_prompts, tools,
};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests;

#[derive(Debug)]
pub(crate) struct PromptStore {
    bundled_path: PathBuf,
    local_path: PathBuf,
}

impl PromptStore {
    pub fn new(bundled_path: PathBuf, local_path: PathBuf) -> Self {
        Self {
            bundled_path,
            local_path,
        }
    }

    pub fn load(&self) -> Result<Vec<Prompt>, String> {
        fn read(path: &Path) -> Result<Vec<Prompt>, String> {
            if !path.is_file() {
                return Ok(Vec::new());
            }
            let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())
        }
        Ok(merge_prompts(
            read(&self.bundled_path)?,
            read(&self.local_path)?,
        ))
    }

    pub fn create(&self, body: &Map<String, Value>, now: u64) -> Result<Prompt, PromptError> {
        let prompt = Prompt::custom(body, now)?;
        self.change(|library| library.insert(prompt))
    }

    pub fn update(
        &self,
        id: &str,
        body: &Map<String, Value>,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        self.change(|library| library.update(id, body, now))
    }

    pub fn delete(&self, id: &str) -> Result<(), PromptError> {
        self.change(|library| library.delete(id))
    }

    pub fn proposal(
        &self,
        proposal: &Value,
        stored: &Value,
        decision: Option<&str>,
        now: u64,
    ) -> Result<(SkillProposalView, Option<Value>), PromptError> {
        let request = ProposalRequest::new(proposal, stored, decision, now)?;
        let mut library = PromptLibrary::new(if request.needs_library() {
            self.load().map_err(storage_error)?
        } else {
            Vec::new()
        });
        let result = library.proposal(request)?;
        if result
            .1
            .as_ref()
            .is_some_and(|record| record["outcome"]["status"] == "saved")
        {
            self.save(library.prompts()).map_err(storage_error)?;
        }
        Ok(result)
    }

    pub fn expand_chat_command_chain(
        &self,
        text: &str,
        command_id: Option<&str>,
        args: Option<&str>,
    ) -> Result<Vec<ChainStep>, String> {
        Ok(commands::expand_chat_command_chain(
            &self.load()?,
            text,
            command_id,
            args,
        ))
    }

    pub fn call_tool(&self, tool: &str, args: &Value) -> Result<(Value, Option<Value>), String> {
        tools::validate_tool(tool)?;
        tools::call_tool(&self.load()?, tool, args)
    }

    fn change<T>(
        &self,
        apply: impl FnOnce(&mut PromptLibrary) -> Result<T, PromptError>,
    ) -> Result<T, PromptError> {
        let mut library = PromptLibrary::new(self.load().map_err(storage_error)?);
        let result = apply(&mut library)?;
        self.save(library.prompts()).map_err(storage_error)?;
        Ok(result)
    }

    fn save(&self, prompts: &[Prompt]) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(prompts).map_err(|error| error.to_string())?;
        crate::atomic_write::overwrite_sync(&self.local_path, &bytes)
    }
}

fn storage_error(message: String) -> PromptError {
    PromptError {
        status: 500,
        message,
    }
}
