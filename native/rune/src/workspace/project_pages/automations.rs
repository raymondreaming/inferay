use super::*;
use crate::icons;
use crate::ui::icon_sized;

static STARTERS: std::sync::LazyLock<Vec<Value>> = std::sync::LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../assets/automation-starters.json"))
        .expect("bundled automation starters")
});

impl Workspace {
    pub(super) fn sync_automation_selection(&mut self) {
        let state = &self.project_pages;
        let automations = list(&state.data["catalog"], "automations");
        let current = automations
            .iter()
            .find(|a| {
                a["file"]["id"].as_str() == state.selected.as_deref()
                    && a["file"]["definition"]["archived"] != true
            })
            .or_else(|| {
                automations
                    .iter()
                    .find(|a| a["file"]["definition"]["archived"] != true)
            })
            .cloned();
        if let Some(current) = current {
            if self.project_pages.draft["id"] != current["file"]["id"] {
                self.edit_automation(Some(current), None);
            } else {
                self.project_pages.original["enabled"] = current["enabled"].clone();
                self.queue_automation_save();
            }
        } else {
            self.project_pages.draft = Value::Null;
            self.project_pages.original = Value::Null;
            self.project_pages.selected = None;
        }
    }
    pub(super) fn edit_automation(
        &mut self,
        automation: Option<Value>,
        seed: Option<(&str, &str, Option<u64>)>,
    ) {
        if self.project_pages.screen == "edit" {
            self.project_pages.error =
                Some("Save or cancel the current automation before editing another.".into());
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
            state.set(field, &value);
        }
        self.project_pages.automation_baseline =
            self.automation_definition().unwrap_or(Value::Null);
    }
    pub(super) fn automation_definition(&self) -> Result<Value, String> {
        let state = &self.project_pages;
        let mut draft = state.draft.clone();
        draft["name"] = json!(state.text("name"));
        if draft["execution"]["kind"] == "agent" {
            for (field, key) in [
                ("instructions", "instructions"),
                ("model", "model"),
                ("reasoning", "reasoningLevel"),
            ] {
                draft["execution"][key] = json!(state.text(field));
            }
            draft["execution"]["timeoutSeconds"] =
                json!(state.text("timeout").parse::<u64>().unwrap_or(0));
        } else {
            match serde_json::from_str::<Value>(&state.text("input")) {
                Ok(input) => draft["execution"]["input"] = input,
                Err(e) => return Err(format!("Invalid tool input: {e}")),
            }
        }
        if draft["trigger"]["kind"] == "interval" {
            draft["trigger"]["seconds"] = json!(state.text("interval").parse::<u64>().unwrap_or(0));
        }
        if draft["trigger"]["kind"] == "calendar" {
            draft["trigger"]["times"] = json!(
                state
                    .text("time")
                    .split(',')
                    .map(str::trim)
                    .collect::<Vec<_>>()
            );
            draft["trigger"]["timezone"] = json!(state.text("timezone"));
        }
        Ok(draft)
    }
    pub(super) fn queue_automation_save(&mut self) {
        let state = &self.project_pages;
        if state.page != Some("Automations")
            || state.screen != "detail"
            || state.original.is_null()
            || state.error.is_some()
        {
            return;
        }
        let Ok(draft) = self.automation_definition() else {
            return;
        };
        if draft == self.project_pages.automation_baseline {
            return;
        }
        self.project_pages.automation_save = Some(crate::task::spawn(
            async { tokio::time::sleep(std::time::Duration::from_millis(650)).await },
            |s: &mut Workspace, _, _| {
                s.project_pages.automation_save = None;
                if s.project_pages.mutating {
                    s.queue_automation_save();
                } else if s.project_pages.screen == "detail" {
                    s.save_automation();
                }
            },
        ));
    }
    pub(super) fn automation_can_leave(&mut self) -> bool {
        if self.project_pages.mutating {
            return false;
        }
        if self.project_pages.screen == "edit" {
            self.project_pages.error = Some("Create or cancel this draft first.".into());
            return false;
        }
        if self.project_pages.screen == "detail"
            && !self.project_pages.original.is_null()
            && self
                .automation_definition()
                .is_ok_and(|d| d != self.project_pages.automation_baseline)
        {
            if self.project_pages.error.is_none() {
                self.save_automation();
            }
            return false;
        }
        self.project_pages.automation_save = None;
        true
    }
    pub(super) fn save_automation(&mut self) {
        let draft = match self.automation_definition() {
            Ok(draft) => draft,
            Err(error) => {
                self.project_pages.error = Some(error);
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
        );
    }
    pub(super) fn review_automation(&mut self, id: String, run: bool) {
        self.project_pages.selected = Some(id.clone());
        self.project_pages.screen = if run { "review-run" } else { "review-enable" };
        self.project_request(
            "/api/projects/command".into(),
            Some(json!({"type":"reviewAutomation","id":id})),
            "review",
        );
    }
    pub(super) fn automation_repositories(&self) -> Vec<(String, String)> {
        list(&self.project_pages.data["catalog"], "projects")
            .iter()
            .filter(|p| p["id"] == self.project_pages.project)
            .flat_map(|p| list(&p["definition"], "repositories"))
            .map(|r| (text(r, "id"), text(r, "name")))
            .collect()
    }
    pub(super) fn automations_page(&self) -> El {
        let state = &self.project_pages;
        let needle = state.text("search").to_lowercase();
        let width = state.viewport_width;
        let mut automations = col()
            .key("automations-list")
            .grow(1.)
            .min_h(0.)
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .gap(ui(12.));
        for a in list(&state.data["catalog"], "automations")
            .iter()
            .filter(|a| {
                a["file"]["definition"]["archived"] != true
                    && text(&a["file"]["definition"], "name")
                        .to_lowercase()
                        .contains(&needle)
            })
        {
            automations = automations.child(self.automation_row(a));
        }
        let sidebar = side_border(
            col()
                .key("automations-list-panel")
                .w(ui(if width <= 1050. { 180. } else { 230. }))
                .h_full()
                .gap(ui(12.)),
            [0., 1., 0., 0.],
            0xebebeb07,
        )
        .child(
            side_border(
                row().items_center().gap(ui(8.)).padding(ui(14.)),
                [0., 0., 1., 0.],
                0xebebeb07,
            )
            .child(icon_sized(&icons::SEARCH, 16.))
            .child(
                col()
                    .grow(1.)
                    .min_w(0.)
                    .padding(ui(4.))
                    .child(state.input("search")),
            )
            .child(
                button("new-automation", "")
                    .label("New automation")
                    .px(ui(4.))
                    .child(icon_sized(&icons::PLUS, 16.))
                    .on_press(|s: &mut Workspace| {
                        if s.automation_can_leave() {
                            s.project_pages.screen = "starters";
                            s.project_pages.automation_menu = None;
                        }
                    }),
            ),
        )
        .child(automations)
        .child(
            pressable("automation-history", "History")
                .items_center()
                .gap(ui(6.))
                .mx(ui(18.))
                .mb(ui(16.))
                .child(Ink::new(12.).hex(0xebebeb80).line_text("History"))
                .on_press(|s: &mut Workspace| {
                    if s.automation_can_leave() {
                        s.project_pages.screen = "history";
                        s.project_pages.selected = None;
                        s.reload_project_page();
                    }
                }),
        );
        let mut inner = col()
            .w_full()
            .max_w(ui(1240.))
            .py(ui(32.))
            .px(ui((width * 0.04).clamp(24., 72.)))
            .gap(ui(20.));
        if state.screen == "history" {
            inner = inner.child(self.automation_history());
        }
        if state.screen == "effects" {
            inner = inner.child(self.effects_page());
        }
        if state.screen == "starters" || (state.draft.is_null() && state.screen == "detail") {
            inner = inner
                .child(Ink::new(22.).weight(SEMIBOLD).text("New automation"))
                .child(label("Pick a starting point, or write your own task."))
                .child(starters(if width > 1100. { 2 } else { 1 }));
        }
        if !state.draft.is_null() && ["detail", "edit"].contains(&state.screen) {
            if state.screen == "detail" {
                let tab = Ink::new(12.).hex(0xebebeb99);
                inner = inner.child(
                    row()
                        .gap(ui(8.))
                        .child(button_ink("automation-settings-tab", "Settings", tab))
                        .child(
                            button_ink("automation-history-tab", "History", tab).on_press(
                                |s: &mut Workspace| {
                                    if s.automation_can_leave() {
                                        s.project_pages.screen = "history";
                                    }
                                },
                            ),
                        ),
                );
            }
            inner = inner.child(self.automation_editor());
        }
        if let Some(review) = &state.review {
            let run = state.screen == "review-run";
            let id = state.selected.clone().unwrap_or_default();
            let hash = review["inputsHash"].clone();
            let enable = !run || state.original["enabled"] == true;
            inner = inner.child(
                card()
                    .child(body(if run { "Run automation" } else { "Enable automation" }))
                    .child(review_details(review))
                    .child(
                        row()
                            .gap(ui(8.))
                            .child(
                                action("approve-automation", if run { "Approve & run" } else { "Approve & enable" })
                                    .on_press(move |s: &mut Workspace| {
                                        s.project_request(
                                            "/api/projects/command".into(),
                                            Some(json!({"type":"approveAutomation","id":id,"expectedInputsHash":hash,"enable":enable})),
                                            if run { "approve-run" } else { "mutation" },
                                        )
                                    }),
                            )
                            .child(button("cancel-automation-review", "Cancel").on_press(
                                |s: &mut Workspace| {
                                    s.project_pages.review = None;
                                    s.project_pages.screen = "detail";
                                },
                            )),
                    ),
            );
        }
        let content = col()
            .key("automation-content")
            .grow(1.)
            .min_w(0.)
            .min_h(0.)
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .child(col().w_full().items_center().child(inner));
        side_border(
            row().grow(1.).min_h(0.).min_w(0.),
            [1., 0., 0., 0.],
            0xebebeb07,
        )
        .child(sidebar)
        .child(content)
    }
    fn automation_row(&self, a: &Value) -> El {
        let state = &self.project_pages;
        let definition = &a["file"]["definition"];
        let id = text(&a["file"], "id");
        let item = a.clone();
        let selected = state.selected.as_deref() == Some(&id) && state.screen == "detail";
        let execution = &definition["execution"];
        let catalog = inferay_core::provider_config::renderer_catalog(&json!({}), &[]);
        let provider = if execution["provider"] == "claude" {
            catalog.agents.claude
        } else {
            catalog.agents.codex
        };
        let model = provider
            .models
            .iter()
            .find(|m| m.id == text(execution, "model"))
            .map(|m| m.short_label.clone().unwrap_or_else(|| m.label.clone()))
            .unwrap_or_else(|| text(execution, "model"));
        let target = if execution["workingDirectory"]["base"] == "repository" {
            self.automation_repositories()
                .into_iter()
                .find(|(id, _)| *id == text(&execution["workingDirectory"], "id"))
                .map(|(_, name)| name)
                .unwrap_or_else(|| "Repository".into())
        } else {
            "Project-wide".into()
        };
        let meta_ink = Ink::new(11.).hex(0xebebeb80);
        let mut meta = row().gap(ui(5.)).items_center();
        if execution["kind"] == "agent" {
            meta = meta
                .child(icon_sized(
                    if execution["workingDirectory"]["base"] == "repository" {
                        &icons::GIT_BRANCH
                    } else {
                        &icons::FOLDER
                    },
                    12.,
                ))
                .child(meta_ink.line_text(target).shrink())
                .child(icon_sized(
                    if execution["provider"] == "claude" {
                        &icons::CLAUDE
                    } else {
                        &icons::CODEX
                    },
                    12.,
                ))
                .child(meta_ink.line_text(model).shrink());
        } else {
            meta = meta.child(meta_ink.line_text("Local tool").shrink());
        }
        let mut entry = row()
            .items_start()
            .gap(ui(8.))
            .padding(ui(10.))
            .mx(ui(8.))
            .radius(ui(8.));
        if selected {
            entry = entry.fill(rgba(0xebebeb12));
        }
        entry
            .child(
                press_on(col(), format!("automation-{id}"), "")
                    .grow(1.)
                    .min_w(0.)
                    .gap(ui(5.))
                    .child(
                        Ink::new(11.)
                            .hex(0xebebeb99)
                            .text(if a["file"]["error"].is_string() {
                                "Needs repair".into()
                            } else {
                                schedule_summary(&definition["trigger"])
                            }),
                    )
                    .child(
                        Ink::new(13.)
                            .weight(SEMIBOLD)
                            .line_text(text(definition, "name")),
                    )
                    .child(meta)
                    .on_press(move |s: &mut Workspace| {
                        if s.automation_can_leave() {
                            s.edit_automation(Some(item.clone()), None);
                        }
                    }),
            )
            .child(self.automation_switch(
                id,
                a["enabled"] == true,
                definition["trigger"]["kind"] == "manual" || a["file"]["error"].is_string(),
            ))
    }
}

fn starters(columns: usize) -> El {
    let mut grid = col().gap(ui(14.));
    for chunk in STARTERS.chunks(columns) {
        let mut line = row().gap(ui(14.));
        for starter in chunk {
            let name = text(starter, "name");
            let instructions = text(starter, "instructions");
            let interval = starter["intervalSeconds"].as_u64();
            line = line.child(
                border(
                    press_on(col(), name.clone(), "")
                        .grow(1.)
                        .min_w(0.)
                        .min_h(ui(170.))
                        .padding(ui(22.))
                        .radius(ui(8.))
                        .gap(ui(12.))
                        .hover(rgba(0xebebeb08)),
                    0xebebeb07,
                )
                .child(Ink::new(13.).weight(SEMIBOLD).text(name.clone()))
                .child(label(text(starter, "description")))
                .child(label(match interval {
                    Some(86400) => "Every day",
                    Some(_) => "Every week",
                    None => "Your schedule",
                }))
                .on_press(move |s: &mut Workspace| {
                    s.edit_automation(None, Some((&name, &instructions, interval)))
                }),
            );
        }
        if chunk.len() < columns {
            line = line.child(el().grow(1.));
        }
        grid = grid.child(line);
    }
    grid
}

pub(super) fn schedule_label(trigger: &Value) -> String {
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

pub(super) fn display_time(value: &str) -> String {
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

pub(super) fn schedule_summary(trigger: &Value) -> String {
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
