mod message;
#[cfg(test)]
mod tests;

use super::*;
use crate::colors::{CHAT_DETAIL, RAISED, rgb, rgba};
use crate::icons;
use crate::ui::{Ink, MEDIUM, border, button, icon_sized, plain_button};
use crate::zoom::ui;
use rune::{El, Key, KeyEvent, col, el, row};
use std::{borrow::Cow, cell::RefCell, collections::HashSet};

thread_local! {
    static DETACHED: RefCell<HashSet<usize>> = RefCell::new(HashSet::new());
}

pub(crate) fn transcript_key(index: usize) -> String {
    format!("transcript-{index}")
}

pub(crate) fn row_key(index: usize, id: &str) -> String {
    format!("row:{index}:{}", id.replace('/', "_"))
}

pub(crate) fn following(index: usize) -> bool {
    !DETACHED.with_borrow(|detached| detached.contains(&index))
}

fn activates(event: &KeyEvent) -> bool {
    matches!(&event.key, Key::Enter) || matches!(&event.key, Key::Text(text) if text == " ")
}

pub(super) fn chevron(open: bool) -> El {
    icon_sized(
        if open {
            &icons::CHEVRON_DOWN
        } else {
            &icons::CHEVRON_RIGHT
        },
        12.,
    )
}

impl Workspace {
    pub(crate) fn transcript_row_index(&self, index: usize, id: &str) -> Option<usize> {
        self.conversations[index]
            .transcript
            .rows()
            .iter()
            .position(|row| row.message.id == id)
    }

    fn toggle_activity_for(&mut self, index: usize, id: &str) {
        if let Some(row) = self.transcript_row_index(index, id) {
            let chat = &mut self.conversations[index];
            chat.transcript.toggle_activity(row, chat.run.is_loading);
        }
    }

    pub(super) fn toggle_step_for(&mut self, index: usize, id: &str) {
        if let Some(row) = self.transcript_row_index(index, id) {
            let chat = &mut self.conversations[index];
            chat.transcript.toggle_step(row, chat.run.is_loading);
        }
    }

    pub(crate) fn transcript(&self, index: usize) -> El {
        let chat = &self.conversations[index];
        let body = Ink::body();
        let mut header = col().w_full().max_w(ui(624.)).px(ui(12.)).self_center();
        if chat.loading && !chat.loaded {
            header = header.child(body.text("Loading saved messages…"));
        }
        if let Some(error) = chat.error.clone().or_else(|| chat.connection_error.clone()) {
            header = header.child(body.text(error));
        }
        if chat.transcript.total() > chat.transcript.rows().len() {
            header = header.child(
                button("Load older messages")
                    .key(format!("older-messages-{index}"))
                    .on_press_tx(move |s: &mut Workspace, tx| {
                        let limit = s.conversations[index].transcript.rows().len() + 200;
                        s.load_chat(index, limit, tx);
                    }),
            );
        }
        if chat.transcript.rows().is_empty() && !chat.loading && chat.error.is_none() {
            header = header.child(
                col()
                    .justify_center()
                    .items_center()
                    .h(ui(300.))
                    .gap(ui(12.))
                    .child(icon_sized(&icons::CODEX, 28.))
                    .child(Ink::new(18.).text("What would you like to work on?"))
                    .child(
                        Ink::small()
                            .hex(0xebebeb80)
                            .text("Start a conversation below."),
                    ),
            );
        }
        let count = chat.transcript.rows().len();
        let rows = col()
            .key(format!("transcript-rows-{index}"))
            .w_full()
            .growth(rune::GrowthSpec {
                edge: rune::edge::NO_MASK,
                ..Default::default()
            })
            .virtual_rows(
                count,
                ui(48.),
                move |s: &Workspace, i| {
                    Cow::Owned(row_key(
                        index,
                        &s.conversations[index].transcript.rows()[i].message.id,
                    ))
                },
                move |s: &Workspace, i| s.transcript_row(index, i),
            )
            .virtual_rows_version(chat.transcript.revision());
        let mut pane = col()
            .key(format!("transcript-pane-{index}"))
            .grow(1.)
            .min_h(0.)
            .w_full()
            .pt(ui(8.))
            .pb(ui(8.))
            .child(header)
            .child(
                col()
                    .key(transcript_key(index))
                    .grow(1.)
                    .min_h(0.)
                    .w_full()
                    .scroll(rune::ScrollSpec { stick_bottom: true })
                    .on_at_bottom(move |_: &mut Workspace, at| {
                        DETACHED.with_borrow_mut(|detached| {
                            if at {
                                detached.remove(&index);
                            } else {
                                detached.insert(index);
                            }
                        })
                    })
                    .child(rows),
            );
        if count > 0 && !following(index) {
            pane = pane.child(
                crate::ui::swap_fill(
                    border(
                        plain_button("")
                            .key("latest-message")
                            .label("Scroll to latest message")
                            .pin(None, None, Some(ui(8.)), Some(ui(8.)))
                            .w(ui(24.))
                            .h(ui(24.))
                            .px(ui(5.))
                            .radius(9999.),
                        0xebebeb26,
                    ),
                    &format!("latest-message-{index}"),
                    Some(rgb(RAISED)),
                    rgba(0xffffff0d),
                )
                .child(icon_sized(&icons::CHEVRON_DOWN, 12.))
                .on_press_tx(move |_: &mut Workspace, tx| {
                    DETACHED.with_borrow_mut(|detached| detached.remove(&index));
                    tx.scroll_to_bottom(transcript_key(index));
                }),
            );
        }
        pane
    }

    pub(crate) fn transcript_row(&self, index: usize, message_index: usize) -> El {
        let chat = &self.conversations[index];
        let transcript = &chat.transcript;
        if transcript.rows()[message_index].hidden() {
            return el().h(0.);
        }
        let activity = transcript.activity(message_index);
        let open =
            activity.is_none_or(|activity| transcript.activity_open(activity, chat.run.is_loading));
        let header = activity.filter(|activity| activity.start == message_index);
        if !open && header.is_none() {
            return el().h(0.);
        }
        let mut content = col().w_full();
        if let Some(activity) = header {
            let active = transcript.activity_active(activity, chat.run.is_loading);
            let title = if active { "Working" } else { "Activity" };
            let count = format!(
                "{} {}",
                activity.steps,
                if activity.steps == 1 { "step" } else { "steps" }
            );
            let id = transcript.rows()[activity.start].message.id.clone();
            let key_id = id.clone();
            content = content.child(
                col()
                    .w_full()
                    .max_w(ui(544.))
                    .self_center()
                    .mb(ui(if open { 4. } else { 8. }))
                    .child(
                        button("")
                            .key(format!("activity-header-{id}"))
                            .label(format!(
                                "{} {title}, {count}",
                                if open { "Collapse" } else { "Expand" }
                            ))
                            .w_full()
                            .h(ui(32.))
                            .px(ui(4.))
                            .gap(ui(8.))
                            .child(chevron(open))
                            .child(
                                Ink::small()
                                    .weight(MEDIUM)
                                    .hex(if active { 0xebebebdd } else { 0xebebeb90 })
                                    .line_text(title),
                            )
                            .child(Ink::new(CHAT_DETAIL).hex(0xebebeb70).line_text(count))
                            .on_press(move |s: &mut Workspace| s.toggle_activity_for(index, &id))
                            .on_key(move |s: &mut Workspace, event, _| {
                                let hit = activates(event);
                                if hit {
                                    s.toggle_activity_for(index, &key_id);
                                }
                                hit
                            }),
                    ),
            );
        }
        if open {
            let mut wrapper = col();
            if activity.is_some() {
                wrapper = wrapper.w_full().max_w(ui(544.)).self_center().pl(ui(24.));
            }
            content = content.child(wrapper.child(self.transcript_message(index, message_index)));
        }
        row().w_full().justify_center().child(
            col()
                .key("chat-message-column")
                .w_full()
                .max_w(ui(624.))
                .px(ui(12.))
                .child(content),
        )
    }
}
