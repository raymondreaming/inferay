use super::*;
use crate::zoom::ui;

#[derive(Clone)]
pub(super) struct BranchDrag {
    pub(super) cwd: String,
    pub(super) name: String,
}

impl Render for BranchDrag {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .px(ui(8.))
            .py(ui(4.))
            .bg(rgb(0x29384d))
            .text_color(rgb(0xffffff))
            .child(self.name.trim_start_matches("refs/remotes/").to_owned())
    }
}

struct RefTooltip(GitGraphRef);
impl Render for RefTooltip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let reference = &self.0;
        div()
            .p(ui(8.))
            .rounded(ui(4.))
            .bg(rgb(colors::SHELL))
            .text_size(ui(11.))
            .text_color(rgb(0xffffff))
            .child(format!(
                "{}{}{}",
                reference.full_name,
                if reference.is_head {
                    " · checked out"
                } else {
                    ""
                },
                reference
                    .upstream
                    .as_ref()
                    .map(|upstream| format!(" · tracks {upstream}"))
                    .unwrap_or_default()
            ))
    }
}

impl RepositoryView {
    pub(super) fn open_branch_menu(
        &mut self,
        source: String,
        target: String,
        cx: &mut Context<Self>,
    ) {
        if self.mutating || source == target {
            return;
        }
        self.branch_menu = None;
        self.git_menu = None;
        let cwd = self.cwd.clone();
        let work = cx.background_executor().spawn(async move {
            inferay_native_diff::preflight_git_ref_operation(&cwd, &source, &target)
        });
        self.branch_menu_task = Some(cx.spawn(async move |this, cx| {
            let menu = work.await;
            let _ = this.update(cx, |s, cx| {
                s.branch_menu = Some(menu);
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn branch_menu(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let menu = self.branch_menu.as_ref().unwrap();
        let source = menu.source.trim_start_matches("refs/remotes/");
        let target = menu.target.trim_start_matches("refs/remotes/");
        let local_destination = |reference: &str| {
            reference
                .strip_prefix("refs/remotes/")
                .and_then(|remote| remote.split_once('/'))
                .map_or_else(
                    || reference.to_owned(),
                    |(_, branch)| format!("local {branch}"),
                )
        };
        let popup = crate::menu_surface("branch-operation-menu")
            .relative()
            .debug_selector(|| "branch-operation-menu".into())
            .w(ui(360.))
            .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                s.branch_menu = None;
                cx.notify();
            }))
            .children(
                [
                    (
                        "merge",
                        format!("Merge {source} into {}", local_destination(&menu.target)),
                        menu.can_merge,
                    ),
                    (
                        "fastForward",
                        format!("Fast-forward {} to {source}", local_destination(&menu.target)),
                        menu.can_fast_forward,
                    ),
                    (
                        "rebase",
                        format!("Rebase {} onto {target}", local_destination(&menu.source)),
                        menu.can_rebase,
                    ),
                ]
                .into_iter()
                .map(|(operation, label, enabled)| {
                    let source = menu.source.clone();
                    let target = menu.target.clone();
                    button(operation, "")
                        .aria_label(label.clone())
                        .w_full()
                        .h_auto()
                        .min_h(ui(28.))
                        .py(ui(5.))
                        .debug_selector(move || format!("branch-operation-{operation}"))
                        .child(div().flex_1().min_w_0().line_height(ui(17.)).child(label))
                        .when(!enabled, |d| d.opacity(0.4))
                        .on_click(cx.listener(move |s, _, _, cx| {
                            if enabled {
                                s.run_branch_action(operation, source.clone(), target.clone(), cx);
                            }
                        }))
                }),
            )
            .when(menu.source.starts_with("refs/remotes/") || menu.target.starts_with("refs/remotes/"), |d| {
                d.child(div().px(ui(8.)).py(ui(4.)).text_size(ui(11.)).child(
                    "Remote destinations use a local tracking branch, creating it if needed. Nothing is pushed."
                ))
            })
            .children(menu.reasons.iter().map(|reason| {
                div()
                    .px(ui(8.))
                    .py(ui(4.))
                    .text_size(ui(11.))
                    .child(reason.clone())
            }));
        deferred(
            anchored()
                .position(self.branch_menu_position)
                .snap_to_window()
                .child(popup),
        )
        .with_priority(2)
    }

    pub(super) fn column_menu(&self, cx: &mut Context<Self>) -> impl IntoElement {
        crate::menu_surface("graph-column-menu")
            .top(ui(32.))
            .right(ui(8.))
            .w(ui(200.))
            .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                s.columns_menu = false;
                cx.notify();
            }))
            .child(
                div()
                    .px(ui(9.))
                    .py(ui(6.))
                    .text_size(ui(11.))
                    .text_color(rgba(0xebebeb80))
                    .child("Show columns"),
            )
            .children(
                [
                    ("date", "Date"),
                    ("refs", "Branch"),
                    ("graph", "Graph"),
                    ("message", "Message"),
                    ("author", "Author"),
                    ("sha", "SHA"),
                ]
                .into_iter()
                .map(|(key, label)| {
                    let visible = self.preferences["columns"][key].as_bool().unwrap_or(true);
                    button(SharedString::from(format!("column-{key}")), "")
                        .aria_label(format!("{} {label}", if visible { "Hide" } else { "Show" }))
                        .debug_selector(move || format!("column-{key}"))
                        .child(div().w(ui(16.)).child(if visible { "✓" } else { "" }))
                        .child(label)
                        .on_click(cx.listener(move |s, _, _, cx| {
                            let visible = s.preferences["columns"][key].as_bool().unwrap_or(true);
                            if visible
                                && s.preferences["columns"].as_object().is_some_and(|columns| {
                                    columns.values().filter(|v| **v == true).count() == 1
                                })
                            {
                                return;
                            }
                            s.preferences["columns"][key] = json!(!visible);
                            cx.emit(RepositoryEvent::GraphPreferences(s.preferences.clone()));
                            cx.notify();
                        }))
                }),
            )
    }

    pub(super) fn graph_table(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut input = self.preferences.clone();
        input["maxColumn"] = self.presentation["maxColumn"].clone();
        input["pinnedColumns"] = self.presentation["pinnedColumns"].clone();
        input["availableWidth"] = json!(self.viewport_width());
        input["stretch"] = json!(true);
        input["toolsWidth"] = json!(0);
        input["count"] = json!(self.graph.commits.len());
        let layout = inferay_presentation::graph::layout(&input);
        let order: Vec<String> = layout["visibleOrder"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect();
        let compact = layout["compact"] == true;
        let widths = layout["columnWidths"].clone();
        let display = layout["displayColumns"].clone();
        let graph_left = layout["graphLeft"].as_f64().unwrap_or(0.) as f32;
        let graph_width = layout["graphWidth"].as_f64().unwrap_or(96.) as f32;
        let image_width =
            27. + (self.presentation["maxColumn"].as_u64().unwrap_or(0) + 2) as f32 * 18.;
        let width = layout["tableWidth"].as_f64().unwrap_or(584.) as f32;
        div()
            .id("history-table")
            .on_mouse_down(MouseButton::Left, cx.listener(|s, _, _, _| s.keyboard_scope = "graph"))
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .flex()
            .flex_col()
            .child(
                div()
                    .w(ui(width))
                    .ml(self.graph_scroll.0.borrow().base_handle.offset().x)
                    .h(ui(23.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .text_size(ui(9.))
                    .line_height(ui(12.))
                    .text_color(rgba(0xebebeb70))
                    .children(order.iter().map(|column| {
                        let width = widths[column].as_f64().unwrap_or(100.) as f32;
                        let key = column.clone();
                        let resizing = self.column_resize.as_ref().is_some_and(|(active,_,_,_)| active == column);
                        div().relative().h_full().flex().items_center()
                            .w(ui(width)).px(ui(8.)).flex_shrink_0()
                            .child(match column.as_str() { "refs" => "BRANCH".into(), _ => column.to_uppercase() })
                            .child(div().id(SharedString::from(format!("resize-column-{column}")))
                                .debug_selector({ let key=key.clone(); move || format!("resize-column-{key}") })
                                .absolute().right_0().top_0().h_full().w(ui(7.)).cursor_col_resize()
                                .border_r_1().border_color(rgba(0xebebeb30))
                                .when(resizing, |d| d.bg(rgba(0x8ab4f850)))
                                .hover(|s| s.bg(rgba(0x8ab4f840)))
                                .on_mouse_down(MouseButton::Left,cx.listener(move |s,event:&MouseDownEvent,window,cx| {
                                    window.prevent_default(); cx.stop_propagation();
                                    s.column_resize=Some((key.clone(),event.position.x,width,compact)); cx.notify();
                                })))
                    })),
            )
            .child(
                uniform_list(
                    "commit-history",
                    self.graph.commits.len(),
                    cx.processor(move |s, range: std::ops::Range<usize>, _, cx| {
                        range
                            .map(|index| {
                                let commit = &s.graph.commits[index];
                                let context_hash = commit.hash.clone();
                                let context_refs = commit.refs.clone();
                                let is_commit = commit.item_kind == GitGraphItemKind::Commit;
                                let selected =
                                    s.selected_item.as_deref() == Some(commit.id.as_str());
                                let active = selected || s.hovered == Some(index);
                                let lane = colors::GRAPH_LANES
                                    [commit.color_index % colors::GRAPH_LANES.len()];
                                let tint = u32::from_str_radix(&lane[1..], 16).unwrap();
                                let center = 27.
                                    + display[commit.column]
                                        .as_f64()
                                        .unwrap_or(commit.column as f64)
                                        as f32
                                        * 18.;
                                let hidden = s.preferences["hiddenRefs"]
                                    .as_array()
                                    .cloned()
                                    .unwrap_or_default();
                                let mut refs: Vec<_> = commit
                                    .refs
                                    .iter()
                                    .filter(|r| {
                                        !hidden.iter().any(|v| v.as_str() == Some(&r.full_name))
                                    })
                                    .collect();
                                refs.sort_by_key(|r| {
                                    !s.preferences["pinnedRefs"].as_array().is_some_and(|pins| {
                                        pins.iter().any(|v| v.as_str() == Some(&r.full_name))
                                    })
                                });
                                if commit.item_kind != GitGraphItemKind::Commit {
                                    refs.clear();
                                }
                                let ghost: Option<GitGraphRef> = if refs.is_empty() && active && commit.item_kind == GitGraphItemKind::Commit {
                                    commit.navigation.containing_branch.as_ref().and_then(|name| serde_json::from_value(s.presentation["references"][name].clone()).ok()).filter(|r: &GitGraphRef| !hidden.iter().any(|v| v.as_str() == Some(&r.full_name)))
                                } else { None };
                                let ghost_visible = ghost.is_some();
                                if let Some(reference) = &ghost { refs.push(reference); }
                                let has_connector = !refs.is_empty();
                                let dashed = commit.item_kind != GitGraphItemKind::Commit;
                                div()
                                    .id(("commit", index))
                                    .role(Role::Button)
                                    .aria_label(if commit.item_kind == GitGraphItemKind::WorktreeWip { format!("{} — {}", commit.message, commit.worktree_path.as_deref().unwrap_or("")) } else { commit.message.clone() })
                                    .relative()
                                    .w(ui(width))
                                    .h(ui(23.))
                                    .flex()
                                    .items_center()
                                    .text_size(ui(colors::CHAT_SMALL))
                                    .cursor_pointer()
                                    .when(
                                        (commit.item_kind != GitGraphItemKind::WorktreeWip
                                            || active) && s.preferences["columns"]["graph"] != false,
                                        |d| {
                                            d.child(
                                                div()
                                                    .absolute()
                                                    .left(ui(graph_left + center))
                                                    .top_0()
                                                    .h(ui(23.))
                                                    .w(ui(if active {
                                                        width - graph_left - center
                                                    } else {
                                                        graph_width - center
                                                    }
                                                    .max(0.)))
                                                    .bg(rgba(
                                                        (tint << 8)
                                                            | if active { 107 } else { 26 },
                                                    )),
                                            )
                                        },
                                    )
                                    .on_hover(cx.listener(move |s, hovered: &bool, _, cx| {
                                        let next = if *hovered { Some(index) } else if s.hovered == Some(index) { None } else { s.hovered };
                                        if next != s.hovered { s.hovered = next; cx.notify(); }
                                    }))
                                    .children(order.iter().map(|column| {
                                        let w = widths[column].as_f64().unwrap_or(100.) as f32;
                                        let cell = div()
                                            .relative()
                                            .w(ui(w))
                                            .h(ui(23.))
                                            .flex_shrink_0()
                                            .flex()
                                            .items_center();
                                        match column.as_str() {
                                            "graph" => cell
                                                .overflow_hidden()
                                                .when(has_connector, |d| {
                                                    d.child(
                                                        div()
                                                            .absolute()
                                                            .left_0()
                                                            .top(ui(11.))
                                                            .w(ui(center))
                                                            .h(ui(1.))
                                                            .child(connector(tint, dashed)),
                                                    )
                                                })
                                                .child(
                                                    div().when_some(s.graph_render_images.get(index).cloned().flatten(), |d, image| d.child(img(image).size_full()))
                                                        .w(ui(image_width))
                                                        .h(ui(23.))
                                                        .flex_shrink_0(),
                                                )
                                                .when(
                                                    commit.item_kind == GitGraphItemKind::Commit
                                                        && commit.parents.len() <= 1,
                                                    |d| {
                                                        d.child(div().absolute().left(ui(center - 7.)).top(ui(4.5))
                                                            .child(s.author_avatar(&commit.hash, &commit.author_email, &commit.author, 14.)))
                                                    },
                                                )
                                                .into_any_element(),
                                            "refs" => cell
                                                .overflow_hidden()
                                                .px(ui(8.))
                                                .when_some(refs.first().copied(), |d, primary| {
                                                    let companion = refs
                                                        .iter()
                                                        .skip(1)
                                                        .filter(|r| {
                                                            r.kind == GitGraphRefKind::RemoteBranch
                                                                && primary.kind
                                                                    != GitGraphRefKind::RemoteBranch
                                                                && r.label == primary.label
                                                        })
                                                        .count();
                                                    let extra = refs.len() - 1 - companion;
                                                    d.child(
                                                        div()
                                                            .id(("branch-label", index))
                                                            .role(Role::Button)
                                                            .aria_label(format!("Reference {}", primary.display_name))
                                                            .on_mouse_down(MouseButton::Right, {
                                                                let hash = primary.target.clone();
                                                                let references = if ghost_visible { vec![primary.clone()] } else { commit.refs.clone() };
                                                                cx.listener(move |s, event: &MouseDownEvent, _, cx| {
                                                                    cx.stop_propagation();
                                                                    s.branch_menu = None;
                                                                    s.branch_menu_task = None;
                                                                    s.git_menu = Some((event.position, hash.clone(), references.clone()));
                                                                    cx.notify();
                                                                })
                                                            })
                                                            .when(s.branch_menu.is_none(), |d| d.tooltip({ let reference = primary.clone(); move |_, cx| cx.new(|_| RefTooltip(reference.clone())).into() }))
                                                            .debug_selector({ let name = primary.full_name.clone(); move || format!("branch-label-{name}") })
                                                            .when(primary.full_name.starts_with("refs/heads/") || primary.kind == GitGraphRefKind::RemoteBranch, |d| {
                                                                let name = primary.full_name.strip_prefix("refs/heads/").unwrap_or(&primary.full_name).to_owned();
                                                                d.on_mouse_down(MouseButton::Left, cx.listener(move |s, event: &MouseDownEvent, _, cx| {
                                                                    if event.click_count == 2 {
                                                                        cx.stop_propagation();
                                                                        s.run_branch_action("checkout", name.clone(), String::new(), cx);
                                                                    }
                                                                }))
                                                            })
                                                            .when((primary.full_name.starts_with("refs/heads/") || primary.kind == GitGraphRefKind::RemoteBranch) && !s.mutating, |d| {
                                                                let name = primary.full_name.strip_prefix("refs/heads/").unwrap_or(&primary.full_name).to_owned();
                                                                d.on_drag(BranchDrag { cwd: s.cwd.clone(), name: name.clone() }, |drag, _, _, cx| cx.new(|_| drag.clone()))
                                                                    .drag_over::<BranchDrag>(|style, _, _, _| style.bg(rgb(0x405a80)))
                                                                    .on_drop(cx.listener(move |s, drag: &BranchDrag, window, cx| {
                                                                        s.branch_menu_position = window.mouse_position();
                                                                        cx.stop_propagation();
                                                                        if drag.cwd == s.cwd { s.open_branch_menu(drag.name.clone(), name.clone(), cx); }
                                                                    }))
                                                            })
                                                            .flex()
                                                            .items_center()
                                                            .gap(ui(4.))
                                                            .min_w_0()
                                                            .max_w_full()
                                                            .overflow_hidden()
                                                            .px(ui(6.))
                                                            .h(ui(17.))
                                                            .rounded(ui(2.))
                                                            .bg(rgba(
                                                                (tint << 8)
                                                                    | if primary.is_head
                                                                    {
                                                                        128
                                                                    } else {
                                                                        64
                                                                    },
                                                            ))
                                                            .text_color(rgba(
                                                                if primary.is_head
                                                                {
                                                                    0xffffffff
                                                                } else {
                                                                    0xffffff80
                                                                },
                                                            ))
                                                            .text_size(ui(colors::CHAT_DETAIL))
                                                            .when(ghost_visible, |d| d.opacity(0.36))
                                                            .child(
                                                                div()
                                                                    .text_ellipsis()
                                                                    .child(primary.label.clone()),
                                                            )
                                                            .when(companion > 0, |d| d.child("↗")),
                                                    )
                                                    .when(extra > 0, |d| {
                                                        d.child(
                                                            button(("extra-refs", index), format!("+{extra}"))
                                                                .px(ui(4.))
                                                                .text_color(rgba(0xebebebb8))
                                                                .on_click({
                                                                    let hash = commit.hash.clone();
                                                                    let references = commit.refs.clone();
                                                                    cx.listener(move |s, event: &ClickEvent, _, cx| {
                                                                        cx.stop_propagation();
                                                                        s.git_menu = Some((event.position(), hash.clone(), references.clone()));
                                                                        cx.notify();
                                                                    })
                                                                }),
                                                        )
                                                    })
                                                })
                                                .when(has_connector, |d| {
                                                    d.child(
                                                        div()
                                                            .flex_1()
                                                            .min_w(ui(4.))
                                                            .h(ui(1.))
                                                            .mr(ui(-8.))
                                                            .child(connector(tint, dashed)),
                                                    )
                                                })
                                                .into_any_element(),
                                            "message" => cell.px(ui(12.)).gap(ui(8.)).overflow_hidden()
                                                .child(div().min_w_0().max_w(relative(if commit.body.is_empty() {1.} else {0.64})).text_size(ui(11.)).text_ellipsis().child(
                                                    if commit.item_kind == GitGraphItemKind::WorktreeWip {
                                                        format!("WIP · {} files · {}", commit.change_summary.as_ref().map_or(0, |summary| summary.files), s.graph.worktrees.iter().find(|w| Some(&w.path) == commit.worktree_path.as_ref()).and_then(|w| w.branch.as_deref()).unwrap_or("detached HEAD"))
                                                    } else { commit.message.clone() }))
                                                .when(!commit.body.is_empty() && commit.item_kind != GitGraphItemKind::WorktreeWip, |d| d.child(div().min_w_0().flex_1().text_size(ui(colors::CHAT_SMALL)).text_color(rgba(0xebebeb80)).text_ellipsis().child(format!("— {}", commit.body.split_whitespace().collect::<Vec<_>>().join(" ")))))
                                                .into_any_element(),
                                            _ => cell
                                                .text_color(rgba(0xebebeb80))
                                                .text_size(ui(colors::CHAT_DETAIL))
                                                .px(ui(8.))
                                                .child(div().text_ellipsis().child(
                                                    match column.as_str() {
                                                        "date" => if commit.item_kind == GitGraphItemKind::WorktreeWip { String::new() } else {
                                                            chrono::DateTime::parse_from_rfc3339(&commit.committed_at).map(|date| date.with_timezone(&chrono::Local).format("%m/%d/%Y %-I:%M %p").to_string()).unwrap_or_else(|_| commit.date.clone())
                                                        },
                                                        "author" => commit.author.clone(),
                                                        "sha" => {
                                                            commit.hash.chars().take(7).collect()
                                                        }
                                                        _ => commit.message.clone(),
                                                    },
                                                ))
                                                .into_any_element(),
                                        }
                                    }))
                                    .when(is_commit, |d| d.on_mouse_down(MouseButton::Right, cx.listener(move |s, event: &MouseDownEvent, _, cx| {
                                        s.git_menu = Some((event.position, context_hash.clone(), context_refs.clone()));
                                        s.branch_menu = None;
                                        s.branch_menu_task = None;
                                        cx.stop_propagation();
                                        cx.notify();
                                    })))
                                    .on_click(
                                        cx.listener(move |s, _, _, cx| s.select_commit(index, cx)),
                                    )
                            })
                            .collect()
                    }),
                )
                .w_full()
                .with_horizontal_sizing_behavior(ListHorizontalSizingBehavior::Unconstrained)
                .track_scroll(&self.graph_scroll)
                .on_scroll_wheel(cx.listener(|_, _, _, cx| cx.notify()))
                .flex_1()
                .min_h_0(),
            )
            .when(self.graph.has_more, |d| {
                d.child(
                    button("older-commits", "Load older commits").on_click(cx.listener(
                        |s, _, _, cx| {
                            s.limit += 200;
                            s.refresh(cx);
                            cx.notify();
                        },
                    )),
                )
            })
    }
}

pub(super) fn images(
    graph: &GitGraphSnapshot,
    display: &Value,
    background: u32,
    previous: &[Arc<Image>],
) -> Vec<Arc<Image>> {
    let width = 27. + (display.as_array().map_or(1, Vec::len) + 1) as f64 * 18.;
    graph.commits.iter().enumerate().map(|(i, commit)| {
        let rows = &graph.rows[i.saturating_sub(1).min(graph.rows.len())..(i + 1).min(graph.rows.len())];
        let lines = serde_json::to_value(inferay_presentation::graph::lines(&json!({"rows":rows,"colors":colors::GRAPH_LANES,"displayColumns":display}))).unwrap();
        let mut svg = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"46\" viewBox=\"0 {} {width} 23\"><g fill=\"none\" stroke-width=\"2\" stroke-linecap=\"round\">", width * 2., i as f64 * 23.);
        for field in ["rails", "truncated"] {
            for line in lines[field].as_array().unwrap() {
                let dash = if line["dashed"] == true || field == "truncated" { format!("stroke-dasharray=\"1 2\" stroke-width=\"1\" stroke-dashoffset=\"{}\"", line["top"]) } else { String::new() };
                svg.push_str(&format!("<path d=\"M {} {} L {} {}\" stroke=\"{}\" {dash}/>", line["x"],line["top"],line["x"],line["bottom"],line["color"].as_str().unwrap()));
                if field == "truncated" { svg.push_str(&format!("<circle cx=\"{}\" cy=\"{}\" r=\"2\" fill=\"{}\"/>",line["x"],line["bottom"].as_f64().unwrap() - 1.,line["color"].as_str().unwrap())); }
            }
        }
        for field in ["transitions", "convergences"] {
            for line in lines[field].as_array().unwrap() {
                svg.push_str(&format!("<path d=\"{}\" stroke=\"{}\" stroke-linejoin=\"round\" {}/>",line["path"].as_str().unwrap(),line["color"].as_str().unwrap(),if line["dashed"] == true { "stroke-dasharray=\"1 2\" stroke-width=\"1\"" } else { "" }));
            }
        }
        let x = 27. + display[commit.column].as_f64().unwrap_or(commit.column as f64) * 18.;
        let y = i as f64 * 23. + 11.5;
        let color = colors::GRAPH_LANES[commit.color_index % colors::GRAPH_LANES.len()];
        svg.push_str("</g>");
        match commit.item_kind {
            GitGraphItemKind::WorktreeWip => svg.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"8.5\" fill=\"#{background:06x}\" stroke=\"{color}\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-dasharray=\"1 2\" pathLength=\"54\" stroke-dashoffset=\"0.5\"/>")),
            GitGraphItemKind::Stash => svg.push_str(&format!("<g transform=\"translate({} {})\"><rect x=\"0.5\" y=\"0.5\" width=\"17\" height=\"17\" rx=\"3\" fill=\"#{background:06x}\" stroke=\"{color}\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-dasharray=\"1 2\" pathLength=\"63\" stroke-dashoffset=\"0.5\"/><path d=\"M4.5 5.5h9v2h-9z M5.5 7.5v5h7v-5 M7.5 9.5h3\" fill=\"none\" stroke=\"{color}\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>", x - 9., y - 9.)),
            GitGraphItemKind::Commit if commit.parents.len() > 1 => svg.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"6\" fill=\"{color}\" opacity=\"0.32\"/><circle cx=\"{x}\" cy=\"{y}\" r=\"5\" fill=\"{color}\"/>")),
            _ => svg.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"8.5\" fill=\"#{background:06x}\" stroke=\"{color}\" stroke-width=\"1\"/>")),
        }
        svg.push_str("</svg>");
        if let Some(image) = previous.get(i).filter(|image| image.bytes.as_slice() == svg.as_bytes()) {
            image.clone()
        } else {
            Arc::new(Image::from_bytes(ImageFormat::Svg, svg.into_bytes()))
        }
    }).collect()
}

fn connector(tint: u32, dashed: bool) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let mut path = PathBuilder::stroke(crate::zoom::pixels(1., window));
            if dashed {
                path = path.dash_array(&[
                    crate::zoom::pixels(2., window),
                    crate::zoom::pixels(1., window),
                ]);
            }
            path.move_to(point(
                bounds.left(),
                bounds.top() + crate::zoom::pixels(0.5, window),
            ));
            path.line_to(point(
                bounds.right(),
                bounds.top() + crate::zoom::pixels(0.5, window),
            ));
            if let Ok(path) = path.build() {
                window.paint_path(path, rgb(tint));
            }
        },
    )
    .size_full()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn branch_double_click_and_drag_open_real_operations(cx: &mut TestAppContext) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let git = |args: &[&str]| {
            let output = inferay_native_diff::git_command()
                .current_dir(&root)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "UI test"]);
        git(&["config", "user.email", "test@example.invalid"]);
        std::fs::write(root.join("file.txt"), "base\n").unwrap();
        git(&["add", "."]);
        git(&["-c", "commit.gpgsign=false", "commit", "-m", "Base"]);
        git(&["switch", "-c", "feature"]);
        std::fs::write(root.join("file.txt"), "next\n").unwrap();
        git(&["commit", "-am", "Feature", "--no-gpg-sign"]);
        git(&["switch", "main"]);
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = RepositoryView::new(
                root.to_string_lossy().into_owned(),
                Value::Null,
                "vscode-black".into(),
                0,
                cx,
            );
            view.changes = false;
            view.avatars.insert(
                "test@example.invalid".into(),
                Arc::new(Image::from_bytes(ImageFormat::Png, vec![])),
            );
            view
        });
        cx.simulate_resize(size(px(1400.), px(700.)));
        cx.run_until_parked();
        for _ in 0..2 {
            cx.draw(point(px(0.), px(0.)), size(px(1400.), px(700.)), |_, _| {
                view.clone().into_any_element()
            });
        }
        let feature = cx
            .debug_bounds("branch-label-refs/heads/feature")
            .unwrap()
            .center();
        cx.simulate_click(feature, Modifiers::default());
        assert_eq!(git(&["branch", "--show-current"]), "main");
        cx.simulate_event(MouseDownEvent {
            position: feature,
            button: MouseButton::Left,
            click_count: 2,
            ..Default::default()
        });
        cx.simulate_event(MouseUpEvent {
            position: feature,
            button: MouseButton::Left,
            click_count: 2,
            ..Default::default()
        });
        cx.run_until_parked();
        assert_eq!(git(&["branch", "--show-current"]), "feature");
        assert_eq!(
            view.read_with(cx, |s, _| s.status.as_ref().unwrap().branch.clone()),
            "feature"
        );
        for _ in 0..2 {
            cx.draw(point(px(0.), px(0.)), size(px(1400.), px(700.)), |_, _| {
                view.clone().into_any_element()
            });
        }
        let feature = cx
            .debug_bounds("branch-label-refs/heads/feature")
            .unwrap()
            .center();
        let main = cx
            .debug_bounds("branch-label-refs/heads/main")
            .unwrap()
            .center();
        cx.simulate_mouse_down(feature, MouseButton::Left, Modifiers::default());
        cx.simulate_mouse_move(
            feature + point(px(12.), px(0.)),
            MouseButton::Left,
            Modifiers::default(),
        );
        cx.draw(point(px(0.), px(0.)), size(px(1400.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        cx.update(|_, cx| {
            assert!(
                cx.has_active_drag(),
                "branch drag did not start: {feature:?} -> {main:?}"
            )
        });
        cx.simulate_mouse_move(main, MouseButton::Left, Modifiers::default());
        cx.draw(point(px(0.), px(0.)), size(px(1400.), px(700.)), |_, _| {
            view.clone().into_any_element()
        });
        cx.simulate_mouse_up(main, MouseButton::Left, Modifiers::default());
        cx.run_until_parked();
        view.read_with(cx, |s, _| {
            let menu = s.branch_menu.as_ref().expect("drop opens operation menu");
            assert_eq!((&*menu.source, &*menu.target), ("feature", "main"));
            assert!(menu.can_merge && menu.can_fast_forward && menu.can_rebase);
        });
        assert_eq!(
            git(&["branch", "--show-current"]),
            "feature",
            "drop alone does not mutate Git"
        );
        // Deferred popups must be rendered by the window, not the test's
        // standalone element arena (which does not flush deferred draws).
        cx.update(|window, _| window.refresh());
        assert!(cx.debug_bounds("branch-operation-menu").is_some());
        let fast_forward = cx
            .debug_bounds("branch-operation-fastForward")
            .unwrap()
            .center();
        cx.simulate_click(fast_forward, Modifiers::default());
        cx.run_until_parked();
        assert_eq!(git(&["branch", "--show-current"]), "main");
        assert_eq!(git(&["rev-parse", "main"]), git(&["rev-parse", "feature"]));
        cx.update(|window, _| window.refresh());
        let main = cx
            .debug_bounds("branch-label-refs/heads/main")
            .unwrap()
            .center();
        // Right click targets the exact commit and exposes branch creation.
        cx.simulate_mouse_down(main, MouseButton::Right, Modifiers::default());
        view.read_with(cx, |s, _| {
            assert!(
                s.git_menu
                    .as_ref()
                    .unwrap()
                    .2
                    .iter()
                    .any(|r| r.full_name == "refs/heads/main")
            )
        });
    }

    #[gpui::test]
    fn unchecked_local_and_remote_branches_can_be_dragged(cx: &mut TestAppContext) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let git = |args: &[&str]| {
            let output = inferay_native_diff::git_command()
                .current_dir(&root)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        };
        git(&["init", "-b", "target"]);
        git(&["config", "user.name", "UI test"]);
        git(&["config", "user.email", "test@example.invalid"]);
        git(&["config", "commit.gpgsign", "false"]);
        git(&["commit", "--allow-empty", "-m", "Base"]);
        git(&["remote", "add", "origin", root.to_str().unwrap()]);
        git(&["update-ref", "refs/remotes/origin/remote-target", "HEAD"]);
        git(&["checkout", "-b", "source"]);
        git(&["commit", "--allow-empty", "-m", "Source"]);
        git(&["update-ref", "refs/remotes/origin/remote-source", "HEAD"]);
        git(&["checkout", "-b", "unrelated", "target"]);
        git(&["commit", "--allow-empty", "-m", "Unrelated"]);
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = RepositoryView::new(
                root.to_string_lossy().into_owned(),
                Value::Null,
                "vscode-black".into(),
                0,
                cx,
            );
            view.changes = false;
            view.avatars.insert(
                "test@example.invalid".into(),
                Arc::new(Image::from_bytes(ImageFormat::Png, vec![])),
            );
            view
        });
        cx.simulate_resize(size(px(1400.), px(700.)));
        cx.run_until_parked();
        for (source, target) in [
            ("refs/heads/source", "refs/heads/target"),
            ("refs/heads/source", "refs/heads/unrelated"),
            ("refs/remotes/origin/remote-source", "refs/heads/unrelated"),
            ("refs/remotes/origin/remote-source", "refs/heads/target"),
            ("refs/heads/source", "refs/remotes/origin/remote-target"),
            (
                "refs/remotes/origin/remote-source",
                "refs/remotes/origin/remote-target",
            ),
        ] {
            view.update(cx, |s, cx| {
                s.branch_menu = None;
                s.preferences["hiddenRefs"] = json!(
                    [
                        "refs/heads/source",
                        "refs/heads/target",
                        "refs/remotes/origin/remote-source",
                        "refs/remotes/origin/remote-target"
                    ]
                    .into_iter()
                    .filter(|name| *name != source && *name != target)
                    .collect::<Vec<_>>()
                );
                cx.notify();
            });
            cx.update(|window, _| window.refresh());
            let from = cx
                .debug_bounds(Box::leak(format!("branch-label-{source}").into_boxed_str()))
                .unwrap()
                .center();
            let to = cx
                .debug_bounds(Box::leak(format!("branch-label-{target}").into_boxed_str()))
                .unwrap()
                .center();
            cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
            cx.simulate_mouse_move(
                from + point(px(12.), px(0.)),
                MouseButton::Left,
                Modifiers::default(),
            );
            cx.update(|window, _| window.refresh());
            cx.update(|_, cx| assert!(cx.has_active_drag(), "{source} must be draggable"));
            cx.simulate_mouse_move(to, MouseButton::Left, Modifiers::default());
            cx.update(|window, _| window.refresh());
            cx.simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
            cx.run_until_parked();
            view.read_with(cx, |s, _| {
                let menu = s.branch_menu.as_ref().expect("drop must open a menu");
                assert_eq!(menu.source, source.trim_start_matches("refs/heads/"));
                assert_eq!(menu.target, target.trim_start_matches("refs/heads/"));
                assert!(menu.can_merge && menu.can_rebase);
                assert_eq!(menu.can_fast_forward, target != "refs/heads/unrelated");
            });
            assert_eq!(git(&["branch", "--show-current"]), "unrelated");
        }
        cx.update(|window, _| window.refresh());
        let action = cx
            .debug_bounds("branch-operation-fastForward")
            .unwrap()
            .center();
        cx.simulate_click(action, Modifiers::default());
        cx.run_until_parked();
        assert_eq!(git(&["branch", "--show-current"]), "remote-target");
        assert_eq!(
            git(&["rev-parse", "remote-target"]),
            git(&["rev-parse", "source"])
        );
        assert_eq!(
            git(&["rev-parse", "refs/remotes/origin/remote-target"]),
            git(&["rev-parse", "target"])
        );
        assert_eq!(
            git(&["rev-parse", "--abbrev-ref", "@{upstream}"]),
            "origin/remote-target"
        );
    }

    #[test]
    fn preserves_shared_paths_pinned_lanes_and_each_node_shape() {
        let commits = vec![
            GraphCommit {
                column: 0,
                item_kind: GitGraphItemKind::WorktreeWip,
                ..Default::default()
            },
            GraphCommit {
                column: 1,
                item_kind: GitGraphItemKind::Stash,
                ..Default::default()
            },
            GraphCommit {
                column: 0,
                parents: vec!["a".into(), "b".into()],
                ..Default::default()
            },
            GraphCommit {
                column: 1,
                parents: vec!["a".into()],
                ..Default::default()
            },
        ];
        let rows: Vec<_> = (0..4)
            .map(|row| GraphRow {
                row,
                rails: vec![GraphRail {
                    dashed: row == 0,
                    column: 0,
                    color_index: 0,
                    starts_at_node: row == 0,
                    ends_at_node: false,
                }],
                transitions: if row == 2 {
                    vec![GraphTransition {
                        dashed: false,
                        from_column: 0,
                        to_column: 1,
                        color_index: 1,
                    }]
                } else {
                    vec![]
                },
                convergences: if row == 3 {
                    vec![GraphTransition {
                        dashed: false,
                        from_column: 0,
                        to_column: 1,
                        color_index: 1,
                    }]
                } else {
                    vec![]
                },
                truncated_edges: vec![],
            })
            .collect();
        let graph = GitGraphSnapshot {
            commits,
            rows,
            ..Default::default()
        };
        let display = json!([1, 0]);
        let pictures = images(&graph, &display, 0x0d0d0d, &[]);
        let refreshed = images(&graph, &display, 0x0d0d0d, &pictures);
        assert!(
            pictures
                .iter()
                .zip(&refreshed)
                .all(|(a, b)| Arc::ptr_eq(a, b))
        );
        let svg: Vec<_> = pictures
            .iter()
            .map(|p| std::str::from_utf8(&p.bytes).unwrap())
            .collect();
        // 23px rows; pinned lane 0 is displayed at x=45. WIP uses an 18px dashed ring.
        assert!(svg[0].contains("cx=\"45\" cy=\"11.5\" r=\"8.5\""));
        assert!(svg[0].contains("stroke-dasharray=\"1 2\" stroke-width=\"1\""));
        assert!(svg[0].contains("pathLength=\"54\""));
        assert!(svg[1].contains("width=\"17\" height=\"17\" rx=\"3\""));
        assert!(svg[2].contains("cx=\"45\" cy=\"57.5\" r=\"5\""));
        assert!(svg[3].contains("cx=\"27\" cy=\"80.5\" r=\"8.5\""));
        let shared = serde_json::to_value(inferay_presentation::graph::lines(&json!({
            "rows": graph.rows, "displayColumns": display, "colors": colors::GRAPH_LANES,
        })))
        .unwrap();
        let transition = shared["transitions"][0]["path"].as_str().unwrap();
        let convergence = shared["convergences"][0]["path"].as_str().unwrap();
        assert!(svg[2].contains(transition));
        // The transition extends into the next row; both tiles must retain the same path.
        assert!(svg[3].contains(transition));
        assert!(svg[3].contains(convergence));
    }
}
