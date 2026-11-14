use super::*;

pub(super) const FIELDS: [(&str, &str); 4] = [
    ("skill-name", "name"),
    ("skill-command", "command"),
    ("skill-description", "description"),
    ("skill-prompt", "promptTemplate"),
];

fn encoded(id: &str) -> String {
    url::form_urlencoded::byte_serialize(id.as_bytes()).collect()
}

impl Workspace {
    pub(super) fn skills_settings(&self) -> El {
        let state = &self.settings_state;
        let needle = state.text("skill-search").to_lowercase();
        let skills = state.data.get("skills").and_then(Value::as_array);
        let current = skills
            .into_iter()
            .flatten()
            .find(|p| p["_id"].as_str() == state.skill.as_deref());
        let builtin = current.is_some_and(|p| p["isBuiltIn"] == true);
        let mut library = col()
            .key("skill-library")
            .w(ui(250.))
            .max_h(ui(560.))
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .child(state.field("skill-search"))
            .child(
                button("New skill")
                    .key("new-skill")
                    .mt(ui(12.))
                    .w_full()
                    .on_press(|s: &mut Workspace| s.select_skill(Some(String::new()))),
            );
        for skill in skills.into_iter().flatten().filter(|p| {
            format!("{} {} {}", p["name"], p["command"], p["description"])
                .to_lowercase()
                .contains(&needle)
        }) {
            let id = skill["_id"].as_str().unwrap_or("").to_owned();
            let name = skill["name"].as_str().unwrap_or("");
            let on = state.skill.as_ref() == Some(&id);
            library = library.child(
                pressable(col(), id.clone(), name, on.then_some(0xffffff17))
                    .w_full()
                    .py(ui(8.))
                    .mt(ui(4.))
                    .gap(ui(2.))
                    .child(text(Ink::small(), name))
                    .child(text(
                        Ink::new(11.).hex(0xebebeb80),
                        format!(
                            "/{}{}",
                            skill["command"].as_str().unwrap_or(""),
                            if skill["isBuiltIn"] == true {
                                " · Built in"
                            } else {
                                ""
                            }
                        ),
                    ))
                    .on_press(move |s: &mut Workspace| s.select_skill(Some(id.clone()))),
            );
        }
        let mut detail = col().grow(1.).min_w(0.);
        if state.skill.is_none() {
            detail = detail.child(text(
                Ink::body(),
                "Select a skill to view its instructions.",
            ));
        } else {
            for (label, field) in [
                ("Name", "skill-name"),
                ("Command", "skill-command"),
                ("Description", "skill-description"),
                ("Instructions", "skill-prompt"),
            ] {
                detail = detail.child(section(label, "").child(if builtin {
                    text(Ink::body().hex(0xebebebb8), state.text(field))
                } else {
                    state.field(field)
                }));
            }
            let mut actions = row().gap(ui(8.));
            if builtin {
                actions = actions.child(button("Duplicate").key("duplicate-skill").on_press(
                    |s: &mut Workspace| {
                        let state = &mut s.settings_state;
                        state.skill = Some(String::new());
                        let name = format!("{} copy", state.text("skill-name"));
                        let command = format!("{}-copy", state.text("skill-command"));
                        state.set_text("skill-name", &name);
                        state.set_text("skill-command", &command);
                    },
                ));
            } else {
                actions = actions
                    .child(button("Revert changes").key("revert-skill").on_press(
                        |s: &mut Workspace| {
                            let state = &mut s.settings_state;
                            for (field, _) in FIELDS {
                                let text = state.baselines.get(field).cloned().unwrap_or_default();
                                state.set_text(field, &text);
                            }
                            state.error = None;
                        },
                    ))
                    .child(
                        button(if state.busy {
                            "Saving…"
                        } else {
                            "Save skill"
                        })
                        .key("save-skill")
                        .on_press(|s: &mut Workspace| {
                            let state = &s.settings_state;
                            let mut body = json!({
                                "name": state.text("skill-name"),
                                "command": state.text("skill-command"),
                                "description": state.text("skill-description"),
                                "promptTemplate": state.text("skill-prompt")
                            });
                            let id = state.skill.clone().unwrap_or_default();
                            if let Some(skill) = state
                                .data
                                .get("skills")
                                .and_then(Value::as_array)
                                .into_iter()
                                .flatten()
                                .find(|p| p["_id"] == id.as_str())
                            {
                                body["expectedUpdatedAt"] = skill["updatedAt"].clone();
                            }
                            let (method, path) = if id.is_empty() {
                                (Method::POST, "/api/prompts".to_owned())
                            } else {
                                (Method::PUT, format!("/api/prompts/{}", encoded(&id)))
                            };
                            s.save_settings(method, path, body);
                        }),
                    );
                if state.skill.as_ref().is_some_and(|id| !id.is_empty()) {
                    actions = actions.child(
                        button(if state.delete_skill {
                            "Confirm delete"
                        } else {
                            "Delete"
                        })
                        .key("delete-skill")
                        .on_press(|s: &mut Workspace| {
                            if s.settings_state.delete_skill {
                                let id = s.settings_state.skill.clone().unwrap_or_default();
                                s.save_settings(
                                    Method::DELETE,
                                    format!("/api/prompts/{}", encoded(&id)),
                                    Value::Null,
                                );
                            } else {
                                s.settings_state.delete_skill = true;
                            }
                        }),
                    );
                }
            }
            detail = detail.child(actions);
        }
        row().gap(ui(24.)).child(library).child(detail)
    }

    pub(super) fn select_skill(&mut self, id: Option<String>) {
        if self.settings_state.busy {
            return;
        }
        let state = &mut self.settings_state;
        if state.skill.is_some()
            && FIELDS.iter().any(|(field, _)| {
                state
                    .baselines
                    .get(field)
                    .is_some_and(|baseline| baseline != &state.text(field))
            })
        {
            state.error = Some(
                "Save your skill changes before selecting another skill, or use Revert changes."
                    .into(),
            );
            return;
        }
        let skill = state
            .data
            .get("skills")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|p| p["_id"].as_str() == id.as_deref())
            .cloned()
            .unwrap_or(Value::Null);
        for (field, key) in FIELDS {
            let text = skill[key].as_str().unwrap_or("");
            state.set_text(field, text);
            state.baselines.insert(field, text.into());
        }
        state.skill = id;
        state.delete_skill = false;
        state.error = None;
    }
}
