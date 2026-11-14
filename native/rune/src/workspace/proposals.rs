use super::*;
use crate::colors::{self, rgb, rgba};
use crate::icons;
use crate::ui::{Ink, MEDIUM, SEMIBOLD, border, button, icon, pin_fill, plain_button_ink};
use crate::zoom::ui;
use inferay_core::project_files::{
    ProjectFileCommand, ProjectProposalDecision, ProjectProposalRequest, ProjectProposalStatus,
    ProjectProposalView,
};
use rune::{El, col, row};

#[cfg(test)]
mod tests;

#[derive(Default)]
pub(crate) struct State {
    pub(crate) view: Option<ProjectProposalView>,
    pub(crate) error: Option<String>,
    pub(crate) task: Option<Task>,
}

#[derive(Default)]
pub(crate) struct SkillState {
    pub(crate) view: serde_json::Value,
    pub(crate) error: Option<String>,
    pub(crate) task: Option<Task>,
}

struct Look {
    rest: u32,
    hover: u32,
    border: Option<(u32, u32)>,
    text: u32,
    hover_text: Option<u32>,
}

fn card_button(key: String, label: &'static str, ink: Ink, look: Look) -> El {
    let outer = if look.border.is_some() {
        rune::el().pin(Some(-1.), Some(-1.), Some(-1.), Some(-1.))
    } else {
        pin_fill()
    };
    let mut layers = outer
        .child(
            pin_fill()
                .radius(ui(6.))
                .fill(rgba(look.rest))
                .group_opacity(1., 0.),
        )
        .child(
            pin_fill()
                .radius(ui(6.))
                .fill(rgba(look.hover))
                .group_opacity(0., 1.),
        );
    if let Some((rest, hover)) = look.border {
        layers = layers
            .child(
                pin_fill()
                    .radius(ui(6.))
                    .border(1., rgba(rest))
                    .group_opacity(1., 0.),
            )
            .child(
                pin_fill()
                    .radius(ui(6.))
                    .border(1., rgba(hover))
                    .group_opacity(0., 1.),
            );
    }
    let mut text = ink.color(rgba(look.text)).line_text(label);
    if let Some(hover) = look.hover_text {
        text = text.group_color(rgba(hover));
    }
    let mut button = plain_button_ink("", ink)
        .label(label)
        .key(key)
        .h(ui(32.))
        .hover_group()
        .child(layers)
        .child(text);
    if look.border.is_some() {
        button = button.border(1., rgba(0)).border_layout();
    }
    button
}

impl Workspace {
    pub(crate) fn skill_proposal_action(
        &mut self,
        id: String,
        proposal: serde_json::Value,
        decision: Option<&'static str>,
    ) {
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let state = self.skill_proposals.entry(id.clone()).or_default();
        if state.task.is_some()
            || (decision.is_some() && (state.view.is_null() || state.view["decided"] == true))
            || (decision == Some("approve") && state.view["blockedReason"].is_string())
        {
            return;
        }
        state.error = None;
        let request = serde_json::json!({"messageId":id,"proposal":proposal,"decision":decision});
        state.task = Some(crate::task::spawn(
            async move {
                backend
                    .request(
                        reqwest::Method::POST,
                        "/api/prompts/proposal",
                        Some(request),
                    )
                    .await
            },
            move |s: &mut Workspace, result, _| {
                let state = s.skill_proposals.entry(id.clone()).or_default();
                state.task = None;
                match result {
                    Ok(view) => state.view = view,
                    Err(error) => state.error = Some(error.to_string()),
                }
            },
        ));
    }

    pub(crate) fn skill_proposal_card(
        &self,
        id: &str,
        proposal: &inferay_core::prompts::SkillProposal,
    ) -> El {
        let proposal = serde_json::to_value(proposal).expect("skill proposal serializes");
        let state = self.skill_proposals.get(id);
        let view = state.map(|s| &s.view);
        let busy = state.is_some_and(|s| s.task.is_some());
        let reviewed = view.is_some_and(|v| !v.is_null());
        let decided = view.is_some_and(|v| v["decided"] == true);
        let blocked = view.and_then(|v| v["blockedReason"].as_str());
        let saved = view.is_some_and(|v| v["savedSkillId"].is_string());
        let base = Ink::body().hex(0xebebebcc);
        let mut card = border(
            col()
                .gap(ui(12.))
                .padding(ui(16.))
                .fill(rgba((colors::COMPOSER & !0xff) | 0xff))
                .radius(ui(12.)),
            0xebebeb18,
        )
        .child(
            row()
                .items_center()
                .gap(ui(10.))
                .child(
                    row()
                        .size(ui(30.), ui(30.))
                        .items_center()
                        .justify_center()
                        .radius(ui(8.))
                        .fill(rgba(0x8ab4f818))
                        .child(icon(&icons::SPARKLES).color(rgb(0x8ab4f8))),
                )
                .child(
                    col()
                        .grow(1.)
                        .min_w(0.)
                        .gap(ui(3.))
                        .child(
                            base.size(11.).hex(0xebebeb80).text(
                                view.and_then(|v| v["title"].as_str())
                                    .unwrap_or("Skill proposal")
                                    .to_owned(),
                            ),
                        )
                        .child(
                            base.size(14.)
                                .weight(SEMIBOLD)
                                .color(rgb(0xebebeb))
                                .text(proposal["name"].as_str().unwrap_or("").to_owned()),
                        ),
                ),
        )
        .child(
            base.size(11.)
                .mono()
                .color(rgb(0x8ab4f8))
                .text(format!("/{}", proposal["command"].as_str().unwrap_or(""))),
        )
        .child(base.text(proposal["description"].as_str().unwrap_or("").to_owned()))
        .child(
            base.size(11.)
                .hex(0xebebeb80)
                .text(proposal["reason"].as_str().unwrap_or("").to_owned()),
        )
        .child(
            base.size(11.)
                .color(if saved {
                    rgb(0x8bd5a0)
                } else {
                    rgba(0xebebeb80)
                })
                .text(
                    view.and_then(|v| v["status"].as_str())
                        .unwrap_or(
                            "Review the instructions and saved status before making changes.",
                        )
                        .to_owned(),
                ),
        );
        if reviewed && !decided {
            for (label, text) in [
                (
                    "Current instructions",
                    view.and_then(|v| v["currentInstructions"].as_str()),
                ),
                ("Proposed instructions", proposal["promptTemplate"].as_str()),
            ] {
                let Some(text) = text else { continue };
                card = card.child(
                    col()
                        .gap(ui(6.))
                        .child(base.size(11.).weight(SEMIBOLD).hex(0xebebeb99).text(label))
                        .child(
                            border(
                                col()
                                    .key(format!("{label}-{id}"))
                                    .max_h(ui(220.))
                                    .padding(ui(10.))
                                    .radius(ui(8.))
                                    .fill(rgba(0x00000020))
                                    .scroll(rune::ScrollSpec {
                                        stick_bottom: false,
                                    }),
                                0xebebeb0d,
                            )
                            .children(text.lines().map(|line| base.text(line.to_owned()))),
                        ),
                );
            }
        }
        if let Some(text) = blocked {
            card = card.child(base.color(rgb(0xe5bc7a)).text(text.to_owned()));
        }
        if let Some(error) = state.and_then(|s| s.error.clone()) {
            card = card.child(base.color(rgb(0xf0a0a0)).text(error));
        }
        if busy {
            card = card.child(base.size(11.).hex(0xebebeb80).text("Updating proposal…"));
        }
        if !busy && !reviewed {
            let (review_id, review_proposal) = (id.to_owned(), proposal.clone());
            card = card.child(
                card_button(
                    format!("review-skill-{id}"),
                    "Review changes",
                    Ink::small(),
                    Look {
                        rest: 0x8ab4f81a,
                        hover: 0x8ab4f82a,
                        border: Some((0x8ab4f833, 0x8ab4f833)),
                        text: 0x8ab4f8ff,
                        hover_text: None,
                    },
                )
                .on_press(move |s: &mut Workspace| {
                    s.skill_proposal_action(review_id.clone(), review_proposal.clone(), None)
                }),
            );
        }
        if !busy && reviewed && !decided {
            let mut actions = row()
                .gap(ui(8.))
                .pt(ui(10.))
                .border_sides([1., 0., 0., 0.], rgba(0xebebeb12))
                .border_layout();
            for (label, decision) in [("Approve & save", "approve"), ("Reject", "reject")] {
                if decision == "approve" && blocked.is_some() {
                    continue;
                }
                let look = if decision == "approve" {
                    Look {
                        rest: 0x8ab4f8ff,
                        hover: 0xa2c4faff,
                        border: Some((0x8ab4f8ff, 0x8ab4f8ff)),
                        text: 0x182334ff,
                        hover_text: None,
                    }
                } else {
                    Look {
                        rest: 0xebebeb08,
                        hover: 0xef888818,
                        border: Some((0xebebeb26, 0xef888840)),
                        text: 0xebebebb3,
                        hover_text: Some(0xf0a0a0ff),
                    }
                };
                let (action_id, action_proposal) = (id.to_owned(), proposal.clone());
                actions = actions.child(
                    card_button(
                        format!("{decision}-skill-{id}"),
                        label,
                        Ink::small().weight(MEDIUM),
                        look,
                    )
                    .px(ui(12.))
                    .on_press(move |s: &mut Workspace| {
                        s.skill_proposal_action(
                            action_id.clone(),
                            action_proposal.clone(),
                            Some(decision),
                        )
                    }),
                );
            }
            card = card.child(actions);
        }
        if saved {
            card = card.child(
                card_button(
                    format!("open-skill-{id}"),
                    "Open Skills library",
                    Ink::small(),
                    Look {
                        rest: 0x8ab4f818,
                        hover: 0x8ab4f828,
                        border: None,
                        text: 0x8ab4f8ff,
                        hover_text: None,
                    },
                )
                .on_press(|s: &mut Workspace| {
                    s.set_settings(true);
                    s.settings_page("skills");
                }),
            );
        }
        card
    }

    pub(crate) fn automation_proposal_action(
        &mut self,
        id: String,
        command: ProjectFileCommand,
        decision: Option<ProjectProposalDecision>,
    ) {
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let state = self.proposals.entry(id.clone()).or_default();
        if state.task.is_some() {
            return;
        }
        if decision.is_some()
            && !state
                .view
                .as_ref()
                .is_some_and(|v| v.status == ProjectProposalStatus::Pending)
        {
            return;
        }
        state.error = None;
        let request = ProjectProposalRequest {
            message_id: id.clone(),
            command,
            decision,
            edited_command: None,
        };
        state.task = Some(crate::task::spawn(
            async move {
                let value = backend
                    .request(
                        reqwest::Method::POST,
                        "/api/projects/proposal",
                        Some(serde_json::to_value(request)?),
                    )
                    .await?;
                Ok::<ProjectProposalView, anyhow::Error>(serde_json::from_value(value)?)
            },
            move |s: &mut Workspace, result, _| {
                let state = s.proposals.entry(id.clone()).or_default();
                state.task = None;
                match result {
                    Ok(view) => state.view = Some(view),
                    Err(error) => state.error = Some(error.to_string()),
                }
            },
        ));
    }

    pub(crate) fn automation_proposal_card(&self, id: &str, command: &ProjectFileCommand) -> El {
        let ProjectFileCommand::SaveDefinition { content, path, .. } = command else {
            return rune::el();
        };
        let definition: serde_json::Value = serde_json::from_str(content).unwrap_or_default();
        let name = definition["name"]
            .as_str()
            .unwrap_or("Automation")
            .to_owned();
        let state = self.proposals.get(id);
        let status = state.and_then(|s| s.view.as_ref()).map(|v| v.status);
        let busy = state.is_some_and(|s| s.task.is_some());
        let pending = status == Some(ProjectProposalStatus::Pending);
        let body = Ink::body();
        let mut card = border(
            col().gap(ui(8.)).padding(ui(12.)).radius(ui(6.)),
            0x665533ff,
        )
        .child(body.text(format!("Automation proposal: {name}")))
        .child(body.text(path.clone()))
        .child(body.text(match status {
            Some(ProjectProposalStatus::Saved) => {
                "Saved. Execution remains subject to separate approval."
            }
            Some(ProjectProposalStatus::Declined) => "Declined. No changes saved.",
            _ => "Review the definition below before saving. Saving does not enable or run it.",
        }));
        if pending {
            let mono = Ink::new(11.).mono();
            card = card.child(
                col()
                    .key(format!("proposal-content-{id}"))
                    .max_h(ui(280.))
                    .scroll(rune::ScrollSpec {
                        stick_bottom: false,
                    })
                    .children(
                        serde_json::to_string_pretty(&definition)
                            .unwrap_or_else(|_| content.clone())
                            .lines()
                            .map(|line| mono.text(line.to_owned()))
                            .collect::<Vec<_>>(),
                    ),
            );
        }
        if let Some(error) = state.and_then(|s| s.error.clone()) {
            card = card.child(body.text(error));
        }
        if busy {
            card = card.child(body.text("Updating proposal…"));
        }
        if !busy && status.is_none() {
            let (action_id, action_command) = (id.to_owned(), command.clone());
            card = card.child(
                button("Review changes")
                    .key(format!("review-proposal-{id}"))
                    .on_press(move |s: &mut Workspace| {
                        s.automation_proposal_action(
                            action_id.clone(),
                            action_command.clone(),
                            None,
                        )
                    }),
            );
        }
        if !busy && pending {
            let mut actions = row().gap(ui(8.));
            for (label, decision) in [
                ("Save", ProjectProposalDecision::Save),
                ("Decline", ProjectProposalDecision::Decline),
            ] {
                let (action_id, action_command) = (id.to_owned(), command.clone());
                actions = actions.child(
                    button(label)
                        .key(format!("{label}-proposal-{id}"))
                        .on_press(move |s: &mut Workspace| {
                            s.automation_proposal_action(
                                action_id.clone(),
                                action_command.clone(),
                                Some(decision),
                            )
                        }),
                );
            }
            card = card.child(actions);
        }
        card
    }
}
