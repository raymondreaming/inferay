use super::changes::{border_left, border_right, label, toggle_button};
use super::*;
use crate::colors::{self, rgb, rgba};
use crate::icons;
use crate::ui::{Ink, button, icon_sized};
use crate::zoom::ui;
use rune::{Cursor, Drag, El, GrowthSpec, Phase, ScrollSpec, col, el, row};
use std::borrow::Cow;
use std::rc::Rc;

struct DiffRows {
    data: Option<Arc<PreparedDiff>>,
    file_view: bool,
    file_new: bool,
    split: bool,
    active: Option<[usize; 2]>,
    count: usize,
    code_width: f32,
    offsets: [Live<[f32; 2]>; 2],
}

fn tint(line: Option<&GitDiffLine>) -> u32 {
    match line.map(|l| l.line_type) {
        Some(GitDiffLineType::Add) => colors::DIFF_ADDED_BACKGROUND,
        Some(GitDiffLineType::Remove) => colors::DIFF_REMOVED_BACKGROUND,
        _ => 0,
    }
}

fn code(content: &str, runs: &[(std::ops::Range<usize>, crate::syntax::Paint)], ink: Ink) -> El {
    rune::rich(content.to_owned(), crate::syntax::spans(runs))
        .font(ink.style())
        .color(ink.color)
}

fn gutter(number: Option<usize>, ink: Ink) -> El {
    row().w(ui(colors::DIFF_GUTTER)).justify_end().child(label(
        ink.hex(0xebebeb60),
        number.map(|n| n.to_string()).unwrap_or_default(),
    ))
}

impl DiffRows {
    fn row(&self, path: &str, i: usize) -> El {
        let ink = Ink::new(colors::DIFF_TEXT).mono().line(colors::DIFF_ROW);
        let mut line = row()
            .key(format!("diff-row-{i}"))
            .w_full()
            .clip_rounded(0.)
            .h(ui(colors::DIFF_ROW));
        if self
            .active
            .is_some_and(|range| i >= range[0] && i < range[1])
        {
            line = line
                .border_sides([0., 0., 0., 2.], rgba(0xebebeb80))
                .border_layout();
        }
        let Some(data) = &self.data else {
            return line;
        };
        let diff = &data.diff;
        if self.file_view {
            let index = data.file_rows[usize::from(self.file_new)][i];
            let source = if self.file_new {
                &diff.new_lines[index]
            } else {
                &diff.old_lines[index]
            };
            let styles = if self.file_new { &data.new } else { &data.old };
            return line
                .child(gutter(source.number, ink).pr(ui(8.)))
                .child(code(
                    &source.content,
                    styles.get(index).map_or(&[], Vec::as_slice),
                    ink,
                ));
        }
        if self.split {
            for (side, source) in [diff.old_lines.get(i), diff.new_lines.get(i)]
                .into_iter()
                .enumerate()
            {
                let styles = if side == 0 { &data.old } else { &data.new };
                let offset = &self.offsets[side];
                line = line.child(
                    border_right(
                        row()
                            .w_frac(0.5)
                            .h_full()
                            .clip_rounded(0.)
                            .fill(rgba(tint(source)))
                            .gap(ui(8.)),
                        0xebebeb0f,
                    )
                    .child(gutter(
                        source.and_then(|l| l.number),
                        ink.size(colors::DIFF_NUMBER),
                    ))
                    .child(
                        row()
                            .key(format!("diff-code-{side}-{i}"))
                            .grow(1.)
                            .min_w(0.)
                            .h_full()
                            .clip_rounded(0.)
                            .on_wheel(horizontal_wheel(
                                path,
                                side,
                                data.line_widths[side],
                                self.code_width,
                            ))
                            .child(
                                code(
                                    source.map_or("", |l| l.content.as_str()),
                                    styles.get(i).map_or(&[], Vec::as_slice),
                                    ink,
                                )
                                .w(ui(data.line_widths[side]).max(self.code_width))
                                .live_offset(offset),
                            ),
                    ),
                );
            }
            return line;
        }
        let source = data.inline.get(i);
        line.fill(rgba(tint(source)))
            .gap(ui(8.))
            .child(gutter(
                source.and_then(|l| l.number),
                ink.size(colors::DIFF_NUMBER),
            ))
            .child(code(
                source.map_or("", |l| l.content.as_str()),
                data.inline_styles(i),
                ink,
            ))
    }
}

fn horizontal_wheel(
    path: &str,
    side: usize,
    line_width: f32,
    code_width: f32,
) -> impl Fn(&mut Workspace, rune::WheelEvent, &mut Tx) -> bool + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, event: rune::WheelEvent, tx: &mut Tx| {
        if event.dx.abs() <= event.dy.abs() {
            return false;
        }
        let Some(view) = s.repository_views.get_mut(&path) else {
            return false;
        };
        let limit = (ui(line_width) - code_width).max(0.);
        let [x, _] = view.diff_horizontal[side].get();
        view.diff_horizontal[side].set([(x + event.dx).clamp(-limit, 0.), 0.]);
        tx.live_only();
        true
    }
}

impl RepositoryView {
    fn image_preview(&self, split: bool) -> El {
        let Some(data) = &self.diff else {
            return el();
        };
        let endpoints = [&data.diff.old_image, &data.diff.new_image];
        let mut preview = if split { row() } else { col() }
            .key("diff-images")
            .grow(1.)
            .min_h(0.)
            .min_w(0.)
            .gap(ui(8.))
            .padding(ui(8.));
        for side in (0..2).filter(|&side| {
            endpoints[side].is_some()
                && (!self.file_view || side == usize::from(endpoints[1].is_some()))
        }) {
            let picture = match &self.diff_images[side] {
                Some(Ok(image)) => el()
                    .w_full()
                    .grow(1.)
                    .min_h(0.)
                    .pixels_fit(image, rune::SurfaceFit::Fit),
                Some(Err(error)) => Ink::new(12.).text(format!("Could not preview image: {error}")),
                None => Ink::new(12.).text("Loading image…"),
            };
            preview = preview.child(
                col()
                    .key(format!("diff-image-{side}"))
                    .grow(1.)
                    .min_h(0.)
                    .min_w(0.)
                    .gap(ui(6.))
                    .child(Ink::new(11.).hex(0xebebeb99).text(if side == 0 {
                        "Before"
                    } else {
                        "After"
                    }))
                    .child(picture),
            );
        }
        preview
    }

    fn diff_minimap(&self, split: bool) -> El {
        let height = rune::memo::layout_size("diff-minimap").map_or(0., |size| size[1]);
        let mut rail = border_left(
            col()
                .key("diff-minimap")
                .role("button")
                .label("Scroll diff overview")
                .cursor(Cursor::Pointer)
                .w(ui(12.))
                .h_full(),
            0xebebeb0f,
        );
        let width = ui(12.) - 1.;
        if let Some(data) = &self.diff {
            let (segments, count) = if split {
                (
                    &data.split_minimap,
                    data.diff.old_lines.len().max(data.diff.new_lines.len()),
                )
            } else {
                (&data.inline_minimap, data.inline.len())
            };
            if count > 0 && height > 0. {
                let mut marks: Vec<(f32, u32, f32, f32)> = Vec::new();
                for segment in segments.iter() {
                    let left = if segment.side == "right" { 0.5 } else { 0. };
                    let color = if segment.r#type == "add" {
                        colors::DIFF_ADDED_BACKGROUND
                    } else {
                        colors::DIFF_REMOVED_BACKGROUND
                    };
                    let top = height * (segment.start_line as f32 / count as f32);
                    let bottom = (top
                        + (height
                            * ((segment.end_line - segment.start_line) as f32 / count as f32))
                            .max(ui(1.)))
                    .min(height);
                    match marks.iter_mut().rev().find(|mark| mark.0 == left) {
                        Some(mark) if mark.1 == color && top <= mark.3 => {
                            mark.3 = mark.3.max(bottom)
                        }
                        _ => marks.push((left, color, top, bottom)),
                    }
                }
                let span = if split { 0.5 } else { 1. };
                for (left, color, top, bottom) in marks {
                    rail = rail.child(
                        el().pin(Some(width * left), Some(top), None, None)
                            .w(width * span)
                            .h(bottom - top)
                            .fill(rgba(color)),
                    );
                }
            }
        }
        rail.child(
            el().pin(Some(0.), Some(0.), None, None)
                .live_rect(&self.diff_thumb)
                .radius(ui(2.))
                .fill(rgba(0xffffff14))
                .border(1., rgba(0xffffff55)),
        )
        .on_drag(act_drag(&self.path, |view, drag, tx| match drag.phase {
            Phase::Down => {
                let (top, size) = view.minimap_thumb(drag.h);
                let grab = if drag.y >= top && drag.y <= top + size {
                    drag.y - top
                } else {
                    size / 2.
                };
                view.minimap_drag = Some(grab);
                view.keyboard_scope = "diff";
                view.keyboard_active = true;
                view.scroll_minimap(drag.y, grab, drag.h, tx);
            }
            Phase::Up => view.minimap_drag = None,
            _ => {
                if let Some(grab) = view.minimap_drag {
                    view.scroll_minimap(drag.y, grab, drag.h, tx);
                }
            }
        }))
    }

    pub(super) fn diff_view(&self) -> El {
        let diff = self.diff.clone();
        let image_diff = diff
            .as_ref()
            .is_some_and(|data| data.diff.is_image == Some(true));
        let entry = self.selected_entry();
        let file_new = entry.as_ref().is_none_or(|file| file.1 != "D");
        let file_view = self.file_view;
        let split = self.split_diff && !entry.as_ref().is_some_and(diff::single_sided);
        let count = diff.as_ref().map_or(0, |d| {
            if file_view {
                d.file_rows[usize::from(file_new)].len()
            } else if split {
                d.diff.old_lines.len().max(d.diff.new_lines.len())
            } else {
                d.inline.len()
            }
        });
        let active = self
            .diff_change
            .zip(diff.as_ref().filter(|_| !file_view))
            .and_then(|(i, d)| d.ranges(split).get(i).copied());
        let half = (self.diff_list_width / 2.).max(0.);
        let code_width = (half - 1. - ui(colors::DIFF_GUTTER) - ui(8.)).max(0.);
        let mut toolbar = row()
            .h(ui(32.))
            .items_center()
            .gap(ui(8.))
            .px(ui(8.))
            .child(
                button("← Graph")
                    .key("close-diff")
                    .on_press_tx(act(&self.path, |view, tx| {
                        view.show_diff = false;
                        view.open_after_selection = false;
                        view.history = true;
                        view.keyboard_scope = "graph";
                        tx.focus("repository", false);
                    })),
            )
            .child({
                let path = self.file.clone().unwrap_or_default();
                let original = entry.and_then(|file| file.5);
                // A rename names both sides: where the file was and where it is now.
                let mut title = row()
                    .key("diff-title")
                    .items_center()
                    .gap(ui(6.))
                    .grow(1.)
                    .min_w(0.);
                if let Some(original) = original {
                    title = title
                        .label(format!("Renamed from {original} to {path}"))
                        .child(
                            Ink::new(11.)
                                .hex(0xebebeb80)
                                .line_text(original)
                                .key("diff-original-path")
                                .shrink(),
                        )
                        .child(Ink::new(11.).hex(0xebebeb80).line_text("→"));
                }
                title.child(Ink::new(11.).line_text(path).key("diff-path").shrink())
            });
        let mut modes = row().items_center().gap(ui(2.));
        for (mode, text) in [(true, "Split"), (false, "Unified")] {
            let selected = split == mode && !file_view;
            let mut segment = if selected {
                crate::ui::swap_fill(
                    crate::ui::plain_button(""),
                    &format!("diff-mode-{text}"),
                    Some(rgba(0xebebeb20)),
                    rgba(0xffffff0d),
                )
            } else {
                button("")
            };
            segment = segment
                .key(if mode { "diff-split" } else { "diff-unified" })
                .size(ui(20.), ui(20.))
                .padding(ui(3.))
                .justify_center()
                .radius(ui(3.))
                .role("radio")
                .label(text)
                .checked(selected)
                .child(icon_sized(
                    if mode {
                        &icons::DIFF_SPLIT
                    } else {
                        &icons::DIFF_UNIFIED
                    },
                    14.,
                ))
                .on_press_tx(act(&self.path, move |view, tx| {
                    view.split_diff = mode;
                    view.file_view = false;
                    view.diff_change = None;
                    view.jump_diff_change(0, tx);
                }));
            modes = modes.child(segment);
        }
        toolbar = toolbar.child(modes).child(
            toggle_button("diff-file", file_view)
                .label("View full file")
                .h(ui(24.))
                .px(ui(8.))
                .child(
                    Ink::new(11.)
                        .color(if file_view {
                            rgb(0xffffff)
                        } else {
                            rgb(colors::TEXT)
                        })
                        .line_text("File"),
                )
                .on_press_tx(act(&self.path, |view, tx| {
                    view.file_view = !view.file_view;
                    view.diff_change = None;
                    tx.scroll_to_y("diff-lines", 0.);
                })),
        );
        let mut view = col()
            .grow(1.)
            .min_h(0.)
            .on_background_press(|s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut() {
                    view.keyboard_scope = "diff";
                    view.keyboard_active = true;
                }
            })
            .child(toolbar);
        if diff
            .as_ref()
            .is_some_and(|d| d.diff.is_binary && d.diff.is_image != Some(true))
        {
            view = view.child(
                col()
                    .padding(ui(12.))
                    .child(Ink::body().text("Binary file")),
            );
        }
        if image_diff {
            view = view.child(self.image_preview(split));
        }
        if image_diff {
            return view;
        }
        let rows = Rc::new(DiffRows {
            data: diff,
            file_view,
            file_new,
            split,
            active,
            count,
            code_width,
            offsets: self.diff_horizontal.clone(),
        });
        let build_rows = rows.clone();
        let path = self.path.clone();
        let scroll = self.diff_scroll.clone();
        let thumb = self.diff_thumb.clone();
        let minimap_width = ui(12.) - 1.;
        let list = col()
            .key("diff-lines")
            .grow(1.)
            .min_h(0.)
            .min_w(0.)
            .scroll(ScrollSpec {
                stick_bottom: false,
            })
            .on_scroll_offset(move |at: rune::ScrollPos| {
                scroll.set([at.offset[1], at.max[1], at.viewport[1], 0.]);
                let (top, size) =
                    diff::thumb(at.viewport[1], at.offset[1], at.max[1], at.viewport[1]);
                thumb.set([0., top, minimap_width, size]);
            })
            .on_layout(act_layout(&self.path))
            .child(
                col()
                    .key("diff-rows")
                    .growth(GrowthSpec::default())
                    .virtual_rows(
                        rows.count,
                        ui(colors::DIFF_ROW),
                        |_: &Workspace, i| Cow::Owned(format!("diff-row-{i}")),
                        move |_: &Workspace, i| build_rows.row(&path, i),
                    ),
            );
        let mut body = row()
            .grow(1.)
            .min_h(0.)
            .min_w(0.)
            .on_wheel(act_wheel(&self.path))
            .child(list);
        if !file_view {
            body = body.child(self.diff_minimap(split));
        }
        view.child(body)
    }
}

fn act_drag(
    path: &str,
    f: impl Fn(&mut RepositoryView, &mut Drag, &mut Tx) + 'static,
) -> impl Fn(&mut Workspace, &mut Drag, &mut Tx) + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, drag: &mut Drag, tx: &mut Tx| {
        if let Some(view) = s.repository_views.get_mut(&path) {
            f(view, drag, tx);
        }
    }
}

fn act_layout(path: &str) -> impl Fn(&mut Workspace, [f32; 4]) + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, rect: [f32; 4]| {
        if let Some(view) = s.repository_views.get_mut(&path) {
            view.diff_list_width = rect[2];
        }
    }
}

fn act_wheel(path: &str) -> impl Fn(&mut Workspace, rune::WheelEvent, &mut Tx) -> bool + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, _: rune::WheelEvent, tx: &mut Tx| {
        match s.repository_views.get_mut(&path) {
            Some(view) if view.diff_change.is_some() => view.diff_change = None,
            _ => tx.live_only(),
        }
        false
    }
}
