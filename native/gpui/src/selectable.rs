//! Selectable transcript text retains Markdown styling and native clipboard behavior.
use gpui::{prelude::*, *};
use std::{ops::Range, sync::Arc};

/// Immutable text and styles are prepared with their message, then shared by redraws.
#[derive(Clone)]
pub struct PreparedText {
    content: SharedString,
    highlights: Arc<[(Range<usize>, HighlightStyle)]>,
    links: Arc<[(Range<usize>, String)]>,
}

impl PreparedText {
    pub fn plain(content: impl Into<SharedString>) -> Self {
        Self::new(content.into(), vec![], vec![])
    }

    pub fn new(
        content: SharedString,
        highlights: Vec<(Range<usize>, HighlightStyle)>,
        links: Vec<(Range<usize>, String)>,
    ) -> Self {
        Self {
            content,
            highlights: highlights.into(),
            links: links.into(),
        }
    }

    pub fn content(&self) -> &SharedString {
        &self.content
    }

    pub fn with_highlights(&self, highlights: Vec<(Range<usize>, HighlightStyle)>) -> Self {
        Self {
            highlights: highlights.into(),
            ..self.clone()
        }
    }

    pub fn render(&self, id: impl Into<SharedString>) -> SelectableText {
        SelectableText {
            id: id.into(),
            text: self.clone(),
        }
    }
}

#[derive(IntoElement)]
pub struct SelectableText {
    id: SharedString,
    text: PreparedText,
}
struct Selection {
    anchor: usize,
    cursor: usize,
    dragging: bool,
    focus: FocusHandle,
}

// Syntax and Markdown preparation produce ordered, disjoint byte ranges.
// Merge selection into those ranges in one pass; scrolling must not rescan
// every syntax span for every output span.
fn selection_highlights(
    text_len: usize,
    highlights: &[(Range<usize>, HighlightStyle)],
    selection: Range<usize>,
) -> impl Iterator<Item = (Range<usize>, HighlightStyle)> + '_ {
    let selection = selection.start.min(text_len)..selection.end.min(text_len);
    let mut cursor = 0;
    let mut index = 0;
    std::iter::from_fn(move || {
        if cursor == text_len {
            return None;
        }
        while highlights
            .get(index)
            .is_some_and(|(range, _)| range.end <= cursor)
        {
            index += 1;
        }
        let (mut end, mut style) = match highlights.get(index) {
            Some((range, style)) if range.start <= cursor => (range.end, *style),
            Some((range, _)) => (range.start, HighlightStyle::default()),
            None => (text_len, HighlightStyle::default()),
        };
        if cursor < selection.start {
            end = end.min(selection.start);
        } else if cursor < selection.end {
            end = end.min(selection.end);
            style.background_color = Some(rgba(0x4688cc80).into());
        }
        debug_assert!(end > cursor && end <= text_len);
        let range = cursor..end;
        cursor = end;
        Some((range, style))
    })
}

impl RenderOnce for SelectableText {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, |_, cx| Selection {
            anchor: 0,
            cursor: 0,
            dragging: false,
            focus: cx.focus_handle(),
        });
        let selected = state.read(cx);
        let content = self.text.content;
        let range = content
            .floor_char_boundary(selected.anchor.min(selected.cursor).min(content.len()))
            ..content.floor_char_boundary(selected.anchor.max(selected.cursor).min(content.len()));
        let focus = selected.focus.clone();
        let highlights = selection_highlights(content.len(), &self.text.highlights, range);
        let text = StyledText::new(content.clone()).with_highlights(highlights);
        let layout = text.layout().clone();
        let down = state.clone();
        let moving = state.clone();
        let up = state.clone();
        let outside = state.clone();
        let move_layout = layout.clone();
        let up_layout = layout.clone();
        div()
            .id(self.id)
            .role(Role::Label)
            .aria_label(content.clone())
            .debug_selector(|| "selectable-text".into())
            .track_focus(&focus)
            .cursor_text()
            .child(text)
            .on_mouse_down(MouseButton::Left, move |event, window, cx| {
                let index = layout
                    .index_for_position(event.position)
                    .unwrap_or_else(|i| i);
                down.update(cx, |selection, cx| {
                    selection.anchor = index;
                    selection.cursor = index;
                    selection.dragging = true;
                    window.focus(&selection.focus, cx);
                });
                window.refresh();
                cx.stop_propagation();
            })
            .on_mouse_move(move |event, window, cx| {
                if moving.read(cx).dragging {
                    let index = move_layout
                        .index_for_position(event.position)
                        .unwrap_or_else(|i| i);
                    moving.update(cx, |selection, _| selection.cursor = index);
                    window.refresh();
                }
            })
            .on_mouse_up(MouseButton::Left, move |event, window, cx| {
                let selected = up.read(cx);
                if selected.dragging
                    && selected.anchor == selected.cursor
                    && let Ok(index) = up_layout.index_for_position(event.position)
                    && let Some((_, href)) =
                        self.text.links.iter().find(|(r, _)| r.contains(&index))
                    && (href.starts_with("https://") || href.starts_with("http://"))
                {
                    cx.open_url(href);
                }
                up.update(cx, |selection, _| selection.dragging = false);
                window.refresh();
            })
            .on_mouse_up_out(MouseButton::Left, move |_, _, cx| {
                outside.update(cx, |s, _| s.dragging = false)
            })
            .on_key_down(move |event, window, cx| {
                if !event.keystroke.modifiers.platform {
                    return;
                }
                match event.keystroke.key.as_str() {
                    "c" => {
                        let selection = state.read(cx);
                        let range = content.floor_char_boundary(
                            selection.anchor.min(selection.cursor).min(content.len()),
                        )
                            ..content.floor_char_boundary(
                                selection.anchor.max(selection.cursor).min(content.len()),
                            );
                        if let Some(text) = content.get(range).filter(|s| !s.is_empty()) {
                            cx.write_to_clipboard(ClipboardItem::new_string(text.to_owned()));
                            cx.stop_propagation();
                        }
                    }
                    "a" => {
                        state.update(cx, |s, _| {
                            s.anchor = 0;
                            s.cursor = content.len();
                        });
                        window.refresh();
                        cx.stop_propagation();
                    }
                    _ => {}
                }
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    // The former render path is an oracle and a benchmark baseline, never used by the app.
    fn previous_highlights(
        text_len: usize,
        highlights: &[(Range<usize>, HighlightStyle)],
        selection: Range<usize>,
    ) -> Vec<(Range<usize>, HighlightStyle)> {
        let mut boundaries = vec![
            0,
            text_len,
            selection.start.min(text_len),
            selection.end.min(text_len),
        ];
        for (range, _) in highlights {
            boundaries.extend([range.start, range.end]);
        }
        boundaries.sort_unstable();
        boundaries.dedup();
        boundaries
            .windows(2)
            .map(|pair| {
                let mut style = highlights
                    .iter()
                    .find(|(r, _)| r.contains(&pair[0]))
                    .map(|(_, s)| *s)
                    .unwrap_or_default();
                if selection.contains(&pair[0]) {
                    style.background_color = Some(rgba(0x4688cc80).into());
                }
                (pair[0]..pair[1], style)
            })
            .collect()
    }

    #[test]
    fn selection_preserves_styles_across_gaps_and_unicode() {
        let text = "ab café 🦀 end";
        let highlights = vec![
            (
                0..2,
                HighlightStyle {
                    color: Some(rgb(0xff0000).into()),
                    ..Default::default()
                },
            ),
            (
                3..8,
                HighlightStyle {
                    font_weight: Some(FontWeight::BOLD),
                    ..Default::default()
                },
            ),
            (
                9..13,
                HighlightStyle {
                    font_style: Some(FontStyle::Italic),
                    ..Default::default()
                },
            ),
        ];
        let ends: Vec<_> = text
            .char_indices()
            .map(|(i, _)| i)
            .chain([text.len(), text.len() + 5])
            .collect();
        for spans in [&[][..], highlights.as_slice()] {
            for &start in &ends {
                for &end in ends.iter().filter(|&&end| end >= start) {
                    let actual: Vec<_> =
                        selection_highlights(text.len(), spans, start..end).collect();
                    let expected = previous_highlights(text.len(), spans, start..end);
                    for byte in 0..text.len() {
                        assert_eq!(
                            actual
                                .iter()
                                .find(|(r, _)| r.contains(&byte))
                                .map(|(_, s)| s),
                            expected
                                .iter()
                                .find(|(r, _)| r.contains(&byte))
                                .map(|(_, s)| s),
                            "selection {start}..{end}, byte {byte}",
                        );
                    }
                    assert!(actual.iter().all(|(r, _)| text.get(r.clone()).is_some()));
                }
            }
        }
    }

    #[test]
    #[ignore = "run with --release --ignored --nocapture --test-threads=1"]
    fn benchmark_selection_highlights() {
        use std::{hint::black_box, time::Instant};
        for spans in [1_000, 4_000, 16_000] {
            let highlights: Vec<_> = (0..spans)
                .map(|i| {
                    (
                        i * 4..i * 4 + 3,
                        HighlightStyle {
                            color: Some(rgb(0x9cdcfe).into()),
                            ..Default::default()
                        },
                    )
                })
                .collect();
            for selected in [false, true] {
                let selection = if selected { spans..spans * 3 } else { 0..0 };
                let run = |previous: bool| {
                    let start = Instant::now();
                    black_box(if previous {
                        previous_highlights(
                            black_box(spans * 4),
                            black_box(&highlights),
                            black_box(selection.clone()),
                        )
                    } else {
                        selection_highlights(
                            black_box(spans * 4),
                            black_box(&highlights),
                            black_box(selection.clone()),
                        )
                        .collect()
                    });
                    start.elapsed().as_secs_f64() * 1_000_000.
                };
                for _ in 0..2 {
                    run(true);
                    run(false);
                }
                let mut before = Vec::new();
                let mut after = Vec::new();
                for sample in 0..12 {
                    if sample % 2 == 0 {
                        before.push(run(true));
                        after.push(run(false));
                    } else {
                        after.push(run(false));
                        before.push(run(true));
                    }
                }
                before.sort_by(f64::total_cmp);
                after.sort_by(f64::total_cmp);
                println!(
                    "{}",
                    serde_json::json!({
                        "workload":"selection_highlights", "spans":spans, "selected":selected, "samples":12,
                        "before_p50_us":before[6], "before_p95_us":before[11],
                        "after_p50_us":after[6], "after_p95_us":after[11], "speedup":before[6] / after[6],
                    })
                );
            }
        }
    }

    #[gpui::test]
    fn selected_unicode_text_copies_to_clipboard(cx: &mut TestAppContext) {
        struct Message;
        impl Render for Message {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div()
                    .size_full()
                    .child(PreparedText::plain("Hello café 🦀").render("test-selection"))
            }
        }
        let (view, cx) = cx.add_window_view(|_, _| Message);
        cx.draw(point(px(0.), px(0.)), size(px(400.), px(200.)), |_, _| {
            view.clone().into_any_element()
        });
        let bounds = cx.debug_bounds("selectable-text").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-a cmd-c");
        assert_eq!(
            cx.read_from_clipboard().and_then(|item| item.text()),
            Some("Hello café 🦀".into())
        );
        cx.simulate_mouse_down(
            point(bounds.left() + px(1.), bounds.center().y),
            MouseButton::Left,
            Modifiers::default(),
        );
        cx.simulate_mouse_move(
            point(bounds.right() - px(1.), bounds.center().y),
            MouseButton::Left,
            Modifiers::default(),
        );
        cx.simulate_mouse_up(
            point(bounds.right() - px(1.), bounds.center().y),
            MouseButton::Left,
            Modifiers::default(),
        );
        cx.simulate_keystrokes("cmd-c");
        assert_eq!(
            cx.read_from_clipboard().and_then(|item| item.text()),
            Some("Hello café 🦀".into())
        );
    }
}
