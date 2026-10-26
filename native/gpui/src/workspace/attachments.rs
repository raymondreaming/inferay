//! Bounded photo prints shared by draft attachments and sent messages.
use crate::zoom::ui;
use gpui::{prelude::*, *};
use std::path::PathBuf;

pub(super) fn photo(path: PathBuf, id: String, compact: bool) -> Div {
    let (width, height) = if compact { (80., 64.) } else { (144., 112.) };
    let alternate = id.as_bytes().last().is_some_and(|byte| byte % 2 == 0);
    let image_id = format!("{id}-image");
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    div()
        .debug_selector(move || id)
        .relative()
        .w(ui(width))
        .max_w_full()
        .min_w_0()
        .h(ui(height + 12.))
        .flex_shrink_0()
        .px(ui(4.))
        .pt(ui(8.))
        .pb(ui(4.))
        .child(
            div()
                .relative()
                .size_full()
                .p(ui(4.))
                .rounded(ui(3.))
                .border_1()
                .border_color(rgba(0xffffff24))
                .bg(rgb(0x36332f))
                .shadow_md()
                .child(
                    div()
                        .relative()
                        .size_full()
                        .overflow_hidden()
                        .rounded(ui(2.))
                        .bg(rgb(0x202020))
                        .child(
                            img(path)
                                .id(SharedString::from(image_id))
                                .role(Role::Image)
                                .aria_label(name)
                                .absolute()
                                .inset_0()
                                .size_full()
                                .object_fit(ObjectFit::Cover),
                        ),
                ),
        )
        .child(
            canvas(
                |_, _, _| (),
                move |bounds, _, window, _| {
                    let mut tape = PathBuilder::fill();
                    let width = bounds.size.width;
                    let height = bounds.size.height;
                    let slope = height * if alternate { 0.22 } else { -0.22 };
                    tape.move_to(bounds.origin + point(px(0.), height * 0.2 + slope));
                    tape.line_to(bounds.origin + point(width, height * 0.2 - slope));
                    tape.line_to(bounds.origin + point(width, height * 0.8 - slope));
                    tape.line_to(bounds.origin + point(px(0.), height * 0.8 + slope));
                    tape.close();
                    if let Ok(tape) = tape.build() {
                        window.paint_path(tape, rgba(0xd7c596a8));
                    }
                },
            )
            .absolute()
            .top_0()
            .left(relative(if alternate { 0.5 } else { 0.24 }))
            .w(ui(if compact { 26. } else { 38. }))
            .h(ui(12.)),
        )
}
