//! Per-run command execution and library tool grants. Provider transports share this owner.
use crate::{
    project_runtime::{ProjectRuntime, tool},
    project_store::{Result, event, resolve_path},
};
use inferay_core::{
    project_files::{AgentToolGrant, ToolDefinition},
    projects::{LocalTool, ProjectPath, ToolArgument, ToolInterface, validate_json},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
};
use tokio::sync::Semaphore;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapturedTool {
    pub grant: AgentToolGrant,
    pub definition: ToolDefinition,
    pub directory: String,
    pub entrypoint: ProjectPath,
    pub working_directory: ProjectPath,
    pub entrypoint_hash: String,
}

pub(crate) struct ToolScope {
    runtime: Arc<ProjectRuntime>,
    run: String,
    root: PathBuf,
    dir: PathBuf,
    snapshot: Value,
    tools: BTreeMap<String, CapturedTool>,
    active: AtomicBool,
    serial: Semaphore,
    calls: AtomicU32,
    artifacts: Mutex<Vec<String>>,
    outcomes: Mutex<BTreeMap<String, bool>>,
}
/// Closes grants even when the provider future is dropped or errors early.
pub(crate) struct ToolLease(pub Arc<ToolScope>);
impl Drop for ToolLease {
    fn drop(&mut self) {
        self.0.active.store(false, Ordering::Release);
    }
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    List,
    #[serde(rename_all = "camelCase")]
    Execute {
        command: String,
        timeout_seconds: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Call {
        plugin_id: String,
        tool_id: String,
        input: Value,
    },
}
impl ToolScope {
    pub(crate) fn new(
        runtime: Arc<ProjectRuntime>,
        run: &str,
        root: PathBuf,
        dir: PathBuf,
        snapshot: Value,
    ) -> Result<Arc<Self>> {
        let tools =
            serde_json::from_value(snapshot.get("tools").cloned().unwrap_or_else(|| json!({})))?;
        Ok(Arc::new(Self {
            runtime,
            run: run.into(),
            root,
            dir,
            snapshot,
            tools,
            active: AtomicBool::new(true),
            serial: Semaphore::new(1),
            calls: AtomicU32::new(0),
            artifacts: Mutex::new(vec![]),
            outcomes: Mutex::new(BTreeMap::new()),
        }))
    }
    pub(crate) fn available(&self) -> bool {
        !self.tools.is_empty()
    }
    pub(crate) fn definition() -> Value {
        json!({"type":"function","name":"inferay_tools","description":"List or call the reusable library tools explicitly granted to this automation. Use list to discover names, pluginId, toolId and input schemas, then call with those IDs and input. Undeclared tools are refused. Tools marked required must be called and pass before the run can succeed. Their latest attempt must succeed; repair failures and retry. Optional tool failures may be recovered.","inputSchema":{"type":"object","properties":{"action":{"type":"string","enum":["list","call"]},"pluginId":{"type":"string"},"toolId":{"type":"string"},"input":{}},"required":["action"],"additionalProperties":false}})
    }
    pub(crate) fn execution_definition() -> Value {
        json!({"type":"function","name":"inferay_exec","description":"Execute a shell command for this automation through Inferay's permission boundary. Use this for reading files, editing, Git and local commands. The working directory is the automation's configured directory. Outputs intended as artifacts belong in $INFERAY_RUN_OUTPUT. Commands, stdout/stderr and artifacts are retained with the run. Calls are serial, bounded and cancelled with the automation. Do not use provider shell or file-edit tools.","inputSchema":{"type":"object","properties":{"command":{"type":"string","maxLength":64000},"timeoutSeconds":{"type":"integer","minimum":1,"maximum":600}},"required":["command"],"additionalProperties":false}})
    }
    pub(crate) async fn close(&self) {
        self.active.store(false, Ordering::Release);
        let _permit = self.serial.acquire().await;
    }
    pub(crate) fn verify_required(&self) -> Result<()> {
        let outcomes = self
            .outcomes
            .lock()
            .map_err(|_| "Tool outcome lock failed")?;
        let missing: Vec<_> = self
            .tools
            .iter()
            .filter(|(key, tool)| tool.grant.required && outcomes.get(*key) != Some(&true))
            .map(|(_, tool)| tool.definition.name.as_str())
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "Required tools did not pass: {}. Inspect tool logs and retry.",
                missing.join(", ")
            )
            .into());
        }
        Ok(())
    }
    pub(crate) fn artifacts(&self) -> Result<Vec<String>> {
        Ok(self
            .artifacts
            .lock()
            .map_err(|_| "Tool artifact lock failed")?
            .clone())
    }
    pub(crate) async fn call(&self, args: Value) -> Result<Value> {
        if !self.active.load(Ordering::Acquire) || self.runtime.stopped(&self.run) {
            return Err("Automation tool grants are closed".into());
        }
        let oversized = args.to_string().len() > 64000;
        let request: Request = serde_json::from_value(args)?;
        if matches!(request, Request::List) {
            return Ok(
                json!({"tools":self.tools.values().map(|tool| json!({"pluginId":tool.grant.plugin_id,"toolId":tool.grant.tool_id,"name":tool.definition.name,"required":tool.grant.required,"inputSchema":tool.definition.input_schema})).collect::<Vec<_>>() }),
            );
        }
        let _permit = self
            .serial
            .try_acquire()
            .map_err(|_| "Another tool is running; wait for its result before calling again")?;
        let grant = if let Request::Call {
            plugin_id, tool_id, ..
        } = &request
        {
            let key = AgentToolGrant {
                plugin_id: plugin_id.clone(),
                tool_id: tool_id.clone(),
                required: false,
            }
            .key();
            let captured = self
                .tools
                .get(&key)
                .ok_or("This tool is not granted to the automation")?;
            // A later failure cannot preserve an earlier successful quality gate.
            self.outcomes
                .lock()
                .map_err(|_| "Tool outcome lock failed")?
                .insert(key, false);
            Some(captured.grant.clone())
        } else {
            None
        };
        if oversized {
            return Err("Tool input exceeds 64 KB".into());
        }
        let skills = self.runtime.prompts.lock().await.load()?;
        {
            let store = self
                .runtime
                .store
                .lock()
                .map_err(|_| "Project store lock failed")?;
            let automation = self
                .snapshot
                .pointer("/automation/id")
                .and_then(Value::as_str)
                .ok_or("Missing automation identity")?;
            let current = crate::project_index::approved_inputs(
                &store.db,
                &store.root,
                automation,
                false,
                &skills,
            )?;
            if current != self.snapshot {
                return Err(
                    "Automation or tool inputs changed; review before running again".into(),
                );
            }
            let running: bool = store.db.query_row(
                "SELECT status='running' AND stop_requested_at IS NULL FROM runs WHERE id=?",
                [&self.run],
                |r| r.get(0),
            )?;
            if !running || !self.active.load(Ordering::Acquire) {
                return Err("Automation is no longer running".into());
            }
        }
        if self.calls.fetch_add(1, Ordering::AcqRel) >= 64 {
            return Err("Automation reached its limit of 64 tool calls".into());
        }
        let call = uuid::Uuid::new_v4().to_string();
        let (tool, input, entrypoint_hash) = match request {
            Request::Call { input, .. } => {
                let captured = &self.tools[&grant.as_ref().unwrap().key()];
                let definition = &captured.definition;
                validate_json(&definition.input_schema, &input)?;
                let entrypoint = resolve_path(&self.root, &captured.entrypoint)?;
                let tool = LocalTool {
                    interface: definition.interface.clone(),
                    program: definition.program.clone(),
                    entrypoint: captured.entrypoint.clone(),
                    arguments: definition.interface.arguments(
                        &definition.args,
                        &input,
                        &entrypoint.to_string_lossy(),
                    )?,
                    working_directory: captured.working_directory.clone(),
                    timeout_seconds: definition.timeout_seconds,
                    input_schema: definition.input_schema.clone(),
                    output_schema: definition.output_schema.clone(),
                };
                (tool, input, captured.entrypoint_hash.clone())
            }
            Request::Execute {
                command,
                timeout_seconds,
            } => {
                if self.snapshot["execution"]["kind"] != "agent" {
                    return Err("Only agent automations can execute commands".into());
                }
                if command.trim().is_empty() || command.contains('\0') {
                    return Err("Command must be nonempty text without NUL bytes".into());
                }
                let timeout = timeout_seconds.unwrap_or(60);
                if !(1..=600).contains(&timeout) {
                    return Err("Command timeout must be 1–600 seconds".into());
                }
                let path = format!("runs/{}/inputs/commands/{call}.sh", self.run);
                let source = crate::project_definitions::managed_path(&self.root, &path, true)?;
                std::fs::write(&source, command.as_bytes())?;
                let tool = LocalTool {
                    interface: ToolInterface::Cli,
                    program: "/bin/sh".into(),
                    entrypoint: ProjectPath::Project { path },
                    arguments: vec![ToolArgument::Literal(source.to_string_lossy().into_owned())],
                    working_directory: serde_json::from_value(
                        self.snapshot["execution"]["workingDirectory"].clone(),
                    )?,
                    timeout_seconds: timeout,
                    input_schema: json!({"type":"object"}),
                    output_schema: json!({"type":"object"}),
                };
                let hash = crate::project_store::hash(command.as_bytes());
                (
                    tool,
                    json!({"command":command,"timeoutSeconds":timeout}),
                    hash,
                )
            }
            Request::List => unreachable!(),
        };
        {
            let store = self
                .runtime
                .store
                .lock()
                .map_err(|_| "Project store lock failed")?;
            event(
                &store.db,
                &self.run,
                "tool_started",
                &json!({"callId":call,"grant":grant,"input":input}),
            )?;
        }
        let result = tool::execute(
            &self.runtime,
            tool::Invocation {
                id: &self.run,
                root: &self.root,
                dir: &self.dir,
                call: Some(&call),
                tool,
                input,
                snapshot: &self.snapshot,
                entrypoint_hash: &entrypoint_hash,
                active: Some(&self.active),
            },
        )
        .await
        .and_then(|mut result| {
            if !self.active.load(Ordering::Acquire) {
                return Err("Automation ended during its tool call".into());
            }
            if let Some(files) = result.get_mut("artifacts").and_then(Value::as_array_mut) {
                let mut artifacts = self
                    .artifacts
                    .lock()
                    .map_err(|_| "Tool artifact lock failed")?;
                if artifacts.len() + files.len() > 99 {
                    return Err("Automation tools exceed 99 artifacts".into());
                }
                let mut added = Vec::new();
                let output = self.dir.join("output").join("tools").join(&call);
                for file in files.iter_mut() {
                    let name = file.as_str().ok_or("Artifact path must be text")?;
                    let path = resolve_path(&output, &ProjectPath::Project { path: name.into() })?;
                    let metadata = path.metadata()?;
                    if !metadata.is_file() || metadata.len() > 50_000_000 {
                        return Err("Artifact must be a file under 50 MB".into());
                    }
                    let name = format!("tools/{call}/{name}");
                    added.push(name.clone());
                    *file = json!(name);
                }
                artifacts.extend(added);
            }
            Ok(result)
        });
        let store = self
            .runtime
            .store
            .lock()
            .map_err(|_| "Project store lock failed")?;
        let outcome = match &result {
            Ok(value) => json!({"callId":call,"result":value}),
            Err(error) => json!({"callId":call,"error":error.to_string()}),
        };
        event(
            &store.db,
            &self.run,
            if result.is_ok() {
                "tool_succeeded"
            } else {
                "tool_failed"
            },
            &outcome,
        )?;
        if result.is_ok()
            && let Some(grant) = grant
        {
            self.outcomes
                .lock()
                .map_err(|_| "Tool outcome lock failed")?
                .insert(grant.key(), true);
        }
        result
    }
}
