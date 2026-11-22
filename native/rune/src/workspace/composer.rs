use super::*;
use crate::colors::rgba;
use crate::icons;
use crate::input;
use crate::ui::{Ink, SEMIBOLD, button, icon_sized, menu_surface, plain_button};
use crate::zoom::ui;
use rune::{El, col, el, row};

pub(crate) fn composer_key(index: usize) -> String {
    format!("chat-composer-{index}")
}

static ACTIVITY_STOPS: [(f32, f32); 5] = [
    (0., 0.1),
    (0.28, 0.98),
    (0.56, 0.32),
    (0.78, 0.78),
    (1., 0.1),
];

fn elapsed(start: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.;
    let seconds = ((now - start as f64).max(0.) / 1000.) as u64;
    if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m {}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h {}m", seconds / 3600, seconds / 60 % 60)
    }
}

fn activity_matrix() -> El {
    let mut matrix = el().size(ui(14.), ui(14.));
    for i in 0..25 {
        let row = i / 5;
        let column = i % 5;
        let ring = (2_i32 - row).abs() + (2_i32 - column).abs();
        let delay = (ring as f32 * 0.14 + (ring % 2) as f32 * 0.03) / 1.5;
        matrix = matrix.child(
            el().absolute(ui(column as f32 * 3.), ui(row as f32 * 3.))
                .size(ui(2.), ui(2.))
                .radius(ui(1.))
                .fill(rgba(0xebebebb3))
                .cycle(rune::Cycle {
                    period: 1.5,
                    phase: delay,
                    stops: &ACTIVITY_STOPS,
                    still: 0.5,
                    fps: 60.,
                }),
        );
    }
    matrix
}

fn icon_button(label: &str, glyph: &'static rune::Icon, size: f32) -> El {
    button("")
        .label(label.to_owned())
        .w(ui(28.))
        .h(ui(28.))
        .px(ui(6.))
        .child(icon_sized(glyph, size))
}

impl Workspace {
    pub(crate) fn any_chat_running(&self) -> bool {
        self.conversations
            .iter()
            .any(|chat| !chat.closed && chat.project == self.project && chat.run.is_loading)
    }

    pub(crate) fn composer(&self, index: usize) -> El {
        let chat = &self.conversations[index];
        let catalog =
            inferay_core::provider_config::renderer_catalog(&serde_json::Value::Null, &[]);
        let definition = match chat.config.agent_kind {
            inferay_core::provider_config::WorkspaceAgentKind::Claude => catalog.agents.claude,
            inferay_core::provider_config::WorkspaceAgentKind::Agent => catalog.agents.agent,
            _ => catalog.agents.codex,
        };
        let model = definition
            .models
            .iter()
            .find(|m| m.id == chat.config.model)
            .map(|m| m.short_label.as_ref().unwrap_or(&m.label).clone())
            .unwrap_or_else(|| chat.config.model.clone());
        let reasoning = definition
            .reasoning_levels
            .iter()
            .find(|r| r.id == chat.config.reasoning_level)
            .map(|r| r.label.clone())
            .unwrap_or_else(|| chat.config.reasoning_level.clone());
        let mut composer = col()
            .key(composer_key(index))
            .w_full()
            .max_w(ui(624.))
            .self_center()
            .px(ui(12.))
            .pt(ui(0.))
            .pb(ui(8.));
        if !self.status.is_empty() {
            composer = composer.child(
                col()
                    .px(ui(8.))
                    .pb(ui(10.))
                    .child(Ink::new(11.).hex(0xebebeb80).text(self.status.clone())),
            );
        }
        if chat.run.is_loading {
            let mut slot = row().h(ui(16.)).items_center();
            if let Some(start) = chat.run.start_time {
                let time = elapsed(start);
                slot = slot.child(
                    row()
                        .key(format!("activity-time-{index}"))
                        .label(format!("Agent active, {time} elapsed"))
                        .items_center()
                        .gap(ui(6.))
                        .child(activity_matrix())
                        .child(Ink::new(10.).mono().hex(0xebebeb80).line_text(time)),
                );
            }
            composer = composer.child(
                row()
                    .key("chat-activity")
                    .items_center()
                    .h(ui(20.))
                    .pb(ui(4.))
                    .child(slot),
            );
        }
        if !chat.images.is_empty() {
            let mut strip = row()
                .key(format!("draft-attachments-{index}"))
                .items_start()
                .gap(ui(6.))
                .w_full()
                .scroll_x()
                .px(ui(4.))
                .pt(ui(4.))
                .pb(ui(8.));
            let mut photos = row().items_start().gap(ui(6.));
            for (i, path) in chat.images.iter().enumerate() {
                photos = photos.child(
                    super::attachments::photo(
                        path.clone(),
                        format!("draft-photo-{index}-{i}"),
                        true,
                    )
                    .child(
                        button("")
                            .key(format!("remove-draft-image-{index}-{i}"))
                            .label("Remove image")
                            .pin(None, Some(ui(4.)), Some(0.), None)
                            .w(ui(18.))
                            .h(ui(18.))
                            .padding(ui(3.))
                            .radius(9999.)
                            .fill(rgba(0x181818e8))
                            .child(icon_sized(&icons::X, 12.))
                            .on_press(move |s: &mut Workspace| {
                                s.conversations[index].images.remove(i);
                            }),
                    ),
                );
            }
            strip = strip.child(photos);
            composer = composer.child(strip);
        }
        let shell_key = format!("chat-input-shell-{index}");
        let mut shell =
            crate::ui::composer_surface(&shell_key, chat.run.is_loading || chat.input.is_focused());
        if !chat.requests.is_empty() {
            shell = shell.child(self.provider_requests(index));
        }
        if !chat.queue.is_empty() {
            shell = shell.child(self.queue_rows(index));
        }
        let mut field = input::field(
            &chat.input,
            format!("composer-input-{index}"),
            move |s: &mut Workspace| &mut s.conversations[index].input,
        )
        .on_input_key(move |s: &mut Workspace, event, tx| s.completion_key(index, event, tx))
        .on_input_change(move |s: &mut Workspace, _| s.draft_changed(index));
        field = if chat.input.submit_on_enter {
            field.on_submit(move |s: &mut Workspace, tx| s.send_chat(index, false, tx))
        } else {
            input::newline_on_enter(field, move |s: &mut Workspace| {
                &mut s.conversations[index].input
            })
        };
        let running = chat.run.is_loading;
        shell = shell
            .child(
                row()
                    .key("chat-input-row")
                    .items_end()
                    .gap(ui(4.))
                    .pl(ui(4.))
                    .pr(ui(12.))
                    .py(ui(6.))
                    .child(
                        icon_button("Attach image", &icons::PLUS, 16.).on_press_tx(
                            move |s: &mut Workspace, tx| s.pick_chat_images(index, tx),
                        ),
                    )
                    .child(
                        col()
                            .grow(1.)
                            .min_w(0.)
                            .child(input::frame(&chat.input, field)),
                    )
                    .child(
                        icon_button(
                            if running {
                                "Stop generating"
                            } else {
                                "Send message"
                            },
                            if running { &icons::STOP } else { &icons::SEND },
                            16.,
                        )
                        .key(format!("chat-submit-{index}"))
                        .opacity(if chat.commands.is_some() && !chat.sending {
                            1.
                        } else {
                            0.4
                        })
                        .on_press_tx(move |s: &mut Workspace, tx| {
                            let running = s.conversations[index].run.is_loading;
                            s.send_chat(index, running, tx)
                        }),
                    ),
            )
            .child(self.composer_options(index, definition.label, model, reasoning));
        composer = composer.child(shell);
        if chat.completion.menu["show"] == true && chat.input.is_focused() {
            composer = composer.child(self.completion_popup(index));
        }
        if let Some((_, name)) = self.menu.filter(|(pane, _)| *pane == index) {
            composer = composer.child(self.popup(index, name));
        }
        composer
    }

    fn composer_options(
        &self,
        index: usize,
        provider: String,
        model: String,
        reasoning: String,
    ) -> El {
        let chat = &self.conversations[index];
        let mut options = row()
            .key("chat-input-options")
            .flex_wrap()
            .items_center()
            .px(ui(8.))
            .pb(ui(4.))
            .gap(ui(4.));
        for (name, value) in [
            ("provider", provider),
            ("model", model),
            ("reasoning", reasoning),
        ] {
            let mut option = button("")
                .key(format!("{name}-{index}"))
                .label(format!("{name}: {value}"))
                .h(ui(24.))
                .px(ui(4.))
                .gap(ui(4.));
            if name == "provider" {
                option = option.child(icon_sized(
                    if chat.config.agent_kind.as_str() == "codex" {
                        &icons::CODEX
                    } else {
                        &icons::SPARKLES
                    },
                    10.,
                ));
            }
            option = option
                .child(Ink::new(10.).line_text(value))
                .child(icon_sized(&icons::CHEVRON_DOWN, 9.))
                .on_press(move |s: &mut Workspace| {
                    s.selected = index;
                    s.menu = if s.menu == Some((index, name)) {
                        None
                    } else {
                        Some((index, name))
                    };
                });
            options = options.child(option);
        }
        options
    }

    fn provider_requests(&self, index: usize) -> El {
        let chat = &self.conversations[index];
        let mut list = col()
            .key(format!("provider-requests-{index}"))
            .max_h(ui(240.))
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .padding(ui(10.))
            .gap(ui(8.));
        let text = Ink::new(13.);
        for (position, request) in chat.requests.iter().enumerate() {
            let id = request["id"].as_str().unwrap_or("").to_owned();
            let method = request["method"].as_str().unwrap_or("");
            let question = method == "item/tool/requestUserInput";
            let title = if question {
                "The agent needs your input"
            } else if method == "mcpServer/elicitation/request" {
                "Connection request"
            } else {
                "Approval required"
            };
            let mut card = col().gap(ui(6.)).child(text.weight(SEMIBOLD).text(title));
            for key in ["message", "reason", "command"] {
                if let Some(value) = request["params"][key].as_str() {
                    card = card.child(text.text(value.to_owned()));
                }
            }
            for (field, label) in live::request_fields(request) {
                let field_key = format!("{id}/{field}");
                if let Some(input) = chat.request_inputs.get(&field_key) {
                    let access_key = field_key.clone();
                    let editor = input::field(
                        input,
                        format!("request-{index}-{field_key}"),
                        move |s: &mut Workspace| {
                            s.conversations[index]
                                .request_inputs
                                .get_mut(&access_key)
                                .expect("request input")
                        },
                    );
                    let access_key = field_key.clone();
                    let editor = input::newline_on_enter(editor, move |s: &mut Workspace| {
                        s.conversations[index]
                            .request_inputs
                            .get_mut(&access_key)
                            .expect("request input")
                    });
                    card = card.child(
                        col()
                            .gap(ui(3.))
                            .child(text.text(label))
                            .child(input::frame(input, editor)),
                    );
                }
            }
            let approve = id.clone();
            let mut actions = row().gap(ui(8.)).child(
                button(if question {
                    "Send answers"
                } else {
                    "Approve once"
                })
                .key(format!("answer-provider-{index}-{position}"))
                .on_press(move |s: &mut Workspace| {
                    s.answer_provider_request(index, approve.clone(), true)
                }),
            );
            if !question {
                let decline = id.clone();
                actions = actions.child(
                    button("Decline")
                        .key(format!("decline-provider-{index}-{position}"))
                        .on_press(move |s: &mut Workspace| {
                            s.answer_provider_request(index, decline.clone(), false)
                        }),
                );
            }
            list = list.child(card.child(actions));
        }
        list
    }

    fn queue_rows(&self, index: usize) -> El {
        let chat = &self.conversations[index];
        let mut list = col()
            .key(format!("chat-queue-{index}"))
            .max_h(ui(112.))
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .px(ui(4.))
            .py(ui(2.))
            .border_sides([0., 0., 1., 0.], rgba(0xebebeb0f))
            .border_layout();
        let ink = Ink::new(12.).line(20.);
        let muted = ink.hex(0xebebeb80);
        for (position, message) in chat.queue.iter().enumerate() {
            let text = message["displayText"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or_else(|| message["text"].as_str())
                .unwrap_or("")
                .to_owned();
            let message_id = message["id"].as_str().unwrap_or("").to_owned();
            let editing = chat
                .queue_editor
                .as_ref()
                .filter(|(id, _)| id == &message_id);
            let mut row_el = row()
                .items_center()
                .gap(ui(6.))
                .px(ui(8.))
                .py(ui(2.))
                .child(
                    col()
                        .w(ui(20.))
                        .child(muted.line_text((position + 1).to_string())),
                );
            let mut content = col().grow(1.).shrink().min_w(0.).clip_rounded(0.);
            if let Some((_, input)) = editing {
                let field = input::field(
                    input,
                    format!("queue-editor-{index}"),
                    move |s: &mut Workspace| {
                        &mut s.conversations[index]
                            .queue_editor
                            .as_mut()
                            .expect("queue editor")
                            .1
                    },
                )
                .on_submit(move |s: &mut Workspace, _| {
                    if let Some((id, input)) = &s.conversations[index].queue_editor {
                        let id = id.clone();
                        let text = input.content().to_owned();
                        s.update_queued_message(index, id, Some(text), false);
                    }
                })
                .on_input_key(move |s: &mut Workspace, event, _| {
                    if matches!(event.key, rune::Key::Escape) {
                        s.conversations[index].queue_editor = None;
                        s.conversations[index].input.focus();
                        return true;
                    }
                    false
                });
                content = content.child(input::frame(input, field));
            } else {
                content = content.child(
                    ink.line_text(text.split_whitespace().collect::<Vec<_>>().join(" "))
                        .shrink(),
                );
            }
            row_el = row_el.child(content);
            if message["interrupted"] == true {
                let id = message_id.clone();
                row_el = row_el
                    .child(muted.line_text("Interrupted — review work before retrying"))
                    .child(
                        button("Retry")
                            .key(format!("retry-queued-{index}-{position}"))
                            .on_press(move |s: &mut Workspace| {
                                s.update_queued_message(index, id.clone(), None, true)
                            }),
                    );
            }
            let transient = message["transient"].as_bool().unwrap_or(false);
            if transient {
                row_el = row_el.child(muted.line_text("Steering…"));
            } else {
                let editing = editing.is_some();
                let edit_id = message_id.clone();
                row_el = row_el.child(
                    queue_button(
                        if editing {
                            "Save queued message"
                        } else {
                            "Edit queued message"
                        },
                        if editing {
                            &icons::CHECK
                        } else {
                            &icons::PENCIL
                        },
                    )
                    .key(format!("edit-queued-{index}-{position}"))
                    .on_press(move |s: &mut Workspace| s.toggle_queue_editor(index, &edit_id)),
                );
                if editing {
                    row_el = row_el.child(
                        queue_button("Cancel queued message edit", &icons::X)
                            .key(format!("cancel-queued-{index}-{position}"))
                            .on_press(move |s: &mut Workspace| {
                                s.conversations[index].queue_editor = None;
                                s.conversations[index].input.focus();
                            }),
                    );
                } else {
                    let id = message_id.clone();
                    row_el = row_el.child(
                        queue_button("Remove from queue", &icons::TRASH)
                            .key(format!("remove-queued-{index}-{position}"))
                            .opacity(if chat.queue_task.is_some() { 0.4 } else { 1. })
                            .on_press(move |s: &mut Workspace| {
                                s.update_queued_message(index, id.clone(), None, false)
                            }),
                    );
                }
            }
            list = list.child(row_el);
        }
        list
    }

    fn toggle_queue_editor(&mut self, index: usize, edit_id: &str) {
        let chat = &mut self.conversations[index];
        if chat.queue_task.is_some() {
            return;
        }
        if let Some((id, input)) = &chat.queue_editor
            && id == edit_id
        {
            let text = input.content().to_owned();
            let id = id.clone();
            self.update_queued_message(index, id, Some(text), false);
        } else if let Some(message) = chat
            .queue
            .iter()
            .find(|m| m["id"].as_str() == Some(edit_id))
        {
            let text = message["text"].as_str().unwrap_or("").to_owned();
            let mut input = TextInput::new();
            input.submit_on_enter = true;
            input.set_content(&text);
            input.focus();
            chat.queue_editor = Some((edit_id.to_owned(), input));
        }
    }

    pub(crate) fn popup(&self, index: usize, name: &'static str) -> El {
        let config = &self.conversations[index].config;
        let catalog =
            inferay_core::provider_config::renderer_catalog(&serde_json::Value::Null, &[]);
        let definition = match config.agent_kind.as_str() {
            "claude" => catalog.agents.claude,
            "agent" => catalog.agents.agent,
            _ => catalog.agents.codex,
        };
        let options: Vec<(String, String)> = match name {
            "provider" => vec![
                ("codex".into(), "Codex".into()),
                ("claude".into(), "Claude".into()),
            ],
            "model" => definition
                .models
                .into_iter()
                .map(|m| (m.id, m.label))
                .collect(),
            _ => if config.agent_kind.as_str() == "codex" {
                inferay_core::provider_config::reasoning_levels_for(&config.model).to_vec()
            } else {
                definition.reasoning_levels
            }
            .into_iter()
            .map(|r| (r.id, r.label))
            .collect(),
        };
        let mut menu = menu_surface()
            .key(format!("composer-menu-{index}"))
            .pin(Some(ui(12.)), None, None, Some(ui(46.)))
            .w(ui(180.))
            .modal(true, |s: &mut Workspace| s.menu = None);
        for (value, label) in options {
            let selected = match name {
                "provider" => config.agent_kind.as_str() == value,
                "model" => config.model == value,
                _ => config.reasoning_level == value,
            };
            let mut option = plain_button("")
                .key(format!("composer-option-{index}-{value}"))
                .w_full();
            option = if selected {
                crate::ui::swap_fill(
                    option,
                    &format!("composer-option-{index}-{value}"),
                    Some(rgba(0xebebeb17)),
                    rgba(0xffffff0d),
                )
            } else {
                option.hover(rgba(0xffffff0d))
            };
            let chosen = value.clone();
            menu = menu.child(
                option
                    .label(label.clone())
                    .child(Ink::small().line_text(label))
                    .on_press(move |s: &mut Workspace| {
                        let mut input = serde_json::to_value(&s.conversations[index].config)
                            .unwrap_or_default();
                        input[match name {
                            "provider" => "agentKind",
                            "model" => "model",
                            _ => "reasoningLevel",
                        }] = chosen.clone().into();
                        s.conversations[index].config =
                            inferay_core::provider_config::resolve(&input);
                        s.menu = None;
                    }),
            );
        }
        menu
    }
}

fn queue_button(label: &str, glyph: &'static rune::Icon) -> El {
    button("")
        .label(label.to_owned())
        .w(ui(20.))
        .h(ui(20.))
        .px(ui(3.))
        .child(icon_sized(glyph, 14.))
}
