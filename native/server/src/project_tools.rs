//! Per-run grants for reusable library tools. Provider transports share this owner.
use crate::{
    project_runtime::{ProjectRuntime, tool},
    project_store::{Result, event, resolve_path},
};
use inferay_core::{
    project_files::{AgentToolGrant, ToolDefinition},
    projects::{LocalTool, ProjectPath, validate_json},
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
        }))
    }
    pub(crate) fn available(&self) -> bool {
        !self.tools.is_empty()
    }
    pub(crate) fn definition() -> Value {
        json!({"type":"function","name":"inferay_tools","description":"List or call the reusable library tools explicitly granted to this automation. Use list to discover names, pluginId, toolId and input schemas, then call with those IDs and input. Undeclared tools are refused. Tool failures are real failures; inspect the error before retrying.","inputSchema":{"type":"object","properties":{"action":{"type":"string","enum":["list","call"]},"pluginId":{"type":"string"},"toolId":{"type":"string"},"input":{}},"required":["action"],"additionalProperties":false}})
    }
    pub(crate) async fn close(&self) {
        self.active.store(false, Ordering::Release);
        let _permit = self.serial.acquire().await;
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
        let request: Request = serde_json::from_value(args)?;
        let Request::Call {
            plugin_id,
            tool_id,
            input,
        } = request
        else {
            return Ok(
                json!({"tools":self.tools.values().map(|tool| json!({"pluginId":tool.grant.plugin_id,"toolId":tool.grant.tool_id,"name":tool.definition.name,"inputSchema":tool.definition.input_schema})).collect::<Vec<_>>() }),
            );
        };
        let grant = AgentToolGrant { plugin_id, tool_id };
        let captured = self
            .tools
            .get(&grant.key())
            .ok_or("This tool is not granted to the automation")?;
        let _permit = self
            .serial
            .try_acquire()
            .map_err(|_| "Another tool is running; wait for its result before calling again")?;
        if input.to_string().len() > 64000 {
            return Err("Tool input exceeds 64 KB".into());
        }
        validate_json(&captured.definition.input_schema, &input)?;
        let entrypoint = format!("{}/{}", captured.directory, captured.definition.entrypoint);
        let definition = &captured.definition;
        let tool = LocalTool {
            interface: definition.interface,
            program: definition.program.clone(),
            entrypoint: ProjectPath::Project {
                path: entrypoint.clone(),
            },
            arguments: definition.interface.arguments(
                &definition.args,
                &input,
                &self.root.join(&entrypoint).to_string_lossy(),
            )?,
            working_directory: ProjectPath::Project {
                path: captured.directory.clone(),
            },
            timeout_seconds: definition.timeout_seconds,
            input_schema: definition.input_schema.clone(),
            output_schema: definition.output_schema.clone(),
        };
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
                entrypoint_hash: &captured.entrypoint_hash,
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
        result
    }
}
