use super::*;
use rune::{Env, Key, KeyEvent, Mods, Runtime};

pub(crate) use crate::task::testing::{run_until, run_until_idle, serial};

pub(crate) fn harness(view: RepositoryView, size: (f32, f32)) -> Runtime<Workspace> {
    let mut state = Workspace::empty();
    let path = view.path.clone();
    state.repository = true;
    state.repository_view = Some(path.clone());
    state.repository_views.insert(path, view);
    let mut rt = Runtime::new(
        state,
        |s: &Workspace, _| match s
            .repository_view
            .as_ref()
            .and_then(|path| s.repository_views.get(path))
        {
            Some(view) => rune::col()
                .key("workspace-root")
                .w_full()
                .h_full()
                .child(view.render())
                .instant_changes()
                .hover_motion_within(rune::Anim::INSTANT, rune::Anim::INSTANT),
            None => rune::el(),
        },
        size,
        Env::new(false, 1.),
    );
    rt.on_key = Some(crate::on_key);
    frames(&mut rt, 3);
    rt
}

pub(crate) fn frames(rt: &mut Runtime<Workspace>, count: usize) {
    for _ in 0..count {
        rt.frame(1. / 60.);
    }
}

pub(crate) fn repo(rt: &Runtime<Workspace>) -> &RepositoryView {
    let path = rt.state.repository_view.as_ref().unwrap();
    &rt.state.repository_views[path]
}

pub(crate) fn update(rt: &mut Runtime<Workspace>, f: impl FnOnce(&mut RepositoryView, &mut Tx)) {
    rt.update(|s, tx| {
        let path = s.repository_view.clone().unwrap();
        f(s.repository_views.get_mut(&path).unwrap(), tx)
    });
    frames(rt, 2);
}

pub(crate) fn rect(rt: &Runtime<Workspace>, key: &str) -> Option<[f32; 4]> {
    rt.presented(key).map(|(rect, _)| rect)
}

pub(crate) fn center(rt: &Runtime<Workspace>, key: &str) -> (f32, f32) {
    let r = rect(rt, key).unwrap_or_else(|| panic!("no element {key}"));
    (r[0] + r[2] / 2., r[1] + r[3] / 2.)
}

pub(crate) fn click_at(rt: &mut Runtime<Workspace>, (x, y): (f32, f32)) {
    rt.pointer_move(x, y);
    rt.frame(1. / 60.);
    rt.pointer_down(x, y);
    rt.frame(1. / 60.);
    rt.pointer_up(x, y);
    frames(rt, 2);
}

pub(crate) fn click(rt: &mut Runtime<Workspace>, key: &str) {
    let at = center(rt, key);
    click_at(rt, at);
}

pub(crate) fn press(rt: &mut Runtime<Workspace>, key: Key, mods: Mods) {
    rt.key(KeyEvent { key, mods });
    frames(rt, 2);
}

pub(crate) fn plain(key: Key) -> KeyEvent {
    KeyEvent {
        key,
        mods: Mods::default(),
    }
}

pub(crate) fn type_text(rt: &mut Runtime<Workspace>, text: &str) {
    for c in text.chars() {
        rt.key(Key::Text(c.to_string()).into());
    }
    frames(rt, 1);
}

pub(crate) fn idle_view(path: &std::path::Path) -> RepositoryView {
    let mut view = RepositoryView::new(
        path.to_string_lossy().into_owned(),
        Value::Null,
        "vscode-black".into(),
        0,
    );
    view.task = None;
    view.loading = false;
    view
}

pub(crate) fn git(root: &std::path::Path, args: &[&str]) -> String {
    let output = inferay_native_diff::git_command()
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

pub(crate) fn init_repo(root: &std::path::Path, branch: &str) {
    git(root, &["init", "-b", branch]);
    git(root, &["config", "user.name", "UI test"]);
    git(root, &["config", "user.email", "test@example.invalid"]);
    git(root, &["config", "commit.gpgsign", "false"]);
}

pub(crate) fn with_avatar(mut view: RepositoryView) -> RepositoryView {
    view.avatars
        .insert("test@example.invalid".into(), Pixels::new());
    view
}
