use super::*;

impl Workspace {
    fn plugin_file_dirty(&self) -> bool {
        let state = &self.project_pages;
        state.detail["content"].is_string() && state.text("file") != text(&state.detail, "content")
    }
    pub(super) fn plugins_page(&self) -> El {
        let state = &self.project_pages;
        let needle = state.text("search").to_lowercase();
        let catalog = &state.data["catalog"];
        let mut page = col()
            .key("plugins-page")
            .on_drop_files(|s: &mut Workspace, paths, _| {
                s.import_project_paths(paths.to_vec(), true)
            })
            .grow(1.)
            .min_h(0.)
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .padding(ui(24.))
            .gap(ui(18.))
            .child(
                row()
                    .gap(ui(10.))
                    .child(col().grow(1.).min_w(0.).child(state.field("search")))
                    .child(action("project-connections", "Connections").on_press(
                        |s: &mut Workspace| {
                            let path = query(
                                "/api/projects/connections",
                                &[("projectId", &s.project_pages.project)],
                            );
                            s.project_request(path, None, "connections")
                        },
                    ))
                    .child(
                        action("import-plugin", "Import folder")
                            .on_press_tx(|s: &mut Workspace, tx| s.pick_project_files(true, tx)),
                    ),
            );
        if state.screen != "detail" {
            page = page.child(button("back-to-libraries", "Back to libraries").on_press(
                |s: &mut Workspace| {
                    if s.plugin_file_dirty() {
                        s.project_pages.error =
                            Some("Save or discard your file edits first.".into());
                    } else {
                        s.project_pages.screen = "detail";
                        s.project_pages.review = None;
                        s.project_pages.detail = Value::Null;
                    }
                },
            ));
        }
        if state.screen == "connections" {
            page = page.child(self.project_connections());
        }
        if state.screen == "detail" {
            if list(catalog, "plugins").is_empty() {
                page = page.child(
                    card()
                        .child(body("Your reusable libraries live here"))
                        .child(label(
                            "Import a folder, or ask an agent to prepare a plugin proposal.",
                        )),
                );
            }
            for plugin in list(catalog, "plugins").iter().filter(|p| {
                format!(
                    "{} {}",
                    text(&p["file"]["definition"], "name"),
                    text(&p["file"]["definition"], "description")
                )
                .to_lowercase()
                .contains(&needle)
            }) {
                page = page.child(plugin_card(catalog, plugin));
            }
        }
        if state.screen == "library" {
            let mut library = card().child(body(text(&state.library, "summary")));
            for file in list(&state.library, "files") {
                let path = text(file, "path");
                let id = state.selected.clone().unwrap_or_default();
                library = library.child(button(format!("library-file-{path}"), &path).on_press(
                    move |s: &mut Workspace| {
                        if s.plugin_file_dirty() {
                            s.project_pages.error =
                                Some("Save or discard this file before opening another.".into());
                            return;
                        }
                        s.project_request(
                            "/api/projects/command".into(),
                            Some(json!({"type":"readPlugin","id":id,"path":path})),
                            "library-file",
                        )
                    },
                ));
            }
            if state.detail["content"].is_string() {
                library = library
                    .child(label(text(&state.detail, "path")))
                    .child(state.field("file"))
                    .child(
                        action("save-plugin-file", "Save file")
                            .on_press(|s: &mut Workspace| s.save_plugin_file()),
                    )
                    .child(
                        button("discard-plugin-edit", "Discard edits")
                            .on_press(|s: &mut Workspace| s.project_pages.detail = Value::Null),
                    );
            }
            page = page.child(library);
        }
        if let Some(review) = &state.review {
            let id = state.selected.clone().unwrap_or_default();
            let hash = review["inputsHash"].clone();
            let mut actions = row().gap(ui(8.));
            for (enable, title) in [
                (false, "Approve library"),
                (true, "Approve & enable schedules"),
            ] {
                let id = id.clone();
                let hash = hash.clone();
                actions = actions.child(action(title, title).on_press(move |s: &mut Workspace| {
                    s.project_request(
                        "/api/projects/command".into(),
                        Some(json!({"type":"approvePlugin","id":id,"expectedInputsHash":hash,"enable":enable})),
                        "mutation",
                    )
                }));
            }
            page = page.child(
                card()
                    .child(body("Review plugin inputs and permissions"))
                    .child(review_details(review))
                    .child(
                        actions.child(button("cancel-plugin-review", "Cancel").on_press(
                            |s: &mut Workspace| {
                                s.project_pages.review = None;
                                s.project_pages.screen = "detail";
                            },
                        )),
                    ),
            );
        }
        page
    }
    fn save_plugin_file(&mut self) {
        let state = &self.project_pages;
        let Some(plugin) = list(&state.data["catalog"], "plugins")
            .iter()
            .find(|p| p["file"]["id"].as_str() == state.selected.as_deref())
        else {
            return;
        };
        let source = text(&plugin["file"], "sourcePath");
        let Some((parent, _)) = source.rsplit_once('/') else {
            return;
        };
        let path = format!("{parent}/{}", text(&state.detail, "path"));
        let request = json!({"type":"saveDefinition","projectId":state.project,"path":path,"content":state.text("file"),"expectedHash":state.detail["sourceHash"]});
        self.project_request(
            "/api/projects/command".into(),
            Some(request),
            "save-library-file",
        );
    }
    fn project_connections(&self) -> El {
        let state = &self.project_pages;
        let mut panel = card()
            .child(body("Connections"))
            .child(label("Secrets are kept in the macOS Keychain."));
        for connection in list(&state.detail, "connections") {
            let edit = connection.clone();
            let request = json!({"endpoint":"/api/projects/connections","body":{"action":"delete","projectId":state.project,"id":connection["id"],"expectedRevision":connection["revision"]}});
            panel = panel.child(
                row()
                    .gap(ui(10.))
                    .child(body(text(connection, "name")).shrink())
                    .child(
                        button(
                            format!("edit-connection-{}", connection["id"]),
                            "Replace key",
                        )
                        .on_press(move |s: &mut Workspace| {
                            s.project_pages.connection = edit.clone();
                            s.project_pages
                                .set("connection-name", edit["name"].as_str().unwrap_or(""));
                            s.project_pages.set("connection-secret", "");
                        }),
                    )
                    .child(
                        button(format!("delete-connection-{}", connection["id"]), "Delete")
                            .on_press(move |s: &mut Workspace| {
                                s.project_pages.confirmation =
                                    Some(("Delete this connection?".into(), request.clone()))
                            }),
                    ),
            );
        }
        panel = panel
            .child(state.field("connection-name"))
            .child(state.field("connection-secret"))
            .child(action("save-project-connection", "Save connection").on_press(|s: &mut Workspace| {
                let state = &s.project_pages;
                let request = json!({"action":"save","projectId":state.project,"id":state.connection["id"],"expectedRevision":state.connection["revision"],"name":state.text("connection-name"),"secret":state.text("connection-secret")});
                s.project_request("/api/projects/connections".into(), Some(request), "connection-saved");
            }))
            .child(button("new-project-connection", "New connection").on_press(|s: &mut Workspace| {
                s.project_pages.connection = Value::Null;
                s.project_pages.set("connection-name", "");
                s.project_pages.set("connection-secret", "");
            }))
            .child(label("Tool connections"));
        for tool in list(&state.data["catalog"], "tools")
            .iter()
            .filter(|t| t["error"].is_null())
        {
            let tool = tool.clone();
            panel = panel.child(
                button(
                    format!("bind-tool-{}", tool["id"]),
                    &text(&tool["definition"], "name"),
                )
                .on_press(move |s: &mut Workspace| {
                    s.project_pages.original = tool.clone();
                    s.project_pages.draft = tool["definition"].clone();
                    if !s.project_pages.draft["connections"].is_object() {
                        s.project_pages.draft["connections"] = json!({});
                    }
                }),
            );
        }
        if state.draft["schema"] == "inferay.tool/1" {
            panel = panel.child(self.tool_connections());
        }
        panel
    }
    fn tool_connections(&self) -> El {
        let state = &self.project_pages;
        let mut panel = card().child(body(format!("{} connections", text(&state.draft, "name"))));
        for (alias, binding) in state.draft["connections"].as_object().into_iter().flatten() {
            let alias = alias.clone();
            let binding = binding.clone();
            let remove = alias.clone();
            panel = panel.child(
                row()
                    .gap(ui(8.))
                    .child(label(format!("{} · {}", alias, text(&binding, "baseUrl"))).shrink())
                    .child(button(format!("edit-binding-{alias}"), "Edit").on_press(
                        move |s: &mut Workspace| {
                            for (field, value) in [
                                ("connection-alias", alias.clone()),
                                ("connection-id", text(&binding, "id")),
                                ("connection-url", text(&binding, "baseUrl")),
                                ("connection-header", text(&binding, "header")),
                                ("connection-prefix", text(&binding, "prefix")),
                            ] {
                                s.project_pages.set(field, &value);
                            }
                        },
                    ))
                    .child(
                        button(format!("remove-binding-{remove}"), "Remove").on_press(
                            move |s: &mut Workspace| {
                                if let Some(connections) =
                                    s.project_pages.draft["connections"].as_object_mut()
                                {
                                    connections.remove(&remove);
                                }
                            },
                        ),
                    ),
            );
        }
        panel = panel
            .child(label("Alias"))
            .child(state.field("connection-alias"))
            .child(label("Saved connection"));
        for connection in list(&state.detail, "connections") {
            let id = text(connection, "id");
            let key = format!("choose-connection-{id}");
            let name = text(connection, "name");
            let choice = if state.text("connection-id") == id {
                filled_button(key, &name, Ink::small(), 0x8ab4f820)
            } else {
                button(key, &name)
            };
            panel = panel.child(
                choice.on_press(move |s: &mut Workspace| s.project_pages.set("connection-id", &id)),
            );
        }
        panel
            .child(label("HTTPS destination (ending in /)"))
            .child(state.field("connection-url"))
            .child(label("Header name"))
            .child(state.field("connection-header"))
            .child(label("Header prefix"))
            .child(state.field("connection-prefix"))
            .child(action("apply-tool-binding", "Add or update binding").on_press(|s: &mut Workspace| {
                let state = &s.project_pages;
                let alias = state.text("connection-alias");
                let binding = json!({"id":state.text("connection-id"),"baseUrl":state.text("connection-url"),"header":state.text("connection-header"),"prefix":state.text("connection-prefix")});
                let valid = serde_json::from_value::<inferay_core::connections::ToolConnection>(binding.clone())
                    .map_err(|e| e.to_string())
                    .and_then(|b| b.validate());
                match valid {
                    Ok(()) if !alias.is_empty() => {
                        s.project_pages.draft["connections"][alias] = binding;
                        s.project_pages.error = None;
                    }
                    _ => {
                        s.project_pages.error = Some(
                            "Choose a saved connection, an alias, and a valid HTTPS destination and header.".into(),
                        )
                    }
                }
            }))
            .child(action("save-tool-bindings", "Save connections").on_press(|s: &mut Workspace| {
                let state = &s.project_pages;
                let request = json!({"type":"saveDefinition","projectId":state.project,"path":state.original["sourcePath"],"content":state.draft.to_string(),"expectedHash":state.original["sourceHash"]});
                s.project_request("/api/projects/command".into(), Some(request), "tool-bindings-saved");
            }))
    }
    pub(super) fn pick_project_files(&mut self, plugin: bool, tx: &mut Tx) {
        if self.project_pages.task.is_some() {
            return;
        }
        let project = self.project_pages.project.clone();
        let _ = tx;
        crate::platform::prompt_for_paths(
            crate::platform::PathPrompt {
                files: !plugin,
                directories: plugin,
                multiple: !plugin,
                prompt: Some(if plugin {
                    "Import plugin folder"
                } else {
                    "Add to memory"
                }),
            },
            move |s: &mut Workspace, paths, _| {
                if let Some(paths) = paths
                    && s.project_pages.project == project
                {
                    s.import_project_paths(paths, plugin);
                }
            },
        );
    }
    pub(super) fn import_project_paths(&mut self, paths: Vec<std::path::PathBuf>, plugin: bool) {
        if self.project_pages.task.is_some() {
            return;
        }
        self.project_pages.mutating = true;
        let project = self.project_pages.project.clone();
        let request_project = project.clone();
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        self.project_pages.task = Some(crate::task::spawn(
            async move {
                let backend = backend
                    .get_or_try_init(|| crate::backend::Backend::connect(profile))
                    .await?;
                backend.import_project_files(&project, paths, plugin).await
            },
            move |s: &mut Workspace, result, _| {
                if s.project_pages.project != request_project {
                    return;
                }
                s.project_pages.task = None;
                s.project_pages.mutating = false;
                match result {
                    Ok(()) => s.reload_project_page(),
                    Err(e) => s.project_pages.error = Some(e.to_string()),
                }
            },
        ));
    }
}

fn plugin_card(catalog: &Value, plugin: &Value) -> El {
    let definition = &plugin["file"]["definition"];
    let id = text(&plugin["file"], "id");
    let (read_id, review_id, disable_id) = (id.clone(), id.clone(), id.clone());
    let mut entry = card()
        .child(
            Ink::new(16.)
                .weight(SEMIBOLD)
                .text(definition["name"].as_str().unwrap_or("Draft library")),
        )
        .child(label(format!(
            "Version {} · {}",
            text(definition, "version"),
            text(&plugin["overview"], "status")
        )))
        .child(body(text(definition, "description")))
        .children(
            list(&plugin["overview"], "issues")
                .iter()
                .map(|issue| label(text(issue, "message"))),
        )
        .children(
            list(definition, "requires")
                .iter()
                .filter_map(Value::as_str)
                .map(|requirement| label(format!("Requires {requirement}"))),
        );
    if let Some(error) = plugin["file"]["error"].as_str() {
        entry = entry.child(label(error));
    }
    entry
        .child(label(format!(
            "{} tools · {} skills · {} automations",
            list(catalog, "tools")
                .iter()
                .filter(|t| t["pluginId"] == id.as_str())
                .count(),
            list(catalog, "skills")
                .iter()
                .filter(|t| t["pluginId"] == id.as_str())
                .count(),
            list(catalog, "automations")
                .iter()
                .filter(|t| t["file"]["pluginId"] == id.as_str())
                .count()
        )))
        .child(
            row()
                .gap(ui(8.))
                .child(
                    action(format!("library-{id}"), "Files & documentation").on_press(
                        move |s: &mut Workspace| {
                            s.project_pages.selected = Some(read_id.clone());
                            s.project_pages.screen = "library";
                            s.project_request(
                                "/api/projects/command".into(),
                                Some(json!({"type":"readPlugin","id":read_id})),
                                "library",
                            );
                        },
                    ),
                )
                .child(action(format!("review-{id}"), "Review").on_press(
                    move |s: &mut Workspace| {
                        s.project_pages.selected = Some(review_id.clone());
                        s.project_pages.screen = "review-plugin";
                        s.project_request(
                            "/api/projects/command".into(),
                            Some(json!({"type":"reviewPlugin","id":review_id})),
                            "review",
                        );
                    },
                ))
                .child(
                    button(format!("disable-{id}"), "Disable schedules").on_press(
                        move |s: &mut Workspace| {
                            s.project_request(
                                "/api/projects/command".into(),
                                Some(json!({"type":"disablePlugin","id":disable_id})),
                                "mutation",
                            )
                        },
                    ),
                ),
        )
}
