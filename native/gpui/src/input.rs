// Adapted from Zed GPUI examples/input.rs, Apache-2.0. See NOTICE.
use std::ops::Range;

use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, FocusHandle, Focusable, GlobalElementId, KeyBinding, LayoutId, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, Point, SharedString, Style, TextRun,
    UTF16Selection, UnderlineStyle, Window, WrappedLine, actions, div, fill, point, prelude::*, px,
    relative, rgb, rgba, size,
};
use unicode_segmentation::*;

actions!(
    text_input,
    [
        Undo,
        Redo,
        Up,
        Down,
        SelectUp,
        SelectDown,
        Backspace,
        Delete,
        Left,
        Right,
        SelectLeft,
        SelectRight,
        SelectAll,
        Home,
        End,
        ShowCharacterPalette,
        Newline,
        Enter,
        Paste,
        Cut,
        Copy,
    ]
);

#[derive(Clone)]
struct EditState {
    content: SharedString,
    selection: Range<usize>,
    reversed: bool,
}

pub struct Submit;
impl gpui::EventEmitter<Submit> for TextInput {}

pub struct TextInput {
    pub submit_on_enter: bool,
    focus_handle: FocusHandle,
    pub content: SharedString,
    placeholder: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    lines: Vec<WrappedLine>,
    scroll_y: Pixels,
    last_bounds: Option<Bounds<Pixels>>,
    is_selecting: bool,
    undo: Vec<EditState>,
    redo: Vec<EditState>,
    preferred_x: Option<Pixels>,
}

impl TextInput {
    pub fn field(placeholder: &str, cx: &mut Context<Self>) -> Self {
        let mut input = Self::new(cx);
        input.placeholder = placeholder.to_owned().into();
        input
    }
    pub fn set_content(&mut self, text: &str, cx: &mut Context<Self>) {
        self.content = text.to_owned().into();
        self.selected_range = 0..0;
        self.selection_reversed = false;
        self.marked_range = None;
        self.undo.clear();
        self.redo.clear();
        self.scroll_y = px(0.);
        cx.notify();
    }
    fn edit_state(&self) -> EditState {
        EditState {
            content: self.content.clone(),
            selection: self.selected_range.clone(),
            reversed: self.selection_reversed,
        }
    }
    fn restore_edit(&mut self, state: EditState, cx: &mut Context<Self>) {
        self.content = state.content;
        self.selected_range = state.selection;
        self.selection_reversed = state.reversed;
        self.marked_range = None;
        self.preferred_x = None;
        cx.notify();
    }
    fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(state) = self.undo.pop() {
            self.redo.push(self.edit_state());
            self.restore_edit(state, cx);
        }
    }
    fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(state) = self.redo.pop() {
            self.undo.push(self.edit_state());
            self.restore_edit(state, cx);
        }
    }
    fn vertical(&mut self, down: bool, select: bool, cx: &mut Context<Self>) {
        let Some(bounds) = self.last_bounds else {
            return;
        };
        let position = self.position_for_index(self.cursor_offset());
        let x = self.preferred_x.unwrap_or(position.x);
        let y = position.y + px(crate::colors::INPUT_LINE_HEIGHT) * if down { 1.5 } else { -0.5 };
        let index = if y < px(0.) {
            0
        } else {
            self.index_for_mouse_position(bounds.origin + point(x, y - self.scroll_y))
        };
        if select {
            self.select_to(index, cx);
        } else {
            self.move_to(index, cx);
        }
        self.preferred_x = Some(x);
    }
    fn enter(&mut self, _: &Enter, window: &mut Window, cx: &mut Context<Self>) {
        if self.submit_on_enter {
            if self.marked_range.is_none() {
                cx.emit(Submit);
            }
        } else {
            self.newline(&Newline, window, cx);
        }
    }
    fn newline(&mut self, _: &Newline, window: &mut Window, cx: &mut Context<Self>) {
        self.replace_text_in_range(None, "\n", window, cx);
    }
    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.previous_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx)
        }
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.next_boundary(self.selected_range.end), cx);
        } else {
            self.move_to(self.selected_range.end, cx)
        }
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
        self.select_to(self.content.len(), cx)
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.content.len(), cx);
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let prev = self.previous_boundary(self.cursor_offset());
            if self.cursor_offset() == prev {
                window.play_system_bell();
                return;
            }
            self.select_to(prev, cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let next = self.next_boundary(self.cursor_offset());
            if self.cursor_offset() == next {
                window.play_system_bell();
                return;
            }
            self.select_to(next, cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.is_selecting = true;

        if event.modifiers.shift {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        } else {
            self.move_to(self.index_for_mouse_position(event.position), cx)
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _window: &mut Window, _: &mut Context<Self>) {
        self.is_selecting = false;
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.is_selecting {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        }
    }

    fn show_character_palette(
        &mut self,
        _: &ShowCharacterPalette,
        window: &mut Window,
        _: &mut Context<Self>,
    ) {
        window.show_character_palette();
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(
                None,
                &text.replace("\r\n", "\n").replace('\r', "\n"),
                window,
                cx,
            );
        }
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_string(),
            ));
        }
    }
    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_string(),
            ));
            self.replace_text_in_range(None, "", window, cx)
        }
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.preferred_x = None;
        cx.notify()
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        if self.content.is_empty() {
            return 0;
        }

        let Some(bounds) = self.last_bounds else {
            return 0;
        };
        let mut y = position.y - bounds.top() + self.scroll_y;
        let mut base = 0;
        for line in &self.lines {
            let height = line.size(px(crate::colors::INPUT_LINE_HEIGHT)).height;
            if y < height {
                let index = line.closest_index_for_position(
                    point(position.x - bounds.left(), y.max(px(0.))),
                    px(crate::colors::INPUT_LINE_HEIGHT),
                );
                return (base + index.unwrap_or_else(|index| index)).min(self.content.len());
            }
            base += line.len() + 1;
            y -= height;
        }
        self.content.len()
    }

    fn position_for_index(&self, index: usize) -> Point<Pixels> {
        text_position(&self.lines, index)
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.preferred_x = None;
        if self.selection_reversed {
            self.selected_range.start = offset
        } else {
            self.selected_range.end = offset
        };
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        cx.notify()
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf8_offset = 0;
        let mut utf16_count = 0;

        for ch in self.content.chars() {
            if utf16_count >= offset {
                break;
            }
            utf16_count += ch.len_utf16();
            utf8_offset += ch.len_utf8();
        }

        utf8_offset
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut utf16_offset = 0;
        let mut utf8_count = 0;

        for ch in self.content.chars() {
            if utf8_count >= offset {
                break;
            }
            utf8_count += ch.len_utf8();
            utf16_offset += ch.len_utf16();
        }

        utf16_offset
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range_utf16: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range_utf16.start)..self.offset_from_utf16(range_utf16.end)
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(idx, _)| (idx < offset).then_some(idx))
            .unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(idx, _)| (idx > offset).then_some(idx))
            .unwrap_or(self.content.len())
    }
}

impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
        actual_range.replace(self.range_to_utf16(&range));
        Some(self.content[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        self.marked_range
            .as_ref()
            .map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        self.marked_range = None;
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());

        if self.marked_range.is_none() {
            self.undo.push(self.edit_state());
            if self.undo.len() > 100 {
                self.undo.remove(0);
            }
            self.redo.clear();
        }
        self.preferred_x = None;
        self.content =
            (self.content[0..range.start].to_owned() + new_text + &self.content[range.end..])
                .into();
        self.selected_range = range.start + new_text.len()..range.start + new_text.len();
        self.selection_reversed = false;
        self.marked_range.take();
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());

        if self.marked_range.is_none() {
            self.undo.push(self.edit_state());
            if self.undo.len() > 100 {
                self.undo.remove(0);
            }
            self.redo.clear();
        }
        self.preferred_x = None;
        self.content =
            (self.content[0..range.start].to_owned() + new_text + &self.content[range.end..])
                .into();
        if !new_text.is_empty() {
            self.marked_range = Some(range.start..range.start + new_text.len());
        } else {
            self.marked_range = None;
        }
        self.selected_range = new_selected_range_utf16
            .as_ref()
            .map(|selection| {
                let byte_offset = |units: usize| {
                    let mut count = 0;
                    new_text
                        .char_indices()
                        .find_map(|(i, ch)| {
                            if count >= units {
                                Some(i)
                            } else {
                                count += ch.len_utf16();
                                None
                            }
                        })
                        .unwrap_or(new_text.len())
                };
                range.start + byte_offset(selection.start)..range.start + byte_offset(selection.end)
            })
            .unwrap_or_else(|| range.start + new_text.len()..range.start + new_text.len());

        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range_utf16);
        let start = self.position_for_index(range.start);
        let end = self.position_for_index(range.end);
        Some(Bounds::new(
            bounds.origin + start - point(px(0.), self.scroll_y),
            size(
                if end.y == start.y {
                    (end.x - start.x).max(px(1.))
                } else {
                    px(1.)
                },
                px(crate::colors::INPUT_LINE_HEIGHT),
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        self.last_bounds?;
        Some(self.offset_to_utf16(self.index_for_mouse_position(position)))
    }
}

struct TextElement {
    input: Entity<TextInput>,
}

fn text_position(lines: &[WrappedLine], index: usize) -> Point<Pixels> {
    let mut base = 0;
    let mut y = px(0.);
    for line in lines {
        if index <= base + line.len() {
            return line
                .position_for_index(index - base, px(crate::colors::INPUT_LINE_HEIGHT))
                .unwrap_or_default()
                + point(px(0.), y);
        }
        base += line.len() + 1;
        y += line.size(px(crate::colors::INPUT_LINE_HEIGHT)).height;
    }
    point(px(0.), y)
}
struct PrepaintState {
    lines: Vec<WrappedLine>,
    scroll_y: Pixels,
}
impl IntoElement for TextElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for TextElement {
    type RequestLayoutState = ();
    type PrepaintState = PrepaintState;
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        let content = self.input.read(cx).content.clone();
        let font = window.text_style().font();
        let layout = window.request_measured_layout(style, move |known, available, window, _| {
            let width = known.width.or(match available.width {
                gpui::AvailableSpace::Definite(w) => Some(w),
                _ => None,
            });
            let run = TextRun {
                len: content.len(),
                font: font.clone(),
                color: rgb(0xebebeb).into(),
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            let height = window
                .text_system()
                .shape_text(
                    content.clone(),
                    px(crate::colors::INPUT_TEXT),
                    &[run],
                    width,
                    None,
                )
                .map(|lines| {
                    lines
                        .iter()
                        .map(|l| l.size(px(crate::colors::INPUT_LINE_HEIGHT)).height)
                        .fold(px(0.), |a, b| a + b)
                })
                .unwrap_or(px(crate::colors::INPUT_LINE_HEIGHT));
            size(width.unwrap_or(px(200.)), height.max(px(20.)).min(px(120.)))
        });
        (layout, ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> PrepaintState {
        let input = self.input.read(cx);
        let text = if input.content.is_empty() {
            input.placeholder.clone()
        } else {
            input.content.clone()
        };
        let color = if input.content.is_empty() {
            rgba(0xebebeb80).into()
        } else {
            window.text_style().color
        };
        let mut boundaries = vec![0, text.len()];
        if !input.content.is_empty() {
            boundaries.extend([input.selected_range.start, input.selected_range.end]);
            if let Some(marked) = &input.marked_range {
                boundaries.extend([marked.start, marked.end]);
            }
        }
        boundaries.sort_unstable();
        boundaries.dedup();
        let runs: Vec<_> = boundaries
            .windows(2)
            .map(|range| TextRun {
                len: range[1] - range[0],
                font: window.text_style().font(),
                color,
                background_color: input
                    .selected_range
                    .contains(&range[0])
                    .then(|| rgba(0xebebeb30).into()),
                underline: input
                    .marked_range
                    .as_ref()
                    .filter(|r| r.contains(&range[0]))
                    .map(|_| UnderlineStyle {
                        color: Some(color),
                        thickness: px(1.),
                        wavy: false,
                    }),
                strikethrough: None,
            })
            .collect();
        let lines = window
            .text_system()
            .shape_text(
                text,
                px(crate::colors::INPUT_TEXT),
                &runs,
                Some(bounds.size.width),
                input.content.is_empty().then_some(1),
            )
            .unwrap_or_default();
        let cursor = text_position(&lines, input.cursor_offset());
        let scroll_y = if cursor.y < input.scroll_y {
            cursor.y
        } else {
            input
                .scroll_y
                .max(cursor.y + px(crate::colors::INPUT_LINE_HEIGHT) - bounds.size.height)
        }
        .max(px(0.));
        PrepaintState {
            lines: lines.into_vec(),
            scroll_y,
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        state: &mut PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let input = self.input.read(cx);
        let focus = input.focus_handle.clone();
        let cursor = input.cursor_offset();
        let selection_empty = input.selected_range.is_empty();
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
            let mut origin = bounds.origin - point(px(0.), state.scroll_y);
            for line in &state.lines {
                let _ = line.paint_background(
                    origin,
                    px(crate::colors::INPUT_LINE_HEIGHT),
                    gpui::TextAlign::Left,
                    None,
                    window,
                    cx,
                );
                let _ = line.paint(
                    origin,
                    px(crate::colors::INPUT_LINE_HEIGHT),
                    gpui::TextAlign::Left,
                    None,
                    window,
                    cx,
                );
                origin.y += line.size(px(crate::colors::INPUT_LINE_HEIGHT)).height;
            }
            if focus.is_focused(window) && selection_empty {
                window.paint_quad(fill(
                    Bounds::new(
                        bounds.origin + text_position(&state.lines, cursor)
                            - point(px(0.), state.scroll_y),
                        size(px(1.), px(crate::colors::INPUT_LINE_HEIGHT)),
                    ),
                    rgb(0xebebeb),
                ));
            }
        });
        self.input.update(cx, |input, _| {
            input.lines = std::mem::take(&mut state.lines);
            input.last_bounds = Some(bounds);
            input.scroll_y = state.scroll_y;
        });
    }
}

impl Render for TextInput {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("composer-input")
            .role(gpui::Role::MultilineTextInput)
            .aria_label(self.placeholder.clone())
            .aria_value(self.content.clone())
            .tab_index(0)
            .flex()
            .key_context("TextInput")
            .track_focus(&self.focus_handle(cx))
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::undo))
            .on_action(cx.listener(Self::redo))
            .on_action(cx.listener(|s, _: &Up, _, cx| s.vertical(false, false, cx)))
            .on_action(cx.listener(|s, _: &Down, _, cx| s.vertical(true, false, cx)))
            .on_action(cx.listener(|s, _: &SelectUp, _, cx| s.vertical(false, true, cx)))
            .on_action(cx.listener(|s, _: &SelectDown, _, cx| s.vertical(true, true, cx)))
            .on_action(cx.listener(Self::newline))
            .on_action(cx.listener(Self::enter))
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::show_character_palette))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::copy))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .w_full()
            .min_w_0()
            .overflow_hidden()
            .line_height(px(crate::colors::INPUT_LINE_HEIGHT))
            .text_size(px(crate::colors::INPUT_TEXT))
            .child(TextElement { input: cx.entity() })
    }
}

impl Focusable for TextInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl TextInput {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            submit_on_enter: false,
            focus_handle: cx.focus_handle(),
            content: "".into(),
            placeholder: "Message… (/ commands, @ files)".into(),
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            lines: Vec::new(),
            scroll_y: px(0.),
            last_bounds: None,
            is_selecting: false,
            undo: vec![],
            redo: vec![],
            preferred_x: None,
        }
    }
}
pub fn bind(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-z", Undo, Some("TextInput")),
        KeyBinding::new("cmd-shift-z", Redo, Some("TextInput")),
        KeyBinding::new("up", Up, Some("TextInput")),
        KeyBinding::new("down", Down, Some("TextInput")),
        KeyBinding::new("shift-up", SelectUp, Some("TextInput")),
        KeyBinding::new("shift-down", SelectDown, Some("TextInput")),
        KeyBinding::new("enter", Enter, Some("TextInput")),
        KeyBinding::new("shift-enter", Newline, Some("TextInput")),
        KeyBinding::new("backspace", Backspace, Some("TextInput")),
        KeyBinding::new("delete", Delete, Some("TextInput")),
        KeyBinding::new("left", Left, Some("TextInput")),
        KeyBinding::new("right", Right, Some("TextInput")),
        KeyBinding::new("shift-left", SelectLeft, Some("TextInput")),
        KeyBinding::new("shift-right", SelectRight, Some("TextInput")),
        KeyBinding::new("cmd-a", SelectAll, Some("TextInput")),
        KeyBinding::new("cmd-v", Paste, Some("TextInput")),
        KeyBinding::new("cmd-c", Copy, Some("TextInput")),
        KeyBinding::new("cmd-x", Cut, Some("TextInput")),
        KeyBinding::new("home", Home, Some("TextInput")),
        KeyBinding::new("end", End, Some("TextInput")),
        KeyBinding::new("ctrl-cmd-space", ShowCharacterPalette, Some("TextInput")),
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn editing_preserves_unicode_and_multiline_selection(cx: &mut gpui::TestAppContext) {
        cx.update(bind);
        let window = cx.add_window(|window, cx| {
            let input = TextInput::new(cx);
            window.focus(&input.focus_handle(cx), cx);
            input
        });
        window
            .update(cx, |input, window, cx| {
                input.replace_text_in_range(None, "café 👋\nsecond line", window, cx);
                assert_eq!(input.content.as_ref(), "café 👋\nsecond line");
                // Platform IME ranges count UTF-16 units, not UTF-8 bytes.
                input.replace_text_in_range(Some(5..7), "🌍", window, cx);
                assert_eq!(input.content.as_ref(), "café 🌍\nsecond line");
                input.select_all(&SelectAll, window, cx);
                input.replace_text_in_range(None, "e\u{301}👨‍👩‍👧‍👦", window, cx);
                input.backspace(&Backspace, window, cx);
                assert_eq!(input.content.as_ref(), "e\u{301}");
                input.backspace(&Backspace, window, cx);
                assert!(input.content.is_empty());
            })
            .unwrap();
    }
    #[gpui::test]
    fn composer_enter_submits_but_shift_enter_and_fields_keep_newlines(
        cx: &mut gpui::TestAppContext,
    ) {
        let submitted = std::rc::Rc::new(std::cell::Cell::new(0));
        let window = cx.add_window(|_, cx| TextInput::new(cx));
        let events = submitted.clone();
        let subscription = cx.update(|cx| {
            let input = window.root(cx).unwrap();
            cx.subscribe(&input, move |_, _: &Submit, _| events.set(events.get() + 1))
        });
        window
            .update(cx, |input, window, cx| {
                input.set_content("draft", cx);
                input.enter(&Enter, window, cx);
                assert_eq!(input.content.as_ref(), "\ndraft");
                input.set_content("draft", cx);
                input.submit_on_enter = true;
                input.enter(&Enter, window, cx);
                assert_eq!(input.content.as_ref(), "draft");
                input.newline(&Newline, window, cx);
                assert_eq!(input.content.as_ref(), "\ndraft");
                input.marked_range = Some(0..1);
                input.enter(&Enter, window, cx);
            })
            .unwrap();
        cx.run_until_parked();
        assert_eq!(submitted.get(), 1);
        drop(subscription);
    }

    #[gpui::test]
    fn pasted_lines_undo_redo_and_ime_selection(cx: &mut gpui::TestAppContext) {
        let window = cx.add_window(|_, cx| TextInput::new(cx));
        window
            .update(cx, |input, window, cx| {
                cx.write_to_clipboard(ClipboardItem::new_string("first\r\nsecond 🌍".into()));
                input.paste(&Paste, window, cx);
                assert_eq!(input.content.as_ref(), "first\nsecond 🌍");
                input.undo(&Undo, window, cx);
                assert!(input.content.is_empty());
                input.redo(&Redo, window, cx);
                assert_eq!(input.content.as_ref(), "first\nsecond 🌍");
                input.select_all(&SelectAll, window, cx);
                input.replace_text_in_range(None, "prefix ", window, cx);
                input.replace_and_mark_text_in_range(None, "🌍界", Some(2..3), window, cx);
                assert_eq!(&input.content[input.selected_range.clone()], "界");
                input.replace_text_in_range(None, "世界", window, cx);
                assert_eq!(input.content.as_ref(), "prefix 世界");
                input.undo(&Undo, window, cx);
                assert_eq!(input.content.as_ref(), "prefix ");
            })
            .unwrap();
    }
}
