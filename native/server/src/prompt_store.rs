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
        let db = self.open_skills().map_err(|e| e.to_string())?;
        crate::project_store::rows(&db, "SELECT body FROM skills ORDER BY id", [])
            .map_err(|e| e.to_string())
    }

    pub fn migrate(&self) -> Result<(), String> {
        self.open_skills().map(|_| ()).map_err(|e| e.to_string())
    }

    fn open_skills(&self) -> crate::project_store::Result<rusqlite::Connection> {
        let root = self.local_path.parent().ok_or("Skills directory missing")?;
        std::fs::create_dir_all(root)?;
        let mut db = rusqlite::Connection::open(root.join("skills.sqlite3"))?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
            CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY);")?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if !tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM migrations WHERE name='global-skills-v1')",
            [],
            |r| r.get::<_, bool>(0),
        )? {
            // The old source remains untouched. Once the marker is committed, it is never read again.
            let mut imported: Option<Vec<Prompt>> = None;
            if root.join("projects.sqlite3").exists() {
                let legacy = rusqlite::Connection::open_with_flags(
                    root.join("projects.sqlite3"),
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                )?;
                let has_marker = legacy.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_migrations')", [], |r| r.get::<_, bool>(0))?;
                if has_marker
                    && legacy.query_row(
                        "SELECT EXISTS(SELECT 1 FROM project_migrations WHERE name='skills-v1')",
                        [],
                        |r| r.get::<_, bool>(0),
                    )?
                {
                    imported = Some(crate::project_store::rows(
                        &legacy,
                        "SELECT v.body FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id IS NULL AND r.type_id='inferay.skill' AND r.archived=0 ORDER BY r.id",
                        [],
                    )?);
                }
            }
            let prompts: Vec<Prompt> = match imported {
                Some(prompts) => prompts,
                None => crate::json_file::read_existing(&self.local_path)?.unwrap_or_default(),
            };
            for prompt in prompts.iter().filter(|p| !p.is_built_in) {
                tx.execute(
                    "INSERT INTO skills(id,body) VALUES(?,?)",
                    rusqlite::params![prompt.id, serde_json::to_string(prompt)?],
                )?;
            }
            tx.execute("INSERT INTO migrations VALUES('global-skills-v1')", [])?;
        }
        tx.commit()?;
        Ok(db)
    }

    fn save(&self, prompts: &[Prompt]) -> Result<(), String> {
        self.save_database(prompts).map_err(|e| e.to_string())
    }

    fn save_database(&self, prompts: &[Prompt]) -> crate::project_store::Result<()> {
        let mut db = self.open_skills()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM skills", [])?;
        for prompt in prompts.iter().filter(|p| !p.is_built_in) {
            tx.execute(
                "INSERT INTO skills(id,body) VALUES(?,?)",
                rusqlite::params![prompt.id, serde_json::to_string(prompt)?],
            )?;
        }
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
