//! Native slash picker backed by the same live command catalog used by agents.
use super::*;
use crate::backend::{Backend, RUNTIME};
use inferay_presentation::composer;
use serde_json::{Value, json};

pub(super) struct State {
    pub menu: Value,
    commands: Vec<inferay_core::provider_config::SlashCommand>,
    subscription: Option<Subscription>,
    task: Option<Task<()>>,
    error: Option<String>,
    scroll: ScrollHandle,
}
impl Default for State {
    fn default() -> Self {
        Self {
            menu: json!({"show":false,"selectedIdx":0,"index":-1,"query":""}),
            commands: vec![],
            subscription: None,
            task: None,
            error: None,
            scroll: ScrollHandle::new(),
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
impl WorkspaceView {
    pub(super) fn track_completions(&mut self, index: usize, cx: &mut Context<Self>) {
        if self.conversations[index].completion.subscription.is_some() {
            return;
        }
        let input = self.conversations[index].input.clone();
        self.conversations[index].completion.subscription = Some(cx.observe(&input, move |view, input, cx| {
            let input = input.read(cx);
            let state = &mut view.conversations[index].completion;
            let Some(cursor) = input.completion_cursor() else { state.menu["show"] = json!(false); cx.notify(); return; };
            let next = composer::menu_input(&json!({"state":state.menu,"value":input.content.as_ref(),"cursorPos":cursor,"trigger":"/"}));
            if next.is_null() { return; }
            let opening = state.menu["show"] != true && next["show"] == true;
            state.menu = next;
            state.scroll.set_offset(point(px(0.), px(0.)));
            if opening { view.load_completions(index, cx); }
            cx.notify();
        }));
    }
    fn load_completions(&mut self, index: usize, cx: &mut Context<Self>) {
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
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
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
            })
        });
        state.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |view, cx| {
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
                cx.notify();
            });
        }));
    }
    fn select_completion(
        &mut self,
        index: usize,
        selected: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let chat = &mut self.conversations[index];
        let Some(command) = chat
            .completion
            .matches()
            .get(selected)
            .and_then(|&i| chat.completion.commands.get(i))
        else {
            return;
        };
        let input = chat.input.read(cx);
        let Some(cursor) = input.completion_cursor() else {
            return;
        };
        let start = chat.completion.menu["index"].as_u64().unwrap_or(0) as usize;
        let suffix = if cursor == input.content.encode_utf16().count() {
            " "
        } else {
            ""
        };
        let replacement = format!("/{}{suffix}", command.name);
        chat.input.update(cx, |input, cx| {
            input.replace_text_in_range(Some(start..cursor), &replacement, window, cx)
        });
        chat.completion.menu["show"] = json!(false);
        window.focus(&chat.input.focus_handle(cx), cx);
        cx.notify();
    }
    pub(super) fn completion_key(
        &mut self,
        index: usize,
        key: &str,
        shift: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let chat = &mut self.conversations[index];
        if chat.completion.menu["show"] != true || chat.input.read(cx).completion_cursor().is_none()
        {
            return false;
        }
        let count = chat.completion.matches().len();
        let selected = chat.completion.menu["selectedIdx"].as_u64().unwrap_or(0) as usize;
        match key {
            "escape" => chat.completion.menu["show"] = json!(false),
            "up" | "down" if count > 0 => {
                let selected = if key == "up" {
                    (selected + count - 1) % count
                } else {
                    (selected + 1) % count
                };
                chat.completion.menu["selectedIdx"] = json!(selected);
                chat.completion.scroll.scroll_to_item(selected);
            }
            "enter" | "tab" if count > 0 && !shift => {
                self.select_completion(index, selected, window, cx)
            }
            // Loading must not turn Enter into an accidental submission of '/'.
            "enter" | "tab" if chat.completion.task.is_some() && !shift => {}
            _ => return false,
        }
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
        true
    }
    pub(super) fn completion_popup(
        &self,
        index: usize,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let state = &self.conversations[index].completion;
        let matches = state.matches();
        crate::menu_surface(("slash-menu", index))
            .debug_selector(|| "slash-menu".into())
            .bottom(relative(1.))
            .left(ui(12.))
            .right(ui(12.))
            .on_mouse_down_out(cx.listener(move |view, _, _, cx| {
                view.conversations[index].completion.menu["show"] = json!(false);
                cx.notify();
            }))
            .child(
                div()
                    .id(("slash-rows", index))
                    .max_h(ui(240.))
                    .overflow_y_scroll()
                    .track_scroll(&state.scroll)
                    .when(state.task.is_some(), |d| d.child("Loading skills…"))
                    .when_some(state.error.clone(), |d, error| d.child(error))
                    .when(
                        matches.is_empty() && state.task.is_none() && state.error.is_none(),
                        |d| d.child("No matching commands"),
                    )
                    .children(matches.into_iter().enumerate().map(|(selected, i)| {
                        let command = &state.commands[i];
                        button(SharedString::from(format!("slash-{}", command.name)), "")
                            .debug_selector({
                                let name = command.name.clone();
                                move || format!("slash-{name}")
                            })
                            .w_full()
                            .h_auto()
                            .py(ui(6.))
                            .flex_col()
                            .items_start()
                            .when(state.menu["selectedIdx"] == selected, |d| {
                                d.bg(rgba(0xebebeb17))
                            })
                            .child(format!(
                                "/{}{}",
                                command.name,
                                if command.is_from_library == Some(true) {
                                    " · Skill"
                                } else {
                                    ""
                                }
                            ))
                            .child(
                                div()
                                    .text_size(ui(11.))
                                    .text_color(rgba(0xebebeb80))
                                    .child(command.description.clone()),
                            )
                            .on_mouse_down(MouseButton::Left, |_, window, cx| {
                                window.prevent_default();
                                cx.stop_propagation();
                            })
                            .on_click(cx.listener(move |view, _, window, cx| {
                                view.select_completion(index, selected, window, cx)
                            }))
                    })),
            )
            .child(
                button(("manage-skills", index), "Manage skills…")
                    .debug_selector(|| "manage-skills".into())
                    .on_mouse_down(MouseButton::Left, |_, window, cx| {
                        window.prevent_default();
                        cx.stop_propagation();
                    })
                    .on_click(cx.listener(move |view, _, window, cx| {
                        view.conversations[index].completion.menu["show"] = json!(false);
                        view.set_settings(true, window, cx);
                        view.settings_page("skills", cx);
                    })),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn slash_picker_loads_custom_skills_and_selects_without_sending(cx: &mut TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let backend = RUNTIME
            .block_on(Backend::connect(profile.path().to_owned()))
            .unwrap();
        RUNTIME.block_on(backend.request(reqwest::Method::POST,"/api/prompts",Some(json!({
            "name":"Native custom skill","command":"zzz-native","description":"A custom skill from the live library","promptTemplate":"Fixture instructions"
        })))).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.status.clear();
            view.backend = std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend)));
            view.track_completions(0, cx);
            let input = view.conversations[0].input.clone();
            input.update(cx, |input, _| input.submit_on_enter = true);
            view.conversations[0].submit_subscription = Some(
                cx.subscribe(&input, |view, _, _: &crate::input::Submit, _| {
                    view.status = "unexpected submission".into()
                }),
            );
            view
        });
        cx.update(|_, cx| crate::input::bind(cx));
        let input = view.read_with(cx, |view, _| view.conversations[0].input.clone());
        cx.focus(&input);
        cx.simulate_input("✨ /zzz");
        cx.run_until_parked();
        cx.simulate_resize(size(px(900.), px(800.)));
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("slash-menu").is_some());
        assert!(cx.debug_bounds("slash-zzz-native").is_some());
        cx.simulate_keystrokes("down up enter");
        cx.run_until_parked();
        view.read_with(cx, |view, cx| {
            assert_eq!(
                view.conversations[0].input.read(cx).content.as_ref(),
                "✨ /zzz-native "
            );
            assert!(view.status.is_empty(), "selection submitted the message");
            assert_eq!(view.conversations[0].completion.menu["show"], false);
        });
        cx.simulate_input("/hel");
        cx.run_until_parked();
        cx.simulate_keystrokes("escape");
        view.read_with(cx, |view, _| {
            assert_eq!(view.conversations[0].completion.menu["show"], false)
        });
        // A new trigger reloads the current library; clicking inserts into the draft.
        cx.simulate_input(" /zzz");
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
            view.clone().into_any_element()
        });
        let row = cx.debug_bounds("slash-zzz-native").unwrap();
        cx.simulate_click(row.center(), Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |view, cx| {
            assert!(
                view.conversations[0]
                    .input
                    .read(cx)
                    .content
                    .ends_with("/zzz-native ")
            )
        });
        cx.simulate_input("/zzz");
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
            view.clone().into_any_element()
        });
        cx.simulate_keystrokes("tab");
        view.read_with(cx, |view, cx| {
            assert!(
                view.conversations[0]
                    .input
                    .read(cx)
                    .content
                    .ends_with("/zzz-native ")
            )
        });
        cx.simulate_input("/");
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
            view.clone().into_any_element()
        });
        let manage = cx.debug_bounds("manage-skills").unwrap();
        cx.simulate_click(manage.center(), Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(view.settings);
        });
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(800.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("skill-library").is_some());
    }
}
