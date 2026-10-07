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
            assert_eq!(result["stderr"], "");
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
    definition["execution"] = json!({"kind":"agent","provider":"codex","instructions":"Use the report tool","tools":[{"pluginId":plugin,"toolId":tool}],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":30});
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
    assert_eq!(scope.call(json!({"action":"list"})).await.unwrap()["tools"].as_array().unwrap().len(), 1);
    assert!(scope.call(json!({"action":"call","pluginId":plugin,"toolId":uuid::Uuid::new_v4().to_string(),"input":{}})).await.unwrap_err().to_string().contains("not granted"));
    let request = json!({"action":"call","pluginId":plugin,"toolId":tool,"input":{"text":"Recorded tool output"}});
    let result = scope.call(request.clone()).await.unwrap();
    let artifact = result["artifacts"][0].as_str().unwrap();
    assert_eq!(std::fs::read_to_string(root.join("runs").join(&run).join("output").join(artifact)).unwrap(), "Recorded tool output");
    assert_eq!(scope.artifacts().unwrap(), vec![artifact]);
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
