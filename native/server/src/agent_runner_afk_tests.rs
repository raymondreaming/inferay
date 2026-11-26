use super::*;

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
