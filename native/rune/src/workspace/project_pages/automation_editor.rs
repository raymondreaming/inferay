use super::automations::{display_time, schedule_label};
use super::*;
use crate::icons;
use crate::ui::{icon_sized, menu_surface};

const DAYS: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

fn provider_catalog(draft: &Value) -> inferay_core::provider_config::AgentDefinition {
    let catalog = inferay_core::provider_config::renderer_catalog(&json!({}), &[]);
    if draft["execution"]["provider"] == "claude" {
        catalog.agents.claude
    } else {
        catalog.agents.codex
    }
}

fn toggle(values: &mut Value, id: &Value) {
    let values = values.as_array_mut().expect("automation list");
    if values.contains(id) {
        values.retain(|v| v != id);
    } else {
        values.push(id.clone());
    }
}

impl Workspace {
    pub(super) fn automation_editor(&self) -> El {
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
        let provider = provider_catalog(draft);
        let model = provider
            .models
            .iter()
            .find(|m| m.id == state.text("model"))
            .map(|m| m.short_label.clone().unwrap_or_else(|| m.label.clone()))
            .unwrap_or_else(|| state.text("model"));
        let small = Ink::new(12.);
        let mut buttons = row().gap(ui(8.));
        if !existing {
            buttons = buttons.child(
                filled_button("cancel-automation-edit", "Cancel", small, 0xebebeb0d).on_press(
                    |s: &mut Workspace| {
                        s.project_pages.draft = Value::Null;
                        s.project_pages.screen = "detail";
                        s.reload_project_page();
                    },
                ),
            );
        } else {
            buttons = buttons.child(button_ink("archive-automation", "Delete…", small).on_press(
                |s: &mut Workspace| {
                    let a = &s.project_pages.original;
                    let mut definition = a["file"]["definition"].clone();
                    definition["archived"] = json!(true);
                    s.project_pages.confirmation = Some((
                        "Delete this automation? History is kept.".into(),
                        json!({"type":"saveDefinition","projectId":s.project_pages.project,"path":a["file"]["sourcePath"],"content":definition.to_string(),"expectedHash":a["file"]["sourceHash"]}),
                    ));
                },
            ));
        }
        if state.mutating {
            buttons = buttons.child(label("Saving…"));
        }
        if existing {
            buttons = buttons.child(
                filled_button("run-automation", "Run now", small, 0xebebeb0d).on_press(
                    |s: &mut Workspace| {
                        if s.automation_can_leave() {
                            s.review_automation(text(&s.project_pages.draft, "id"), true);
                        }
                    },
                ),
            );
        } else {
            buttons = buttons.child(
                filled_button("save-automation", "Create", small, 0xebebeb18)
                    .on_press(|s: &mut Workspace| s.save_automation()),
            );
        }
        let title = row()
            .key("automation-title-row")
            .items_center()
            .gap(ui(24.))
            .child(col().grow(1.).min_w(0.).child(state.input("name")))
            .child(buttons);
        let mut meta = side_border(
            row().items_center().flex_wrap().gap(ui(16.)).pb(ui(24.)),
            [0., 0., 1., 0.],
            0xebebeb07,
        );
        if existing {
            meta = meta
                .child(self.automation_switch(
                    text(draft, "id"),
                    state.original["enabled"] == true,
                    draft["trigger"]["kind"] == "manual",
                ))
                .child(label("Active"));
        }
        meta = meta
            .child(label("Project automation"))
            .child(self.automation_dropdown(
                "kind",
                if agent { "Agent task" } else { "Local tool" },
                None,
            ));
        meta = if agent {
            meta.child(self.automation_dropdown(
                "target",
                &target,
                Some(
                    if draft["execution"]["workingDirectory"]["base"] == "repository" {
                        &icons::GIT_BRANCH
                    } else {
                        &icons::FOLDER
                    },
                ),
            ))
        } else {
            meta.child(label("Uses the tool’s working directory"))
        };
        let kind = &draft["trigger"]["kind"];
        let mut schedule =
            row()
                .items_center()
                .flex_wrap()
                .gap(ui(8.))
                .child(self.automation_dropdown(
                    "trigger",
                    &if kind == "manual" {
                        "＋ Add trigger".into()
                    } else {
                        format!("Scheduled · {}", schedule_label(&draft["trigger"]))
                    },
                    None,
                ));
        if kind == "calendar" {
            if list(&draft["trigger"], "days").len() != 7 {
                let day = draft["trigger"]["days"][0]
                    .as_u64()
                    .unwrap_or(1)
                    .saturating_sub(1)
                    .min(6);
                schedule =
                    schedule.child(self.automation_dropdown("day", DAYS[day as usize], None));
            }
            schedule = schedule
                .child(Ink::body().line_text("at"))
                .child(self.automation_dropdown("time", &display_time(&state.text("time")), None))
                .child(self.automation_dropdown("timezone", &state.text("timezone"), None));
        }
        let mut trigger = col()
            .gap(ui(16.))
            .mt(ui(12.))
            .child(label("Triggers"))
            .child(schedule);
        if kind != "manual" {
            trigger = trigger.child(label("Enable after saving · Runs while Inferay is open"));
        }
        if kind == "interval" && draft["trigger"]["seconds"] != 3600 {
            trigger = trigger.child(
                row()
                    .items_center()
                    .gap(ui(16.))
                    .child(Ink::body().line_text("Every (seconds)"))
                    .child(col().w(ui(120.)).child(state.field("interval"))),
            );
        }
        let reasoning = inferay_core::provider_config::reasoning_levels_for(&state.text("model"))
            .iter()
            .find(|r| r.id == state.text("reasoning"))
            .map(|r| r.label.clone())
            .unwrap_or_else(|| state.text("reasoning"));
        let instructions = col()
            .gap(ui(16.))
            .mt(ui(12.))
            .child(label("Instructions"))
            .child(
                border(
                    col()
                        .key("automation-instructions")
                        .radius(ui(12.))
                        .fill(rgb(colors::SURFACE)),
                    0xebebeb0f,
                )
                .child(col().padding(ui(16.)).child(state.input("instructions")))
                .child(
                    row()
                        .flex_wrap()
                        .gap(ui(6.))
                        .padding(ui(10.))
                        .child(self.automation_dropdown(
                            "provider",
                            &provider.label,
                            Some(if agent && draft["execution"]["provider"] == "claude" {
                                &icons::CLAUDE
                            } else {
                                &icons::CODEX
                            }),
                        ))
                        .child(self.automation_dropdown("model", &model, None))
                        .child(self.automation_dropdown("reasoning", &reasoning, None)),
                ),
            );
        let setting = |title: &str, detail: &str| {
            col()
                .gap(ui(4.))
                .child(Ink::body().text(title.to_owned()))
                .child(label(detail.to_owned()))
        };
        let context = col()
            .gap(ui(16.))
            .mt(ui(12.))
            .child(label("Context & execution"))
            .child(
                side_border(
                    row()
                        .items_center()
                        .justify_between()
                        .gap(ui(16.))
                        .py(ui(14.)),
                    [0., 0., 1., 0.],
                    0xebebeb07,
                )
                .child(setting("Project context", "Instructions, resources, and skills").shrink())
                .child(
                    filled_button(
                        "configure-automation",
                        if state.automation_configure {
                            "Done"
                        } else {
                            "Configure"
                        },
                        small,
                        0xebebeb0d,
                    )
                    .on_press(|s: &mut Workspace| {
                        s.project_pages.automation_configure = !s.project_pages.automation_configure
                    }),
                ),
            )
            .child(
                row()
                    .items_center()
                    .justify_between()
                    .gap(ui(16.))
                    .py(ui(14.))
                    .child(
                        setting("Overlapping runs", "When the previous run is still active")
                            .shrink(),
                    )
                    .child(self.automation_dropdown(
                        "overlap",
                        if draft["overlap"] == "queue_one" {
                            "Queue one"
                        } else {
                            "Skip"
                        },
                        None,
                    )),
            );
        let mut editor = col()
            .gap(ui(24.))
            .w_full()
            .child(title)
            .child(meta)
            .child(trigger);
        if agent {
            editor = editor.child(instructions).child(context);
        } else {
            let tool = list(&state.data["catalog"], "tools")
                .iter()
                .find(|t| t["id"] == draft["execution"]["tool"])
                .map(|t| text(&t["definition"], "name"))
                .unwrap_or_else(|| "Select a tool".into());
            editor = editor
                .child(label("Tool"))
                .child(self.automation_dropdown("tool", &tool, None))
                .child(label("Tool input (JSON)"))
                .child(state.field("input"));
        }
        if state.automation_configure || !agent {
            editor = editor.child(self.automation_context());
        }
        editor
    }

    fn automation_context(&self) -> El {
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
        let mark = |selected: bool| if selected { "✓" } else { "＋" };
        let mut panel = col()
            .gap(ui(14.))
            .padding(ui(16.))
            .radius(ui(8.))
            .fill(rgba(0xffffff05));
        for (choices, key, title) in [("resourceChoices", "resources", "Resources")] {
            let mut group = col().gap(ui(6.)).child(label(title));
            for choice in list(&state.data["catalog"], choices) {
                let id = choice["qualifiedId"]
                    .as_str()
                    .or_else(|| choice["id"].as_str())
                    .or_else(|| choice[0].as_str())
                    .unwrap_or("")
                    .to_owned();
                let name = choice["label"]
                    .as_str()
                    .or_else(|| choice[1].as_str())
                    .unwrap_or(&id)
                    .to_owned();
                let selected = list(&draft["execution"], key).contains(&json!(id));
                group = group.child(
                    button(format!("{key}-{id}"), &format!("{} {name}", mark(selected))).on_press(
                        move |s: &mut Workspace| {
                            toggle(&mut s.project_pages.draft["execution"][key], &json!(id));
                            s.queue_automation_save();
                        },
                    ),
                );
            }
            panel = panel.child(group);
        }
        panel = panel.child(label("Skills"));
        for skill in &skills {
            let id = skill.id.clone();
            let selected = list(&draft["execution"], "skills").contains(&json!(id));
            panel = panel.child(
                button(
                    id.clone(),
                    &format!("{} {} · {}", mark(selected), skill.label, skill.source),
                )
                .on_press(move |s: &mut Workspace| {
                    toggle(
                        &mut s.project_pages.draft["execution"]["skills"],
                        &json!(id),
                    );
                    s.queue_automation_save();
                }),
            );
        }
        panel = panel.child(label("Library tools — Available or Must pass"));
        for choice in list(&state.data["catalog"], "toolChoices") {
            let mut line = row()
                .flex_wrap()
                .gap(ui(6.))
                .child(body(text(choice, "label")).shrink());
            for (mode, title) in [
                ("none", "Not available"),
                ("optional", "Available"),
                ("required", "Must pass"),
            ] {
                let plugin = choice["pluginId"].clone();
                let tool = choice["toolId"].clone();
                let grant = list(&draft["execution"], "tools")
                    .iter()
                    .find(|g| g["pluginId"] == plugin && g["toolId"] == tool);
                let active = match mode {
                    "none" => grant.is_none(),
                    "required" => grant.is_some_and(|g| g["required"] == true),
                    _ => grant.is_some_and(|g| g["required"] != true),
                };
                let key = format!("{plugin}-{tool}-{mode}");
                let option = if active {
                    filled_button(key, title, Ink::small(), 0x8ab4f820)
                } else {
                    button(key, title)
                };
                line = line.child(option.on_press(move |s: &mut Workspace| {
                    let grants = s.project_pages.draft["execution"]["tools"]
                        .as_array_mut()
                        .expect("tool grants");
                    grants.retain(|g| g["pluginId"] != plugin || g["toolId"] != tool);
                    if mode != "none" {
                        grants.push(
                            json!({"pluginId":plugin,"toolId":tool,"required":mode=="required"}),
                        );
                    }
                    s.queue_automation_save();
                }));
            }
            panel = panel.child(line);
        }
        let mut permissions = row().flex_wrap().gap(ui(6.));
        for permission in [
            "read_repositories",
            "write_repositories",
            "commit",
            "push",
            "open_pr",
            "network",
            "gpu",
            "write_project_files",
        ] {
            let selected = list(draft, "may").contains(&json!(permission));
            permissions = permissions.child(
                button(
                    permission,
                    &format!("{} {}", mark(selected), permission.replace('_', " ")),
                )
                .on_press(move |s: &mut Workspace| {
                    toggle(&mut s.project_pages.draft["may"], &json!(permission));
                    s.queue_automation_save();
                }),
            );
        }
        panel
            .child(label("Permissions for local tools"))
            .child(permissions)
            .child(label("Timeout (seconds)"))
            .child(state.field("timeout"))
    }

    pub(super) fn automation_switch(&self, id: String, enabled: bool, disabled: bool) -> El {
        let mut knob = el().w(ui(14.)).h(ui(14.)).radius(9999.).fill(rgb(0xffffff));
        if enabled {
            knob = knob.ml(ui(12.));
        }
        let mut switch = pressable(format!("enable-{id}"), "Active automation")
            .items_center()
            .w(ui(30.))
            .h(ui(18.))
            .padding(ui(2.))
            .radius(9999.)
            .fill(if enabled {
                rgb(0x528fe8)
            } else {
                rgba(0xebebeb20)
            })
            .child(knob);
        if disabled {
            switch = switch.opacity(0.45);
        }
        switch.on_press(move |s: &mut Workspace| {
            if disabled || !s.automation_can_leave() {
                return;
            }
            if enabled {
                s.project_request(
                    "/api/projects/command".into(),
                    Some(json!({"type":"disableAutomation","id":id})),
                    "mutation",
                );
            } else {
                s.review_automation(id.clone(), false);
            }
        })
    }

    fn automation_dropdown(
        &self,
        key: &'static str,
        title: &str,
        glyph: Option<&'static rune::Icon>,
    ) -> El {
        let quiet = ["provider", "model", "reasoning"].contains(&key);
        let radius = ui(8.);
        let mut dropdown = styled_button(
            format!("automation-dropdown-{key}"),
            "",
            Ink::new(12.),
            (!quiet).then_some(0xebebeb0d),
            radius,
        )
        .label(title.to_owned())
        .gap(ui(8.))
        .px(ui(10.))
        .h(ui(28.));
        if !quiet {
            dropdown = border(dropdown, 0xebebeb08);
        } else {
            dropdown = border(dropdown, 0x00000000);
        }
        dropdown = dropdown.child(
            el().key(format!("automation-dropdown-{key}-anchor"))
                .pin(Some(ui(10.)), Some(0.), Some(0.), Some(0.))
                .inert(),
        );
        if let Some(glyph) = glyph {
            dropdown = dropdown.child(icon_sized(glyph, 14.));
        }
        dropdown
            .child(Ink::new(12.).line_text(title.to_owned()))
            .child(icon_sized(&icons::CHEVRON_DOWN, 10.))
            .on_press(move |s: &mut Workspace| {
                s.project_pages.automation_menu = if s.project_pages.automation_menu == Some(key) {
                    None
                } else {
                    Some(key)
                };
            })
    }

    pub(super) fn automation_popup(&self) -> Option<El> {
        let state = &self.project_pages;
        let key = state.automation_menu?;
        let provider = provider_catalog(&state.draft);
        let pairs = |items: &[(&str, &str)]| -> Vec<(String, String)> {
            items
                .iter()
                .map(|(k, v)| ((*k).into(), (*v).into()))
                .collect()
        };
        let options: Vec<(String, String)> = match key {
            "kind" => pairs(&[("agent", "Agent task"), ("tool", "Local tool")]),
            "target" => std::iter::once(("project".into(), "Project-wide".into()))
                .chain(self.automation_repositories())
                .collect(),
            "provider" => pairs(&[("codex", "Codex"), ("claude", "Claude")]),
            "model" => provider
                .models
                .iter()
                .map(|m| (m.id.clone(), m.label.clone()))
                .collect(),
            "reasoning" => {
                inferay_core::provider_config::reasoning_levels_for(&state.text("model"))
                    .iter()
                    .map(|r| (r.id.clone(), r.label.clone()))
                    .collect()
            }
            "trigger" => pairs(&[
                ("3600", "Scheduled · Every hour"),
                ("86400", "Scheduled · Every day"),
                ("604800", "Scheduled · Every week"),
                ("custom", "Scheduled · Custom interval"),
                ("", "Manual only"),
            ]),
            "day" => DAYS
                .iter()
                .enumerate()
                .map(|(i, v)| ((i + 1).to_string(), (*v).into()))
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
            "overlap" => pairs(&[("skip", "Skip"), ("queue_one", "Queue one")]),
            "tool" => {
                let owner = |path: &str| path.split('/').take(2).collect::<Vec<_>>().join("/");
                list(&state.data["catalog"], "tools")
                    .iter()
                    .filter(|tool| {
                        tool["error"].is_null()
                            && owner(&text(tool, "sourcePath"))
                                == owner(&text(&state.original["file"], "sourcePath"))
                    })
                    .map(|t| (text(t, "id"), text(&t["definition"], "name")))
                    .collect()
            }
            _ => vec![],
        };
        let mut popup = menu_surface()
            .key("automation-menu")
            .min_w(ui(160.))
            .max_w(ui(360.))
            .anchored(
                format!("automation-dropdown-{key}-anchor"),
                rune::Side::Bottom,
                rune::Align::Start,
                0.,
            )
            .modal(true, |s: &mut Workspace| {
                s.project_pages.automation_menu = None
            });
        for (value, title) in options {
            popup = popup.child(
                button_ink(
                    format!("automation-option-{key}-{value}"),
                    &title,
                    Ink::new(12.),
                )
                .h(ui(30.))
                .on_press(move |s: &mut Workspace| s.choose_automation_option(key, &value)),
            );
        }
        Some(popup)
    }

    pub(super) fn choose_automation_option(&mut self, key: &str, value: &str) {
        let state = &mut self.project_pages;
        state.automation_menu = None;
        match key {
            "kind" if state.draft["execution"]["kind"] != value => {
                state.draft["execution"] = if value == "tool" {
                    json!({"kind":"tool","tool":"","input":{}})
                } else {
                    json!({"kind":"agent","provider":"codex","model":state.text("model"),"reasoningLevel":state.text("reasoning"),"instructions":state.text("instructions"),"tools":[],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300})
                };
                state.set("input", "{}");
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
                        .expect("repositories");
                    if !repos.contains(&json!(value)) {
                        repos.push(json!(value));
                    }
                }
            }
            "provider" => {
                state.draft["execution"]["provider"] = json!(value);
                let defaults = inferay_core::provider_config::resolve(&json!({"agentKind":value}));
                state.set("model", &defaults.model);
                state.set("reasoning", &defaults.reasoning_level);
            }
            "model" => state.set("model", value),
            "reasoning" => state.set("reasoning", value),
            "trigger" => {
                let trigger = serde_json::from_value(state.draft["trigger"].clone())
                    .unwrap_or(inferay_core::project_files::Trigger::Manual);
                match inferay_presentation::project_editor::trigger_preset(
                    inferay_presentation::project_editor::TriggerPreset {
                        trigger,
                        preset: value.into(),
                        timezone: state.text("timezone"),
                    },
                ) {
                    Ok(trigger) => {
                        state.draft["trigger"] = serde_json::to_value(trigger).unwrap();
                        if state.draft["trigger"]["kind"] == "calendar" {
                            let time = state.draft["trigger"]["times"][0]
                                .as_str()
                                .unwrap_or("09:00")
                                .to_owned();
                            state.set("time", &time);
                        }
                        if state.draft["trigger"]["kind"] == "interval" {
                            let seconds = state.draft["trigger"]["seconds"].to_string();
                            state.set("interval", &seconds);
                        }
                    }
                    Err(error) => state.error = Some(error),
                }
            }
            "day" => state.draft["trigger"]["days"] = json!([value.parse::<u8>().unwrap_or(1)]),
            "time" => state.set("time", value),
            "timezone" => state.set("timezone", value),
            "overlap" => state.draft["overlap"] = json!(value),
            "tool" => state.draft["execution"]["tool"] = json!(value),
            _ => {}
        }
        self.queue_automation_save();
    }
}
