use super::*;

fn local_time(millis: Option<i64>, format: &str) -> String {
    millis
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|d| d.with_timezone(&chrono::Local).format(format).to_string())
        .unwrap_or_default()
}

impl Workspace {
    pub(super) fn automation_history(&self) -> El {
        let state = &self.project_pages;
        let history = &state.data["history"];
        let mut upcoming: Vec<_> = list(&state.data["catalog"], "automations")
            .iter()
            .filter(|a| a["enabled"] == true && a["nextDueAt"].is_number())
            .collect();
        upcoming.sort_by_key(|a| a["nextDueAt"].as_i64());
        let mut page = col().gap(ui(16.)).child(Ink::new(22.).text("History"));
        if !upcoming.is_empty() {
            page = page
                .child(label("Upcoming"))
                .children(upcoming.iter().map(|a| {
                    card()
                        .child(body(text(&a["file"]["definition"], "name")))
                        .child(label(local_time(
                            a["nextDueAt"].as_i64(),
                            "%b %-d · %-I:%M %p",
                        )))
                }));
        }
        page = page.child(button("review-effects", "Needs review").on_press(
            |s: &mut Workspace| {
                let path = query(
                    "/api/projects/effects",
                    &[("projectId", &s.project_pages.project)],
                );
                s.project_request(path, None, "effects")
            },
        ));
        if list(history, "runs").is_empty() {
            page = page.child(
                card()
                    .child(body("Your first run starts here"))
                    .child(label(
                        "Run an automation, then inspect its inputs, logs, and files here.",
                    )),
            );
        }
        for run in list(history, "runs") {
            let id = text(run, "id");
            let mut entry = card()
                .child(label(format!(
                    "{} · {}",
                    text(&run["presentation"], "status"),
                    local_time(run["requestedAt"].as_i64(), "%b %-d, %Y · %-I:%M %p")
                )))
                .child(Ink::body().weight(SEMIBOLD).text(text(run, "name")))
                .child(label(text(
                    &run["snapshot"]["automation"]["execution"],
                    "instructions",
                )));
            if let Some(error) = run["error"].as_str() {
                entry = entry.child(label(error));
            }
            if let Some(summary) = run["presentation"]["summary"].as_str() {
                entry = entry.child(body(summary));
            }
            let mut actions = row().gap(ui(8.));
            if run["conversationAvailable"] == true {
                let chat_id = id.clone();
                actions = actions.child(action(format!("chat-{id}"), "Open chat").on_press(
                    move |s: &mut Workspace| {
                        s.project_request(
                            "/api/projects/run-chat".into(),
                            Some(json!({"id":chat_id})),
                            "run-chat",
                        )
                    },
                ));
            }
            if run["presentation"]["active"] == true {
                let stop_id = id.clone();
                actions = actions.child(action(format!("stop-{id}"), "Stop").on_press(
                    move |s: &mut Workspace| {
                        s.project_request(
                            "/api/projects/command".into(),
                            Some(json!({"type":"stopRun","id":stop_id})),
                            "mutation",
                        )
                    },
                ));
            }
            if run["presentation"]["retry"] == true {
                let retry_id = id.clone();
                actions = actions.child(action(format!("retry-{id}"), "Retry").on_press(move |s: &mut Workspace| {
                    s.project_request(
                        "/api/projects/command".into(),
                        Some(json!({"type":"retryRun","id":retry_id,"requestId":uuid::Uuid::new_v4().to_string()})),
                        "mutation",
                    )
                }));
            }
            entry = entry.child(actions);
            let directory = run["directory"].as_str().unwrap_or("");
            for log in list(&run["presentation"], "logs") {
                let path = query(
                    "/api/files/content",
                    &[("cwd", directory), ("path", log[1].as_str().unwrap_or(""))],
                );
                entry = entry.child(
                    button(
                        format!("log-{id}-{}", log[1]),
                        log[0].as_str().unwrap_or("Log"),
                    )
                    .on_press(move |s: &mut Workspace| {
                        s.project_request(path.clone(), None, "detail")
                    }),
                );
            }
            for artifact in list(history, "artifacts")
                .iter()
                .filter(|a| a["runId"] == id.as_str())
            {
                let path = query(
                    "/api/files/content",
                    &[
                        ("cwd", directory),
                        ("path", artifact["path"].as_str().unwrap_or("")),
                    ],
                );
                entry = entry.child(
                    button(
                        format!("artifact-{id}-{}", artifact["path"]),
                        &text(artifact, "path"),
                    )
                    .on_press(move |s: &mut Workspace| {
                        s.project_request(path.clone(), None, "detail")
                    }),
                );
            }
            page = page.child(entry);
        }
        if state.detail["content"].is_string() {
            page = page.child(card().child(body(text(&state.detail, "content"))));
        }
        if history["hasMoreRuns"] == true {
            let path = query(
                "/api/projects/history",
                &[
                    ("projectId", &state.project),
                    ("before", history["nextRunCursor"].as_str().unwrap_or("")),
                ],
            );
            page = page.child(action("older-runs", "Older runs").on_press(
                move |s: &mut Workspace| s.project_request(path.clone(), None, "history"),
            ));
        }
        page
    }

    pub(super) fn effects_page(&self) -> El {
        let state = &self.project_pages;
        let mut page = col().gap(ui(16.)).child(body("Needs review"));
        for effect in list(&state.detail, "effects") {
            let request = json!({"id":effect["id"],"intentHash":effect["intentHash"]});
            let presentation =
                serde_json::from_value::<inferay_core::projects::EffectState>(effect.clone())
                    .map(|s| s.presentation())
                    .ok();
            let dismissible = presentation.as_ref().is_some_and(|p| p.dismissible);
            let cancel = presentation.as_ref().and_then(|p| p.cancel.clone());
            let cancel_request = request.clone();
            let mut entry = card()
                .child(body(text(&effect["intent"], "kind")))
                .child(body(text(&effect["intent"], "target")))
                .child(body(
                    serde_json::to_string_pretty(&effect["intent"]["payload"]).unwrap_or_default(),
                ))
                .child(label(presentation.map(|p| p.status).unwrap_or_default()));
            if dismissible {
                entry = entry.child(
                    action(format!("dismiss-{}", effect["id"]), "Dismiss").on_press(
                        move |s: &mut Workspace| {
                            s.project_request(
                                "/api/projects/effects/dismiss".into(),
                                Some(request.clone()),
                                "effect-updated",
                            )
                        },
                    ),
                );
            }
            if let Some(title) = cancel {
                entry = entry.child(
                    action(format!("cancel-effect-{}", effect["id"]), &title).on_press(
                        move |s: &mut Workspace| {
                            s.project_request(
                                "/api/projects/effects/cancel".into(),
                                Some(cancel_request.clone()),
                                "effect-updated",
                            )
                        },
                    ),
                );
            }
            page = page.child(entry);
        }
        page
    }
}
