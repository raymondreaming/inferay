use super::*;
use rune::{Env, Runtime};

fn pump(rt: &mut Runtime<Workspace>, done: impl Fn(&Workspace) -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        for update in crate::task::headless::drain() {
            rt.update(|s, tx| update(s, tx));
        }
        rt.frame(1. / 60.);
        if done(&rt.state) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "project page work did not finish"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn idle(s: &Workspace) -> bool {
    s.project_pages.task.is_none() && !s.project_pages.mutating
}

#[test]
fn project_pages_save_review_and_preserve_conflicting_drafts() {
    let _serial = crate::task::testing::serial();
    let profile = tempfile::tempdir().unwrap();
    let backend = crate::backend::RUNTIME
        .block_on(crate::backend::Backend::connect(profile.path().into()))
        .unwrap();
    let project = uuid::Uuid::new_v4().to_string();
    crate::backend::RUNTIME.block_on(backend.request(Method::POST,"/api/projects/command",Some(json!({"type":"saveProject","definition":{"schema":"inferay.project/1","id":project,"name":"Page test","description":"","instructions":"","repositories":[]},"expectedHash":null})))).unwrap();
    let mut view = Workspace::empty();
    view.profile = profile.path().into();
    view.backend = Arc::new(tokio::sync::OnceCell::new_with(Some(backend.clone())));
    view.projects[0].id = Some(project.clone());
    let mut rt = Runtime::new(view, crate::workspace::view, (1200., 850.), Env::default());
    rt.update(|s, tx| s.open_project_page("Automations", tx));
    pump(&mut rt, idle);
    assert!(
        rt.state.project_pages.error.is_none(),
        "{:?}",
        rt.state.project_pages.error
    );
    rt.update(|s, _| {
        s.edit_automation(None, Some(("Review", "Inspect project changes.", None)));
        s.save_automation();
    });
    pump(&mut rt, idle);
    let saved = {
        let s = &rt.state;
        assert!(
            s.project_pages.error.is_none(),
            "{:?}",
            s.project_pages.error
        );
        let saved = list(&s.project_pages.data["catalog"], "automations")
            .first()
            .unwrap()
            .clone();
        assert_eq!(saved["enabled"], false);
        assert!(list(&s.project_pages.data["history"], "runs").is_empty());
        saved
    };
    let id = text(&saved["file"], "id");
    rt.update(|s, _| s.review_automation(id.clone(), false));
    pump(&mut rt, idle);
    assert!(
        rt.state.project_pages.error.is_none(),
        "{:?}",
        rt.state.project_pages.error
    );
    assert!(rt.state.project_pages.review.as_ref().unwrap()["inputsHash"].is_string());
    rt.frame(1. / 60.);
    assert!(rt.find("approve-automation").is_some());
    rt.update(|s, _| {
        s.project_pages.review = None;
        s.project_pages.screen = "detail";
    });
    rt.update(|s, _| s.edit_automation(Some(saved.clone()), None));
    let mut changed = saved["file"]["definition"].clone();
    changed["name"] = json!("External edit");
    crate::backend::RUNTIME.block_on(backend.request(Method::POST,"/api/projects/command",Some(json!({"type":"saveDefinition","projectId":project,"path":saved["file"]["sourcePath"],"content":changed.to_string(),"expectedHash":saved["file"]["sourceHash"]})))).unwrap();
    rt.update(|s, _| {
        s.project_pages.set("name", "My retained draft");
        s.save_automation();
    });
    pump(&mut rt, idle);
    assert!(rt.state.project_pages.error.is_some());
    assert_eq!(rt.state.project_pages.screen, "detail");
    assert_eq!(rt.state.project_pages.text("name"), "My retained draft");
    rt.update(|s, tx| {
        s.open_project_page("Memory", tx);
        assert_eq!(s.project_pages.page, Some("Automations"));
        assert_eq!(s.project_pages.text("name"), "My retained draft");
        s.project_pages.original = Value::Null;
        s.project_pages.error = None;
        s.project_pages.mutating = false;
        s.open_project_page("Memory", tx);
    });
    pump(&mut rt, |s| idle(s) && !s.project_pages.graph.is_null());
    assert!(
        rt.state.project_pages.error.is_none(),
        "{:?}",
        rt.state.project_pages.error
    );
    rt.frame(1. / 60.);
    assert!(rt.find("memory-graph").is_some());
    rt.update(|s, tx| s.open_project_page("Plugins", tx));
    pump(&mut rt, idle);
    rt.frame(1. / 60.);
    assert!(rt.find("plugins-page").is_some());
}

#[test]
fn schedule_labels_and_summaries_follow_triggers() {
    use super::automations::{display_time, schedule_label, schedule_summary};
    assert_eq!(schedule_label(&json!({"kind":"manual"})), "Manual only");
    assert_eq!(
        schedule_label(&json!({"kind":"interval","seconds":3600})),
        "Every hour"
    );
    assert_eq!(
        schedule_label(&json!({"kind":"interval","seconds":1800})),
        "Every 30 minutes"
    );
    assert_eq!(display_time("00:15"), "12:15 AM");
    assert_eq!(display_time("13:30"), "1:30 PM");
    assert_eq!(
        schedule_summary(
            &json!({"kind":"calendar","days":[1,3],"times":["09:00"],"timezone":"UTC"})
        ),
        "Mon, Wed at 9:00 AM · UTC"
    );
    assert_eq!(
        schedule_summary(
            &json!({"kind":"calendar","days":[1,2,3,4,5,6,7],"times":["18:45"],"timezone":"UTC"})
        ),
        "Every day at 6:45 PM · UTC"
    );
}
