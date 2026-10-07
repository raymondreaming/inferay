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
