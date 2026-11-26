use super::*;
use std::os::unix::fs::PermissionsExt;

/// Replays an ACP exchange recorded from AFK (`tests/fixtures/afk-acp`, copied
/// from agent-afk's golden transcripts). Client frames must arrive in order
/// with the recorded method, id and permission outcome; agent frames are sent
/// verbatim. Any mismatch is written to `mismatch` and the fake exits.
const FAKE_AFK: &str = r#"#!/usr/bin/python3
import json,os,sys
assert sys.argv[1:]==['acp']
def fail(message):
 open('mismatch','w').write(message)
 sys.exit(3)
for line in open(os.environ['AFK_TRANSCRIPT']):
 entry=json.loads(line)
 frame=entry['frame']
 if entry['direction']=='agent_to_client':
  print(json.dumps(frame),flush=True)
  continue
 received=sys.stdin.readline()
 if not received: fail('closed before '+json.dumps(frame))
 got=json.loads(received)
 for key in ['jsonrpc','method','id']:
  if got.get(key)!=frame.get(key): fail(key+': '+received)
 if 'result' in frame and got.get('result')!=frame['result']: fail('result: '+received)
 if frame.get('method')=='session/prompt' and got['params']['prompt'][0]['type']!='text': fail(received)
mode=os.environ.get('AFK_AFTER','')
if mode=='exit': sys.exit(1)
for line in sys.stdin: pass
"#;

struct Afk {
    root: tempfile::TempDir,
    binary: PathBuf,
}

impl Afk {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let binary = root.path().join("afk");
        std::fs::write(&binary, FAKE_AFK).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self { root, binary }
    }

    fn write_transcript(&self, lines: &[Value]) -> PathBuf {
        let path = self.root.path().join("custom.ndjson");
        let text = lines
            .iter()
            .map(|line| format!("{line}\n"))
            .collect::<String>();
        std::fs::write(&path, text).unwrap();
        path
    }

    /// Runs one turn against `transcript`; `react` sees each emission and the
    /// live handle so tests can answer approvals or stop the turn.
    async fn run(
        &self,
        transcript: &Path,
        after: &str,
        mut react: impl FnMut(&ProtocolEmission, &AgentProcessHandle),
    ) -> (String, Vec<ProtocolEmission>, AgentProcessHandle) {
        let invocation = CodexInvocationContext {
            cwd: self.root.path().to_path_buf(),
            reference_paths: vec![],
            images: vec![],
            model: None,
            reasoning_level: None,
            developer_instructions: None,
            session_id: None,
            mcp_servers: None,
        };
        let skills = Arc::new(tokio::sync::Mutex::new(
            PromptStore::open(
                self.root.path().join("bundled.json"),
                self.root.path().join("local.json"),
            )
            .unwrap(),
        ));
        let handle = AgentProcessHandle::with_skills(skills);
        let tracker = RuntimePidTracker::new(self.root.path().join("pids.json"));
        let env = HashMap::from([
            ("AFK_TRANSCRIPT".into(), transcript.into()),
            ("AFK_AFTER".into(), after.into()),
        ]);
        let mut context = AgentProtocolContext::new(self.root.path());
        let mut seen = Vec::new();
        let (binary, invocation, env, context, tracker) =
            (&self.binary, &invocation, &env, &mut context, &tracker);
        let runner = &handle;
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            drive_protocol(
                |sender| async move {
                    run_afk(
                        ProviderRun {
                            binary,
                            prompt: "hello",
                            invocation,
                            env,
                        },
                        runner,
                        tracker,
                        context,
                        &sender,
                    )
                    .await
                },
                |emission| {
                    react(&emission, &handle);
                    seen.push(emission);
                    async {}
                },
            ),
        )
        .await
        .expect("AFK turn must finish");
        assert!(
            !self.root.path().join("mismatch").exists(),
            "client diverged from the recorded exchange: {}",
            std::fs::read_to_string(self.root.path().join("mismatch")).unwrap()
        );
        assert!(handle.pid().is_none());
        assert!(handle.pending_requests().is_empty());
        (output, seen, handle)
    }
}

fn recorded(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/afk-acp")
        .join(format!("{name}.ndjson"))
}

fn chats(emissions: &[ProtocolEmission]) -> Vec<&Value> {
    emissions
        .iter()
        .filter_map(|emission| match emission {
            ProtocolEmission::Chat(value) => Some(value),
            _ => None,
        })
        .collect()
}

fn system(emissions: &[ProtocolEmission]) -> Vec<&str> {
    emissions
        .iter()
        .filter_map(|emission| match emission {
            ProtocolEmission::System(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn answer(id: &str, decision: &'static str) -> impl FnMut(&ProtocolEmission, &AgentProcessHandle) {
    let mut answered = false;
    let id = id.to_owned();
    move |emission, handle| {
        if let ProtocolEmission::Requests(requests) = emission
            && !answered
            && let Some(request) = requests.first()
        {
            answered = true;
            assert_eq!(request["method"], "session/request_permission");
            assert_eq!(request["params"]["toolCall"]["toolCallId"], id.as_str());
            assert!(request["params"]["message"].is_string());
            let handle = handle.clone();
            let request = request["id"].as_str().unwrap().to_owned();
            tokio::spawn(async move { handle.respond(request, json!(decision)).await.unwrap() });
        }
    }
}

#[tokio::test]
async fn text_turn_streams_reasoning_and_reply_and_records_the_session() {
    let afk = Afk::new();
    let (output, emissions, _) = afk.run(&recorded("text-turn"), "", |_, _| {}).await;
    assert_eq!(output, "Hello!");
    assert!(emissions.contains(&ProtocolEmission::Session(
        "11111111-1111-4111-8111-111111111111".into()
    )));
    let chats = chats(&emissions);
    assert!(
        chats.iter().any(|event| event["type"] == "inferay.progress"
            && event["delta"] == "I will greet the user.")
    );
    assert!(chats.iter().any(|event| event["delta"]["text"] == "Hello!"));
    assert!(system(&emissions).is_empty());
}

#[tokio::test]
async fn auto_allowed_read_shows_its_tool_call_and_result() {
    let afk = Afk::new();
    let (_, emissions, _) = afk.run(&recorded("tool-read"), "", |_, _| {}).await;
    let tools: Vec<_> = chats(&emissions)
        .into_iter()
        .filter(|event| event["type"] == "inferay.tool")
        .collect();
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0]["name"], "read_file /workspace/a.txt");
    assert_eq!(tools[0]["input"]["file_path"], "/workspace/a.txt");
    assert_eq!(tools[0]["done"], false);
    assert_eq!(tools[1]["output"], "old\n");
    assert!(
        !emissions
            .iter()
            .any(|emission| matches!(emission, ProtocolEmission::FileChange(_)))
    );
}

#[tokio::test]
async fn edit_shows_its_tool_call_and_changed_file_once() {
    let afk = Afk::new();
    // The recorded edit without its approval, as after an "always allow" grant.
    let recorded = std::fs::read_to_string(recorded("tool-edit-diff")).unwrap();
    let frames: Vec<Value> = recorded
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        // Strip the permission round-trip (request + response) to simulate
        // an "always allow" grant, without hardcoding a specific RPC id.
        .filter(|line| {
            let frame = &line["frame"];
            frame["method"].as_str() != Some("session/request_permission")
                && !frame["id"].is_string()
        })
        .collect();
    let transcript = afk.write_transcript(&frames);
    let (output, emissions, _) = afk.run(&transcript, "", |_, _| {}).await;
    assert_eq!(output, "");
    let tools: Vec<_> = chats(&emissions)
        .into_iter()
        .filter(|event| event["type"] == "inferay.tool")
        .collect();
    assert_eq!(tools.first().unwrap()["done"], false);
    assert_eq!(tools.first().unwrap()["name"], "edit_file /workspace/a.txt");
    assert_eq!(tools.first().unwrap()["input"]["old_string"], "old");
    let last = tools.last().unwrap();
    assert_eq!(last["done"], true);
    assert_eq!(last["output"], "Replaced 1 occurrence");
    // The diff is repeated in the final update; the file is reported once.
    let changes: Vec<_> = emissions
        .iter()
        .filter(|emission| matches!(emission, ProtocolEmission::FileChange(_)))
        .collect();
    assert_eq!(
        changes,
        [&ProtocolEmission::FileChange(vec![
            "/workspace/a.txt".into()
        ])]
    );
}

#[tokio::test]
async fn approve_once_selects_the_offered_allow_option() {
    let afk = Afk::new();
    let (_, emissions, _) = afk
        .run(
            &recorded("permission-allow-once"),
            "",
            answer("tool-1", "accept"),
        )
        .await;
    assert!(
        chats(&emissions)
            .iter()
            .any(|event| event["output"] == "Wrote 6 bytes")
    );
}

#[tokio::test]
async fn decline_rejects_and_the_turn_continues() {
    let afk = Afk::new();
    let (_, emissions, _) = afk
        .run(
            &recorded("permission-reject"),
            "",
            answer("tool-1", "decline"),
        )
        .await;
    assert!(
        chats(&emissions)
            .iter()
            .any(|event| event["done"] == true && event["output"] == "Permission denied: rejected")
    );
    assert!(system(&emissions).is_empty());
}

#[tokio::test]
async fn stop_cancels_the_streaming_turn() {
    let afk = Afk::new();
    let (output, emissions, _) = afk
        .run(&recorded("cancel-during-stream"), "", |emission, handle| {
            if let ProtocolEmission::Chat(event) = emission
                && event["delta"]["text"] == "Hello"
            {
                handle.stop_codex();
            }
        })
        .await;
    assert_eq!(output, "Hello");
    assert!(system(&emissions).is_empty());
}

#[tokio::test]
async fn stop_answers_an_open_approval_as_cancelled() {
    let afk = Afk::new();
    let (_, emissions, _) = afk
        .run(
            &recorded("cancel-during-permission"),
            "",
            |emission, handle| {
                if let ProtocolEmission::Requests(requests) = emission
                    && !requests.is_empty()
                {
                    handle.stop_codex();
                }
            },
        )
        .await;
    assert!(
        chats(&emissions)
            .iter()
            .any(|event| event["output"] == "Permission denied: cancelled")
    );
    assert!(emissions.contains(&ProtocolEmission::Requests(vec![])));
}

#[tokio::test]
async fn older_afk_is_told_to_update() {
    let afk = Afk::new();
    let transcript = afk.write_transcript(&[
        json!({"direction":"client_to_agent","frame":{"jsonrpc":"2.0","id":1,"method":"initialize"}}),
        json!({"direction":"agent_to_client","frame":{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"1.0","capabilities":{}}}}),
    ]);
    let (output, emissions, _) = afk.run(&transcript, "", |_, _| {}).await;
    assert_eq!(output, "");
    assert_eq!(system(&emissions).len(), 1);
    assert!(system(&emissions)[0].contains("Update agent-afk"));
}

#[tokio::test]
async fn unexpected_exit_reports_an_unfinished_turn() {
    let afk = Afk::new();
    let recorded = std::fs::read_to_string(recorded("text-turn")).unwrap();
    let opening: Vec<Value> = recorded
        .lines()
        .take(6)
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let transcript = afk.write_transcript(&opening);
    let (output, emissions, _) = afk.run(&transcript, "exit", |_, _| {}).await;
    assert_eq!(output, "");
    assert_eq!(
        system(&emissions),
        ["AFK exited before finishing the turn."]
    );
}

#[test]
fn approval_answers_only_select_offered_one_time_options() {
    let request = PendingProviderRequest {
        rpc_id: json!("acp:1"),
        method: "session/request_permission".into(),
        params: json!({"options":[
            {"optionId":"yes","kind":"allow_once"},
            {"optionId":"always","kind":"allow_always"},
            {"optionId":"no","kind":"reject_once"}]}),
    };
    let reply = provider_request_reply(&request, json!("accept")).unwrap();
    assert_eq!(reply["id"], "acp:1");
    assert_eq!(reply["result"]["outcome"]["optionId"], "yes");
    assert_eq!(
        provider_request_reply(&request, json!("decline")).unwrap()["result"]["outcome"]["optionId"],
        "no"
    );
    assert!(provider_request_reply(&request, json!("cancel")).is_err());
    let mut without_reject = request.clone();
    without_reject.params["options"] = json!([{"optionId":"yes","kind":"allow_once"}]);
    assert!(provider_request_reply(&without_reject, json!("decline")).is_err());
}

#[tokio::test]
#[ignore = "requires an AFK build with ACP v1 at AFK_PATH and model credentials; set AFK_STATE_DIR to a disposable directory"]
async fn installed_afk_answers_resumes_and_asks_before_writing() {
    let root = tempfile::tempdir().unwrap();
    let binary = PathBuf::from(std::env::var_os("AFK_PATH").expect("AFK_PATH"));
    let env: HashMap<OsString, OsString> = std::env::vars_os().collect();
    let skills = Arc::new(tokio::sync::Mutex::new(
        PromptStore::open(
            root.path().join("bundled.json"),
            root.path().join("local.json"),
        )
        .unwrap(),
    ));
    let tracker = RuntimePidTracker::new(root.path().join("pids.json"));
    let cwd = root.path().canonicalize().unwrap();
    let mut session_id = None;
    for (prompt, approve) in [
        ("Reply with exactly the word pong and nothing else.", false),
        (
            "Use write_file to create smoke.txt in the current directory containing the word you just replied with.",
            true,
        ),
    ] {
        let handle = AgentProcessHandle::with_skills(skills.clone());
        let invocation = CodexInvocationContext {
            cwd: cwd.clone(),
            reference_paths: vec![],
            images: vec![],
            model: None,
            reasoning_level: None,
            developer_instructions: None,
            session_id: session_id.clone(),
            mcp_servers: None,
        };
        let mut protocol = AgentProtocolContext::new(cwd.clone());
        let mut seen = Vec::new();
        let (binary, invocation, env, context, tracker, runner) =
            (&binary, &invocation, &env, &mut protocol, &tracker, &handle);
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(180),
            drive_protocol(
                |sender| async move {
                    run_afk(
                        ProviderRun {
                            binary,
                            prompt,
                            invocation,
                            env,
                        },
                        runner,
                        tracker,
                        context,
                        &sender,
                    )
                    .await
                },
                |emission| {
                    if let ProtocolEmission::Requests(requests) = &emission
                        && let Some(request) = requests.first()
                    {
                        eprintln!("approval: {}", request["params"]["message"]);
                        let handle = runner.clone();
                        let id = request["id"].as_str().unwrap().to_owned();
                        tokio::spawn(async move { handle.respond(id, json!("accept")).await });
                    }
                    seen.push(emission);
                    async {}
                },
            ),
        )
        .await
        .unwrap();
        eprintln!("output: {output:?}");
        for emission in &seen {
            eprintln!("{emission:?}");
        }
        assert!(handle.pid().is_none());
        session_id = protocol.session_id.clone();
        if approve {
            assert_eq!(
                std::fs::read_to_string(cwd.join("smoke.txt"))
                    .unwrap()
                    .trim(),
                "pong"
            );
        } else {
            assert!(output.to_lowercase().contains("pong"));
        }
    }
}
