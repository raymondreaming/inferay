use super::*;
use crate::colors::{self, rgb, rgba};
use crate::ui::{Ink, SEMIBOLD, border};
use crate::zoom::ui;
use reqwest::Method;
use rune::{Cursor, El, col, el, row};
use serde_json::{Value, json};
mod automation_editor;
mod automation_history;
mod automations;
mod memory;
mod plugins;
#[cfg(test)]
mod tests;

const FIELDS: &[(&str, &str)] = &[
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
];

pub(crate) struct State {
    pub(crate) page: Option<&'static str>,
    pub(crate) project: String,
    pub(crate) data: Value,
    pub(crate) graph: Value,
    pub(crate) positions: HashMap<String, (f32, f32)>,
    pub(crate) selected: Option<String>,
    pub(crate) screen: &'static str,
    pub(crate) detail: Value,
    pub(crate) library: Value,
    pub(crate) connection: Value,
    pub(crate) automation_baseline: Value,
    pub(crate) automation_submitted: Value,
    pub(crate) automation_configure: bool,
    pub(crate) automation_menu: Option<&'static str>,
    pub(crate) automation_save: Option<Task>,
    pub(crate) viewport_width: f32,
    pub(crate) draft: Value,
    pub(crate) original: Value,
    pub(crate) review: Option<Value>,
    pub(crate) confirmation: Option<(String, Value)>,
    pub(crate) error: Option<String>,
    pub(crate) notice: Option<String>,
    pub(crate) fields: HashMap<&'static str, TextInput>,
    pub(crate) task: Option<Task>,
    pub(crate) mutating: bool,
    pub(crate) poll: Option<Task>,
    pub(crate) query_task: Option<Task>,
    pub(crate) matches: Option<HashSet<String>>,
    pub(crate) category: &'static str,
    pub(crate) pan: (f32, f32),
    pub(crate) zoom: f32,
    pub(crate) drag: Option<(f32, f32)>,
    pub(crate) graph_bounds: (f32, f32),
    pub(crate) image: Option<(std::path::PathBuf, rune::Pixels)>,
    pub(crate) image_task: Option<Task>,
    pub(crate) restore_task: Option<Task>,
}

impl State {
    pub(crate) fn new() -> Self {
        let mut fields = HashMap::new();
        for &(key, placeholder) in FIELDS {
            let mut input = TextInput::field(placeholder);
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
            task: None,
            mutating: false,
            poll: None,
            query_task: None,
            matches: None,
            category: "all",
            pan: (0., 0.),
            zoom: 1.,
            drag: None,
            graph_bounds: (0., 0.),
            image: None,
            image_task: None,
            restore_task: None,
        }
    }
    pub(crate) fn text(&self, key: &str) -> String {
        self.fields[key].content().to_owned()
    }
    pub(crate) fn set(&mut self, key: &str, value: &str) {
        if let Some(input) = self.fields.get_mut(key) {
            input.set_content(value);
        }
    }
    fn input(&self, key: &'static str) -> El {
        let input = &self.fields[key];
        let access = field_access(key);
        let mut field = crate::input::field(input, format!("project-{key}-input"), access.clone())
            .on_input_change(move |s: &mut Workspace, _| s.project_field_changed(key));
        field = if input.submit_on_enter {
            field.on_submit(|_: &mut Workspace, _| {})
        } else {
            crate::input::newline_on_enter(field, access)
        };
        if key == "name" {
            field = field.font(input.ink().weight(SEMIBOLD).style());
        }
        crate::input::frame(input, field)
    }
    fn field(&self, key: &'static str) -> El {
        border(
            col()
                .w_full()
                .min_h(ui(34.))
                .padding(ui(8.))
                .radius(ui(8.))
                .fill(rgba(0xffffff06)),
            0xebebeb1a,
        )
        .child(self.input(key))
    }
}

fn field_access(
    key: &'static str,
) -> impl for<'a> Fn(&'a mut Workspace) -> &'a mut TextInput + Clone {
    move |s| {
        s.project_pages
            .fields
            .get_mut(key)
            .expect("project page field")
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
fn label_ink() -> Ink {
    Ink::new(12.).hex(0xebebeb99)
}
fn label(title: impl Into<String>) -> El {
    label_ink().text(title)
}
fn body(content: impl Into<String>) -> El {
    Ink::body().text(content)
}
fn card() -> El {
    border(
        col()
            .gap(ui(12.))
            .padding(ui(18.))
            .radius(ui(12.))
            .fill(rgb(colors::RAISED)),
        0xebebeb16,
    )
}
fn side_border(el: El, sides: [f32; 4], hex: u32) -> El {
    el.border_sides(sides, rgba(hex)).border_layout()
}
fn pressable(key: impl Into<String>, title: &str) -> El {
    press_on(row(), key, title)
}
fn press_on(base: El, key: impl Into<String>, title: &str) -> El {
    base.key(key.into())
        .role("button")
        .label(title.to_owned())
        .focusable(true)
        .no_focus_ring()
        .radius(ui(6.))
        .cursor(Cursor::Pointer)
}
fn styled_button(
    key: impl Into<String>,
    title: &str,
    ink: Ink,
    rest: Option<u32>,
    radius: f32,
) -> El {
    let key = key.into();
    let mut button = pressable(key.clone(), title)
        .items_center()
        .gap(ui(6.))
        .px(ui(9.))
        .h(ui(28.))
        .radius(radius);
    button = match rest {
        Some(fill) => crate::ui::swap_fill(button, &key, Some(rgba(fill)), rgba(0xffffff0d)),
        None => button.hover(rgba(0xffffff0d)),
    };
    if !title.is_empty() {
        button = button.child(ink.line_text(title.to_owned()));
    }
    button
}
fn button(key: impl Into<String>, title: &str) -> El {
    styled_button(key, title, Ink::small(), None, ui(6.))
}
fn button_ink(key: impl Into<String>, title: &str, ink: Ink) -> El {
    styled_button(key, title, ink, None, ui(6.))
}
fn filled_button(key: impl Into<String>, title: &str, ink: Ink, fill: u32) -> El {
    styled_button(key, title, ink, Some(fill), ui(6.))
}
fn action(key: impl Into<String>, title: &str) -> El {
    action_fill(key, title, 0xebebeb08)
}
fn action_fill(key: impl Into<String>, title: &str, fill: u32) -> El {
    border(
        filled_button(key, title, Ink::small(), fill).h(ui(32.)),
        0xebebeb20,
    )
}

fn review_details(review: &Value) -> El {
    let definition = &review["inputs"]["automation"];
    let permissions = review
        .get("permissions")
        .or_else(|| definition.get("may"))
        .and_then(Value::as_array);
    let mut details = col().gap(ui(10.));
    if let Some(name) = definition["name"].as_str() {
        details = details.child(label(name));
    }
    details = details.child(label("Requested permissions")).child(body(
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
    ));
    if !list(review, "gitWritePaths").is_empty() {
        details = details.child(label("Git write access")).children(
            list(review, "gitWritePaths")
                .iter()
                .filter_map(Value::as_str)
                .map(label),
        );
    }
    details = details.children(list(review, "connections").iter().map(|access| {
        card()
            .child(body(text(&access["connection"], "name")))
            .child(label(format!(
                "{} · {}",
                text(access, "toolName"),
                text(access, "alias")
            )))
            .child(body(text(&access["request"], "baseUrl")))
            .child(label(format!(
                "{}: {}[key]",
                text(&access["request"], "header"),
                text(&access["request"], "prefix")
            )))
    }));
    if !list(review, "files").is_empty() {
        details = details
            .child(label("Library files included in this approval"))
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
            }));
    }
    if !list(review, "automations").is_empty() {
        details = details.child(label("Schedules")).children(
            list(review, "automations")
                .iter()
                .map(|automation| label(text(automation, "name"))),
        );
    }
    details
}

impl Workspace {
    pub(crate) fn open_project_page(&mut self, page: &'static str, _tx: &mut Tx) {
        if self.project_pages.mutating {
            return;
        }
        if self.project_pages.screen == "edit"
            || (self.project_pages.screen == "library"
                && self.project_pages.detail["content"].is_string()
                && self.project_pages.text("file") != text(&self.project_pages.detail, "content"))
        {
            self.project_pages.page = Some(if self.project_pages.screen == "edit" {
                "Automations"
            } else {
                "Plugins"
            });
            self.project_pages.error =
                Some("Save or cancel your current edits before opening another page.".into());
            return;
        }
        if self.project_pages.page == Some("Automations") && !self.automation_can_leave() {
            return;
        }
        let project = self.projects[self.project].id.clone().unwrap_or_default();
        if self.project_pages.project != project {
            let viewport_width = self.project_pages.viewport_width;
            self.project_pages = State::new();
            self.project_pages.viewport_width = viewport_width;
            self.project_pages.project = project;
        }
        if let Some(search) = self.project_pages.fields.get_mut("search") {
            search.placeholder = if page == "Automations" {
                "Search Automations"
            } else {
                "Search"
            }
            .into();
        }
        self.project_pages.page = Some(page);
        if page == "Automations" {
            self.project_pages.draft = Value::Null;
        }
        self.settings = false;
        self.project_pages.screen = "detail";
        self.project_pages.selected = None;
        self.project_pages.review = None;
        self.project_pages.confirmation = None;
        self.reload_project_page();
    }
    fn project_field_changed(&mut self, key: &'static str) {
        if key == "search" && self.project_pages.page == Some("Memory") {
            self.search_project_memory();
        }
        if self.project_pages.page == Some("Automations") && !["search", "file"].contains(&key) {
            self.queue_automation_save();
        }
    }
    fn reload_project_page(&mut self) {
        let path = query(
            "/api/projects",
            &[("projectId", &self.project_pages.project)],
        );
        self.project_request(path, None, "catalog");
    }
    fn project_request(&mut self, path: String, body: Option<Value>, target: &'static str) {
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
        self.project_pages.task = Some(crate::task::spawn(
            async move {
                let backend = backend
                    .get_or_try_init(|| crate::backend::Backend::connect(profile))
                    .await?;
                let method = if body.is_some() {
                    Method::POST
                } else {
                    Method::GET
                };
                let mut value = backend.request(method, &path, body).await?;
                if target == "catalog" {
                    value["globalSkills"] =
                        backend.request(Method::GET, "/api/prompts", None).await?;
                }
                Ok::<Value, anyhow::Error>(value)
            },
            move |s: &mut Workspace, result, tx| {
                if s.project_pages.project != project {
                    return;
                }
                s.project_pages.task = None;
                s.project_pages.mutating = false;
                match result {
                    Err(error) => s.project_pages.error = Some(error.to_string()),
                    Ok(value) => s.project_response(target, value, tx),
                }
            },
        ));
    }
    fn project_response(&mut self, target: &'static str, value: Value, tx: &mut Tx) {
        let state = &mut self.project_pages;
        match target {
            "catalog" => {
                state.data = value;
                if state.page == Some("Automations") && state.screen == "detail" {
                    self.sync_automation_selection();
                }
                if self.project_pages.page == Some("Memory") {
                    self.load_memory();
                } else {
                    self.poll_project_page();
                }
            }
            "detail" => state.detail = value,
            "library" => {
                state.library = value;
                state.detail = Value::Null;
            }
            "library-file" => {
                state.set("file", value["content"].as_str().unwrap_or(""));
                state.detail = value;
            }
            "save-note" => {
                state.screen = "detail";
                self.reload_project_page();
            }
            "save-automation" => {
                let definition = state.automation_submitted.take();
                state.automation_baseline = definition.clone();
                state.original["file"] = json!({"id":definition["id"],"definition":definition,"sourcePath":value["sourcePath"],"sourceHash":value["sourceHash"]});
                state.screen = "detail";
                state.notice = None;
                self.reload_project_page();
            }
            "save-library-file" => {
                state.detail = Value::Null;
                state.notice =
                    Some("File saved. Review changed inputs before enabling schedules.".into());
                self.reload_project_page();
            }
            "connection-saved" => {
                state.connection = Value::Null;
                state.set("connection-secret", "");
                state.confirmation = None;
                let path = query(
                    "/api/projects/connections",
                    &[("projectId", &state.project)],
                );
                self.project_request(path, None, "connections");
            }
            "tool-bindings-saved" => {
                state.original = Value::Null;
                state.draft = Value::Null;
                self.reload_project_page();
            }
            "review" => state.review = Some(value),
            "history" => {
                let mut value = value;
                for key in ["runs", "artifacts", "effects"] {
                    let mut items = list(&state.data["history"], key).to_vec();
                    for item in list(&value, key) {
                        if !items.iter().any(|old| old["id"] == item["id"]) {
                            items.push(item.clone());
                        }
                    }
                    value[key] = json!(items);
                }
                state.data["history"] = value;
            }
            "connections" => {
                state.detail = value;
                state.screen = "connections";
            }
            "effects" => {
                state.detail = value;
                state.screen = "effects";
            }
            "effect-updated" => {
                let path = query("/api/projects/effects", &[("projectId", &state.project)]);
                self.project_request(path, None, "effects");
            }
            "run-chat" => {
                state.page = None;
                self.restore_run_chat(text(&value, "paneId"), tx);
            }
            "approve-run" => {
                state.review = None;
                let id = state.selected.clone().unwrap_or_default();
                self.project_request(
                    "/api/projects/command".into(),
                    Some(json!({"type":"runAutomation","id":id,"requestId":uuid::Uuid::new_v4().to_string()})),
                    "mutation",
                );
            }
            _ => {
                if state.screen.starts_with("review-") || state.confirmation.is_some() {
                    state.screen = "detail";
                }
                state.review = None;
                state.confirmation = None;
                state.notice = Some("Saved".into());
                self.reload_project_page();
            }
        }
    }
    fn poll_project_page(&mut self) {
        self.project_pages.poll = Some(crate::task::spawn(
            async { tokio::time::sleep(std::time::Duration::from_secs(5)).await },
            |s: &mut Workspace, _, _| {
                let state = &s.project_pages;
                if state.page.is_some()
                    && state.screen == "detail"
                    && state.review.is_none()
                    && state.confirmation.is_none()
                    && state.task.is_none()
                {
                    s.reload_project_page();
                }
            },
        ));
    }
    pub(crate) fn restore_run_chat(&mut self, pane: String, tx: &mut Tx) {
        if let Some(index) = self
            .conversations
            .iter()
            .position(|chat| chat.pane.as_deref() == Some(&pane))
        {
            self.conversations[index].closed = false;
            self.selected = index;
            self.projects[self.project].selected = index;
            self.load_chat(index, 200, tx);
            return;
        }
        let profile = self.profile.clone();
        self.project_pages.restore_task = Some(crate::task::background(
            move || crate::session::load(&profile),
            move |s: &mut Workspace, loaded, tx| match loaded {
                Ok(session) => {
                    for saved in session.projects {
                        let Some(project) = s.projects.iter().position(|p| p.id == saved.id) else {
                            continue;
                        };
                        let Some(saved_pane) = saved.panes.into_iter().find(|p| p.id == pane)
                        else {
                            continue;
                        };
                        let config = session.chat_settings.get(&pane).cloned().unwrap_or_else(|| {
                            inferay_core::provider_config::resolve(
                                &json!({"agentKind":saved_pane.agent_kind,"defaults":s.default_config}),
                            )
                        });
                        let mut input = TextInput::new();
                        if let Some(draft) = session.drafts.get(&pane) {
                            input.set_content(draft);
                        }
                        let mut chat = Conversation::new(project, input, config);
                        chat.pane = Some(pane.clone());
                        chat.title = saved_pane
                            .summary
                            .unwrap_or_else(|| "Automation run".into());
                        let index = s.conversations.len();
                        s.conversations.push(chat);
                        s.project = project;
                        s.selected = index;
                        s.projects[project].selected = index;
                        s.repository = false;
                        s.load_chat(index, 200, tx);
                        break;
                    }
                }
                Err(e) => s.status = e.to_string(),
            },
        ));
    }
    pub(crate) fn project_page(&self) -> El {
        let state = &self.project_pages;
        let mut page = col()
            .key("project-page")
            .w_full()
            .h_full()
            .min_w(0.)
            .min_h(0.);
        if state.page != Some("Automations") {
            page = page.child(
                side_border(
                    row().items_center().gap(ui(10.)).h(ui(48.)).px(ui(18.)),
                    [0., 0., 1., 0.],
                    0xebebeb14,
                )
                .child(
                    Ink::body()
                        .weight(SEMIBOLD)
                        .line_text(state.page.unwrap_or("Project")),
                )
                .child(label(self.projects[self.project].name.clone()).shrink())
                .child(el().grow(1.))
                .child(
                    button("refresh-project-page", "Refresh")
                        .on_press(|s: &mut Workspace| s.reload_project_page()),
                )
                .child(button("close-project-page", "Back to chats").on_press(
                    |s: &mut Workspace| {
                        s.project_pages.page = None;
                        s.project_pages.poll = None;
                    },
                )),
            );
        }
        if let Some(error) = &state.error {
            let ink = Ink::body().color(rgb(0xf0a0a0));
            let mut block = col().px(ui(18.)).py(ui(8.)).child(ink.text(error.clone()));
            if state.page == Some("Automations") && !state.original.is_null() {
                let small = Ink::small().color(rgb(0xf0a0a0));
                block = block.child(
                    row()
                        .gap(ui(8.))
                        .child(
                            button_ink("retry-automation-save", "Retry save", small)
                                .on_press(|s: &mut Workspace| s.save_automation()),
                        )
                        .child(
                            button_ink("discard-automation-changes", "Reload saved version", small)
                                .on_press(|s: &mut Workspace| {
                                    s.project_pages.draft = Value::Null;
                                    s.project_pages.automation_save = None;
                                    s.reload_project_page();
                                }),
                        ),
                );
            }
            page = page.child(block);
        }
        if let Some(notice) = &state.notice {
            page = page.child(label(notice.clone()).px(ui(18.)).py(ui(8.)));
        }
        if state.task.is_some() && state.page != Some("Automations") {
            page = page.child(label("Loading…").px(ui(18.)));
        }
        if state.project.is_empty() {
            page = page.child(
                card()
                    .mx(ui(24.))
                    .my(ui(24.))
                    .child(body("Choose a project to use this workspace.")),
            );
        } else {
            page = page.child(match state.page {
                Some("Automations") => self.automations_page(),
                Some("Plugins") => self.plugins_page(),
                _ => self.memory_page(),
            });
        }
        if let Some((title, command)) = &state.confirmation {
            let command = command.clone();
            page =
                page.child(
                    card()
                        .mx(ui(16.))
                        .my(ui(16.))
                        .child(body(title.clone()))
                        .child(label("This change requires your confirmation."))
                        .child(
                            row()
                                .gap(ui(8.))
                                .child(action("confirm-project-change", "Confirm").on_press(
                                    move |s: &mut Workspace| {
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
                                        s.project_request(path, Some(body), target);
                                    },
                                ))
                                .child(button("cancel-project-change", "Cancel").on_press(
                                    |s: &mut Workspace| s.project_pages.confirmation = None,
                                )),
                        ),
                );
        }
        page
    }
    pub(crate) fn project_page_overlay(&self) -> Option<El> {
        (self.project_pages.page == Some("Automations") && !self.settings)
            .then(|| self.automation_popup())
            .flatten()
    }
}
