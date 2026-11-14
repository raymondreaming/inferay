use crate::colors::{self, rgb, rgba};
use crate::copy_button::copy_button;
use crate::rich_text::{Prepared, combine};
use crate::syntax::Paint;
use crate::ui::{Ink, border, button};
use crate::workspace::Workspace;
use crate::zoom::ui;
use inferay_core::{chat_protocol::ChatEdit, repository::GitDiffLineType};
use inferay_native_diff::PreparedEditDiff;
use rune::{Align, El, col, row};
use std::{borrow::Cow, sync::Arc};

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct EditDiff {
    source: Arc<ChatEdit>,
    data: Result<Arc<PreparedEditDiff>, String>,
    rows: Arc<[Prepared]>,
    added: usize,
    removed: usize,
}

impl EditDiff {
    pub fn prepare(edit: &ChatEdit, theme: &str) -> Self {
        let data = inferay_native_diff::prepare_edit_diff(&edit.old_string, &edit.new_string, &[])
            .map(Arc::new);
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
            let [old, new] = crate::syntax::diff_highlights(
                [
                    &self.source.old_string.split('\n').collect::<Vec<_>>(),
                    &self.source.new_string.split('\n').collect::<Vec<_>>(),
                ],
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
                    let changed: Vec<_> = line
                        .segments
                        .iter()
                        .flatten()
                        .filter_map(|segment| {
                            let start = offset;
                            offset += segment.text.len();
                            segment.changed.then_some((
                                start..offset,
                                Paint {
                                    background: Some(rgba(if removed {
                                        0xff686838
                                    } else {
                                        0x55d68b38
                                    })),
                                    ..Default::default()
                                },
                            ))
                        })
                        .collect();
                    Prepared::new(
                        line.text.as_str().into(),
                        combine(syntax.into_iter().flatten().cloned(), changed),
                        vec![],
                    )
                })
                .collect();
        }
        next
    }

    pub fn render(&self, id: &str, ink: Ink) -> El {
        let card = border(
            col()
                .key("tool-edit-card")
                .min_w(0.)
                .radius(ui(4.))
                .clip_rounded(ui(4.))
                .fill(rgba(0x181818dc)),
            0xebebeb18,
        );
        let small = Ink {
            line: None,
            ..ink.size(10.)
        };
        let data = match &self.data {
            Ok(data) if data.has_changes => data.clone(),
            Ok(_) => return card.child(col().padding(ui(8.)).child(small.text("No changes"))),
            Err(error) => {
                return card.child(col().padding(ui(8.)).child(small.text(error.clone())));
            }
        };
        let copy = self.source.clone();
        let header = row()
            .items_center()
            .gap(ui(6.))
            .px(ui(8.))
            .py(ui(2.))
            .border_sides([0., 0., 1., 0.], rgba(0xebebeb0f))
            .border_layout()
            .child(
                small
                    .line_text(self.source.file_path.clone())
                    .grow(1.)
                    .shrink(),
            )
            .child(
                small
                    .color(rgb(colors::ADDED))
                    .text(format!("+{}", self.added)),
            )
            .child(
                small
                    .color(rgb(colors::DELETED))
                    .text(format!("−{}", self.removed)),
            )
            .child(copy_button(
                format!("copy-edit-{id}"),
                button("")
                    .label("Copy edited code")
                    .w(ui(22.))
                    .h(ui(22.))
                    .padding(ui(4.))
                    .justify_center(),
                move || copy.new_string.clone(),
            ));
        let rows = self.rows.clone();
        let lines = data.clone();
        let message_id = id.to_owned();
        let height = (data.lines.len() as f32 * colors::DIFF_ROW).min(224.);
        let width = data.content_width_chars as f32 * colors::DIFF_TEXT * 0.65;
        card.child(header).child(
            col()
                .key(format!("edit-scroll-{id}"))
                .h(ui(height))
                .min_w(0.)
                .scroll_xy()
                .child(
                    col()
                        .key(format!("edit-lines-{id}"))
                        .growth(rune::GrowthSpec {
                            edge: rune::edge::NO_MASK,
                            ..Default::default()
                        })
                        .virtual_rows(
                            data.lines.len(),
                            ui(colors::DIFF_ROW),
                            |_: &Workspace, i| Cow::Owned(format!("edit-diff-row-{i}")),
                            move |_: &Workspace, i| {
                                diff_row(&lines, &rows, &message_id, i, width, ink)
                            },
                        ),
                ),
        )
    }
}

fn diff_row(
    data: &PreparedEditDiff,
    rows: &[Prepared],
    id: &str,
    i: usize,
    width: f32,
    ink: Ink,
) -> El {
    let line = &data.lines[i];
    let removed = line.line_type == GitDiffLineType::Remove;
    let color = if removed {
        colors::DELETED
    } else {
        colors::ADDED
    };
    let text = ink.size(colors::DIFF_TEXT).line(colors::DIFF_ROW).mono();
    row()
        .key(format!("edit-diff-row-{i}"))
        .h(ui(colors::DIFF_ROW))
        .w_full()
        .min_w(ui(width))
        .items_center()
        .gap(ui(6.))
        .fill(rgba((color << 8) | 0x18))
        .border_sides([0., 0., 0., 2.], rgba((color << 8) | 0x70))
        .border_layout()
        .child(
            col().w(ui(12.)).child(
                rune::text(if removed { "−" } else { "+" })
                    .font(text.style())
                    .color(rgb(color))
                    .align(Align::Center)
                    .rounded_lines()
                    .offset(0., text.baseline()),
            ),
        )
        .child(
            col().w(ui(28.)).child(
                rune::text(
                    line.old_line_num
                        .or(line.new_line_num)
                        .map(|n| n.to_string())
                        .unwrap_or_default(),
                )
                .font(text.size(colors::DIFF_NUMBER).style())
                .color(rgba(0xebebeb60))
                .align(Align::End)
                .rounded_lines()
                .offset(0., text.size(colors::DIFF_NUMBER).baseline()),
            ),
        )
        .child(rows[i].render_line(format!("edit-text-{id}-{i}"), text))
}
