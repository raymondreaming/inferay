use super::*;
impl WorkspaceView {
    pub(super) fn plugins_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let needle = state.text("search", cx).to_lowercase();
        div().id("plugins-page").debug_selector(||"plugins-page".into()).on_drop(cx.listener(|s,paths:&ExternalPaths,_,cx|s.import_project_paths(paths.paths().to_vec(),true,cx))).flex_1().min_h_0().overflow_y_scroll().p(ui(24.)).flex().flex_col().gap(ui(18.))
            .child(div().flex().gap(ui(10.)).child(div().flex_1().child(state.field("search")))
                .child(action("project-connections","Connections").on_click(cx.listener(|s,_,_,cx|s.project_request(query("/api/projects/connections",&[("projectId",&s.project_pages.project)]),None,"connections",cx))))
                .child(action("import-plugin","Import folder").on_click(cx.listener(|s,_,window,cx|s.pick_project_files(true,window,cx)))))
            .when(state.screen!="detail",|d|d.child(button("back-to-libraries","Back to libraries").on_click(cx.listener(|s,_,_,cx|{
                if s.project_pages.detail["content"].is_string() && s.project_pages.text("file",cx)!=text(&s.project_pages.detail,"content"){s.project_pages.error=Some("Save or discard your file edits first.".into());}else{s.project_pages.screen="detail";s.project_pages.review=None;s.project_pages.detail=Value::Null;}cx.notify();
            }))))
            .when(state.screen=="connections",|d|d.child(self.project_connections(cx)))
            .when(state.screen=="detail",|d|d
                .when(list(&state.data["catalog"],"plugins").is_empty(),|d|d.child(card().child("Your reusable libraries live here").child(label("Import a folder, or ask an agent to prepare a plugin proposal."))))
                .children(list(&state.data["catalog"],"plugins").iter().filter(|p|format!("{} {}",text(&p["file"]["definition"],"name"),text(&p["file"]["definition"],"description")).to_lowercase().contains(&needle)).map(|plugin| {
                    let id=text(&plugin["file"],"id");let read_id=id.clone();let review_id=id.clone();let disable_id=id.clone();
                    card().child(div().text_size(ui(16.)).font_weight(FontWeight::SEMIBOLD).child(plugin["file"]["definition"]["name"].as_str().unwrap_or("Draft library").to_owned()))
                        .child(label(format!("Version {} · {}",text(&plugin["file"]["definition"],"version"),text(&plugin["overview"],"status"))))
                        .child(text(&plugin["file"]["definition"],"description"))
                        .children(list(&plugin["overview"],"issues").iter().map(|issue|label(text(issue,"message"))))
                        .children(list(&plugin["file"]["definition"],"requires").iter().filter_map(Value::as_str).map(|requirement|label(format!("Requires {requirement}"))))
                        .when_some(plugin["file"]["error"].as_str(),|d,e|d.child(label(e.to_owned())))
                        .child(label(format!("{} tools · {} skills · {} automations",list(&state.data["catalog"],"tools").iter().filter(|t|t["pluginId"]==id).count(),list(&state.data["catalog"],"skills").iter().filter(|t|t["pluginId"]==id).count(),list(&state.data["catalog"],"automations").iter().filter(|t|t["file"]["pluginId"]==id).count())))
                        .child(div().flex().gap(ui(8.))
                            .child(action(SharedString::from(format!("library-{id}")),"Files & documentation").on_click(cx.listener(move |s,_,_,cx|{s.project_pages.selected=Some(read_id.clone());s.project_pages.screen="library";s.project_request("/api/projects/command".into(),Some(json!({"type":"readPlugin","id":read_id})),"library",cx);})))
                            .child(action(SharedString::from(format!("review-{id}")),"Review").on_click(cx.listener(move |s,_,_,cx|{s.project_pages.selected=Some(review_id.clone());s.project_pages.screen="review-plugin";s.project_request("/api/projects/command".into(),Some(json!({"type":"reviewPlugin","id":review_id})),"review",cx);})))
                            .child(button(SharedString::from(format!("disable-{id}")),"Disable schedules").on_click(cx.listener(move |s,_,_,cx|s.project_request("/api/projects/command".into(),Some(json!({"type":"disablePlugin","id":disable_id})),"mutation",cx)))))
                })))
            .when(state.screen=="library",|d| d.child(card().child(text(&state.library,"summary"))
                .children(list(&state.library,"files").iter().map(|file|{
                    let path=text(file,"path");let id=state.selected.clone().unwrap_or_default();
                    button(SharedString::from(format!("library-file-{path}")),path.clone()).on_click(cx.listener(move |s,_,_,cx|{if s.project_pages.detail["content"].is_string() && s.project_pages.text("file",cx)!=text(&s.project_pages.detail,"content"){s.project_pages.error=Some("Save or discard this file before opening another.".into());cx.notify();return;}s.project_request("/api/projects/command".into(),Some(json!({"type":"readPlugin","id":id,"path":path})),"library-file",cx)}))
                }))
                .when(state.detail["content"].is_string(),|d|d.child(label(text(&state.detail,"path"))).child(state.field("file")).child(action("save-plugin-file","Save file").on_click(cx.listener(|s,_,_,cx|s.save_plugin_file(cx)))).child(button("discard-plugin-edit","Discard edits").on_click(cx.listener(|s,_,_,cx|{s.project_pages.detail=Value::Null;cx.notify();}))))))
            .when_some(state.review.as_ref(),|d,review|{
                let id=state.selected.clone().unwrap_or_default();let hash=review["inputsHash"].clone();
                d.child(card().child("Review plugin inputs and permissions").child(review_details(review))
                    .child(div().flex().gap(ui(8.))
                        .children([(false,"Approve library"),(true,"Approve & enable schedules")].into_iter().map(|(enable,title)| {let id=id.clone();let hash=hash.clone();action(title,title).on_click(cx.listener(move |s,_,_,cx|s.project_request("/api/projects/command".into(),Some(json!({"type":"approvePlugin","id":id,"expectedInputsHash":hash,"enable":enable})),"mutation",cx)))}))
                        .child(button("cancel-plugin-review","Cancel").on_click(cx.listener(|s,_,_,cx|{s.project_pages.review=None;s.project_pages.screen="detail";cx.notify();})))))
            }).into_any_element()
    }
    fn save_plugin_file(&mut self, cx: &mut Context<Self>) {
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
        let request = json!({"type":"saveDefinition","projectId":state.project,"path":path,"content":state.text("file",cx),"expectedHash":state.detail["sourceHash"]});
        self.project_request(
            "/api/projects/command".into(),
            Some(request),
            "save-library-file",
            cx,
        );
    }
    fn project_connections(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        card().child("Connections").child(label("Secrets are kept in the macOS Keychain."))
            .children(list(&state.detail,"connections").iter().map(|connection| {
                let edit=connection.clone();let request=json!({"endpoint":"/api/projects/connections","body":{"action":"delete","projectId":state.project,"id":connection["id"],"expectedRevision":connection["revision"]}});
                div().flex().gap(ui(10.)).child(text(connection,"name")).child(button(SharedString::from(format!("edit-connection-{}",connection["id"])),"Replace key").on_click(cx.listener(move |s,_,_,cx|{s.project_pages.connection=edit.clone();s.project_pages.set("connection-name",edit["name"].as_str().unwrap_or(""),cx);s.project_pages.set("connection-secret","",cx);cx.notify();}))).child(button(SharedString::from(format!("delete-connection-{}",connection["id"])),"Delete").on_click(cx.listener(move |s,_,_,cx|{s.project_pages.confirmation=Some(("Delete this connection?".into(),request.clone()));cx.notify();})))
            }))
            .child(state.field("connection-name")).child(state.field("connection-secret"))
            .child(action("save-project-connection","Save connection").on_click(cx.listener(|s,_,_,cx| {
                let request=json!({"action":"save","projectId":s.project_pages.project,"id":s.project_pages.connection["id"],"expectedRevision":s.project_pages.connection["revision"],"name":s.project_pages.text("connection-name",cx),"secret":s.project_pages.text("connection-secret",cx)});
                s.project_request("/api/projects/connections".into(),Some(request),"connection-saved",cx);
            })))
            .child(button("new-project-connection","New connection").on_click(cx.listener(|s,_,_,cx|{s.project_pages.connection=Value::Null;s.project_pages.set("connection-name","",cx);s.project_pages.set("connection-secret","",cx);cx.notify();})))
            .child(label("Tool connections"))
            .children(list(&state.data["catalog"],"tools").iter().filter(|t|t["error"].is_null()).map(|tool| {
                let tool=tool.clone();
                button(SharedString::from(format!("bind-tool-{}",tool["id"])),text(&tool["definition"],"name")).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.original=tool.clone();s.project_pages.draft=tool["definition"].clone();if !s.project_pages.draft["connections"].is_object(){s.project_pages.draft["connections"]=json!({});}cx.notify();}))
            }))
            .when(state.draft["schema"]=="inferay.tool/1",|d|d.child(self.tool_connections(cx)))
            .into_any_element()
    }
    fn tool_connections(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        card().child(format!("{} connections",text(&state.draft,"name")))
            .children(state.draft["connections"].as_object().into_iter().flatten().map(|(alias,binding)|{
                let alias=alias.clone();let binding=binding.clone();let remove=alias.clone();
                div().flex().gap(ui(8.)).child(label(format!("{} · {}",alias,text(&binding,"baseUrl"))))
                    .child(button(SharedString::from(format!("edit-binding-{alias}")),"Edit").on_click(cx.listener(move |s,_,_,cx|{
                        for (field,value) in [("connection-alias",alias.clone()),("connection-id",text(&binding,"id")),("connection-url",text(&binding,"baseUrl")),("connection-header",text(&binding,"header")),("connection-prefix",text(&binding,"prefix"))] {s.project_pages.set(field,&value,cx);}cx.notify();
                    })))
                    .child(button(SharedString::from(format!("remove-binding-{remove}")),"Remove").on_click(cx.listener(move |s,_,_,cx|{s.project_pages.draft["connections"].as_object_mut().unwrap().remove(&remove);cx.notify();})))
            }))
            .child(label("Alias")).child(state.field("connection-alias"))
            .child(label("Saved connection"))
            .children(list(&state.detail,"connections").iter().map(|connection|{let id=text(connection,"id");button(SharedString::from(format!("choose-connection-{id}")),text(connection,"name")).when(state.text("connection-id",cx)==id,|d|d.bg(rgba(0x8ab4f820))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.set("connection-id",&id,cx);cx.notify();}))}))
            .child(label("HTTPS destination (ending in /)")).child(state.field("connection-url"))
            .child(label("Header name")).child(state.field("connection-header"))
            .child(label("Header prefix")).child(state.field("connection-prefix"))
            .child(action("apply-tool-binding","Add or update binding").on_click(cx.listener(|s,_,_,cx|{
                let state=&s.project_pages;
                let alias=state.text("connection-alias",cx);
                let binding=json!({"id":state.text("connection-id",cx),"baseUrl":state.text("connection-url",cx),"header":state.text("connection-header",cx),"prefix":state.text("connection-prefix",cx)});
                let valid=serde_json::from_value::<inferay_core::connections::ToolConnection>(binding.clone()).map_err(|e|e.to_string()).and_then(|b|b.validate());
                match valid {Ok(()) if !alias.is_empty()=>{s.project_pages.draft["connections"][alias]=binding;s.project_pages.error=None;},_=>s.project_pages.error=Some("Choose a saved connection, an alias, and a valid HTTPS destination and header.".into())}cx.notify();
            })))
            .child(action("save-tool-bindings","Save connections").on_click(cx.listener(|s,_,_,cx|{
                let state=&s.project_pages;
                let request=json!({"type":"saveDefinition","projectId":state.project,"path":state.original["sourcePath"],"content":state.draft.to_string(),"expectedHash":state.original["sourceHash"]});
                s.project_request("/api/projects/command".into(),Some(request),"tool-bindings-saved",cx);
            }))).into_any_element()
    }
    pub(super) fn pick_project_files(
        &mut self,
        plugin: bool,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.project_pages.task.is_some() {
            return;
        }
        let project = self.project_pages.project.clone();
        let receiver = cx.prompt_for_paths(PathPromptOptions {
            files: !plugin,
            directories: plugin,
            multiple: !plugin,
            prompt: Some(
                if plugin {
                    "Import plugin folder"
                } else {
                    "Add to memory"
                }
                .into(),
            ),
        });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = receiver.await else {
                return;
            };
            let _ = this.update(cx, |s, cx| {
                if s.project_pages.project == project {
                    s.import_project_paths(paths, plugin, cx);
                }
            });
        })
        .detach();
    }
    pub(super) fn import_project_paths(
        &mut self,
        paths: Vec<std::path::PathBuf>,
        plugin: bool,
        cx: &mut Context<Self>,
    ) {
        if self.project_pages.task.is_some() {
            return;
        }
        self.project_pages.mutating = true;
        let project = self.project_pages.project.clone();
        let request_project = project.clone();
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let work = cx.background_executor().spawn(async move {
            crate::backend::RUNTIME.block_on(async move {
                let backend = backend
                    .get_or_try_init(|| crate::backend::Backend::connect(profile))
                    .await?;
                backend.import_project_files(&project, paths, plugin).await
            })
        });
        self.project_pages.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                if s.project_pages.project != request_project {
                    return;
                }
                s.project_pages.task = None;
                s.project_pages.mutating = false;
                match result {
                    Ok(()) => s.reload_project_page(cx),
                    Err(e) => s.project_pages.error = Some(e.to_string()),
                };
                cx.notify();
            });
        }));
        cx.notify();
    }
}
