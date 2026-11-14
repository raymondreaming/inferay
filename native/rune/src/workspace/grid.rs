use super::*;
use crate::colors::rgba;
use crate::zoom::ui;
use rune::{El, Phase, col, el, row};

impl Workspace {
    pub(crate) fn chat_ids(&self) -> Vec<String> {
        self.conversations
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.closed && c.project == self.project)
            .map(|(i, c)| c.pane.clone().unwrap_or_else(|| format!("draft-{i}")))
            .collect()
    }

    pub(crate) fn visible_columns(&self) -> serde_json::Value {
        inferay_presentation::dock::responsive_columns(
            &serde_json::json!({"width": self.chat_width, "columns":3}),
        )
    }

    pub(crate) fn chat_grid(&self) -> El {
        let columns = self.visible_columns();
        let layout = inferay_presentation::dock::project(&serde_json::json!({
            "ids": self.chat_ids(), "columns":3, "visibleColumns":columns, "saved":self.projects[self.project].dock
        }))
        .unwrap_or_else(|_| serde_json::json!({"tree":serde_json::Value::Null,"canvas":{}}));
        let dimensions = layout["canvas"]["minHeight"]
            .as_str()
            .unwrap_or("max(100%, 180px)");
        let (percent, pixels) = dimensions
            .trim_start_matches("max(")
            .trim_end_matches(')')
            .split_once(',')
            .unwrap_or(("100%", "180px"));
        let height = percent
            .trim()
            .trim_end_matches('%')
            .parse::<f32>()
            .unwrap_or(100.)
            / 100.;
        let min_height = pixels
            .trim()
            .trim_end_matches("px")
            .parse::<f32>()
            .unwrap_or(180.);
        let width = layout["canvas"]["width"]
            .as_str()
            .unwrap_or("100%")
            .trim_end_matches('%')
            .parse::<f32>()
            .unwrap_or(100.)
            / 100.;
        let viewport = rune::memo::layout_size("chat-grid").unwrap_or([0., 0.]);
        let tree = layout["tree"].clone();
        col()
            .key("chat-grid")
            .grow(1.)
            .min_w(0.)
            .h_full()
            .on_layout(|s: &mut Workspace, rect| {
                let width = rect[2] / crate::zoom::factor();
                if (s.chat_width - width).abs() > 1. {
                    s.chat_width = width;
                    let single_column = s.visible_columns().as_u64() == Some(1);
                    if let Some(repository) = s.current_repository_mut() {
                        repository.single_chat_column = single_column;
                    }
                }
            })
            .child(
                col()
                    .key("chat-grid-scroll")
                    .pin(Some(0.), Some(0.), Some(0.), Some(0.))
                    .scroll(rune::ScrollSpec {
                        stick_bottom: false,
                    })
                    .child(
                        col()
                            .h((viewport[1] * height).max(ui(min_height)))
                            .w(viewport[0] * width)
                            .child(self.dock_branch(&tree, &tree, vec![])),
                    ),
            )
    }

    fn dock_branch(
        &self,
        tree: &serde_json::Value,
        root: &serde_json::Value,
        path: Vec<&'static str>,
    ) -> El {
        if tree["type"] == "split" {
            let ratio = tree["ratio"].as_f64().unwrap_or(0.5) as f32;
            let horizontal = tree["direction"] == "horizontal";
            let key = format!("dock-split-{path:?}");
            let bounds = rune::memo::window_layout(&key).unwrap_or([0., 0., 1., 1.]);
            let mut first_path = path.clone();
            first_path.push("first");
            let mut second_path = path.clone();
            second_path.push("second");
            let container = if horizontal { row() } else { col() };
            let root_tree = root.clone();
            let divider_path = path.clone();
            let mut divider = el()
                .key(format!("divider-{path:?}"))
                .fill(rgba(0xffffff00))
                .on_drag(move |s: &mut Workspace, drag, _| {
                    let [x, y] = drag.window_point();
                    let ratio = if horizontal {
                        (x - bounds[0]) / bounds[2]
                    } else {
                        (y - bounds[1]) / bounds[3]
                    };
                    match drag.phase {
                        Phase::Down => {
                            s.dock_resize = Some(DockResize {
                                path: divider_path.clone(),
                                tree: root_tree.clone(),
                            });
                        }
                        Phase::Move => s.preview_dock_resize(ratio),
                        _ => s.finish_dock_resize(ratio, drag.cancelled()),
                    }
                })
                .child(
                    if horizontal {
                        el().pin(Some(ui(2.)), Some(0.), None, Some(0.)).w(ui(1.))
                    } else {
                        el().pin(Some(0.), Some(ui(2.)), Some(0.), None).h(ui(1.))
                    }
                    .fill(rgba(0xebebeb18)),
                );
            divider = if horizontal {
                divider
                    .w(ui(5.))
                    .mx(ui(-2.))
                    .h_full()
                    .cursor(rune::Cursor::ResizeColumn)
            } else {
                divider
                    .h(ui(5.))
                    .my(ui(-2.))
                    .w_full()
                    .cursor(rune::Cursor::ResizeRow)
            };
            return container
                .key(key)
                .w_full()
                .h_full()
                .min_h(0.)
                .min_w(0.)
                .child(
                    col()
                        .grow(ratio)
                        .min_w(0.)
                        .min_h(0.)
                        .clip_rounded(0.)
                        .child(self.dock_branch(&tree["first"], root, first_path)),
                )
                .child(divider)
                .child(
                    col()
                        .grow(1. - ratio)
                        .min_w(0.)
                        .min_h(0.)
                        .clip_rounded(0.)
                        .child(self.dock_branch(&tree["second"], root, second_path)),
                );
        }
        let Some(index) = self
            .conversations
            .iter()
            .enumerate()
            .find(|(i, c)| {
                c.pane
                    .as_deref()
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("draft-{i}"))
                    == tree["id"].as_str().unwrap_or_default()
            })
            .map(|(i, _)| i)
        else {
            return el();
        };
        col()
            .key(format!("chat-pane-{index}"))
            .w_full()
            .h_full()
            .min_w(0.)
            .min_h(0.)
            .on_drop_files(move |s: &mut Workspace, paths, _| {
                s.attach_images(index, paths.to_vec())
            })
            .on_press(move |s: &mut Workspace| s.select_chat_pane(index))
            .child(self.transcript(index))
            .child(self.composer(index))
    }

    pub(crate) fn select_chat_pane(&mut self, index: usize) {
        if self.selected != index {
            self.selected = index;
            self.projects[self.project].selected = index;
            self.persist_workspace_preferences(None);
        }
    }

    fn preview_dock_resize(&mut self, ratio: f32) {
        let Some(resize) = &self.dock_resize else {
            return;
        };
        if let Ok(updated) = inferay_presentation::dock::resize_preview(
            &serde_json::json!({"tree":resize.tree,"path":resize.path,"ratio":ratio}),
        ) {
            self.projects[self.project].dock =
                serde_json::json!({"tree":updated["tree"],"preset":["grid",3]});
        }
    }

    fn finish_dock_resize(&mut self, ratio: f32, cancelled: bool) {
        let Some(resize) = self.dock_resize.take() else {
            return;
        };
        if cancelled {
            return;
        }
        if let Some((workspace, legacy)) = self.projects[self.project].dock_workspace.clone() {
            let request = serde_json::json!({
                "workspaceId":workspace,"legacyWorkspaceId":legacy,"ids":self.chat_ids(),"columns":3,
                "visibleColumns":self.visible_columns(),"action":{"type":"resize","path":resize.path,"ratio":ratio}
            });
            self.persist_workspace_preferences(Some(request));
        }
    }
}
