use super::*;
use crate::colors::{CHAT_BODY, CHAT_SMALL};
use crate::ui::SEMIBOLD;
use std::sync::LazyLock;

static PULSE: LazyLock<Vec<(f32, f32)>> = LazyLock::new(|| {
    (0..=48)
        .map(|i| {
            let p = i as f32 / 48.;
            (p, 0.45 + 0.55 * (p * std::f32::consts::PI).sin())
        })
        .collect()
});

fn line(key: String) -> El {
    el().key(key).w(ui(1.)).fill(rgba(0xebebeb24))
}

impl Workspace {
    pub(crate) fn transcript_message(&self, index: usize, message_index: usize) -> El {
        let chat = &self.conversations[index];
        let transcript = &chat.transcript;
        let item = &transcript.rows()[message_index];
        let message = &item.message;
        if item.hidden() {
            return el().h(0.);
        }
        let step = transcript.step(message_index);
        let nested = step.is_some_and(|step| step.start != message_index);
        let step_open = step.is_some_and(|step| transcript.step_open(step, chat.run.is_loading));
        if nested && !step_open {
            return el().h(0.);
        }
        let (line_before, line_after) = transcript.connections(message_index);
        let last_visible = transcript.last_visible() == Some(message_index);
        let id = message.id.clone();
        let element = if let Some(progress) = &item.progress {
            let step = step.expect("progress rows own a timeline step");
            let active = transcript.step_active(step, chat.run.is_loading);
            let title = if progress.title.is_empty() {
                "Thinking…"
            } else {
                &progress.title
            };
            let (press_id, key_id) = (id.clone(), id.clone());
            let mut header = row()
                .key(format!("step-header-{id}"))
                .role("button")
                .label(format!(
                    "{} {title}",
                    if step_open { "Collapse" } else { "Expand" }
                ))
                .focusable(true)
                .no_focus_ring()
                .items_center()
                .w_full()
                .py(ui(6.))
                .min_h(ui(32.))
                .px(ui(4.))
                .gap(ui(8.))
                .radius(ui(6.))
                .cursor(rune::Cursor::Pointer)
                .hover(rgba(0xffffff0d))
                .child(
                    col().grow(1.).min_w(0.).child(
                        Ink::small()
                            .weight(MEDIUM)
                            .hex(if active { 0xebebebee } else { 0xebebeba0 })
                            .text(title.to_owned()),
                    ),
                );
            if !step_open && step.tools > 0 {
                header = header.child(
                    Ink::detail()
                        .hex(0xebebeb60)
                        .line_text(format!("{}", step.tools)),
                );
            }
            header = header
                .child(chevron(step_open))
                .on_press(move |s: &mut Workspace| s.toggle_step_for(index, &press_id))
                .on_key(move |s: &mut Workspace, event, _| {
                    let hit = activates(event);
                    if hit {
                        s.toggle_step_for(index, &key_id);
                    }
                    hit
                });
            let mut element = col()
                .pl(ui(16.))
                .child(border(
                    el().key(format!("step-dot-{id}"))
                        .pin(Some(ui(-3.)), Some(ui(13.)), None, None)
                        .size(ui(7.), ui(7.))
                        .radius(9999.)
                        .fill(if active { rgb(0x8ab4f8) } else { rgb(RAISED) }),
                    if active { 0x8ab4f8ff } else { 0xebebeb50 },
                ))
                .child(header);
            if step_open && let Some(body) = &progress.body {
                element = element.child(col().pl(ui(4.)).pb(ui(8.)).child(body.render_in(
                    &format!("step-body-{}", message.id),
                    Ink::small().hex(0xebebeb90),
                )));
            }
            element
        } else if message.role == "tool" {
            self.tool_row(index, message_index, line_before, line_after, last_visible)
        } else if let Some(proposal) = message
            .render
            .as_ref()
            .and_then(|r| r.skill_proposal.as_deref())
        {
            self.skill_proposal_card(&message.id, proposal)
        } else if let Some(command) = message
            .render
            .as_ref()
            .and_then(|r| r.automation_definition_proposal.as_deref())
        {
            self.automation_proposal_card(&message.id, command)
        } else if let Some(card) = message
            .render
            .as_ref()
            .and_then(crate::rich_text::system_card)
        {
            card
        } else if message.role == "system" {
            col()
                .mt(ui(4.))
                .mb(ui(if last_visible { 0. } else { 4. }))
                .child(
                    item.rich
                        .render_in(&message.id, Ink::new(CHAT_SMALL).hex(0xebebeb80)),
                )
        } else if message.role == "user" {
            self.user_message(index, message_index, last_visible)
        } else {
            let mut element = col()
                .mb(ui(if last_visible { 0. } else { 8. }))
                .child(col().child(item.rich.render_in(
                    &message.id,
                    Ink::body().line(CHAT_BODY * 1.6).hex(0xebebebb8),
                )));
            if message.is_streaming != Some(true) && !message.content.trim().is_empty() {
                let content = message.content.clone();
                element = element.child(
                    row()
                        .justify_end()
                        .mt(ui(4.))
                        .child(crate::copy_button::copy_button(
                            format!("copy-{}", message.id),
                            button("")
                                .label("Copy response")
                                .w(ui(24.))
                                .justify_center()
                                .h(ui(24.))
                                .px(ui(6.)),
                            move || content.clone(),
                        )),
                );
            }
            element
        };
        let Some(step) = step else { return element };
        let mut wrapper = col().w_full().max_w(ui(544.)).self_center();
        if line_before && !nested {
            wrapper = wrapper.child(
                line(format!("step-line-before-{id}"))
                    .pin(Some(0.), Some(0.), None, None)
                    .h(ui(16.5)),
            );
        }
        if transcript.connections(step.start).1 {
            wrapper = wrapper.child(line(format!("step-line-{id}")).pin(
                Some(0.),
                Some(ui(if nested { 0. } else { 16.5 })),
                None,
                Some(0.),
            ));
        }
        let mut inner = col();
        if nested {
            inner = inner.pl(ui(32.));
        }
        wrapper.child(inner.child(element))
    }

    fn tool_row(
        &self,
        index: usize,
        message_index: usize,
        before: bool,
        after: bool,
        last: bool,
    ) -> El {
        let row_data = &self.conversations[index].transcript.rows()[message_index];
        let message = &row_data.message;
        let id = message.id.clone();
        let open = self.expanded.contains(&id);
        let render = message.render.as_ref();
        let display = render.and_then(|r| r.display.as_ref());
        let label = display.map(|d| d.label.clone()).unwrap_or_else(|| {
            inferay_core::tool_presentation::display(
                message.tool_name.as_deref(),
                &serde_json::Value::Null,
            )
            .label
        });
        let mut element = col()
            .w_full()
            .max_w(ui(544.))
            .self_center()
            .pl(ui(12.))
            .pb(ui(if last { 0. } else { 4. }));
        if before {
            element = element.child(
                line(format!("tool-line-before-{id}"))
                    .pin(Some(0.), Some(0.), None, None)
                    .h(ui(12.)),
            );
        }
        if after {
            element = element.child(line(format!("tool-line-after-{id}")).pin(
                Some(0.),
                Some(ui(12.)),
                None,
                Some(0.),
            ));
        }
        let mut dot = border(
            el().key(format!("tool-dot-{id}"))
                .pin(Some(ui(-2.5)), Some(ui(9.)), None, None)
                .size(ui(6.), ui(6.))
                .radius(9999.)
                .fill(rgb(RAISED)),
            0xebebeb40,
        );
        if message.is_streaming == Some(true) {
            dot = dot.child(
                el().pin(Some(0.), Some(0.), Some(0.), Some(0.))
                    .radius(9999.)
                    .fill(rgb(0x8ab4f8))
                    .cycle(rune::Cycle {
                        period: 1.2,
                        phase: 0.,
                        stops: PULSE.as_slice(),
                        still: 1.,
                        fps: 60.,
                    }),
            );
        }
        element = element.child(dot);
        let row_path = format!(
            "{}/chat-message-column/tool-timeline-row",
            row_key(index, &id)
        );
        let mut timeline = row()
            .key("tool-timeline-row")
            .role("button")
            .label(label.clone())
            .items_center()
            .gap(ui(6.))
            .min_h(ui(24.))
            .px(ui(4.))
            .cursor(rune::Cursor::Pointer);
        if let Some(source) = display.and_then(|display| display.source.as_ref()) {
            timeline = timeline.child(
                Ink::detail()
                    .color(rgb(0x8ab4f8))
                    .line_text(source.server_label.clone())
                    .key("tool-source"),
            );
        }
        timeline = timeline.child(
            Ink::small()
                .weight(SEMIBOLD)
                .hex(0xebebebb8)
                .line_text(label)
                .shrink(),
        );
        if let Some(detail) = display.and_then(|d| d.detail.clone()) {
            let mut detail = Ink::detail()
                .mono()
                .hex(0xebebeb70)
                .line_text(detail.split_whitespace().collect::<Vec<_>>().join(" "))
                .shrink();
            if let Some([width, _]) = rune::memo::layout_size(&row_path) {
                detail = detail.max_w(width * 0.42);
            }
            timeline = timeline.child(detail);
        }
        let toggle = id.clone();
        timeline = timeline.child(el().grow(1.)).child(chevron(open)).on_press(
            move |s: &mut Workspace| {
                if !s.expanded.remove(&toggle) {
                    s.expanded.insert(toggle.clone());
                }
            },
        );
        element = element.child(timeline);
        if open {
            element = element.child(col().ml(ui(4.)).py(ui(2.)).child(row_data.rich.render(&id)));
        }
        element
    }

    fn user_message(&self, index: usize, message_index: usize, last: bool) -> El {
        let row_data = &self.conversations[index].transcript.rows()[message_index];
        let message = &row_data.message;
        let images = message.images.as_deref().unwrap_or_default();
        let has_images = !images.is_empty();
        let mut bubble = col()
            .key(format!("user-bubble-{}", message.id))
            .px(ui(10.))
            .py(ui(6.))
            .corners([ui(8.), ui(8.), ui(2.), ui(8.)]);
        if has_images {
            bubble = bubble.grow(1.).min_w(0.).items_end().gap(ui(8.)).child(
                row()
                    .key(format!("user-images-{}", message.id))
                    .w_full()
                    .min_w(0.)
                    .flex_wrap()
                    .justify_end()
                    .items_start()
                    .gap(ui(4.))
                    .children(images.iter().enumerate().map(|(i, path)| {
                        super::super::attachments::photo(
                            path.into(),
                            format!("sent-photo-{}-{i}", message.id),
                            false,
                        )
                    })),
            );
        } else {
            bubble = bubble.shrink();
        }
        if !message.content.is_empty() {
            let mut text = col().key(format!("user-message-text-{}", message.id));
            if has_images {
                text = text.w_full().min_w(0.);
            }
            let available = rune::memo::layout_size(&format!("user-row-{}", message.id))
                .map(|[width, _]| width * 0.85 - ui(20.));
            let rendered =
                crate::rich_text::fitted(available, || row_data.rich.render(&message.id));
            bubble = bubble.child(text.child(rendered));
        }
        row()
            .key(format!("user-row-{}", message.id))
            .justify_end()
            .mb(ui(if last { 0. } else { 8. }))
            .child(el().w_frac(0.15))
            .child(bubble)
    }
}
