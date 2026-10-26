//! Retained, virtualized edit diffs prepared beside the rest of a transcript.
use crate::{colors, selectable::PreparedText, zoom::ui};
use gpui::{prelude::*, *};
use inferay_core::{chat_protocol::ChatEdit, repository::GitDiffLineType};
use inferay_native_diff::PreparedEditDiff;
use std::sync::Arc;

#[derive(Clone)]
pub struct EditDiff {
    source: Arc<ChatEdit>,
    data: Result<Arc<PreparedEditDiff>, SharedString>,
    rows: Arc<[PreparedText]>,
    added: usize,
    removed: usize,
}

impl EditDiff {
    pub fn prepare(edit: &ChatEdit, theme: &str) -> Self {
        let data = inferay_native_diff::prepare_edit_diff(&edit.old_string, &edit.new_string, &[])
            .map(Arc::new)
            .map_err(SharedString::from);
        let added = data.as_ref().map_or(0, |data| {
            data.lines
                .iter()
                .filter(|line| line.line_type == GitDiffLineType::Add)
                .count()
        });
        let removed = data.as_ref().map_or(0, |data| data.lines.len() - added);
        Self {
            source: Arc::new(edit.clone()),
            data,
            rows: Arc::new([]),
            added,
            removed,
        }
        .retheme(theme)
    }

    pub fn retheme(&self, theme: &str) -> Self {
        let mut next = self.clone();
        if let Ok(data) = &self.data {
            let old = crate::syntax::line_highlights(
                &self.source.old_string.split('\n').collect::<Vec<_>>(),
                &self.source.file_path,
                theme,
            );
            let new = crate::syntax::line_highlights(
                &self.source.new_string.split('\n').collect::<Vec<_>>(),
                &self.source.file_path,
                theme,
            );
            next.rows = data
                .lines
                .iter()
                .map(|line| {
                    let removed = line.line_type == GitDiffLineType::Remove;
                    let syntax = if removed {
                        line.old_line_num.and_then(|n| old.get(n - 1))
                    } else {
                        line.new_line_num.and_then(|n| new.get(n - 1))
                    };
                    let mut offset = 0;
                    let changed = line.segments.iter().flatten().filter_map(|segment| {
                        let start = offset;
                        offset += segment.text.len();
                        segment.changed.then_some((
                            start..offset,
                            HighlightStyle {
                                background_color: Some(
                                    rgba(if removed { 0xff686838 } else { 0x55d68b38 }).into(),
                                ),
                                ..Default::default()
                            },
                        ))
                    });
                    PreparedText::new(
                        line.text.clone().into(),
                        combine_highlights(syntax.into_iter().flatten().cloned(), changed)
                            .collect(),
                        vec![],
                    )
                })
                .collect();
        }
        next
    }

    pub fn render(&self, id: &str) -> Div {
        let mut card = div()
            .debug_selector(|| "tool-edit-card".into())
            .relative()
            .min_w_0()
            .overflow_hidden()
            .rounded(ui(4.))
            .border_1()
            .border_color(rgba(0xebebeb18))
            .bg(rgba(0x181818dc));
        let data = match &self.data {
            Ok(data) if data.has_changes => data.clone(),
            Ok(_) => return card.child(div().p(ui(8.)).text_size(ui(10.)).child("No changes")),
            Err(error) => {
                return card.child(div().p(ui(8.)).text_size(ui(10.)).child(error.clone()));
            }
        };
        let (added, removed) = (self.added, self.removed);
        let copy = self.source.clone();
        card = card.child(
            div()
                .flex()
                .items_center()
                .gap(ui(6.))
                .px(ui(8.))
                .py(ui(2.))
                .text_size(ui(10.))
                .border_b_1()
                .border_color(rgba(0xebebeb0f))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_ellipsis()
                        .child(self.source.file_path.clone()),
                )
                .child(
                    div()
                        .text_color(rgb(colors::ADDED))
                        .child(format!("+{added}")),
                )
                .child(
                    div()
                        .text_color(rgb(colors::DELETED))
                        .child(format!("−{removed}")),
                )
                .child(crate::copy_button::copy_button(
                    crate::button(SharedString::from(format!("copy-edit-{id}")), "")
                        .aria_label("Copy edited code")
                        .size(ui(22.))
                        .p(ui(4.))
                        .justify_center(),
                    move || copy.new_string.clone(),
                )),
        );
        let rows = self.rows.clone();
        let message_id = id.to_owned();
        let height = (data.lines.len() as f32 * colors::DIFF_ROW).min(224.);
        let width = data.content_width_chars as f32 * colors::DIFF_TEXT * 0.65;
        card.child(
            div()
                .id(SharedString::from(format!("edit-scroll-{id}")))
                .overflow_x_scroll()
                .min_w_0()
                .child(
                    uniform_list(
                        SharedString::from(format!("edit-lines-{id}")),
                        data.lines.len(),
                        move |range, _, _| {
                            range
                                .map(|i| {
                                    let line = &data.lines[i];
                                    let removed = line.line_type == GitDiffLineType::Remove;
                                    let color = if removed {
                                        colors::DELETED
                                    } else {
                                        colors::ADDED
                                    };
                                    div()
                                        .debug_selector(move || format!("edit-diff-row-{i}"))
                                        .h(ui(colors::DIFF_ROW))
                                        .w_full()
                                        .flex()
                                        .items_center()
                                        .gap(ui(6.))
                                        .font_family("Menlo")
                                        .text_size(ui(colors::DIFF_TEXT))
                                        .line_height(ui(colors::DIFF_ROW))
                                        .bg(rgba((color << 8) | 0x18))
                                        .border_l_2()
                                        .border_color(rgba((color << 8) | 0x70))
                                        .child(
                                            div()
                                                .w(ui(12.))
                                                .flex_shrink_0()
                                                .text_center()
                                                .text_color(rgb(color))
                                                .child(if removed { "−" } else { "+" }),
                                        )
                                        .child(
                                            div()
                                                .w(ui(28.))
                                                .flex_shrink_0()
                                                .text_right()
                                                .text_size(ui(colors::DIFF_NUMBER))
                                                .text_color(rgba(0xebebeb60))
                                                .child(
                                                    line.old_line_num
                                                        .or(line.new_line_num)
                                                        .map(|n| n.to_string())
                                                        .unwrap_or_default(),
                                                ),
                                        )
                                        .child(
                                            rows[i].render(format!("edit-text-{message_id}-{i}")),
                                        )
                                })
                                .collect()
                        },
                    )
                    .h(ui(height))
                    .w(ui(width))
                    .min_w_full(),
                ),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn edit_rows_keep_numbers_syntax_word_changes_and_theme() {
        let edit = ChatEdit {
            file_path: "file.ts".into(),
            old_string: "/* comment\n😀 old */\nconst value = 1;\nunchanged".into(),
            new_string: "/* comment\n😀 new */\nconst value = 2;\nunchanged".into(),
        };
        let prepared = EditDiff::prepare(&edit, "vscode-black");
        let data = prepared.data.as_ref().unwrap();
        assert_eq!(data.lines.len(), 4);
        assert_eq!(data.lines[0].old_line_num, Some(2));
        assert_eq!(data.lines[2].new_line_num, Some(2));
        assert!(
            prepared.rows[0]
                .highlights()
                .iter()
                .any(|(_, s)| s.font_style == Some(FontStyle::Italic))
        );
        assert!(
            prepared.rows[1]
                .highlights()
                .iter()
                .any(|(_, s)| s.color == Some(rgb(0x569cd6).into()))
        );
        for row in prepared.rows.iter() {
            assert!(
                row.highlights()
                    .iter()
                    .any(|(_, s)| s.background_color.is_some())
            );
            assert!(
                row.highlights()
                    .iter()
                    .all(|(r, _)| row.content().get(r.clone()).is_some())
            );
        }
        let rethemed = prepared.retheme("contrast");
        assert!(Arc::ptr_eq(data, rethemed.data.as_ref().unwrap()));
        assert_ne!(prepared.rows[1].highlights(), rethemed.rows[1].highlights());
    }

    #[gpui::test]
    fn long_chat_edits_are_bounded_virtualized_and_selectable(cx: &mut TestAppContext) {
        struct Example(EditDiff);
        impl Render for Example {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().w_full().child(self.0.render("edit"))
            }
        }
        let edit = ChatEdit {
            file_path: "file.rs".into(),
            old_string: (0..1000)
                .map(|i| format!("let before_{i} = 1;\n"))
                .collect(),
            new_string: (0..1000).map(|i| format!("let after_{i} = 2;\n")).collect(),
        };
        let (view, cx) =
            cx.add_window_view(|_, _| Example(EditDiff::prepare(&edit, "vscode-black")));
        cx.simulate_resize(size(px(400.), px(500.)));
        cx.draw(point(px(0.), px(0.)), size(px(400.), px(500.)), |_, _| {
            view.clone().into_any_element()
        });
        let card = cx.debug_bounds("tool-edit-card").unwrap();
        assert!(card.size.height <= px(254.));
        assert!(card.size.width <= px(400.));
        assert!(cx.debug_bounds("edit-diff-row-0").is_some());
        assert!(cx.debug_bounds("edit-diff-row-500").is_none());
        let text = cx.debug_bounds("selectable-text").unwrap();
        cx.simulate_click(text.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-a cmd-c");
        assert!(
            cx.read_from_clipboard()
                .and_then(|item| item.text())
                .unwrap()
                .contains("before_")
        );
    }
}
