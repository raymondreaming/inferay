use super::*;

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
                        timezone: "UTC".into(),
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
        state.screen = "edit";
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
        cx.notify();
    }
    pub(super) fn save_automation(&mut self, cx: &mut Context<Self>) {
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
                Err(e) => {
                    self.project_pages.error = Some(format!("Invalid tool input: {e}"));
                    cx.notify();
                    return;
                }
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
        let path = state.original["file"]["sourcePath"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| format!("automations/{}/automation.json", text(&draft, "id")));
        let command = json!({"type":"saveDefinition","projectId":state.project,"path":path,"content":serde_json::to_string_pretty(&draft).unwrap(),"expectedHash":state.original["file"]["sourceHash"]});
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
        let automations = list(&state.data["catalog"], "automations");
        let current = automations
            .iter()
            .find(|a| a["file"]["definition"]["id"].as_str() == state.selected.as_deref())
            .or_else(|| {
                automations
                    .iter()
                    .find(|a| a["file"]["definition"]["archived"] != true)
            });
        div().flex().flex_1().min_h_0().min_w_0()
            .child(div().w(ui(230.)).flex_shrink_0().flex().flex_col().border_r_1().border_color(rgba(0xebebeb14))
                .child(div().p(ui(12.)).flex().gap(ui(6.)).child(div().flex_1().min_w_0().child(state.field("search"))).child(button("new-automation","+").aria_label("New automation").on_click(cx.listener(|s,_,_,cx|{if s.project_pages.screen=="edit" {s.project_pages.error=Some("Save or cancel the current automation first.".into());}else{s.project_pages.screen="starters";}cx.notify();}))))
                .child(div().id("automations-list").debug_selector(||"automations-list".into()).flex_1().min_h_0().overflow_y_scroll()
                    .children(automations.iter().filter(|a|a["file"]["definition"]["archived"]!=true && text(&a["file"]["definition"],"name").to_lowercase().contains(&needle)).map(|a| {
                        let id=text(&a["file"]["definition"],"id");let selected=current.is_some_and(|c|c["file"]["id"]==a["file"]["id"]);let item=a.clone();
                        button(SharedString::from(format!("automation-{id}")),"").w_full().h_auto().p(ui(14.)).flex_col().items_start().gap(ui(6.)).when(selected,|d|d.bg(rgba(0xebebeb10)))
                            .child(label(text(&a["file"]["definition"]["trigger"],"kind")))
                            .child(div().font_weight(FontWeight::MEDIUM).child(text(&a["file"]["definition"],"name")))
                            .child(label(format!("{} · {}",text(&a["file"]["definition"]["execution"],"provider"),if a["enabled"]==true {"Enabled"}else{"Paused"})))
                            .on_click(cx.listener(move |s,_,_,cx|s.edit_automation(Some(item.clone()),None,cx)))
                    })))
                .child(button("automation-history","History").m(ui(12.)).on_click(cx.listener(|s,_,_,cx|{if s.project_pages.screen=="edit"{s.project_pages.error=Some("Save or cancel the current automation first.".into());}else{s.project_pages.screen="history";s.reload_project_page(cx);}cx.notify();}))))
            .child(div().id("automation-content").flex_1().min_w_0().overflow_y_scroll().p(ui(32.)).flex().flex_col().gap(ui(20.))
                .when(state.screen=="history",|d|d.child(self.automation_history(cx)))
                .when(state.screen=="effects",|d|d.child(self.effects_page(cx)))
                .when(state.screen=="edit",|d|d.child(self.automation_editor(cx)))
                .when(state.screen=="starters" || (current.is_none() && state.screen=="detail"),|d|d.child(div().text_size(ui(22.)).font_weight(FontWeight::SEMIBOLD).child("New automation")).child(label("Pick a starting point, or write your own task.")).children(STARTERS.iter().map(|starter| {
                    let name=text(starter,"name");let instructions=text(starter,"instructions");let interval=starter["intervalSeconds"].as_u64();
                    action(SharedString::from(name.clone()),"").h_auto().p(ui(20.)).flex_col().items_start().gap(ui(8.)).child(name.clone()).child(label(text(starter,"description"))).on_click(cx.listener(move |s,_,_,cx|s.edit_automation(None,Some((&name,&instructions,interval)),cx)))
                })))
                .when(state.screen=="detail",|d|d.when_some(current,|d,a| {
                    let item=a.clone();let id=text(&a["file"]["definition"],"id");let run_id=id.clone();let enable_id=id.clone();
                    d.child(div().text_size(ui(22.)).child(text(&a["file"]["definition"],"name")))
                        .child(label(format!("{} · {}",text(&a["file"]["definition"]["trigger"],"kind"),if a["enabled"]==true{"Enabled"}else{"Paused"}))).when(a["inputsChanged"]==true,|d|d.child(label("Inputs changed · Review required"))).when_some(a["executionError"].as_str().or_else(||a["file"]["error"].as_str()),|d,error|d.child(label(error.to_owned())))
                        .child(card().child(text(&a["file"]["definition"]["execution"],"instructions")))
                        .child(div().flex().gap(ui(8.))
                            .child(action("edit-automation","Settings").on_click(cx.listener(move |s,_,_,cx|s.edit_automation(Some(item.clone()),None,cx))))
                            .child(action("run-automation","Run now").on_click(cx.listener(move |s,_,_,cx|s.review_automation(run_id.clone(),true,cx))))
                            .child(action("enable-automation",if a["enabled"]==true{"Pause"}else{"Enable"}).on_click(cx.listener(move |s,_,_,cx|{
                                let enabled=list(&s.project_pages.data["catalog"],"automations").iter().any(|a|a["file"]["definition"]["id"]==enable_id && a["enabled"]==true);
                                if enabled {s.project_request("/api/projects/command".into(),Some(json!({"type":"disableAutomation","id":enable_id})),"mutation",cx);}else{s.review_automation(enable_id.clone(),false,cx);}
                            }))))
                }))
                .when_some(state.review.as_ref(),|d,review| {
                    let run=state.screen=="review-run";let enable=!run || list(&state.data["catalog"],"automations").iter().any(|a|a["file"]["id"].as_str()==state.selected.as_deref() && a["enabled"]==true);let id=state.selected.clone().unwrap_or_default();let hash=review["inputsHash"].clone();
                    d.child(card().child(if run{"Review and run automation"}else{"Review and enable schedule"})
                        .child(label("Agent runs have the same tools and access as regular chats. Approval applies to these captured inputs."))
                        .child(review_details(review))
                        .child(div().flex().gap(ui(8.))
                            .child(action("approve-automation",if run{"Approve & run"}else{"Approve & enable"}).on_click(cx.listener(move |s,_,_,cx|s.project_request("/api/projects/command".into(),Some(json!({"type":"approveAutomation","id":id,"expectedInputsHash":hash,"enable":enable})),if run{"approve-run"}else{"mutation"},cx))))
                            .child(button("cancel-automation-review","Cancel").on_click(cx.listener(|s,_,_,cx|{s.project_pages.review=None;s.project_pages.screen="detail";cx.notify();})))))
                }))
            .into_any_element()
    }

    fn automation_editor(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let draft = &state.draft;
        let agent = draft["execution"]["kind"] == "agent";
        let catalog = inferay_core::provider_config::renderer_catalog(&json!({}), &[]);
        let provider = if draft["execution"]["provider"] == "claude" {
            &catalog.agents.claude
        } else {
            &catalog.agents.codex
        };
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
        div().flex().flex_col().gap(ui(18.)).max_w(ui(1000.))
            .child(label("Name")).child(state.field("name"))
            .child(div().flex().gap(ui(8.)).children([("agent","Agent"),("tool","Local tool")].into_iter().map(|(kind,title)|{
                action(kind,title).when(draft["execution"]["kind"]==kind,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx| {
                    if s.project_pages.draft["execution"]["kind"]==kind{return;}
                    s.project_pages.draft["execution"]=if kind=="tool"{json!({"kind":"tool","tool":"","input":{}})}else{json!({"kind":"agent","provider":"codex","model":s.default_config.model,"reasoningLevel":"low","instructions":"","tools":[],"skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300})};
                    s.project_pages.set("input","{}",cx);cx.notify();
                }))
            })))
            .child(label("Triggers"))
            .child(div().flex().flex_wrap().gap(ui(6.)).children([("manual","Manual only"),("interval","Interval"),("calendar","Schedule")].into_iter().map(|(kind,title)| action(kind,title).when(draft["trigger"]["kind"]==kind,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.draft["trigger"]=match kind{"interval"=>json!({"kind":kind,"seconds":3600}),"calendar"=>json!({"kind":kind,"timezone":"UTC","days":[1,2,3,4,5,6,7],"times":["09:00"]}),_=>json!({"kind":"manual"})};if kind=="calendar" {s.project_pages.set("time","09:00",cx);}cx.notify();})))))
            .when(draft["trigger"]["kind"]=="interval",|d|d.child(label("Every (seconds)")).child(state.field("interval")))
            .when(draft["trigger"]["kind"]=="calendar",|d|d.child(div().flex().gap(ui(5.)).children(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].into_iter().enumerate().map(|(i,name)| {
                let day=i+1;let checked=list(&draft["trigger"],"days").contains(&json!(day));
                button(name,name).when(checked,|d|d.bg(rgba(0x8ab4f830))).on_click(cx.listener(move |s,_,_,cx|{let days=s.project_pages.draft["trigger"]["days"].as_array_mut().unwrap();if days.contains(&json!(day)){days.retain(|v|*v!=json!(day));}else{days.push(json!(day));}cx.notify();}))
            }))).child(label("Times (HH:MM, separated by commas)")).child(state.field("time")).child(label("Timezone")).child(state.field("timezone")))
            .when(agent,|d| d.child(label("Instructions")).child(div().min_h(ui(150.)).child(state.field("instructions")))
                .child(div().flex().gap(ui(8.)).children([("codex","Codex"),("claude","Claude")].into_iter().map(|(kind,title)|action(kind,title).when(draft["execution"]["provider"]==kind,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.draft["execution"]["provider"]=json!(kind);
                    let defaults=inferay_core::provider_config::resolve(&json!({"agentKind":kind}));
                    s.project_pages.set("model",&defaults.model,cx);s.project_pages.set("reasoning",&defaults.reasoning_level,cx);cx.notify();})))))
                .child(label("Model"))
                .child(div().flex().flex_wrap().gap(ui(6.)).children(provider.models.iter().map(|model|{let id=model.id.clone();button(SharedString::from(format!("model-{id}")),model.short_label.clone().unwrap_or_else(||model.label.clone())).when(state.text("model",cx)==id,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.set("model",&id,cx);cx.notify();}))})))
                .child(label("Reasoning level"))
                .child(div().flex().gap(ui(6.)).children(inferay_core::provider_config::reasoning_levels_for(&state.text("model",cx)).iter().map(|level|{let id=level.id.clone();button(SharedString::from(format!("reasoning-{id}")),level.label.clone()).when(state.text("reasoning",cx)==id,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.set("reasoning",&id,cx);cx.notify();}))})))
                .child(label("Context & execution"))
                .children([("resourceChoices","resources","Resources")].into_iter().map(|(choices,key,title)|{
                    div().flex().flex_col().gap(ui(6.)).child(label(title)).children(list(&state.data["catalog"],choices).iter().map(|choice|{
                        let id=choice["qualifiedId"].as_str().or_else(||choice["id"].as_str()).or_else(||choice[0].as_str()).unwrap_or("").to_owned();let name=choice["label"].as_str().or_else(||choice[1].as_str()).unwrap_or(&id).to_owned();let selected=list(&draft["execution"],key).contains(&json!(id));
                        button(SharedString::from(format!("{key}-{id}")),format!("{} {name}",if selected{"✓"}else{"＋"})).on_click(cx.listener(move |s,_,_,cx|{let values=s.project_pages.draft["execution"][key].as_array_mut().unwrap();if values.contains(&json!(id)){values.retain(|v|*v!=json!(id));}else{values.push(json!(id));}cx.notify();}))
                    }))
                }))
                .child(label("Skills"))
                .children(skills.iter().map(|skill| {
                    let id=skill.id.clone(); let selected=list(&draft["execution"],"skills").contains(&json!(id));
                    button(SharedString::from(id.clone()),format!("{} {} · {}",if selected{"✓"}else{"＋"},skill.label,skill.source)).on_click(cx.listener(move |s,_,_,cx|{let values=s.project_pages.draft["execution"]["skills"].as_array_mut().unwrap();if values.contains(&json!(id)){values.retain(|v|*v!=json!(id));}else{values.push(json!(id));}cx.notify();}))
                }))
                .child(label("Library tools — Available or Must pass"))
                .children(list(&state.data["catalog"],"toolChoices").iter().map(|choice| {
                    let plugin=choice["pluginId"].clone();let tool=choice["toolId"].clone();
                    div().flex().flex_wrap().gap(ui(6.)).child(text(choice,"label")).children([("none","Not available"),("optional","Available"),("required","Must pass")].into_iter().map(|(mode,title)|{
                        let plugin=plugin.clone();let tool=tool.clone();let grant=list(&draft["execution"],"tools").iter().find(|g|g["pluginId"]==plugin && g["toolId"]==tool);let active=match mode{"none"=>grant.is_none(),"required"=>grant.is_some_and(|g|g["required"]==true),_=>grant.is_some_and(|g|g["required"]!=true)};
                        button(SharedString::from(format!("{plugin}-{tool}-{mode}")),title).when(active,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{let grants=s.project_pages.draft["execution"]["tools"].as_array_mut().unwrap();grants.retain(|g|g["pluginId"]!=plugin || g["toolId"]!=tool);if mode!="none"{grants.push(json!({"pluginId":plugin,"toolId":tool,"required":mode=="required"}));}cx.notify();}))
                    }))
                }))
                .child(label("Working directory"))
                .child(button("project-working-directory","Project-wide").on_click(cx.listener(|s,_,_,cx|{s.project_pages.draft["execution"]["workingDirectory"]=json!({"base":"project","path":"."});cx.notify();})))
                .children(list(&state.data["catalog"],"projects").iter().filter(|p|p["id"]==state.project).flat_map(|p|list(&p["definition"],"repositories")).map(|repo|{
                    let id=text(repo,"id");let selected=draft["execution"]["workingDirectory"]["id"]==id;
                    button(SharedString::from(format!("cwd-{id}")),format!("{} {}",if selected{"✓"}else{""},text(repo,"name"))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.draft["execution"]["workingDirectory"]=json!({"base":"repository","id":id,"path":"."});let repos=s.project_pages.draft["execution"]["repositories"].as_array_mut().unwrap();if !repos.contains(&json!(id)){repos.push(json!(id));}cx.notify();}))
                }))
                .child(label("Timeout (seconds)")).child(state.field("timeout")))
            .when(!agent,|d|d.child(label("Tool")).children(list(&state.data["catalog"],"tools").iter().filter(|tool|tool["error"].is_null() && text(tool,"sourcePath").split('/').take(2).collect::<Vec<_>>().join("/")==state.original["file"]["sourcePath"].as_str().unwrap_or("").split('/').take(2).collect::<Vec<_>>().join("/")).map(|tool|{
                let id=text(tool,"id");button(SharedString::from(format!("tool-{id}")),text(&tool["definition"],"name")).when(draft["execution"]["tool"]==id,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.draft["execution"]["tool"]=json!(id);cx.notify();}))
            })).child(state.field("input")))
            .child(label("Permissions for local tools"))
            .child(div().flex().flex_wrap().gap(ui(6.)).children(["read_repositories","write_repositories","commit","push","open_pr","network","gpu","write_project_files"].into_iter().map(|permission| {
                let selected=list(draft,"may").contains(&json!(permission));button(permission,format!("{} {}",if selected{"✓"}else{"＋"},permission.replace('_'," "))).on_click(cx.listener(move |s,_,_,cx|{let permissions=s.project_pages.draft["may"].as_array_mut().unwrap();if permissions.contains(&json!(permission)){permissions.retain(|v|*v!=json!(permission));}else{permissions.push(json!(permission));}cx.notify();}))
            })))
            .child(label("If a run overlaps"))
            .child(div().flex().gap(ui(6.)).children(["skip","queue_one"].into_iter().map(|policy|button(policy,policy).when(draft["overlap"]==policy,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.draft["overlap"]=json!(policy);cx.notify();})))))
            .child(div().flex().gap(ui(8.))
                .child(action("save-automation","Save automation").debug_selector(||"save-automation".into()).on_click(cx.listener(|s,_,_,cx|s.save_automation(cx))))
                .child(button("cancel-automation-edit","Cancel").on_click(cx.listener(|s,_,_,cx|{s.project_pages.screen="detail";cx.notify();})))
                .when(!state.original.is_null(),|d|d.child(button("archive-automation","Delete automation").text_color(rgb(0xf0a0a0)).on_click(cx.listener(|s,_,_,cx|{
                    let a=&s.project_pages.original;let mut definition=a["file"]["definition"].clone();definition["archived"]=json!(true);
                    s.project_pages.confirmation=Some(("Archive this automation? Future schedules stop; history is kept.".into(),json!({"type":"saveDefinition","projectId":s.project_pages.project,"path":a["file"]["sourcePath"],"content":definition.to_string(),"expectedHash":a["file"]["sourceHash"]})));cx.notify();
                })))))
            .into_any_element()
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
