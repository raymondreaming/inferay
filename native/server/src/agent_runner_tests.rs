use super::*;
use std::os::unix::fs::PermissionsExt;

#[tokio::test]
async fn provider_progresses_during_slow_emission_and_drains_before_returning() {
    let (applying, applied) = oneshot::channel();
    let (release, released) = oneshot::channel();
    let mut applying = Some(applying);
    let mut released = Some(released);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        drive_protocol(
            |sender| async move {
                sender
                    .send(ProtocolEmission::System("first".into()))
                    .await
                    .unwrap();
                // Simulate a provider that needs polling while the first durable
                // write is pending. The old select/await loop deadlocks here.
                applied.await.unwrap();
                sender
                    .send(ProtocolEmission::System("second".into()))
                    .await
                    .unwrap();
                release.send(()).unwrap();
                "complete"
            },
            |emission| {
                let applying = applying.take();
                let released = released.take();
                let seen = seen.clone();
                async move {
                    if let Some(applying) = applying {
                        applying.send(()).unwrap();
                        released.unwrap().await.unwrap();
                    }
                    let ProtocolEmission::System(text) = emission else {
                        panic!("unexpected emission")
                    };
                    seen.lock().unwrap().push(text);
                }
            },
        ),
    )
    .await
    .expect("provider must keep progressing during a pending write");
    assert_eq!(output, "complete");
    assert_eq!(*seen.lock().unwrap(), ["first", "second"]);
}

#[tokio::test]
async fn slow_consumer_bounds_queued_events_and_preserves_delivery_order() {
    let (applying, applied) = oneshot::channel();
    let (release, released) = oneshot::channel();
    let mut first = Some((applying, released));
    let seen = Arc::new(Mutex::new(Vec::new()));
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        drive_protocol(
            |sender| async move {
                sender
                    .send(ProtocolEmission::System("0".into()))
                    .await
                    .unwrap();
                applied.await.unwrap();
                for index in 1..=PROTOCOL_BUFFER_CAPACITY {
                    sender
                        .send(ProtocolEmission::System(index.to_string()))
                        .await
                        .unwrap();
                }
                assert!(matches!(
                    sender.try_send(ProtocolEmission::System("overflow".into())),
                    Err(mpsc::error::TrySendError::Full(_))
                ));
                release.send(()).unwrap();
                sender
                    .send(ProtocolEmission::System(
                        (PROTOCOL_BUFFER_CAPACITY + 1).to_string(),
                    ))
                    .await
                    .unwrap();
            },
            |emission| {
                let first = first.take();
                let seen = seen.clone();
                async move {
                    if let Some((applying, released)) = first {
                        applying.send(()).unwrap();
                        released.await.unwrap();
                    }
                    let ProtocolEmission::System(text) = emission else {
                        panic!("unexpected emission")
                    };
                    seen.lock().unwrap().push(text.parse::<usize>().unwrap());
                }
            },
        ),
    )
    .await
    .expect("backpressure must resume when the consumer drains");
    assert_eq!(
        *seen.lock().unwrap(),
        (0..=PROTOCOL_BUFFER_CAPACITY + 1).collect::<Vec<_>>()
    );
}

struct Fixture {
    root: PathBuf,
    binary: PathBuf,
}
impl Fixture {
    fn new(mode: &str) -> Self {
        let root = std::env::temp_dir().join(format!("inferay-codex-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let binary = root.join("codex");
        let script = r##"#!/usr/bin/python3
import json,sys,time
MODE = '__MODE__'
def send(value):
 print(json.dumps(value), flush=True)
for line in sys.stdin:
 m=json.loads(line)
 method=m.get('method')
 with open('requests.jsonl','a') as log: log.write(json.dumps(m)+'\n')
 if method=='initialize': send({'id':m['id'],'result':{}})
 elif method=='config/read':
  if MODE=='noisy':
   while True:
    send({'method':'thread/status/changed','params':{}})
    time.sleep(0.05)
  # Server and client IDs may collide. Wait for the server-request reply.
  send({'id':m['id'],'method':'future/request','params':{}})
  answer=json.loads(sys.stdin.readline())
  assert answer['error']['code']==-32601
  send({'id':m['id'],'result':{'config':{}}})
 elif method=='thread/resume': send({'id':m['id'],'error':{'code':-32000,'message':'resume unavailable'}})
 elif method=='thread/start':
  tools=m['params']['dynamicTools']
  assert all(tool.get('type')=='function' for tool in tools), 'mixed canonical and legacy dynamic tools'
  assert any(tool['name']=='inferay_projects' for tool in tools)
  assert m['params']['modelProvider']=='inferay_openai_http'
  assert m['params']['config']['model_providers.inferay_openai_http']['supports_websockets']==False
  send({'id':m['id'],'result':{'thread':{'id':'fixture-thread'}}})
 elif method=='mcpServerStatus/list': send({'id':m['id'],'result':{'data':[],'nextCursor':None}})
 elif method=='turn/start':
  send({'id':m['id'],'result':{'turn':{'id':'fixture-turn'}}})
  if MODE=='unsupported': send({'id':'server-question','method':'future/request','params':{}})
 elif method=='turn/interrupt': pass # Simulate an unresponsive model request.
 elif m.get('id')=='server-question':
  assert m['error']['code']==-32601
  send({'method':'item/completed','params':{'item':{'type':'agentMessage','text':'recovered'}}})
  send({'method':'turn/completed','params':{'turn':{'id':'fixture-turn','status':'completed'}}})
"##.replace("__MODE__", mode);
        std::fs::write(&binary, script).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self { root, binary }
    }
    fn invocation(&self, resume: bool) -> CodexInvocationContext {
        CodexInvocationContext {
            cwd: self.root.clone(),
            reference_paths: vec![],
            images: vec![],
            model: None,
            reasoning_level: None,
            developer_instructions: None,
            session_id: resume.then(|| "saved-thread".into()),
            mcp_servers: None,
        }
    }
    fn handle(&self) -> AgentProcessHandle {
        let skills = Arc::new(tokio::sync::Mutex::new(PromptStore::new(
            self.root.join("bundled.json"),
            self.root.join("local.json"),
        )));
        let projects = crate::project_runtime::ProjectRuntime::open(
            &self.root,
            Arc::new(crate::agent_command::AgentCommandResolver::new(
                &self.root,
                self.root.join("mcp.json"),
            )),
            skills.clone(),
            RuntimePidTracker::new(self.root.join("pids.json")),
        )
        .unwrap();
        AgentProcessHandle::with_skills(skills).with_projects(projects)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn inventory_discards_unsolicited_chat_events_without_filling_a_queue() {
    let root = tempfile::tempdir().unwrap();
    let binary = root.path().join("provider");
    std::fs::write(&binary, r#"#!/usr/bin/python3
import json,sys
for line in sys.stdin:
 request=json.loads(line)
 if 'id' not in request: continue
 for i in range(200):
  print(json.dumps({'method':'item/agentMessage/delta','params':{'itemId':'chat','delta':'discard me'}}),flush=True)
 method=request['method']
 result={'config':{}} if method=='config/read' else {'thread':{'id':'fixture'}} if method=='thread/start' else {'data':[],'nextCursor':None} if method=='mcpServerStatus/list' else {}
 print(json.dumps({'id':request['id'],'result':result}),flush=True)
"#).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (_, servers) = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        inspect_codex_mcp(&binary, root.path(), &HashMap::new(), Some(&[])),
    )
    .await
    .expect("inventory must not wait for a nonexistent chat consumer")
    .unwrap();
    assert!(servers.is_empty());
}

#[tokio::test]
async fn unsupported_server_requests_receive_replies_during_startup_and_turns() {
    let f = Fixture::new("unsupported");
    let invocation = f.invocation(false);
    let handle = f.handle();
    let tracker = RuntimePidTracker::new(f.root.join("pids.json"));
    let mut context = AgentProtocolContext::new(f.root.clone());
    let mut state = CodexProtocolState::default();
    let (tx, _rx) = mpsc::channel(PROTOCOL_BUFFER_CAPACITY);
    let env = HashMap::new();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        run_codex(
            ProviderRun {
                binary: &f.binary,
                invocation: &invocation,
                env: &env,
                prompt: "hello",
            },
            &handle,
            &tracker,
            &mut context,
            &mut state,
            &tx,
        ),
    )
    .await
    .unwrap();
    assert_eq!(result, "recovered");
    assert!(handle.pid().is_none());
}

#[tokio::test]
async fn failed_resume_does_not_silently_start_a_new_thread() {
    let f = Fixture::new("resume");
    let invocation = f.invocation(true);
    let handle = f.handle();
    let tracker = RuntimePidTracker::new(f.root.join("pids.json"));
    let mut context = AgentProtocolContext::new(f.root.clone());
    let mut state = CodexProtocolState::default();
    let (tx, mut rx) = mpsc::channel(PROTOCOL_BUFFER_CAPACITY);
    let env = HashMap::new();
    run_codex(
        ProviderRun {
            binary: &f.binary,
            invocation: &invocation,
            env: &env,
            prompt: "hello",
        },
        &handle,
        &tracker,
        &mut context,
        &mut state,
        &tx,
    )
    .await;
    let requests = std::fs::read_to_string(f.root.join("requests.jsonl")).unwrap();
    assert!(requests.contains("thread/resume"));
    assert!(!requests.contains("thread/start"));
    assert!(std::iter::from_fn(|| rx.try_recv().ok()).any(|event|
        matches!(event, ProtocolEmission::System(message) if message.contains("Could not resume Codex session saved-thread"))));
}

#[tokio::test]
async fn interrupt_terminates_a_server_that_never_completes_the_turn() {
    let f = Fixture::new("hang");
    let invocation = f.invocation(false);
    let handle = f.handle();
    let tracker = RuntimePidTracker::new(f.root.join("pids.json"));
    let mut context = AgentProtocolContext::new(f.root.clone());
    let mut state = CodexProtocolState::default();
    let (tx, _rx) = mpsc::channel(PROTOCOL_BUFFER_CAPACITY);
    let env = HashMap::new();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        tokio::join!(
            run_codex(
                ProviderRun {
                    binary: &f.binary,
                    invocation: &invocation,
                    env: &env,
                    prompt: "hello"
                },
                &handle,
                &tracker,
                &mut context,
                &mut state,
                &tx
            ),
            async {
                loop {
                    let ready = handle.codex_control.lock().unwrap().is_some();
                    if ready {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
                assert!(handle.stop_codex());
            }
        );
    })
    .await
    .unwrap();
    assert!(handle.pid().is_none());
    assert!(
        std::fs::read_to_string(f.root.join("requests.jsonl"))
            .unwrap()
            .contains("turn/interrupt")
    );
}

#[tokio::test]
async fn notifications_do_not_reset_the_rpc_deadline() {
    let f = Fixture::new("noisy");
    let invocation = f.invocation(false);
    let handle = f.handle();
    let tracker = RuntimePidTracker::new(f.root.join("pids.json"));
    let mut context = AgentProtocolContext::new(f.root.clone());
    let mut state = CodexProtocolState::default();
    let (tx, mut rx) = mpsc::channel(PROTOCOL_BUFFER_CAPACITY);
    let env = HashMap::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        run_codex(
            ProviderRun {
                binary: &f.binary,
                invocation: &invocation,
                env: &env,
                prompt: "hello",
            },
            &handle,
            &tracker,
            &mut context,
            &mut state,
            &tx,
        ),
    )
    .await
    .unwrap();
    assert!(std::iter::from_fn(|| rx.try_recv().ok()).any(|event|
        matches!(event, ProtocolEmission::System(message) if message.contains("response timed out"))));
    assert!(handle.pid().is_none());
}

#[tokio::test]
#[ignore = "Uses the installed Codex binary with a local Responses fixture; no provider request"]
async fn installed_codex_refuses_native_mutation_paths_in_automation_policy() {
    use axum::{Json, Router, extract::State, routing::post};
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("codex-home");
    let work = root.path().join("work");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&work).unwrap();
    std::fs::write(
        work.join("AGENTS.md"),
        "INFERAY_UNAPPROVED_CODEX_PROJECT_CONTEXT_41931",
    )
    .unwrap();
    std::fs::write(
        home.join("AGENTS.md"),
        "INFERAY_UNAPPROVED_CODEX_PERSONAL_CONTEXT_41931",
    )
    .unwrap();
    #[cfg(unix)]
    {
        let override_target = root.path().join("personal-override.md");
        std::fs::write(
            &override_target,
            "INFERAY_UNAPPROVED_CODEX_OVERRIDE_CONTEXT_41931",
        )
        .unwrap();
        std::os::unix::fs::symlink(override_target, home.join("AGENTS.override.md")).unwrap();
    }
    for (path, marker) in [
        (
            home.join("skills/personal-fixture/SKILL.md"),
            "INFERAY_UNAPPROVED_PERSONAL_SKILL_41931",
        ),
        (
            work.join(".agents/skills/project-fixture/SKILL.md"),
            "INFERAY_UNAPPROVED_PROJECT_SKILL_41931",
        ),
    ] {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            path,
            format!("---\nname: fixture-skill\ndescription: {marker}\n---\n{marker}\n"),
        )
        .unwrap();
    }
    let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    async fn respond(
        State(requests): State<Arc<Mutex<Vec<Value>>>>,
        Json(body): Json<Value>,
    ) -> impl axum::response::IntoResponse {
        let mut requests = requests.lock().unwrap();
        requests.push(body);
        let item = if requests.len() == 1 {
            json!({"type":"custom_tool_call","name":"apply_patch","call_id":"native-patch-probe","input":"*** Begin Patch\n*** Add File: forbidden.txt\n+native-write\n*** End Patch"})
        } else if requests.len() == 2 {
            json!({"type":"function_call","name":"exec_command","call_id":"native-shell-probe","arguments":json!({"cmd":"printf native-write > shell-forbidden.txt"}).to_string()})
        } else {
            json!({"type":"message","id":"done","role":"assistant","content":[{"type":"output_text","text":"PROBE_COMPLETE"}]})
        };
        let events = [
            json!({"type":"response.created","response":{"id":"fixture-response"}}),
            json!({"type":"response.output_item.done","item":item}),
            json!({"type":"response.completed","response":{"id":"fixture-response","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}),
        ];
        let body = events
            .iter()
            .map(|event| {
                format!(
                    "event: {}\ndata: {event}\n\n",
                    event["type"].as_str().unwrap()
                )
            })
            .collect::<String>();
        ([("content-type", "text/event-stream")], body)
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/responses", post(respond))
        .with_state(requests.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    std::fs::write(
        home.join("config.toml"),
        format!(
            r#"model = "gpt-5.4"
model_provider = "fixture"
[model_providers.fixture]
name = "Local permission fixture"
base_url = "http://{address}"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
"#
        ),
    )
    .unwrap();
    let resolver =
        crate::agent_command::AgentCommandResolver::new(root.path(), root.path().join("mcp.json"));
    let binary = resolver.resolve_agent_binary(inferay_core::agent_kind::AgentKind::Codex);
    let mut env = resolver.create_agent_env(inferay_core::agent_kind::AgentKind::Codex);
    env.insert("CODEX_HOME".into(), home.as_os_str().to_owned());
    let handle =
        AgentProcessHandle::with_skills(Arc::new(tokio::sync::Mutex::new(PromptStore::new(
            root.path().join("bundled.json"),
            root.path().join("skills.json"),
        ))))
        .with_sandbox(crate::automation_sandbox::AutomationSandbox::new(
            &[inferay_core::project_files::Permission::WriteProjectFiles]
                .into_iter()
                .collect(),
            &json!({}),
            &work,
        ));
    let invocation = CodexInvocationContext {
        cwd: work.clone(),
        reference_paths: vec![],
        images: vec![],
        model: Some("gpt-5.4".into()),
        reasoning_level: None,
        developer_instructions: Some("INFERAY_APPROVED_CONTEXT_41931".into()),
        session_id: None,
        mcp_servers: None,
    };
    let tracker = RuntimePidTracker::new(root.path().join("pids.json"));
    let mut context = AgentProtocolContext::new(work.clone());
    let mut state = CodexProtocolState::default();
    let (sender, mut receiver) = mpsc::channel(PROTOCOL_BUFFER_CAPACITY);
    let drain = tokio::spawn(async move {
        let mut emissions = Vec::new();
        while let Some(emission) = receiver.recv().await {
            if let ProtocolEmission::Chat(value) = emission {
                emissions.push(value);
            }
        }
        emissions
    });
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        run_codex(
            ProviderRun {
                binary: &binary,
                prompt: "Execute the supplied tool probe.",
                invocation: &invocation,
                env: &env,
            },
            &handle,
            &tracker,
            &mut context,
            &mut state,
            &sender,
        ),
    )
    .await;
    if result.is_err() {
        handle.kill();
    }
    server.abort();
    drop(sender);
    let emissions = drain.await.unwrap();
    assert!(
        result.is_ok(),
        "Installed Codex probe timed out: {emissions:?}"
    );
    assert!(
        !work.join("forbidden.txt").exists(),
        "Native apply_patch bypassed automation policy"
    );
    let requests = requests.lock().unwrap();
    let transcript = serde_json::to_string(&*requests).unwrap();
    assert!(
        transcript.contains("INFERAY_APPROVED_CONTEXT_41931"),
        "Explicit run instructions must still reach the provider"
    );
    assert!(
        !transcript.contains("INFERAY_UNAPPROVED_CODEX_PROJECT_CONTEXT_41931"),
        "Unapproved project instructions entered the provider context"
    );
    assert!(
        !transcript.contains("INFERAY_UNAPPROVED_CODEX_PERSONAL_CONTEXT_41931"),
        "Unapproved personal instructions entered the provider context"
    );
    assert!(
        !transcript.contains("INFERAY_UNAPPROVED_CODEX_OVERRIDE_CONTEXT_41931"),
        "Symlinked personal overrides entered the provider context"
    );
    for marker in [
        "INFERAY_UNAPPROVED_PERSONAL_SKILL_41931",
        "INFERAY_UNAPPROVED_PROJECT_SKILL_41931",
    ] {
        assert!(
            !transcript.contains(marker),
            "Unselected skill entered automation context: {marker}"
        );
    }
    let output = requests
        .iter()
        .flat_map(|request| request["input"].as_array().into_iter().flatten())
        .find(|item| {
            item["call_id"] == "native-patch-probe" && item["type"] == "custom_tool_call_output"
        });
    let output = output.unwrap_or_else(|| {
        panic!("Missing actual native patch result; emissions={emissions:?}; requests={requests:?}")
    })["output"]
        .to_string()
        .to_ascii_lowercase();
    assert!(
        output.contains("reject") || output.contains("denied") || output.contains("not permitted"),
        "Unexpected patch result: {output}"
    );
    assert!(
        !work.join("shell-forbidden.txt").exists(),
        "Native shell bypassed automation policy"
    );
    let shell = requests
        .iter()
        .flat_map(|request| request["input"].as_array().into_iter().flatten())
        .find(|item| {
            item["call_id"] == "native-shell-probe" && item["type"] == "function_call_output"
        });
    let shell =
        shell.unwrap_or_else(|| panic!("Missing native shell refusal: {requests:?}"))["output"]
            .to_string()
            .to_ascii_lowercase();
    assert!(
        shell.contains("unknown")
            || shell.contains("unsupported")
            || shell.contains("unrecognized"),
        "Native shell remained callable: {shell}"
    );
}

#[tokio::test]
#[ignore = "Uses installed Claude with a local Messages fixture; no paid provider request"]
async fn installed_claude_refuses_native_file_and_shell_tools_in_automation_policy() {
    use axum::{Json, Router, extract::State, routing::post};
    let root = tempfile::tempdir().unwrap();
    let work = root.path().join("work");
    let home = root.path().join("claude-home");
    std::fs::create_dir_all(&work).unwrap();
    std::fs::write(
        work.join("CLAUDE.md"),
        "INFERAY_UNAPPROVED_CLAUDE_PROJECT_CONTEXT_41931",
    )
    .unwrap();
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("CLAUDE.md"),
        "INFERAY_UNAPPROVED_CLAUDE_PERSONAL_CONTEXT_41931",
    )
    .unwrap();
    std::fs::write(work.join("edit.txt"), "original").unwrap();
    std::fs::write(
        root.path().join("private.txt"),
        "INFERAY_PRIVATE_READ_SENTINEL_31907",
    )
    .unwrap();
    let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    async fn respond(
        State((requests, work)): State<(Arc<Mutex<Vec<Value>>>, PathBuf)>,
        Json(body): Json<Value>,
    ) -> impl axum::response::IntoResponse {
        let mut requests = requests.lock().unwrap();
        requests.push(body);
        let probe = match requests.len() {
            1 => Some((
                "Bash",
                json!({"command":"printf native-write > shell-forbidden.txt"}),
            )),
            2 => Some((
                "Write",
                json!({"file_path":work.join("write-forbidden.txt"),"content":"native-write"}),
            )),
            3 => Some((
                "Edit",
                json!({"file_path":work.join("edit.txt"),"old_string":"original","new_string":"changed"}),
            )),
            4 => Some((
                "Read",
                json!({"file_path":work.parent().unwrap().join("private.txt")}),
            )),
            5 => Some((
                "Glob",
                json!({"path":work.parent().unwrap(),"pattern":"*.txt"}),
            )),
            6 => Some((
                "Grep",
                json!({"path":work.parent().unwrap(),"pattern":"INFERAY_PRIVATE_READ", "output_mode":"content"}),
            )),
            _ => None,
        };
        let mut events = vec![
            json!({"type":"message_start","message":{"id":format!("fixture-{}",requests.len()),"type":"message","role":"assistant","model":"claude-haiku-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}),
        ];
        if let Some((name, input)) = probe {
            events.push(json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":format!("native-{name}"),"name":name,"input":{}}}));
            events.push(json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":input.to_string()}}));
        } else {
            events.push(json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}));
            events.push(json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"PROBE_COMPLETE"}}));
        }
        events.extend([
            json!({"type":"content_block_stop","index":0}),
            json!({"type":"message_delta","delta":{"stop_reason":if requests.len() <= 6 { "tool_use" } else { "end_turn" },"stop_sequence":null},"usage":{"output_tokens":1}}),
            json!({"type":"message_stop"}),
        ]);
        let body = events
            .iter()
            .map(|event| {
                format!(
                    "event: {}\ndata: {event}\n\n",
                    event["type"].as_str().unwrap()
                )
            })
            .collect::<String>();
        ([("content-type", "text/event-stream")], body)
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/v1/messages", post(respond))
        .with_state((requests.clone(), work.clone()));
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let resolver =
        crate::agent_command::AgentCommandResolver::new(root.path(), root.path().join("mcp.json"));
    let binary = resolver.resolve_agent_binary(inferay_core::agent_kind::AgentKind::Claude);
    let mut env = resolver.create_agent_env(inferay_core::agent_kind::AgentKind::Claude);
    for (key, value) in [
        ("ANTHROPIC_BASE_URL", format!("http://{address}")),
        ("ANTHROPIC_API_KEY", "local-fixture".into()),
        ("ANTHROPIC_AUTH_TOKEN", "".into()),
        ("CLAUDE_CODE_OAUTH_TOKEN", "".into()),
        ("CLAUDE_CONFIG_DIR", home.to_string_lossy().into_owned()),
        ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1".into()),
    ] {
        env.insert(key.into(), value.into());
    }
    let handle =
        AgentProcessHandle::with_skills(Arc::new(tokio::sync::Mutex::new(PromptStore::new(
            root.path().join("bundled.json"),
            root.path().join("skills.json"),
        ))))
        .with_sandbox(crate::automation_sandbox::AutomationSandbox::new(
            &[inferay_core::project_files::Permission::WriteProjectFiles]
                .into_iter()
                .collect(),
            &json!({}),
            &work,
        ));
    let mut context = AgentProtocolContext::new(work.clone());
    let (sender, mut receiver) = mpsc::channel(PROTOCOL_BUFFER_CAPACITY);
    let drain = tokio::spawn(async move {
        let mut emissions = Vec::new();
        while let Some(emission) = receiver.recv().await {
            match emission {
                ProtocolEmission::Chat(value) => emissions.push(value),
                ProtocolEmission::System(text) => emissions.push(json!({"system":text})),
                _ => {}
            }
        }
        emissions
    });
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        run_claude(
            ProviderRun {
                binary: &binary,
                prompt: "Execute the supplied tool probe.",
                invocation: &CodexInvocationContext {
                    cwd: work.clone(),
                    reference_paths: vec![],
                    images: vec![],
                    model: Some("haiku".into()),
                    reasoning_level: None,
                    developer_instructions: Some("INFERAY_APPROVED_CONTEXT_41931".into()),
                    session_id: None,
                    mcp_servers: Some(vec![]),
                },
                env: &env,
            },
            &handle,
            &mut context,
            &sender,
        ),
    )
    .await;
    if result.is_err() {
        handle.kill();
    }
    server.abort();
    drop(sender);
    let emissions = drain.await.unwrap();
    assert!(result.is_ok(), "Claude probe timed out: {emissions:?}");
    assert!(!work.join("shell-forbidden.txt").exists());
    assert!(!work.join("write-forbidden.txt").exists());
    assert_eq!(
        std::fs::read_to_string(work.join("edit.txt")).unwrap(),
        "original"
    );
    let requests = requests.lock().unwrap();
    let transcript = serde_json::to_string(&*requests).unwrap();
    assert!(
        transcript.contains("INFERAY_APPROVED_CONTEXT_41931"),
        "Explicit run instructions must still reach the provider"
    );
    assert!(
        !transcript.contains("INFERAY_UNAPPROVED_CLAUDE_PROJECT_CONTEXT_41931"),
        "Unapproved project instructions entered the provider context"
    );
    assert!(
        !transcript.contains("INFERAY_UNAPPROVED_CLAUDE_PERSONAL_CONTEXT_41931"),
        "Unapproved personal instructions entered the provider context"
    );
    assert!(
        !serde_json::to_string(&*requests)
            .unwrap()
            .contains("INFERAY_PRIVATE_READ_SENTINEL_31907")
    );
    for name in ["Bash", "Write", "Edit", "Read", "Glob", "Grep"] {
        let id = format!("native-{name}");
        let output = requests
            .iter()
            .flat_map(|request| request["messages"].as_array().into_iter().flatten())
            .flat_map(|message| message["content"].as_array().into_iter().flatten())
            .find(|part| part["type"] == "tool_result" && part["tool_use_id"] == id);
        let output = output.unwrap_or_else(|| {
            panic!("Missing {name} refusal: {emissions:?}; requests={requests:?}")
        });
        assert_eq!(
            output["is_error"], true,
            "Native {name} remained callable: {output}"
        );
        let content = output["content"].to_string().to_ascii_lowercase();
        assert!(
            content.contains("no such tool")
                || content.contains("unknown")
                || content.contains("unavailable")
                || content.contains("not available")
                || content.contains("not allowed")
                || content.contains("denied"),
            "Unexpected {name} refusal: {output}"
        );
    }
}

#[tokio::test]
#[ignore = "requires installed Codex; uses disposable homes and local MCP fixtures, no model requests"]
async fn installed_codex_starts_only_explicitly_selected_mcp_servers() {
    let profile = tempfile::tempdir().unwrap();
    let home = profile.path().join("home");
    let work = profile.path().join("work");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&work).unwrap();
    let script = profile.path().join("server.py");
    std::fs::write(&script, r#"import json,sys,pathlib
pathlib.Path(sys.argv[1]).write_text('started')
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 method=m.get('method')
 if method=='initialize': result={'protocolVersion':m['params']['protocolVersion'],'capabilities':{'tools':{}},'serverInfo':{'name':'scope-fixture','version':'1'}}
 elif method=='tools/list': result={'tools':[{'name':'ping','description':'Returns pong','inputSchema':{'type':'object','properties':{}}}]}
 elif method=='tools/call': result={'content':[{'type':'text','text':'pong'}]}
 else: result={}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':result}),flush=True)
"#).unwrap();
    let chosen = profile.path().join("chosen-started");
    let other = profile.path().join("other-started");
    let quote = |path: &Path| serde_json::to_string(&path.to_string_lossy()).unwrap();
    std::fs::write(
        home.join("config.toml"),
        format!(
            r#"
model = "gpt-5.4"
model_provider = "fixture"
[model_providers.fixture]
name = "Local fixture"
base_url = "http://127.0.0.1:9/v1"
wire_api = "responses"
requires_openai_auth = false
[mcp_servers.chosen]
command = "/usr/bin/python3"
args = [{}, {}]
[mcp_servers.other]
command = "/usr/bin/python3"
args = [{}, {}]
"#,
            quote(&script),
            quote(&chosen),
            quote(&script),
            quote(&other)
        ),
    )
    .unwrap();
    let resolver = crate::agent_command::AgentCommandResolver::new(
        profile.path(),
        profile.path().join("mcp.json"),
    );
    let binary = resolver.resolve_agent_binary(inferay_core::agent_kind::AgentKind::Codex);
    let mut env = resolver.create_agent_env(inferay_core::agent_kind::AgentKind::Codex);
    env.insert("CODEX_HOME".into(), home.into_os_string());
    for name in ["OPENAI_API_KEY", "CODEX_API_KEY", "INFERAY_MCP_OVERRIDES"] {
        env.remove(OsStr::new(name));
    }
    inspect_codex_mcp(&binary, &work, &env, Some(&[]))
        .await
        .unwrap();
    assert!(
        !chosen.exists() && !other.exists(),
        "An empty selection must start neither server"
    );
    let (_, servers) = inspect_codex_mcp(&binary, &work, &env, Some(&["chosen".into()]))
        .await
        .unwrap();
    assert!(chosen.exists(), "Selected MCP server must actually start");
    assert!(!other.exists(), "Unselected MCP server must never start");
    assert!(
        servers.iter().any(|server| server["name"] == "chosen"
            && server["tools"]
                .as_object()
                .is_some_and(|tools| !tools.is_empty())),
        "Selected server must expose its tool inventory"
    );
}

#[tokio::test]
#[ignore = "manual provider burst benchmark; records throughput under a slow consumer"]
async fn measure_provider_burst() {
    let root = tempfile::tempdir().unwrap();
    let binary = root.path().join("provider");
    std::fs::write(&binary, r#"#!/usr/bin/python3
import json,sys
for i in range(2000):
 print(json.dumps({'type':'stream_event','event':{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':str(i)+':'+'x'*16384}}}),flush=True)
print(json.dumps({'type':'result','result':'finished'}),flush=True)
"#).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    let handle =
        AgentProcessHandle::with_skills(Arc::new(tokio::sync::Mutex::new(PromptStore::new(
            root.path().join("bundled.json"),
            root.path().join("local.json"),
        ))));
    let invocation = CodexInvocationContext {
        cwd: root.path().to_owned(),
        reference_paths: vec![],
        images: vec![],
        model: None,
        reasoning_level: None,
        developer_instructions: None,
        session_id: None,
        mcp_servers: None,
    };
    let mut context = AgentProtocolContext::new(root.path().to_owned());
    let env = HashMap::new();
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let delay = std::env::var("INFERAY_BURST_DELAY_MS")
        .unwrap_or("1".into())
        .parse::<u64>()
        .unwrap();
    let started = std::time::Instant::now();
    let runner_handle = handle.clone();
    let output = drive_protocol(
        |sender| async move {
            run_claude(
                ProviderRun {
                    binary: &binary,
                    prompt: "fixture",
                    invocation: &invocation,
                    env: &env,
                },
                &runner_handle,
                &mut context,
                &sender,
            )
            .await
        },
        |emission| {
            let count = count.clone();
            async move {
                if let ProtocolEmission::Chat(event) = emission
                    && event["type"] == "content_block_delta"
                {
                    let text = event["delta"]["text"].as_str().unwrap();
                    let (index, body) = text.split_once(':').unwrap();
                    assert_eq!(
                        index.parse::<usize>().unwrap(),
                        count.fetch_add(1, Ordering::Relaxed)
                    );
                    assert_eq!(body.len(), 16384);
                    assert!(body.bytes().all(|b| b == b'x'));
                    if delay > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    }
                }
            }
        },
    )
    .await;
    assert_eq!(output, "finished");
    assert_eq!(count.load(Ordering::Relaxed), 2000);
    assert!(handle.pid().is_none());
    println!(
        "PROVIDER_BURST_MS={:.3}",
        started.elapsed().as_secs_f64() * 1000.0
    );
}
