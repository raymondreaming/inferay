use super::*;
use crate::colors::rgba;
use crate::ui::{Ink, button, menu_surface};
use crate::zoom::ui;
use inferay_presentation::composer;
use rune::{El, KeyEvent, col};
use serde_json::{Value, json};

pub(crate) struct State {
    pub(crate) menu: Value,
    commands: Vec<inferay_core::provider_config::SlashCommand>,
    task: Option<Task>,
    error: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            menu: json!({"show":false,"selectedIdx":0,"index":-1,"query":""}),
            commands: vec![],
            task: None,
            error: None,
        }
    }
}

impl State {
    fn matches(&self) -> Vec<usize> {
        serde_json::from_value(composer::menu_commands(
            &json!({"state":self.menu,"commands":self.commands}),
        ))
        .unwrap_or_default()
    }
}

fn slash_rows_key(index: usize) -> String {
    format!("slash-rows-{index}")
}

impl Workspace {
    pub(crate) fn track_completions(&mut self, index: usize) {
        let chat = &mut self.conversations[index];
        let state = &mut chat.completion;
        let Some(cursor) = chat.input.completion_cursor() else {
            state.menu["show"] = json!(false);
            return;
        };
        let next = composer::menu_input(
            &json!({"state":state.menu,"value":chat.input.content(),"cursorPos":cursor,"trigger":"/"}),
        );
        if next.is_null() {
            return;
        }
        let opening = state.menu["show"] != true && next["show"] == true;
        state.menu = next;
        if opening {
            self.load_completions(index);
        }
    }

    fn load_completions(&mut self, index: usize) {
        let provider = self.conversations[index]
            .config
            .agent_kind
            .as_str()
            .to_owned();
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let state = &mut self.conversations[index].completion;
        state.commands.clear();
        state.error = None;
        state.task = Some(crate::task::spawn(
            async move {
                let backend = backend
                    .get_or_try_init(|| Backend::connect(profile))
                    .await?;
                let value = backend
                    .request(
                        reqwest::Method::GET,
                        &format!("/api/agent/commands?kind={provider}"),
                        None,
                    )
                    .await?;
                serde_json::from_value(value).map_err(anyhow::Error::from)
            },
            move |view: &mut Workspace, result, _| {
                let chat = &mut view.conversations[index];
                if chat.closed {
                    return;
                }
                let state = &mut chat.completion;
                state.task = None;
                match result {
                    Ok(commands) => state.commands = commands,
                    Err(error) => state.error = Some(format!("Could not load skills: {error:#}")),
                }
            },
        ));
    }

    fn select_completion(&mut self, index: usize, selected: usize) {
        let chat = &mut self.conversations[index];
        let Some(command) = chat
            .completion
            .matches()
            .get(selected)
            .and_then(|&i| chat.completion.commands.get(i))
        else {
            return;
        };
        let Some(cursor) = chat.input.completion_cursor() else {
            return;
        };
        let start = chat.completion.menu["index"].as_u64().unwrap_or(0) as usize;
        let content = chat.input.content();
        let suffix = if cursor == content.encode_utf16().count() {
            " "
        } else {
            ""
        };
        let replacement = format!("/{}{suffix}", command.name);
        let byte = |utf16: usize| {
            let mut units = 0;
            for (i, c) in content.char_indices() {
                if units >= utf16 {
                    return i;
                }
                units += c.len_utf16();
            }
            content.len()
        };
        let (from, to) = (byte(start), byte(cursor));
        chat.input.edit.set_selection(from, to);
        chat.input.edit.insert(&replacement);
        chat.completion.menu["show"] = json!(false);
        chat.input.focus();
    }

    pub(crate) fn completion_key(&mut self, index: usize, event: &KeyEvent, tx: &mut Tx) -> bool {
        use rune::Key;
        let chat = &mut self.conversations[index];
        if chat.completion.menu["show"] != true || chat.input.completion_cursor().is_none() {
            return false;
        }
        let count = chat.completion.matches().len();
        let selected = chat.completion.menu["selectedIdx"].as_u64().unwrap_or(0) as usize;
        let shift = event.mods.shift;
        match &event.key {
            Key::Escape => chat.completion.menu["show"] = json!(false),
            Key::Up | Key::Down if count > 0 => {
                let selected = if matches!(event.key, Key::Up) {
                    (selected + count - 1) % count
                } else {
                    (selected + 1) % count
                };
                chat.completion.menu["selectedIdx"] = json!(selected);
                tx.scroll_into_view(format!("slash-{index}-{selected}"));
            }
            Key::Enter | Key::Tab if count > 0 && !shift => self.select_completion(index, selected),
            Key::Enter | Key::Tab if chat.completion.task.is_some() && !shift => {}
            _ => return false,
        }
        true
    }

    pub(crate) fn completion_popup(&self, index: usize) -> El {
        let state = &self.conversations[index].completion;
        let matches = state.matches();
        let mut rows = col()
            .key(slash_rows_key(index))
            .max_h(ui(240.))
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            });
        let body = Ink::body();
        if state.task.is_some() {
            rows = rows.child(body.text("Loading skills…"));
        }
        if let Some(error) = &state.error {
            rows = rows.child(body.text(error.clone()));
        }
        if matches.is_empty() && state.task.is_none() && state.error.is_none() {
            rows = rows.child(body.text("No matching commands"));
        }
        for (selected, i) in matches.into_iter().enumerate() {
            let command = &state.commands[i];
            let is_selected = state.menu["selectedIdx"] == selected;
            let mut row = col()
                .key(format!("slash-{index}-{selected}"))
                .role("button")
                .label(command.name.clone())
                .focusable(true)
                .no_focus_ring()
                .w_full()
                .px(ui(9.))
                .py(ui(6.))
                .gap(ui(6.))
                .radius(ui(6.))
                .items_start()
                .cursor(rune::Cursor::Pointer);
            row = if is_selected {
                crate::ui::swap_fill(
                    row,
                    &format!("slash-{index}-{selected}"),
                    Some(rgba(0xebebeb17)),
                    rgba(0xffffff0d),
                )
            } else {
                row.hover(rgba(0xffffff0d))
            };
            row = row
                .child(Ink::small().text(format!(
                    "/{}{}",
                    command.name,
                    if command.is_from_library == Some(true) {
                        " · Skill"
                    } else {
                        ""
                    }
                )))
                .child(
                    Ink::new(11.)
                        .hex(0xebebeb80)
                        .text(command.description.clone()),
                )
                .preserve_focus_on_press(true)
                .on_press(move |view: &mut Workspace| view.select_completion(index, selected));
            rows = rows.child(row);
        }
        let above = rune::memo::layout_size(&super::composer::composer_key(index))
            .map_or(0., |[_, height]| height);
        menu_surface()
            .key(format!("slash-menu-{index}"))
            .pin(Some(ui(12.)), None, Some(ui(12.)), Some(above))
            .child(rows)
            .child(
                button("Manage skills…")
                    .key(format!("manage-skills-{index}"))
                    .preserve_focus_on_press(true)
                    .on_press(move |view: &mut Workspace| {
                        view.conversations[index].completion.menu["show"] = json!(false);
                        view.set_settings(true);
                        view.settings_page("skills");
                    }),
            )
    }
}
