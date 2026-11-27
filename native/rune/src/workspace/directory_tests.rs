use super::*;
use crate::backend::RUNTIME;
use crate::task::testing::{run_until, runtime, serial};

#[test]
fn folder_names_ignore_trailing_separators() {
    assert_eq!(folder_name("/Users/me/Projects/app/"), "app");
    assert_eq!(folder_name("/"), "/");
}

#[test]
fn choosing_a_folder_sets_only_that_chats_directory() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let folder = folder.path().canonicalize().unwrap();
    let mut workspace = inferay_core::agent_state::Workspace::new("codex");
    let pane = workspace.selected_pane_id().unwrap().to_owned();
    workspace
        .apply_action(
            &AgentWorkspaceAction::DirectorySelected {
                pane_id: pane.clone(),
                path: Some("/original".into()),
                reference_paths: None,
            },
            "codex",
        )
        .unwrap();
    std::fs::write(
        profile.path().join("agent-state.json"),
        serde_json::to_vec(&workspace).unwrap(),
    )
    .unwrap();
    let backend = RUNTIME
        .block_on(Backend::connect(profile.path().to_owned()))
        .unwrap();
    let services = backend.clone();
    let mut view = Workspace::empty();
    view.profile = profile.path().to_owned();
    view.backend = Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
    view.conversations[0].pane = Some(pane.clone());
    let repositories = view.projects[0].repositories.clone();
    let mut rt = runtime(view);
    let path = folder.to_string_lossy().into_owned();
    rt.update(|view, _| {
        view.menu = Some((0, "directory"));
        view.select_directory(0, path.clone());
    });
    run_until(&mut rt, |view| view.directory_picks.selecting.is_none());
    let view = &rt.state;
    assert_eq!(
        view.conversations[0].cwd.as_deref(),
        Some(path.as_str()),
        "{:?}",
        view.conversations[0].error
    );
    assert!(view.menu.is_none());
    assert_eq!(view.projects[0].repositories, repositories);
    let saved: inferay_core::agent_state::Workspace = serde_json::from_value(
        RUNTIME
            .block_on(services.request(Method::GET, "/api/agent/state", None))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        saved.pane(&pane).unwrap().cwd.as_deref(),
        Some(path.as_str())
    );
}

#[test]
fn choosing_a_folder_before_the_chat_is_saved_keeps_the_directory() {
    let _serial = serial();
    let mut view = Workspace::empty();
    view.select_directory(0, "/elsewhere".into());
    assert!(view.conversations[0].cwd.is_none());
    assert!(view.conversations[0].error.is_some());
    assert!(view.directory_picks.selecting.is_none());
}
