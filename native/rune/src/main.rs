mod backend;
mod baseline;
mod chat_inline_diff;
mod colors;
mod copy_button;
mod icons;
mod input;
#[cfg(test)]
mod performance;
mod platform;
mod repository;
mod rich_text;
mod session;
mod syntax;
mod task;
mod transcript;
mod ui;
mod workspace;
mod zoom;

use rune::{AppSpec, Chord, KeyEvent, MenuItem, Tx};
use workspace::Workspace;

pub(crate) static FONTS: &[&[u8]] = &[
    include_bytes!("../assets/fonts/Geist-Regular.ttf"),
    include_bytes!("../assets/fonts/Geist-Medium.ttf"),
    include_bytes!("../assets/fonts/Geist-SemiBold.ttf"),
];

fn placeholder() -> Workspace {
    Workspace::empty()
}

fn chord(spec: &str) -> Chord {
    Chord::parse(spec).expect("valid shortcut")
}

fn on_key(s: &mut Workspace, event: &KeyEvent, tx: &mut Tx) -> bool {
    if chord("mod+q").matches_tx(event, tx) {
        tx.quit();
    } else if chord("mod+b").matches_tx(event, tx) {
        s.sidebar = !s.sidebar;
        s.persist_workspace_preferences(None);
    } else if chord("mod+,").matches_tx(event, tx) {
        s.set_settings(!s.settings);
    } else if chord("mod+=").matches_tx(event, tx) || chord("mod+plus").matches_tx(event, tx) {
        s.set_zoom(s.zoom.step(1));
    } else if chord("mod+-").matches_tx(event, tx) {
        s.set_zoom(s.zoom.step(-1));
    } else if chord("mod+0").matches_tx(event, tx) {
        s.set_zoom(zoom::Zoom::default());
    } else if matches!(event.key, rune::Key::Escape) {
        if s.settings && s.menu.is_none() {
            s.set_settings(false);
        } else {
            s.menu = None;
        }
    } else {
        return repository::on_key(s, event, tx);
    }
    true
}

fn poll(s: &mut Workspace, _clock: f64, tx: &mut Tx) -> bool {
    let mut changed = false;
    for update in task::headless::drain() {
        update(s, tx);
        changed = true;
    }
    if s.font_applied != Some(s.font) {
        tx.set_font_families(s.font, "Menlo");
        s.font_applied = Some(s.font);
        changed = true;
    }
    syntax::set_current_theme(&s.syntax_theme);
    changed |= s.follow_focused_input();
    changed |= s.tick_activity_clock(tx);
    changed
}

fn main() {
    env_logger::init();
    rune::prewarm_gpu();
    let spec = AppSpec {
        min_size: Some((780., 560.)),
        fonts: FONTS,
        families: ("System Font", "Menlo"),
        poll: Some(poll),
        on_key: Some(on_key),
        ..AppSpec::new("Inferay", (1280., 820.), placeholder, workspace::view)
    };
    let app = rune::App::new(spec)
        .titlebar(rune::Titlebar::new(zoom::NATIVE_TITLEBAR_MIN_HEIGHT).traffic_lights(16., 14.))
        .chrome(rune::Chrome {
            full_size_content: true,
            traffic_lights: Some((16., 14.)),
            drag_regions: true,
        })
        .window_options(rune::WindowOptions {
            transparent: true,
            ..Default::default()
        })
        .on_window(platform::install_window_material)
        .standard_menus()
        .menu_item(MenuItem::new("Quit Inferay", |_, tx| tx.quit()).id("quit"))
        .menu_item(
            MenuItem::new("Zoom In", |s: &mut Workspace, _| s.set_zoom(s.zoom.step(1)))
                .id("zoom-in")
                .menu("View"),
        )
        .menu_item(
            MenuItem::new("Zoom Out", |s: &mut Workspace, _| {
                s.set_zoom(s.zoom.step(-1))
            })
            .id("zoom-out")
            .menu("View"),
        )
        .menu_item(
            MenuItem::new("Actual Size", |s: &mut Workspace, _| {
                s.set_zoom(zoom::Zoom::default())
            })
            .id("actual-size")
            .menu("View"),
        );
    task::install(app.handle());
    app.init(Workspace::new).run();
}
