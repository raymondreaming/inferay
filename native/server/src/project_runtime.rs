//! Durable local execution; presentation observes this owner and never drives its clock.
pub(crate) mod tool;
use crate::{
    agent_command::AgentCommandResolver,
    agent_runner::{self, AgentProcessHandle, RuntimePidTracker},
    project_file_store::FileProjectStore,
    project_store::{self, Result, event, now, resolve_path},
    prompt_store::PromptStore,
};
use inferay_core::{
    agent_kind::AgentKind,
    agent_protocol::{
        AgentProtocolContext, CodexInvocationContext, CodexProtocolState, ProtocolEmission,
    },
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
use tokio::{
    io::AsyncWriteExt,
    sync::Semaphore,
};

pub(crate) struct ProjectRuntime {
    pub store: Mutex<FileProjectStore>,
    pub capacity: Arc<Semaphore>,
    background: Arc<Semaphore>,
    resolver: Arc<AgentCommandResolver>,
    pub(crate) prompts: Arc<tokio::sync::Mutex<PromptStore>>,
    tracker: RuntimePidTracker,
    pub memory: crate::memory_store::MemoryStore,
}
impl ProjectRuntime {
    pub fn open(
        root: &Path,
        resolver: Arc<AgentCommandResolver>,
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
            resolver,
            prompts,
            tracker,
            memory: crate::memory_store::MemoryStore::open(root)?,
        }))
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
    pub fn attach_run_chat(&self, id: &str, pane: &str) -> Result<()> {
        let store = self.store.lock().map_err(|_| "Project store lock failed")?;
        store.db.execute(
            "UPDATE runs SET result=json_set(COALESCE(result,'{}'),'$.chatPaneId',?2) WHERE id=?1",
            params![id, pane],
        )?;
        Ok(())
    }
    pub fn run_for_chat(&self, id: &str) -> Result<ProjectRun> {
        let store = self.store.lock().map_err(|_| "Project store lock failed")?;
        let mut runs = project_store::rows::<ProjectRun>(
            &store.db,
            "SELECT json_object('id',id,'projectId',project_id,'automationId',automation_id,'name',name,'status',status,'requestedAt',requested_at,'startedAt',started_at,'finishedAt',finished_at,'result',json(result),'error',error,'snapshot',json(snapshot),'directory',?2||'/projects/'||project_id||'/runs/'||id) FROM runs WHERE id=?1",
            params![id, store.root.to_string_lossy()],
        )?;
        runs.pop().ok_or_else(|| "Run not found".into())
    }
    pub async fn catalog(
        self: &Arc<Self>,
        project: Option<String>,
        before: Option<String>,
    ) -> Result<ProjectWorkspace> {
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut store = this.store.lock().map_err(|_| "Project store lock failed")?;
            let catalog = store.catalog(project.as_deref(), &skills)?;
            let history = store.history(project.as_deref().unwrap_or(""), before.as_deref())?;
            let conversation_projects = store.db.prepare("SELECT pane_id,project_id FROM project_conversations ORDER BY pane_id LIMIT 4096")?
                .query_map([], |r| Ok((r.get(0)?,r.get(1)?)))?
                .collect::<std::result::Result<_,_>>()?;
            Ok(ProjectWorkspace {catalog,history,conversation_projects,root:store.root.to_string_lossy().into()})
        }).await?
    }
    pub fn migrate_workspace(&self, state: &Value) -> Result<()> {
        let skills = self
            .prompts
            .try_lock()
            .map_err(|_| "Skills startup lock unavailable")?
            .load()?;
        let mut store = self.store.lock().map_err(|_| "Project store lock failed")?;
        let root = store.root.clone();
        crate::project_migration::workspace_projects(&mut store.db, &root, state, &skills)
    }

    pub async fn documents(
        self: &Arc<Self>,
        project_id: String,
    ) -> Result<Vec<inferay_core::project_files::ProjectDocument>> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let store = this.store.lock().map_err(|_| "Project store lock failed")?;
            let root = store.project_dir(&project_id)?;
            let directory =
                crate::project_definitions::managed_path(&root, "memory/documents", false)?;
            if !directory.try_exists()? {
                return Ok(vec![]);
            }
            let mut documents = Vec::new();
            for (count, entry) in walkdir::WalkDir::new(&directory)
                .follow_links(false)
                .max_depth(16)
                .into_iter()
                .enumerate()
            {
                if count >= 10_000 {
                    return Err("Document library exceeds the 10,000 entry browsing limit".into());
                }
                let entry = entry?;
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry
                    .path()
                    .strip_prefix(&root)?
                    .to_str()
                    .ok_or("Document path is not UTF-8")?
                    .replace('\\', "/");
                let name = entry
                    .file_name()
                    .to_str()
                    .ok_or("Document name is not UTF-8")?
                    .to_owned();
                documents.push(inferay_core::project_files::ProjectDocument {
                    category: inferay_core::project_files::document_category(&name).into(),
                    path,
                    name,
                    size: entry.metadata()?.len(),
                });
            }
            documents.sort_by(|a, b| {
                a.name
                    .to_lowercase()
                    .cmp(&b.name.to_lowercase())
                    .then(a.path.cmp(&b.path))
            });
            Ok(documents)
        })
        .await?
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
            let store = this.store.lock().map_err(|_| "Project store lock failed")?;
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
            let store = this.store.lock().map_err(|_| "Project store lock failed")?;
            let root = store.project_dir(&project_id)?;
            let path = format!("memory/documents/{name}");
            let hash = crate::project_definitions::write(&root, &path, &bytes, None)?;
            Ok(json!({"path":path,"sourceHash":hash}))
        })
        .await?
    }

    pub async fn import_library(self: &Arc<Self>, project_id: String, name: String, originals: std::collections::BTreeMap<String, Vec<u8>>) -> Result<Value> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            let store = this.store.lock().map_err(|_| "Project store lock failed")?;
            let root = store.project_dir(&project_id)?;
            let id = crate::project_definitions::import_library(&root, &name, &originals)?;
            Ok(json!({"id":id}))
        }).await?
    }

    pub async fn preview_automation(self: &Arc<Self>, command: &ProjectFileCommand) -> Result<()> {
        inferay_core::project_files::proposed_automation(command)?;
        let ProjectFileCommand::SaveDefinition { project_id, path, content, expected_hash } = command else {
            unreachable!()
        };
        let skills = self.prompts.lock().await.load()?;
        let store = self.store.lock().map_err(|_| "Project store lock failed")?;
        let root = store.project_dir(project_id)?;
        let target = crate::project_definitions::managed_path(&root, path, false)?;
        let current = match std::fs::read(target) {
            Ok(bytes) => Some(project_store::hash(&bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        if current.as_deref() != expected_hash.as_deref() {
            return Err("Automation changed; read its current sourceHash before proposing an update".into());
        }
        crate::project_definitions::validate_write(
            &root, path, content.as_bytes(),
            &skills.iter().map(|s| format!("global:{}", s.id)).collect(),
        )
    }

    pub async fn preview_plugin(self: &Arc<Self>, command: &ProjectFileCommand) -> Result<()> {
        let skills = self.prompts.lock().await.load()?;
        let store = self.store.lock().map_err(|_| "Project store lock failed")?;
        let globals = skills.iter().map(|s| format!("global:{}", s.id)).collect();
        match command {
            ProjectFileCommand::CreatePlugin { project_id, slug, files } => {
                let root = store.project_dir(project_id)?;
                crate::project_definitions::validate_bundle(&root, slug, files, &globals)
            }
            ProjectFileCommand::UpdatePlugin { project_id, slug, expected_hash, files, remove } => {
                let root = store.project_dir(project_id)?;
                crate::project_definitions::prepare_plugin_update(&root, slug, expected_hash, files, remove, &globals).map(|_| ())
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
            let store = this.store.lock().map_err(|_| "Project store lock failed")?;
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
            let mut store = this.store.lock().map_err(|_| "Project store lock failed")?;
            crate::project_proposals::resolve(&mut store, request, &skills)
        }).await?
    }

    pub async fn command(self: &Arc<Self>, cmd: ProjectFileCommand, host: bool) -> Result<Value> {
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            this.store
                .lock()
                .map_err(|_| "Project store lock failed")?
                .command(cmd, host, &skills)
        })
        .await?
    }
    pub async fn context(
        &self,
        pane: &str,
        cwd: &Path,
    ) -> Result<Option<(String, String, PathBuf)>> {
        let skills = self.prompts.lock().await.load()?;
        self.store
            .lock()
            .map_err(|_| "Project store lock failed")?
            .context(pane, cwd, &skills)
    }
    async fn tick(self: &Arc<Self>) -> Result<()> {
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        let scheduled_skills = skills.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut store = this.store.lock().map_err(|_| "Project store lock failed")?;
            let root = store.root.clone();
            crate::project_runs::schedule_due(&mut store.db, &root, &scheduled_skills, now())
        })
        .await??;
        for _ in 0..2 {
            let Ok(background) = self.background.clone().try_acquire_owned() else {
                break;
            };
            let Ok(capacity) = self.capacity.clone().try_acquire_owned() else {
                break;
            };
            let this = self.clone();
            let skills = skills.clone();
            let selected = tokio::task::spawn_blocking(move || {
                let mut store = this.store.lock().map_err(|_| "Project store lock failed")?;
                let root = store.root.clone();
                crate::project_runs::claim_next(&mut store.db, &root, &skills)
            })
            .await??;
            let Some((id, project, snapshot)) = selected else {
                break;
            };
            let this = self.clone();
            tokio::spawn(async move {
                let _permits = (background, capacity);
                let result = this.execute(&id, &project, &snapshot).await;
                if let Err(e) = this.finish(&id, &project, result) {
                    eprintln!("Run completion retained for recovery: {e}");
                }
            });
        }
        Ok(())
    }
    pub(crate) fn stopped(&self, id: &str) -> bool {
        self.store
            .lock()
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
        let automation = snapshot
            .pointer("/automation/id")
            .and_then(Value::as_str)
            .ok_or("Run is missing its file-backed automation definition")?;
        let skills = self.prompts.lock().await.load()?;
        let root = {
            let store = self.store.lock().map_err(|_| "Project store lock failed")?;
            let current = crate::project_index::approved_inputs(
                &store.db,
                &store.root,
                automation,
                false,
                &skills,
            )?;
            if current != *snapshot || snapshot["projectId"].as_str() != Some(project) {
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
        match serde_json::from_value::<ProjectExecution>(snapshot["execution"].clone())? {
            ProjectExecution::Tool { tool_id: _, input } => {
                let tool: LocalTool = serde_json::from_value(snapshot["tool"].clone())?;
                tool::execute(self, tool::Invocation {
                    id, root: &root, dir: &dir, call: None, tool, input,
                    entrypoint_hash: snapshot["entrypointHash"].as_str().ok_or("Missing entrypoint hash")?, active: None,
                }).await
            }
            ProjectExecution::Agent {
                instructions,
                provider,
                model,
                reasoning_level,
                working_directory,
                timeout_seconds,
                ..
            } => {
                let cwd = resolve_path(&root, &working_directory)?;
                // Automations read memory but never save to it; what they read is recorded on the run.
                let memory = crate::agent_runner::MemoryScope {
                    runtime: self.clone(),
                    project: project.to_owned(),
                    dir: root.clone(),
                    allow_save: false,
                    reads: Arc::default(),
                };
                let recalled =
                    self.memory
                        .prompt(project, &root, &instructions, provider == "codex");
                if let Ok(mut reads) = memory.reads.lock() {
                    reads.extend(recalled.read);
                }
                let tools = crate::project_tools::ToolScope::new(self.clone(), id, root.clone(), dir.clone(), snapshot.clone())?;
                let _tool_lease = crate::project_tools::ToolLease(tools.clone());
                let handle = AgentProcessHandle::with_skills(self.prompts.clone())
                    .with_memory(Some(memory.clone()))
                    .with_tools(tools.clone())
                    .with_sandbox(crate::automation_sandbox::AutomationSandbox::new(
                        &serde_json::from_value::<inferay_core::project_files::AutomationDefinition>(snapshot["automation"].clone())?.may,
                        &snapshot["repositoryPaths"], &root,
                    ));
                let kind = if provider == "codex" {
                    AgentKind::Codex
                } else {
                    AgentKind::Claude
                };
                let binary = self.resolver.resolve_agent_binary(kind);
                let env = self.resolver.create_agent_env(kind);
                let prompt = format!(
                    "{}\n\n{}\n\nPinned resources:\n{}\n\nPinned skill instructions (use these captured versions for this run):\n{}\n\nManaged project files: {}\nConfigured working directory: {}\nWrite intended outputs under {}. Report the outcome accurately; ask for input if blocked.",
                    snapshot["projectInstructions"].as_str().unwrap_or(""),
                    instructions,
                    snapshot["resources"],
                    snapshot["skills"],
                    root.display(),
                    cwd.display(),
                    dir.join("output").display()
                );
                let prompt = format!("{prompt}\n\n{}\n\nGranted library tools: {}. Use inferay_tools list to discover their input schemas and call them through inferay_tools; do not bypass the granted interface with shell commands.", recalled.text, snapshot["tools"]);
                let invocation=CodexInvocationContext{cwd:dir.join("output"),reference_paths:vec![],images:vec![],model:model.clone(),reasoning_level:reasoning_level.clone(),developer_instructions:Some("Run the explicitly requested project automation. Do not enable schedules or expand permissions. Report failures truthfully.".into()),session_id:None,mcp_servers:Some(vec![])};
                let mut protocol = AgentProtocolContext::new(cwd.clone());
                let mut codex = CodexProtocolState::default();
                let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
                let log = dir.join("logs/agent.jsonl");
                let waiting = Arc::new(std::sync::atomic::AtomicBool::new(false));
                let waiting_signal = waiting.clone();
                let drain = tokio::spawn(async move {
                    let mut file = tokio::fs::File::create(log).await?;
                    let mut size = 0;
                    let mut failed = false;
                    while let Some(emission) = receiver.recv().await {
                        let data = match emission {
                            ProtocolEmission::Chat(value) => {
                                if value["type"] == "chat:error" || value["is_error"] == true {
                                    failed = true;
                                }
                                if value.pointer("/content_block/name").and_then(Value::as_str)
                                    == Some("AskUserQuestion")
                                    || value
                                        .pointer("/message/content")
                                        .and_then(Value::as_array)
                                        .is_some_and(|items| {
                                            items.iter().any(|v| v["name"] == "AskUserQuestion")
                                        })
                                {
                                    waiting_signal
                                        .store(true, std::sync::atomic::Ordering::Release);
                                }
                                value
                            }
                            ProtocolEmission::System(text) => json!({"system":text}),
                            ProtocolEmission::Session(id) => json!({"providerSessionId":id}),
                            _ => continue,
                        };
                        let line = format!("{data}\n");
                        if size + line.len() <= 1_048_576 {
                            file.write_all(line.as_bytes()).await?;
                            size += line.len();
                        }
                    }
                    Ok::<_, std::io::Error>(failed)
                });
                let result = {
                    let run = async {
                        if provider == "codex" {
                            agent_runner::run_codex(
                                agent_runner::CodexRun {
                                    binary: &binary,
                                    prompt: &prompt,
                                    invocation: &invocation,
                                    env: &env,
                                },
                                &handle,
                                &self.tracker,
                                &mut protocol,
                                &mut codex,
                                &sender,
                            )
                            .await
                        } else {
                            agent_runner::run_claude(
                                agent_runner::ClaudeRun {
                                    binary: &binary,
                                    prompt: &prompt,
                                    developer_instructions: invocation
                                        .developer_instructions
                                        .as_deref(),
                                    cwd: &invocation.cwd,
                                    model: model.as_deref(),
                                    session_id: None,
                                    env: &env,
                                    mcp_servers: Some(&[]),
                                },
                                &handle,
                                &mut protocol,
                                &sender,
                            )
                            .await
                        }
                    };
                    tokio::pin!(run);
                    let deadline =
                        tokio::time::Instant::now() + Duration::from_secs(timeout_seconds);
                    loop {
                        tokio::select! {value=&mut run=>break Ok(value),_=tokio::time::sleep(Duration::from_millis(100))=>{if self.stopped(id)||waiting.load(std::sync::atomic::Ordering::Acquire)||tokio::time::Instant::now()>=deadline{handle.kill();break Err("Agent run stopped or timed out");}}}
                    }
                };
                tools.close().await;
                drop(sender);
                let provider_failed = drain.await??;
                let reads = memory.reads.lock().map(|r| r.clone()).unwrap_or_default();
                if !reads.is_empty()
                    && let Ok(store) = self.store.lock()
                {
                    event(&store.db, id, "memory_read", &json!({"notes": reads}))?;
                }
                if waiting.load(std::sync::atomic::Ordering::Acquire) {
                    return Ok(
                        json!({"waitingForInput":true,"message":"This run needs your input. Read the agent log, update its instructions, and retry. No provider process remains running."}),
                    );
                }
                if provider_failed {
                    return Err("Provider failed; inspect the agent log".into());
                }
                if let Ok(text) = result {
                    std::fs::write(dir.join("output/response.md"), &text)?;
                    if text.trim().is_empty() {
                        return Err(
                            "Provider returned no final response; inspect the agent log".into()
                        );
                    }
                    let mut artifacts = tools.artifacts()?;
                    artifacts.push("response.md".into());
                    Ok(json!({"message":text,"artifacts":artifacts,"completion":"provider turn completed; not an independently verified business outcome"}))
                } else {
                    Err("Agent run stopped or timed out".into())
                }
            }
        }
    }
    fn finish(&self, id: &str, project: &str, result: Result<Value>) -> Result<()> {
        let mut store = self.store.lock().map_err(|_| "Project store lock failed")?;
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
        tx.execute("UPDATE runs SET status=?1,result=?2,error=?3,finished_at=?4 WHERE id=?5 AND status='running'",params![status,value,error,now(),id])?;
        event(&tx, id, status, &json!({"error":error}))?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
