use super::*;

impl WorkspaceView {
    pub(super) fn settings_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.settings_state;
        let data = state.data.get(state.page).unwrap_or(&Value::Null);
        match state.page {
            "appearance" => self.appearance_settings(cx),
            "agents" => {
                let view = serde_json::to_value(inferay_core::provider_config::settings_view(&json!({
                    "settings":data["catalog"]["defaults"],"statuses":data["accounts"]["providers"],"loading":state.loading
                }))).unwrap();
                div().child(section("New chats", "The provider, model, and reasoning level used by default.")
                    .child(row("Provider").child(div().flex().gap(px(4.)).children(view["providers"].as_array().into_iter().flatten().map(|provider| {
                        let kind = provider["kind"].as_str().unwrap_or("codex").to_owned();
                        let model = provider["model"].clone();
                        let disabled = provider["disabled"] == true;
                        button(SharedString::from(kind.clone()), provider["label"].as_str().unwrap_or("").to_owned())
                            .when(provider["selected"] == true, |d| d.bg(rgba(0xffffff17)))
                            .when(disabled || state.busy, |d| d.opacity(0.4))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                if disabled { return; }
                                let mut config = s.settings_state.data["agents"]["catalog"]["defaults"].clone();
                                config["agentKind"] = kind.clone().into(); config["model"] = model.clone();
                                s.save_settings(Method::POST, "/api/native/provider-config".into(), config, cx);
                            }))
                    }))))
                    .child(div().py(px(6.)).text_size(px(11.)).text_color(rgba(0xebebeb80)).child(view["statusLabel"].as_str().unwrap_or("").to_owned()))
                    .children(view["fields"].as_array().into_iter().flatten().map(|field| {
                        let key = match field["key"].as_str() { Some("model") => "model", _ => "reasoningLevel" };
                        row(field["label"].as_str().unwrap_or("").to_owned()).child(self.settings_choice(key, field["value"].as_str().unwrap_or(""),
                            field["options"].as_array().into_iter().flatten().map(|v| (v["id"].as_str().unwrap_or("").to_owned(), v["label"].as_str().unwrap_or("").to_owned())).collect(), cx))
                    })))
                    .child(section("Global agent instructions", "Your default AGENTS.md. Every new chat inherits these instructions.")
                        .child(state.field("instructions"))
                        .child(div().flex().justify_end().mt(px(8.)).child(button("save-instructions", if state.busy { "Saving…" } else { "Save" })
                            .on_click(cx.listener(|s, _, _, cx| {
                                let instructions = s.settings_state.text("instructions", cx);
                                s.save_settings(Method::PUT, "/api/agent-context".into(), json!({"scope":"global","paneId":"global-settings","instructions":instructions,"mode":"inherit"}), cx);
                            })))))
                    .into_any_element()
            }
            "workspace" => section("Search folders", "Directories to scan when searching for projects. Use ~/path for home-relative paths.")
                .child(div().flex().justify_end().child(button("browse-folder", "Browse").child(icon("Folder")).on_click(cx.listener(|s, _, _, cx| s.pick_settings_folder(None, cx)))))
                .children(data["folders"].as_array().into_iter().flatten().enumerate().map(|(index, path)| {
                    row(path.as_str().unwrap_or("").to_owned()).child(button(("remove-folder", index), "Remove").on_click(cx.listener(move |s, _, _, cx| {
                        let mut folders = s.settings_state.data["workspace"]["folders"].as_array().cloned().unwrap_or_default();
                        if index < folders.len() { folders.remove(index); }
                        s.save_settings(Method::PUT, "/api/config/search-folders".into(), json!({"folders":folders}), cx);
                    })))
                }))
                .child(row("Add a folder").child(state.field("folder")).child(button("add-folder", "Add").on_click(cx.listener(|s, _, _, cx| {
                    let path = s.settings_state.text("folder", cx).trim().to_owned();
                    if path.is_empty() { return; }
                    let mut folders = s.settings_state.data.get("workspace").and_then(|d| d["folders"].as_array()).cloned().unwrap_or_default();
                    if !folders.iter().any(|f| f == &path) { folders.push(path.into()); }
                    s.save_settings(Method::PUT, "/api/config/search-folders".into(), json!({"folders":folders}), cx);
                }))))
                .into_any_element(),
            "mcp" => div().children([("claude", "Claude"), ("codex", "Codex")].into_iter().map(|(provider, label)| {
                let connections = &data[provider];
                let count = connections["servers"].as_array().into_iter().flatten().filter(|v| v["status"] == "Connected").count();
                section(label, if connections["checking"] == true { "Checking…".to_owned() } else { format!("{count} connected") })
                    .when_some(connections["error"].as_str().map(str::to_owned), |d, error| d.child(div().text_color(rgb(0xff8888)).child(error)))
                    .children(connections["servers"].as_array().into_iter().flatten().enumerate().map(|(index, server)| {
                        let name = server["name"].as_str().unwrap_or("").to_owned();
                        let disabled = server["status"] == "Disabled";
                        let connect_name = name.clone();
                        row(name.clone()).child(div().text_size(px(11.)).text_color(rgba(0xebebeb80)).child(format!("{}{}",server["status"].as_str().unwrap_or("Unknown"),server["toolCount"].as_u64().map(|n| format!(" · {n} tools")).unwrap_or_default())))
                            .when(server["canToggle"] == true, |d| d
                                .child(button(SharedString::from(format!("connect-mcp-{provider}-{index}")), if disabled { "Enable" } else { "Connect" }).on_click(cx.listener(move |s, _, _, cx| {
                                    s.save_settings(Method::POST, "/api/agents/mcp-action".into(), json!({"provider":provider,"name":connect_name,"action":"connect"}), cx);
                                })))
                                .when(!disabled, |d| d.child(button(SharedString::from(format!("disable-mcp-{provider}-{index}")), "Disable").on_click(cx.listener(move |s, _, _, cx| {
                                    s.save_settings(Method::POST, "/api/agents/mcp-action".into(), json!({"provider":provider,"name":name,"action":"disable"}), cx);
                                })))))
                    }))
            })).into_any_element(),
            "github" => {
                let needle = state.text("repo-search", cx).to_lowercase();
                div().child(section("Accounts", "Your GitHub identity, detected from the GitHub CLI.")
                    .children(data["accounts"].as_array().into_iter().flatten().map(|account| row(account["login"].as_str().unwrap_or("").to_owned())
                        .child(div().text_color(rgba(0xebebeb80)).child(account["host"].as_str().unwrap_or("github.com").to_owned()))
                        .when(account["active"] == true, |d| d.child(div().text_color(rgb(0x55d68b)).child("Active")))))
                    .child(div().mt(px(8.)).child(button("connect-github", "Connect GitHub").on_click(cx.listener(|s, _, _, cx| {
                        s.save_settings(Method::POST, "/api/forge/connect".into(), json!({"provider":"github"}), cx);
                    })))))
                    .child(section("Repositories", "Find repositories from your connected account and clone them locally.")
                        .child(state.field("repo-search"))
                        .when_some(data["repoError"].as_str().map(str::to_owned), |d, error| d.child(div().text_color(rgb(0xff8888)).child(error)))
                        .children(data["repos"].as_array().into_iter().flatten().filter(|repo| repo["full_name"].as_str().unwrap_or("").to_lowercase().contains(&needle)).enumerate().map(|(index, repo)| {
                            let url = repo["html_url"].as_str().unwrap_or("").to_owned();
                            let clone_url = url.clone();
                            div().py(px(12.)).border_b_1().border_color(rgba(0xebebeb0f))
                                .child(div().flex().items_center().child(div().flex_1().child(repo["full_name"].as_str().unwrap_or("").to_owned()))
                                    .child(button(("open-github", index), "Open").on_click(move |_, _, cx| cx.open_url(&url)))
                                    .child(button(("clone-github", index), "Clone").on_click(cx.listener(move |s, _, _, cx| s.pick_settings_folder(Some(clone_url.clone()), cx)))))
                                .child(div().text_color(rgba(0xebebeb80)).text_size(px(11.)).child(repo["description"].as_str().unwrap_or("").to_owned()))
                        })))
                    .into_any_element()
            }
            "skills" => self.skills_settings(cx),
            "database" => self.database_settings(cx),
            _ => div().into_any_element(),
        }
    }

    fn settings_choice(
        &self,
        key: &'static str,
        selected: &str,
        choices: Vec<(String, String)>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let label = choices
            .iter()
            .find(|c| c.0 == selected)
            .map(|c| c.1.as_str())
            .unwrap_or(selected)
            .to_owned();
        div()
            .relative()
            .child(
                button(key, label)
                    .child(icon("ChevronDown"))
                    .when(self.settings_state.busy, |d| d.opacity(0.4))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.settings_state.menu = if s.settings_state.menu == Some(key) {
                            None
                        } else {
                            Some(key)
                        };
                        cx.notify();
                    })),
            )
            .when(self.settings_state.menu == Some(key), |d| {
                d.child(
                    crate::menu_surface(SharedString::from(format!("settings-menu-{key}")))
                        .right_0()
                        .top(px(30.))
                        .w(px(240.))
                        .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                            s.settings_state.menu = None;
                            cx.notify();
                        }))
                        .children(choices.into_iter().map(|(value, label)| {
                            button(SharedString::from(format!("{key}-{value}")), label)
                                .w_full()
                                .when(value == selected, |d| d.bg(rgba(0xffffff17)))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.select_setting(key, value.clone(), cx)
                                }))
                        })),
                )
            })
    }
    fn select_setting(&mut self, key: &str, value: String, cx: &mut Context<Self>) {
        self.settings_state.menu = None;
        if matches!(key, "model" | "reasoningLevel") {
            let mut config = self.settings_state.data["agents"]["catalog"]["defaults"].clone();
            config[key] = value.into();
            self.save_settings(
                Method::POST,
                "/api/native/provider-config".into(),
                config,
                cx,
            );
        } else if key == "font" || key == "theme" {
            let storage_key = if key == "font" {
                "inferay-app-font"
            } else {
                "inferay-syntax-highlight-theme"
            };
            self.save_settings(
                Method::POST,
                "/api/client-storage".into(),
                json!({"entries":{storage_key:value}}),
                cx,
            );
        }
    }
    fn appearance_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let data = self
            .settings_state
            .data
            .get("appearance")
            .unwrap_or(&Value::Null);
        let background: Value = data["background"]
            .as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(Value::Null);
        let settings = inferay_presentation::appearance::normalize_background(&background);
        let catalog = inferay_presentation::appearance::catalog();
        let current_mode = background["mode"].as_str().unwrap_or("solid");
        let font_options = catalog
            .fonts
            .into_iter()
            .map(|font| {
                (
                    serde_json::to_value(font.id)
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .to_owned(),
                    font.label,
                )
            })
            .collect();
        div()
            .child(
                section(
                    "Background",
                    "Choose a clean solid background, a scene, or desktop glass.",
                )
                .child(
                    row("Style").child(
                        div()
                            .flex()
                            .p(px(3.))
                            .rounded(px(6.))
                            .bg(rgba(0xffffff08))
                            .children(
                                [("solid", "Solid"), ("scene", "Scene"), ("glass", "Glass")]
                                    .into_iter()
                                    .map(|(mode, label)| {
                                        button(mode, label)
                                            .when(mode == current_mode, |d| d.bg(rgba(0xffffff17)))
                                            .on_click(cx.listener(move |s, _, _, cx| {
                                                s.update_background("mode", mode.into(), cx)
                                            }))
                                    }),
                            ),
                    ),
                )
                .when(current_mode == "scene", |d| {
                    d.child(div().flex().flex_wrap().gap(px(8.)).py(px(12.)).children(
                        catalog.backgrounds.into_iter().map(|scene| {
                            let id = serde_json::to_value(scene.id).unwrap();
                            button(SharedString::from(format!("scene-{}", scene.name)), "")
                                .aria_label(scene.name.clone())
                                .w(px(150.))
                                .h_auto()
                                .p(px(6.))
                                .flex_col()
                                .child(
                                    img(id.as_str().unwrap_or("").to_owned())
                                        .w_full()
                                        .h(px(80.))
                                        .object_fit(ObjectFit::Cover)
                                        .rounded(px(4.)),
                                )
                                .child(scene.name)
                                .when(background["id"] == id, |d| d.bg(rgba(0xffffff17)))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.update_background("id", id.clone(), cx)
                                }))
                        }),
                    ))
                    .child(
                        button("custom-background", "Choose image…")
                            .on_click(cx.listener(|s, _, _, cx| s.choose_background(cx))),
                    )
                    .when(settings.custom_revision > 0., |d| {
                        d.child(button("use-custom-background", "Your image").on_click(
                            cx.listener(|s, _, _, cx| {
                                s.update_background("id", "custom".into(), cx)
                            }),
                        ))
                    })
                })
                .children(
                    if current_mode == "glass" {
                        vec![(
                            "glassOpacity",
                            "Transparency",
                            100. - settings.glass_opacity,
                            92.,
                        )]
                    } else if current_mode == "scene" {
                        vec![
                            ("dim", "Dim", settings.dim, 85.),
                            ("blur", "Blur", settings.blur, 20.),
                        ]
                    } else {
                        vec![]
                    }
                    .into_iter()
                    .map(|(key, label, value, max)| {
                        row(label)
                            .child(
                                button(SharedString::from(format!("decrease-{key}")), "−")
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        let next = (value - 5.).max(0.);
                                        s.update_background(
                                            key,
                                            json!(if key == "glassOpacity" {
                                                100. - next
                                            } else {
                                                next
                                            }),
                                            cx,
                                        );
                                    })),
                            )
                            .child(format!(
                                "{}{}",
                                value.round(),
                                if key == "blur" { "px" } else { "%" }
                            ))
                            .child(
                                button(SharedString::from(format!("increase-{key}")), "+")
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        let next = (value + 5.).min(max);
                                        s.update_background(
                                            key,
                                            json!(if key == "glassOpacity" {
                                                100. - next
                                            } else {
                                                next
                                            }),
                                            cx,
                                        );
                                    })),
                            )
                    }),
                ),
            )
            .child(
                section(
                    "Text and code",
                    "How Inferay renders interface text, diffs, and source.",
                )
                .child(row("Interface font").child(self.settings_choice(
                    "font",
                    data["font"].as_str().unwrap_or("vscode"),
                    font_options,
                    cx,
                )))
                .child(
                    row("Code theme").child(
                        self.settings_choice(
                            "theme",
                            data["theme"].as_str().unwrap_or("vscode-black"),
                            [
                                ("vscode-black", "Black"),
                                ("contrast", "High Contrast"),
                                ("vitesse", "Vitesse"),
                                ("one-dark", "One Dark"),
                                ("dracula", "Dracula"),
                                ("slack", "Slack"),
                            ]
                            .into_iter()
                            .map(|(a, b)| (a.into(), b.into()))
                            .collect(),
                            cx,
                        ),
                    ),
                ),
            )
            .into_any_element()
    }
    fn update_background(&mut self, key: &str, value: Value, cx: &mut Context<Self>) {
        let stored = self
            .settings_state
            .data
            .get("appearance")
            .and_then(|v| v["background"].as_str())
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or(Value::Null);
        let settings = serde_json::to_value(inferay_presentation::appearance::background_model(
            &json!({"stored":stored,"patch":{key:value}}),
        ))
        .unwrap()["background"]
            .clone();
        self.save_settings(
            Method::POST,
            "/api/client-storage".into(),
            json!({"entries":{"inferay-app-background":settings.to_string()}}),
            cx,
        );
    }
    fn choose_background(&mut self, cx: &mut Context<Self>) {
        if self.settings_state.busy {
            return;
        }
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        let selected = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose a background image".into()),
        });
        self.settings_state.busy = true;
        self.settings_state.mutation = Some(cx.spawn(async move |this, cx| {
            let result = match selected.await {
                Ok(Ok(Some(paths))) => {
                    if let Some(path) = paths.into_iter().next() {
                        cx.background_executor()
                            .spawn(async move {
                                RUNTIME.block_on(backend.upload_background(path)).map(Some)
                            })
                            .await
                    } else {
                        Ok(None)
                    }
                }
                Ok(Ok(None)) => Ok(None),
                Ok(Err(error)) => Err(error),
                Err(error) => Err(anyhow::anyhow!(error)),
            };
            let _ = this.update(cx, |s, cx| {
                s.settings_state.busy = false;
                match result {
                    Ok(Some(value)) => {
                        s.update_background("customRevision", value["revision"].clone(), cx)
                    }
                    Ok(None) => (),
                    Err(error) => s.settings_state.error = Some(error.to_string()),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn pick_settings_folder(&mut self, clone: Option<String>, cx: &mut Context<Self>) {
        if self.settings_state.busy {
            return;
        }
        self.settings_state.busy = true;
        let work = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Choose a folder".into()),
        });
        self.settings_state.mutation = Some(cx.spawn(async move |this, cx| {
            let result = match work.await {
                Ok(Ok(paths))=>Ok(json!({"folder":paths.and_then(|p|p.into_iter().next()).map(|p|p.to_string_lossy().into_owned())})),
                Ok(Err(error))=>Err(error), Err(error)=>Err(anyhow::anyhow!(error)),
            };
            let _ = this.update(cx, |s, cx| {
                s.settings_state.busy = false;
                match result {
                    Ok(value) => {
                        if let Some(folder) = value["folder"].as_str() {
                            if let Some(url) = clone {
                                s.save_settings(
                                    Method::POST,
                                    "/api/forge/clone".into(),
                                    json!({"gitUrl":url,"cloneDirectory":folder}),
                                    cx,
                                );
                            } else {
                                let mut folders = s
                                    .settings_state
                                    .data
                                    .get("workspace")
                                    .and_then(|d| d["folders"].as_array())
                                    .cloned()
                                    .unwrap_or_default();
                                if !folders.iter().any(|v| v == folder) {
                                    folders.push(folder.into());
                                }
                                s.save_settings(
                                    Method::PUT,
                                    "/api/config/search-folders".into(),
                                    json!({"folders":folders}),
                                    cx,
                                );
                            }
                        }
                    }
                    Err(error) => s.settings_state.error = Some(error.to_string()),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
}
