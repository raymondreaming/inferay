//! Native project workspaces share the existing file catalog and reviewed actions.
use super::*;
use reqwest::Method;
use serde_json::{Value, json};
mod automations;
mod memory;
mod plugins;

pub(super) struct State {
    pub page: Option<&'static str>,
    pub project: String,
    pub data: Value,
    pub graph: Value,
    pub positions: std::collections::HashMap<String, (f32, f32)>,
    pub selected: Option<String>,
    pub screen: &'static str,
    pub detail: Value,
    pub library: Value,
    pub connection: Value,
    pub automation_baseline: Value,
    pub automation_submitted: Value,
    pub automation_configure: bool,
    pub automation_menu: Option<(&'static str, Bounds<Pixels>)>,
    pub automation_save: Option<Task<()>>,
    pub viewport_width: f32,
    pub draft: Value,
    pub original: Value,
    pub review: Option<Value>,
    pub confirmation: Option<(String, Value)>,
    pub error: Option<String>,
    pub notice: Option<String>,
    pub fields: std::collections::HashMap<&'static str, Entity<TextInput>>,
    pub _observers: Vec<Subscription>,
    pub task: Option<Task<()>>,
    pub mutating: bool,
    pub poll: Option<Task<()>>,
    pub query_task: Option<Task<()>>,
    pub matches: Option<HashSet<String>>,
    pub category: &'static str,
    pub pan: Point<Pixels>,
    pub zoom: f32,
    pub drag: Option<(Point<Pixels>, Point<Pixels>)>,
    pub graph_bounds: std::rc::Rc<std::cell::Cell<Bounds<Pixels>>>,
}
impl State {
    pub fn new(cx: &mut Context<WorkspaceView>) -> Self {
        let mut fields = std::collections::HashMap::new();
        let mut observers = vec![];
        for (key, placeholder) in [
            ("search", "Search"),
            ("name", "Untitled"),
            (
                "instructions",
                "Tell the agent what to do when this automation runs…",
            ),
            ("model", "Model"),
            ("reasoning", "Reasoning level"),
            ("interval", "Interval in seconds"),
            ("time", "09:00"),
            ("timezone", "Timezone"),
            ("timeout", "Timeout in seconds"),
            ("input", "Tool input (JSON)"),
            ("title", "Title"),
            ("body", "Note"),
            ("tags", "Tags, separated by commas"),
            ("file", "File contents"),
            ("connection-name", "Connection name"),
            ("connection-secret", "Secret"),
            ("connection-alias", "API_KEY"),
            ("connection-id", "Choose a connection"),
            ("connection-url", "https://api.example.com/"),
            ("connection-header", "Authorization"),
            ("connection-prefix", "Bearer "),
        ] {
            let input = cx.new(|cx| {
                let mut input = TextInput::field(placeholder, cx);
                input.secret = key == "connection-secret";
                input.typography = (12., 20.4);
                if key == "name" {
                    input.typography = (24., 32.);
                    input.submit_on_enter = true;
                    input.height_limits = (32., 32.);
                }
                if key == "instructions" {
                    input.height_limits = (148., 148.);
                }

                input
            });
            observers.push(cx.observe(&input, move |s, _, cx| {
                if key == "search" && s.project_pages.page == Some("Memory") {
                    s.search_project_memory(cx);
                }
                if s.project_pages.page == Some("Automations") && !["search", "file"].contains(&key)
                {
                    s.queue_automation_save(cx);
                }
                cx.notify();
            }));
            fields.insert(key, input);
        }
        Self {
            page: None,
            project: String::new(),
            data: Value::Null,
            graph: Value::Null,
            positions: Default::default(),
            selected: None,
            screen: "detail",
            detail: Value::Null,
            library: Value::Null,
            connection: Value::Null,
            automation_baseline: Value::Null,
            automation_submitted: Value::Null,
            automation_configure: false,
            automation_menu: None,
            automation_save: None,
            viewport_width: 1400.,
            draft: Value::Null,
            original: Value::Null,
            review: None,
            confirmation: None,
            error: None,
            notice: None,
            fields,
            _observers: observers,
            task: None,
            mutating: false,
            poll: None,
            query_task: None,
            matches: None,
            category: "all",
            pan: point(px(0.), px(0.)),
            zoom: 1.,
            drag: None,
            graph_bounds: Default::default(),
        }
    }
    fn text(&self, key: &str, cx: &App) -> String {
        self.fields[key].read(cx).content.to_string()
    }
    fn set(&self, key: &str, value: &str, cx: &mut Context<WorkspaceView>) {
        self.fields[key].update(cx, |input, cx| input.set_content(value, cx));
    }
    fn field(&self, key: &'static str) -> impl IntoElement {
        div()
            .w_full()
            .min_h(ui(34.))
            .p(ui(8.))
            .rounded(ui(8.))
            .bg(rgba(0xffffff06))
            .border_1()
            .border_color(rgba(0xebebeb1a))
            .child(self.fields[key].clone())
    }
}
fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or("").to_owned()
}
fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn query(path: &str, values: &[(&str, &str)]) -> String {
    format!(
        "{path}?{}",
        url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(values.iter().copied())
            .finish()
    )
}
fn label(title: impl Into<SharedString>) -> Div {
    div()
        .text_size(ui(12.))
        .text_color(rgba(0xebebeb99))
        .child(title.into())
}
fn card() -> Div {
    div()
        .flex()
        .flex_col()
        .gap(ui(12.))
        .p(ui(18.))
        .rounded(ui(12.))
        .bg(rgb(0x202020))
        .border_1()
        .border_color(rgba(0xebebeb16))
}
fn action(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Stateful<Div> {
    button(id, title)
        .h(ui(32.))
        .border_1()
        .border_color(rgba(0xebebeb20))
        .bg(rgba(0xebebeb08))
}

fn review_details(review: &Value) -> Div {
    let definition = &review["inputs"]["automation"];
    let permissions = review
        .get("permissions")
        .or_else(|| definition.get("may"))
        .and_then(Value::as_array);
    div()
        .flex()
        .flex_col()
        .gap(ui(10.))
        .when_some(definition["name"].as_str(), |d, name| {
            d.child(label(name.to_owned()))
        })
        .child(label("Requested permissions"))
        .child(
            permissions
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|v| v.replace('_', " "))
                        .collect::<Vec<_>>()
                        .join(" · ")
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "No additional local-tool permissions".into()),
        )
        .when(!list(review, "gitWritePaths").is_empty(), |d| {
            d.child(label("Git write access")).children(
                list(review, "gitWritePaths")
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|path| label(path.to_owned())),
            )
        })
        .children(list(review, "connections").iter().map(|access| {
            card()
                .child(text(&access["connection"], "name"))
                .child(label(format!(
                    "{} · {}",
                    text(access, "toolName"),
                    text(access, "alias")
                )))
                .child(text(&access["request"], "baseUrl"))
                .child(label(format!(
                    "{}: {}[key]",
                    text(&access["request"], "header"),
                    text(&access["request"], "prefix")
                )))
        }))
        .when(!list(review, "files").is_empty(), |d| {
            d.child(label("Library files included in this approval"))
                .children(list(review, "files").iter().map(|file| {
                    label(format!(
                        "{} · {}",
                        text(file, "path"),
                        if file["hash"] == file["previousHash"] {
                            "Unchanged"
                        } else {
                            "Changed"
                        }
                    ))
                }))
        })
        .when(!list(review, "automations").is_empty(), |d| {
            d.child(label("Schedules")).children(
                list(review, "automations")
                    .iter()
                    .map(|automation| label(text(automation, "name"))),
            )
        })
}

impl WorkspaceView {
    pub(super) fn open_project_page(&mut self, page: &'static str, cx: &mut Context<Self>) {
        if self.project_pages.mutating {
            return;
        }
        if self.project_pages.screen == "edit"
            || (self.project_pages.screen == "library"
                && self.project_pages.detail["content"].is_string()
                && self.project_pages.text("file", cx)
                    != text(&self.project_pages.detail, "content"))
        {
            self.project_pages.page = Some(if self.project_pages.screen == "edit" {
                "Automations"
            } else {
                "Plugins"
            });
            self.project_pages.error =
                Some("Save or cancel your current edits before opening another page.".into());
            cx.notify();
            return;
        }
        if self.project_pages.page == Some("Automations") && !self.automation_can_leave(cx) {
            return;
        }
        let project = self.projects[self.project].id.clone().unwrap_or_default();
        if self.project_pages.project != project {
            self.project_pages = State::new(cx);
            self.project_pages.project = project;
        }
        self.project_pages.fields["search"].update(cx, |input, _| {
            input.placeholder = if page == "Automations" {
                "Search Automations"
            } else {
                "Search"
            }
            .into()
        });
        self.project_pages.page = Some(page);
        if page == "Automations" {
            self.project_pages.draft = Value::Null;
        }
        self.settings = false;
        self.project_pages.screen = "detail";
        self.project_pages.selected = None;
        self.project_pages.review = None;
        self.project_pages.confirmation = None;
        self.reload_project_page(cx);
        cx.notify();
    }
    fn reload_project_page(&mut self, cx: &mut Context<Self>) {
        let path = query(
            "/api/projects",
            &[("projectId", &self.project_pages.project)],
        );
        self.project_request(path, None, "catalog", cx);
    }
    fn project_request(
        &mut self,
        path: String,
        body: Option<Value>,
        target: &'static str,
        cx: &mut Context<Self>,
    ) {
        if self.project_pages.mutating {
            return;
        }
        self.project_pages.task = None;
        self.project_pages.mutating = body.is_some();
        self.project_pages.poll = None;
        self.project_pages.error = None;
        let project = self.project_pages.project.clone();
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let work = cx.background_executor().spawn(async move {
            crate::backend::RUNTIME.block_on(async move {
                let backend = backend
                    .get_or_try_init(|| crate::backend::Backend::connect(profile))
                    .await?;
                let mut value = backend
                    .request(
                        if body.is_some() {
                            Method::POST
                        } else {
                            Method::GET
                        },
                        &path,
                        body,
                    )
                    .await?;
                if target == "catalog" {
                    value["globalSkills"] =
                        backend.request(Method::GET, "/api/prompts", None).await?;
                }
                Ok::<Value, anyhow::Error>(value)
            })
        });
        self.project_pages.task=Some(cx.spawn(async move |this,cx| {
            let result=work.await;
            let _=this.update(cx,|s,cx| {
                if s.project_pages.project!=project {return;}
                s.project_pages.task=None;
                s.project_pages.mutating=false;
                match result {
                    Err(error)=>s.project_pages.error=Some(error.to_string()),
                    Ok(value)=>match target {
                        "catalog"=>{s.project_pages.data=value;
                            if s.project_pages.page==Some("Automations") && s.project_pages.screen=="detail" {
                                let current=list(&s.project_pages.data["catalog"],"automations").iter().find(|a|a["file"]["id"].as_str()==s.project_pages.selected.as_deref() && a["file"]["definition"]["archived"]!=true).or_else(||list(&s.project_pages.data["catalog"],"automations").iter().find(|a|a["file"]["definition"]["archived"]!=true)).cloned();
                                if let Some(current)=current {if s.project_pages.draft["id"]!=current["file"]["id"] {s.edit_automation(Some(current),None,cx);} else {s.project_pages.original["enabled"]=current["enabled"].clone();s.queue_automation_save(cx);}} else {s.project_pages.draft=Value::Null;s.project_pages.original=Value::Null;s.project_pages.selected=None;}
                            }
                            if s.project_pages.page==Some("Memory") {s.load_memory(cx);} else {s.poll_project_page(cx);}},
                        "detail"=>s.project_pages.detail=value,
                        "library"=>{s.project_pages.library=value;s.project_pages.detail=Value::Null;},
                        "library-file"=>{s.project_pages.set("file",value["content"].as_str().unwrap_or(""),cx);s.project_pages.detail=value;},
                        "save-note"=>{s.project_pages.screen="detail";s.reload_project_page(cx);},
                        "save-automation"=>{
                            let definition=s.project_pages.automation_submitted.take();
                            s.project_pages.automation_baseline=definition.clone();
                            s.project_pages.original["file"]=json!({"id":definition["id"],"definition":definition,"sourcePath":value["sourcePath"],"sourceHash":value["sourceHash"]});
                            s.project_pages.screen="detail";s.project_pages.notice=None;s.reload_project_page(cx);
                        },
                        "save-library-file"=>{s.project_pages.detail=Value::Null;s.project_pages.notice=Some("File saved. Review changed inputs before enabling schedules.".into());s.reload_project_page(cx);},
                        "connection-saved"=>{s.project_pages.connection=Value::Null;s.project_pages.set("connection-secret","",cx);s.project_pages.confirmation=None;s.project_request(query("/api/projects/connections",&[("projectId",&s.project_pages.project)]),None,"connections",cx);},
                        "tool-bindings-saved"=>{s.project_pages.original=Value::Null;s.project_pages.draft=Value::Null;s.reload_project_page(cx);},
                        "review"=>s.project_pages.review=Some(value),
                        "history"=>{
                            let mut value=value;
                            for key in ["runs","artifacts","effects"] {let mut items=list(&s.project_pages.data["history"],key).to_vec();for item in list(&value,key){if !items.iter().any(|old|old["id"]==item["id"]){items.push(item.clone());}}value[key]=json!(items);}
                            s.project_pages.data["history"]=value;
                        },
                        "connections"=>{s.project_pages.detail=value;s.project_pages.screen="connections";},
                        "effects"=>{s.project_pages.detail=value;s.project_pages.screen="effects";},
                        "effect-updated"=>{s.project_request(query("/api/projects/effects",&[("projectId",&s.project_pages.project)]),None,"effects",cx);},
                        "run-chat"=>{s.project_pages.page=None;s.restore_run_chat(text(&value,"paneId"),cx);},
                        "approve-run"=>{
                            s.project_pages.review=None;
                            let id=s.project_pages.selected.clone().unwrap_or_default();
                            s.project_request("/api/projects/command".into(),Some(json!({"type":"runAutomation","id":id,"requestId":uuid::Uuid::new_v4().to_string()})),"mutation",cx);
                        },
                        _=>{if s.project_pages.screen.starts_with("review-") || s.project_pages.confirmation.is_some(){s.project_pages.screen="detail";}s.project_pages.review=None;s.project_pages.confirmation=None;s.project_pages.notice=Some("Saved".into());s.reload_project_page(cx);}
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn poll_project_page(&mut self, cx: &mut Context<Self>) {
        self.project_pages.poll = Some(cx.spawn(async |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_secs(5))
                .await;
            let _ = this.update(cx, |s, cx| {
                if s.project_pages.page.is_some()
                    && s.project_pages.screen == "detail"
                    && s.project_pages.review.is_none()
                    && s.project_pages.confirmation.is_none()
                    && s.project_pages.task.is_none()
                {
                    s.reload_project_page(cx);
                }
            });
        }));
    }
    fn restore_run_chat(&mut self, pane: String, cx: &mut Context<Self>) {
        if let Some(index) = self
            .conversations
            .iter()
            .position(|chat| chat.pane.as_deref() == Some(&pane))
        {
            self.conversations[index].closed = false;
            self.selected = index;
            self.projects[self.project].selected = index;
            self.load_chat(index, 200, cx);
        } else {
            let profile = self.profile.clone();
            cx.spawn(async move |this, cx| {
                let loaded = cx
                    .background_executor()
                    .spawn(async move { crate::session::load(&profile) })
                    .await;
                let _ = this.update(cx, |s, cx| {
                    match loaded {
                        Ok(session) => {
                            for saved in session.projects {
                                let Some(project) = s.projects.iter().position(|p| p.id == saved.id) else {continue;};
                                if let Some(saved_pane) = saved.panes.into_iter().find(|p| p.id == pane) {
                                    let config = session.chat_settings.get(&pane).cloned().unwrap_or_else(|| inferay_core::provider_config::resolve(&json!({"agentKind":saved_pane.agent_kind,"defaults":s.default_config})));
                                    let input=cx.new(TextInput::new);
                                    if let Some(draft)=session.drafts.get(&pane) {input.update(cx,|input,cx|input.set_content(draft,cx));}
                                    let mut chat=Conversation::new(project,input,config);
                                    chat.pane=Some(pane.clone());
                                    chat.title=saved_pane.summary.unwrap_or_else(||"Automation run".into());
                                    let index=s.conversations.len();
                                    s.conversations.push(chat);
                                    s.project=project;
                                    s.selected=index;
                                    s.projects[project].selected=index;
                                    s.repository=false;
                                    s.load_chat(index,200,cx);
                                    break;
                                }
                            }
                        }
                        Err(e) => s.status = e.to_string(),
                    };
                    cx.notify();
                });
            })
            .detach();
        }
    }
    pub(super) fn project_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        div()
            .id("project-page")
            .debug_selector(|| "project-page".into())
            .size_full()
            .flex()
            .flex_col()
            .min_w_0()
            .min_h_0()
            .when(state.page != Some("Automations"), |d| {
                d.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(ui(10.))
                        .h(ui(48.))
                        .px(ui(18.))
                        .border_b_1()
                        .border_color(rgba(0xebebeb14))
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(state.page.unwrap_or("Project")),
                        )
                        .child(label(self.projects[self.project].name.clone()))
                        .child(div().flex_1())
                        .child(
                            button("refresh-project-page", "Refresh")
                                .on_click(cx.listener(|s, _, _, cx| s.reload_project_page(cx))),
                        )
                        .child(button("close-project-page", "Back to chats").on_click(
                            cx.listener(|s, _, _, cx| {
                                s.project_pages.page = None;
                                s.project_pages.poll = None;
                                cx.notify();
                            }),
                        )),
                )
            })
            .when_some(state.error.clone(), |d, error| {
                d.child(
                    div()
                        .px(ui(18.))
                        .py(ui(8.))
                        .text_color(rgb(0xf0a0a0))
                        .child(error)
                        .when(
                            state.page == Some("Automations") && !state.original.is_null(),
                            |d| {
                                d.child(
                                    div()
                                        .flex()
                                        .gap(ui(8.))
                                        .child(
                                            button("retry-automation-save", "Retry save").on_click(
                                                cx.listener(|s, _, _, cx| s.save_automation(cx)),
                                            ),
                                        )
                                        .child(
                                            button(
                                                "discard-automation-changes",
                                                "Reload saved version",
                                            )
                                            .on_click(
                                                cx.listener(|s, _, _, cx| {
                                                    s.project_pages.draft = Value::Null;
                                                    s.project_pages.automation_save = None;
                                                    s.reload_project_page(cx);
                                                }),
                                            ),
                                        ),
                                )
                            },
                        ),
                )
            })
            .when_some(state.notice.clone(), |d, notice| {
                d.child(label(notice).px(ui(18.)).py(ui(8.)))
            })
            .when(
                state.task.is_some() && state.page != Some("Automations"),
                |d| d.child(label("Loading…").px(ui(18.))),
            )
            .when(state.project.is_empty(), |d| {
                d.child(
                    card()
                        .m(ui(24.))
                        .child("Choose a project to use this workspace."),
                )
            })
            .when(!state.project.is_empty(), |d| {
                d.child(match state.page {
                    Some("Automations") => self.automations_page(cx),
                    Some("Plugins") => self.plugins_page(cx),
                    _ => self.memory_page(cx),
                })
            })
            .when(state.page == Some("Automations"), |d| {
                d.child(self.automation_popup(cx))
            })
            .when_some(state.confirmation.as_ref(), |d, (title, command)| {
                let command = command.clone();
                d.child(
                    card()
                        .m(ui(16.))
                        .child(title.clone())
                        .child(label("This change requires your confirmation."))
                        .child(
                            div()
                                .flex()
                                .gap(ui(8.))
                                .child(action("confirm-project-change", "Confirm").on_click(
                                    cx.listener(move |s, _, _, cx| {
                                        let path = command["endpoint"]
                                            .as_str()
                                            .unwrap_or("/api/projects/command")
                                            .to_owned();
                                        let body =
                                            command.get("body").cloned().unwrap_or(command.clone());
                                        let target = if path == "/api/projects/connections" {
                                            "connection-saved"
                                        } else {
                                            "mutation"
                                        };
                                        s.project_request(path, Some(body), target, cx);
                                    }),
                                ))
                                .child(button("cancel-project-change", "Cancel").on_click(
                                    cx.listener(|s, _, _, cx| {
                                        s.project_pages.confirmation = None;
                                        cx.notify();
                                    }),
                                )),
                        ),
                )
            })
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn project_pages_save_review_and_preserve_conflicting_drafts(cx: &mut gpui::TestAppContext) {
        let profile = tempfile::tempdir().unwrap();
        let backend = crate::backend::RUNTIME
            .block_on(crate::backend::Backend::connect(profile.path().into()))
            .unwrap();
        let project = uuid::Uuid::new_v4().to_string();
        crate::backend::RUNTIME.block_on(backend.request(Method::POST,"/api/projects/command",Some(json!({"type":"saveProject","definition":{"schema":"inferay.project/1","id":project,"name":"Page test","description":"","instructions":"","repositories":[]},"expectedHash":null})))).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = WorkspaceView::empty(cx.focus_handle(), cx.new(TextInput::new), cx);
            view.profile = profile.path().into();
            view.backend =
                std::sync::Arc::new(tokio::sync::OnceCell::new_with(Some(backend.clone())));
            view.projects[0].id = Some(project.clone());
            view.open_project_page("Automations", cx);
            view
        });
        cx.run_until_parked();
        view.update(cx, |s, cx| {
            assert!(
                s.project_pages.error.is_none(),
                "{:?}",
                s.project_pages.error
            );
            s.edit_automation(None, Some(("Review", "Inspect project changes.", None)), cx);
            s.save_automation(cx);
        });
        cx.run_until_parked();
        let saved = view.read_with(cx, |s, _| {
            assert!(
                s.project_pages.error.is_none(),
                "{:?}",
                s.project_pages.error
            );
            let saved = list(&s.project_pages.data["catalog"], "automations")
                .first()
                .unwrap()
                .clone();
            assert_eq!(saved["enabled"], false);
            assert!(list(&s.project_pages.data["history"], "runs").is_empty());
            saved
        });
        view.update(cx, |s, cx| {
            s.review_automation(text(&saved["file"], "id"), false, cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |s, _| {
            assert!(
                s.project_pages.error.is_none(),
                "{:?}",
                s.project_pages.error
            );
            assert!(s.project_pages.review.as_ref().unwrap()["inputsHash"].is_string());
        });
        cx.simulate_resize(size(px(1200.), px(850.)));
        cx.draw(point(px(0.), px(0.)), size(px(1200.), px(850.)), |_, _| {
            view.clone().into_any_element()
        });
        view.update(cx, |s, _| {
            s.project_pages.review = None;
            s.project_pages.screen = "detail";
        });
        // An external edit must not be overwritten by a stale native form.
        view.update(cx, |s, cx| s.edit_automation(Some(saved.clone()), None, cx));
        let mut changed = saved["file"]["definition"].clone();
        changed["name"] = json!("External edit");
        crate::backend::RUNTIME.block_on(backend.request(Method::POST,"/api/projects/command",Some(json!({"type":"saveDefinition","projectId":project,"path":saved["file"]["sourcePath"],"content":changed.to_string(),"expectedHash":saved["file"]["sourceHash"]})))).unwrap();
        view.update(cx, |s, cx| {
            s.project_pages.set("name", "My retained draft", cx);
            s.save_automation(cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |s, cx| {
            assert!(s.project_pages.error.is_some());
            assert_eq!(s.project_pages.screen, "detail");
            assert_eq!(s.project_pages.text("name", cx), "My retained draft");
        });
        view.update(cx, |s, cx| {
            s.open_project_page("Memory", cx);
            assert_eq!(s.project_pages.page, Some("Automations"));
            assert_eq!(s.project_pages.text("name", cx), "My retained draft");
            // Explicitly discard the conflicting draft before changing pages.
            s.project_pages.original = Value::Null;
            s.project_pages.error = None;
            s.project_pages.mutating = false;
            s.open_project_page("Memory", cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |s, _| {
            assert!(
                s.project_pages.error.is_none(),
                "{:?}",
                s.project_pages.error
            )
        });
        cx.simulate_resize(size(px(1200.), px(850.)));
        cx.draw(point(px(0.), px(0.)), size(px(1200.), px(850.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("memory-graph").is_some());
        view.update(cx, |s, cx| s.open_project_page("Plugins", cx));
        cx.run_until_parked();
        cx.draw(point(px(0.), px(0.)), size(px(1200.), px(850.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("plugins-page").is_some());
    }
}
