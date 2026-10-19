use crate::{
    project_file_commands, project_index,
    project_store::{Result, now},
};
use inferay_core::{
    project_files::{ProjectDefinition, ProjectFileCatalog, ProjectFileCommand},
    prompts::Prompt,
};
use rusqlite::{Connection, OptionalExtension};
use std::{
    fs::File,
    path::{Path, PathBuf},
};

pub(crate) struct FileProjectStore {
    pub db: Connection,
    pub root: PathBuf,
    _lease: ProfileLease,
}

struct ProfileLease(File);

impl Drop for ProfileLease {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

impl FileProjectStore {
    pub fn project_dir(&self, id: &str) -> Result<PathBuf> {
        uuid::Uuid::parse_str(id)?;
        let path = crate::project_definitions::managed_path(
            &self.root,
            &format!("projects/{id}/project.json"),
            false,
        )?;
        let directory = path.parent().ok_or("Project directory missing")?;
        let bytes = crate::project_definitions::read(
            directory,
            "project.json",
            inferay_core::project_files::MANIFEST_LIMIT,
        )?;
        let project: ProjectDefinition =
            inferay_core::project_files::parse("project.json", &bytes)?;
        if project.id != id || project.archived {
            return Err("Project is archived or its identity changed".into());
        }
        Ok(directory.canonicalize()?)
    }

    pub fn history(
        &self,
        project: &str,
        before: Option<&str>,
    ) -> Result<inferay_core::projects::ProjectHistory> {
        crate::project_runs::history(&self.db, &self.root, project, before)
    }

    pub fn context(
        &mut self,
        pane: &str,
        cwd: &Path,
        skills: &[Prompt],
    ) -> Result<Option<(String, String, PathBuf)>> {
        project_index::refresh(&mut self.db, &self.root, skills)?;
        let associated: Option<String> = self
            .db
            .query_row(
                "SELECT project_id FROM project_conversations WHERE pane_id=?",
                [pane],
                |r| r.get(0),
            )
            .optional()?;
        let id = match associated {
            Some(id) => id,
            None => {
                let Ok(cwd) = cwd.canonicalize() else {
                    return Ok(None);
                };
                let matches = self.db.prepare(
                    "SELECT DISTINCT p.id FROM projects p LEFT JOIN repository_paths r ON r.project_id=p.id WHERE p.valid=1 AND coalesce(json_extract(p.body,'$.archived'),0)=0 AND (r.path=?1 AND EXISTS (SELECT 1 FROM json_each(p.body,'$.repositories') WHERE json_extract(value,'$.id')=r.repository_id) OR ?2||'/projects/'||p.id=?1) ORDER BY p.id LIMIT 2"
                )?.query_map(rusqlite::params![cwd.to_string_lossy(), self.root.to_string_lossy()], |r| r.get::<_,String>(0))?
                    .collect::<std::result::Result<Vec<_>,_>>()?;
                if matches.len() != 1 {
                    return Ok(None);
                }
                matches.into_iter().next().unwrap()
            }
        };
        let body: Option<String> = self
            .db
            .query_row(
                "SELECT body FROM projects WHERE id=? AND valid=1",
                [&id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let Some(body) = body else { return Ok(None) };
        let project: ProjectDefinition = serde_json::from_str(&body)?;
        if project.archived {
            return Ok(None);
        }
        let file = crate::project_definitions::managed_path(
            &self.root,
            &format!("projects/{id}/project.json"),
            false,
        )?;
        let directory = file
            .parent()
            .ok_or("Project directory missing")?
            .canonicalize()?;
        let bindings = self.db.prepare("SELECT repository_id,path FROM repository_paths WHERE project_id=? ORDER BY repository_id")?
            .query_map([&id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?
            .collect::<std::result::Result<std::collections::BTreeMap<_,_>,_>>()?;
        let repositories: Vec<_> = project
            .repositories
            .iter()
            .map(|repo| {
                serde_json::json!({
                    "id":repo.id,"name":repo.name,"path":bindings.get(&repo.id),
                })
            })
            .collect();
        let mut instructions = project.instructions;
        if !repositories.is_empty() {
            instructions.push_str("\nLinked repositories (use the bound folder for repository commands; a null path needs a local binding):\n");
            instructions.push_str(&serde_json::to_string(&repositories)?);
        }
        Ok(Some((id, instructions, directory)))
    }

    pub fn open(root: &Path, skills: &[Prompt]) -> Result<Self> {
        std::fs::create_dir_all(root)?;
        let root = root.canonicalize()?;
        let lease = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("projects.lock"))?;
        lease
            .try_lock()
            .map_err(|_| "This Inferay profile is already open in another process")?;
        let lease = ProfileLease(lease);
        let mut db = crate::project_store::open_database(&root)?;
        project_index::create_schema(&db)?;
        crate::project_effects::create_schema(&db)?;
        crate::project_effects::recover(&db)?;
        project_index::refresh(&mut db, &root, skills)?;
        db.execute("UPDATE runs SET status=CASE WHEN stop_requested_at IS NULL THEN 'interrupted' ELSE 'cancelled' END,finished_at=?,error='Execution interrupted; inspect its output before retrying' WHERE status='running'",[now()])?;
        Ok(Self {
            db,
            root,
            _lease: lease,
        })
    }

    pub fn catalog(
        &mut self,
        project: Option<&str>,
        skills: &[Prompt],
    ) -> Result<ProjectFileCatalog> {
        project_index::refresh(&mut self.db, &self.root, skills)?;
        project_index::catalog(&self.db, project)
    }

    pub fn command(
        &mut self,
        command: ProjectFileCommand,
        host: bool,
        skills: &[Prompt],
    ) -> Result<serde_json::Value> {
        project_file_commands::apply(&mut self.db, &self.root, command, host, skills)
    }
}

#[cfg(test)]
mod tests;
