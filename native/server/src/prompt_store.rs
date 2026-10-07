//! Local persistence adapter for the pure skill library, command expansion, and agent tools.
use inferay_core::prompts::{
    Prompt, PromptError, SkillProposalView,
    commands::{self, ChainStep},
    library::{PromptLibrary, ProposalRequest},
    merge_prompts, tools,
};
use serde_json::{Map, Value};
use std::path::PathBuf;

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
        Ok(merge_prompts(
            crate::json_file::read_existing(&self.bundled_path)?.unwrap_or_default(),
            self.load_custom()?,
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

    fn load_custom(&self) -> Result<Vec<Prompt>, String> {
        let root = self.local_path.parent().ok_or("Skills directory missing")?;
        if root.join("projects.sqlite3").exists() {
            let db = rusqlite::Connection::open_with_flags(
                root.join("projects.sqlite3"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(|e| e.to_string())?;
            let migrated = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM project_migrations WHERE name='skills-v1')",
                    [],
                    |r| r.get::<_, bool>(0),
                )
                .map_err(|e| e.to_string())?;
            if migrated {
                return crate::project_store::rows(&db,"SELECT v.body FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id IS NULL AND r.type_id='inferay.skill' AND r.archived=0 ORDER BY r.id",[]).map_err(|e|e.to_string());
            }
        }
        Ok(crate::json_file::read_existing(&self.local_path)?.unwrap_or_default())
    }

    pub fn migrate(&self) -> Result<(), String> {
        let prompts = self.load_custom()?;
        self.save(&prompts)
    }

    fn save(&self, prompts: &[Prompt]) -> Result<(), String> {
        self.save_database(prompts).map_err(|e| e.to_string())
    }
    fn save_database(&self, prompts: &[Prompt]) -> crate::project_store::Result<()> {
        use rusqlite::{OptionalExtension, params};
        let root = self.local_path.parent().ok_or("Skills directory missing")?;
        std::fs::create_dir_all(root)?;
        let mut db = crate::project_store::open_database(root)?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if self.local_path.exists()
            && !tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM project_migrations WHERE name='skills-v1')",
                [],
                |r| r.get::<_, bool>(0),
            )?
        {
            let backup = self.local_path.with_extension("json.pre-projects.bak");
            if !backup.exists() {
                std::fs::copy(&self.local_path, backup)?;
            }
        }
        let existing:Vec<String>=tx.prepare("SELECT id FROM resources WHERE project_id IS NULL AND type_id='inferay.skill' AND archived=0")?.query_map([],|r|r.get(0))?.collect::<Result<_,_>>()?;
        for id in existing {
            if !prompts.iter().any(|p| p.id == id && !p.is_built_in) {
                tx.execute("UPDATE resources SET archived=1 WHERE id=?", [id])?;
            }
        }
        for prompt in prompts.iter().filter(|p| !p.is_built_in) {
            let body = serde_json::to_string(prompt)?;
            let old:Option<(i64,String)>=tx.query_row("SELECT r.revision,v.body FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.id=? AND r.project_id IS NULL AND r.type_id='inferay.skill'",[&prompt.id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            if old.as_ref().is_some_and(|(_, saved)| saved == &body) {
                continue;
            }
            let revision = old.map_or(1, |(rev, _)| rev + 1);
            tx.execute("INSERT INTO resources(id,project_id,type_id,name,revision) VALUES(?1,NULL,'inferay.skill',?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision,archived=0",params![prompt.id,prompt.name,revision])?;
            tx.execute(
                "INSERT INTO resource_revisions VALUES(?1,?2,1,?3,?4,?5)",
                params![
                    prompt.id,
                    revision,
                    body,
                    crate::project_store::hash(body.as_bytes()),
                    crate::project_store::now()
                ],
            )?;
        }
        tx.execute(
            "INSERT OR IGNORE INTO project_migrations VALUES('skills-v1',?)",
            [crate::project_store::now()],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn storage_error(message: String) -> PromptError {
    PromptError {
        status: 500,
        message,
    }
}
