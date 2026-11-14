use super::*;
use crate::icons;
use crate::ui::icon;
use rune::Phase;

fn load_thumbnail(path: &std::path::Path) -> anyhow::Result<(u32, u32, Vec<u8>)> {
    let image = image::open(path)?.thumbnail(1024, 1024).to_rgba8();
    Ok((image.width(), image.height(), image.into_raw()))
}

impl Workspace {
    pub(super) fn search_project_memory(&mut self) {
        let query_text = self.project_pages.text("search");
        self.project_pages.query_task = None;
        self.project_pages.matches = None;
        if query_text.trim().is_empty() {
            return;
        }
        let project = self.project_pages.project.clone();
        let backend = self.backend.clone();
        self.project_pages.query_task = Some(crate::task::spawn(
            async move {
                tokio::time::sleep(std::time::Duration::from_millis(180)).await;
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
            },
            |s: &mut Workspace, result, _| match result {
                Ok(value) => {
                    s.project_pages.matches = Some(
                        list(&value["listing"], "hits")
                            .iter()
                            .map(|v| text(v, "id"))
                            .collect(),
                    )
                }
                Err(e) => s.project_pages.error = Some(e.to_string()),
            },
        ));
    }
    pub(super) fn load_memory(&mut self) {
        let project = self.project_pages.project.clone();
        let expected = project.clone();
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        self.project_pages.task = Some(crate::task::spawn(
            async move {
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
                let positions: HashMap<String, (f32, f32)> =
                    inferay_presentation::memory_graph::layout(input)
                        .into_iter()
                        .map(|(id, p)| (id, (p.x as f32, p.y as f32)))
                        .collect();
                Ok::<_, anyhow::Error>((graph, positions))
            },
            move |s: &mut Workspace, result, _| {
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
                }
            },
        ));
    }
    fn select_memory(&mut self, node: Value) {
        self.project_pages.selected = Some(text(&node, "id"));
        self.project_pages.detail = Value::Null;
        if node["kind"] == "note" {
            let path = query(
                "/api/memory/note",
                &[
                    ("projectId", &self.project_pages.project),
                    ("id", node["id"].as_str().unwrap_or("")),
                ],
            );
            self.project_request(path, None, "detail");
        }
        self.project_pages.image = None;
        self.project_pages.image_task = None;
        if node["kind"] == "image" {
            let document = self.memory_document(&node);
            let pixels = rune::Pixels::new();
            self.project_pages.image = Some((document.clone(), pixels.clone()));
            self.project_pages.image_task = Some(crate::task::background(
                move || load_thumbnail(&document).map(|(w, h, rgba)| pixels.set(w, h, rgba)),
                |s: &mut Workspace, _, _| s.project_pages.image_task = None,
            ));
        }
    }
    fn memory_document(&self, node: &Value) -> std::path::PathBuf {
        std::path::PathBuf::from(text(&self.project_pages.data, "root"))
            .join("projects")
            .join(&self.project_pages.project)
            .join(text(node, "path"))
    }
    fn continue_memory_chat(&mut self, node: Value) {
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
        self.project_pages.task = Some(crate::task::spawn(
            async move {
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
            },
            move |s: &mut Workspace, result, _| {
                if s.project_pages.project != expected {
                    return;
                }
                s.project_pages.task = None;
                match result {
                    Ok(draft) => {
                        s.add_chat();
                        let selected = s.selected;
                        s.conversations[selected].input.set_content(&draft);
                        s.create_chat(selected);
                        s.project_pages.page = None;
                        s.repository = false;
                    }
                    Err(e) => s.project_pages.error = Some(e.to_string()),
                }
            },
        ));
    }
    pub(super) fn fit_memory_graph(&mut self) {
        let state = &mut self.project_pages;
        if state.positions.is_empty() {
            state.zoom = 1.;
            state.pan = (0., 0.);
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
        let (width, height) = state.graph_bounds;
        state.zoom = ((width - 160.) / (max_x - min_x).max(1.))
            .min((height - 70.) / (max_y - min_y).max(1.))
            .clamp(0.2, 2.);
        state.pan = (
            -(min_x + max_x) * 0.5 * state.zoom,
            -(min_y + max_y) * 0.5 * state.zoom,
        );
    }
    pub(super) fn memory_page(&self) -> El {
        let state = &self.project_pages;
        let needle = state.text("search").to_lowercase();
        let all = list(&state.graph, "nodes");
        let nodes: Vec<&Value> = all
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
        let selected = all
            .iter()
            .find(|n| n["id"].as_str() == state.selected.as_deref());
        let mut categories = row().gap(ui(5.)).px(ui(12.));
        for (kind, title) in [
            ("all", "All"),
            ("note", "Text"),
            ("image", "Images"),
            ("file", "Files"),
            ("source", "Chats"),
        ] {
            let count = all
                .iter()
                .filter(|n| kind == "all" || n["kind"] == kind)
                .count();
            let label = format!("{title} {count}");
            let chip = if state.category == kind {
                filled_button(kind, &label, Ink::small(), 0xebebeb15)
            } else {
                button(kind, &label)
            };
            categories = categories
                .child(chip.on_press(move |s: &mut Workspace| s.project_pages.category = kind));
        }
        let mut page = col()
            .grow(1.)
            .min_h(0.)
            .min_w(0.)
            .child(
                row()
                    .gap(ui(8.))
                    .padding(ui(12.))
                    .child(col().grow(1.).min_w(0.).child(state.field("search")))
                    .child(
                        action("import-memory", "Add files")
                            .on_press_tx(|s: &mut Workspace, tx| s.pick_project_files(false, tx)),
                    )
                    .child(
                        action("new-memory-note", "New note").on_press(|s: &mut Workspace| {
                            s.project_pages.screen = "note";
                            for field in ["title", "body", "tags"] {
                                s.project_pages.set(field, "");
                            }
                        }),
                    ),
            )
            .child(categories);
        if state.screen == "note" {
            page = page.child(
                card()
                    .mx(ui(12.))
                    .my(ui(12.))
                    .child(state.field("title"))
                    .child(state.field("body"))
                    .child(state.field("tags"))
                    .child(action("save-memory-note", "Save note").on_press(|s: &mut Workspace| {
                        let state = &s.project_pages;
                        let body = json!({"projectId":state.project,"note":{"title":state.text("title"),"body":state.text("body"),"tags":state.text("tags").split(',').map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>()}});
                        s.project_request("/api/memory/save".into(), Some(body), "save-note");
                    })),
            );
        }
        if state.graph["truncated"] == true {
            page = page.child(
                label("Showing a limited view of project memory. Search to narrow the results.")
                    .px(ui(12.)),
            );
        }
        page.child(
            row()
                .grow(1.)
                .min_h(0.)
                .min_w(0.)
                .child(self.memory_graph(&nodes))
                .child(self.memory_detail(selected)),
        )
    }
    fn memory_graph(&self, nodes: &[&Value]) -> El {
        let state = &self.project_pages;
        let (pan, zoom) = (state.pan, state.zoom);
        let visible: HashSet<String> = nodes.iter().map(|n| text(n, "id")).collect();
        let (width, height) = state.graph_bounds;
        let center = (width / 2. + pan.0, height / 2. + pan.1);
        let mut shape = rune::Shape::new();
        for edge in list(&state.graph, "edges") {
            let from = text(edge, "from");
            let to = text(edge, "to");
            if !visible.contains(&from) || !visible.contains(&to) {
                continue;
            }
            if let (Some(a), Some(b)) = (state.positions.get(&from), state.positions.get(&to)) {
                shape = shape.line(
                    [center.0 + a.0 * zoom, center.1 + a.1 * zoom],
                    [center.0 + b.0 * zoom, center.1 + b.1 * zoom],
                    1.,
                    rune::LineCap::Butt,
                    rgba(0x8ab4f82b),
                );
            }
        }
        let mut origin = el().w(0.).h(0.);
        for node in nodes {
            let Some(&(x, y)) = state.positions.get(&text(node, "id")) else {
                continue;
            };
            let chosen = state.selected.as_deref() == node["id"].as_str();
            let item = (*node).clone();
            let glyph = match node["kind"].as_str() {
                Some("image") | Some("file") => &icons::FOLDER,
                _ => &icons::BOOKMARK,
            };
            origin = origin.child(
                border(
                    filled_button(
                        format!("memory-{}", node["id"]),
                        "",
                        Ink::small(),
                        (colors::RAISED << 8) | 0xff,
                    )
                    .w(ui(130.))
                    .h(ui(32.)),
                    if chosen { 0x8ab4f8ff } else { 0xebebeb20 },
                )
                .pin(
                    Some(x * zoom + pan.0 - ui(65.)),
                    Some(y * zoom + pan.1 - ui(16.)),
                    None,
                    None,
                )
                .child(icon(glyph))
                .child(Ink::small().line_text(text(node, "title")).shrink())
                .on_press(move |s: &mut Workspace| s.select_memory(item.clone())),
            );
        }
        let mut graph = col()
            .key("memory-graph")
            .grow(1.)
            .min_w(0.)
            .clip_rounded(0.)
            .on_layout(|s: &mut Workspace, rect| {
                let size = (rect[2], rect[3]);
                if s.project_pages.graph_bounds != size {
                    s.project_pages.graph_bounds = size;
                }
            })
            .on_drag(|s: &mut Workspace, drag, _| {
                if drag.phase == Phase::Down {
                    s.project_pages.drag = Some(s.project_pages.pan);
                }
                if let Some(start) = s.project_pages.drag {
                    s.project_pages.pan = (start.0 + drag.dx, start.1 + drag.dy);
                }
                if matches!(drag.phase, Phase::Up) {
                    s.project_pages.drag = None;
                }
            })
            .on_wheel(|s: &mut Workspace, event, _| {
                s.project_pages.zoom =
                    (s.project_pages.zoom * (1. + event.dy * 0.002)).clamp(0.2, 3.);
                true
            })
            .on_drop_files(|s: &mut Workspace, paths, _| {
                s.import_project_paths(paths.to_vec(), false)
            })
            .child(
                rune::canvas(shape)
                    .pin(Some(0.), Some(0.), Some(0.), Some(0.))
                    .inert(),
            )
            .child(
                row()
                    .pin(Some(0.), Some(0.), Some(0.), Some(0.))
                    .items_center()
                    .justify_center()
                    .child(origin),
            );
        if nodes.is_empty() {
            graph = graph.child(col().padding(ui(40.)).child(body(
                "Drop files here or save a note from chat to build your project memory.",
            )));
        }
        graph.child(
            row()
                .pin(Some(ui(12.)), None, None, Some(ui(12.)))
                .gap(ui(6.))
                .child(
                    button("memory-zoom-out", "−").on_press(|s: &mut Workspace| {
                        s.project_pages.zoom = (s.project_pages.zoom / 1.2).max(0.2)
                    }),
                )
                .child(
                    button("memory-fit", "Fit view")
                        .on_press(|s: &mut Workspace| s.fit_memory_graph()),
                )
                .child(button("memory-zoom-in", "+").on_press(|s: &mut Workspace| {
                    s.project_pages.zoom = (s.project_pages.zoom * 1.2).min(3.)
                })),
        )
    }
    fn memory_detail(&self, selected: Option<&Value>) -> El {
        let state = &self.project_pages;
        let mut detail = side_border(
            col()
                .key("memory-detail")
                .w(ui(300.))
                .min_h(0.)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .padding(ui(20.))
                .gap(ui(14.)),
            [0., 0., 0., 1.],
            0xebebeb14,
        );
        let Some(node) = selected else {
            return detail.child(label("Select anything on the graph to see it here."));
        };
        let node = node.clone();
        let document = self.memory_document(&node);
        let source = text(&node, "source");
        let request = json!({"endpoint":"/api/memory/delete","body":{"projectId":state.project,"id":if node["kind"]=="note"{node["id"].clone()}else{Value::Null},"path":if node["kind"]!="note"{node["path"].clone()}else{Value::Null}}});
        detail = detail
            .child(Ink::new(18.).weight(SEMIBOLD).text(text(&node, "title")))
            .child(label(format!(
                "{} · {}",
                text(&node, "kind"),
                text(&node, "created")
            )))
            .child(body(text(&state.detail["note"], "body")));
        if node["kind"] == "image"
            && let Some((path, pixels)) = &state.image
            && *path == document
        {
            let (w, h) = pixels.size();
            let mut image = el()
                .w_full()
                .max_h(ui(240.))
                .pixels_fit(pixels, rune::SurfaceFit::Fit);
            if w > 0 && h > 0 {
                image = image.aspect_ratio(w as f32 / h as f32);
            }
            detail = detail.child(image);
        }
        if node["kind"] == "file" || node["kind"] == "image" {
            detail = detail
                .child(label(format!(
                    "{} bytes",
                    node["size"].as_u64().unwrap_or(0)
                )))
                .child(action("open-memory-file", "Open file").on_press(
                    move |_: &mut Workspace| {
                        let _ = std::process::Command::new("open").arg(&document).spawn();
                    },
                ));
        }
        detail = detail.child(label(
            list(&node, "tags")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" · "),
        ));
        let pane = source.trim_start_matches("chat:").to_owned();
        if node["kind"] == "source"
            && source.starts_with("chat:")
            && self
                .conversations
                .iter()
                .any(|c| !c.closed && c.pane.as_deref() == Some(pane.as_str()))
        {
            detail = detail.child(action("open-memory-chat", "Open chat").on_press_tx(
                move |s: &mut Workspace, tx| {
                    s.project_pages.page = None;
                    s.restore_run_chat(pane.clone(), tx);
                },
            ));
        }
        if node["kind"] == "source" {
            let selected = node.clone();
            detail = detail.child(
                action("continue-memory-chat", "Continue with memories")
                    .on_press(move |s: &mut Workspace| s.continue_memory_chat(selected.clone())),
            );
        } else {
            detail = detail.child(
                button_ink("delete-memory", "Delete", Ink::small().color(rgb(0xf0a0a0))).on_press(
                    move |s: &mut Workspace| {
                        s.project_pages.confirmation =
                            Some(("Delete this memory item?".into(), request.clone()))
                    },
                ),
            );
        }
        detail = detail.child(label("Related"));
        for edge in list(&state.graph, "edges") {
            let other = if edge["from"] == node["id"] {
                &edge["to"]
            } else if edge["to"] == node["id"] {
                &edge["from"]
            } else {
                continue;
            };
            let Some(other) = list(&state.graph, "nodes")
                .iter()
                .find(|n| n["id"] == *other)
                .cloned()
            else {
                continue;
            };
            detail = detail.child(
                button(format!("related-{}", other["id"]), &text(&other, "title"))
                    .on_press(move |s: &mut Workspace| s.select_memory(other.clone())),
            );
        }
        detail
    }
}
