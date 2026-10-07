//! Durable local execution; presentation observes this owner and never drives its clock.
use crate::{
    agent_command::AgentCommandResolver,
    agent_runner::{self, AgentProcessHandle, RuntimePidTracker},
    project_store::{self, ProjectStore, Result, event, now, prepare_run, resolve_path},
    prompt_store::PromptStore,
};
use inferay_core::{
    agent_kind::AgentKind,
    agent_protocol::{
        AgentProtocolContext, CodexInvocationContext, CodexProtocolState, ProtocolEmission,
    },
    projects::*,
};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Semaphore,
};

pub(crate) struct ProjectRuntime {
    pub store: Mutex<ProjectStore>,
    pub capacity: Arc<Semaphore>,
    background: Arc<Semaphore>,
    resolver: Arc<AgentCommandResolver>,
    prompts: Arc<tokio::sync::Mutex<PromptStore>>,
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
        Ok(Arc::new(Self {
            store: Mutex::new(ProjectStore::open(root)?),
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
    ) -> Result<ProjectCatalog> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            this.store
                .lock()
                .map_err(|_| "Project store lock failed")?
                .catalog(project.as_deref(), before.as_deref())
        })
        .await?
    }
    pub async fn preview_automation(self: &Arc<Self>, command: ProjectCommand) -> Result<()> {
        let this = self.clone();
        tokio::task::spawn_blocking(move || {
            this.store
                .lock()
                .map_err(|_| "Project store lock failed")?
                .preview_automation(command)
        })
        .await?
    }
    pub async fn command(self: &Arc<Self>, cmd: ProjectCommand, host: bool) -> Result<Value> {
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
    pub fn context(&self, pane: &str, cwd: &Path) -> Result<Option<(String, String, PathBuf)>> {
        let store = self.store.lock().map_err(|_| "Project store lock failed")?;
        let id: Option<String> = store
            .db
            .query_row(
                "SELECT project_id FROM project_conversations WHERE pane_id=?",
                [pane],
                |r| r.get(0),
            )
            .optional()?;
        let id = if id.is_some() {
            id
        } else {
            store.db.query_row("SELECT r.project_id FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.type_id='inferay.repository' AND json_extract(v.body,'$.location.path')=? AND r.archived=0 LIMIT 1",[cwd.to_string_lossy().as_ref()],|r|r.get(0)).optional()?
        };
        let Some(id) = id else { return Ok(None) };
        let dir = store.project_dir(&id)?;
        let mut instructions: String = store.db.query_row(
            "SELECT instructions FROM projects WHERE id=? AND archived=0",
            [&id],
            |r| r.get(0),
        )?;
        let repositories: Vec<String> = store.db.prepare("SELECT json_extract(v.body,'$.location.path') FROM resources r JOIN resource_revisions v ON v.resource_id=r.id AND v.revision=r.revision WHERE r.project_id=? AND r.type_id='inferay.repository' AND r.archived=0 ORDER BY r.name LIMIT 128")?
            .query_map([&id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        if !repositories.is_empty() {
            instructions.push_str("\nLinked repositories (project context; use the appropriate folder for repository commands):\n");
            instructions.push_str(&serde_json::to_string(&repositories)?);
        }
        Ok(Some((id, instructions, dir)))
    }
    pub fn migrate_repositories(&self, state: &Value) -> Result<()> {
        let mut store = self.store.lock().map_err(|_| "Project store lock failed")?;
        if store.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM project_migrations WHERE name='repositories-v1')",
            [],
            |r| r.get::<_, bool>(0),
        )? {
            return Ok(());
        }
        let root = store.root.clone();
        let tx = store
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut paths: HashMap<String, String> = HashMap::new();
        if let Some(groups) = state["groups"].as_array() {
            for group in groups {
                if let Some(panes) = group["panes"].as_array() {
                    for pane in panes {
                        let Some(path) = pane["cwd"].as_str().filter(|p| !p.is_empty()) else {
                            continue;
                        };
                        let id = if let Some(id) = paths.get(path) {
                            id.clone()
                        } else {
                            let id = uuid::Uuid::new_v4().to_string();
                            let name = Path::new(path)
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("Project");
                            tx.execute(
                                "INSERT INTO projects VALUES(?1,?2,'','',1,?3,?3,0)",
                                params![id, name, now()],
                            )?;
                            project_store::project_directory(&tx, &root, &id)?;
                            project_store::save_resource(
                                &tx,
                                &id,
                                None,
                                None,
                                "inferay.repository",
                                name,
                                json!({"location":{"base":"external","path":path},"instructions":""}),
                                1,
                                None,
                            )?;
                            paths.insert(path.into(), id.clone());
                            id
                        };
                        if let Some(pane) = pane["id"].as_str() {
                            tx.execute(
                                "INSERT OR IGNORE INTO project_conversations VALUES(?1,?2)",
                                params![pane, id],
                            )?;
                        }
                    }
                }
            }
        }
        tx.execute(
            "INSERT INTO project_migrations VALUES('repositories-v1',?)",
            [now()],
        )?;
        tx.commit()?;
        Ok(())
    }
    async fn tick(self: &Arc<Self>) -> Result<()> {
        let skills = self.prompts.lock().await.load()?;
        let this = self.clone();
        tokio::task::spawn_blocking(move||->Result<()>{let mut store=this.store.lock().map_err(|_|"Project store lock failed")?;let root=store.root.clone();let tx=store.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let due:Vec<(String,i64,i64,Option<String>)>=tx.prepare("SELECT a.id,a.next_due_at,a.interval_seconds,a.calendar FROM automations a JOIN projects p ON p.id=a.project_id WHERE a.enabled=1 AND a.archived=0 AND p.archived=0 AND a.next_due_at<=? ORDER BY a.next_due_at LIMIT 8")?.query_map([now()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect::<std::result::Result<_,_>>()?;
            for (id,due,interval,calendar) in due {let result=prepare_run(&tx,&root,&id,&format!("schedule:{id}:{due}"),Some(due),None,&skills);if let Err(e)=result{eprintln!("Automation {id}: {e}");tx.execute("UPDATE automations SET enabled=0 WHERE id=?",[&id])?;}let next=match calendar {Some(text)=>serde_json::from_str::<CalendarSchedule>(&text)?.next_after(now())?,None=>due+((now()-due)/(interval*1000)+1)*interval*1000};tx.execute("UPDATE automations SET next_due_at=? WHERE id=? AND enabled=1",params![next,id])?;}
            tx.commit()?;Ok(())}).await??;
        for _ in 0..2 {
            let Ok(background) = self.background.clone().try_acquire_owned() else {
                break;
            };
            let Ok(capacity) = self.capacity.clone().try_acquire_owned() else {
                break;
            };
            let this = self.clone();
            let selected=tokio::task::spawn_blocking(move||->Result<Option<(String,String,Value)>>{let mut store=this.store.lock().map_err(|_|"Project store lock failed")?;let tx=store.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
                let run=tx.query_row("SELECT r.id,r.project_id,r.snapshot FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.status='queued' AND r.stop_requested_at IS NULL AND p.archived=0 AND NOT EXISTS(SELECT 1 FROM runs active WHERE active.automation_id=r.automation_id AND active.status='running') ORDER BY r.requested_at,r.id LIMIT 1",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional()?;
                let out=if let Some((id,project,snapshot))=run{tx.execute("UPDATE runs SET status='running',started_at=? WHERE id=?",params![now(),id])?;event(&tx,&id,"running",&json!({}))?;Some((id,project,serde_json::from_str(&snapshot)?))}else{None};tx.commit()?;Ok(out)}).await??;
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
    fn stopped(&self, id: &str) -> bool {
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
        let file_automation = snapshot.pointer("/automation/id").and_then(Value::as_str);
        let root = if let Some(automation) = file_automation {
            let skills = self.prompts.lock().await.load()?;
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
        } else {
            self.store
                .lock()
                .map_err(|_| "Project store lock failed")?
                .project_dir(project)?
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
            ProjectExecution::Tool { tool_id, input } => {
                // Recheck existence and plugin enablement without substituting current content for the pinned definition.
                if file_automation.is_none() {
                    let store = self.store.lock().map_err(|_| "Project store lock failed")?;
                    project_store::resource(&store.db, &tool_id, project)?;
                }
                let tool: LocalTool = serde_json::from_value(snapshot["tool"].clone())?;
                let file = resolve_path(&root, &tool.entrypoint)?;
                let bytes = std::fs::read(&file)?;
                if snapshot["entrypointHash"].as_str() != Some(&project_store::hash(&bytes)) {
                    return Err(
                        "Tool changed after this run was queued. Retry to capture the new input."
                            .into(),
                    );
                }
                std::fs::write(dir.join("inputs/entrypoint"), &bytes)?;
                let cwd = resolve_path(&root, &tool.working_directory)?;
                let mut command = tokio::process::Command::new(&tool.program);
                command
                    .arg(&file)
                    .args(&tool.arguments)
                    .current_dir(cwd)
                    .env("INFERAY_PROJECT_DIR", &root)
                    .env("INFERAY_RUN_OUTPUT", dir.join("output"))
                    .env("INFERAY_RUN_ID", id)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .kill_on_drop(true);
                #[cfg(unix)]
                command.process_group(0);
                let mut child = command.spawn()?;
                let pid = child.id();
                if let Some(pid) = pid {
                    self.tracker.track_pid(pid);
                }
                let mut stdin = child.stdin.take().ok_or("No process stdin")?;
                let data = serde_json::to_vec(&input)?;
                let write = tokio::spawn(async move {
                    stdin.write_all(&data).await?;
                    stdin.shutdown().await
                });
                let stdout = child.stdout.take().ok_or("No stdout")?;
                let stderr = child.stderr.take().ok_or("No stderr")?;
                let mut out = tokio::spawn(async move {
                    let mut bytes = Vec::new();
                    stdout
                        .take(1_048_577)
                        .read_to_end(&mut bytes)
                        .await
                        .map(|_| bytes)
                });
                let mut err = tokio::spawn(async move {
                    let mut bytes = Vec::new();
                    stderr
                        .take(1_048_577)
                        .read_to_end(&mut bytes)
                        .await
                        .map(|_| bytes)
                });
                let deadline =
                    tokio::time::Instant::now() + Duration::from_secs(tool.timeout_seconds);
                let mut failure = None;
                let status = loop {
                    tokio::select! {result=child.wait()=>{match result {Ok(status)=>break Some(status),Err(_)=>{failure=Some("Could not wait for tool process");break None;}}},_=tokio::time::sleep(Duration::from_millis(100))=>{if self.stopped(id)||tokio::time::Instant::now()>=deadline{failure=Some(if self.stopped(id){"Cancelled"}else{"Tool timed out"});if let Some(pid)=pid{agent_runner::tree_kill(pid);}let _=child.kill().await;let _=child.wait().await;break None;}}}
                };
                write.abort();
                if let Some(pid) = pid {
                    #[cfg(unix)]
                    {
                        let _ = std::process::Command::new("/bin/kill")
                            .args(["-KILL", "--", &format!("-{pid}")])
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .status();
                    }
                    self.tracker.untrack_pid(pid);
                }
                let output = tokio::time::timeout(Duration::from_secs(2), &mut out).await;
                let errors = tokio::time::timeout(Duration::from_secs(2), &mut err).await;
                if output.is_err() || errors.is_err() {
                    out.abort();
                    err.abort();
                    return Err("Tool streams did not close".into());
                }
                let output = output???;
                let errors = errors???;
                std::fs::write(dir.join("logs/stdout.txt"), &output)?;
                std::fs::write(dir.join("logs/stderr.txt"), &errors)?;
                if let Some(error) = failure {
                    return Err(error.into());
                }
                if output.len() > 1_048_576 || errors.len() > 1_048_576 {
                    return Err("Tool output exceeded 1 MiB per stream".into());
                }
                if !status.is_some_and(|s| s.success()) {
                    return Err(format!(
                        "Tool failed: {}",
                        String::from_utf8_lossy(&errors)
                            .chars()
                            .take(2000)
                            .collect::<String>()
                    )
                    .into());
                }
                let result: Value = serde_json::from_slice(&output)
                    .map_err(|e| format!("Tool must return JSON on stdout: {e}"))?;
                validate_json(&tool.output_schema, &result)?;
                Ok(result)
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
                let handle = AgentProcessHandle::with_skills(self.prompts.clone())
                    .with_memory(Some(memory.clone()));
                let kind = if provider == "codex" {
                    AgentKind::Codex
                } else {
                    AgentKind::Claude
                };
                let binary = self.resolver.resolve_agent_binary(kind);
                let env = self.resolver.create_agent_env(kind);
                let prompt = format!(
                    "{}\n\n{}\n\nPinned resources:\n{}\n\nPinned skill instructions (use these captured versions for this run):\n{}\n\nManaged project files: {}\nWrite intended outputs under {}. Report the outcome accurately; ask for input if blocked.",
                    snapshot["projectInstructions"].as_str().unwrap_or(""),
                    instructions,
                    snapshot["resources"],
                    snapshot["skills"],
                    root.display(),
                    dir.join("output").display()
                );
                let prompt = format!("{prompt}\n\n{}", recalled.text);
                let invocation=CodexInvocationContext{cwd:cwd.clone(),reference_paths:vec![],images:vec![],model:model.clone(),reasoning_level:reasoning_level.clone(),developer_instructions:Some("Run the explicitly requested project automation. Do not enable schedules or expand permissions. Report failures truthfully.".into()),session_id:None,mcp_servers:Some(vec![])};
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
                                    cwd: &cwd,
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
                    Ok(
                        json!({"message":text,"artifacts":["response.md"],"completion":"provider turn completed; not an independently verified business outcome"}),
                    )
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
