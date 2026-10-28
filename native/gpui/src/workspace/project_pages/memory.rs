use super::*;
impl WorkspaceView {
    pub(super) fn search_project_memory(&mut self, cx: &mut Context<Self>) {
        let query_text = self.project_pages.text("search", cx);
        self.project_pages.query_task = None;
        self.project_pages.matches = None;
        if query_text.trim().is_empty() {
            return;
        }
        let project = self.project_pages.project.clone();
        let backend = self.backend.clone();
        self.project_pages.query_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(180))
                .await;
            let work = cx.background_executor().spawn(async move {
                crate::backend::RUNTIME.block_on(async move {
                    let backend = backend
                        .get()
                        .ok_or_else(|| anyhow::anyhow!("Project services are still loading"))?;
                    backend
                        .request(
                            Method::GET,
                            &query(
                                "/api/memory",
                                &[
                                    ("projectId", &project),
                                    ("q", &query_text),
                                    ("limit", "200"),
                                ],
                            ),
                            None,
                        )
                        .await
                })
            });
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                match result {
                    Ok(value) => {
                        s.project_pages.matches = Some(
                            list(&value["listing"], "hits")
                                .iter()
                                .map(|v| text(v, "id"))
                                .collect(),
                        )
                    }
                    Err(e) => s.project_pages.error = Some(e.to_string()),
                };
                cx.notify();
            });
        }));
    }
    pub(super) fn load_memory(&mut self, cx: &mut Context<Self>) {
        let project = self.project_pages.project.clone();
        let expected = project.clone();
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        let work = cx.background_executor().spawn(async move {
            crate::backend::RUNTIME.block_on(async move {
                let backend = backend
                    .get_or_try_init(|| crate::backend::Backend::connect(profile))
                    .await?;
                let graph = backend
                    .request(
                        Method::GET,
                        &query("/api/memory/graph", &[("projectId", &project)]),
                        None,
                    )
                    .await?;
                let input: inferay_presentation::memory_graph::MemoryGraphLayout =
                    serde_json::from_value(graph.clone())?;
                let positions = inferay_presentation::memory_graph::layout(input)
                    .into_iter()
                    .map(|(id, p)| (id, (p.x as f32, p.y as f32)))
                    .collect();
                Ok::<_, anyhow::Error>((graph, positions))
            })
        });
        self.project_pages.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                if s.project_pages.project != expected {
                    return;
                }
                s.project_pages.task = None;
                match result {
                    Ok((graph, positions)) => {
                        s.project_pages.graph = graph;
                        s.project_pages.positions = positions;
                    }
                    Err(e) => s.project_pages.error = Some(e.to_string()),
                };
                cx.notify();
            });
        }));
    }
    fn select_memory(&mut self, node: Value, cx: &mut Context<Self>) {
        self.project_pages.selected = Some(text(&node, "id"));
        self.project_pages.detail = Value::Null;
        if node["kind"] == "note" {
            self.project_request(
                query(
                    "/api/memory/note",
                    &[
                        ("projectId", &self.project_pages.project),
                        ("id", node["id"].as_str().unwrap_or("")),
                    ],
                ),
                None,
                "detail",
                cx,
            );
        }
        cx.notify();
    }
    fn continue_memory_chat(&mut self, node: Value, cx: &mut Context<Self>) {
        let state = &self.project_pages;
        if state.task.is_some() {
            return;
        }
        let related: Vec<Value> = list(&state.graph, "edges")
            .iter()
            .filter(|edge| edge["to"] == node["id"])
            .filter_map(|edge| {
                list(&state.graph, "nodes")
                    .iter()
                    .find(|n| n["id"] == edge["from"])
                    .cloned()
            })
            .collect();
        let backend = self.backend.clone();
        let project = state.project.clone();
        let expected = project.clone();
        let work = cx.background_executor().spawn(async move {
            crate::backend::RUNTIME.block_on(async move {
                let backend = backend
                    .get()
                    .ok_or_else(|| anyhow::anyhow!("Project services are loading"))?;
                let mut draft = format!(
                    "Continue the work from {} using these project memories.\n",
                    text(&node, "title")
                );
                for item in related.iter().filter(|n| n["kind"] == "note").take(8) {
                    let note = backend
                        .request(
                            Method::GET,
                            &query(
                                "/api/memory/note",
                                &[
                                    ("projectId", &project),
                                    ("id", item["id"].as_str().unwrap_or("")),
                                ],
                            ),
                            None,
                        )
                        .await?;
                    draft.push_str(&format!(
                        "\n### {}\n{}\n",
                        text(item, "title"),
                        text(&note["note"], "body")
                            .chars()
                            .take(3000)
                            .collect::<String>()
                    ));
                }
                for item in related
                    .iter()
                    .filter(|n| n["kind"] == "file" || n["kind"] == "image")
                {
                    draft.push_str(&format!("\nRelated file: {}", text(item, "path")));
                }
                Ok::<_, anyhow::Error>(draft)
            })
        });
        self.project_pages.task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                if s.project_pages.project != expected {
                    return;
                }
                s.project_pages.task = None;
                match result {
                    Ok(draft) => {
                        s.add_chat(cx);
                        s.conversations[s.selected]
                            .input
                            .update(cx, |input, cx| input.set_content(&draft, cx));
                        s.create_chat(s.selected, cx);
                        s.project_pages.page = None;
                        s.repository = false;
                    }
                    Err(e) => s.project_pages.error = Some(e.to_string()),
                };
                cx.notify();
            });
        }));
    }
    fn fit_memory_graph(&mut self) {
        let state = &mut self.project_pages;
        if state.positions.is_empty() {
            state.zoom = 1.;
            state.pan = point(px(0.), px(0.));
            return;
        }
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (
            f32::INFINITY,
            f32::INFINITY,
            f32::NEG_INFINITY,
            f32::NEG_INFINITY,
        );
        for &(x, y) in state.positions.values() {
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
        let bounds = state.graph_bounds.get();
        state.zoom = ((f32::from(bounds.size.width) - 160.) / (max_x - min_x).max(1.))
            .min((f32::from(bounds.size.height) - 70.) / (max_y - min_y).max(1.))
            .clamp(0.2, 2.);
        state.pan = point(
            px(-(min_x + max_x) * 0.5 * state.zoom),
            px(-(min_y + max_y) * 0.5 * state.zoom),
        );
    }
    pub(super) fn memory_page(&self, cx: &mut Context<Self>) -> AnyElement {
        let state = &self.project_pages;
        let needle = state.text("search", cx).to_lowercase();
        let nodes: Vec<_> = list(&state.graph, "nodes")
            .iter()
            .filter(|n| {
                (state.category == "all" || n["kind"] == state.category)
                    && (needle.is_empty()
                        || state
                            .matches
                            .as_ref()
                            .is_some_and(|ids| ids.contains(&text(n, "id")))
                        || format!("{} {}", text(n, "title"), n["tags"])
                            .to_lowercase()
                            .contains(&needle))
            })
            .collect();
        let selected = list(&state.graph, "nodes")
            .iter()
            .find(|n| n["id"].as_str() == state.selected.as_deref());
        let edges = list(&state.graph, "edges").to_vec();
        let positions = state.positions.clone();
        let measured = state.graph_bounds.clone();
        let pan = state.pan;
        let zoom = state.zoom;
        let visible: HashSet<String> = nodes.iter().map(|n| text(n, "id")).collect();
        div().flex().flex_col().flex_1().min_h_0().min_w_0()
            .child(div().flex().gap(ui(8.)).p(ui(12.)).child(div().flex_1().child(state.field("search")))
                .child(action("import-memory","Add files").on_click(cx.listener(|s,_,window,cx|s.pick_project_files(false,window,cx))))
                .child(action("new-memory-note","New note").on_click(cx.listener(|s,_,_,cx|{s.project_pages.screen="note";s.project_pages.set("title","",cx);s.project_pages.set("body","",cx);s.project_pages.set("tags","",cx);cx.notify();}))))
            .child(div().flex().gap(ui(5.)).px(ui(12.)).children([("all","All"),("note","Text"),("image","Images"),("file","Files"),("source","Chats")].into_iter().map(|(kind,title)|button(kind,format!("{} {}",title,list(&state.graph,"nodes").iter().filter(|n|kind=="all" || n["kind"]==kind).count())).when(state.category==kind,|d|d.bg(rgba(0xebebeb15))).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.category=kind;cx.notify();})))))
            .when(state.screen=="note",|d|d.child(card().m(ui(12.)).child(state.field("title")).child(state.field("body")).child(state.field("tags"))
                .child(action("save-memory-note","Save note").on_click(cx.listener(|s,_,_,cx| {
                    let body=json!({"projectId":s.project_pages.project,"note":{"title":s.project_pages.text("title",cx),"body":s.project_pages.text("body",cx),"tags":s.project_pages.text("tags",cx).split(',').map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>()}});
                    s.project_request("/api/memory/save".into(),Some(body),"save-note",cx);
                })))) )
            .when(state.graph["truncated"]==true,|d|d.child(label("Showing a limited view of project memory. Search to narrow the results.").px(ui(12.))))
            .child(div().flex().flex_1().min_h_0().min_w_0()
                .child(div().id("memory-graph").debug_selector(||"memory-graph".into()).relative().flex_1().min_w_0().overflow_hidden()
                    .on_mouse_down(MouseButton::Left,cx.listener(|s,event:&MouseDownEvent,_,cx|{s.project_pages.drag=Some((event.position,s.project_pages.pan));cx.notify();}))
                    .on_mouse_move(cx.listener(|s,event:&MouseMoveEvent,_,cx|{if let Some((start,pan))=s.project_pages.drag{s.project_pages.pan=pan+event.position-start;cx.notify();}}))
                    .on_mouse_up(MouseButton::Left,cx.listener(|s,_,_,_|s.project_pages.drag=None))
                    .on_mouse_up_out(MouseButton::Left,cx.listener(|s,_,_,_|s.project_pages.drag=None))
                    .on_scroll_wheel(cx.listener(|s,event:&ScrollWheelEvent,_,cx| {let delta=event.delta.pixel_delta(px(16.));s.project_pages.zoom=(s.project_pages.zoom*(1.+f32::from(delta.y)*0.002)).clamp(0.2,3.);cx.notify();}))
                    .on_drop(cx.listener(|s,paths:&ExternalPaths,_,cx|s.import_project_paths(paths.paths().to_vec(),false,cx)))
                    .child(canvas(move |bounds,_,_|{measured.set(bounds);bounds},move |bounds,_,window,_| {
                        for edge in &edges {let from=text(edge,"from");let to=text(edge,"to");if !visible.contains(&from)||!visible.contains(&to){continue;}
                            if let (Some(a),Some(b))=(positions.get(&from),positions.get(&to)) {let mut path=PathBuilder::stroke(px(1.));let center=bounds.center()+pan;path.move_to(center+point(px(a.0*zoom),px(a.1*zoom)));path.line_to(center+point(px(b.0*zoom),px(b.1*zoom)));if let Ok(path)=path.build(){window.paint_path(path,rgba(0x8ab4f82b));}}
                        }
                    }).absolute().size_full())
                    .children(nodes.iter().filter_map(|node|state.positions.get(&text(node,"id")).map(|&(x,y)|{
                        let node=(*node).clone();let chosen=state.selected.as_deref()==node["id"].as_str();let item=node.clone();
                        div().absolute().left(relative(0.5)).top(relative(0.5)).ml(px(x*zoom)+pan.x).mt(px(y*zoom)+pan.y).child(
                            action(SharedString::from(format!("memory-{}",node["id"])),"").ml(-ui(65.)).mt(-ui(16.)).w(ui(130.)).h(ui(32.)).bg(rgb(0x252525)).when(chosen,|d|d.border_color(rgb(0x8ab4f8))).child(icon(match node["kind"].as_str(){Some("source")=>"Bookmark",Some("image")=>"Folder",Some("file")=>"Folder",_=>"Bookmark"})).child(div().text_ellipsis().child(text(&node,"title")))
                                .on_mouse_down(MouseButton::Left,|_,window,cx|{window.prevent_default();cx.stop_propagation();})
                                .on_click(cx.listener(move |s,_,_,cx|s.select_memory(item.clone(),cx)))
                        )
                    })))
                    .when(nodes.is_empty(),|d|d.child(div().p(ui(40.)).child("Drop files here or save a note from chat to build your project memory.")))
                    .child(div().absolute().bottom(ui(12.)).left(ui(12.)).flex().gap(ui(6.)).child(button("memory-zoom-out","−").on_click(cx.listener(|s,_,_,cx|{s.project_pages.zoom=(s.project_pages.zoom/1.2).max(0.2);cx.notify();}))).child(button("memory-fit","Fit view").on_click(cx.listener(|s,_,_,cx|{s.fit_memory_graph();cx.notify();}))).child(button("memory-zoom-in","+").on_click(cx.listener(|s,_,_,cx|{s.project_pages.zoom=(s.project_pages.zoom*1.2).min(3.);cx.notify();})))))
                .child(div().id("memory-detail").w(ui(300.)).flex_shrink_0().overflow_y_scroll().p(ui(20.)).border_l_1().border_color(rgba(0xebebeb14)).flex().flex_col().gap(ui(14.))
                    .when(selected.is_none(),|d|d.child(label("Select anything on the graph to see it here.")))
                    .when_some(selected,|d,node| {
                        let node=node.clone();let document=std::path::PathBuf::from(text(&state.data,"root")).join("projects").join(&state.project).join(text(&node,"path"));let open_document=document.clone();let source=text(&node,"source");let request=json!({"endpoint":"/api/memory/delete","body":{"projectId":state.project,"id":if node["kind"]=="note"{node["id"].clone()}else{Value::Null},"path":if node["kind"]!="note"{node["path"].clone()}else{Value::Null}}});
                        d.child(div().text_size(ui(18.)).font_weight(FontWeight::SEMIBOLD).child(text(&node,"title")))
                            .child(label(format!("{} · {}",text(&node,"kind"),text(&node,"created"))))
                            .child(text(&state.detail["note"],"body"))
                            .when(node["kind"]=="image",|d|d.child(img(document.clone()).w_full().max_h(ui(240.)).object_fit(ObjectFit::Contain)))
                            .when(node["kind"]=="file" || node["kind"]=="image",|d|d.child(label(format!("{} bytes",node["size"].as_u64().unwrap_or(0)))).child(action("open-memory-file","Open file").on_click(move |_,_,cx|{if let Ok(url)=url::Url::from_file_path(&open_document){cx.open_url(url.as_str());}})))
                            .child(label(list(&node,"tags").iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" · ")))
                            .when(node["kind"]=="source" && source.starts_with("chat:") && self.conversations.iter().any(|c|!c.closed && c.pane.as_deref()==Some(source.trim_start_matches("chat:"))),|d|d.child(action("open-memory-chat","Open chat").on_click(cx.listener(move |s,_,_,cx|{s.project_pages.page=None;s.restore_run_chat(source.trim_start_matches("chat:").to_owned(),cx);}))))
                            .when(node["kind"]=="source",|d|{let selected=node.clone();d.child(action("continue-memory-chat","Continue with memories").on_click(cx.listener(move |s,_,_,cx|s.continue_memory_chat(selected.clone(),cx))))})
                            .when(node["kind"]!="source",|d|d.child(button("delete-memory","Delete").text_color(rgb(0xf0a0a0)).on_click(cx.listener(move |s,_,_,cx|{s.project_pages.confirmation=Some(("Delete this memory item?".into(),request.clone()));cx.notify();}))))
                            .child(label("Related"))
                            .children(list(&state.graph,"edges").iter().filter_map(|edge|{let other=if edge["from"]==node["id"]{&edge["to"]}else if edge["to"]==node["id"]{&edge["from"]}else{return None;};list(&state.graph,"nodes").iter().find(|n|n["id"]==*other).cloned()}).map(|other|{let title=text(&other,"title");button(SharedString::from(format!("related-{}",other["id"])),title).on_click(cx.listener(move |s,_,_,cx|s.select_memory(other.clone(),cx)))}))
                    })))
            .into_any_element()
    }
}
