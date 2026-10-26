use super::*;

impl WorkspaceView {
    pub(super) fn skills_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.settings_state;
        let needle = state.text("skill-search", cx).to_lowercase();
        let selected = state
            .data
            .get("skills")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|p| p["_id"].as_str() == state.skill.as_deref());
        let builtin = selected.is_some_and(|p| p["isBuiltIn"] == true);
        div().flex().gap(px(24.))
            .child(div().id("skill-library").w(px(250.)).flex_shrink_0().max_h(px(560.)).overflow_y_scroll()
                .child(state.field("skill-search"))
                .child(button("new-skill", "New skill").mt(px(12.)).w_full().on_click(cx.listener(|s, _, _, cx| s.select_skill(Some(String::new()), cx))))
                .children(state.data.get("skills").and_then(Value::as_array).into_iter().flatten()
                    .filter(|p| format!("{} {} {}",p["name"],p["command"],p["description"]).to_lowercase().contains(&needle))
                    .map(|skill| {
                        let id = skill["_id"].as_str().unwrap_or("").to_owned();
                        button(SharedString::from(id.clone()), "").aria_label(skill["name"].as_str().unwrap_or("").to_owned()).w_full().h_auto().py(px(8.)).mt(px(4.)).flex_col().items_start().gap(px(2.))
                            .when(state.skill.as_ref() == Some(&id), |d| d.bg(rgba(0xffffff17)))
                            .child(skill["name"].as_str().unwrap_or("").to_owned())
                            .child(div().text_size(px(11.)).text_color(rgba(0xebebeb80)).child(format!("/{}{}",skill["command"].as_str().unwrap_or(""),if skill["isBuiltIn"] == true { " · Built in" } else { "" })))
                            .on_click(cx.listener(move |s, _, _, cx| s.select_skill(Some(id.clone()), cx)))
                    })))
            .child(div().flex_1().min_w_0().when(state.skill.is_none(), |d| d.child("Select a skill to view its instructions."))
                .when(state.skill.is_some(), |d| d
                    .children([("Name","skill-name"),("Command","skill-command"),("Description","skill-description"),("Instructions","skill-prompt")].into_iter().map(|(label,field)| {
                        section(label, "").child(if builtin {
                            div().text_color(rgba(0xebebebb8)).child(state.text(field,cx)).into_any_element()
                        } else { state.field(field).into_any_element() })
                    }))
                    .child(div().flex().gap(px(8.))
                        .when(builtin, |d| d.child(button("duplicate-skill","Duplicate").on_click(cx.listener(|s,_,_,cx| {
                            s.settings_state.skill = Some(String::new());
                            let name = format!("{} copy",s.settings_state.text("skill-name",cx));
                            let command = format!("{}-copy",s.settings_state.text("skill-command",cx));
                            for (field,value) in [("skill-name",name),("skill-command",command)] { s.settings_state.fields[field].update(cx,|input,cx|input.set_content(&value,cx)); }
                            cx.notify();
                        }))))
                        .when(!builtin, |d| d.child(button("revert-skill","Revert changes").on_click(cx.listener(|s,_,_,cx| {
                            for field in ["skill-name","skill-command","skill-description","skill-prompt"] {
                                let text=s.settings_state.baselines.get(field).cloned().unwrap_or_default();
                                s.settings_state.fields[field].update(cx,|input,cx|input.set_content(&text,cx));
                            }
                            s.settings_state.error=None; cx.notify();
                        }))))
                        .when(!builtin, |d| d.child(button("save-skill",if state.busy {"Saving…"} else {"Save skill"}).on_click(cx.listener(|s,_,_,cx| {
                            let state = &s.settings_state;
                            let mut body = json!({"name":state.text("skill-name",cx),"command":state.text("skill-command",cx),"description":state.text("skill-description",cx),"promptTemplate":state.text("skill-prompt",cx)});
                            let id = state.skill.clone().unwrap_or_default();
                            if let Some(skill) = state.data.get("skills").and_then(Value::as_array).into_iter().flatten().find(|p|p["_id"]==id) { body["expectedUpdatedAt"] = skill["updatedAt"].clone(); }
                            s.save_settings(if id.is_empty() {Method::POST} else {Method::PUT},if id.is_empty(){"/api/prompts".into()}else{format!("/api/prompts/{}",url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>())},body,cx);
                        }))))
                        .when(!builtin && state.skill.as_ref().is_some_and(|id|!id.is_empty()), |d| d.child(button("delete-skill",if state.delete_skill {"Confirm delete"} else {"Delete"}).on_click(cx.listener(|s,_,_,cx| {
                            if s.settings_state.delete_skill {
                                let id = s.settings_state.skill.clone().unwrap();
                                s.save_settings(Method::DELETE,format!("/api/prompts/{}",url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>()),Value::Null,cx);
                            } else { s.settings_state.delete_skill = true; cx.notify(); }
                        })))))))
            .into_any_element()
    }
    fn select_skill(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        if self.settings_state.busy {
            return;
        }
        let fields = [
            ("skill-name", "name"),
            ("skill-command", "command"),
            ("skill-description", "description"),
            ("skill-prompt", "promptTemplate"),
        ];
        if self.settings_state.skill.is_some()
            && fields.iter().any(|(field, _)| {
                self.settings_state
                    .baselines
                    .get(field)
                    .is_some_and(|baseline| baseline != &self.settings_state.text(field, cx))
            })
        {
            self.settings_state.error = Some(
                "Save your skill changes before selecting another skill, or use Revert changes."
                    .into(),
            );
            cx.notify();
            return;
        }
        let skill = self
            .settings_state
            .data
            .get("skills")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|p| p["_id"].as_str() == id.as_deref())
            .cloned()
            .unwrap_or(Value::Null);
        for (field, key) in fields {
            let text = skill[key].as_str().unwrap_or("");
            self.settings_state.fields[field].update(cx, |input, cx| input.set_content(text, cx));
            self.settings_state.baselines.insert(field, text.into());
        }
        self.settings_state.skill = id;
        self.settings_state.delete_skill = false;
        self.settings_state.error = None;
        cx.notify();
    }
}
