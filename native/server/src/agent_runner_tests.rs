use super::*;
use std::os::unix::fs::PermissionsExt;

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
  assert m['params']['modelProvider']=='inferay_openai_http'
  assert m['params']['config']['model_providers.inferay_openai_http']['supports_websockets']==False
  send({'id':m['id'],'result':{'thread':{'id':'fixture-thread'}}})
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
        }
    }
    fn handle(&self) -> AgentProcessHandle {
        AgentProcessHandle::with_skills(Arc::new(tokio::sync::Mutex::new(PromptStore::new(
            self.root.join("bundled.json"),
            self.root.join("local.json"),
        ))))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn http_transport_preserves_custom_providers_and_openai_endpoint() {
    let mut params = json!({"model":"chosen-model"});
    configure_codex_transport(&mut params, &json!({"model_provider":"custom"}));
    assert_eq!(params, json!({"model":"chosen-model"}));
    configure_codex_transport(
        &mut params,
        &json!({"openai_base_url":"https://example.test/v1"}),
    );
    assert_eq!(params["model"], "chosen-model");
    assert_eq!(
        params["config"]["model_providers.inferay_openai_http"]["base_url"],
        "https://example.test/v1"
    );
    assert_eq!(
        params["config"]["model_providers.inferay_openai_http"]["requires_openai_auth"],
        true
    );
}

#[tokio::test]
async fn unsupported_server_requests_receive_replies_during_startup_and_turns() {
    let f = Fixture::new("unsupported");
    let invocation = f.invocation(false);
    let handle = f.handle();
    let tracker = RuntimePidTracker::new(f.root.join("pids.json"));
    let mut context = AgentProtocolContext::new(f.root.clone());
    let mut state = CodexProtocolState::default();
    let (tx, _rx) = mpsc::unbounded_channel();
    let env = HashMap::new();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        run_codex(
            CodexRun {
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
    let (tx, mut rx) = mpsc::unbounded_channel();
    let env = HashMap::new();
    run_codex(
        CodexRun {
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
    let (tx, _rx) = mpsc::unbounded_channel();
    let env = HashMap::new();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        tokio::join!(
            run_codex(
                CodexRun {
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
    let (tx, mut rx) = mpsc::unbounded_channel();
    let env = HashMap::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        run_codex(
            CodexRun {
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
