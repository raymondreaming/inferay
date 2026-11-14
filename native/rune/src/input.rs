use crate::colors::{self, rgb, rgba};
use crate::ui::Ink;
use crate::zoom::ui;
use rune::{El, TextEdit, col, text_input};

pub struct TextInput {
    pub edit: TextEdit,
    pub placeholder: String,
    pub submit_on_enter: bool,
    pub secret: bool,
    pub typography: (f32, f32),
    pub height_limits: (f32, f32),
}

impl Default for TextInput {
    fn default() -> Self {
        Self::new()
    }
}

impl TextInput {
    pub fn new() -> Self {
        Self {
            edit: TextEdit::new(""),
            placeholder: "Message… (/ commands, @ files)".into(),
            submit_on_enter: false,
            secret: false,
            typography: (colors::INPUT_TEXT, colors::INPUT_LINE_HEIGHT),
            height_limits: (20., 120.),
        }
    }

    pub fn field(placeholder: &str) -> Self {
        Self {
            placeholder: placeholder.to_owned(),
            ..Self::new()
        }
    }

    pub fn content(&self) -> &str {
        &self.edit.text
    }

    pub fn set_content(&mut self, text: &str) {
        let focused = self.edit.focused;
        self.edit = TextEdit::new(text);
        self.edit.focused = focused;
    }

    pub fn clear(&mut self) {
        self.edit.clear();
    }

    pub fn focus(&mut self) {
        self.edit.focused = true;
    }

    pub fn is_focused(&self) -> bool {
        self.edit.focused
    }

    pub fn completion_cursor(&self) -> Option<usize> {
        let (start, end) = self.edit.range();
        (!self.edit.is_composing() && start == end)
            .then(|| self.edit.text[..end].encode_utf16().count())
    }

    pub fn ink(&self) -> Ink {
        Ink::new(self.typography.0).line(self.typography.1)
    }
}

/// The editable text itself. Attach `on_submit`, `on_input_key` and `on_input_change`
/// to the returned element, then pass it to [`frame`].
pub fn field<S: 'static>(
    input: &TextInput,
    key: impl Into<String>,
    access: impl for<'a> Fn(&'a mut S) -> &'a mut TextInput + Clone + 'static,
) -> El {
    let ink = input.ink();
    let mut field = text_input(&input.edit, ink.style())
        .key(key.into())
        .color(rgb(colors::TEXT))
        .placeholder(input.placeholder.clone(), rgba(0xebebeb80))
        .caret(rgb(colors::TEXT), rgba(0xebebeb30))
        .label(input.placeholder.clone())
        .w_full()
        .on_edit(move |s: &mut S| &mut access(s).edit);
    if input.secret {
        field = field.secure();
    }
    field
}

/// Inserts a newline on Return for fields that don't submit on Enter.
pub fn newline_on_enter<S: 'static>(
    field: El,
    access: impl for<'a> Fn(&'a mut S) -> &'a mut TextInput + 'static,
) -> El {
    field.on_submit(move |s: &mut S, _| access(s).edit.insert("\n"))
}

/// Clamps the field between the input's height limits, scrolling once it grows past the top.
pub fn frame(input: &TextInput, field: El) -> El {
    let (min, max) = input.height_limits;
    if min == max {
        return col().w_full().shrink().h(ui(min)).child(field);
    }
    let line = input.typography.1;
    let grown = rune::auto_grow(
        field,
        (min / line).round().max(1.) as usize,
        (max / line).floor().max(1.) as usize,
    );
    col().w_full().shrink().min_h(ui(min)).child(grown)
}
