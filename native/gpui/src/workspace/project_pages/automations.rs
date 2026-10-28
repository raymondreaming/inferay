use super::*;
use crate::plain_button;

static STARTERS: std::sync::LazyLock<Vec<Value>> = std::sync::LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../assets/automation-starters.json"))
        .expect("bundled automation starters")
});

impl WorkspaceView {
    pub(super) fn edit_automation(
        &mut self,
        automation: Option<Value>,
        seed: Option<(&str, &str, Option<u64>)>,
        cx: &mut Context<Self>,
    ) {
        if self.project_pages.screen == "edit" {
            self.project_pages.error =
                Some("Save or cancel the current automation before editing another.".into());
            cx.notify();
            return;
        }
        let mut draft = automation
            .as_ref()
            .map(|a| a["file"]["definition"].clone())
            .unwrap_or_else(|| {
                serde_json::to_value(inferay_presentation::project_editor::new_automation(
                    inferay_presentation::project_editor::NewAutomation {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: seed.map_or("", |s| s.0).into(),
                        instructions: seed.map_or("", |s| s.1).into(),
                        model: inferay_core::provider_config::resolve(
                            &json!({"agentKind":"codex"}),
                        )
                        .model,
                        interval_seconds: seed.and_then(|s| s.2),
                        timezone: iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into()),
                    },
                ))
                .unwrap()
            });
        for key in ["tools", "skills", "resources", "repositories"] {
            if draft["execution"]["kind"] == "agent" && !draft["execution"][key].is_array() {
                draft["execution"][key] = json!([]);
            }
        }
        if !draft["may"].is_array() {
            draft["may"] = json!([]);
        }
        let state = &mut self.project_pages;
        state.selected = Some(text(&draft, "id"));
        state.original = automation.unwrap_or(Value::Null);
        state.draft = draft.clone();
        state.screen = if state.original.is_null() {
            "edit"
        } else {
            "detail"
        };
        state.automation_configure = false;
        state.automation_menu = None;
        state.error = None;
        state.notice = None;
        state.poll = None;
        for (field, value) in [
            ("name", text(&draft, "name")),
            ("instructions", text(&draft["execution"], "instructions")),
            ("model", text(&draft["execution"], "model")),
            ("reasoning", text(&draft["execution"], "reasoningLevel")),
            (
                "timeout",
                draft["execution"]["timeoutSeconds"]
                    .as_u64()
                    .unwrap_or(300)
                    .to_string(),
            ),
            (
                "interval",
                draft["trigger"]["seconds"]
                    .as_u64()
                    .unwrap_or(3600)
                    .to_string(),
            ),
            (
                "time",
                list(&draft["trigger"], "times")
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
            (
                "timezone",
                draft["trigger"]["timezone"]
                    .as_str()
                    .unwrap_or("UTC")
                    .into(),
            ),
            (
                "input",
                serde_json::to_string_pretty(&draft["execution"]["input"]).unwrap(),
            ),
        ] {
            state.set(field, &value, cx);
        }
        self.project_pages.automation_baseline =
            self.automation_definition(cx).unwrap_or(Value::Null);
        cx.notify();
    }
    fn automation_definition(&self, cx: &App) -> Result<Value, String> {
        let state = &self.project_pages;
        let mut draft = state.draft.clone();
        draft["name"] = json!(state.text("name", cx));
        if draft["execution"]["kind"] == "agent" {
            for (field, key) in [
                ("instructions", "instructions"),
                ("model", "model"),
                ("reasoning", "reasoningLevel"),
            ] {
                draft["execution"][key] = json!(state.text(field, cx));
            }
            draft["execution"]["timeoutSeconds"] =
                json!(state.text("timeout", cx).parse::<u64>().unwrap_or(0));
        } else {
            match serde_json::from_str::<Value>(&state.text("input", cx)) {
                Ok(input) => draft["execution"]["input"] = input,
                Err(e) => return Err(format!("Invalid tool input: {e}")),
            }
        }
        if draft["trigger"]["kind"] == "interval" {
            draft["trigger"]["seconds"] =
                json!(state.text("interval", cx).parse::<u64>().unwrap_or(0));
        }
        if draft["trigger"]["kind"] == "calendar" {
            draft["trigger"]["times"] = json!(
                state
                    .text("time", cx)
                    .split(',')
                    .map(str::trim)
                    .collect::<Vec<_>>()
            );
            draft["trigger"]["timezone"] = json!(state.text("timezone", cx));
        }
        Ok(draft)
    }
    pub(super) fn queue_automation_save(&mut self, cx: &mut Context<Self>) {
        if self.project_pages.page != Some("Automations")
            || self.project_pages.screen != "detail"
            || self.project_pages.original.is_null()
            || self.project_pages.error.is_some()
        {
            return;
        }
        let Ok(draft) = self.automation_definition(cx) else {
            return;
        };
        if draft == self.project_pages.automation_baseline {
            return;
        }
        self.project_pages.automation_save = Some(cx.spawn(async |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(650))
                .await;
            let _ = this.update(cx, |s, cx| {
                s.project_pages.automation_save = None;
                if s.project_pages.mutating {
                    s.queue_automation_save(cx);
                } else if s.project_pages.screen == "detail" {
                    s.save_automation(cx);
                }
            });
        }));
    }
    pub(super) fn automation_can_leave(&mut self, cx: &mut Context<Self>) -> bool {
        if self.project_pages.mutating {
            return false;
        }
        if self.project_pages.screen == "edit" {
            self.project_pages.error = Some("Create or cancel this draft first.".into());
            cx.notify();
            return false;
        }
        if self.project_pages.screen == "detail"
            && !self.project_pages.original.is_null()
            && self
                .automation_definition(cx)
                .is_ok_and(|d| d != self.project_pages.automation_baseline)
        {
            if self.project_pages.error.is_none() {
                self.save_automation(cx);
            }
            return false;
        }
        self.project_pages.automation_save = None;
        true
    }
    pub(super) fn save_automation(&mut self, cx: &mut Context<Self>) {
        let draft = match self.automation_definition(cx) {
            Ok(draft) => draft,
            Err(error) => {
                self.project_pages.error = Some(error);
                cx.notify();
                return;
            }
        };
        let state = &self.project_pages;
        let path = state.original["file"]["sourcePath"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| format!("automations/{}/automation.json", text(&draft, "id")));
        let command = json!({"type":"saveDefinition","projectId":state.project,"path":path,"content":serde_json::to_string_pretty(&draft).unwrap(),"expectedHash":state.original["file"]["sourceHash"]});
        self.project_pages.automation_submitted = draft.clone();
        self.project_pages.draft = draft;
        self.project_request(
            "/api/projects/command".into(),
            Some(command),
            "save-automation",
            cx,
        );
    }
    pub(super) fn review_automation(&mut self, id: String, run: bool, cx: &mut Context<Self>) {
        self.project_pages.selected = Some(id.clone());
        self.project_pages.screen = if run { "review-run" } else { "review-enable" };
        self.project_request(
            "/api/projects/command".into(),
            Some(json!({"type":"reviewAutomation","id":id})),
            "review",
            cx,
        );
    }
    pub(super) fn automations_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let needle = state.text("search", cx).to_lowercase();
        let width = state.viewport_width;
        let sidebar = div()
            .id("automations-list-panel")
            .debug_selector(|| "automations-list-panel".into())
            .w(ui(if width <= 1050. { 180. } else { 230. }))
            .flex_shrink_0()
            .h_full()
            .flex()
            .flex_col()
            .gap(ui(12.))
            .border_r_1()
            .border_color(rgba(0xebebeb07))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(ui(8.))
                    .p(ui(14.))
                    .border_b_1()
                    .border_color(rgba(0xebebeb07))
                    .child(icon("Search").size(ui(16.)))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .p(ui(4.))
                            .child(state.fields["search"].clone()),
                    )
                    .child(
                        button("new-automation", "")
                            .aria_label("New automation")
                            .px(ui(4.))
                            .child(icon("Plus").size(ui(16.)))
                            .on_click(cx.listener(|s, _, _, cx| {
                                if s.automation_can_leave(cx) {
                                    s.project_pages.screen = "starters";
                                    s.project_pages.automation_menu = None;
                                    cx.notify();
                                }
                            })),
                    ),
            )
            .child(
                div()
                    .id("automations-list")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap(ui(12.))
                    .children(
                        list(&state.data["catalog"], "automations")
                            .iter()
                            .filter(|a| {
                                a["file"]["definition"]["archived"] != true
                                    && text(&a["file"]["definition"], "name")
                                        .to_lowercase()
                                        .contains(&needle)
                            })
                            .map(|a| {
                                let definition = &a["file"]["definition"];
                                let id = text(&a["file"], "id");
                                let item = a.clone();
                                let selected = state.selected.as_deref() == Some(&id)
                                    && state.screen == "detail";
                                let execution = &definition["execution"];
                                let provider = inferay_core::provider_config::renderer_catalog(
                                    &json!({}),
                                    &[],
                                );
                                let provider = if execution["provider"] == "claude" {
                                    provider.agents.claude
                                } else {
                                    provider.agents.codex
                                };
                                let model = provider
                                    .models
                                    .iter()
                                    .find(|m| m.id == text(execution, "model"))
                                    .map(|m| {
                                        m.short_label.clone().unwrap_or_else(|| m.label.clone())
                                    })
                                    .unwrap_or_else(|| text(execution, "model"));
                                let target =
                                    if execution["workingDirectory"]["base"] == "repository" {
                                        self.automation_repositories()
                                            .into_iter()
                                            .find(|(id, _)| {
                                                *id == text(&execution["workingDirectory"], "id")
                                            })
                                            .map(|(_, name)| name)
                                            .unwrap_or_else(|| "Repository".into())
                                    } else {
                                        "Project-wide".into()
                                    };
                                div()
                                    .flex()
                                    .items_start()
                                    .gap(ui(8.))
                                    .p(ui(10.))
                                    .mx(ui(8.))
                                    .rounded(ui(8.))
                                    .when(selected, |d| d.bg(rgba(0xebebeb12)))
                                    .child(
                                        plain_button(
                                            SharedString::from(format!("automation-{id}")),
                                            "",
                                        )
                                        .h_auto()
                                        .px_0()
                                        .flex_1()
                                        .min_w_0()
                                        .flex_col()
                                        .items_start()
                                        .gap(ui(5.))
                                        .child(
                                            label(if a["file"]["error"].is_string() {
                                                "Needs repair".into()
                                            } else {
                                                schedule_summary(&definition["trigger"])
                                            })
                                            .text_size(ui(11.)),
                                        )
                                        .child(
                                            div()
                                                .text_size(ui(13.))
                                                .font_weight(FontWeight::SEMIBOLD)
                                                .text_ellipsis()
                                                .child(text(definition, "name")),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .gap(ui(5.))
                                                .items_center()
                                                .text_size(ui(11.))
                                                .text_color(rgba(0xebebeb80))
                                                .when(execution["kind"] == "agent", |d| {
                                                    d.child(
                                                        icon(
                                                            if execution["workingDirectory"]["base"]
                                                                == "repository"
                                                            {
                                                                "GitBranch"
                                                            } else {
                                                                "Folder"
                                                            },
                                                        )
                                                        .size(ui(12.)),
                                                    )
                                                    .child(target)
                                                    .child(
                                                        icon(
                                                            if execution["provider"] == "claude" {
                                                                "claude"
                                                            } else {
                                                                "codex"
                                                            },
                                                        )
                                                        .size(ui(12.)),
                                                    )
                                                    .child(model)
                                                })
                                                .when(execution["kind"] != "agent", |d| {
                                                    d.child("Local tool")
                                                }),
                                        )
                                        .on_click(
                                            cx.listener(move |s, _, _, cx| {
                                                if s.automation_can_leave(cx) {
                                                    s.edit_automation(Some(item.clone()), None, cx);
                                                }
                                            }),
                                        ),
                                    )
                                    .child(self.automation_switch(
                                        id,
                                        a["enabled"] == true,
                                        definition["trigger"]["kind"] == "manual"
                                            || a["file"]["error"].is_string(),
                                        cx,
                                    ))
                            }),
                    ),
            )
            .child(
                plain_button("automation-history", "History")
                    .h_auto()
                    .px_0()
                    .mx(ui(18.))
                    .mb(ui(16.))
                    .text_size(ui(12.))
                    .text_color(rgba(0xebebeb80))
                    .on_click(cx.listener(|s, _, _, cx| {
                        if s.automation_can_leave(cx) {
                            s.project_pages.screen = "history";
                            s.project_pages.selected = None;
                            s.reload_project_page(cx);
                            cx.notify();
                        }
                    })),
            );
        let content=div().id("automation-content").debug_selector(||"automation-content".into()).flex_1().min_w_0().min_h_0().overflow_y_scroll()
            .child(div().w_full().max_w(ui(1240.)).mx_auto().py(ui(32.)).px(ui((width*0.04).clamp(24.,72.))).flex().flex_col().gap(ui(20.))
                .when(state.screen=="history",|d|d.child(self.automation_history(cx)))
                .when(state.screen=="effects",|d|d.child(self.effects_page(cx)))
                .when(state.screen=="starters" || (state.draft.is_null() && state.screen=="detail"),|d|{
                    let columns=if width>1100. {2}else{1};
                    d.child(div().text_size(ui(22.)).font_weight(FontWeight::SEMIBOLD).child("New automation"))
                        .child(label("Pick a starting point, or write your own task."))
                        .child(div().flex().flex_col().gap(ui(14.)).children(STARTERS.chunks(columns).map(|row|div().flex().gap(ui(14.)).children(row.iter().map(|starter|{
                            let name=text(starter,"name");let instructions=text(starter,"instructions");let interval=starter["intervalSeconds"].as_u64();
                            plain_button(SharedString::from(name.clone()),"").flex_1().min_w_0().h_auto().min_h(ui(170.)).p(ui(22.)).border_1().border_color(rgba(0xebebeb07)).rounded(ui(8.)).flex_col().items_start().gap(ui(12.)).hover(|s|s.bg(rgba(0xebebeb08)))
                                .child(div().text_size(ui(13.)).font_weight(FontWeight::SEMIBOLD).child(name.clone())).child(label(text(starter,"description"))).child(label(match interval{Some(86400)=>"Every day",Some(_)=>"Every week",None=>"Your schedule"}))
                                .on_click(cx.listener(move |s,_,_,cx|s.edit_automation(None,Some((&name,&instructions,interval)),cx)))
                        })).when(row.len()<columns,|d|d.child(div().flex_1())))))
                })
                .when(!state.draft.is_null() && ["detail","edit"].contains(&state.screen),|d|d
                    .when(state.screen=="detail",|d|d.child(div().flex().gap(ui(8.)).child(button("automation-settings-tab","Settings").text_size(ui(12.)).text_color(rgba(0xebebeb99))).child(button("automation-history-tab","History").text_size(ui(12.)).text_color(rgba(0xebebeb99)).on_click(cx.listener(|s,_,_,cx|{if s.automation_can_leave(cx){s.project_pages.screen="history";cx.notify();}})))))
                    .child(self.automation_editor(cx)))
                .when_some(state.review.as_ref(),|d,review|{
                    let run=state.screen=="review-run";let id=state.selected.clone().unwrap_or_default();let hash=review["inputsHash"].clone();let enable=!run || state.original["enabled"]==true;
                    d.child(card().child(if run{"Run automation"}else{"Enable automation"}).child(review_details(review)).child(div().flex().gap(ui(8.))
                        .child(action("approve-automation",if run{"Approve & run"}else{"Approve & enable"}).on_click(cx.listener(move |s,_,_,cx|s.project_request("/api/projects/command".into(),Some(json!({"type":"approveAutomation","id":id,"expectedInputsHash":hash,"enable":enable})),if run{"approve-run"}else{"mutation"},cx))))
                        .child(button("cancel-automation-review","Cancel").on_click(cx.listener(|s,_,_,cx|{s.project_pages.review=None;s.project_pages.screen="detail";cx.notify();})))))
                }));
        div()
            .flex()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .text_size(ui(12.))
            .border_t_1()
            .border_color(rgba(0xebebeb07))
            .child(sidebar)
            .child(content)
            .into_any_element()
    }

    fn automation_editor(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let draft = &state.draft;
        let agent = draft["execution"]["kind"] == "agent";
        let existing = !state.original.is_null();
        let target = self
            .automation_repositories()
            .into_iter()
            .find(|(id, _)| *id == text(&draft["execution"]["workingDirectory"], "id"))
            .map(|(_, name)| name)
            .unwrap_or_else(|| "Project-wide".into());
        let catalog = inferay_core::provider_config::renderer_catalog(&json!({}), &[]);
        let provider = if draft["execution"]["provider"] == "claude" {
            catalog.agents.claude
        } else {
            catalog.agents.codex
        };
        let model = provider
            .models
            .iter()
            .find(|m| m.id == state.text("model", cx))
            .map(|m| m.short_label.clone().unwrap_or_else(|| m.label.clone()))
            .unwrap_or_else(|| state.text("model", cx));
        let title=div().debug_selector(||"automation-title-row".into()).flex().items_center().gap(ui(24.))
            .child(div().flex_1().min_w_0().font_weight(FontWeight::SEMIBOLD).child(state.fields["name"].clone()))
            .child(div().flex().gap(ui(8.))
                .when(!existing,|d|d.child(button("cancel-automation-edit","Cancel").text_size(ui(12.)).bg(rgba(0xebebeb0d)).on_click(cx.listener(|s,_,_,cx|{s.project_pages.draft=Value::Null;s.project_pages.screen="detail";s.reload_project_page(cx);cx.notify();}))))
                .when(existing,|d|d.child(button("archive-automation","Delete…").text_size(ui(12.)).on_click(cx.listener(|s,_,_,cx|{let a=&s.project_pages.original;let mut definition=a["file"]["definition"].clone();definition["archived"]=json!(true);s.project_pages.confirmation=Some(("Delete this automation? History is kept.".into(),json!({"type":"saveDefinition","projectId":s.project_pages.project,"path":a["file"]["sourcePath"],"content":definition.to_string(),"expectedHash":a["file"]["sourceHash"]})));cx.notify();}))))
                .when(state.mutating,|d|d.child(label("Saving…")))
                .when(existing,|d|d.child(button("run-automation","Run now").text_size(ui(12.)).bg(rgba(0xebebeb0d)).on_click(cx.listener(|s,_,_,cx|{if s.automation_can_leave(cx){s.review_automation(text(&s.project_pages.draft,"id"),true,cx);}}))))
                .when(!existing,|d|d.child(button("save-automation","Create").debug_selector(||"save-automation".into()).text_size(ui(12.)).bg(rgba(0xebebeb18)).on_click(cx.listener(|s,_,_,cx|s.save_automation(cx))))));
        let meta = div()
            .flex()
            .items_center()
            .flex_wrap()
            .gap(ui(16.))
            .pb(ui(24.))
            .border_b_1()
            .border_color(rgba(0xebebeb07))
            .when(existing, |d| {
                d.child(self.automation_switch(
                    text(draft, "id"),
                    state.original["enabled"] == true,
                    draft["trigger"]["kind"] == "manual",
                    cx,
                ))
                .child(label("Active"))
            })
            .child(label("Project automation"))
            .child(self.automation_dropdown(
                "kind",
                if agent { "Agent task" } else { "Local tool" },
                None,
                cx,
            ))
            .when(agent, |d| {
                d.child(self.automation_dropdown(
                    "target",
                    target,
                    Some(
                        if draft["execution"]["workingDirectory"]["base"] == "repository" {
                            "GitBranch"
                        } else {
                            "Folder"
                        },
                    ),
                    cx,
                ))
            })
            .when(!agent, |d| {
                d.child(label("Uses the tool’s working directory"))
            });
        let trigger = div()
            .flex()
            .flex_col()
            .gap(ui(16.))
            .mt(ui(12.))
            .child(label("Triggers"))
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_wrap()
                    .gap(ui(8.))
                    .child(self.automation_dropdown(
                        "trigger",
                        if draft["trigger"]["kind"] == "manual" {
                            "＋ Add trigger".into()
                        } else {
                            format!("Scheduled · {}", schedule_label(&draft["trigger"]))
                        },
                        None,
                        cx,
                    ))
                    .when(draft["trigger"]["kind"] == "calendar", |d| {
                        d.when(list(&draft["trigger"], "days").len() != 7, |d| {
                            d.child(
                                self.automation_dropdown(
                                    "day",
                                    [
                                        "Monday",
                                        "Tuesday",
                                        "Wednesday",
                                        "Thursday",
                                        "Friday",
                                        "Saturday",
                                        "Sunday",
                                    ][draft["trigger"]["days"]
                                        [0]
                                    .as_u64()
                                    .unwrap_or(1)
                                    .saturating_sub(1)
                                    .min(6) as usize],
                                    None,
                                    cx,
                                ),
                            )
                        })
                        .child("at")
                        .child(self.automation_dropdown(
                            "time",
                            display_time(&state.text("time", cx)),
                            None,
                            cx,
                        ))
                        .child(self.automation_dropdown(
                            "timezone",
                            state.text("timezone", cx),
                            None,
                            cx,
                        ))
                    }),
            )
            .when(draft["trigger"]["kind"] != "manual", |d| {
                d.child(label("Enable after saving · Runs while Inferay is open"))
            })
            .when(
                draft["trigger"]["kind"] == "interval" && draft["trigger"]["seconds"] != 3600,
                |d| {
                    d.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(ui(16.))
                            .child("Every (seconds)")
                            .child(div().w(ui(120.)).child(state.field("interval"))),
                    )
                },
            );
        let instructions = div()
            .flex()
            .flex_col()
            .gap(ui(16.))
            .mt(ui(12.))
            .child(label("Instructions"))
            .child(
                div()
                    .debug_selector(|| "automation-instructions".into())
                    .flex()
                    .flex_col()
                    .rounded(ui(12.))
                    .bg(rgb(colors::SHELL))
                    .border_1()
                    .border_color(rgba(0xebebeb0f))
                    .child(div().p(ui(16.)).child(state.fields["instructions"].clone()))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(ui(6.))
                            .p(ui(10.))
                            .child(self.automation_dropdown(
                                "provider",
                                provider.label,
                                Some(if agent && draft["execution"]["provider"] == "claude" {
                                    "claude"
                                } else {
                                    "codex"
                                }),
                                cx,
                            ))
                            .child(self.automation_dropdown("model", model, None, cx))
                            .child(
                                self.automation_dropdown(
                                    "reasoning",
                                    inferay_core::provider_config::reasoning_levels_for(
                                        &state.text("model", cx),
                                    )
                                    .iter()
                                    .find(|r| r.id == state.text("reasoning", cx))
                                    .map(|r| r.label.clone())
                                    .unwrap_or_else(|| state.text("reasoning", cx)),
                                    None,
                                    cx,
                                ),
                            ),
                    ),
            );
        let context = div()
            .flex()
            .flex_col()
            .gap(ui(16.))
            .mt(ui(12.))
            .child(label("Context & execution"))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(ui(16.))
                    .py(ui(14.))
                    .border_b_1()
                    .border_color(rgba(0xebebeb07))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(ui(4.))
                            .child("Project context")
                            .child(label("Instructions, resources, and skills")),
                    )
                    .child(
                        button(
                            "configure-automation",
                            if state.automation_configure {
                                "Done"
                            } else {
                                "Configure"
                            },
                        )
                        .debug_selector(|| "configure-automation".into())
                        .text_size(ui(12.))
                        .bg(rgba(0xebebeb0d))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.project_pages.automation_configure =
                                !s.project_pages.automation_configure;
                            cx.notify();
                        })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(ui(16.))
                    .py(ui(14.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(ui(4.))
                            .child("Overlapping runs")
                            .child(label("When the previous run is still active")),
                    )
                    .child(self.automation_dropdown(
                        "overlap",
                        if draft["overlap"] == "queue_one" {
                            "Queue one"
                        } else {
                            "Skip"
                        },
                        None,
                        cx,
                    )),
            );
        div()
            .flex()
            .flex_col()
            .gap(ui(24.))
            .w_full()
            .child(title)
            .child(meta)
            .child(trigger)
            .when(agent, |d| d.child(instructions).child(context))
            .when(!agent, |d| {
                d.child(label("Tool"))
                    .child(
                        self.automation_dropdown(
                            "tool",
                            list(&state.data["catalog"], "tools")
                                .iter()
                                .find(|t| t["id"] == draft["execution"]["tool"])
                                .map(|t| text(&t["definition"], "name"))
                                .unwrap_or_else(|| "Select a tool".into()),
                            None,
                            cx,
                        ),
                    )
                    .child(label("Tool input (JSON)"))
                    .child(state.field("input"))
            })
            .when(state.automation_configure || !agent, |d| {
                d.child(self.automation_context(cx))
            })
            .into_any_element()
    }

    fn automation_context(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let draft = &state.draft;

        let skills = inferay_presentation::project_editor::skill_choices(
            inferay_presentation::project_editor::SkillChoices {
                local: serde_json::from_value(state.data["catalog"]["skillChoices"].clone())
                    .unwrap_or_default(),
                global: list(&state.data, "globalSkills")
                    .iter()
                    .map(|v| (text(v, "_id"), text(v, "name")))
                    .collect(),
                owner_path: state.original["file"]["sourcePath"]
                    .as_str()
                    .map(|p| p.split('/').take(2).collect::<Vec<_>>().join("/"))
                    .unwrap_or_else(|| format!("automations/{}", text(draft, "id"))),
                selected: list(&draft["execution"], "skills")
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect(),
            },
        );
        div().flex().flex_col().gap(ui(14.)).p(ui(16.)).rounded(ui(8.)).bg(rgba(0xffffff05))
                .children([("resourceChoices","resources","Resources")].into_iter().map(|(choices,key,title)|{
                    div().flex().flex_col().gap(ui(6.)).child(label(title)).children(list(&state.data["catalog"],choices).iter().map(|choice|{
                        let id=choice["qualifiedId"].as_str().or_else(||choice["id"].as_str()).or_else(||choice[0].as_str()).unwrap_or("").to_owned();let name=choice["label"].as_str().or_else(||choice[1].as_str()).unwrap_or(&id).to_owned();let selected=list(&draft["execution"],key).contains(&json!(id));
                        button(SharedString::from(format!("{key}-{id}")),format!("{} {name}",if selected{"✓"}else{"＋"})).on_click(cx.listener(move |s,_,_,cx|{let values=s.project_pages.draft["execution"][key].as_array_mut().unwrap();if values.contains(&json!(id)){values.retain(|v|*v!=json!(id));}else{values.push(json!(id));}s.queue_automation_save(cx);cx.notify();}))
                    }))
                }))
                .child(label("Skills"))
                .children(skills.iter().map(|skill| {
                    let id=skill.id.clone(); let selected=list(&draft["execution"],"skills").contains(&json!(id));
                    button(SharedString::from(id.clone()),format!("{} {} · {}",if selected{"✓"}else{"＋"},skill.label,skill.source)).on_click(cx.listener(move |s,_,_,cx|{let values=s.project_pages.draft["execution"]["skills"].as_array_mut().unwrap();if values.contains(&json!(id)){values.retain(|v|*v!=json!(id));}else{values.push(json!(id));}s.queue_automation_save(cx);cx.notify();}))
                }))
                .child(label("Library tools — Available or Must pass"))
                .children(list(&state.data["catalog"],"toolChoices").iter().map(|choice| {
                    let plugin=choice["pluginId"].clone();let tool=choice["toolId"].clone();
                    div().flex().flex_wrap().gap(ui(6.)).child(text(choice,"label")).children([("none","Not available"),("optional","Available"),("required","Must pass")].into_iter().map(|(mode,title)|{
                        let plugin=plugin.clone();let tool=tool.clone();let grant=list(&draft["execution"],"tools").iter().find(|g|g["pluginId"]==plugin && g["toolId"]==tool);let active=match mode{"none"=>grant.is_none(),"required"=>grant.is_some_and(|g|g["required"]==true),_=>grant.is_some_and(|g|g["required"]!=true)};
                        button(SharedString::from(format!("{plugin}-{tool}-{mode}")),title).when(active,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{let grants=s.project_pages.draft["execution"]["tools"].as_array_mut().unwrap();grants.retain(|g|g["pluginId"]!=plugin || g["toolId"]!=tool);if mode!="none"{grants.push(json!({"pluginId":plugin,"toolId":tool,"required":mode=="required"}));}s.queue_automation_save(cx);cx.notify();}))
                    }))
                }))
            .child(label("Permissions for local tools"))
            .child(div().flex().flex_wrap().gap(ui(6.)).children(["read_repositories","write_repositories","commit","push","open_pr","network","gpu","write_project_files"].into_iter().map(|permission| {
                let selected=list(draft,"may").contains(&json!(permission));button(permission,format!("{} {}",if selected{"✓"}else{"＋"},permission.replace('_'," "))).on_click(cx.listener(move |s,_,_,cx|{let permissions=s.project_pages.draft["may"].as_array_mut().unwrap();if permissions.contains(&json!(permission)){permissions.retain(|v|*v!=json!(permission));}else{permissions.push(json!(permission));}s.queue_automation_save(cx);cx.notify();}))
            })))
            .child(label("Timeout (seconds)")).child(state.field("timeout")).into_any_element()
    }
    fn automation_repositories(&self) -> Vec<(String, String)> {
        list(&self.project_pages.data["catalog"], "projects")
            .iter()
            .filter(|p| p["id"] == self.project_pages.project)
            .flat_map(|p| list(&p["definition"], "repositories"))
            .map(|r| (text(r, "id"), text(r, "name")))
            .collect()
    }
    fn automation_switch(
        &self,
        id: String,
        enabled: bool,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        plain_button(SharedString::from(format!("enable-{id}")), "")
            .aria_label("Active automation")
            .w(ui(30.))
            .h(ui(18.))
            .p(ui(2.))
            .rounded_full()
            .bg(if enabled {
                rgb(0x528fe8)
            } else {
                rgba(0xebebeb20)
            })
            .when(disabled, |d| d.opacity(0.45))
            .child(
                div()
                    .size(ui(14.))
                    .rounded_full()
                    .bg(rgb(0xffffff))
                    .when(enabled, |d| d.ml(ui(12.))),
            )
            .on_click(cx.listener(move |s, _, _, cx| {
                cx.stop_propagation();
                if disabled || !s.automation_can_leave(cx) {
                    return;
                }
                if enabled {
                    s.project_request(
                        "/api/projects/command".into(),
                        Some(json!({"type":"disableAutomation","id":id})),
                        "mutation",
                        cx,
                    );
                } else {
                    s.review_automation(id.clone(), false, cx);
                }
            }))
            .into_any_element()
    }
    fn automation_dropdown(
        &self,
        key: &'static str,
        title: impl Into<SharedString>,
        glyph: Option<&'static str>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let title = title.into();
        let bounds = std::rc::Rc::new(std::cell::Cell::new(Bounds::<Pixels>::default()));
        let measured = bounds.clone();
        button(SharedString::from(format!("automation-dropdown-{key}")), "")
            .debug_selector(move || format!("automation-dropdown-{key}"))
            .aria_label(title.clone())
            .relative()
            .text_size(ui(12.))
            .gap(ui(8.))
            .px(ui(10.))
            .h(ui(28.))
            .bg(if ["provider", "model", "reasoning"].contains(&key) {
                rgba(0x00000000)
            } else {
                rgba(0xebebeb0d)
            })
            .border_1()
            .border_color(if ["provider", "model", "reasoning"].contains(&key) {
                rgba(0x00000000)
            } else {
                rgba(0xebebeb08)
            })
            .rounded(ui(8.))
            .child(
                canvas(move |b, _, _| measured.set(b), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            )
            .when_some(glyph, |d, g| d.child(icon(g).size(ui(14.))))
            .child(title)
            .child(icon("ChevronDown").size(ui(10.)))
            .on_click(cx.listener(move |s, _, _, cx| {
                s.project_pages.automation_menu = if s
                    .project_pages
                    .automation_menu
                    .is_some_and(|(open, _)| open == key)
                {
                    None
                } else {
                    Some((key, bounds.get()))
                };
                cx.notify();
            }))
            .into_any_element()
    }
    pub(super) fn automation_popup(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let Some((key, bounds)) = state.automation_menu else {
            return div().into_any_element();
        };
        let catalog = inferay_core::provider_config::renderer_catalog(&json!({}), &[]);
        let provider = if state.draft["execution"]["provider"] == "claude" {
            catalog.agents.claude
        } else {
            catalog.agents.codex
        };
        let options: Vec<(String, String)> = match key {
            "kind" => vec![
                ("agent".into(), "Agent task".into()),
                ("tool".into(), "Local tool".into()),
            ],
            "target" => std::iter::once(("project".into(), "Project-wide".into()))
                .chain(self.automation_repositories())
                .collect(),
            "provider" => vec![
                ("codex".into(), "Codex".into()),
                ("claude".into(), "Claude".into()),
            ],
            "model" => provider
                .models
                .iter()
                .map(|m| (m.id.clone(), m.label.clone()))
                .collect(),
            "reasoning" => {
                inferay_core::provider_config::reasoning_levels_for(&state.text("model", cx))
                    .iter()
                    .map(|r| (r.id.clone(), r.label.clone()))
                    .collect()
            }
            "trigger" => [
                ("3600", "Scheduled · Every hour"),
                ("86400", "Scheduled · Every day"),
                ("604800", "Scheduled · Every week"),
                ("custom", "Scheduled · Custom interval"),
                ("", "Manual only"),
            ]
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .collect(),
            "day" => [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
            ]
            .into_iter()
            .enumerate()
            .map(|(i, v)| ((i + 1).to_string(), v.into()))
            .collect(),
            "time" => (0..96)
                .map(|i| {
                    let value = format!("{:02}:{:02}", i / 4, (i % 4) * 15);
                    let title = format!(
                        "{}:{:02} {}",
                        if i / 4 % 12 == 0 { 12 } else { i / 4 % 12 },
                        (i % 4) * 15,
                        if i < 48 { "AM" } else { "PM" }
                    );
                    (value, title)
                })
                .collect(),
            "timezone" => chrono_tz::TZ_VARIANTS
                .iter()
                .map(|z| (z.name().into(), z.name().replace('_', " ")))
                .collect(),
            "overlap" => vec![
                ("skip".into(), "Skip".into()),
                ("queue_one".into(), "Queue one".into()),
            ],
            "tool" => list(&state.data["catalog"], "tools")
                .iter()
                .filter(|tool| {
                    tool["error"].is_null()
                        && text(tool, "sourcePath")
                            .split('/')
                            .take(2)
                            .collect::<Vec<_>>()
                            .join("/")
                            == text(&state.original["file"], "sourcePath")
                                .split('/')
                                .take(2)
                                .collect::<Vec<_>>()
                                .join("/")
                })
                .map(|t| (text(t, "id"), text(&t["definition"], "name")))
                .collect(),
            _ => vec![],
        };
        let popup = crate::menu_surface("automation-menu")
            .relative()
            .debug_selector(|| "automation-menu".into())
            .min_w(ui(160.))
            .max_w(ui(360.))
            .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                s.project_pages.automation_menu = None;
                cx.notify();
            }))
            .children(options.into_iter().map(|(value, label)| {
                button(
                    SharedString::from(format!("automation-option-{key}-{value}")),
                    label,
                )
                .text_size(ui(12.))
                .h(ui(30.))
                .on_click(
                    cx.listener(move |s, _, _, cx| s.choose_automation_option(key, &value, cx)),
                )
            }));
        gpui::deferred(
            gpui::anchored()
                .position(bounds.bottom_left())
                .snap_to_window()
                .child(popup),
        )
        .with_priority(2)
        .into_any_element()
    }
    fn choose_automation_option(&mut self, key: &str, value: &str, cx: &mut Context<Self>) {
        let state = &mut self.project_pages;
        state.automation_menu = None;
        match key {
            "kind" if state.draft["execution"]["kind"] != value => {
                state.draft["execution"] = if value == "tool" {
                    json!({"kind":"tool","tool":"","input":{}})
                } else {
                    json!({"kind":"agent","provider":"codex","model":state.text("model",cx),"reasoningLevel":state.text("reasoning",cx),"instructions":state.text("instructions",cx),"tools":[],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300})
                };
                state.set("input", "{}", cx);
            }
            "target" => {
                state.draft["execution"]["workingDirectory"] = if value == "project" {
                    json!({"base":"project","path":"."})
                } else {
                    json!({"base":"repository","id":value,"path":"."})
                };
                if value != "project" {
                    let repos = state.draft["execution"]["repositories"]
                        .as_array_mut()
                        .unwrap();
                    if !repos.contains(&json!(value)) {
                        repos.push(json!(value));
                    }
                }
            }
            "provider" => {
                state.draft["execution"]["provider"] = json!(value);
                let defaults = inferay_core::provider_config::resolve(&json!({"agentKind":value}));
                state.set("model", &defaults.model, cx);
                state.set("reasoning", &defaults.reasoning_level, cx);
            }
            "model" => state.set("model", value, cx),
            "reasoning" => state.set("reasoning", value, cx),
            "trigger" => {
                let trigger = serde_json::from_value(state.draft["trigger"].clone())
                    .unwrap_or(inferay_core::project_files::Trigger::Manual);
                match inferay_presentation::project_editor::trigger_preset(
                    inferay_presentation::project_editor::TriggerPreset {
                        trigger,
                        preset: value.into(),
                        timezone: state.text("timezone", cx),
                    },
                ) {
                    Ok(trigger) => {
                        state.draft["trigger"] = serde_json::to_value(trigger).unwrap();
                        if state.draft["trigger"]["kind"] == "calendar" {
                            state.set(
                                "time",
                                state.draft["trigger"]["times"][0]
                                    .as_str()
                                    .unwrap_or("09:00"),
                                cx,
                            );
                        }
                        if state.draft["trigger"]["kind"] == "interval" {
                            state.set(
                                "interval",
                                &state.draft["trigger"]["seconds"].to_string(),
                                cx,
                            );
                        }
                    }
                    Err(error) => state.error = Some(error),
                }
            }
            "day" => state.draft["trigger"]["days"] = json!([value.parse::<u8>().unwrap_or(1)]),
            "time" => state.set("time", value, cx),
            "timezone" => state.set("timezone", value, cx),
            "overlap" => state.draft["overlap"] = json!(value),
            "tool" => state.draft["execution"]["tool"] = json!(value),
            _ => {}
        }
        self.queue_automation_save(cx);
        cx.notify();
    }
    fn automation_history(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let history = &state.data["history"];
        let mut upcoming: Vec<_> = list(&state.data["catalog"], "automations")
            .iter()
            .filter(|a| a["enabled"] == true && a["nextDueAt"].is_number())
            .collect();
        upcoming.sort_by_key(|a| a["nextDueAt"].as_i64());
        div().flex().flex_col().gap(ui(16.)).child(div().text_size(ui(22.)).child("History"))
            .when(!upcoming.is_empty(),|d|d.child(label("Upcoming")).children(upcoming.iter().map(|a|card().child(text(&a["file"]["definition"],"name")).child(label(a["nextDueAt"].as_i64().and_then(chrono::DateTime::from_timestamp_millis).map(|d|d.with_timezone(&chrono::Local).format("%b %-d · %-I:%M %p").to_string()).unwrap_or_default())))))
            .child(button("review-effects","Needs review").on_click(cx.listener(|s,_,_,cx|s.project_request(query("/api/projects/effects",&[("projectId",&s.project_pages.project)]),None,"effects",cx))))
            .when(list(history,"runs").is_empty(),|d|d.child(card().child("Your first run starts here").child(label("Run an automation, then inspect its inputs, logs, and files here."))))
            .children(list(history,"runs").iter().map(|run|{
                let id=text(run,"id");let chat_id=id.clone();let stop_id=id.clone();let retry_id=id.clone();
                card().child(label(format!("{} · {}",text(&run["presentation"],"status"),run["requestedAt"].as_i64().and_then(chrono::DateTime::from_timestamp_millis).map(|d|d.with_timezone(&chrono::Local).format("%b %-d, %Y · %-I:%M %p").to_string()).unwrap_or_default())))
                    .child(div().font_weight(FontWeight::SEMIBOLD).child(text(run,"name"))).child(label(text(&run["snapshot"]["automation"]["execution"],"instructions")))
                    .when_some(run["error"].as_str(),|d,e|d.child(label(e.to_owned())))
                    .when_some(run["presentation"]["summary"].as_str(),|d,t|d.child(t.to_owned()))
                    .child(div().flex().gap(ui(8.))
                        .when(run["conversationAvailable"]==true,|d|d.child(action(SharedString::from(format!("chat-{id}")),"Open chat").on_click(cx.listener(move |s,_,_,cx|s.project_request("/api/projects/run-chat".into(),Some(json!({"id":chat_id})),"run-chat",cx)))))
                        .when(run["presentation"]["active"]==true,|d|d.child(action(SharedString::from(format!("stop-{id}")),"Stop").on_click(cx.listener(move |s,_,_,cx|s.project_request("/api/projects/command".into(),Some(json!({"type":"stopRun","id":stop_id})),"mutation",cx)))))
                        .when(run["presentation"]["retry"]==true,|d|d.child(action(SharedString::from(format!("retry-{id}")),"Retry").on_click(cx.listener(move |s,_,_,cx|s.project_request("/api/projects/command".into(),Some(json!({"type":"retryRun","id":retry_id,"requestId":uuid::Uuid::new_v4().to_string()})),"mutation",cx))))))
                    .children(list(&run["presentation"],"logs").iter().map(|log|{let path=query("/api/files/content",&[("cwd",run["directory"].as_str().unwrap_or("")),("path",log[1].as_str().unwrap_or(""))]);button(SharedString::from(format!("log-{id}-{}",log[1])),log[0].as_str().unwrap_or("Log").to_owned()).on_click(cx.listener(move |s,_,_,cx|s.project_request(path.clone(),None,"detail",cx)))}))
                    .children(list(history,"artifacts").iter().filter(|a|a["runId"]==id).map(|artifact|{let path=query("/api/files/content",&[("cwd",run["directory"].as_str().unwrap_or("")),("path",artifact["path"].as_str().unwrap_or(""))]);button(SharedString::from(format!("artifact-{id}-{}",artifact["path"])),text(artifact,"path")).on_click(cx.listener(move |s,_,_,cx|s.project_request(path.clone(),None,"detail",cx)))}))
            }))
            .when(state.detail["content"].is_string(),|d|d.child(card().child(text(&state.detail,"content"))))
            .when(history["hasMoreRuns"]==true,|d|{let path=query("/api/projects/history",&[("projectId",&state.project),("before",history["nextRunCursor"].as_str().unwrap_or(""))]);d.child(action("older-runs","Older runs").on_click(cx.listener(move |s,_,_,cx|s.project_request(path.clone(),None,"history",cx))))})
            .into_any_element()
    }
    fn effects_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        div()
            .flex()
            .flex_col()
            .gap(ui(16.))
            .child("Needs review")
            .children(list(&state.detail, "effects").iter().map(|effect| {
                let request = json!({"id":effect["id"],"intentHash":effect["intentHash"]});
                let presentation =
                    serde_json::from_value::<inferay_core::projects::EffectState>(effect.clone())
                        .map(|s| s.presentation())
                        .ok();
                let dismissible = presentation.as_ref().is_some_and(|p| p.dismissible);
                let cancel = presentation.as_ref().and_then(|p| p.cancel.clone());
                let cancel_request = request.clone();
                card()
                    .child(text(&effect["intent"], "kind"))
                    .child(text(&effect["intent"], "target"))
                    .child(
                        serde_json::to_string_pretty(&effect["intent"]["payload"])
                            .unwrap_or_default(),
                    )
                    .child(label(presentation.map(|p| p.status).unwrap_or_default()))
                    .when(dismissible, |d| {
                        d.child(
                            action(
                                SharedString::from(format!("dismiss-{}", effect["id"])),
                                "Dismiss",
                            )
                            .on_click(cx.listener(
                                move |s, _, _, cx| {
                                    s.project_request(
                                        "/api/projects/effects/dismiss".into(),
                                        Some(request.clone()),
                                        "effect-updated",
                                        cx,
                                    )
                                },
                            )),
                        )
                    })
                    .when_some(cancel, |d, title| {
                        d.child(
                            action(
                                SharedString::from(format!("cancel-effect-{}", effect["id"])),
                                title,
                            )
                            .on_click(cx.listener(
                                move |s, _, _, cx| {
                                    s.project_request(
                                        "/api/projects/effects/cancel".into(),
                                        Some(cancel_request.clone()),
                                        "effect-updated",
                                        cx,
                                    )
                                },
                            )),
                        )
                    })
            }))
            .into_any_element()
    }
}

fn schedule_label(trigger: &Value) -> String {
    match trigger["kind"].as_str() {
        Some("calendar") => {
            if list(trigger, "days").len() == 7 {
                "Every day".into()
            } else {
                "Every week".into()
            }
        }
        Some("interval") => {
            if trigger["seconds"] == 3600 {
                "Every hour".into()
            } else {
                format!(
                    "Every {} minutes",
                    trigger["seconds"].as_u64().unwrap_or(0) / 60
                )
            }
        }
        _ => "Manual only".into(),
    }
}

fn display_time(value: &str) -> String {
    let Some((hour, minute)) = value.split_once(':') else {
        return value.into();
    };
    let Ok(hour) = hour.parse::<u32>() else {
        return value.into();
    };
    format!(
        "{}:{} {}",
        if hour % 12 == 0 { 12 } else { hour % 12 },
        minute,
        if hour < 12 { "AM" } else { "PM" }
    )
}

fn schedule_summary(trigger: &Value) -> String {
    if trigger["kind"] != "calendar" {
        return schedule_label(trigger);
    }
    let days = list(trigger, "days");
    let day = if days.len() == 7 {
        "Every day".into()
    } else {
        days.iter()
            .filter_map(|d| d.as_u64())
            .filter_map(|d| {
                ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].get(d.saturating_sub(1) as usize)
            })
            .copied()
            .collect::<Vec<_>>()
            .join(", ")
    };
    let times = list(trigger, "times")
        .iter()
        .filter_map(Value::as_str)
        .map(display_time)
        .collect::<Vec<_>>()
        .join(", ");
    format!("{day} at {times} · {}", text(trigger, "timezone"))
}
