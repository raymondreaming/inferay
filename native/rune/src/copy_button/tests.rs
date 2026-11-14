use super::*;
use crate::task::testing::{deliver, serial};
use rune::{Cx, Env, Runtime, col};

fn view(_: &Workspace, _: &mut Cx<Workspace>) -> El {
    col().w_full().h_full().instant_changes().child(copy_button(
        "copy-example",
        crate::ui::button("").label("Copy response"),
        || "café 🌳".into(),
    ))
}

fn present(rt: &Runtime<Workspace>, key: &str) -> bool {
    rt.elements()
        .iter()
        .any(|e| !e.exiting && e.key.as_deref() == Some(key))
}

fn wait(rt: &mut Runtime<Workspace>, duration: Duration) {
    std::thread::sleep(duration);
    deliver(rt);
    rt.frame(1. / 60.);
}

#[test]
fn copying_confirms_and_repeated_clicks_restart_feedback() {
    let _serial = serial();
    let mut rt = Runtime::new(Workspace::empty(), view, (200., 100.), Env::new(false, 1.));
    let clipboard = rune::clipboard::memory();
    rt.use_clipboard(&clipboard);
    rt.frame(1. / 60.);
    assert!(present(&rt, "copy-ready"));
    let (x, y) = rt.find("copy-example").unwrap();
    let click = |rt: &mut Runtime<Workspace>| {
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(1. / 60.);
    };
    click(&mut rt);
    assert!(present(&rt, "copy-confirmation"));
    assert_eq!(
        clipboard.text().as_deref().map(String::as_str),
        Some("café 🌳")
    );
    wait(&mut rt, Duration::from_secs(1));
    click(&mut rt);
    wait(&mut rt, Duration::from_millis(1100));
    assert!(present(&rt, "copy-confirmation"));
    wait(&mut rt, Duration::from_millis(1100));
    assert!(present(&rt, "copy-ready"));
    assert!(!present(&rt, "copy-confirmation"));
}
