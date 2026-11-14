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
