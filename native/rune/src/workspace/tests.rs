use super::*;
use crate::backend::RUNTIME;
use crate::task::testing::{run_until, serial, view_runtime};
use rune::Runtime;

fn click(rt: &mut Runtime<Workspace>, key: &str) {
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("no element {key}"));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(1. / 60.);
}

#[test]
fn workspace_tabs_close_and_reopen_without_deleting_chats() {
    let _serial = serial();
    let mut view = Workspace::empty();
    view.projects[0].id = Some("first".into());
    view.projects[0].name = "First".into();
    view.projects.push(Project {
        id: Some("second".into()),
        name: "Second".into(),
        repositories: vec![],
        selected_repository: None,
        selected: 1,
        dock: serde_json::Value::Null,
        dock_workspace: None,
    });
    view.conversations.push(Conversation::new(
        1,
        TextInput::new(),
        view.default_config.clone(),
    ));
    view.conversations[0].input.set_content("Keep draft");
    let mut rt = view_runtime(view, (1000., 700.));
    rt.frame(1. / 60.);
    click(&mut rt, "close-project-0");
    assert_eq!(rt.state.project, 1);
    assert_eq!(rt.state.projects.len(), 2);
    assert_eq!(rt.state.conversations[0].input.content(), "Keep draft");
    rt.update(|view, tx| view.close_project_tab(1, tx));
    rt.frame(1. / 60.);
    click(&mut rt, "reopen-project-0");
    let view = &rt.state;
    assert_eq!(view.project, 0);
    assert!(!view.project_picker);
    assert!(!view.closed_projects.contains("first"));
    assert!(view.closed_projects.contains("second"));
    assert_eq!(view.conversations.len(), 2);
}

#[test]
fn repository_side_panel_follows_chat_grid_columns() {
    let _serial = serial();
    let directory = tempfile::tempdir().unwrap();
    let mut view = Workspace::empty();
    view.repository = true;
    view.repository_width = 800.;
    view.open_repository(directory.path().to_string_lossy().into_owned());
    let mut rt = view_runtime(view, (2000., 800.));
    for (width, single_column) in [(2000., false), (1500., true), (2000., false)] {
        rt.set_viewport((width, 800.), 1.);
        for _ in 0..3 {
            rt.frame(1. / 60.);
        }
        let path = rt.state.repository_view.clone().unwrap();
        assert_eq!(
            rt.state.repository_views[&path].single_chat_column, single_column,
            "width {width}"
        );
    }
}

#[test]
fn provider_question_fields_keep_separate_answers_and_stale_request_errors() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let backend = RUNTIME
        .block_on(Backend::connect(profile.path().to_owned()))
        .unwrap();
    let mut view = Workspace::empty();
    view.status.clear();
    view.backend = Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
    let chat = &mut view.conversations[0];
    chat.pane = Some("questions-pane".into());
    chat.requests = vec![
        serde_json::json!({"id":"request","method":"item/tool/requestUserInput","params":{"questions":[{"id":"color","question":"Which color?"},{"id":"size","question":"Which size?"}]}}),
    ];
    for field in ["color", "size"] {
        chat.request_inputs
            .insert(format!("request/{field}"), TextInput::new());
    }
    let mut rt = view_runtime(view, (900., 800.));
    rt.frame(1. / 60.);
    for (field, answer) in [("color", "blue"), ("size", "large")] {
        click(&mut rt, &format!("request-0-request/{field}"));
        for c in answer.chars() {
            rt.key(rune::Key::Text(c.to_string()).into());
        }
        rt.frame(1. / 60.);
    }
    assert!(rt.find("provider-requests-0").is_some());
    click(&mut rt, "answer-provider-0-0");
    run_until(&mut rt, |view| view.conversations[0].request_task.is_none());
    let chat = &rt.state.conversations[0];
    assert!(
        chat.error
            .as_ref()
            .is_some_and(|error| error.contains("Could not answer request")),
        "{:?}",
        chat.error
    );
    assert_eq!(chat.request_inputs["request/color"].content(), "blue");
    assert_eq!(chat.request_inputs["request/size"].content(), "large");
    assert!(chat.input.content().is_empty());
}

#[test]
fn repository_add_stays_visible_when_empty_collapsed_or_populated() {
    let _serial = serial();
    let mut view = Workspace::empty();
    view.projects[0].id = Some("project".into());
    let mut rt = view_runtime(view, (1000., 700.));
    rt.frame(1. / 60.);
    assert!(rt.find("sidebar-add-repository").is_some());
    click(&mut rt, "repositories-toggle");
    assert!(rt.state.repositories_collapsed);
    assert!(rt.find("sidebar-add-repository").is_some());
    rt.state.projects[0]
        .repositories
        .push(("App".into(), "/app".into()));
    click(&mut rt, "repositories-toggle");
    assert!(rt.find("repo-0").is_some());
    assert!(rt.find("sidebar-add-repository").is_some());
    click(&mut rt, "new-button");
    click(&mut rt, "new-project");
    assert!(rt.find("new-project-repository").is_some());
    rt.update(|s, _| s.new_project_repository = Some("/app".into()));
    rt.frame(1. / 60.);
    click(&mut rt, "clear-project-repository");
    assert!(rt.state.new_project_repository.is_none());
    click(&mut rt, "cancel-new-project");
    assert!(rt.state.new_project_name.is_none());
}

#[test]
fn project_creation_saves_repository_and_new_chat_association() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let repository = tempfile::tempdir().unwrap();
    let backend = RUNTIME
        .block_on(Backend::connect(profile.path().to_owned()))
        .unwrap();
    let mut view = Workspace::empty();
    view.profile = profile.path().to_owned();
    view.backend = Arc::new(tokio::sync::OnceCell::new_with(Some(backend.clone())));
    let mut rt = view_runtime(view, (1000., 700.));
    rt.frame(1. / 60.);
    click(&mut rt, "new-button");
    click(&mut rt, "new-project");
    rt.state
        .new_project_name
        .as_mut()
        .unwrap()
        .set_content("My app");
    rt.state.new_project_repository = Some(repository.path().to_owned());
    click(&mut rt, "create-new-project");
    run_until(&mut rt, |s| s.new_project_task.is_none());
    assert!(rt.state.new_project_name.is_none(), "{}", rt.state.status);
    let project = &rt.state.projects[rt.state.project];
    let id = project.id.clone().unwrap();
    assert_eq!(project.name, "My app");
    assert_eq!(
        project.repositories[0].1,
        repository.path().canonicalize().unwrap().to_string_lossy()
    );
    let saved = RUNTIME
        .block_on(backend.request(
            reqwest::Method::GET,
            &format!("/api/projects?projectId={id}"),
            None,
        ))
        .unwrap();
    let saved: inferay_core::project_files::ProjectWorkspace =
        serde_json::from_value(saved).unwrap();
    assert_eq!(saved.catalog.repository_paths.len(), 1);
    let second = tempfile::tempdir().unwrap();
    let second_path = second.path().to_string_lossy().into_owned();
    rt.update(|s, _| s.apply_repository_edit(second_path.clone(), None, false));
    run_until(&mut rt, |s| s.repository_edit_task.is_none());
    assert_eq!(
        rt.state.projects[rt.state.project].repositories.len(),
        2,
        "{}",
        rt.state.status
    );
    rt.update(|s, _| s.close_repository(second_path));
    rt.update(|s, tx| s.new_chat(tx));
    run_until(&mut rt, |s| !s.conversations[s.selected].loading);
    let chat = &rt.state.conversations[rt.state.selected];
    assert!(chat.error.is_none(), "{:?}", chat.error);
    let restored = crate::session::load(profile.path()).unwrap();
    assert!(restored.projects.iter().any(|p| {
        p.repositories.len() == 2
            && p.id.as_ref() == Some(&id)
            && p.panes.iter().any(|c| {
                Some(&c.id) == chat.pane.as_ref()
                    && c.cwd.as_deref()
                        == Some(profile.path().join("projects").join(&id).to_str().unwrap())
            })
    }));
}

#[test]
fn missing_repository_keeps_project_draft_without_creating_project() {
    let _serial = serial();
    let profile = tempfile::tempdir().unwrap();
    let backend = RUNTIME
        .block_on(Backend::connect(profile.path().to_owned()))
        .unwrap();
    let mut view = Workspace::empty();
    view.profile = profile.path().to_owned();
    view.backend = Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
    let mut input = TextInput::field("Project name");
    input.set_content("Keep draft");
    view.new_project_name = Some(input);
    view.new_project_repository = Some(profile.path().join("missing"));
    let mut rt = view_runtime(view, (1000., 700.));
    rt.frame(1. / 60.);
    click(&mut rt, "create-new-project");
    run_until(&mut rt, |s| s.new_project_task.is_none());
    assert_eq!(rt.state.projects.len(), 1);
    assert!(rt.state.status.starts_with("Could not create project:"));
    assert_eq!(
        rt.state.new_project_name.as_ref().unwrap().content(),
        "Keep draft"
    );
    assert!(rt.state.new_project_repository.is_some());
}

#[test]
fn adding_repository_from_other_chats_opens_project_creation() {
    let _serial = serial();
    let mut rt = view_runtime(Workspace::empty(), (1000., 700.));
    rt.frame(1. / 60.);
    click(&mut rt, "sidebar-add-repository");
    assert!(rt.find("new-project-repository").is_some());
    assert!(rt.state.new_project_name.is_some());
    assert!(rt.state.status.contains("Create a project"));
}
