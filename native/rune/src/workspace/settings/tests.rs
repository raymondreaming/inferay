use super::*;
use rune::{Env, Key, KeyEvent, Mods, Runtime};

fn runtime(view: Workspace, size: (f32, f32)) -> Runtime<Workspace> {
    let mut rt = Runtime::new(view, crate::workspace::view, size, Env::new(true, 1.));
    rt.on_key = Some(crate::on_key);
    rt.frame(0.);
    rt
}

fn command(c: char) -> KeyEvent {
    KeyEvent {
        key: Key::Command(c),
        mods: Mods {
            cmd: true,
            logo: true,
            ..Default::default()
        },
    }
}

fn workspace(profile: &std::path::Path) -> Workspace {
    let mut view = Workspace::empty();
    view.profile = profile.into();
    view.status.clear();
    view
}

#[test]
fn native_control_clearance_survives_minimum_zoom_in_workspace_and_settings() {
    let profile = tempfile::tempdir().unwrap();
    let mut rt = runtime(workspace(profile.path()), (1000., 720.));
    for percent in [50, 80, 100, 150, 200] {
        for settings in [false, true] {
            rt.state.zoom = crate::zoom::Zoom::restore(Some(&percent.to_string()));
            rt.state.settings = settings;
            rt.invalidate();
            rt.frame(1. / 60.);
            let (header, _) = rt
                .presented(if settings {
                    "settings-titlebar"
                } else {
                    "workspace-titlebar"
                })
                .unwrap_or_else(|| panic!("titlebar at zoom {percent}"));
            let (control, _) = rt
                .presented(if settings {
                    "settings-back"
                } else {
                    "sidebar-toggle"
                })
                .unwrap_or_else(|| panic!("first control at zoom {percent}"));
            assert!(header[3] >= 42., "zoom {percent}");
            assert!(control[0] - header[0] >= 96., "zoom {percent}");
            assert!(control[1] >= header[1], "zoom {percent}");
            assert!(
                control[1] + control[3] <= header[1] + header[3],
                "zoom {percent}"
            );
        }
    }
}

#[test]
fn global_zoom_scales_layout_with_composer_and_settings_focus_and_persists() {
    let profile = tempfile::tempdir().unwrap();
    let mut rt = runtime(workspace(profile.path()), (1400., 900.));
    rt.state.settings = true;
    rt.state
        .settings_state
        .fields
        .get_mut("search")
        .unwrap()
        .focus();
    rt.invalidate();
    rt.frame(1. / 60.);
    assert!(rt.state.settings_state.fields["search"].is_focused());
    let (narrow, _) = rt.presented("settings-navigation").unwrap();
    rt.key(command('='));
    rt.frame(1. / 60.);
    assert_eq!(rt.state.zoom.percent(), 110);
    rt.frame(1. / 60.);
    let (wide, _) = rt.presented("settings-navigation").unwrap();
    assert!((wide[2] - narrow[2] * 1.1).abs() < 1.);
    rt.key(command('-'));
    rt.frame(1. / 60.);
    assert_eq!(rt.state.zoom.percent(), 100);
    rt.key(command('='));
    rt.frame(1. / 60.);
    assert_eq!(rt.state.zoom.percent(), 110);
    assert_eq!(rt.state.settings_state.text("search"), "");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while crate::session::load(profile.path())
        .map(|s| s.zoom.percent())
        .unwrap_or(0)
        != 110
    {
        assert!(std::time::Instant::now() < deadline, "zoom persisted");
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    rt.key(command('0'));
    rt.frame(1. / 60.);
    assert_eq!(rt.state.zoom.percent(), 100);
}

#[test]
fn refreshing_settings_preserves_cleared_and_edited_instructions() {
    let mut state = State::new();
    state.populate("instructions", "Saved instructions");
    assert_eq!(state.text("instructions"), "Saved instructions");
    state.set_text("instructions", "");
    state.populate("instructions", "Saved instructions");
    assert_eq!(state.text("instructions"), "");
    state.set_text("instructions", "Unsaved draft");
    state.populate("instructions", "Updated elsewhere");
    assert_eq!(state.text("instructions"), "Unsaved draft");
}

#[test]
fn settings_restores_input_focus_and_draft() {
    let profile = tempfile::tempdir().unwrap();
    let mut view = workspace(profile.path());
    view.conversations[0].input.set_content("unfinished");
    view.conversations[0].input.focus();
    view.set_settings(true);
    assert!(!view.conversations[0].input.is_focused());
    view.set_settings(false);
    assert!(view.conversations[0].input.is_focused());
    assert_eq!(view.conversations[0].input.content(), "unfinished");
}
