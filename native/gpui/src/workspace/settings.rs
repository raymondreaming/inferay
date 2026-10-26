mod database;
mod panels;
mod skills;
use super::*;
use crate::backend::{Backend, RUNTIME};
use reqwest::Method;
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};

const SECTIONS: &[(&str, &str, &str, &str, &str)] = &[
    (
        "database",
        "App",
        "Database",
        "LayoutGrid",
        "Explore local tables, records, and the schema that connects them.",
    ),
    (
        "appearance",
        "App",
        "Appearance",
        "Sparkles",
        "Make Inferay feel at home on your desktop.",
    ),
    (
        "github",
        "App",
        "GitHub",
        "GitBranch",
        "Connect your account and manage GitHub access.",
    ),
    (
        "agents",
        "Agents",
        "Providers",
        "codex",
        "Configure your agents and the defaults for new chats.",
    ),
    (
        "mcp",
        "Agents",
        "MCP connections",
        "Wrench",
        "Manage the tools and services available to your agents.",
    ),
    (
        "skills",
        "Agents",
        "Skills",
        "Sparkles",
        "Reusable instructions for your agents, available in every project.",
    ),
    (
        "workspace",
        "Workspace",
        "Folders",
        "Folder",
        "Choose where Inferay looks for your repositories.",
    ),
];

pub(super) struct State {
    page: &'static str,
    history: Vec<&'static str>,
    history_index: usize,
    data: HashMap<&'static str, Value>,
    fields: HashMap<&'static str, Entity<TextInput>>,
    baselines: HashMap<&'static str, String>,
    loading: bool,
    busy: bool,
    error: Option<String>,
    notice: Option<String>,
    task: Option<Task<()>>,
    poll: Option<Task<()>>,
    mutation: Option<Task<()>>,
    menu: Option<&'static str>,
    skill: Option<String>,
    delete_skill: bool,
    database: String,
    table: String,
    offset: u32,
    schema: Value,
    rows: Value,
    database_task: Option<Task<()>>,
    database_tab: &'static str,
    cell: Option<String>,
}
impl State {
    pub(super) fn new(cx: &mut Context<WorkspaceView>) -> Self {
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
        .map(|(key, placeholder)| {
            let input = cx.new(|cx| TextInput::field(placeholder, cx));
            cx.observe(&input, |_, _, cx| cx.notify()).detach();
            (key, input)
        })
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
        }
    }
    fn text(&self, field: &str, cx: &App) -> String {
        self.fields[field].read(cx).content.to_string()
    }
    fn field(&self, field: &'static str) -> impl IntoElement {
        div()
            .min_w_0()
            .flex_1()
            .px(px(8.))
            .py(px(5.))
            .rounded(px(6.))
            .border_1()
            .border_color(rgba(0xebebeb18))
            .bg(rgba(0xffffff05))
            .child(self.fields[field].clone())
    }
    fn populate(&mut self, field: &'static str, value: &str, cx: &mut Context<WorkspaceView>) {
        let current = self.text(field, cx);
        if !self.baselines.contains_key(field) || self.baselines.get(field) == Some(&current) {
            self.fields[field].update(cx, |input, cx| input.set_content(value, cx));
        }
        self.baselines.insert(field, value.to_owned());
    }
}

impl WorkspaceView {
    pub(super) fn set_settings(
        &mut self,
        visible: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if visible && !self.settings {
            self.settings_focus = window.focused(cx);
            window.focus(&self.focus, cx);
            self.load_settings(false, cx);
        } else if !visible && self.settings {
            self.settings_state.task = None;
            self.settings_state.poll = None;
            self.settings_state.loading = false;
            if let Some(focus) = self.settings_focus.take() {
                window.focus(&focus, cx);
            }
        }
        self.settings = visible;
        self.menu = None;
        self.settings_state.menu = None;
        cx.notify();
    }
    fn settings_page(&mut self, page: &'static str, cx: &mut Context<Self>) {
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
        self.load_settings(false, cx);
    }
    fn load_settings(&mut self, refresh: bool, cx: &mut Context<Self>) {
        self.settings_state.poll = None;
        self.settings_state.loading = true;
        self.settings_state.error = None;
        let page = self.settings_state.page;
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let work = cx.background_executor().spawn(async move {
            RUNTIME.block_on(async move {
                let backend = backend.get_or_try_init(|| Backend::connect(profile)).await?.clone();
                let get = |path: &'static str| backend.request(Method::GET, path, None);
                let value = match page {
                    "agents" => {
                        let (catalog, accounts, context) = tokio::try_join!(get("/api/native/provider-config"), get("/api/agents/account-status"), get("/api/agent-context?paneId=global-settings"))?;
                        json!({"catalog": catalog, "accounts": accounts, "context": context})
                    }
                    "appearance" => {
                        let (background, font, theme) = tokio::try_join!(get("/api/client-storage?key=inferay-app-background"), get("/api/client-storage?key=inferay-app-font"), get("/api/client-storage?key=inferay-syntax-highlight-theme"))?;
                        json!({"background":background["entries"]["inferay-app-background"],"font":font["entries"]["inferay-app-font"],"theme":theme["entries"]["inferay-syntax-highlight-theme"]})
                    }
                    "github" => {
                        let accounts = get(if refresh { "/api/forge/accounts?refresh=1" } else { "/api/forge/accounts" }).await?;
                        let repos = get(if refresh { "/api/forge/repos?refresh=1&limit=100" } else { "/api/forge/repos?limit=100" }).await;
                        json!({"accounts":accounts["accounts"], "repos":repos.as_ref().ok().map(|v| &v["repos"]), "repoError":repos.err().map(|e| e.to_string())})
                    }
                    "mcp" => {
                        let (claude, codex) = tokio::try_join!(get(if refresh { "/api/agents/mcp-status?provider=claude&refresh=true" } else { "/api/agents/mcp-status?provider=claude" }), get(if refresh { "/api/agents/mcp-status?provider=codex&refresh=true" } else { "/api/agents/mcp-status?provider=codex" }))?;
                        json!({"claude":claude,"codex":codex})
                    }
                    "skills" => get("/api/prompts").await?,
                    "database" => get("/api/databases").await?,
                    "workspace" => get("/api/config/search-folders").await?,
                    _ => unreachable!(),
                };
                Ok::<_, anyhow::Error>(value)
            })
        });
        self.settings_state.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                let state = &mut s.settings_state;
                state.loading = false;
                match result {
                    Ok(value) => {
                        if page == "agents" {
                            s.default_config = inferay_core::provider_config::resolve(
                                &json!({"defaults":value["catalog"]["defaults"]}),
                            );
                            state.populate(
                                "instructions",
                                value["context"]["global"]["instructions"]
                                    .as_str()
                                    .unwrap_or(""),
                                cx,
                            );
                        }
                        let checking = page == "mcp"
                            && (value["claude"]["checking"] == true
                                || value["codex"]["checking"] == true);
                        state.data.insert(page, value);
                        if checking {
                            state.poll = Some(cx.spawn(async |this, cx| {
                                cx.background_executor()
                                    .timer(std::time::Duration::from_secs(2))
                                    .await;
                                let _ = this.update(cx, |s, cx| {
                                    if s.settings && s.settings_state.page == "mcp" {
                                        s.load_settings(false, cx);
                                    }
                                });
                            }));
                        }
                        if page == "appearance" {
                            s.apply_appearance(cx);
                        }
                        if page == "database" && (refresh || s.settings_state.schema.is_null()) {
                            s.load_database(true, cx);
                        }
                    }
                    Err(error) => state.error = Some(error.to_string()),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn save_settings(&mut self, method: Method, path: String, body: Value, cx: &mut Context<Self>) {
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
        let work = cx
            .background_executor()
            .spawn(async move { RUNTIME.block_on(backend.request(method, &path, Some(body))) });
        self.settings_state.mutation = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                s.settings_state.busy = false;
                match result {
                    Ok(value) => {
                        if saved_defaults {
                            s.default_config =
                                inferay_core::provider_config::resolve(&json!({"defaults":value}));
                        }
                        if saved_skill {
                            if deleted_skill {
                                s.settings_state.skill = None;
                            } else {
                                s.settings_state.skill = value["_id"].as_str().map(str::to_owned);
                                for (field, key) in [
                                    ("skill-name", "name"),
                                    ("skill-command", "command"),
                                    ("skill-description", "description"),
                                    ("skill-prompt", "promptTemplate"),
                                ] {
                                    s.settings_state.baselines.insert(
                                        field,
                                        submitted[key].as_str().unwrap_or("").into(),
                                    );
                                }
                            }
                            s.settings_state.delete_skill = false;
                        }
                        if page == "agents" && submitted["instructions"].is_string() {
                            s.settings_state.baselines.insert(
                                "instructions",
                                submitted["instructions"].as_str().unwrap().into(),
                            );
                        }
                        if let Some(url) = value["url"].as_str() {
                            cx.open_url(url);
                        }
                        s.settings_state.notice =
                            Some(value["message"].as_str().unwrap_or("Saved").to_owned());
                        if s.settings && page == s.settings_state.page {
                            s.load_settings(false, cx);
                        }
                    }
                    Err(error) => s.settings_state.error = Some(error.to_string()),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    pub(super) fn set_background(&mut self, value: &Value, cx: &mut Context<Self>) {
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
        let work = cx.background_executor().spawn(async move {
            let bytes = match background.id {
                AppBackgroundId::Custom => std::fs::read(path).ok(),
                _ => crate::Assets
                    .load(match background.id {
                        AppBackgroundId::City => "city",
                        AppBackgroundId::Nature => "nature",
                        AppBackgroundId::Orbit => "orbit",
                        AppBackgroundId::Signals => "signals",
                        _ => "",
                    })
                    .ok()
                    .flatten()
                    .map(|b| b.into_owned()),
            }?;
            let mut image = image::load_from_memory(&bytes).ok()?;
            if background.blur > 0. {
                image = image.blur(background.blur as f32);
            }
            let mut output = std::io::Cursor::new(Vec::new());
            image.write_to(&mut output, image::ImageFormat::Png).ok()?;
            Some(Arc::new(Image::from_bytes(
                ImageFormat::Png,
                output.into_inner(),
            )))
        });
        self.scene_task = Some(cx.spawn(async move |this, cx| {
            let image = work.await;
            let _ = this.update(cx, |s, cx| {
                s.scene = image;
                cx.notify();
            });
        }));
    }
    fn apply_appearance(&mut self, cx: &mut Context<Self>) {
        let data = &self.settings_state.data["appearance"];
        let background: Value = data["background"]
            .as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(Value::Null);
        self.set_background(&background, cx);
        let data = &self.settings_state.data["appearance"];
        self.font = match data["font"].as_str() {
            Some("geist") => "Geist",
            Some("menlo") => "Menlo",
            Some("inter") => "Inter",
            Some("manrope") => "Manrope",
            Some("ibm-plex-sans") => "IBM Plex Sans",
            _ => ".SystemUIFont",
        };
        for chat in &self.conversations {
            chat.scroll.remeasure();
        }
        let theme = data["theme"].as_str().unwrap_or("vscode-black");
        if theme != self.syntax_theme {
            self.syntax_theme = theme.into();
            for chat in &mut self.conversations {
                chat.rich = chat
                    .messages
                    .iter()
                    .map(|message| crate::rich_text::RichText::message(message, &self.syntax_theme))
                    .collect();
            }
            for repo in self.repository_views.values() {
                repo.update(cx, |repo, cx| {
                    repo.set_syntax_theme(self.syntax_theme.clone(), cx)
                });
            }
        }
    }
    pub(super) fn settings(&self, canvas: Rgba, cx: &mut Context<Self>) -> impl IntoElement {
        let state = &self.settings_state;
        let section = SECTIONS
            .iter()
            .find(|section| section.0 == state.page)
            .unwrap();
        let query = state.text("search", cx).to_lowercase();
        div()
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(38.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .pl(px(86.))
                    .pr(px(12.))
                    .gap(px(10.))
                    .child(
                        button("back", "")
                            .aria_label("Back")
                            .child(icon("ArrowLeft"))
                            .on_click(cx.listener(|s, _, window, cx| {
                                if s.settings_state.history_index > 0 {
                                    s.settings_state.history_index -= 1;
                                    s.settings_state.page =
                                        s.settings_state.history[s.settings_state.history_index];
                                    s.load_settings(false, cx);
                                } else {
                                    s.set_settings(false, window, cx);
                                }
                            })),
                    )
                    .child(
                        button("settings-forward", "→")
                            .aria_label("Forward")
                            .when(state.history_index + 1 >= state.history.len(), |d| {
                                d.opacity(0.3)
                            })
                            .on_click(cx.listener(|s, _, _, cx| {
                                if s.settings_state.history_index + 1
                                    < s.settings_state.history.len()
                                {
                                    s.settings_state.history_index += 1;
                                    s.settings_state.page =
                                        s.settings_state.history[s.settings_state.history_index];
                                    s.load_settings(false, cx);
                                }
                            })),
                    )
                    .child(div().text_color(rgba(0xebebeb80)).child("Settings"))
                    .child(div().text_color(rgba(0xebebeb60)).child("/"))
                    .child(section.2)
                    .child(div().flex_1().h_full().on_mouse_down(
                        MouseButton::Left,
                        |event, window, _| {
                            if event.click_count == 2 {
                                window.zoom_window();
                            } else {
                                window.start_window_move();
                            }
                        },
                    ))
                    .child(div().w(px(220.)).child(state.fields["search"].clone())),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(
                        div()
                            .id("settings-navigation")
                            .w(px(220.))
                            .p(px(8.))
                            .pt(px(12.))
                            .flex_shrink_0()
                            .overflow_y_scroll()
                            .children(["App", "Agents", "Workspace"].into_iter().map(|group| {
                                div()
                                    .mb(px(20.))
                                    .child(
                                        div()
                                            .px(px(6.))
                                            .py(px(6.))
                                            .text_size(px(11.))
                                            .text_color(rgba(0xebebeb80))
                                            .child(group),
                                    )
                                    .children(
                                        SECTIONS
                                            .iter()
                                            .filter(|entry| {
                                                entry.1 == group
                                                    && format!(
                                                        "{} {} {}",
                                                        entry.2, entry.1, entry.4
                                                    )
                                                    .to_lowercase()
                                                    .contains(&query)
                                            })
                                            .map(|&(page, _, label, glyph, _)| {
                                                button(page, "")
                                                    .aria_label(label)
                                                    .w_full()
                                                    .gap(px(8.))
                                                    .text_size(px(13.))
                                                    .when(state.page == page, |d| {
                                                        d.bg(rgba(0xebebeb17))
                                                    })
                                                    .child(icon(glyph))
                                                    .child(label)
                                                    .on_click(cx.listener(move |s, _, _, cx| {
                                                        s.settings_page(page, cx)
                                                    }))
                                            }),
                                    )
                            })),
                    )
                    .child(
                        div()
                            .id("settings-content")
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .overflow_y_scroll()
                            .mr(px(6.))
                            .mb(px(6.))
                            .rounded(px(12.))
                            .border_1()
                            .border_color(rgba(0xebebeb0a))
                            .bg(canvas)
                            .child(
                                div()
                                    .w_full()
                                    .max_w(px(
                                        if state.page == "database" || state.page == "skills" {
                                            1400.
                                        } else {
                                            960.
                                        },
                                    ))
                                    .mx_auto()
                                    .px(px(32.))
                                    .pt(px(30.))
                                    .pb(px(48.))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .child(
                                                div()
                                                    .text_size(px(20.))
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .child(section.2),
                                            )
                                            .child(div().flex_1())
                                            .child(button("refresh-settings", "Refresh").on_click(
                                                cx.listener(|s, _, _, cx| {
                                                    s.load_settings(true, cx)
                                                }),
                                            )),
                                    )
                                    .child(
                                        div()
                                            .mt(px(6.))
                                            .text_color(rgba(0xebebeb80))
                                            .child(section.4),
                                    )
                                    .when_some(state.error.clone(), |d, error| {
                                        d.child(
                                            div()
                                                .my(px(12.))
                                                .text_color(rgb(0xff8888))
                                                .child(error),
                                        )
                                    })
                                    .when_some(state.notice.clone(), |d, notice| {
                                        d.child(
                                            div()
                                                .my(px(12.))
                                                .text_color(rgba(0xebebebb8))
                                                .child(notice),
                                        )
                                    })
                                    .when(
                                        state.loading && !state.data.contains_key(state.page),
                                        |d| {
                                            d.child(
                                                div()
                                                    .mt(px(24.))
                                                    .text_color(rgba(0xebebeb80))
                                                    .child("Loading settings…"),
                                            )
                                        },
                                    )
                                    .when(state.data.contains_key(state.page), |d| {
                                        d.child(div().mt(px(28.)).child(self.settings_panel(cx)))
                                    }),
                            ),
                    ),
            )
    }
}

fn section(title: impl Into<SharedString>, description: impl Into<SharedString>) -> Div {
    div()
        .mb(px(32.))
        .child(
            div()
                .text_size(px(14.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title.into()),
        )
        .child(
            div()
                .mt(px(4.))
                .mb(px(12.))
                .text_color(rgba(0xebebeb80))
                .child(description.into()),
        )
}
fn row(label: impl Into<SharedString>) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(12.))
        .py(px(12.))
        .border_b_1()
        .border_color(rgba(0xebebeb0f))
        .child(div().flex_1().min_w_0().child(label.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn refreshing_settings_preserves_cleared_and_edited_instructions(cx: &mut TestAppContext) {
        let window = cx.add_window(|_, cx| {
            let input = cx.new(TextInput::new);
            WorkspaceView::empty(cx.focus_handle(), input, cx)
        });
        window
            .update(cx, |view, _, cx| {
                let state = &mut view.settings_state;
                state.populate("instructions", "Saved instructions", cx);
                assert_eq!(state.text("instructions", cx), "Saved instructions");
                state.fields["instructions"].update(cx, |input, cx| input.set_content("", cx));
                state.populate("instructions", "Saved instructions", cx);
                assert_eq!(state.text("instructions", cx), "");
                state.fields["instructions"]
                    .update(cx, |input, cx| input.set_content("Unsaved draft", cx));
                state.populate("instructions", "Updated elsewhere", cx);
                assert_eq!(state.text("instructions", cx), "Unsaved draft");
            })
            .unwrap();
    }
}
