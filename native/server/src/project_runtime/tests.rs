use super::*;
use crate::project_store::{ProjectStore, prepare_run};
use serde_json::json;

fn command(store: &mut ProjectStore, value: Value) -> Value {
    store
        .command(serde_json::from_value(value).unwrap(), true, &[])
        .unwrap()
}
fn project(store: &mut ProjectStore) -> String {
    command(store,json!({"type":"saveProject","name":"Studio","description":"Local brand","instructions":"Be precise"}))["id"].as_str().unwrap().into()
}
fn example(store: &mut ProjectStore, project: &str) -> String {
    command(store, json!({"type":"createExample","projectId":project}))["id"]
        .as_str()
        .unwrap()
        .into()
}
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
async fn completed(runtime: &Arc<ProjectRuntime>, project: &str, id: &str) -> ProjectRun {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let catalog = runtime.catalog(Some(project.into()), None).await.unwrap();
            let run = catalog.runs.into_iter().find(|r| r.id == id).unwrap();
            if !["running", "queued"].contains(&run.status.as_str()) {
                break run;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn migrated_file_automation_executes_with_the_existing_runner_and_artifacts() {
    let root = tempfile::tempdir().unwrap();
    let runtime = runtime(root.path());
    let (project, run, snapshot) = {
        let mut store = runtime.store.lock().unwrap();
        let project = project(&mut store);
        let automation = example(&mut store, &project);
        crate::project_migration::export(&mut store.db, root.path(), &[]).unwrap();
        crate::project_migration::replace_definition_tables(&mut store.db).unwrap();
        crate::project_index::refresh(&mut store.db, root.path(), &[]).unwrap();
        let inputs =
            crate::project_index::execution_inputs(&store.db, root.path(), &automation, &[])
                .unwrap();
        crate::project_index::approve_automation(
            &store.db,
            root.path(),
            &automation,
            &project_store::hash(&serde_json::to_vec(&inputs).unwrap()),
            false,
            &[],
        )
        .unwrap();
        let run = crate::project_runs::prepare_file_run(
            &store.db,
            root.path(),
            &automation,
            "file-tool-run",
            None,
            None,
            &[],
        )
        .unwrap();
        let (claimed, owner, snapshot) =
            crate::project_runs::claim_next(&mut store.db, root.path(), &[])
                .unwrap()
                .unwrap();
        assert_eq!(claimed, run);
        assert_eq!(owner, project);
        (project, run, snapshot)
    };
    let output = runtime.execute(&run, &project, &snapshot).await;
    assert!(output.is_ok(), "{output:?}");
    runtime.finish(&run, &project, output).unwrap();
    let store = runtime.store.lock().unwrap();
    assert_eq!(
        store
            .db
            .query_row("SELECT status FROM runs WHERE id=?", [&run], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "succeeded"
    );
    let path: String = store
        .db
        .query_row("SELECT path FROM artifacts WHERE run_id=?", [&run], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(
        std::fs::read_to_string(path)
            .unwrap()
            .contains("durable run")
    );
}
#[test]
fn project_revisions_profile_lease_and_recovery_preserve_records() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    assert!(ProjectStore::open(root.path()).is_err());
    let id = project(&mut store);
    let edit = json!({"type":"saveProject","id":id,"expectedRevision":1,"name":"Updated","description":"","instructions":""});
    command(&mut store, edit.clone());
    assert!(
        store
            .command(serde_json::from_value(edit).unwrap(), true, &[])
            .is_err()
    );
    let automation = example(&mut store, &id);
    let run = prepare_run(
        &store.db,
        &store.root,
        &automation,
        "request-1",
        None,
        None,
        &[],
    )
    .unwrap();
    assert_eq!(
        run,
        prepare_run(
            &store.db,
            &store.root,
            &automation,
            "request-1",
            None,
            None,
            &[]
        )
        .unwrap()
    );
    store
        .db
        .execute("UPDATE runs SET status='running' WHERE id=?", [&run])
        .unwrap();
    drop(store);
    let store = ProjectStore::open(root.path()).unwrap();
    let catalog = store.catalog(Some(&id), None).unwrap();
    assert_eq!(catalog.projects[0].name, "Updated");
    assert_eq!(catalog.runs[0].status, "interrupted");
}
#[test]
fn schedule_consent_detects_changed_files_and_occurrences_deduplicate() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let id = project(&mut store);
    let automation = example(&mut store, &id);
    command(
        &mut store,
        json!({"type":"enableAutomation","id":automation,"expectedRevision":1,"enabled":true}),
    );
    let first = prepare_run(
        &store.db,
        &store.root,
        &automation,
        "tick-1",
        Some(1),
        None,
        &[],
    )
    .unwrap();
    assert_eq!(
        first,
        prepare_run(
            &store.db,
            &store.root,
            &automation,
            "tick-1",
            Some(1),
            None,
            &[]
        )
        .unwrap()
    );
    prepare_run(
        &store.db,
        &store.root,
        &automation,
        "tick-2",
        Some(2),
        None,
        &[],
    )
    .unwrap();
    let catalog = store.catalog(Some(&id), None).unwrap();
    assert!(catalog.runs.iter().any(|r| r.status == "skipped"));
    let path = catalog.runs[0].snapshot["entrypoint"].as_str().unwrap();
    std::fs::write(path, "print('{}')").unwrap();
    let next = prepare_run(
        &store.db,
        &store.root,
        &automation,
        "tick-3",
        Some(3),
        None,
        &[],
    )
    .unwrap();
    let catalog = store.catalog(Some(&id), None).unwrap();
    assert!(!catalog.automations[0].enabled);
    assert_eq!(
        catalog.runs.iter().find(|r| r.id == next).unwrap().status,
        "failed"
    );
    let manual = command(
        &mut store,
        json!({"type":"runAutomation","id":automation,"requestId":"manual-after-edit"}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let catalog = store.catalog(Some(&id), None).unwrap();
    let refused = catalog.runs.iter().find(|r| r.id == manual).unwrap();
    assert_eq!(refused.status, "failed");
    assert!(refused.error.as_deref().unwrap().contains("approval"));
    let revision = catalog.automations[0].revision;
    command(
        &mut store,
        json!({"type":"enableAutomation","id":automation,"expectedRevision":revision,"enabled":true}),
    );
    let accepted = command(
        &mut store,
        json!({"type":"runAutomation","id":automation,"requestId":"manual-after-review"}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        store
            .catalog(Some(&id), None)
            .unwrap()
            .runs
            .iter()
            .find(|r| r.id == accepted)
            .unwrap()
            .status,
        "queued"
    );
}
#[test]
fn agents_cannot_enable_execution_or_bypass_skill_approval() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let id = project(&mut store);
    let automation = example(&mut store, &id);
    for value in [
        json!({"type":"runAutomation","id":automation,"requestId":"x"}),
        json!({"type":"enableAutomation","id":automation,"expectedRevision":1,"enabled":true}),
        json!({"type":"saveResource","projectId":id,"typeId":"inferay.skill","name":"Skill","body":{"instructions":"Run"}}),
    ] {
        assert!(
            store
                .command(serde_json::from_value(value).unwrap(), false, &[])
                .is_err()
        );
    }
}
#[test]
fn typed_resources_reject_cross_project_brands_and_preserve_archived_revisions() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let first = project(&mut store);
    let second = project(&mut store);
    let brand=command(&mut store,json!({"type":"saveResource","projectId":first,"typeId":"brand.brand","name":"Brand","body":{}}))["id"].as_str().unwrap().to_string();
    assert!(store.command(serde_json::from_value(json!({"type":"saveResource","projectId":second,"typeId":"brand.mind","name":"Mind","body":{"brandId":brand}})).unwrap(),true,&[]).is_err());
    command(
        &mut store,
        json!({"type":"archiveResource","id":brand,"expectedRevision":1}),
    );
    let archived = store
        .catalog(Some(&first), None)
        .unwrap()
        .resources
        .remove(0);
    assert!(archived.archived);
    assert_eq!(archived.revision, 1);
}
#[tokio::test]
async fn real_tool_creates_artifact_with_captured_inputs_and_bounded_history() {
    let root = tempfile::tempdir().unwrap();
    let runtime = runtime(root.path());
    let (project, automation) = {
        let mut store = runtime.store.lock().unwrap();
        let id = project(&mut store);
        let a = example(&mut store, &id);
        (id, a)
    };
    let run = runtime
        .command(
            ProjectCommand::RunAutomation {
                id: automation,
                request_id: "manual-1".into(),
            },
            true,
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    runtime.tick().await.unwrap();
    let completed = completed(&runtime, &project, &run).await;
    assert_eq!(completed.status, "succeeded", "{:?}", completed.error);
    let catalog = runtime.catalog(Some(project), None).await.unwrap();
    assert_eq!(catalog.artifacts.len(), 1);
    assert!(
        std::fs::read_to_string(&catalog.artifacts[0].path)
            .unwrap()
            .contains("durable run")
    );
    assert!(
        Path::new(&completed.directory)
            .join("inputs/run.json")
            .exists()
    );
}
#[tokio::test]
async fn cancellation_kills_tool_and_releases_admission() {
    let root = tempfile::tempdir().unwrap();
    let runtime = runtime(root.path());
    let (project, automation) = {
        let mut store = runtime.store.lock().unwrap();
        let id = project(&mut store);
        let a = example(&mut store, &id);
        let catalog = store.catalog(Some(&id), None).unwrap();
        let tool: LocalTool = serde_json::from_value(catalog.resources[0].body.clone()).unwrap();
        let path = resolve_path(&store.project_dir(&id).unwrap(), &tool.entrypoint).unwrap();
        std::fs::write(path, "import time\ntime.sleep(60)\nprint('{}')").unwrap();
        (id, a)
    };
    let run = runtime
        .command(
            ProjectCommand::RunAutomation {
                id: automation,
                request_id: "cancel".into(),
            },
            true,
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    runtime.tick().await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    runtime
        .command(ProjectCommand::StopRun { id: run.clone() }, true)
        .await
        .unwrap();
    assert_eq!(
        completed(&runtime, &project, &run).await.status,
        "cancelled"
    );
    assert_eq!(runtime.capacity.available_permits(), 4);
}
#[tokio::test]
async fn bad_artifact_does_not_partially_commit_outputs_or_claim_success() {
    let root = tempfile::tempdir().unwrap();
    let runtime = runtime(root.path());
    let (project, automation) = {
        let mut store = runtime.store.lock().unwrap();
        let id = project(&mut store);
        let a = example(&mut store, &id);
        let tool: LocalTool = serde_json::from_value(
            store.catalog(Some(&id), None).unwrap().resources[0]
                .body
                .clone(),
        )
        .unwrap();
        let path = resolve_path(&store.project_dir(&id).unwrap(), &tool.entrypoint).unwrap();
        std::fs::write(path,"import json,os,pathlib\npathlib.Path(os.environ['INFERAY_RUN_OUTPUT'],'ok.txt').write_text('ok')\nprint(json.dumps({'artifacts':['ok.txt','../escape']}))").unwrap();
        (id, a)
    };
    let run = runtime
        .command(
            ProjectCommand::RunAutomation {
                id: automation,
                request_id: "bad-artifact".into(),
            },
            true,
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    runtime.tick().await.unwrap();
    assert_eq!(completed(&runtime, &project, &run).await.status, "failed");
    assert!(
        runtime
            .catalog(Some(project), None)
            .await
            .unwrap()
            .artifacts
            .is_empty()
    );
}
#[test]
fn skill_migration_preserves_ids_revisions_and_approval_flow() {
    let root = tempfile::tempdir().unwrap();
    let local = root.path().join("prompts.json");
    let body = json!([{"_id":"existing","name":"Existing","command":"existing","description":"","promptTemplate":"Do work","isBuiltIn":false,"createdAt":1,"updatedAt":2}]);
    std::fs::write(&local, body.to_string()).unwrap();
    let store = PromptStore::new(root.path().join("bundled.json"), local.clone());
    store.migrate().unwrap();
    store.migrate().unwrap();
    assert_eq!(store.load().unwrap()[0].id, "existing");
    assert_eq!(std::fs::read_to_string(&local).unwrap(), body.to_string());
    store
        .update(
            "existing",
            json!({"name":"Renamed","promptTemplate":"New instructions"})
                .as_object()
                .unwrap(),
            3,
        )
        .unwrap();
    assert_eq!(store.load().unwrap()[0].updated_at, 3);
    assert_eq!(std::fs::read_to_string(&local).unwrap(), body.to_string());
    store.delete("existing").unwrap();
    assert!(store.load().unwrap().is_empty());
}
#[test]
fn plugin_types_validate_data_and_disable_without_deleting() {
    let root = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let project = project(&mut store);
    std::fs::write(source.path().join("plugin.json"),json!({"name":"Briefs","version":"1","types":[{"id":"studio.brief","version":1,"schema":{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}}],"resources":[{"typeId":"studio.brief","name":"Launch","body":{"title":"Hello"}}]}).to_string()).unwrap();
    let plugin = command(
        &mut store,
        json!({"type":"installPlugin","projectId":project,"path":source.path()}),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let resource = store.catalog(Some(&project), None).unwrap().resources[0]
        .id
        .clone();
    assert!(project_store::resource(&store.db, &resource, &project).is_err());
    command(
        &mut store,
        json!({"type":"enablePlugin","id":plugin,"enabled":true}),
    );
    assert!(project_store::resource(&store.db, &resource, &project).is_ok());
    command(
        &mut store,
        json!({"type":"enablePlugin","id":plugin,"enabled":false}),
    );
    assert_eq!(
        store.catalog(Some(&project), None).unwrap().resources.len(),
        1
    );
}
#[test]
fn cursor_does_not_lose_runs_with_identical_timestamps() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let id = project(&mut store);
    let a = example(&mut store, &id);
    for n in 0..55 {
        prepare_run(
            &store.db,
            &store.root,
            &a,
            &format!("request-{n}"),
            None,
            None,
            &[],
        )
        .unwrap();
    }
    store
        .db
        .execute("UPDATE runs SET requested_at=123", [])
        .unwrap();
    let first = store.catalog(Some(&id), None).unwrap();
    assert_eq!(first.runs.len(), 50);
    let second = store
        .catalog(Some(&id), first.next_run_cursor.as_deref())
        .unwrap();
    assert_eq!(second.runs.len(), 5);
    assert!(
        second
            .runs
            .iter()
            .all(|r| !first.runs.iter().any(|f| f.id == r.id))
    );
}

#[test]
fn project_repository_selection_is_atomic_and_keeps_files_and_chats() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let first = root.path().join("api");
    let second = root.path().join("web");
    std::fs::create_dir_all(&first).unwrap();
    std::fs::create_dir_all(&second).unwrap();
    let saved = command(
        &mut store,
        json!({"type":"saveProject","name":"Aivre","description":"","instructions":"","repositoryPaths":[first,second]}),
    );
    let id = saved["id"].as_str().unwrap();
    command(
        &mut store,
        json!({"type":"associateConversation","projectId":id,"paneId":"project-chat"}),
    );
    let bad = json!({"type":"saveProject","id":id,"expectedRevision":1,"name":"Wrong","description":"","instructions":"","repositoryPaths":["relative"]});
    assert!(
        store
            .command(serde_json::from_value(bad).unwrap(), true, &[])
            .is_err()
    );
    assert_eq!(
        store
            .db
            .query_row("SELECT name FROM projects WHERE id=?", [id], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "Aivre"
    );
    command(
        &mut store,
        json!({"type":"saveProject","id":id,"expectedRevision":1,"name":"Aivre","description":"","instructions":"","repositoryPaths":[second]}),
    );
    assert_eq!(store.db.query_row("SELECT count(*) FROM resources WHERE project_id=? AND type_id='inferay.repository' AND archived=0",[id],|r|r.get::<_,i64>(0)).unwrap(), 1);
    assert_eq!(
        store
            .db
            .query_row(
                "SELECT project_id FROM project_conversations WHERE pane_id='project-chat'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        id
    );
    assert!(first.is_dir() && second.is_dir());
    drop(store);
    let rt = runtime(root.path());
    let (_, context, directory) = rt.context("project-chat", root.path()).unwrap().unwrap();
    assert!(context.contains(second.to_str().unwrap()));
    assert!(!context.contains(first.to_str().unwrap()));
    assert!(directory.ends_with(id));
}

#[test]
fn automation_preview_validates_without_saving_and_accepts_four_hours() {
    let root = std::env::temp_dir().join(format!("inferay-preview-{}", uuid::Uuid::new_v4()));
    let mut store = ProjectStore::open(&root).unwrap();
    let project_id = project(&mut store);
    let definition = json!({"type":"saveAutomation","id":"preview-four-hours","projectId":project_id,"name":"Daily research","execution":{"kind":"agent","instructions":"Research the project","provider":"codex","timeoutSeconds":14400},"intervalSeconds":86400,"overlapPolicy":"skip"});
    store
        .preview_automation(serde_json::from_value(definition.clone()).unwrap())
        .unwrap();
    assert!(
        store
            .catalog(Some(&project_id), None)
            .unwrap()
            .automations
            .is_empty()
    );
    let mut invalid = definition.clone();
    invalid["execution"]["timeoutSeconds"] = json!(86401);
    assert!(
        store
            .preview_automation(serde_json::from_value(invalid).unwrap())
            .is_err()
    );
    assert!(
        store
            .catalog(Some(&project_id), None)
            .unwrap()
            .automations
            .is_empty()
    );
    command(&mut store, definition);
    assert_eq!(
        store
            .catalog(Some(&project_id), None)
            .unwrap()
            .automations
            .len(),
        1
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn saving_enabled_automation_preserves_approval_and_disables_schedule() {
    let root = tempfile::tempdir().unwrap();
    let mut store = ProjectStore::open(root.path()).unwrap();
    let project = project(&mut store);
    let id = example(&mut store, &project);
    command(
        &mut store,
        json!({"type":"enableAutomation","id":id,"expectedRevision":1,"enabled":true}),
    );
    let approval = |store: &ProjectStore| {
        store
            .db
            .query_row(
                "SELECT snapshot_hash,approved_at FROM automation_approvals WHERE automation_id=?",
                [&id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .unwrap()
    };
    let before = approval(&store);
    let automation = store
        .catalog(Some(&project), None)
        .unwrap()
        .automations
        .remove(0);
    command(
        &mut store,
        json!({"type":"saveAutomation","id":id,"projectId":project,"expectedRevision":automation.revision,"name":"Changed report","execution":automation.execution,"intervalSeconds":86400,"overlapPolicy":"skip"}),
    );
    let saved = store
        .catalog(Some(&project), None)
        .unwrap()
        .automations
        .remove(0);
    assert!(!saved.enabled);
    assert!(saved.next_due_at.is_none());
    assert!(saved.inputs_changed);
    assert_eq!(approval(&store), before);
    command(
        &mut store,
        json!({"type":"enableAutomation","id":id,"expectedRevision":saved.revision,"enabled":true}),
    );
    assert!(store.catalog(Some(&project), None).unwrap().automations[0].enabled);
}

#[test]
fn managed_file_writes_require_current_hash_and_preserve_conflicts() {
    use crate::project_store::{hash, write_file};
    let root = tempfile::tempdir().unwrap();
    let path = "files/note.md";
    write_file(root.path(), path, "original", None).unwrap();
    assert!(write_file(root.path(), path, "overwrite", None).is_err());
    assert!(write_file(root.path(), path, "overwrite", Some("original")).is_err());
    write_file(root.path(), path, "updated", Some(&hash(b"original"))).unwrap();
    assert!(write_file(root.path(), path, "stale", Some(&hash(b"original"))).is_err());
    assert_eq!(
        std::fs::read_to_string(root.path().join(path)).unwrap(),
        "updated"
    );
    assert!(write_file(root.path(), "files/missing.md", "new", Some(&hash(b""))).is_err());
    assert!(!root.path().join("files/missing.md").exists());
    assert!(write_file(root.path(), "files/../../escape", "bad", None).is_err());
}

#[cfg(unix)]
#[test]
fn managed_file_writes_refuse_symlink_files_and_directories() {
    use crate::project_store::write_file;
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("note.md"), "untouched").unwrap();
    std::fs::create_dir(root.path().join("files")).unwrap();
    symlink(outside.path(), root.path().join("files/linked")).unwrap();
    symlink(
        outside.path().join("note.md"),
        root.path().join("files/note.md"),
    )
    .unwrap();
    assert!(write_file(root.path(), "files/linked/new.md", "bad", None).is_err());
    assert!(write_file(root.path(), "files/note.md", "bad", None).is_err());
    assert_eq!(
        std::fs::read_to_string(outside.path().join("note.md")).unwrap(),
        "untouched"
    );
    assert!(!outside.path().join("new.md").exists());
}
