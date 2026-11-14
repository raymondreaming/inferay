use super::*;

impl Workspace {
    pub(super) fn settings_panel(&self) -> El {
        let state = &self.settings_state;
        let data = state.data.get(state.page).unwrap_or(&Value::Null);
        match state.page {
            "about" => self.about_settings(data),
            "appearance" => self.appearance_settings(),
            "agents" => self.agent_settings(data),
            "workspace" => self.folder_settings(data),
            "mcp" => self.mcp_settings(data),
            "github" => self.github_settings(data),
            "skills" => self.skills_settings(),
            "database" => self.database_settings(),
            _ => col(),
        }
    }

    fn about_settings(&self, data: &Value) -> El {
        let info = &data["info"];
        let status = &data["status"];
        let updating = status["status"] == "updating";
        let mut panel = section(
            "Inferay",
            format!(
                "Version {} · {}",
                info["version"].as_str().unwrap_or("dev"),
                info["channel"].as_str().unwrap_or("stable")
            ),
        )
        .child(setting_row(if updating {
            "Installing update… Inferay will restart.".to_owned()
        } else if info["update"]["available"] == true {
            format!(
                "Version {} is available",
                info["update"]["latestVersion"].as_str().unwrap_or("")
            )
        } else {
            "No newer version available.".to_owned()
        }));
        for error in [info["update"]["error"].as_str(), status["error"].as_str()]
            .into_iter()
            .flatten()
        {
            panel = panel.child(text(Ink::body(), error));
        }
        if std::env::var_os("INFERAY_EXTERNAL_BACKEND_ADDR").is_none()
            && info["production"] == true
            && info["update"]["available"] == true
            && !updating
        {
            panel = panel.child(button("Update and restart").key("install-update").on_press(
                |s: &mut Workspace| {
                    s.save_settings(Method::POST, "/api/native/update".into(), json!({}))
                },
            ));
        }
        panel
    }

    fn agent_settings(&self, data: &Value) -> El {
        let state = &self.settings_state;
        let view = serde_json::to_value(inferay_core::provider_config::settings_view(&json!({
            "settings": data["catalog"]["defaults"],
            "statuses": data["accounts"]["providers"],
            "loading": state.loading
        })))
        .unwrap_or(Value::Null);
        let mut providers = row().gap(ui(4.));
        for provider in view["providers"].as_array().into_iter().flatten() {
            let kind = provider["kind"].as_str().unwrap_or("codex").to_owned();
            let model = provider["model"].clone();
            let disabled = provider["disabled"] == true;
            let mut choice = selected(
                kind.clone(),
                provider["label"].as_str().unwrap_or(""),
                provider["selected"] == true,
            );
            if disabled || state.busy {
                choice = choice.opacity(0.4);
            }
            providers = providers.child(choice.on_press(move |s: &mut Workspace| {
                if disabled {
                    return;
                }
                let mut config = s.settings_state.data["agents"]["catalog"]["defaults"].clone();
                config["agentKind"] = kind.clone().into();
                config["model"] = model.clone();
                s.save_settings(Method::POST, "/api/native/provider-config".into(), config);
            }));
        }
        let mut defaults = section(
            "New chats",
            "The provider, model, and reasoning level used by default.",
        )
        .child(setting_row("Provider").child(providers))
        .child(col().py(ui(6.)).child(text(
            Ink::new(11.).hex(0xebebeb80),
            view["statusLabel"].as_str().unwrap_or(""),
        )));
        for field in view["fields"].as_array().into_iter().flatten() {
            let key = match field["key"].as_str() {
                Some("model") => "model",
                _ => "reasoningLevel",
            };
            let options = field["options"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|v| {
                    (
                        v["id"].as_str().unwrap_or("").to_owned(),
                        v["label"].as_str().unwrap_or("").to_owned(),
                    )
                })
                .collect();
            defaults =
                defaults.child(setting_row(field["label"].as_str().unwrap_or("")).child(
                    self.settings_choice(key, field["value"].as_str().unwrap_or(""), options),
                ));
        }
        let instructions = section(
            "Global agent instructions",
            "Your default AGENTS.md. Every new chat inherits these instructions.",
        )
        .child(state.field("instructions"))
        .child(
            row().justify_end().mt(ui(8.)).child(
                button(if state.busy { "Saving…" } else { "Save" }).key("save-instructions").on_press(
                    |s: &mut Workspace| {
                        let instructions = s.settings_state.text("instructions");
                        s.save_settings(
                            Method::PUT,
                            "/api/agent-context".into(),
                            json!({"scope":"global","paneId":"global-settings","instructions":instructions,"mode":"inherit"}),
                        );
                    },
                ),
            ),
        );
        col().child(defaults).child(instructions)
    }

    fn folder_settings(&self, data: &Value) -> El {
        let state = &self.settings_state;
        let mut panel = section(
            "Search folders",
            "Directories to scan when searching for projects. Use ~/path for home-relative paths.",
        )
        .child(
            row().justify_end().child(
                button("Browse")
                    .key("browse-folder")
                    .child(icon(&icons::FOLDER))
                    .on_press_tx(|s: &mut Workspace, tx| s.pick_settings_folder(None, tx)),
            ),
        );
        for (index, path) in data["folders"].as_array().into_iter().flatten().enumerate() {
            panel = panel.child(
                setting_row(path.as_str().unwrap_or("")).child(
                    button("Remove")
                        .key(format!("remove-folder-{index}"))
                        .on_press(move |s: &mut Workspace| {
                            let mut folders = s.settings_state.data["workspace"]["folders"]
                                .as_array()
                                .cloned()
                                .unwrap_or_default();
                            if index < folders.len() {
                                folders.remove(index);
                            }
                            s.save_settings(
                                Method::PUT,
                                "/api/config/search-folders".into(),
                                json!({"folders": folders}),
                            );
                        }),
                ),
            );
        }
        panel.child(
            setting_row("Add a folder")
                .child(state.field("folder").grow(1.))
                .child(
                    button("Add")
                        .key("add-folder")
                        .on_press(|s: &mut Workspace| {
                            let path = s.settings_state.text("folder").trim().to_owned();
                            if path.is_empty() {
                                return;
                            }
                            let mut folders = s
                                .settings_state
                                .data
                                .get("workspace")
                                .and_then(|d| d["folders"].as_array())
                                .cloned()
                                .unwrap_or_default();
                            if !folders.iter().any(|f| f == &path) {
                                folders.push(path.into());
                            }
                            s.save_settings(
                                Method::PUT,
                                "/api/config/search-folders".into(),
                                json!({"folders": folders}),
                            );
                        }),
                ),
        )
    }

    fn mcp_settings(&self, data: &Value) -> El {
        let mut panel = col();
        for (provider, label) in [("claude", "Claude"), ("codex", "Codex")] {
            let connections = &data[provider];
            let count = connections["servers"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|v| v["status"] == "Connected")
                .count();
            let mut group = section(
                label,
                if connections["checking"] == true {
                    "Checking…".to_owned()
                } else {
                    format!("{count} connected")
                },
            );
            if let Some(error) = connections["error"].as_str() {
                group = group.child(text(Ink::body().color(rgb(0xff8888)), error));
            }
            for (index, server) in connections["servers"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                let name = server["name"].as_str().unwrap_or("").to_owned();
                let disabled = server["status"] == "Disabled";
                let status = format!(
                    "{}{}",
                    server["status"].as_str().unwrap_or("Unknown"),
                    server["toolCount"]
                        .as_u64()
                        .map(|n| format!(" · {n} tools"))
                        .unwrap_or_default()
                );
                let mut line = setting_row(name.clone())
                    .child(text(Ink::new(11.).hex(0xebebeb80), status).shrink());
                if server["canToggle"] == true {
                    let connect_name = name.clone();
                    line = line.child(
                        button(if disabled { "Enable" } else { "Connect" })
                            .key(format!("connect-mcp-{provider}-{index}"))
                            .on_press(move |s: &mut Workspace| {
                                s.save_settings(
                                    Method::POST,
                                    "/api/agents/mcp-action".into(),
                                    json!({"provider":provider,"name":connect_name,"action":"connect"}),
                                );
                            }),
                    );
                    if !disabled {
                        line = line.child(
                            button("Disable")
                                .key(format!("disable-mcp-{provider}-{index}"))
                                .on_press(move |s: &mut Workspace| {
                                    s.save_settings(
                                        Method::POST,
                                        "/api/agents/mcp-action".into(),
                                        json!({"provider":provider,"name":name,"action":"disable"}),
                                    );
                                }),
                        );
                    }
                }
                group = group.child(line);
            }
            panel = panel.child(group);
        }
        panel
    }

    fn github_settings(&self, data: &Value) -> El {
        let state = &self.settings_state;
        let needle = state.text("repo-search").to_lowercase();
        let mut accounts = section(
            "Accounts",
            "Your GitHub identity, detected from the GitHub CLI.",
        );
        for account in data["accounts"].as_array().into_iter().flatten() {
            let mut line = setting_row(account["login"].as_str().unwrap_or("")).child(
                text(
                    Ink::body().hex(0xebebeb80),
                    account["host"].as_str().unwrap_or("github.com"),
                )
                .shrink(),
            );
            if account["active"] == true {
                line = line.child(text(Ink::body().color(rgb(0x55d68b)), "Active").shrink());
            }
            accounts = accounts.child(line);
        }
        accounts = accounts.child(
            col()
                .mt(ui(8.))
                .child(button("Connect GitHub").key("connect-github").on_press(
                    |s: &mut Workspace| {
                        s.save_settings(
                            Method::POST,
                            "/api/forge/connect".into(),
                            json!({"provider":"github"}),
                        );
                    },
                )),
        );
        let mut repos = section(
            "Repositories",
            "Find repositories from your connected account and clone them locally.",
        )
        .child(state.field("repo-search"));
        if let Some(error) = data["repoError"].as_str() {
            repos = repos.child(text(Ink::body().color(rgb(0xff8888)), error));
        }
        for (index, repo) in data["repos"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|repo| {
                repo["full_name"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&needle)
            })
            .enumerate()
        {
            let url = repo["html_url"].as_str().unwrap_or("").to_owned();
            let clone_url = url.clone();
            repos =
                repos.child(
                    col()
                        .py(ui(12.))
                        .border_sides([0., 0., 1., 0.], rgba(0xebebeb0f))
                        .border_layout()
                        .child(
                            row()
                                .items_center()
                                .child(col().grow(1.).min_w(0.).child(text(
                                    Ink::body(),
                                    repo["full_name"].as_str().unwrap_or(""),
                                )))
                                .child(
                                    button("Open")
                                        .key(format!("open-github-{index}"))
                                        .on_press_tx(move |_: &mut Workspace, tx| {
                                            let _ = tx.open_url(&url);
                                        }),
                                )
                                .child(
                                    button("Clone")
                                        .key(format!("clone-github-{index}"))
                                        .on_press_tx(move |s: &mut Workspace, tx| {
                                            s.pick_settings_folder(Some(clone_url.clone()), tx)
                                        }),
                                ),
                        )
                        .child(text(
                            Ink::new(11.).hex(0xebebeb80),
                            repo["description"].as_str().unwrap_or(""),
                        )),
                );
        }
        col().child(accounts).child(repos)
    }

    pub(super) fn settings_choice(
        &self,
        key: &'static str,
        current: &str,
        choices: Vec<(String, String)>,
    ) -> El {
        let label = choices
            .iter()
            .find(|c| c.0 == current)
            .map(|c| c.1.as_str())
            .unwrap_or(current)
            .to_owned();
        let mut trigger = button(&label)
            .key(key)
            .child(icon(&icons::CHEVRON_DOWN))
            .on_press(move |s: &mut Workspace| {
                s.settings_state.menu = if s.settings_state.menu == Some(key) {
                    None
                } else {
                    Some(key)
                };
            });
        if self.settings_state.busy {
            trigger = trigger.opacity(0.4);
        }
        let mut anchor = el().child(trigger);
        if self.settings_state.menu == Some(key) {
            let mut menu = crate::ui::menu_surface()
                .key(format!("settings-menu-{key}"))
                .pin(None, Some(ui(30.)), Some(0.), None)
                .w(ui(240.))
                .modal(true, |s: &mut Workspace| s.settings_state.menu = None);
            for (value, label) in choices {
                let on = value == current;
                menu = menu.child(
                    selected(format!("{key}-{value}"), &label, on)
                        .w_full()
                        .on_press(move |s: &mut Workspace| s.select_setting(key, value.clone())),
                );
            }
            anchor = anchor.child(menu);
        }
        anchor
    }

    fn select_setting(&mut self, key: &str, value: String) {
        self.settings_state.menu = None;
        if matches!(key, "model" | "reasoningLevel") {
            let mut config = self.settings_state.data["agents"]["catalog"]["defaults"].clone();
            config[key] = value.into();
            self.save_settings(Method::POST, "/api/native/provider-config".into(), config);
        } else if key == "font" || key == "theme" {
            let storage_key = if key == "font" {
                "inferay-app-font"
            } else {
                "inferay-syntax-highlight-theme"
            };
            self.save_settings(
                Method::POST,
                "/api/client-storage".into(),
                json!({"entries": {storage_key: value}}),
            );
        }
    }

    fn pick_settings_folder(&mut self, clone: Option<String>, tx: &mut rune::Tx) {
        if self.settings_state.busy {
            return;
        }
        self.settings_state.busy = true;
        let _ = tx;
        let prompt = crate::platform::PathPrompt {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Choose a folder"),
        };
        crate::platform::prompt_for_paths(prompt, move |s: &mut Workspace, paths, _| {
            s.settings_state.busy = false;
            if let Some(path) = paths.and_then(|paths| paths.into_iter().next()) {
                let folder = path.to_string_lossy().into_owned();
                if let Some(url) = clone {
                    s.save_settings(
                        Method::POST,
                        "/api/forge/clone".into(),
                        json!({"gitUrl": url, "cloneDirectory": folder}),
                    );
                } else {
                    let mut folders = s
                        .settings_state
                        .data
                        .get("workspace")
                        .and_then(|d| d["folders"].as_array())
                        .cloned()
                        .unwrap_or_default();
                    if !folders.iter().any(|v| v == folder.as_str()) {
                        folders.push(folder.into());
                    }
                    s.save_settings(
                        Method::PUT,
                        "/api/config/search-folders".into(),
                        json!({"folders": folders}),
                    );
                }
            }
        });
    }
}
