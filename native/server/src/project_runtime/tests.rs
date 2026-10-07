use super::*;
use serde_json::json;

fn runtime(root: &Path) -> Arc<ProjectRuntime> {
    ProjectRuntime::open(
        root,
        Arc::new(AgentCommandResolver::new(root, root.join("mcp.json"))),
        Arc::new(tokio::sync::Mutex::new(PromptStore::new(
            root.join("bundled.json"),
            root.join("prompts.json"),
        ))),
        RuntimePidTracker::new(root.join("pids.json")),
    )
    .unwrap()
}

fn definition_files(root: &Path, script: &str) -> (String, String) {
    let project = uuid::Uuid::new_v4().to_string();
    let automation = uuid::Uuid::new_v4().to_string();
    let directory = root.join("projects").join(&project);
    std::fs::create_dir_all(&directory).unwrap();
    for (path, body) in [
        (
            "project.json",
            json!({"schema":"inferay.project/1","id":project,"name":"Studio","description":"","instructions":"Be precise","repositories":[]}),
        ),
        (
            "plugins/report/plugin.json",
            json!({"schema":"inferay.plugin/1","id":uuid::Uuid::new_v4().to_string(),"name":"Report","version":"1","description":"","may":[]}),
        ),
        (
            "plugins/report/tools/report/tool.json",
            json!({"schema":"inferay.tool/1","id":uuid::Uuid::new_v4().to_string(),"name":"Report","program":"python3","entrypoint":"run.py","args":[],"timeoutSeconds":30,"inputSchema":{"type":"object"},"outputSchema":{"type":"object"}}),
        ),
        (
            "plugins/report/automations/report.json",
            json!({"schema":"inferay.automation/1","id":automation,"name":"Report","trigger":{"kind":"manual"},"overlap":"skip","execution":{"kind":"tool","tool":"report","input":{}},"may":[]}),
        ),
    ] {
        crate::project_definitions::write(&directory, path, body.to_string().as_bytes(), None)
            .unwrap();
    }
    crate::project_definitions::write(
        &directory,
        "plugins/report/tools/report/run.py",
        script.as_bytes(),
        None,
    )
    .unwrap();
    (project, automation)
}

async fn approved_run(runtime: &Arc<ProjectRuntime>, automation: &str, key: &str) -> String {
    let review = runtime
        .command(
            ProjectFileCommand::ReviewAutomation {
                id: automation.into(),
            },
            true,
        )
        .await
        .unwrap();
    runtime
        .command(
            ProjectFileCommand::ApproveAutomation {
                id: automation.into(),
                expected_inputs_hash: review["inputsHash"].as_str().unwrap().into(),
                enable: false,
            },
            true,
        )
        .await
        .unwrap();
    runtime
        .command(
            ProjectFileCommand::RunAutomation {
                id: automation.into(),
                request_id: key.into(),
            },
            true,
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .into()
}
async fn completed(runtime: &Arc<ProjectRuntime>, project: &str, id: &str) -> ProjectRun {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let workspace = runtime.catalog(Some(project.into()), None).await.unwrap();
            let run = workspace
                .history
                .runs
                .into_iter()
                .find(|r| r.id == id)
                .unwrap();
            if !["queued", "running"].contains(&run.status.as_str()) {
                break run;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn file_runtime_runs_tools_and_retains_artifacts_and_context() {
    let root = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(
        root.path(),
        "import os,json\nfrom pathlib import Path\np=Path(os.environ['INFERAY_RUN_OUTPUT'])/'report.md'\np.write_text('durable run')\nprint(json.dumps({'artifacts':['report.md']}))",
    );
    let runtime = runtime(root.path());
    let run = approved_run(&runtime, &automation, "manual").await;
    let duplicate = runtime
        .command(
            ProjectFileCommand::RunAutomation {
                id: automation,
                request_id: "manual".into(),
            },
            true,
        )
        .await
        .unwrap();
    assert_eq!(duplicate["id"], run);
    runtime.tick().await.unwrap();
    let done = completed(&runtime, &project, &run).await;
    assert_eq!(done.status, "succeeded", "{:?}", done.error);
    let workspace = runtime.catalog(Some(project.clone()), None).await.unwrap();
    assert_eq!(workspace.history.artifacts.len(), 1);
    assert_eq!(
        std::fs::read_to_string(&workspace.history.artifacts[0].path).unwrap(),
        "durable run"
    );
    assert!(Path::new(&done.directory).join("inputs/run.json").exists());
    runtime
        .command(
            ProjectFileCommand::AssociateConversation {
                project_id: project.clone(),
                pane_id: "chat".into(),
            },
            true,
        )
        .await
        .unwrap();
    let context = runtime.context("chat", root.path()).await.unwrap().unwrap();
    assert_eq!(context.0, project);
    assert_eq!(context.1, "Be precise");
    assert_eq!(
        runtime
            .store
            .lock()
            .unwrap()
            .db
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='resource_revisions'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn cancellation_kills_tool_and_releases_admission() {
    let root = tempfile::tempdir().unwrap();
    let (project, automation) =
        definition_files(root.path(), "import time\ntime.sleep(60)\nprint('{}')");
    let runtime = runtime(root.path());
    let run = approved_run(&runtime, &automation, "cancel").await;
    runtime.tick().await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    runtime
        .command(ProjectFileCommand::StopRun { id: run.clone() }, true)
        .await
        .unwrap();
    assert_eq!(
        completed(&runtime, &project, &run).await.status,
        "cancelled"
    );
    assert_eq!(runtime.capacity.available_permits(), 4);
}

#[tokio::test]
async fn bad_artifact_rolls_back_all_outputs_and_fails_run() {
    let root = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(
        root.path(),
        "import os,json\nfrom pathlib import Path\n(Path(os.environ['INFERAY_RUN_OUTPUT'])/'good.md').write_text('good')\nprint(json.dumps({'artifacts':['good.md','../outside.md']}))",
    );
    let runtime = runtime(root.path());
    let run = approved_run(&runtime, &automation, "bad-artifact").await;
    runtime.tick().await.unwrap();
    assert_eq!(completed(&runtime, &project, &run).await.status, "failed");
    assert!(
        runtime
            .catalog(Some(project), None)
            .await
            .unwrap()
            .history
            .artifacts
            .is_empty()
    );
}

#[tokio::test]
async fn edited_input_is_refused_before_queued_execution() {
    let root = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(root.path(), "print('{}')");
    let runtime = runtime(root.path());
    let run = approved_run(&runtime, &automation, "edited").await;
    std::fs::write(
        root.path()
            .join("projects")
            .join(&project)
            .join("plugins/report/tools/report/run.py"),
        "raise Exception('must never execute')",
    )
    .unwrap();
    runtime.tick().await.unwrap();
    let done = completed(&runtime, &project, &run).await;
    assert_eq!(done.status, "failed");
    assert!(done.started_at.is_none());
    assert!(!Path::new(&done.directory).exists());
}

#[tokio::test]
async fn documents_preserve_binary_originals_and_refuse_overwrite_or_escape() {
    let profile = tempfile::tempdir().unwrap();
    let (project, _) = definition_files(profile.path(), "print('{}')");
    let runtime = runtime(profile.path());
    assert!(runtime.documents(project.clone()).await.unwrap().is_empty());
    let original = vec![0, 255, 137, 80, 78, 71];
    runtime
        .import_document(project.clone(), "reference.png".into(), original.clone())
        .await
        .unwrap();
    let path = profile
        .path()
        .join("projects")
        .join(&project)
        .join("memory/documents/reference.png");
    assert_eq!(std::fs::read(&path).unwrap(), original);
    let documents = runtime.documents(project.clone()).await.unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].category, "Images");
    assert_eq!(documents[0].size, original.len() as u64);
    assert_eq!(
        runtime
            .document_bytes(project.clone(), documents[0].path.clone())
            .await
            .unwrap(),
        original
    );
    assert!(
        runtime
            .document_bytes(
                project.clone(),
                "memory/documents/../../project.json".into()
            )
            .await
            .is_err()
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            path.parent()
                .unwrap()
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("project.json"),
            path.parent().unwrap().join("linked.json"),
        )
        .unwrap();
        assert_eq!(runtime.documents(project.clone()).await.unwrap().len(), 1);
        assert!(
            runtime
                .document_bytes(project.clone(), "memory/documents/linked.json".into())
                .await
                .is_err()
        );
    }
    assert!(
        runtime
            .import_document(project.clone(), "reference.png".into(), vec![1])
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    for name in ["../project.json", "folder/file.txt", "..\\project.json"] {
        assert!(
            runtime
                .import_document(project.clone(), name.into(), vec![1])
                .await
                .is_err()
        );
    }
    assert!(
        runtime
            .import_document(
                uuid::Uuid::new_v4().to_string(),
                "missing.txt".into(),
                vec![1]
            )
            .await
            .is_err()
    );
}

#[tokio::test]
async fn standalone_automation_proposal_is_read_only_and_conflict_checked() {
    let profile = tempfile::tempdir().unwrap();
    let (project, _) = definition_files(profile.path(), "print('{}')");
    let runtime = runtime(profile.path());
    let id = uuid::Uuid::new_v4().to_string();
    let path = format!("automations/{id}/automation.json");
    let root = profile.path().join("projects").join(&project);
    let content = json!({"schema":"inferay.automation/1","id":id,"name":"Daily briefing",
        "trigger":{"kind":"calendar","timezone":"America/Chicago","days":[1,2,3,4,5,6,7],"times":["06:00"]},
        "overlap":"skip","execution":{"kind":"agent","provider":"codex","instructions":"Summarize recent work",
        "skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300},"may":[]}).to_string();
    let mut command = ProjectFileCommand::SaveDefinition {
        project_id: project, path: path.clone(), content, expected_hash: None,
    };
    runtime.preview_automation(&command).await.unwrap();
    assert!(!root.join(&path).exists(), "Preview must not write");
    assert!(runtime.command(command.clone(), false).await.is_err(), "Agent cannot bypass the card");
    let result = runtime.command(command.clone(), true).await.unwrap();
    assert!(runtime.preview_automation(&command).await.is_err(), "Create cannot replace an existing file");
    if let ProjectFileCommand::SaveDefinition { expected_hash, content, .. } = &mut command {
        *expected_hash = result["sourceHash"].as_str().map(str::to_owned);
        *content = content.replace("Daily briefing", "Updated briefing");
    }
    runtime.preview_automation(&command).await.unwrap();
    std::fs::write(root.join(&path), std::fs::read_to_string(root.join(&path)).unwrap().replace("Daily briefing", "Outside edit")).unwrap();
    assert!(runtime.preview_automation(&command).await.is_err(), "Outside edit must invalidate proposal");
    assert!(runtime.command(command, true).await.is_err(), "Approval click must recheck the hash");
    assert!(std::fs::read_to_string(root.join(path)).unwrap().contains("Outside edit"));
}

#[tokio::test]
async fn library_update_proposal_requires_user_save_and_revokes_approval() {
    let profile = tempfile::tempdir().unwrap();
    let (project, _) = definition_files(profile.path(), "print('{}')");
    let runtime = runtime(profile.path());
    let root = profile.path().join("projects").join(&project);
    let manifest: Value = serde_json::from_slice(&std::fs::read(root.join("plugins/report/plugin.json")).unwrap()).unwrap();
    let id = manifest["id"].as_str().unwrap().to_owned();
    let review = runtime.command(ProjectFileCommand::ReviewPlugin { id: id.clone() }, false).await.unwrap();
    runtime.command(ProjectFileCommand::ApprovePlugin {
        id: id.clone(), expected_inputs_hash: review["inputsHash"].as_str().unwrap().into(), enable: true,
    }, true).await.unwrap();
    let library = runtime.command(ProjectFileCommand::ReadPlugin { id: id.clone(), path: None }, false).await.unwrap();
    let command = ProjectFileCommand::UpdatePlugin {
        project_id: project.clone(), slug: "report".into(),
        expected_hash: library["sourceHash"].as_str().unwrap().into(),
        files: [("README.md".into(), "Reusable reporting tools.".into())].into_iter().collect(),
        remove: vec![],
    };
    runtime.preview_plugin(&command).await.unwrap();
    assert!(!root.join("plugins/report/README.md").exists());
    assert!(runtime.command(command.clone(), false).await.is_err());
    let result = runtime.command(command.clone(), true).await.unwrap();
    assert_eq!(result["id"], id);
    let catalog = runtime.catalog(Some(project), None).await.unwrap();
    assert!(catalog.catalog.plugins[0].approved_hash.is_none());
    assert!(!catalog.catalog.automations[0].enabled);
    assert!(runtime.preview_plugin(&command).await.is_err());
    assert!(runtime.command(command, true).await.is_err());
}

#[tokio::test]
async fn chat_library_acceptance_approval_run_and_outside_edit_share_one_owner() {
    use inferay_core::project_files::{
        ProjectProposalDecision, ProjectProposalRequest, ProjectProposalStatus,
    };
    use std::collections::BTreeMap;
    let profile = tempfile::tempdir().unwrap();
    let runtime = runtime(profile.path());
    let project = uuid::Uuid::new_v4().to_string();
    let plugin = uuid::Uuid::new_v4().to_string();
    let automation = uuid::Uuid::new_v4().to_string();
    runtime.command(ProjectFileCommand::SaveDefinition {
        project_id: project.clone(), path: "project.json".into(), expected_hash: None,
        content: json!({"schema":"inferay.project/1","id":project,"name":"Chat library","description":"","instructions":"","repositories":[]}).to_string(),
    }, true).await.unwrap();
    let command = ProjectFileCommand::CreatePlugin {
        project_id: project.clone(), slug: "report-kit".into(),
        files: BTreeMap::from([
            ("plugin.json".into(), json!({"schema":"inferay.plugin/1","id":plugin,"name":"Report kit","version":"1","description":"Reusable reporting tools","may":[]}).to_string()),
            ("tools/report/tool.json".into(), json!({"schema":"inferay.tool/1","id":uuid::Uuid::new_v4().to_string(),"name":"Report","program":"python3","entrypoint":"run.py","args":[],"timeoutSeconds":30,"inputSchema":{"type":"object"},"outputSchema":{"type":"object"}}).to_string()),
            ("tools/report/run.py".into(), "import json,os\nfrom pathlib import Path\n(Path(os.environ['INFERAY_RUN_OUTPUT'])/'report.md').write_text('Report from an accepted chat library')\nprint(json.dumps({'artifacts':['report.md']}))".into()),
            ("automations/report.json".into(), json!({"schema":"inferay.automation/1","id":automation,"name":"Daily report","trigger":{"kind":"interval","seconds":86400},"overlap":"skip","execution":{"kind":"tool","tool":"report","input":{}},"may":[]}).to_string()),
        ]),
    };
    runtime.preview_plugin(&command).await.unwrap();
    assert!(
        runtime
            .catalog(Some(project.clone()), None)
            .await
            .unwrap()
            .catalog
            .plugins
            .is_empty()
    );
    let request = ProjectProposalRequest {
        message_id: "chat:plugin-run".into(),
        command,
        decision: Some(ProjectProposalDecision::Save),
        edited_command: None,
    };
    let saved = runtime.proposal(request.clone()).await.unwrap();
    assert_eq!(saved.status, ProjectProposalStatus::Saved);
    assert_eq!(saved.entity_id.as_deref(), Some(plugin.as_str()));
    let run_command = ProjectFileCommand::RunAutomation {
        id: automation.clone(),
        request_id: "manual-report".into(),
    };
    let refused_id = runtime.command(run_command.clone(), true).await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let refused = completed(&runtime, &project, &refused_id).await;
    assert_eq!(
        refused.status, "failed",
        "Saving never authorizes execution"
    );
    assert!(refused.started_at.is_none());
    assert!(!Path::new(&refused.directory).exists());
    let review = runtime
        .command(
            ProjectFileCommand::ReviewPlugin { id: plugin.clone() },
            true,
        )
        .await
        .unwrap();
    runtime
        .command(
            ProjectFileCommand::ApprovePlugin {
                id: plugin,
                expected_inputs_hash: review["inputsHash"].as_str().unwrap().into(),
                enable: true,
            },
            true,
        )
        .await
        .unwrap();
    let id = runtime
        .command(
            ProjectFileCommand::RunAutomation {
                id: automation.clone(),
                request_id: "approved-report".into(),
            },
            true,
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    runtime.tick().await.unwrap();
    let run = completed(&runtime, &project, &id).await;
    assert_eq!(run.status, "succeeded", "{:?}", run.error);
    let workspace = runtime.catalog(Some(project.clone()), None).await.unwrap();
    assert!(workspace.catalog.automations[0].enabled);
    assert_eq!(
        std::fs::read_to_string(&workspace.history.artifacts[0].path).unwrap(),
        "Report from an accepted chat library"
    );
    let root = profile.path().join("projects").join(&project);
    std::fs::write(
        root.join("plugins/report-kit/tools/report/run.py"),
        "raise Exception('unapproved change')",
    )
    .unwrap();
    let changed = runtime.catalog(Some(project.clone()), None).await.unwrap();
    assert!(!changed.catalog.automations[0].enabled);
    assert!(changed.catalog.automations[0].inputs_changed);
    let blocked_id = runtime
        .command(
            ProjectFileCommand::RunAutomation {
                id: automation,
                request_id: "after-edit".into(),
            },
            true,
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let blocked = completed(&runtime, &project, &blocked_id).await;
    assert_eq!(blocked.status, "failed");
    assert!(blocked.started_at.is_none());
    assert!(
        changed
            .history
            .runs
            .iter()
            .any(|run| run.id == id && run.status == "succeeded")
    );

    assert_eq!(
        runtime.proposal(request).await.unwrap().status,
        ProjectProposalStatus::Saved
    );
    assert_eq!(
        std::fs::read_to_string(root.join("plugins/report-kit/tools/report/run.py")).unwrap(),
        "raise Exception('unapproved change')",
        "Reopening the accepted card never restores old files"
    );
}

#[tokio::test]
async fn cli_tools_use_literal_arguments_and_exit_status_with_durable_logs() {
    for fail in [false, true] {
        let profile = tempfile::tempdir().unwrap();
        let script = if fail {
            "import sys\nprint('partial output')\nprint('quality gate failed', file=sys.stderr)\nsys.exit(7)"
        } else {
            "import sys\nassert sys.stdin.read() == ''\nprint('|'.join(sys.argv[1:]))"
        };
        let (project, automation) = definition_files(profile.path(), script);
        let root = profile.path().join("projects").join(&project);
        let tool_path = root.join("plugins/report/tools/report/tool.json");
        let mut tool: Value = serde_json::from_slice(&std::fs::read(&tool_path).unwrap()).unwrap();
        tool["interface"] = json!("cli");
        tool["args"] = json!(["{entrypoint}", "--title", "{input.title}", "{input.count}"]);
        std::fs::write(&tool_path, tool.to_string()).unwrap();
        let automation_path = root.join("plugins/report/automations/report.json");
        let mut definition: Value =
            serde_json::from_slice(&std::fs::read(&automation_path).unwrap()).unwrap();
        definition["execution"]["input"] =
            json!({"title":"two words; $(touch unwanted)","count":3});
        std::fs::write(&automation_path, definition.to_string()).unwrap();
        let runtime = runtime(profile.path());
        let id = approved_run(&runtime, &automation, "cli").await;
        runtime.tick().await.unwrap();
        let run = completed(&runtime, &project, &id).await;
        assert!(!root.join("plugins/report/tools/report/unwanted").exists());
        let logs = Path::new(&run.directory).join("logs");
        if fail {
            assert_eq!(run.status, "failed");
            assert!(
                run.error
                    .as_deref()
                    .unwrap()
                    .contains("quality gate failed")
            );
            assert!(run.result.is_none());
            assert_eq!(
                std::fs::read_to_string(logs.join("stdout.txt")).unwrap(),
                "partial output\n"
            );
        } else {
            assert_eq!(run.status, "succeeded", "{:?}", run.error);
            let result = run.result.unwrap();
            assert_eq!(result["exitCode"], 0);
            assert_eq!(result["stdout"], "--title|two words; $(touch unwanted)|3\n");
            assert_eq!(result["stderr"], std::fs::read_to_string(logs.join("stderr.txt")).unwrap());
        }
    }
}

#[tokio::test]
async fn agent_tool_grants_execute_only_approved_library_inputs() {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(),
        "import json,sys,os\nfrom pathlib import Path\nx=json.load(sys.stdin)\nimport time\ntime.sleep(10 if x.get('slow') else 0)\n(Path(os.environ['INFERAY_RUN_OUTPUT'])/'report.md').write_text(x['text'])\nprint(json.dumps({'artifacts':['report.md']}))");
    let root = profile.path().join("projects").join(&project).canonicalize().unwrap();
    let read = |path: &str| -> Value { serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap() };
    let plugin = read("plugins/report/plugin.json")["id"].clone();
    let tool = read("plugins/report/tools/report/tool.json")["id"].clone();
    let path = root.join("plugins/report/automations/report.json");
    let mut definition = read("plugins/report/automations/report.json");
    definition["execution"] = json!({"kind":"agent","provider":"codex","instructions":"Use the report tool","tools":[{"pluginId":plugin,"toolId":tool,"required":true}],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":30});
    std::fs::remove_file(&path).unwrap();
    let standalone = root.join("automations").join(&automation);
    std::fs::create_dir_all(&standalone).unwrap();
    std::fs::write(standalone.join("automation.json"), definition.to_string()).unwrap();
    let runtime = runtime(profile.path());
    let run = approved_run(&runtime, &automation, "grants").await;
    let snapshot = {
        let mut store = runtime.store.lock().unwrap();
        crate::project_runs::claim_next(&mut store.db, profile.path(), &[]).unwrap().unwrap().2
    };
    let scope = crate::project_tools::ToolScope::new(runtime.clone(), &run, root.clone(), root.join("runs").join(&run), snapshot).unwrap();
    assert!(scope.verify_required().unwrap_err().to_string().contains("Report"));
    assert_eq!(scope.call(json!({"action":"list"})).await.unwrap()["tools"].as_array().unwrap().len(), 1);
    assert!(scope.call(json!({"action":"call","pluginId":plugin,"toolId":uuid::Uuid::new_v4().to_string(),"input":{}})).await.unwrap_err().to_string().contains("not granted"));
    let request = json!({"action":"call","pluginId":plugin,"toolId":tool,"input":{"text":"Recorded tool output"}});
    let result = scope.call(request.clone()).await.unwrap();
    let artifact = result["artifacts"][0].as_str().unwrap();
    assert_eq!(std::fs::read_to_string(root.join("runs").join(&run).join("output").join(artifact)).unwrap(), "Recorded tool output");
    assert_eq!(scope.artifacts().unwrap(), vec![artifact]);
    scope.verify_required().unwrap();
    let mut invalid = request.clone();
    invalid["input"] = json!({});
    assert!(scope.call(invalid).await.is_err());
    assert!(scope.verify_required().is_err(), "A previous success must not hide a failed check");
    scope.call(request.clone()).await.unwrap();
    scope.verify_required().unwrap();
    std::fs::write(root.join("plugins/report/README.md"), "Changed library instructions").unwrap();
    assert!(scope.call(request.clone()).await.is_err(), "An outside library edit must invalidate the grant");
    std::fs::remove_file(root.join("plugins/report/README.md")).unwrap();
    let running = scope.clone();
    let mut slow = request.clone();
    slow["input"]["slow"] = json!(true);
    let task = tokio::spawn(async move { running.call(slow).await });
    tokio::time::sleep(Duration::from_millis(200)).await;
    tokio::time::timeout(Duration::from_secs(5), scope.close()).await.unwrap();
    assert!(task.await.unwrap().is_err(), "Closing the agent must stop its helper");
    assert!(scope.call(request).await.unwrap_err().to_string().contains("closed"));
}

/// Opt-in native provider gate; uses an isolated profile and harmless write probes.
#[tokio::test]
#[ignore = "launches a real provider and consumes account usage"]
async fn real_claude_automation_uses_sandbox_and_records_a_run() {
    real_provider_sandbox("claude", Some("haiku")).await;
}

#[tokio::test]
#[ignore = "launches a real provider and consumes account usage"]
async fn real_codex_automation_uses_sandbox_and_records_a_run() {
    real_provider_sandbox("codex", None).await;
}

async fn real_provider_sandbox(provider: &str, model: Option<&str>) {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(), "print('{}')");
    let root = profile.path().join("projects").join(&project).canonicalize().unwrap();
    let path = root.join("plugins/report/automations/report.json");
    let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let outside = profile.path().canonicalize().unwrap().join("outside-probe.txt");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let network_probe = root.join("plugins/report/network_probe.py");
    std::fs::write(&network_probe, format!(r#"import errno, json, socket
from pathlib import Path
result = {{}}
# A numeric public destination avoids mistaking DNS failure for enforcement.
# Open a TCP connection only; send no application data.
for name, address in [("loopback", ("127.0.0.1", {port})), ("external", ("1.1.1.1", 443))]:
    outcome = {{"denied": False}}
    try:
        with socket.create_connection(address, timeout=3):
            pass
    except OSError as error:
        outcome = {{"denied": error.errno in (errno.EPERM, errno.EACCES), "errno": error.errno, "error": str(error)}}
    result[name] = outcome
Path("network-probe.json").write_text(json.dumps(result))
print("NETWORK_PROBE", json.dumps(result))
"#)).unwrap();
    definition["execution"] = json!({
        "kind":"agent","provider":provider,"model":model,"instructions":format!(
            "This is an authorized sandbox verification in a disposable project. Use your shell execution tool to run both probes: first write the literal text inside-ok into ./inside-probe.txt in your current directory. Then attempt to write outside-ok into {}. The second write should fail; do not bypass the sandbox or retry another way. Report both command outcomes. You must actually run the commands, not just describe them. Finally run python3 {} exactly once from your current directory. That script attempts a connection to a listening disposable loopback socket and a public numeric TCP destination, sends no application data, and records network-probe.json. Network access is not granted: report the refusal and do not bypass, rewrite the script, or fabricate the result file.", outside.display(), network_probe.display()),
        "tools":[],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":90
    });
    if provider == "codex" {
        definition["may"] = json!(["write_project_files"]);
        let plugin_path = root.join("plugins/report/plugin.json");
        let mut plugin: Value = serde_json::from_slice(&std::fs::read(&plugin_path).unwrap()).unwrap();
        plugin["may"] = json!(["write_project_files"]);
        std::fs::write(plugin_path, plugin.to_string()).unwrap();
    }
    std::fs::write(path, definition.to_string()).unwrap();
    let runtime = runtime(profile.path());
    let run = approved_run(&runtime, &automation, "real-provider-gate").await;
    runtime.tick().await.unwrap();
    let done = tokio::time::timeout(Duration::from_secs(110), async {
        loop {
            let catalog = runtime.catalog(Some(project.clone()), None).await.unwrap();
            let run = catalog.history.runs.into_iter().find(|candidate| candidate.id == run).unwrap();
            if !["queued", "running"].contains(&run.status.as_str()) { break run; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }).await.unwrap();
    let dir = root.join("runs").join(&run);
    let log = std::fs::read_to_string(dir.join("logs/agent.jsonl")).unwrap_or_default();
    assert_eq!(done.status, "succeeded", "{:?}\n{}", done.error, log);
    assert_eq!(std::fs::read_to_string(dir.join("output/inside-probe.txt")).unwrap().trim(), "inside-ok", "{}", log);
    assert!(!outside.exists(), "Provider wrote outside its approved boundary");
    let network: Value = serde_json::from_slice(&std::fs::read(dir.join("output/network-probe.json")).expect("Provider must execute the network probe")).unwrap();
    for destination in ["loopback", "external"] {
        assert_eq!(network[destination]["denied"], true, "{destination} network access was not refused by the sandbox (timeouts and unreachable routes do not count): {network}\n{log}");
    }
    assert!(matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock), "An undeclared network connection reached the listener");
    let refused = log.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()).any(|event| {
        event["type"] == "user" && event.pointer("/message/content").and_then(Value::as_array).is_some_and(|blocks| blocks.iter().any(|block| {
            let content = block["content"].to_string().to_ascii_lowercase();
            block["type"] == "tool_result" && (content.contains("operation not permitted") || content.contains("permission denied"))
        }))
    });
    if provider == "claude" { assert!(refused, "Missing tool-result evidence of refused shell write: {}", log); }
    else {
        let output: String = log.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()).filter(|event| event.pointer("/delta/type").and_then(Value::as_str) == Some("input_json_delta")).filter_map(|event| event.pointer("/delta/partial_json").and_then(Value::as_str).map(str::to_owned)).collect();
        let output = output.to_ascii_lowercase();
        assert!(refused || output.contains("operation not permitted") || output.contains("permission denied"), "Missing refused command output: {}", log);
    }
    assert!(dir.join("output/response.md").is_file());
    let store = runtime.store.lock().unwrap();
    let usage: String = store.db.query_row("SELECT payload FROM run_events WHERE run_id=? AND kind='provider_usage' ORDER BY sequence DESC LIMIT 1", [&run], |row| row.get(0)).expect("Real provider must report usage");
    let usage: Value = serde_json::from_str(&usage).unwrap();
    assert_eq!(usage["provider"], provider);
    let input = if provider == "codex" { usage.pointer("/usage/total/inputTokens") } else { usage.pointer("/usage/input_tokens") };
    assert!(input.and_then(Value::as_u64).is_some(), "Missing reported token totals: {usage}");
}

#[tokio::test]
#[ignore = "launches a real provider and consumes account usage"]
async fn real_claude_honors_git_commit_permission() {
    real_provider_git_permission("claude", Some("haiku"), false).await;
    real_provider_git_permission("claude", Some("haiku"), true).await;
}

#[tokio::test]
#[ignore = "launches a real provider and consumes account usage"]
async fn real_codex_refuses_git_mutation_without_commit() {
    real_provider_git_permission("codex", None, false).await;
}

async fn real_provider_git_permission(provider: &str, model: Option<&str>, commit: bool) {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(), "print('{}')");
    let root = profile.path().join("projects").join(&project).canonicalize().unwrap();
    let result = std::process::Command::new("git").args(["init", "-q"]).arg(&root).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    let probe = root.join("plugins/report/git_probe.py");
    std::fs::write(&probe, r#"import json, os, subprocess, sys
from pathlib import Path
repo = Path(sys.argv[1])
(repo / 'working-file.txt').write_text('ordinary edit allowed')
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
env['GIT_CONFIG_NOSYSTEM'] = '1'
env['GIT_CONFIG_GLOBAL'] = '/dev/null'
result = {}
for name, args in [('stage', ['add', 'working-file.txt']), ('commit', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'permission probe'])]:
    done = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, env=env, timeout=10)
    result[name] = {'code': done.returncode, 'stderr': done.stderr}
(repo / 'git-probe.json').write_text(json.dumps(result))
print(json.dumps(result))
"#).unwrap();
    let path = root.join("plugins/report/automations/report.json");
    let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let may = if commit { json!(["write_project_files", "commit"]) } else { json!(["write_project_files"]) };
    definition["may"] = may.clone();
    definition["execution"] = json!({
        "kind":"agent", "provider":provider, "model":model,
        "instructions":format!("Run python3 {} {} exactly once using your shell tool. This is an authorized permission probe in a disposable project. It edits one working file and attempts Git staging and an empty commit, recording actual command results as git-probe.json in the project root. Run the script unchanged, do not fabricate results or retry denied operations. Report the results briefly.", probe.display(), root.display()),
        "tools":[],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":90
    });
    std::fs::write(path, definition.to_string()).unwrap();
    let path = root.join("plugins/report/plugin.json");
    let mut plugin: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    plugin["may"] = may;
    std::fs::write(path, plugin.to_string()).unwrap();
    let runtime = runtime(profile.path());
    let id = approved_run(&runtime, &automation, "git-permission-gate").await;
    runtime.tick().await.unwrap();
    let done = tokio::time::timeout(Duration::from_secs(110), async {
        loop {
            let run = runtime.catalog(Some(project.clone()), None).await.unwrap().history.runs.into_iter().find(|run| run.id == id).unwrap();
            if !["queued", "running"].contains(&run.status.as_str()) { break run; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }).await.unwrap();
    let dir = root.join("runs").join(&id);
    let log = std::fs::read_to_string(dir.join("logs/agent.jsonl")).unwrap_or_default();
    assert_eq!(done.status, "succeeded", "{:?}\n{log}", done.error);
    assert_eq!(std::fs::read_to_string(root.join("working-file.txt")).unwrap(), "ordinary edit allowed");
    let result: Value = serde_json::from_slice(&std::fs::read(root.join("git-probe.json")).unwrap_or_else(|error| panic!("Provider must execute the Git probe: {error}\n{log}"))).unwrap();
    for operation in ["stage", "commit"] {
        if commit {
            assert_eq!(result[operation]["code"], 0, "Approved Git mutation failed: {result}\n{log}");
            continue;
        }
        assert_ne!(result[operation]["code"], 0, "Unapproved Git mutation: {result}\n{log}");
        let error = result[operation]["stderr"].as_str().unwrap().to_ascii_lowercase();
        assert!(error.contains("operation not permitted") || error.contains("permission denied"), "Git failed without permission evidence: {result}\n{log}");
    }
    assert_eq!(root.join(".git/index").exists(), commit, "Unexpected Git index state");
    assert_eq!(std::process::Command::new("git").arg("-C").arg(&root).args(["rev-parse", "--verify", "HEAD"]).output().unwrap().status.success(), commit, "Unexpected commit state");
}

#[tokio::test]
#[ignore = "launches a real provider and consumes account usage"]
async fn real_claude_calls_granted_library_tool() {
    real_provider_library_tool("claude", Some("haiku")).await;
}

#[tokio::test]
#[ignore = "launches a real provider and consumes account usage"]
async fn real_codex_calls_granted_library_tool() {
    real_provider_library_tool("codex", None).await;
}

async fn real_provider_library_tool(provider: &str, model: Option<&str>) {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(),
        "import json,sys,os\nfrom pathlib import Path\nx=json.load(sys.stdin)\n(Path(os.environ['INFERAY_RUN_OUTPUT'])/'report.md').write_text(x['text'])\nprint(json.dumps({'artifacts':['report.md']}))");
    let root = profile.path().join("projects").join(&project).canonicalize().unwrap();
    let read = |path: &str| -> Value { serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap() };
    let plugin = read("plugins/report/plugin.json")["id"].clone();
    let tool = read("plugins/report/tools/report/tool.json")["id"].clone();
    let path = root.join("plugins/report/automations/report.json");
    let mut definition = read("plugins/report/automations/report.json");
    let marker = format!("verified-library-call-{}", uuid::Uuid::new_v4());
    definition["execution"] = json!({
        "kind":"agent","provider":provider,"model":model,
        "instructions":format!("Use the inferay_tools capability to list the granted tools, then call the Report tool with input {{\"text\":\"{marker}\"}}. Use the actual tool, not a shell command or a description. Do not create any files yourself. Once the call succeeds, report its result briefly."),
        "tools":[{"pluginId":plugin,"toolId":tool}],"skills":[],"resources":[],"repositories":[],
        "workingDirectory":{"base":"project","path":"."},"timeoutSeconds":90
    });
    std::fs::write(path, definition.to_string()).unwrap();
    let runtime = runtime(profile.path());
    let id = approved_run(&runtime, &automation, "real-library-tool").await;
    runtime.tick().await.unwrap();
    let run = tokio::time::timeout(Duration::from_secs(110), async {
        loop {
            let catalog = runtime.catalog(Some(project.clone()), None).await.unwrap();
            let run = catalog.history.runs.into_iter().find(|run| run.id == id).unwrap();
            if !["queued", "running"].contains(&run.status.as_str()) { break run; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }).await.unwrap();
    let dir = root.join("runs").join(&id);
    let log = std::fs::read_to_string(dir.join("logs/agent.jsonl")).unwrap_or_default();
    assert_eq!(run.status, "succeeded", "{:?}\n{}", run.error, log);
    let output = dir.join("output/tools");
    let calls: Vec<_> = std::fs::read_dir(&output).expect(&log).map(|entry| entry.unwrap().path()).collect();
    assert_eq!(calls.len(), 1, "Expected exactly one real library execution: {log}");
    assert_eq!(std::fs::read_to_string(calls[0].join("report.md")).unwrap(), marker);
    let call = calls[0].file_name().unwrap();
    let input: Value = serde_json::from_slice(&std::fs::read(dir.join("inputs/tools").join(call).join("input.json")).unwrap()).unwrap();
    assert_eq!(input["text"], marker);
    assert!(dir.join("logs/tools").join(call).join("stdout.txt").is_file());
    assert!(dir.join("output/response.md").is_file());
    let catalog = runtime.catalog(Some(project.clone()), None).await.unwrap();
    let artifacts: Vec<_> = catalog.history.artifacts.iter().filter(|artifact| artifact.run_id == id).collect();
    assert!(artifacts.iter().any(|artifact| artifact.path.ends_with("report.md")), "Tool output missing from run history");
    assert!(artifacts.iter().any(|artifact| artifact.path.ends_with("response.md")), "Agent response missing from run history");
}

#[tokio::test]
async fn missing_library_requirements_block_direct_and_agent_runs_before_execution() {
    for agent in [false, true] {
        let profile = tempfile::tempdir().unwrap();
        let (project, automation) = definition_files(profile.path(), "raise Exception('must not execute')");
        let root = profile.path().join("projects").join(&project);
        let read = |path: &str| -> Value { serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap() };
        let mut plugin = read("plugins/report/plugin.json");
        plugin["requires"] = json!(["inferay_missing_library_dependency_90374"]);
        std::fs::write(root.join("plugins/report/plugin.json"), plugin.to_string()).unwrap();
        if agent {
            let tool = read("plugins/report/tools/report/tool.json");
            let mut definition = read("plugins/report/automations/report.json");
            definition["execution"] = json!({"kind":"agent","provider":"codex","instructions":"Must not start","tools":[{"pluginId":plugin["id"],"toolId":tool["id"]}],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":30});
            std::fs::remove_file(root.join("plugins/report/automations/report.json")).unwrap();
            std::fs::create_dir_all(root.join("automations").join(&automation)).unwrap();
            std::fs::write(root.join("automations").join(&automation).join("automation.json"), definition.to_string()).unwrap();
        }
        let runtime = runtime(profile.path());
        let id = approved_run(&runtime, &automation, "missing-dependency").await;
        runtime.tick().await.unwrap();
        let run = completed(&runtime, &project, &id).await;
        assert_eq!(run.status, "failed");
        assert!(run.error.as_deref().unwrap().contains("inferay_missing_library_dependency_90374"));
        assert_eq!(run.snapshot["requirements"], json!(["inferay_missing_library_dependency_90374"]));
        let logs = Path::new(&run.directory).join("logs");
        assert!(!logs.join("agent.jsonl").exists());
        assert!(!logs.join("stdout.txt").exists());
    }
}

#[tokio::test]
async fn repository_tool_executes_in_place_and_dirty_checkout_revokes_approval() {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(), "print('{}')");
    let root = profile.path().join("projects").join(&project);
    let checkout = tempfile::tempdir().unwrap();
    let script = "import json,os\nfrom pathlib import Path\n(Path(os.environ['INFERAY_RUN_OUTPUT'])/'report.md').write_text(str(Path.cwd()))\nprint(json.dumps({'artifacts':['report.md']}))\n";
    std::fs::write(checkout.path().join("report.py"), script).unwrap();
    let git = |args: &[&str]| { let result = std::process::Command::new("git").arg("-C").arg(checkout.path()).args(args).output().unwrap(); assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr)); String::from_utf8(result.stdout).unwrap().trim().to_owned() };
    git(&["init", "-q"]); git(&["add", "report.py"]);
    git(&["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "-qm", "fixture"]);
    let revision = git(&["rev-parse", "HEAD"]);
    let repository = uuid::Uuid::new_v4().to_string();
    let mut definition: Value = serde_json::from_slice(&std::fs::read(root.join("project.json")).unwrap()).unwrap();
    definition["repositories"] = json!([{"id":repository,"name":"Kit"}]);
    std::fs::write(root.join("project.json"), definition.to_string()).unwrap();
    let path = root.join("plugins/report/tools/report/tool.json");
    let mut tool: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    tool["entrypoint"] = json!("report.py");
    tool["pack"] = json!({"repositoryId":repository,"commit":revision,"sha256":project_store::hash(script.as_bytes())});
    std::fs::write(path, tool.to_string()).unwrap();
    std::fs::remove_file(root.join("plugins/report/tools/report/run.py")).unwrap();
    let runtime = runtime(profile.path());
    runtime.command(ProjectFileCommand::LinkRepository { project_id:project.clone(),repository_id:repository,expected_project_hash:project_store::hash(&std::fs::read(root.join("project.json")).unwrap()),path:checkout.path().display().to_string() },true).await.unwrap();
    let id = approved_run(&runtime, &automation, "pack").await;
    runtime.tick().await.unwrap();
    let run = completed(&runtime, &project, &id).await;
    assert_eq!(run.status,"succeeded","{:?}",run.error);
    assert_eq!(std::fs::read_to_string(Path::new(&run.directory).join("output/report.md")).unwrap(), checkout.path().canonicalize().unwrap().display().to_string());
    assert!(!root.join("plugins/report/tools/report/report.py").exists());
    std::fs::write(checkout.path().join("report.py"), "print('changed')").unwrap();
    let result = runtime.command(ProjectFileCommand::RunAutomation { id:automation,request_id:"changed-pack".into() },true).await.unwrap();
    let refused = completed(&runtime, &project, result["id"].as_str().unwrap()).await;
    assert_eq!(refused.status,"failed");
    assert!(refused.error.as_deref().unwrap().contains("clean checkout"));
}

fn clone_origin_kit() -> (tempfile::TempDir, String) {
    let source = std::env::var("INFERAY_ORIGIN_KIT_REPOSITORY").expect("Set INFERAY_ORIGIN_KIT_REPOSITORY");
    let checkout = tempfile::tempdir().unwrap();
    let clone = std::process::Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null", "clone", "--local", "--no-hardlinks", "--quiet", "--"])
        .arg(&source).arg(checkout.path()).output().unwrap();
    assert!(clone.status.success(), "{}", String::from_utf8_lossy(&clone.stderr));
    let revision = std::process::Command::new("git").arg("-C").arg(checkout.path())
        .args(["rev-parse", "HEAD"]).output().unwrap();
    assert!(revision.status.success());
    let revision = String::from_utf8(revision.stdout).unwrap().trim().to_owned();
    (checkout, revision)
}

/// Opt-in real kit check. Only a disposable clone/profile is changed.
#[tokio::test]
#[ignore = "Requires INFERAY_ORIGIN_KIT_REPOSITORY pointing to a local Origin checkout"]
async fn real_origin_copy_gate_runs_as_a_repository_tool() {
    let (checkout, revision) = clone_origin_kit();
    let entrypoint = "Plugins/design-blender/content/scripts/copy_check.py";
    let bytes = std::fs::read(checkout.path().join(entrypoint)).unwrap();
    eprintln!("Origin copy gate: commit {revision}, SHA-256 {}", project_store::hash(&bytes));
    for (key, text, passes) in [
        ("pass", "The Blender scene contains 3 objects. Each mesh uses the same blue material.", true),
        ("fail", "Unlock game-changing innovation and revolutionize your workflow!", false),
    ] {
        let profile = tempfile::tempdir().unwrap();
        let (project, automation) = definition_files(profile.path(), "unused");
        let root = profile.path().join("projects").join(&project);
        let repository = uuid::Uuid::new_v4().to_string();
        let path = root.join("project.json");
        let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        definition["repositories"] = json!([{"id":repository,"name":"Origin kit"}]);
        std::fs::write(&path, definition.to_string()).unwrap();
        let path = root.join("plugins/report/tools/report/tool.json");
        let mut tool: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        tool["name"] = json!("Caption quality gate");
        tool["interface"] = json!("cli");
        tool["entrypoint"] = json!(entrypoint);
        tool["requires"] = json!(["python3"]);
        tool["args"] = json!(["-B", "{entrypoint}", "--text", "{input.text}", "--platform", "instagram", "--cta-allowed", "no", "--json"]);
        tool["pack"] = json!({"repositoryId":repository,"commit":revision,"sha256":project_store::hash(&bytes)});
        std::fs::write(path, tool.to_string()).unwrap();
        std::fs::remove_file(root.join("plugins/report/tools/report/run.py")).unwrap();
        let path = root.join("plugins/report/automations/report.json");
        let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        definition["execution"]["input"] = json!({"text":text});
        std::fs::write(path, definition.to_string()).unwrap();
        let runtime = runtime(profile.path());
        runtime.command(ProjectFileCommand::LinkRepository {
            project_id: project.clone(), repository_id: repository,
            expected_project_hash: project_store::hash(&std::fs::read(root.join("project.json")).unwrap()),
            path: checkout.path().display().to_string(),
        }, true).await.unwrap();
        let id = approved_run(&runtime, &automation, key).await;
        runtime.tick().await.unwrap();
        let run = completed(&runtime, &project, &id).await;
        let stdout = std::fs::read_to_string(Path::new(&run.directory).join("logs/stdout.txt")).unwrap();
        assert_eq!(run.status, if passes {"succeeded"} else {"failed"}, "{:?}\n{stdout}", run.error);
        let report: Value = serde_json::from_str(&stdout).unwrap();
        assert_eq!(report["ok"], passes);
        if passes {
            assert_eq!(run.result.unwrap()["exitCode"], 0);
        } else {
            assert!(report["findings"].as_array().unwrap().iter().any(|finding| finding["level"] == "fail"));
            assert!(run.result.is_none());
        }
        assert!(!root.join("plugins/report/tools/report/copy_check.py").exists());
    }
    let status = std::process::Command::new("git").arg("-C").arg(checkout.path())
        .args(["status", "--porcelain", "--untracked-files=all", "--ignored=matching"]).output().unwrap();
    assert!(status.status.success());
    assert!(status.stdout.is_empty(), "The quality gate changed its source checkout");
}

#[tokio::test]
async fn cli_outputs_are_indexed_and_output_links_fail_the_run() {
    for symlink in [false, true] {
        let profile = tempfile::tempdir().unwrap();
        let script = if symlink {
            "import sys\nfrom pathlib import Path\np=Path(sys.argv[1]);p.mkdir();(p/'escape').symlink_to('/etc/hosts')\n"
        } else {
            "import sys\nfrom pathlib import Path\nassert sys.argv[2]=='{output}'\np=Path(sys.argv[1]);p.mkdir();(p/'report.md').write_text('actual output')\nprint('render complete')\n"
        };
        let (project, automation) = definition_files(profile.path(), script);
        let root = profile.path().join("projects").join(&project);
        let path = root.join("plugins/report/tools/report/tool.json");
        let mut tool: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        tool["interface"] = json!("cli");
        tool["args"] = json!(["{entrypoint}", "{output}/images", "{input.text}"]);
        std::fs::write(path, tool.to_string()).unwrap();
        let path = root.join("plugins/report/automations/report.json");
        let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        definition["execution"]["input"] = json!({"text":"{output}"});
        std::fs::write(path, definition.to_string()).unwrap();
        let runtime = runtime(profile.path());
        let id = approved_run(&runtime, &automation, "cli-output").await;
        runtime.tick().await.unwrap();
        let run = completed(&runtime, &project, &id).await;
        let catalog = runtime.catalog(Some(project), None).await.unwrap();
        let artifacts: Vec<_> = catalog.history.artifacts.iter().filter(|artifact| artifact.run_id == id).collect();
        if symlink {
            assert_eq!(run.status, "failed");
            assert!(run.error.unwrap().contains("regular files"));
            assert!(artifacts.is_empty());
        } else {
            assert_eq!(run.status, "succeeded", "{:?}", run.error);
            assert_eq!(artifacts.len(), 1);
            assert_eq!(artifacts[0].name, "images/report.md");
            assert_eq!(std::fs::read_to_string(Path::new(&run.directory).join("output/images/report.md")).unwrap(), "actual output");
        }
    }
}

#[tokio::test]
#[ignore = "Requires INFERAY_ORIGIN_KIT_REPOSITORY and Blender 5 on PATH"]
async fn real_origin_blender_render_retains_image_artifacts() {
    let (checkout, revision) = clone_origin_kit();
    let entrypoint = "Plugins/design-blender/content/scripts/crate_families/run.py";
    let bytes = std::fs::read(checkout.path().join(entrypoint)).unwrap();
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(), "unused");
    let root = profile.path().join("projects").join(&project);
    for path in ["plugins/report/plugin.json", "plugins/report/automations/report.json"] {
        let path = root.join(path);
        let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        definition["may"] = json!(["gpu"]);
        std::fs::write(path, definition.to_string()).unwrap();
    }
    let repository = uuid::Uuid::new_v4().to_string();
    let path = root.join("project.json");
    let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    definition["repositories"] = json!([{"id":repository,"name":"Origin kit"}]);
    std::fs::write(&path, definition.to_string()).unwrap();
    let path = root.join("plugins/report/tools/report/tool.json");
    let mut tool: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    tool["program"] = json!("blender");
    tool["interface"] = json!("cli");
    tool["entrypoint"] = json!(entrypoint);
    tool["requires"] = json!(["blender>=5.0"]);
    tool["timeoutSeconds"] = json!(180);
    tool["args"] = json!(["--factory-startup", "--background", "-noaudio", "--python-exit-code", "1", "--python", "{entrypoint}", "--", "--family", "pillar-stack", "--seed", "3", "--out", "{output}/proof", "--scale", "0.1", "--samples", "2"]);
    tool["pack"] = json!({"repositoryId":repository,"commit":revision,"sha256":project_store::hash(&bytes)});
    std::fs::write(path, tool.to_string()).unwrap();
    std::fs::remove_file(root.join("plugins/report/tools/report/run.py")).unwrap();
    let runtime = runtime(profile.path());
    runtime.command(ProjectFileCommand::LinkRepository {
        project_id: project.clone(), repository_id: repository,
        expected_project_hash: project_store::hash(&std::fs::read(root.join("project.json")).unwrap()),
        path: checkout.path().display().to_string(),
    }, true).await.unwrap();
    let id = approved_run(&runtime, &automation, "real-render").await;
    runtime.tick().await.unwrap();
    let run = tokio::time::timeout(Duration::from_secs(200), async {
        loop {
            let catalog = runtime.catalog(Some(project.clone()), None).await.unwrap();
            let run = catalog.history.runs.into_iter().find(|run| run.id == id).unwrap();
            if !["queued", "running"].contains(&run.status.as_str()) { break run; }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }).await.unwrap();
    for name in ["stdout.txt", "stderr.txt"] {
        let log = std::fs::read_to_string(Path::new(&run.directory).join("logs").join(name)).unwrap_or_default();
        eprintln!("{name}: {}", log.chars().rev().take(6000).collect::<String>().chars().rev().collect::<String>());
    }
    assert_eq!(run.status, "succeeded", "{:?}", run.error);
    let catalog = runtime.catalog(Some(project), None).await.unwrap();
    let artifacts: Vec<_> = catalog.history.artifacts.iter().filter(|artifact| artifact.run_id == id).collect();
    assert_eq!(artifacts.len(), 2);
    for name in ["proof_raw.png", "proof_raw_z.png"] {
        assert!(artifacts.iter().any(|artifact| artifact.name == name));
        let bytes = std::fs::read(Path::new(&run.directory).join("output").join(name)).unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 108);
        assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), 144);
        if let Some(directory) = std::env::var_os("INFERAY_PROOF_OUTPUT_DIR") {
            let directory = Path::new(&directory);
            std::fs::create_dir_all(directory).unwrap();
            std::fs::write(directory.join(name), &bytes).unwrap();
        }
    }
    // Recapturing the approved pack rejects dirty, untracked or ignored source files.
    runtime.command(ProjectFileCommand::ReviewAutomation { id: automation }, true).await.unwrap();
    eprintln!("Origin render verified at {revision}; two 108x144 PNG artifacts");
}

#[tokio::test]
#[ignore = "Runs real Codex and Blender with a disposable scheduled Origin studio project"]
async fn real_scheduled_studio_uses_library_skill_and_required_tools() {
    let (checkout, revision) = clone_origin_kit();
    assert_eq!(revision, "271fb05956913c730a5f496378406677e03f422f", "Use the fixture's pinned kit revision in the supplied checkout");
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/tests/fixtures/plugins/origin-studio");
    let profile = tempfile::tempdir().unwrap();
    let project = "4b3ed31d-1e35-55af-94af-2968a11bc10b";
    let automation = "f5b40ea3-3aea-5319-b295-dca7f110827b";
    let root = profile.path().join("projects").join(project);
    for entry in walkdir::WalkDir::new(&source) {
        let entry = entry.unwrap();
        let target = root.join(entry.path().strip_prefix(&source).unwrap());
        if entry.file_type().is_dir() { std::fs::create_dir_all(target).unwrap(); }
        else { std::fs::copy(entry.path(), target).unwrap(); }
    }
    let runtime = runtime(profile.path());
    runtime.command(ProjectFileCommand::LinkRepository {
        project_id: project.into(), repository_id: "ceb98bdc-9cb0-5d60-b4e5-b17026f15a20".into(),
        expected_project_hash: project_store::hash(&std::fs::read(root.join("project.json")).unwrap()),
        path: checkout.path().display().to_string(),
    }, true).await.unwrap();
    let review = runtime.command(ProjectFileCommand::ReviewAutomation { id:automation.into() }, true).await.unwrap();
    runtime.command(ProjectFileCommand::ApproveAutomation { id:automation.into(), expected_inputs_hash:review["inputsHash"].as_str().unwrap().into(), enable:true }, true).await.unwrap();
    // Advance this disposable schedule's due time, then use the real scheduler path.
    runtime.store.lock().unwrap().db.execute("UPDATE automation_state SET next_due_at=? WHERE automation_id=?", rusqlite::params![now()-1000,automation]).unwrap();
    runtime.tick().await.unwrap();
    let run = tokio::time::timeout(Duration::from_secs(270), async {
        loop {
            let catalog = runtime.catalog(Some(project.into()), None).await.unwrap();
            if let Some(run) = catalog.history.runs.into_iter().find(|run| run.automation_id == automation && !["queued","running"].contains(&run.status.as_str())) { break run; }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }).await.unwrap();
    let log = std::fs::read_to_string(Path::new(&run.directory).join("logs/agent.jsonl")).unwrap_or_default();
    assert_eq!(run.status, "succeeded", "{:?}\n{}", run.error, log.chars().rev().take(10000).collect::<String>().chars().rev().collect::<String>());
    assert!(run.snapshot["skills"].as_array().unwrap().iter().any(|skill| skill["name"] == "Procedural studio"));
    assert!(run.conversation_available);
    let catalog = runtime.catalog(Some(project.into()), None).await.unwrap();
    assert_eq!(catalog.history.runs.len(), 1, "One due occurrence should create one run");
    let artifacts: Vec<_> = catalog.history.artifacts.iter().filter(|artifact| artifact.run_id == run.id).collect();
    assert!(artifacts.iter().any(|artifact| artifact.name.ends_with("render_raw.png")));
    assert!(artifacts.iter().any(|artifact| artifact.name.ends_with("render_raw_z.png")));
    assert!(artifacts.iter().any(|artifact| artifact.name == "response.md"));
    runtime.command(ProjectFileCommand::ReviewAutomation { id:automation.into() }, true).await.unwrap();
    eprintln!("Scheduled studio run: {}\n{}", run.id, std::fs::read_to_string(Path::new(&run.directory).join("output/response.md")).unwrap());
}

#[tokio::test]
async fn history_projects_latest_reported_usage_without_guessing_missing_counts() {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(), "print('{}')");
    let runtime = runtime(profile.path());
    let id = approved_run(&runtime, &automation, "usage-history").await;
    assert!(runtime.run_for_chat(&id).unwrap().usage.is_none());
    {
        let store = runtime.store.lock().unwrap();
        store.db.execute("UPDATE runs SET status='failed',error='fixture interruption' WHERE id=?", [&id]).unwrap();
        for input in [10, 30] {
            event(&store.db, &id, "provider_usage", &json!({"provider":"codex","usage":{"total":{"inputTokens":input,"outputTokens":4,"cachedInputTokens":2}}})).unwrap();
        }
    }
    let history = runtime.catalog(Some(project), None).await.unwrap().history;
    let run = history.runs.iter().find(|run| run.id == id).unwrap();
    assert_eq!(run.status, "failed");
    let usage = run.usage.as_ref().unwrap();
    assert_eq!(usage.input_tokens, Some(30));
    assert_eq!(usage.output_tokens, Some(4));
    assert_eq!(usage.reported_cost_usd, None);
    assert_eq!(runtime.run_for_chat(&id).unwrap().usage.as_ref(), Some(usage));
}

#[tokio::test]
#[ignore = "launches a real provider and consumes account usage"]
async fn real_codex_usage_is_durable_before_cancellation() {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(), "print('{}')");
    let root = profile.path().join("projects").join(&project);
    let path = root.join("plugins/report/automations/report.json");
    let mut definition: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    definition["execution"] = json!({"kind":"agent","provider":"codex","instructions":"This is a disposable cancellation test. Execute exactly one shell command: sleep 30. Wait for it to finish before replying done. Do not substitute a shorter wait or perform any other task.","tools":[],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":90});
    std::fs::write(path, definition.to_string()).unwrap();
    let runtime = runtime(profile.path());
    let id = approved_run(&runtime, &automation, "live-usage").await;
    runtime.tick().await.unwrap();
    let observed = tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let run = runtime.run_for_chat(&id).unwrap();
            if run.usage.is_some() || !["queued", "running"].contains(&run.status.as_str()) { break run; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }).await;
    runtime.command(ProjectFileCommand::StopRun { id: id.clone() }, true).await.unwrap();
    let done = completed(&runtime, &project, &id).await;
    let observed = observed.expect("Provider did not report usage before timeout");
    assert_eq!(observed.status, "running", "Usage arrived only after the run finished");
    let usage = observed.usage.expect("No live usage");
    assert!(usage.input_tokens.is_some_and(|count| count > 0));
    assert_eq!(done.status, "cancelled");
    assert!(done.usage.as_ref().and_then(|usage| usage.input_tokens).is_some_and(|count| count >= usage.input_tokens.unwrap()));
    let db = rusqlite::Connection::open(profile.path().join("projects.sqlite3")).unwrap();
    let count: i64 = db.query_row("SELECT count(*) FROM run_events WHERE run_id=? AND kind='provider_usage'", [&id], |row| row.get(0)).unwrap();
    assert!(count > 0, "Usage must be committed, not just held in memory");
}

#[tokio::test]
async fn history_keeps_active_work_visible_without_changing_past_pagination() {
    let profile = tempfile::tempdir().unwrap();
    let (project, automation) = definition_files(profile.path(), "print('{}')");
    let runtime = runtime(profile.path());
    let id = approved_run(&runtime, &automation, "active-history").await;
    let store = runtime.store.lock().unwrap();
    store.db.execute("UPDATE runs SET status='running',requested_at=1 WHERE id=?", [&id]).unwrap();
    for index in 0..53 {
        store.db.execute(
            "INSERT INTO runs (id,project_id,automation_id,name,status,requested_at,snapshot,request_key,input_hash) SELECT ?1,project_id,automation_id,name,?2,?3,snapshot,?1,input_hash FROM runs WHERE id=?4",
            params![format!("history-{index:03}"), if index == 52 { "queued" } else { "succeeded" }, 100 + index, id],
        ).unwrap();
    }
    let latest = crate::project_runs::history(&store.db, profile.path(), &project, None).unwrap();
    assert_eq!(latest.runs.len(), 52); // Two active jobs plus fifty past results.
    assert!(latest.runs.iter().any(|run| run.id == id));
    assert!(latest.runs.iter().any(|run| run.status == "queued"));
    assert!(latest.has_more_runs);
    assert_eq!(latest.next_run_cursor.as_deref(), Some("102:history-002"));
    let older = crate::project_runs::history(&store.db, profile.path(), &project, latest.next_run_cursor.as_deref()).unwrap();
    assert_eq!(older.runs.iter().map(|run| run.id.as_str()).collect::<Vec<_>>(), vec!["history-001", "history-000"]);
    assert!(!older.has_more_runs);
    assert!(older.next_run_cursor.is_none());
}
