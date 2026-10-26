//! Selectable transcript text retains Markdown styling and native clipboard behavior.
use gpui::{prelude::*, *};
use std::ops::Range;

#[derive(IntoElement)]
pub struct SelectableText {
    pub id: SharedString,
    pub text: String,
    pub highlights: Vec<(Range<usize>, HighlightStyle)>,
    pub links: Vec<(Range<usize>, String)>,
}
struct Selection {
    anchor: usize,
    cursor: usize,
    dragging: bool,
    focus: FocusHandle,
}
impl RenderOnce for SelectableText {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, |_, cx| Selection {
            anchor: 0, cursor: 0, dragging: false, focus: cx.focus_handle(),
        });
        let selected = state.read(cx);
        let range = selected.anchor.min(selected.cursor)..selected.anchor.max(selected.cursor);
        let focus = selected.focus.clone();
        let mut boundaries = vec![0, self.text.len(), range.start.min(self.text.len()), range.end.min(self.text.len())];
        for (range, _) in &self.highlights { boundaries.extend([range.start, range.end]); }
        boundaries.sort_unstable();
        boundaries.dedup();
        let highlights = boundaries.windows(2).map(|pair| {
            let mut style = self.highlights.iter().find(|(r, _)| r.contains(&pair[0])).map(|(_, s)| *s).unwrap_or_default();
            if range.contains(&pair[0]) { style.background_color = Some(rgba(0x4688cc80).into()); }
            (pair[0]..pair[1], style)
        }).collect::<Vec<_>>();
        let text = StyledText::new(self.text.clone()).with_highlights(highlights);
        let layout = text.layout().clone();
        let down = state.clone();
        let moving = state.clone();
        let up = state.clone();
        let outside = state.clone();
        let move_layout = layout.clone();
        let up_layout = layout.clone();
        let content = self.text;
        div().id(self.id).role(Role::Label).aria_label(content.clone()).debug_selector(|| "selectable-text".into()).track_focus(&focus).cursor_text().child(text)
            .on_mouse_down(MouseButton::Left, move |event, window, cx| {
                let index = layout.index_for_position(event.position).unwrap_or_else(|i| i);
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
                    let index = move_layout.index_for_position(event.position).unwrap_or_else(|i| i);
                    moving.update(cx, |selection, _| selection.cursor = index);
                    window.refresh();
                }
            })
            .on_mouse_up(MouseButton::Left, move |event, window, cx| {
                let selected = up.read(cx);
                if selected.dragging && selected.anchor == selected.cursor
                    && let Ok(index) = up_layout.index_for_position(event.position)
                    && let Some((_, href)) = self.links.iter().find(|(r, _)| r.contains(&index))
                    && (href.starts_with("https://") || href.starts_with("http://")) {
                    cx.open_url(href);
                }
                up.update(cx, |selection, _| selection.dragging = false);
                window.refresh();
            })
            .on_mouse_up_out(MouseButton::Left, move |_, _, cx| outside.update(cx, |s, _| s.dragging = false))
            .on_key_down(move |event, window, cx| {
                if !event.keystroke.modifiers.platform { return; }
                match event.keystroke.key.as_str() {
                    "c" => {
                        let selection = state.read(cx);
                        let range = selection.anchor.min(selection.cursor)..selection.anchor.max(selection.cursor);
                        if let Some(text) = content.get(range).filter(|s| !s.is_empty()) {
                            cx.write_to_clipboard(ClipboardItem::new_string(text.to_owned()));
                            cx.stop_propagation();
                        }
                    }
                    "a" => {
                        state.update(cx, |s, _| { s.anchor = 0; s.cursor = content.len(); });
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
    #[gpui::test]
    fn selected_unicode_text_copies_to_clipboard(cx: &mut TestAppContext) {
        struct Message;
        impl Render for Message {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().size_full().child(SelectableText { id: "test-selection".into(), text: "Hello café 🦀".into(), highlights: vec![], links: vec![] })
            }
        }
        let (view, cx) = cx.add_window_view(|_, _| Message);
        cx.draw(point(px(0.), px(0.)), size(px(400.), px(200.)), |_, _| view.clone().into_any_element());
        let bounds = cx.debug_bounds("selectable-text").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-a cmd-c");
        assert_eq!(cx.read_from_clipboard().and_then(|item| item.text()), Some("Hello café 🦀".into()));
        cx.simulate_mouse_down(point(bounds.left() + px(1.), bounds.center().y), MouseButton::Left, Modifiers::default());
        cx.simulate_mouse_move(point(bounds.right() - px(1.), bounds.center().y), MouseButton::Left, Modifiers::default());
        cx.simulate_mouse_up(point(bounds.right() - px(1.), bounds.center().y), MouseButton::Left, Modifiers::default());
        cx.simulate_keystrokes("cmd-c");
        assert_eq!(cx.read_from_clipboard().and_then(|item| item.text()), Some("Hello café 🦀".into()));
    }
}
