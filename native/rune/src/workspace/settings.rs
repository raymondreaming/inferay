mod appearance;
mod database;
mod panels;
mod skills;
#[cfg(test)]
mod tests;

use super::*;
use crate::colors::{rgb, rgba};
use crate::icons;
use crate::ui::{Ink, SEMIBOLD, icon, plain_button, titlebar_surface};
use crate::zoom::ui;
use reqwest::Method;
use rune::{Color, El, Icon, col, el, row};
use serde_json::{Value, json};

static SECTIONS: &[(&str, &str, &str, &Icon, &str)] = &[
    (
        "about",
        "App",
        "About & updates",
        &icons::SPARKLES,
        "Inferay version and software updates.",
    ),
    (
        "database",
        "App",
        "Database",
        &icons::LAYOUT_GRID,
        "Explore local tables, records, and the schema that connects them.",
    ),
    (
        "appearance",
        "App",
        "Appearance",
        &icons::SPARKLES,
        "Make Inferay feel at home on your desktop.",
    ),
    (
        "github",
        "App",
        "GitHub",
        &icons::GIT_BRANCH,
        "Connect your account and manage GitHub access.",
    ),
    (
        "agents",
        "Agents",
        "Providers",
        &icons::CODEX,
        "Configure your agents and the defaults for new chats.",
    ),
    (
        "mcp",
        "Agents",
        "MCP connections",
        &icons::WRENCH,
        "Manage the tools and services available to your agents.",
    ),
    (
        "skills",
        "Agents",
        "Skills",
        &icons::SPARKLES,
        "Reusable instructions for your agents, available in every project.",
    ),
    (
        "workspace",
        "Workspace",
        "Folders",
        &icons::FOLDER,
        "Choose where Inferay looks for your repositories.",
    ),
];

pub(crate) struct State {
    page: &'static str,
    history: Vec<&'static str>,
    history_index: usize,
    data: HashMap<&'static str, Value>,
    fields: HashMap<&'static str, TextInput>,
    baselines: HashMap<&'static str, String>,
    loading: bool,
    busy: bool,
    error: Option<String>,
    notice: Option<String>,
    task: Option<Task>,
    poll: Option<Task>,
    mutation: Option<Task>,
    menu: Option<&'static str>,
    skill: Option<String>,
    delete_skill: bool,
    database: String,
    table: String,
    offset: u32,
    schema: Value,
    rows: Value,
    database_task: Option<Task>,
    database_tab: &'static str,
    cell: Option<String>,
    focus: Option<usize>,
}

impl State {
    pub(crate) fn new() -> Self {
        let fields = [
            ("search", "Search settings"),
            ("instructions", "Global agent instructions"),
            ("folder", "~/path/to/folder"),
            ("skill-search", "Find a skill…"),
            ("skill-name", "Skill name"),
            ("skill-command", "command-name"),
            ("skill-description", "What does this skill do?"),
            ("skill-prompt", "Instructions"),
            ("repo-search", "Find a repository…"),
            ("db-filter", "Filter records"),
        ]
        .into_iter()
        .map(|(key, placeholder)| (key, TextInput::field(placeholder)))
        .collect();
        Self {
            page: "agents",
            history: vec!["agents"],
            history_index: 0,
            data: HashMap::new(),
            fields,
            baselines: HashMap::new(),
            loading: false,
            busy: false,
            error: None,
            notice: None,
            task: None,
            poll: None,
            mutation: None,
            menu: None,
            skill: None,
            delete_skill: false,
            database: "projects".into(),
            table: String::new(),
            offset: 0,
            schema: Value::Null,
            rows: Value::Null,
            database_task: None,
            database_tab: "rows",
            cell: None,
            focus: None,
        }
    }

    fn text(&self, field: &str) -> String {
        self.fields[field].content().to_owned()
    }

    fn set_text(&mut self, field: &str, value: &str) {
        if let Some(input) = self.fields.get_mut(field) {
            input.set_content(value);
        }
    }

    fn field(&self, field: &'static str) -> El {
        let input = &self.fields[field];
        let editor = crate::input::newline_on_enter(
            crate::input::field(input, format!("settings-{field}"), access(field)),
            access(field),
        );
        crate::ui::border(
            col()
                .min_w(0.)
                .px(ui(8.))
                .py(ui(5.))
                .radius(ui(6.))
                .fill(rgba(0xffffff05)),
            0xebebeb18,
        )
        .child(crate::input::frame(input, editor))
    }

    fn bare_field(&self, field: &'static str) -> El {
        let input = &self.fields[field];
        let editor = crate::input::newline_on_enter(
            crate::input::field(input, format!("settings-{field}"), access(field)),
            access(field),
        );
        crate::input::frame(input, editor)
    }

    fn populate(&mut self, field: &'static str, value: &str) {
        let current = self.text(field);
        if !self.baselines.contains_key(field) || self.baselines.get(field) == Some(&current) {
            self.set_text(field, value);
        }
        self.baselines.insert(field, value.to_owned());
    }
}

fn access(
    field: &'static str,
) -> impl for<'a> Fn(&'a mut Workspace) -> &'a mut TextInput + Clone + 'static {
    move |s: &mut Workspace| {
        s.settings_state
            .fields
            .get_mut(field)
            .expect("settings field")
    }
}

impl Workspace {
    pub(crate) fn set_settings(&mut self, open: bool) {
        if open && !self.settings {
            self.settings_state.focus = self
                .conversations
                .iter()
                .position(|chat| chat.input.is_focused());
            for chat in &mut self.conversations {
                chat.input.edit.focused = false;
            }
            self.load_settings(false);
        } else if !open && self.settings {
            self.settings_state.task = None;
            self.settings_state.poll = None;
            self.settings_state.loading = false;
            for input in self.settings_state.fields.values_mut() {
                input.edit.focused = false;
            }
            if let Some(index) = self.settings_state.focus.take()
                && let Some(chat) = self.conversations.get_mut(index)
            {
                chat.input.focus();
            }
        }
        self.settings = open;
        self.menu = None;
        self.settings_state.menu = None;
    }

    pub(crate) fn settings_page(&mut self, page: &'static str) {
        if page == self.settings_state.page {
            return;
        }
        let state = &mut self.settings_state;
        state.history.truncate(state.history_index + 1);
        state.history.push(page);
        state.history_index += 1;
        state.page = page;
        state.menu = None;
        state.error = None;
        state.notice = None;
        self.load_settings(false);
    }

    fn load_settings(&mut self, refresh: bool) {
        self.settings_state.poll = None;
        self.settings_state.loading = true;
        self.settings_state.error = None;
        let page = self.settings_state.page;
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let work = async move {
            let backend = backend
                .get_or_try_init(|| Backend::connect(profile))
                .await?
                .clone();
            let get = |path: &'static str| backend.request(Method::GET, path, None);
            let value = match page {
                "agents" => {
                    let (catalog, accounts, context) = tokio::try_join!(
                        get("/api/native/provider-config"),
                        get("/api/agents/account-status"),
                        get("/api/agent-context?paneId=global-settings")
                    )?;
                    json!({"catalog": catalog, "accounts": accounts, "context": context})
                }
                "appearance" => {
                    let (background, font, theme) = tokio::try_join!(
                        get("/api/client-storage?key=inferay-app-background"),
                        get("/api/client-storage?key=inferay-app-font"),
                        get("/api/client-storage?key=inferay-syntax-highlight-theme")
                    )?;
                    json!({
                        "background": background["entries"]["inferay-app-background"],
                        "font": font["entries"]["inferay-app-font"],
                        "theme": theme["entries"]["inferay-syntax-highlight-theme"]
                    })
                }
                "github" => {
                    let accounts = get(if refresh {
                        "/api/forge/accounts?refresh=1"
                    } else {
                        "/api/forge/accounts"
                    })
                    .await?;
                    let repos = get(if refresh {
                        "/api/forge/repos?refresh=1&limit=100"
                    } else {
                        "/api/forge/repos?limit=100"
                    })
                    .await;
                    json!({
                        "accounts": accounts["accounts"],
                        "repos": repos.as_ref().ok().map(|v| &v["repos"]),
                        "repoError": repos.err().map(|e| e.to_string())
                    })
                }
                "mcp" => {
                    let (claude, codex) = tokio::try_join!(
                        get(if refresh {
                            "/api/agents/mcp-status?provider=claude&refresh=true"
                        } else {
                            "/api/agents/mcp-status?provider=claude"
                        }),
                        get(if refresh {
                            "/api/agents/mcp-status?provider=codex&refresh=true"
                        } else {
                            "/api/agents/mcp-status?provider=codex"
                        })
                    )?;
                    json!({"claude": claude, "codex": codex})
                }
                "about" => {
                    let (info, status) =
                        tokio::try_join!(get("/api/app-info"), get("/api/native/update"))?;
                    json!({"info": info, "status": status})
                }
                "skills" => get("/api/prompts").await?,
                "database" => get("/api/databases").await?,
                "workspace" => get("/api/config/search-folders").await?,
                _ => unreachable!(),
            };
            Ok::<_, anyhow::Error>(value)
        };
        self.settings_state.task = Some(crate::task::spawn(
            work,
            move |s: &mut Workspace, result, _| {
                s.settings_state.loading = false;
                match result {
                    Ok(value) => s.settings_loaded(page, refresh, value),
                    Err(error) => s.settings_state.error = Some(error.to_string()),
                }
            },
        ));
    }

    fn settings_loaded(&mut self, page: &'static str, refresh: bool, value: Value) {
        let state = &mut self.settings_state;
        if page == "agents" {
            self.default_config = inferay_core::provider_config::resolve(
                &json!({"defaults": value["catalog"]["defaults"]}),
            );
            state.populate(
                "instructions",
                value["context"]["global"]["instructions"]
                    .as_str()
                    .unwrap_or(""),
            );
        }
        let checking = (page == "about" && value["status"]["status"] == "updating")
            || page == "mcp"
                && (value["claude"]["checking"] == true || value["codex"]["checking"] == true);
        state.data.insert(page, value);
        if checking {
            state.poll = Some(crate::task::spawn(
                async { tokio::time::sleep(std::time::Duration::from_secs(2)).await },
                |s: &mut Workspace, _, _| {
                    if s.settings && matches!(s.settings_state.page, "mcp" | "about") {
                        s.load_settings(false);
                    }
                },
            ));
        }
        if page == "appearance" {
            self.apply_appearance();
        }
        if page == "database" && (refresh || self.settings_state.schema.is_null()) {
            self.load_database(true);
        }
    }

    fn save_settings(&mut self, method: Method, path: String, body: Value) {
        if self.settings_state.busy || self.settings_state.loading {
            return;
        }
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        self.settings_state.busy = true;
        self.settings_state.error = None;
        self.settings_state.notice = None;
        let page = self.settings_state.page;
        let saved_defaults = path == "/api/native/provider-config";
        let saved_skill = path.starts_with("/api/prompts");
        let deleted_skill = saved_skill && method == Method::DELETE;
        let submitted = body.clone();
        let work = async move { backend.request(method, &path, Some(body)).await };
        self.settings_state.mutation = Some(crate::task::spawn(
            work,
            move |s: &mut Workspace, result, tx| {
                s.settings_state.busy = false;
                match result {
                    Ok(value) => {
                        if saved_defaults {
                            s.default_config =
                                inferay_core::provider_config::resolve(&json!({"defaults": value}));
                        }
                        if saved_skill {
                            if deleted_skill {
                                s.settings_state.skill = None;
                            } else {
                                s.settings_state.skill = value["_id"].as_str().map(str::to_owned);
                                for (field, key) in skills::FIELDS {
                                    s.settings_state.baselines.insert(
                                        field,
                                        submitted[key].as_str().unwrap_or("").into(),
                                    );
                                }
                            }
                            s.settings_state.delete_skill = false;
                        }
                        if page == "agents"
                            && let Some(instructions) = submitted["instructions"].as_str()
                        {
                            s.settings_state
                                .baselines
                                .insert("instructions", instructions.into());
                        }
                        if let Some(url) = value["url"].as_str() {
                            let _ = tx.open_url(url);
                        }
                        s.settings_state.notice =
                            Some(value["message"].as_str().unwrap_or("Saved").to_owned());
                        if s.settings && page == s.settings_state.page {
                            s.load_settings(false);
                        }
                    }
                    Err(error) => s.settings_state.error = Some(error.to_string()),
                }
            },
        ));
    }

    pub(crate) fn set_background(&mut self, value: &Value) {
        use inferay_presentation::appearance::{AppBackgroundId, AppBackgroundMode};
        let background = inferay_presentation::appearance::normalize_background(value);
        self.appearance = match background.mode {
            AppBackgroundMode::Glass => Appearance::Glass,
            AppBackgroundMode::Scene => Appearance::Scene,
            _ => Appearance::Dark,
        };
        self.glass_opacity = (background.glass_opacity / 100.) as f32;
        self.scene_dim = (background.dim / 100.) as f32;
        self.scene_task = None;
        if self.appearance != Appearance::Scene {
            return;
        }
        let path = self.profile.join("backgrounds/custom-background");
        let work = move || {
            let bytes = match background.id {
                AppBackgroundId::Custom => std::fs::read(path).ok(),
                id => appearance::scene_bytes(id).map(<[u8]>::to_vec),
            }?;
            let mut image = image::load_from_memory(&bytes).ok()?;
            if background.blur > 0. {
                image = image.blur(background.blur as f32);
            }
            let pixels = image.into_rgba8();
            let scene = rune::Pixels::new();
            scene.set(pixels.width(), pixels.height(), pixels.into_raw());
            Some(scene)
        };
        self.scene_task = Some(crate::task::background(
            work,
            |s: &mut Workspace, image, _| {
                s.scene = image;
                s.scene_task = None;
            },
        ));
    }

    fn apply_appearance(&mut self) {
        let data = &self.settings_state.data["appearance"];
        let background: Value = data["background"]
            .as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(Value::Null);
        self.set_background(&background);
        let data = &self.settings_state.data["appearance"];
        self.font = Workspace::font_family(data["font"].as_str().unwrap_or(""));
        let theme = data["theme"].as_str().unwrap_or("vscode-black").to_owned();
        if theme != self.syntax_theme {
            self.syntax_theme = theme.clone();
            for index in 0..self.conversations.len() {
                self.refresh_chat_theme(index);
            }
            for view in self.repository_views.values_mut() {
                view.set_syntax_theme(theme.clone());
            }
        }
    }

    fn settings_history(&mut self, step: isize) {
        let state = &mut self.settings_state;
        let Some(index) = state.history_index.checked_add_signed(step) else {
            return;
        };
        if index >= state.history.len() {
            return;
        }
        state.history_index = index;
        state.page = state.history[index];
        self.load_settings(false);
    }

    pub(crate) fn settings_view(&self, canvas: Color) -> El {
        let state = &self.settings_state;
        let section = SECTIONS
            .iter()
            .find(|section| section.0 == state.page)
            .expect("settings section");
        let query = state.text("search").to_lowercase();
        let body = Ink::body();
        let forward = button("→")
            .key("settings-forward")
            .label("Forward")
            .on_press(|s: &mut Workspace| {
                s.settings_history(1);
            });
        let titlebar = titlebar_surface()
            .key("settings-titlebar")
            .pr(ui(12.))
            .gap(ui(10.))
            .child(
                button("")
                    .key("settings-back")
                    .label("Back")
                    .child(icon(&icons::ARROW_LEFT))
                    .on_press(|s: &mut Workspace| {
                        if s.settings_state.history_index > 0 {
                            s.settings_history(-1);
                        } else {
                            s.set_settings(false);
                        }
                    }),
            )
            .child(if state.history_index + 1 >= state.history.len() {
                forward.opacity(0.3)
            } else {
                forward
            })
            .child(body.hex(0xebebeb80).line_text("Settings").shrink())
            .child(body.hex(0xebebeb60).line_text("/").shrink())
            .child(body.line_text(section.2).shrink())
            .child(el().grow(1.).h_full().window_drag())
            .child(col().w(ui(220.)).child(state.bare_field("search")));
        let mut navigation = col()
            .key("settings-navigation")
            .w(ui(220.))
            .padding(ui(8.))
            .pt(ui(12.))
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            });
        for group in ["App", "Agents", "Workspace"] {
            let mut entries = col().mb(ui(20.)).child(
                col()
                    .px(ui(6.))
                    .py(ui(6.))
                    .child(Ink::new(11.).hex(0xebebeb80).text(group)),
            );
            for &(page, _, label, glyph, _) in SECTIONS.iter().filter(|entry| {
                entry.1 == group
                    && format!("{} {} {}", entry.2, entry.1, entry.4)
                        .to_lowercase()
                        .contains(&query)
            }) {
                entries = entries.child(
                    choice(page, "", (state.page == page).then_some(0xebebeb17))
                        .label(label)
                        .w_full()
                        .gap(ui(8.))
                        .child(icon(glyph))
                        .child(Ink::new(13.).line_text(label).shrink())
                        .on_press(move |s: &mut Workspace| s.settings_page(page)),
                );
            }
            navigation = navigation.child(entries);
        }
        let mut page = col()
            .w_full()
            .max_w(ui(if matches!(state.page, "database" | "skills") {
                1400.
            } else {
                960.
            }))
            .px(ui(32.))
            .pt(ui(30.))
            .pb(ui(48.))
            .child(
                row()
                    .items_center()
                    .child(Ink::new(20.).weight(SEMIBOLD).text(section.2).shrink())
                    .child(el().grow(1.))
                    .child(
                        button("Refresh")
                            .key("refresh-settings")
                            .on_press(|s: &mut Workspace| s.load_settings(true)),
                    ),
            )
            .child(body.hex(0xebebeb80).text(section.4).mt(ui(6.)));
        let mut blocks: Vec<(f32, f32, El)> = vec![];
        if let Some(error) = &state.error {
            blocks.push((12., 12., body.color(rgb(0xff8888)).text(error.clone())));
        }
        if let Some(notice) = &state.notice {
            blocks.push((12., 12., body.hex(0xebebebb8).text(notice.clone())));
        }
        if state.loading && !state.data.contains_key(state.page) {
            blocks.push((24., 0., body.hex(0xebebeb80).text("Loading settings…")));
        }
        if state.data.contains_key(state.page) {
            blocks.push((28., 0., self.settings_panel()));
        }
        let mut previous = 0.;
        let count = blocks.len();
        for (index, (top, bottom, block)) in blocks.into_iter().enumerate() {
            let mut block = block.mt(ui(f32::max(previous, top)));
            if index + 1 == count {
                block = block.mb(ui(bottom));
            }
            previous = bottom;
            page = page.child(block);
        }
        let content = crate::ui::border(
            col()
                .key("settings-content")
                .grow(1.)
                .min_w(0.)
                .min_h(0.)
                .mr(ui(6.))
                .mb(ui(6.))
                .radius(ui(12.))
                .clip_rounded(ui(12.))
                .fill(canvas)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                }),
            0xebebeb0a,
        )
        .child(col().w_full().items_center().child(page));
        col()
            .w_full()
            .h_full()
            .child(titlebar)
            .child(row().grow(1.).min_h(0.).child(navigation).child(content))
    }
}

fn button(label: &str) -> El {
    crate::ui::button(label)
}

fn choice(key: impl Into<String>, label: &str, selected: Option<u32>) -> El {
    let key = key.into();
    let Some(rest) = selected else {
        return button(label).key(key);
    };
    let mut button = crate::ui::swap_fill(
        plain_button("").key(key.clone()).label(label.to_owned()),
        &key,
        Some(rgba(rest)),
        rgba(0xffffff0d),
    );
    if !label.is_empty() {
        button = button.child(Ink::small().line_text(label.to_owned()));
    }
    button
}

fn pressable(base: El, key: impl Into<String>, label: &str, selected: Option<u32>) -> El {
    let key = key.into();
    let base = base
        .key(key.clone())
        .role("button")
        .label(label.to_owned())
        .focusable(true)
        .no_focus_ring()
        .gap(ui(6.))
        .px(ui(9.))
        .radius(ui(6.))
        .cursor(rune::Cursor::Pointer);
    match selected {
        Some(rest) => crate::ui::swap_fill(base, &key, Some(rgba(rest)), rgba(0xffffff0d)),
        None => base.hover(rgba(0xffffff0d)),
    }
}

fn selected(key: impl Into<String>, label: &str, on: bool) -> El {
    choice(key, label, on.then_some(0xffffff17))
}

fn text(ink: Ink, content: impl Into<String>) -> El {
    let content = content.into();
    ink.text(if content.is_empty() {
        " ".to_owned()
    } else {
        content
    })
}

fn section(title: impl Into<String>, description: impl Into<String>) -> El {
    col()
        .mb(ui(32.))
        .child(text(Ink::new(14.).weight(SEMIBOLD), title))
        .child(
            text(Ink::body().hex(0xebebeb80), description)
                .mt(ui(4.))
                .mb(ui(12.)),
        )
}

fn setting_row(label: impl Into<String>) -> El {
    row()
        .items_center()
        .gap(ui(12.))
        .py(ui(12.))
        .border_sides([0., 0., 1., 0.], rgba(0xebebeb0f))
        .border_layout()
        .child(col().grow(1.).min_w(0.).child(text(Ink::body(), label)))
}
