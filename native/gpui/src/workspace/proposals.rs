//! User-reviewed skill and automation saves use shared proposal receipts and conflict checks.
use super::*;
use inferay_core::project_files::{
    ProjectFileCommand, ProjectProposalDecision, ProjectProposalRequest, ProjectProposalStatus,
    ProjectProposalView,
};

#[derive(Default)]
pub(super) struct State {
    view: Option<ProjectProposalView>,
    error: Option<String>,
    task: Option<Task<()>>,
}

#[derive(Default)]
pub(super) struct SkillState {
    view: serde_json::Value,
    error: Option<String>,
    task: Option<Task<()>>,
}

impl WorkspaceView {
    fn skill_proposal_action(
        &mut self,
        id: String,
        proposal: serde_json::Value,
        decision: Option<&'static str>,
        cx: &mut Context<Self>,
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
        let work = cx.background_executor().spawn(async move {
            crate::backend::RUNTIME.block_on(backend.request(
                reqwest::Method::POST,
                "/api/prompts/proposal",
                Some(request),
            ))
        });
        state.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                let state = s.skill_proposals.entry(id.clone()).or_default();
                state.task = None;
                match result {
                    Ok(view) => state.view = view,
                    Err(error) => state.error = Some(error.to_string()),
                }
                for chat in &s.conversations {
                    if let Some(index) = chat
                        .transcript
                        .rows()
                        .iter()
                        .position(|r| r.message.id == id)
                    {
                        chat.transcript.scroll.remeasure_items(index..index + 1);
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn skill_proposal_card(
        &self,
        id: &str,
        proposal: &inferay_core::prompts::SkillProposal,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let proposal = serde_json::to_value(proposal).expect("skill proposal serializes");
        let state = self.skill_proposals.get(id);
        let view = state.map(|s| &s.view);
        let busy = state.is_some_and(|s| s.task.is_some());
        let reviewed = view.is_some_and(|v| !v.is_null());
        let decided = view.is_some_and(|v| v["decided"] == true);
        let blocked = view.and_then(|v| v["blockedReason"].as_str());
        let review_id = id.to_owned();
        let review_proposal = proposal.clone();
        div()
            .flex()
            .flex_col()
            .gap(ui(12.))
            .p(ui(16.))
            .bg(Rgba {
                a: 1.,
                ..self.appearance.composer_background()
            })
            .border_1()
            .border_color(rgba(0xebebeb18))
            .rounded(ui(12.))
            .text_color(rgba(0xebebebcc))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(ui(10.))
                    .child(
                        div()
                            .size(ui(30.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(ui(8.))
                            .bg(rgba(0x8ab4f818))
                            .child(icon("Sparkles").text_color(rgb(0x8ab4f8))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(ui(3.))
                            .child(
                                div().text_size(ui(11.)).text_color(rgba(0xebebeb80)).child(
                                    view.and_then(|v| v["title"].as_str())
                                        .unwrap_or("Skill proposal")
                                        .to_owned(),
                                ),
                            )
                            .child(
                                div()
                                    .text_size(ui(14.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(rgb(0xebebeb))
                                    .child(proposal["name"].as_str().unwrap_or("").to_owned()),
                            ),
                    ),
            )
            .child(
                div()
                    .text_size(ui(11.))
                    .font_family("Menlo")
                    .text_color(rgb(0x8ab4f8))
                    .child(format!("/{}", proposal["command"].as_str().unwrap_or(""))),
            )
            .child(
                div()
                    .text_size(ui(12.))
                    .child(proposal["description"].as_str().unwrap_or("").to_owned()),
            )
            .child(
                div()
                    .text_size(ui(11.))
                    .text_color(rgba(0xebebeb80))
                    .child(proposal["reason"].as_str().unwrap_or("").to_owned()),
            )
            .child(
                div()
                    .text_size(ui(11.))
                    .text_color(if view.is_some_and(|v| v["savedSkillId"].is_string()) {
                        rgb(0x8bd5a0)
                    } else {
                        rgba(0xebebeb80)
                    })
                    .child(
                        view.and_then(|v| v["status"].as_str())
                            .unwrap_or(
                                "Review the instructions and saved status before making changes.",
                            )
                            .to_owned(),
                    ),
            )
            .when(reviewed && !decided, |d| {
                d.children(
                    [
                        (
                            "Current instructions",
                            view.and_then(|v| v["currentInstructions"].as_str()),
                        ),
                        ("Proposed instructions", proposal["promptTemplate"].as_str()),
                    ]
                    .into_iter()
                    .filter_map(|(label, text)| {
                        text.map(|text| {
                            div()
                                .flex()
                                .flex_col()
                                .gap(ui(6.))
                                .child(
                                    div()
                                        .text_size(ui(11.))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(rgba(0xebebeb99))
                                        .child(label),
                                )
                                .child(
                                    div()
                                        .id(SharedString::from(format!("{label}-{id}")))
                                        .max_h(ui(220.))
                                        .p(ui(10.))
                                        .rounded(ui(8.))
                                        .bg(rgba(0x00000020))
                                        .border_1()
                                        .border_color(rgba(0xebebeb0d))
                                        .overflow_y_scroll()
                                        .text_size(ui(12.))
                                        .children(
                                            text.lines()
                                                .map(|line| div().child(line.to_owned()))
                                                .collect::<Vec<_>>(),
                                        ),
                                )
                        })
                    }),
                )
            })
            .when_some(blocked, |d, text| {
                d.child(
                    div()
                        .text_size(ui(12.))
                        .text_color(rgb(0xe5bc7a))
                        .child(text.to_owned()),
                )
            })
            .when_some(state.and_then(|s| s.error.clone()), |d, error| {
                d.child(
                    div()
                        .text_size(ui(12.))
                        .text_color(rgb(0xf0a0a0))
                        .child(error),
                )
            })
            .when(busy, |d| {
                d.child(
                    div()
                        .text_size(ui(11.))
                        .text_color(rgba(0xebebeb80))
                        .child("Updating proposal…"),
                )
            })
            .when(!busy && !reviewed, |d| {
                d.child(
                    crate::plain_button(
                        SharedString::from(format!("review-skill-{id}")),
                        "Review changes",
                    )
                    .h(ui(32.))
                    .bg(rgba(0x8ab4f81a))
                    .text_color(rgb(0x8ab4f8))
                    .border_1()
                    .border_color(rgba(0x8ab4f833))
                    .hover(|s| s.bg(rgba(0x8ab4f82a)))
                    .debug_selector({
                        let id = id.to_owned();
                        move || format!("review-skill-{id}")
                    })
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.skill_proposal_action(
                            review_id.clone(),
                            review_proposal.clone(),
                            None,
                            cx,
                        )
                    })),
                )
            })
            .when(!busy && reviewed && !decided, |d| {
                d.child(
                    div()
                        .flex()
                        .gap(ui(8.))
                        .pt(ui(10.))
                        .border_t_1()
                        .border_color(rgba(0xebebeb12))
                        .children(
                            [("Approve & save", "approve"), ("Reject", "reject")]
                                .into_iter()
                                .filter(|(_, decision)| *decision != "approve" || blocked.is_none())
                                .map(|(label, decision)| {
                                    let id = id.to_owned();
                                    let proposal = proposal.clone();
                                    crate::plain_button(
                                        SharedString::from(format!("{decision}-skill-{id}")),
                                        label,
                                    )
                                    .h(ui(32.))
                                    .px(ui(12.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .border_1()
                                    .when(decision == "approve", |d| {
                                        d.bg(rgb(0x8ab4f8))
                                            .text_color(rgb(0x182334))
                                            .border_color(rgb(0x8ab4f8))
                                            .hover(|s| s.bg(rgb(0xa2c4fa)))
                                    })
                                    .when(decision == "reject", |d| {
                                        d.bg(rgba(0xebebeb08))
                                            .text_color(rgba(0xebebebb3))
                                            .border_color(rgba(0xebebeb26))
                                            .hover(|s| {
                                                s.bg(rgba(0xef888818))
                                                    .text_color(rgb(0xf0a0a0))
                                                    .border_color(rgba(0xef888840))
                                            })
                                    })
                                    .debug_selector({
                                        let id = id.clone();
                                        move || format!("{decision}-skill-{id}")
                                    })
                                    .on_click(cx.listener(
                                        move |s, _, _, cx| {
                                            s.skill_proposal_action(
                                                id.clone(),
                                                proposal.clone(),
                                                Some(decision),
                                                cx,
                                            )
                                        },
                                    ))
                                }),
                        ),
                )
            })
            .when(view.is_some_and(|v| v["savedSkillId"].is_string()), |d| {
                d.child(
                    crate::plain_button(
                        SharedString::from(format!("open-skill-{id}")),
                        "Open Skills library",
                    )
                    .h(ui(32.))
                    .bg(rgba(0x8ab4f818))
                    .text_color(rgb(0x8ab4f8))
                    .hover(|s| s.bg(rgba(0x8ab4f828)))
                    .on_click(cx.listener(|s, _, window, cx| {
                        s.set_settings(true, window, cx);
                        s.settings_page("skills", cx);
                    })),
                )
            })
            .into_any_element()
    }

    fn automation_proposal_action(
        &mut self,
        id: String,
        command: ProjectFileCommand,
        decision: Option<ProjectProposalDecision>,
        cx: &mut Context<Self>,
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
        let work = cx.background_executor().spawn(async move {
            crate::backend::RUNTIME.block_on(async {
                let value = backend
                    .request(
                        reqwest::Method::POST,
                        "/api/projects/proposal",
                        Some(serde_json::to_value(request)?),
                    )
                    .await?;
                Ok::<ProjectProposalView, anyhow::Error>(serde_json::from_value(value)?)
            })
        });
        state.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                let state = s.proposals.entry(id.clone()).or_default();
                state.task = None;
                match result {
                    Ok(view) => state.view = Some(view),
                    Err(error) => state.error = Some(error.to_string()),
                }
                for chat in &s.conversations {
                    if let Some(index) = chat
                        .transcript
                        .rows()
                        .iter()
                        .position(|r| r.message.id == id)
                    {
                        chat.transcript.scroll.remeasure_items(index..index + 1);
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn automation_proposal_card(
        &self,
        id: &str,
        command: &ProjectFileCommand,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ProjectFileCommand::SaveDefinition { content, path, .. } = command else {
            return div().into_any_element();
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
        let action_id = id.to_owned();
        let action_command = command.clone();
        div()
            .flex()
            .flex_col()
            .gap(ui(8.))
            .p(ui(12.))
            .border_1()
            .border_color(rgb(0x665533))
            .rounded(ui(6.))
            .child(format!("Automation proposal: {name}"))
            .child(path.clone())
            .child(match status {
                Some(ProjectProposalStatus::Saved) => {
                    "Saved. Execution remains subject to separate approval."
                }
                Some(ProjectProposalStatus::Declined) => "Declined. No changes saved.",
                _ => "Review the definition below before saving. Saving does not enable or run it.",
            })
            .when(pending, |d| {
                d.child(
                    div()
                        .id(SharedString::from(format!("proposal-content-{id}")))
                        .max_h(ui(280.))
                        .overflow_y_scroll()
                        .text_size(ui(11.))
                        .font_family("Menlo")
                        .children(
                            serde_json::to_string_pretty(&definition)
                                .unwrap_or_else(|_| content.clone())
                                .lines()
                                .map(|line| div().child(line.to_owned()))
                                .collect::<Vec<_>>(),
                        ),
                )
            })
            .when_some(state.and_then(|s| s.error.clone()), |d, error| {
                d.child(error)
            })
            .when(busy, |d| d.child("Updating proposal…"))
            .when(!busy && status.is_none(), |d| {
                d.child(
                    button(
                        SharedString::from(format!("review-proposal-{id}")),
                        "Review changes",
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.automation_proposal_action(
                            action_id.clone(),
                            action_command.clone(),
                            None,
                            cx,
                        )
                    })),
                )
            })
            .when(!busy && pending, |d| {
                d.child(
                    div().flex().gap(ui(8.)).children(
                        [
                            ("Save", ProjectProposalDecision::Save),
                            ("Decline", ProjectProposalDecision::Decline),
                        ]
                        .into_iter()
                        .map(|(label, decision)| {
                            let id = id.to_owned();
                            let command = command.clone();
                            button(SharedString::from(format!("{label}-proposal-{id}")), label)
                                .debug_selector({
                                    let id = id.clone();
                                    move || format!("{label}-proposal-{id}")
                                })
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.automation_proposal_action(
                                        id.clone(),
                                        command.clone(),
                                        Some(decision),
                                        cx,
                                    )
                                }))
                        }),
                    ),
                )
            })
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ProjectFileCommand, ProjectProposalDecision, ProjectProposalStatus, TextInput,
        WorkspaceView,
    };
    use gpui::{AppContext, IntoElement, Modifiers, TestAppContext, point, px, size};

    #[gpui::test]
    fn skill_cards_save_reject_and_restore_receipts(cx: &mut TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let backend = crate::backend::RUNTIME
            .block_on(crate::backend::Backend::connect(profile.path().to_owned()))
            .unwrap();
        let proposal = serde_json::json!({"type":"inferay.skill-proposal","action":"create","name":"Card test","command":"card-test","description":"Test card","promptTemplate":"Run the requested checks.","reason":"Save reusable instructions"});
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.backend =
                std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend.clone())));
            view
        });
        view.update(cx, |view, _| {
            let mut message: inferay_core::chat_protocol::ChatTranscriptMessage =
                serde_json::from_value(
                    serde_json::json!({"id":"skill-test","role":"system","content":""}),
                )
                .unwrap();
            let mut render = inferay_core::chat_protocol::NativeChatRender::default();
            render.skill_proposal =
                Some(Box::new(serde_json::from_str(r#"{"type":"inferay.skill-proposal","action":"create","name":"Card test","command":"card-test","description":"Test card","promptTemplate":"Run the requested checks.","reason":"Save reusable instructions"}"#).unwrap()));
            message.render = Some(render);
            view.conversations[0].transcript.publish(
                super::PreparedTranscript::prepare(
                    0,
                    [std::sync::Arc::new(message)],
                    "vscode-black",
                ),
                None,
            );
        });
        cx.simulate_resize(size(px(1200.), px(1200.)));
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(1200.), px(1200.)), |_, _| {
            view.clone().into_any_element()
        });
        let review = cx.debug_bounds("review-skill-skill-test").unwrap();
        cx.simulate_click(review.center(), Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert_eq!(view.skill_proposals["skill-test"].view["decided"], false)
        });
        let skills = crate::backend::RUNTIME
            .block_on(backend.request(reqwest::Method::GET, "/api/prompts", None))
            .unwrap();
        assert!(
            !skills
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["command"] == "card-test")
        );
        cx.draw(point(px(0.), px(0.)), size(px(1200.), px(1200.)), |_, _| {
            view.clone().into_any_element()
        });
        let approve = cx.debug_bounds("approve-skill-skill-test").unwrap();
        cx.simulate_click(approve.center(), Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(
                view.skill_proposals["skill-test"].view["savedSkillId"].is_string(),
                "{:?}",
                view.skill_proposals["skill-test"].error
            )
        });
        let skills = crate::backend::RUNTIME
            .block_on(backend.request(reqwest::Method::GET, "/api/prompts", None))
            .unwrap();
        let saved = skills
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["command"] == "card-test")
            .unwrap()
            .clone();
        assert_eq!(saved["promptTemplate"], proposal["promptTemplate"]);
        view.update(cx, |view, cx| {
            view.skill_proposals.clear();
            view.skill_proposal_action("skill-test".into(), proposal.clone(), None, cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert_eq!(
                view.skill_proposals["skill-test"].view["savedSkillId"],
                saved["_id"]
            )
        });
        let mut update = proposal.clone();
        update["action"] = serde_json::json!("update");
        update["skillId"] = saved["_id"].clone();
        update["expectedUpdatedAt"] = saved["updatedAt"].clone();
        update["promptTemplate"] = serde_json::json!("Updated instructions");
        view.update(cx, |view, cx| {
            view.skill_proposal_action("update".into(), update.clone(), None, cx)
        });
        cx.run_until_parked();
        view.update(cx, |view, cx| {
            view.skill_proposal_action("update".into(), update.clone(), Some("approve"), cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(view.skill_proposals["update"].view["savedSkillId"].is_string())
        });
        view.update(cx, |view, cx| {
            view.skill_proposal_action("stale".into(), update.clone(), None, cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(view.skill_proposals["stale"].view["blockedReason"].is_string())
        });
        view.update(cx, |view, cx| {
            view.skill_proposal_action("stale".into(), update.clone(), Some("reject"), cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert_eq!(view.skill_proposals["stale"].view["decided"], true)
        });
    }

    #[gpui::test]
    fn automation_proposal_requires_review_and_user_save_and_restores_receipt(
        cx: &mut TestAppContext,
    ) {
        let profile = tempfile::tempdir().unwrap();
        let backend = crate::backend::RUNTIME
            .block_on(crate::backend::Backend::connect(profile.path().to_owned()))
            .unwrap();
        let project = "00000000-0000-4000-8000-000000000001";
        crate::backend::RUNTIME.block_on(backend.request(reqwest::Method::POST, "/api/projects/command", Some(serde_json::json!({"type":"saveProject","expectedHash":null,"definition":{"schema":"inferay.project/1","id":project,"name":"Test","description":"","instructions":"","repositories":[]},"repositoryPaths":{}})))).unwrap();
        let command: ProjectFileCommand = serde_json::from_value(serde_json::json!({"type":"saveDefinition","projectId":project,"path":"automations/00000000-0000-4000-8000-000000000002/automation.json","expectedHash":null,"content":serde_json::json!({"schema":"inferay.automation/1","id":"00000000-0000-4000-8000-000000000002","name":"Test job","trigger":{"kind":"manual"},"overlap":"skip","may":[],"execution":{"kind":"agent","provider":"codex","instructions":"Test only","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300}}).to_string()})).unwrap();
        let path = profile
            .path()
            .join("projects")
            .join(project)
            .join("automations/00000000-0000-4000-8000-000000000002/automation.json");
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.backend =
                std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend.clone())));
            view
        });
        view.update(cx, |view, cx| {
            view.automation_proposal_action(
                "proposal-test".into(),
                command.clone(),
                Some(ProjectProposalDecision::Save),
                cx,
            )
        });
        cx.run_until_parked();
        assert!(!path.exists(), "Save must not run before review");
        view.update(cx, |view, cx| {
            view.automation_proposal_action("proposal-test".into(), command.clone(), None, cx)
        });
        cx.run_until_parked();
        assert!(!path.exists(), "Review must not write");
        view.update(cx, |view, _| {
            let mut message: inferay_core::chat_protocol::ChatTranscriptMessage =
                serde_json::from_value(
                    serde_json::json!({"id":"proposal-test","role":"system","content":""}),
                )
                .unwrap();
            let mut render = inferay_core::chat_protocol::NativeChatRender::default();
            render.automation_definition_proposal = Some(Box::new(command.clone()));
            message.render = Some(render);
            view.conversations[0].transcript.publish(
                super::PreparedTranscript::prepare(
                    0,
                    [std::sync::Arc::new(message)],
                    "vscode-black",
                ),
                None,
            );
        });
        view.read_with(cx, |view, _| {
            let state = &view.proposals["proposal-test"];
            assert!(state.task.is_none());
            assert!(
                state
                    .view
                    .as_ref()
                    .is_some_and(|v| v.status == ProjectProposalStatus::Pending),
                "{:?}",
                state.error
            );
        });
        cx.simulate_resize(size(px(1200.), px(1200.)));
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(1200.), px(1200.)), |_, _| {
            view.clone().into_any_element()
        });
        let save = cx.debug_bounds("Save-proposal-proposal-test").unwrap();
        cx.simulate_click(save.center(), Modifiers::default());
        cx.run_until_parked();
        assert!(path.exists());
        view.read_with(cx, |view, _| {
            assert!(
                view.proposals["proposal-test"]
                    .view
                    .as_ref()
                    .is_some_and(|v| v.status == ProjectProposalStatus::Saved)
            )
        });
        view.update(cx, |view, cx| {
            view.proposals.clear();
            view.automation_proposal_action("proposal-test".into(), command.clone(), None, cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(
                view.proposals["proposal-test"]
                    .view
                    .as_ref()
                    .is_some_and(|v| v.status == ProjectProposalStatus::Saved)
            )
        });
        let saved = std::fs::read(&path).unwrap();
        view.update(cx, |view, cx| {
            view.automation_proposal_action("stale".into(), command.clone(), None, cx)
        });
        cx.run_until_parked();
        view.update(cx, |view, cx| {
            view.automation_proposal_action(
                "stale".into(),
                command.clone(),
                Some(ProjectProposalDecision::Save),
                cx,
            )
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(view.proposals["stale"].error.is_some())
        });
        assert_eq!(
            std::fs::read(&path).unwrap(),
            saved,
            "A stale proposal must not overwrite the saved definition"
        );
        view.update(cx, |view, cx| {
            view.automation_proposal_action(
                "stale".into(),
                command.clone(),
                Some(ProjectProposalDecision::Decline),
                cx,
            )
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(
                view.proposals["stale"]
                    .view
                    .as_ref()
                    .is_some_and(|v| v.status == ProjectProposalStatus::Declined)
            )
        });
        let state = crate::backend::RUNTIME
            .block_on(backend.request(
                reqwest::Method::GET,
                &format!("/api/projects?projectId={project}"),
                None,
            ))
            .unwrap();
        assert_eq!(state["catalog"]["automations"][0]["enabled"], false);
    }
}
