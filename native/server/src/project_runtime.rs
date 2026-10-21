use serde::Deserialize;
pub(crate) mod tool;
use crate::{
    agent_runner::{self, RuntimePidTracker},
    project_file_store::FileProjectStore,
    project_store::{self, Result, event, now, resolve_path},
    prompt_store::PromptStore,
};
use inferay_core::{
    project_files::{ProjectFileCommand, ProjectWorkspace},
    projects::*,
};
use rusqlite::params;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{io::AsyncWriteExt, sync::Semaphore};

// Runtime view only: approval comparisons and persisted run files retain the original JSON.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionInputs {
    pub automation: inferay_core::project_files::AutomationDefinition,
    pub execution: ProjectExecution,
    pub project_id: String,
    #[serde(default)]
    pub tools: std::collections::BTreeMap<String, crate::project_tools::CapturedTool>,
}

pub(crate) struct ProjectRuntime {
    store: Mutex<FileProjectStore>,
    pub capacity: Arc<Semaphore>,
    background: Arc<Semaphore>,
    pub(crate) chat: std::sync::OnceLock<std::sync::Weak<crate::chat_runtime::ChatRuntime>>,
    pub(crate) prompts: Arc<tokio::sync::Mutex<PromptStore>>,
    tracker: RuntimePidTracker,
    pub memory: crate::memory_store::MemoryStore,
    pub connections: Arc<crate::connections::Store>,
}
impl ProjectRuntime {
    pub fn open(
        root: &Path,
        prompts: Arc<tokio::sync::Mutex<PromptStore>>,
        tracker: RuntimePidTracker,
    ) -> Result<Arc<Self>> {
        let skills = prompts
            .try_lock()
            .map_err(|_| "Skills startup lock unavailable")?
            .load()?;
        let store = FileProjectStore::open(root, &skills)?;
        Ok(Arc::new(Self {
            store: Mutex::new(store),
            capacity: Arc::new(Semaphore::new(4)),
            background: Arc::new(Semaphore::new(2)),
            chat: std::sync::OnceLock::new(),
            prompts,
            tracker,
            memory: crate::memory_store::MemoryStore::open(root)?,
            connections: Arc::new(crate::connections::Store::open(root)?),
        }))
    }
    pub(crate) fn store(
        &self,
    ) -> std::result::Result<std::sync::MutexGuard<'_, FileProjectStore>, String> {
        self.store
            .lock()
            .map_err(|_| "Project store lock failed".into())
    }
    pub fn start(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let Some(runtime) = weak.upgrade() else { break };
                if let Err(e) = runtime.tick().await {
                    eprintln!("Project scheduler: {e}");
                }
            }
        });
    }
    pub fn is_run_chat(&self, pane: &str) -> Result<bool> {
        Ok(self.store()?.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM runs WHERE json_extract(result,'$.chatPaneId')=?1)",
            [pane],
            |row| row.get(0),
        )?)
    }

    pub fn attach_run_chat(&self, id: &str, pane: &str) -> Result<()> {
        let store = self.store()?;
        store.db.execute(
            "UPDATE runs SET result=json_set(COALESCE(result,'{}'),'$.chatPaneId',?2) WHERE id=?1",
            params![id, pane],
        )?;
        Ok(())
    }
    pub fn run_for_chat(&self, id: &str) -> Result<ProjectRun> {
        let store = self.store()?;
        let mut runs = project_store::rows::<ProjectRun>(
            &store.db,
            "SELECT json_object('id',id,'projectId',project_id,'automationId',automation_id,'name',name,'status',status,'requestedAt',requested_at,'startedAt',started_at,'finishedAt',finished_at,'result',json(result),'error',error,'snapshot',json(snapshot),'directory',?2||'/projects/'||project_id||'/runs/'||id) FROM runs WHERE id=?1",
            params![id, store.root.to_string_lossy()],
        )?;
        let mut run = runs.pop().ok_or("Run not found")?;
        crate::project_runs::attach_usage(&store.db, std::slice::from_mut(&mut run))?;
        run.presentation = run.presentation();
        run.conversation_available = crate::project_runs::conversation_available(&run);
        Ok(run)
    }
    pub async fn history(
        self: &Arc<Self>,
        project: String,
        before: Option<String>,
    ) -> Result<inferay_core::projects::ProjectHistory> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || this.store()?.history(&project, before.as_deref()))
            .await?
    }
    pub async fn catalog(
        self: &Arc<Self>,
        project: Option<String>,
        before: Option<String>,
    ) -> Result<ProjectWorkspace> {
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut store = this.store()?;
            let mut catalog = store.catalog(project.as_deref(), &skills)?;
            let history = store.history(project.as_deref().unwrap_or(""), before.as_deref())?;
            for plugin in &mut catalog.plugins {
                plugin.overview.latest_run_id = history.runs.iter().filter(|run| plugin.overview.consumers.contains_key(&run.automation_id)).min_by_key(|run| std::cmp::Reverse(run.requested_at)).map(|run| run.id.clone());
            }
            let conversation_projects = store.db.prepare("SELECT pane_id,project_id FROM project_conversations ORDER BY pane_id LIMIT 4096")?
                .query_map([], |r| Ok((r.get(0)?,r.get(1)?)))?
                .collect::<std::result::Result<_,_>>()?;
            Ok(ProjectWorkspace {catalog,history,conversation_projects,root:store.root.to_string_lossy().into()})
        }).await?
    }
    pub async fn document_bytes(
        self: &Arc<Self>,
        project_id: String,
        path: String,
    ) -> Result<Vec<u8>> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            if !path.starts_with("memory/documents/") {
                return Err("Choose a project document".into());
            }
            let store = this.store()?;
            let root = store.project_dir(&project_id)?;
            crate::project_definitions::read(&root, &path, 20 * 1024 * 1024)
        })
        .await?
    }

    pub async fn import_document(
        self: &Arc<Self>,
        project_id: String,
        name: String,
        bytes: Vec<u8>,
    ) -> Result<Value> {
        if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
            return Err("Choose a file with a plain filename".into());
        }
        if bytes.len() > 20 * 1024 * 1024 {
            return Err("Documents must be no larger than 20 MB".into());
        }
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let store = this.store()?;
            let root = store.project_dir(&project_id)?;
            let path = format!("memory/documents/{name}");
            let hash = crate::project_definitions::write(&root, &path, &bytes, None)?;
            Ok(json!({"path":path,"sourceHash":hash}))
        })
        .await?
    }

    pub async fn import_library(
        self: &Arc<Self>,
        project_id: String,
        name: String,
        originals: std::collections::BTreeMap<String, Vec<u8>>,
    ) -> Result<Value> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let store = this.store()?;
            let root = store.project_dir(&project_id)?;
            let id = crate::project_definitions::import_library(&root, &name, &originals)?;
            Ok(json!({"id":id}))
        })
        .await?
    }

    pub async fn preview_automation(self: &Arc<Self>, command: &ProjectFileCommand) -> Result<()> {
        inferay_core::project_files::proposed_automation(command)?;
        let ProjectFileCommand::SaveDefinition {
            project_id,
            path,
            content,
            expected_hash,
        } = command
        else {
            unreachable!()
        };
        let skills = self.prompts.lock().await.load()?;
        let store = self.store()?;
        let root = store.project_dir(project_id)?;
        let target = crate::project_definitions::managed_path(&root, path, false)?;
        let current = match std::fs::read(target) {
            Ok(bytes) => Some(project_store::hash(&bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        if current.as_deref() != expected_hash.as_deref() {
            return Err(
                "Automation changed; read its current sourceHash before proposing an update".into(),
            );
        }
        crate::project_definitions::validate_write(
            &root,
            path,
            content.as_bytes(),
            &skills.iter().map(|s| format!("global:{}", s.id)).collect(),
        )
    }

    pub async fn preview_plugin(self: &Arc<Self>, command: &ProjectFileCommand) -> Result<()> {
        let skills = self.prompts.lock().await.load()?;
        let store = self.store()?;
        let globals = skills.iter().map(|s| format!("global:{}", s.id)).collect();
        match command {
            ProjectFileCommand::CreatePlugin {
                project_id,
                slug,
                files,
            } => {
                let root = store.project_dir(project_id)?;
                crate::project_definitions::validate_bundle(&root, slug, files, &globals)
            }
            ProjectFileCommand::UpdatePlugin {
                project_id,
                slug,
                expected_hash,
                files,
                remove,
            } => {
                let root = store.project_dir(project_id)?;
                crate::project_definitions::prepare_plugin_update(
                    &root,
                    slug,
                    expected_hash,
                    files,
                    remove,
                    &globals,
                )
                .map(|_| ())
            }
            _ => Err("Expected a plugin bundle".into()),
        }
    }

    pub async fn review_plugin_proposal(
        self: &Arc<Self>,
        command: ProjectFileCommand,
    ) -> Result<inferay_core::project_files::PluginProposalReview> {
        let project_id = match &command {
            ProjectFileCommand::CreatePlugin { project_id, .. }
            | ProjectFileCommand::UpdatePlugin { project_id, .. } => project_id.clone(),
            _ => return Err("Expected a plugin proposal".into()),
        };
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let store = this.store()?;
            let root = store.project_dir(&project_id)?;
            let globals = skills
                .iter()
                .map(|skill| format!("global:{}", skill.id))
                .collect();
            crate::project_proposals::review::plugin(&root, &command, &globals)
        })
        .await?
    }

    pub async fn proposal(
        self: &Arc<Self>,
        request: inferay_core::project_files::ProjectProposalRequest,
    ) -> Result<inferay_core::project_files::ProjectProposalView> {
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut store = this.store()?;
            crate::project_proposals::resolve(&mut store, request, &skills)
        })
        .await?
    }

    pub async fn command(self: &Arc<Self>, cmd: ProjectFileCommand, host: bool) -> Result<Value> {
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        tokio::task::spawn_blocking(move || this.store()?.command(cmd, host, &skills)).await?
    }
    pub async fn context(
        &self,
        pane: &str,
        cwd: &Path,
    ) -> Result<Option<(String, String, PathBuf)>> {
        let skills = self.prompts.lock().await.load()?;
        self.store()?.context(pane, cwd, &skills)
    }
    async fn tick(self: &Arc<Self>) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            if !this.store()?.has_pending_runs(now())? {
                return Ok(());
            }
            let skills = this.prompts.blocking_lock().load()?;
            this.store()?.schedule_due(&skills, now())?;
            for _ in 0..2 {
                let Ok(background) = this.background.clone().try_acquire_owned() else {
                    break;
                };
                let Ok(capacity) = this.capacity.clone().try_acquire_owned() else {
                    break;
                };
                let selected = this.store()?.claim_next(&skills)?;
                let Some((id, project, snapshot)) = selected else {
                    break;
                };
                let runtime = this.clone();
                tokio::spawn(async move {
                    let _background = background;
                    // Regular chats acquire their own shared execution permit.
                    let _capacity = if snapshot["execution"]["kind"] == "agent" {
                        drop(capacity);
                        None
                    } else {
                        Some(capacity)
                    };
                    let result = runtime.execute(&id, &project, &snapshot).await;
                    if let Err(e) = runtime.finish(&id, &project, result) {
                        eprintln!("Run completion retained for recovery: {e}");
                    }
                });
            }
            Ok(())
        })
        .await?
    }
    pub(crate) fn stopped(&self, id: &str) -> bool {
        self.store()
            .ok()
            .and_then(|s| {
                s.db.query_row(
                    "SELECT stop_requested_at IS NOT NULL FROM runs WHERE id=?",
                    [id],
                    |r| r.get::<_, bool>(0),
                )
                .ok()
            })
            .unwrap_or(true)
    }
    async fn execute(self: &Arc<Self>, id: &str, project: &str, snapshot: &Value) -> Result<Value> {
        let inputs = Arc::new(ExecutionInputs::deserialize(snapshot)?);
        let skills = self.prompts.lock().await.load()?;
        let root = {
            let store = self.store()?;
            let current = crate::project_index::approved_inputs(
                &store.db,
                &store.root,
                &inputs.automation.id,
                false,
                &skills,
            )?;
            if current != *snapshot || inputs.project_id != project {
                return Err("Execution inputs changed after admission. Review and retry.".into());
            }
            uuid::Uuid::parse_str(project)?;
            crate::project_definitions::managed_path(
                &store.root,
                &format!("projects/{project}/project.json"),
                false,
            )?
            .parent()
            .ok_or("Project directory missing")?
            .canonicalize()?
        };
        let dir = root.join("runs").join(id);
        for folder in ["inputs", "output", "logs"] {
            let path = dir.join(folder);
            std::fs::create_dir_all(&path)?;
            if !path.canonicalize()?.starts_with(&root) {
                return Err("Run folder escapes project".into());
            }
        }
        if !dir.canonicalize()?.starts_with(&root) {
            return Err("Run path escapes project".into());
        }
        std::fs::write(
            dir.join("inputs/run.json"),
            serde_json::to_vec_pretty(snapshot)?,
        )?;
        if snapshot["connections"]
            .as_object()
            .is_some_and(|connections| !connections.is_empty())
            && !inputs
                .automation
                .may
                .contains(&inferay_core::project_files::Permission::Network)
        {
            return Err("Connection requests require network permission".into());
        }
        crate::project_requirements::check(snapshot, &root, &dir).await?;
        match inputs.execution.clone() {
            ProjectExecution::Tool { tool_id, input } => {
                let tool: LocalTool = LocalTool::deserialize(&snapshot["tool"])?;
                let cancelled = || self.stopped(id);
                tool::execute(
                    self,
                    tool::Invocation {
                        id,
                        root: &root,
                        dir: &dir,
                        call: None,
                        connection_tool: Some(&tool_id),
                        tool,
                        input,
                        snapshot,
                        entrypoint_hash: snapshot["entrypointHash"]
                            .as_str()
                            .ok_or("Missing entrypoint hash")?,
                        permissions: &inputs.automation.may,
                        cancelled: &cancelled,
                    },
                )
                .await
            }
            ProjectExecution::Agent { .. } => {
                let chat = self
                    .chat
                    .get()
                    .and_then(std::sync::Weak::upgrade)
                    .ok_or("Chat runtime is unavailable")?;
                chat.run_automation(id, project, &root, &dir, snapshot, inputs.clone())
                    .await
            }
        }
    }
    fn finish(&self, id: &str, project: &str, result: Result<Value>) -> Result<()> {
        let mut store = self.store()?;
        let root = store
            .root
            .join("projects")
            .join(project)
            .join("runs")
            .join(id)
            .join("output");
        let tx = store
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let stopped: bool = tx.query_row(
            "SELECT stop_requested_at IS NOT NULL FROM runs WHERE id=?",
            [id],
            |r| r.get(0),
        )?;
        tx.execute_batch("SAVEPOINT artifacts")?;
        let result = if stopped {
            Err("Cancelled by user".into())
        } else {
            result
        };
        let result = result.and_then(|value| {
            if let Some(files) = value["artifacts"].as_array() {
                if files.len() > 100 {
                    return Err("At most 100 artifacts per run".into());
                }
                for file in files {
                    let name = file.as_str().ok_or("Artifact path must be text")?;
                    let path = resolve_path(&root, &ProjectPath::Project { path: name.into() })?;
                    let meta = path.metadata()?;
                    if !meta.is_file() || meta.len() > 50_000_000 {
                        return Err("Artifact must be a file under 50 MB".into());
                    }
                    let bytes = std::fs::read(&path)?;
                    crate::project_effects::capture(&tx, project, id, name, &bytes)?;
                    tx.execute(
                        "INSERT INTO artifacts VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                        params![
                            uuid::Uuid::new_v4().to_string(),
                            project,
                            id,
                            name,
                            path.to_string_lossy(),
                            meta.len() as i64,
                            project_store::hash(&bytes),
                            now()
                        ],
                    )?;
                }
            }
            Ok(value)
        });
        if result.is_err() {
            tx.execute_batch("ROLLBACK TO artifacts")?;
        }
        tx.execute_batch("RELEASE artifacts")?;
        let (status, value, error) = if stopped {
            ("cancelled", None, Some("Cancelled by user".into()))
        } else {
            match result {
                Ok(value) => (
                    if value["waitingForInput"] == true {
                        "waiting_input"
                    } else {
                        "succeeded"
                    },
                    Some(value.to_string()),
                    None,
                ),
                Err(e) => ("failed", None, Some(e.to_string())),
            }
        };
        tx.execute("UPDATE runs SET status=?1,result=CASE WHEN json_type(result,'$.chatPaneId')='text' THEN json_set(COALESCE(?2,'{}'),'$.chatPaneId',json_extract(result,'$.chatPaneId')) ELSE ?2 END,error=?3,finished_at=?4 WHERE id=?5 AND status='running'",params![status,value,error,now(),id])?;
        event(&tx, id, status, &json!({"error":error}))?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
