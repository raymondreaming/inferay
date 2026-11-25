use super::*;
use crate::backend::RUNTIME;
use crate::task::testing::{run_until, run_until_idle, runtime, serial};

fn connected(profile: &std::path::Path) -> Arc<Backend> {
    RUNTIME
        .block_on(Backend::connect(profile.to_owned()))
        .unwrap()
}

fn with_backend(view: &mut Workspace, backend: Arc<Backend>) {
    view.backend = Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
}

#[test]
fn closing_chat_removes_saved_pane_and_keeps_other_indices() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let mut workspace = AgentWorkspace::new("codex");
    let first = workspace.selected_pane_id().unwrap().to_owned();
    workspace
        .apply_action(
            &AgentWorkspaceAction::AddPane {
                group_id: None,
                agent_kind: None,
                cwd: None,
                reference_paths: None,
            },
            "codex",
        )
        .unwrap();
    let second = workspace.selected_pane_id().unwrap().to_owned();
    std::fs::write(
        profile.path().join("agent-state.json"),
        serde_json::to_vec(&workspace).unwrap(),
    )
    .unwrap();
    let backend = connected(profile.path());
    let services = backend.clone();
    let mut view = Workspace::empty();
    view.profile = profile.path().to_owned();
    with_backend(&mut view, backend);
    view.conversations[0].pane = Some(first.clone());
    let mut other = Workspace::empty().conversations.pop().unwrap();
    other.pane = Some(second.clone());
    view.conversations.push(other);
    let mut rt = runtime(view);
    rt.update(|view, _| {
        view.conversations[1].input.set_content("keep draft");
        view.close_chat(0);
    });
    run_until(&mut rt, |view| {
        view.conversations[0].closed || view.conversations[0].error.is_some()
    });
    let view = &rt.state;
    assert!(
        view.conversations[0].closed,
        "{:?}",
        view.conversations[0].error
    );
    assert!(view.conversations[0].live_task.is_none());
    assert!(!view.conversations[1].closed);
    assert_eq!(view.conversations[1].pane.as_deref(), Some(second.as_str()));
    assert_eq!(view.conversations[1].input.content(), "keep draft");
    let state = RUNTIME
        .block_on(services.request(Method::GET, "/api/agent/state", None))
        .unwrap();
    let saved: AgentWorkspace = serde_json::from_value(state).unwrap();
    assert!(saved.pane(&first).is_none());
    assert!(saved.pane(&second).is_some());
}

#[test]
fn closing_last_chat_selects_a_new_draft() {
    let _serial = serial();
    let mut view = Workspace::empty();
    view.finish_close_chat(0, None);
    assert!(view.conversations[0].closed);
    assert_eq!(view.selected, 1);
    assert_eq!(view.projects[0].selected, 1);
    let replacement = &mut view.conversations[1];
    assert!(!replacement.closed);
    assert!(replacement.loading);
    assert!(replacement.input.content().is_empty());
    replacement.task = None;
    view.preference_task = None;
}

#[test]
fn latest_selection_is_saved_through_workspace_services() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let workspace = AgentWorkspace::new("codex");
    let serialized = serde_json::to_value(&workspace).unwrap();
    let pane = serialized["groups"][0]["panes"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    std::fs::write(
        profile.path().join("agent-state.json"),
        serialized.to_string(),
    )
    .unwrap();
    let backend = connected(profile.path());
    let services = backend.clone();
    let mut view = Workspace::empty();
    with_backend(&mut view, backend);
    view.conversations[0].pane = Some(pane.clone());
    view.projects[0].id = Some("first".into());
    view.persist_workspace_preferences(None);
    view.projects[0].id = Some("latest".into());
    view.sidebar = false;
    view.sidebar_width = 280.;
    view.closed_projects.insert("closed-project".into());
    view.repository_graph_preferences
        .insert("/first".into(), json!({"widths":{"refs":420}}));
    view.repository_graph_preferences
        .insert("/second".into(), json!({"widths":{"refs":180}}));
    view.persist_workspace_preferences(None);
    let mut rt = runtime(view);
    let wait = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        run_until_idle(&mut rt);
        let storage = RUNTIME
            .block_on(services.request(Method::GET, "/api/client-storage", None))
            .unwrap();
        if storage["entries"]["inferay-selected-project-id"] == "latest"
            || std::time::Instant::now() > wait
        {
            break;
        }
    }
    let state = RUNTIME
        .block_on(services.request(Method::GET, "/api/agent/state", None))
        .unwrap();
    let saved: AgentWorkspace = serde_json::from_value(state).unwrap();
    assert_eq!(saved.selected_pane_id(), Some(pane.as_str()));
    let storage = RUNTIME
        .block_on(services.request(Method::GET, "/api/client-storage", None))
        .unwrap();
    assert_eq!(
        storage["entries"]["inferay-selected-project-id"], "latest",
        "{storage}"
    );
    assert_eq!(storage["entries"]["sidebar-collapsed"], "true");
    assert_eq!(storage["entries"]["main-sidebar-width"], "280");
    let restored = crate::session::load(profile.path()).unwrap();
    assert!(restored.sidebar_collapsed);
    assert_eq!(restored.sidebar_width, 280.);
    assert!(restored.closed_projects.contains("closed-project"));
    assert_eq!(
        restored.repository_graph_preferences["/first"]["widths"]["refs"],
        420
    );
    assert_eq!(
        restored.repository_graph_preferences["/second"]["widths"]["refs"],
        180
    );
    assert!(!rt.state.status.starts_with("Could not save"));
}

#[test]
fn dock_resizes_persist_in_order_without_resetting_columns() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let backend = connected(profile.path());
    let services = backend.clone();
    let request =
        json!({"workspaceId":"layout-test","ids":["a","b"],"columns":2,"visibleColumns":2});
    let mut view = Workspace::empty();
    with_backend(&mut view, backend);
    for ratio in [0.3, 0.7] {
        let mut update = request.clone();
        update["action"] = json!({"type":"resize","path":[],"ratio":ratio});
        view.persist_workspace_preferences(Some(update));
    }
    let mut rt = runtime(view);
    let wait = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let restored = loop {
        run_until_idle(&mut rt);
        let restored = RUNTIME
            .block_on(services.request(Method::POST, "/api/workspace/dock", Some(request.clone())))
            .unwrap();
        if restored["saved"]["tree"]["ratio"] == 0.7 || std::time::Instant::now() > wait {
            break restored;
        }
    };
    assert_eq!(restored["saved"]["preset"], json!(["grid", 2]));
    assert_eq!(restored["saved"]["tree"]["ratio"], 0.7, "{restored}");
    assert!(
        !rt.state.status.starts_with("Could not save"),
        "{}",
        rt.state.status
    );
}

fn queued_store(
    profile: &std::path::Path,
) -> (
    inferay_server::chat_persistence::ChatPersistence,
    serde_json::Value,
) {
    let store = inferay_server::chat_persistence::ChatPersistence::new(profile.to_owned());
    let queued = json!({"id":"remove-me","text":"waiting","displayText":"waiting","images":null});
    RUNTIME
        .block_on(store.enqueue_runtime(
            "queue-pane",
            vec![serde_json::from_value(queued.clone()).unwrap()],
            false,
        ))
        .unwrap();
    (store, queued)
}

#[test]
fn queue_removal_persists_and_preserves_newer_items() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let (store, queued) = queued_store(profile.path());
    let backend = connected(profile.path());
    let mut view = Workspace::empty();
    with_backend(&mut view, backend);
    let chat = &mut view.conversations[0];
    chat.pane = Some("queue-pane".into());
    chat.queue = vec![
        queued,
        json!({"id":"steering","text":"live steer","transient":true}),
    ];
    view.update_queued_message(0, "steering".into(), None, false);
    assert!(view.conversations[0].queue_task.is_none());
    view.update_queued_message(0, "remove-me".into(), None, false);
    view.conversations[0]
        .queue
        .push(json!({"id":"newer","text":"new follow-up"}));
    let mut rt = runtime(view);
    run_until(&mut rt, |view| view.conversations[0].queue_task.is_none());
    let chat = &rt.state.conversations[0];
    assert!(chat.error.is_none(), "{:?}", chat.error);
    assert_eq!(
        chat.queue
            .iter()
            .map(|m| m["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["steering", "newer"]
    );
    assert!(
        RUNTIME
            .block_on(store.read_queue("queue-pane"))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn queue_edit_persists_without_overwriting_newer_text() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let (store, queued) = queued_store(profile.path());
    let backend = connected(profile.path());
    let mut view = Workspace::empty();
    with_backend(&mut view, backend);
    let chat = &mut view.conversations[0];
    chat.pane = Some("queue-pane".into());
    chat.queue = vec![
        queued,
        json!({"id":"steering","text":"live steer","transient":true}),
    ];
    let mut editor = TextInput::new();
    editor.set_content("edited message");
    view.conversations[0].queue_editor = Some(("remove-me".into(), editor));
    view.update_queued_message(0, "remove-me".into(), Some("   ".into()), false);
    assert!(view.conversations[0].queue_task.is_none());
    view.update_queued_message(
        0,
        "remove-me".into(),
        Some(" edited message ".into()),
        false,
    );
    view.conversations[0]
        .queue_editor
        .as_mut()
        .unwrap()
        .1
        .set_content("still typing");
    view.conversations[0].queue[0]["text"] = "newer socket text".into();
    let mut rt = runtime(view);
    run_until(&mut rt, |view| view.conversations[0].queue_task.is_none());
    let chat = &rt.state.conversations[0];
    assert!(chat.error.is_none(), "{:?}", chat.error);
    assert_eq!(chat.queue[0]["text"], "newer socket text");
    assert_eq!(
        chat.queue_editor.as_ref().unwrap().1.content(),
        "still typing"
    );
    assert_eq!(
        RUNTIME.block_on(store.read_queue("queue-pane")).unwrap()[0].text,
        "edited message"
    );
}

#[test]
fn enter_sends_follow_up_without_stopping_the_active_turn() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let workspace = AgentWorkspace::new("codex");
    let serialized = serde_json::to_value(&workspace).unwrap();
    let pane = serialized["groups"][0]["panes"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    std::fs::write(
        profile.path().join("agent-state.json"),
        serialized.to_string(),
    )
    .unwrap();
    let backend = connected(profile.path());
    let (commands, mut requests) = tokio::sync::mpsc::channel::<super::live::Command>(1);
    let expected_pane = pane.clone();
    let received = RUNTIME.spawn(async move {
        let command = requests.recv().await.unwrap();
        assert_eq!(command.message["type"], "chat:send");
        assert_eq!(command.message["paneId"], expected_pane);
        assert_eq!(command.message["text"], "follow up");
        command.completed.send(Ok(())).unwrap();
    });
    let mut view = Workspace::empty();
    view.profile = profile.path().to_owned();
    with_backend(&mut view, backend);
    let chat = &mut view.conversations[0];
    chat.pane = Some(pane);
    chat.commands = Some(commands);
    chat.run.is_loading = true;
    chat.input.set_content("follow up");
    view.track_draft(0, false);
    assert!(view.conversations[0].input.submit_on_enter);
    let mut rt = crate::task::testing::view_runtime(view, (900., 700.));
    rt.frame(1. / 60.);
    rt.update(|view, _| view.conversations[0].input.focus());
    rt.frame(1. / 60.);
    rt.key(rune::Key::Enter.into());
    rt.frame(1. / 60.);
    run_until(&mut rt, |view| !view.conversations[0].sending);
    RUNTIME.block_on(received).unwrap();
    let chat = &rt.state.conversations[0];
    assert!(chat.run.is_loading);
    assert!(chat.error.is_none(), "{:?}", chat.error);
    assert!(chat.input.content().is_empty());
}

#[test]
fn refreshed_title_preserves_the_open_conversation() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let mut workspace = serde_json::to_value(AgentWorkspace::new("codex")).unwrap();
    workspace["groups"][0]["panes"][0]["summary"] = "Updated conversation title".into();
    let pane = workspace["groups"][0]["panes"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    std::fs::write(
        profile.path().join("agent-state.json"),
        workspace.to_string(),
    )
    .unwrap();
    let backend = connected(profile.path());
    let mut view = Workspace::empty();
    view.profile = profile.path().to_owned();
    with_backend(&mut view, backend);
    let chat = &mut view.conversations[0];
    chat.pane = Some(pane.clone());
    chat.input.set_content("unsent draft");
    view.refresh_chat_title(0);
    let mut rt = runtime(view);
    run_until(&mut rt, |view| {
        view.conversations[0].title == "Updated conversation title"
    });
    let chat = &rt.state.conversations[0];
    assert_eq!(chat.pane.as_deref(), Some(pane.as_str()));
    assert_eq!(chat.input.content(), "unsent draft");
}
