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
            "Mic" => include_bytes!("../assets/icons/Mic.svg"),
            "Wrench" => include_bytes!("../assets/icons/Wrench.svg"),
            "X" => include_bytes!("../assets/icons/X.svg"),
            "Folder" => include_bytes!("../assets/icons/Folder.svg"),
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
        .bg(rgb(colors::SHELL))
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
