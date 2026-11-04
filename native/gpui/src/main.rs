mod backend;
mod chat_inline_diff;
mod copy_button;
mod input;
#[cfg(test)]
mod performance;
mod repository;
mod rich_text;
mod selectable;
mod session;
mod syntax;
mod transcript;
mod workspace;
mod zoom;

use gpui::{prelude::*, *};
use std::borrow::Cow;
use workspace::WorkspaceView;

mod colors;
struct Assets;
impl AssetSource for Assets {
    fn load(&self, path: &str) -> anyhow::Result<Option<Cow<'static, [u8]>>> {
        let bytes: &'static [u8] = match path {
            "Search" => include_bytes!("../assets/icons/Search.svg"),
            "claude" => include_bytes!("../../../public/claude-logo.svg"),
            "Settings" => include_bytes!("../assets/icons/Settings.svg"),
            "Expand" => include_bytes!("../assets/icons/Expand.svg"),
            "Collapse" => include_bytes!("../assets/icons/Collapse.svg"),
            "GitBranch" => include_bytes!("../assets/icons/GitBranch.svg"),
            "CommitGraph" => include_bytes!("../assets/icons/CommitGraph.svg"),
            "Workflow" => include_bytes!("../assets/icons/Workflow.svg"),
            "Wrench" => include_bytes!("../assets/icons/Wrench.svg"),
            "X" => include_bytes!("../assets/icons/X.svg"),
            "Folder" => include_bytes!("../assets/icons/Folder.svg"),
            "Rename" => include_bytes!("../assets/icons/Rename.svg"),
            "FilePath" => include_bytes!("../assets/icons/FilePath.svg"),
            "FileTree" => include_bytes!("../assets/icons/FileTree.svg"),
            "DiffSplit" => include_bytes!("../assets/icons/DiffSplit.svg"),
            "DiffUnified" => include_bytes!("../assets/icons/DiffUnified.svg"),
            "PanelLeft" => include_bytes!("../assets/icons/PanelLeft.svg"),
            "Bookmark" => include_bytes!("../assets/icons/Bookmark.svg"),
            "Sparkles" => include_bytes!("../assets/icons/Sparkles.svg"),
            "Minus" => include_bytes!("../assets/icons/Minus.svg"),
            "Plus" => include_bytes!("../assets/icons/Plus.svg"),
            "ChevronDown" => include_bytes!("../assets/icons/ChevronDown.svg"),
            "ChevronRight" => include_bytes!("../assets/icons/ChevronRight.svg"),
            "Copy" => include_bytes!("../assets/icons/Copy.svg"),
            "ArrowLeft" => include_bytes!("../assets/icons/ArrowLeft.svg"),
            "Stop" => include_bytes!("../assets/icons/Stop.svg"),
            "Pencil" => include_bytes!("../assets/icons/Pencil.svg"),
            "Check" => include_bytes!("../assets/icons/Check.svg"),
            "Trash" => include_bytes!("../assets/icons/Trash.svg"),
            "Send" => include_bytes!("../assets/icons/Send.svg"),
            "MessageCircle" => include_bytes!("../assets/icons/MessageCircle.svg"),
            "LayoutGrid" => include_bytes!("../assets/icons/LayoutGrid.svg"),
            "codex" => include_bytes!("../../../public/codex-logo.svg"),
            "city" => include_bytes!("../../../public/background-city-rain.png"),
            "nature" => include_bytes!("../../../public/background-nature-sanctuary.png"),
            "orbit" => include_bytes!("../../../public/background-orbital-study.png"),
            "signals" => include_bytes!("../../../public/inferay-vibespace.png"),
            _ => return Ok(None),
        };
        Ok(Some(Cow::Borrowed(bytes)))
    }
    fn list(&self, _: &str) -> anyhow::Result<Vec<SharedString>> {
        Ok(vec![])
    }
}
actions!(inferay, [Quit, ToggleSidebar, Settings, Back]);
fn main() {
    env_logger::init();
    gpui_platform::application()
        .with_assets(Assets)
        .run(|cx: &mut App| {
            cx.text_system()
                .add_fonts(vec![
                    Cow::Borrowed(include_bytes!("../assets/fonts/Geist-Regular.ttf")),
                    Cow::Borrowed(include_bytes!("../assets/fonts/Geist-Medium.ttf")),
                    Cow::Borrowed(include_bytes!("../assets/fonts/Geist-SemiBold.ttf")),
                ])
                .expect("bundled Geist fonts");
            cx.set_window_appearance(Some(WindowAppearance::Dark));
            input::bind(cx);
            zoom::bind(cx);
            cx.bind_keys([
                KeyBinding::new("cmd-q", Quit, None),
                KeyBinding::new("cmd-b", ToggleSidebar, None),
                KeyBinding::new("cmd-,", Settings, None),
                KeyBinding::new("escape", Back, None),
            ]);
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.set_menus(vec![
                Menu::new("Inferay").items([MenuItem::action("Quit Inferay", Quit)]),
                Menu::new("View").items([
                    MenuItem::action("Zoom In", zoom::ZoomIn),
                    MenuItem::action("Zoom Out", zoom::ZoomOut),
                    MenuItem::action("Actual Size", zoom::ResetZoom),
                ]),
            ]);
            let bounds = Bounds::centered(None, size(px(1280.), px(820.)), cx);
            cx.open_window(
                WindowOptions {
                    show: false,
                    focus: false,
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(TitlebarOptions {
                        title: Some("Inferay".into()),
                        appears_transparent: true,
                        traffic_light_position: Some(point(px(16.), px(14.))),
                    }),
                    app_owns_titlebar_drag: true,
                    window_background: WindowBackgroundAppearance::Blurred,
                    window_min_size: Some(size(px(780.), px(560.))),
                    ..Default::default()
                },
                |window, cx| cx.new(|cx| WorkspaceView::new(window, cx)),
            )
            .expect("open Inferay");
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
        });
}
fn icon(name: &'static str) -> Svg {
    svg()
        .path(name)
        .size(crate::zoom::ui(15.))
        .flex_shrink_0()
        .text_color(rgba(0xebebebb8))
}
fn menu_surface(id: impl Into<ElementId>) -> Stateful<Div> {
    div()
        .id(id)
        .absolute()
        .flex()
        .flex_col()
        .max_h(crate::zoom::ui(300.))
        .overflow_y_scroll()
        .p(crate::zoom::ui(4.))
        .rounded(crate::zoom::ui(8.))
        .bg(rgb(colors::SURFACE))
        .border_1()
        .border_color(rgba(0xebebeb20))
        .shadow_lg()
        .occlude()
}

fn titlebar_surface() -> Div {
    // macOS controls retain their physical size at every application zoom level.
    div()
        .flex()
        .items_center()
        .flex_shrink_0()
        .h(zoom::ui(zoom::TITLEBAR_HEIGHT))
        .min_h(px(zoom::NATIVE_TITLEBAR_MIN_HEIGHT))
        .pl(px(96.))
}
fn button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Stateful<Div> {
    plain_button(id, label).hover(|s| s.bg(rgba(0xffffff0d)))
}
fn plain_button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Stateful<Div> {
    let label = label.into();
    div()
        .id(id)
        .role(Role::Button)
        .aria_label(label.clone())
        .tab_index(0)
        .flex()
        .items_center()
        .gap(crate::zoom::ui(6.))
        .px(crate::zoom::ui(9.))
        .h(crate::zoom::ui(28.))
        .rounded(crate::zoom::ui(6.))
        .text_size(crate::zoom::ui(colors::CHAT_SMALL))
        .cursor_pointer()
        .when(!label.is_empty(), |d| d.child(label))
}

/// Shared chat and commit composer surface, including its active border beam.
fn composer_surface(id: impl Into<ElementId>, active: bool) -> Div {
    let id = id.into();
    div()
        .relative()
        .flex()
        .flex_col()
        .flex_shrink_0()
        .rounded(zoom::ui(12.))
        .border_1()
        .border_color(rgba(0xebebeb0f))
        .pt(zoom::ui(8.))
        .pb(zoom::ui(8.))
        .when(active, |d| {
            d.child(
                div()
                    .debug_selector(|| "composer-border-beam".into())
                    .absolute()
                    .inset_0()
                    .rounded(zoom::ui(12.))
                    .overflow_hidden()
                    .with_animation(
                        id,
                        Animation::new(std::time::Duration::from_millis(2500)).repeat(),
                        |d, phase| {
                            d.child(
                                canvas(
                                    |_, _, _| (),
                                    move |bounds, _, window, _| {
                                        let width = f32::from(bounds.size.width);
                                        let height = f32::from(bounds.size.height);
                                        let radius = (11. * crate::zoom::factor(window))
                                            .min(width / 2.)
                                            .min(height / 2.);
                                        let horizontal = width - radius * 2.;
                                        let vertical = height - radius * 2.;
                                        let arc = std::f32::consts::FRAC_PI_2 * radius;
                                        let perimeter = 2. * (horizontal + vertical) + 4. * arc;
                                        let position = |mut distance: f32| {
                                            let lengths = [
                                                horizontal, arc, vertical, arc, horizontal, arc,
                                                vertical, arc,
                                            ];
                                            let mut part = 0;
                                            while part < 7 && distance > lengths[part] {
                                                distance -= lengths[part];
                                                part += 1;
                                            }
                                            let (x, y) = match part {
                                                0 => (radius + distance, 0.),
                                                2 => (width, radius + distance),
                                                4 => (width - radius - distance, height),
                                                6 => (0., height - radius - distance),
                                                _ => {
                                                    let corner = part / 2;
                                                    let angle = -std::f32::consts::FRAC_PI_2
                                                        + corner as f32
                                                            * std::f32::consts::FRAC_PI_2
                                                        + distance / radius;
                                                    let (x, y) = [
                                                        (width - radius, radius),
                                                        (width - radius, height - radius),
                                                        (radius, height - radius),
                                                        (radius, radius),
                                                    ][corner];
                                                    (
                                                        x + radius * angle.cos(),
                                                        y + radius * angle.sin(),
                                                    )
                                                }
                                            };
                                            bounds.origin + point(px(x), px(y))
                                        };
                                        for segment in 0..240 {
                                            let progress = segment as f32 / 240.;
                                            let tail = (progress - phase).rem_euclid(1.);
                                            let alpha = (1. - ((tail - 0.66) / 0.14).abs()).max(0.);
                                            if alpha == 0. {
                                                continue;
                                            }
                                            for (stroke, opacity) in [
                                                (36., 0.015),
                                                (20., 0.025),
                                                (10., 0.04),
                                                (5., 0.08),
                                                (2., 0.2),
                                                (1., 0.65),
                                            ] {
                                                let mut path = PathBuilder::stroke(
                                                    crate::zoom::pixels(stroke, window),
                                                );
                                                path.move_to(position(progress * perimeter));
                                                path.line_to(position(
                                                    (segment + 1) as f32 / 240. * perimeter,
                                                ));
                                                if let Ok(path) = path.build() {
                                                    window.paint_path(
                                                        path,
                                                        hsla(
                                                            (progress + phase * 0.1) % 1.,
                                                            0.8,
                                                            0.65,
                                                            alpha * opacity,
                                                        ),
                                                    );
                                                }
                                            }
                                        }
                                    },
                                )
                                .size_full(),
                            )
                        },
                    ),
            )
        })
        .bg(rgba(colors::COMPOSER))
}
