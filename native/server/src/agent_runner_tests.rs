use super::*;
use std::os::unix::fs::PermissionsExt;

#[tokio::test]
async fn provider_stderr_preserves_partial_diagnostics_and_read_error() {
    struct FailedStream;
    impl AsyncRead for FailedStream {
        fn poll_read(
            self: std::pin::Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
            _: &mut tokio::io::ReadBuf<'_>,
        ) -> std::task::Poll<std::io::Result<()>> {
            std::task::Poll::Ready(Err(std::io::Error::other("read failure")))
        }
    }
    let stream = b"diagnostic \xe2\x82".as_slice().chain(FailedStream);
    let (text, error) = drain_bounded(stream).await;
    assert_eq!(text, "diagnostic �");
    assert_eq!(error.unwrap().to_string(), "read failure");
}

#[tokio::test]
async fn provider_stderr_retains_a_unicode_tail_across_read_boundaries() {
    let (mut writer, reader) = tokio::io::duplex(8192);
    let writing = tokio::spawn(async move {
        let mut bytes = vec![b'x'; 300_000];
        bytes.extend_from_slice("😀".repeat(32_000).as_bytes());
        bytes.extend_from_slice(&[0xe2, 0x82]); // Incomplete UTF-8 at EOF.
        for chunk in bytes.chunks(4093) {
            writer.write_all(chunk).await.unwrap();
        }
    });
    let (text, error) = drain_bounded(reader).await;
    assert!(error.is_none());
    writing.await.unwrap();
    // The final 64,000 UTF-16 units start inside an emoji and end at the
    // replacement character for the incomplete byte sequence.
    assert_eq!(text, format!("�{}�", "😀".repeat(31_999)));
}

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
        let skills = Arc::new(tokio::sync::Mutex::new(
            PromptStore::open(self.root.join("bundled.json"), self.root.join("local.json"))
                .unwrap(),
        ));
        let projects = crate::project_runtime::ProjectRuntime::open(
            &self.root,
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
    let handle = AgentProcessHandle::with_skills(Arc::new(tokio::sync::Mutex::new(
        PromptStore::open(
            root.path().join("bundled.json"),
            root.path().join("local.json"),
        )
        .unwrap(),
    )));
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

#[test]
fn provider_launch_clears_inherited_gui_signal_mask_without_changing_parent() {
    // Confine the blocked mask to a disposable thread, as a GUI executor does.
    std::thread::spawn(|| {
        unsafe {
            let mut blocked: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut blocked);
            libc::sigaddset(&mut blocked, libc::SIGCHLD);
            libc::sigaddset(&mut blocked, libc::SIGTERM);
            assert_eq!(libc::pthread_sigmask(libc::SIG_BLOCK, &blocked, std::ptr::null_mut()), 0);
        }
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let output = tokio::time::timeout(std::time::Duration::from_secs(5),
                provider_command("/usr/bin/python3").args(["-c", "import signal,subprocess; m=signal.pthread_sigmask(signal.SIG_BLOCK, []); assert signal.SIGCHLD not in m and signal.SIGTERM not in m; subprocess.run(['/bin/echo','child completed'],check=True)"])
                    .output()).await.unwrap().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "child completed");
        });
        unsafe {
            let mut current: libc::sigset_t = std::mem::zeroed();
            libc::pthread_sigmask(libc::SIG_BLOCK, std::ptr::null(), &mut current);
            assert_eq!(libc::sigismember(&current, libc::SIGCHLD), 1);
            assert_eq!(libc::sigismember(&current, libc::SIGTERM), 1);
        }
    }).join().unwrap();
}
