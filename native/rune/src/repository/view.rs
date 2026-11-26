use super::changes::{border_bottom, border_left, border_top, label};
use super::*;
use crate::colors::rgba;
use crate::icons;
use crate::ui::{Ink, button, icon, icon_sized, menu_surface};
use crate::zoom::ui;
use rune::{Cursor, Drag, El, Phase, col, el, row};

fn toolbar_button(key: &str, glyph: &'static rune::Icon, text: &str) -> El {
    button("")
        .key(key.to_owned())
        .child(icon_sized(glyph, 14.))
        .child(Ink::new(11.).line_text(text.to_owned()))
        .h(ui(24.))
        .px(ui(8.))
}

impl RepositoryView {
    fn toolbar(&self) -> El {
        let name = std::path::Path::new(&self.path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let branch = self
            .status
            .as_ref()
            .map(|s| s.branch.clone())
            .unwrap_or_default();
        border_bottom(
            row()
                .key("repository-toolbar")
                .h(ui(32.))
                .px(ui(8.))
                .items_center()
                .gap(ui(4.)),
            0xebebeb0f,
        )
        .child(
            button("")
                .key("repository-picker")
                .label("Choose workspace repository")
                .child(icon(&icons::FOLDER))
                .child(Ink::new(12.).line_text(name).max_w(ui(140.)).shrink())
                .child(icon(&icons::CHEVRON_DOWN))
                .on_press_tx(act(&self.path, |view, _| {
                    view.repository_menu = !view.repository_menu;
                    view.columns_menu = false;
                })),
        )
        .child(
            row()
                .items_center()
                .gap(ui(4.))
                .child(icon_sized(&icons::GIT_BRANCH, 12.))
                .child(label(Ink::new(11.).hex(0xebebeb80), branch)),
        )
        .child(el().grow(1.))
        .child(
            toolbar_button("history", &icons::COMMIT_GRAPH, "History").on_press_tx(act(
                &self.path,
                |view, _| {
                    if view.show_diff {
                        view.show_diff = false;
                        view.history = true;
                        view.keyboard_scope = "graph";
                        view.open_after_selection = false;
                    } else {
                        view.history = !view.history;
                    }
                    if !view.history {
                        view.changes = true;
                    }
                },
            )),
        )
        .child(
            toolbar_button("changes", &icons::DIFF_UNIFIED, "Changes").on_press_tx(act(
                &self.path,
                |view, _| {
                    view.changes = !view.changes;
                    if !view.changes {
                        view.history = true;
                    }
                },
            )),
        )
        .child(
            toolbar_button(
                "git-operations",
                &icons::GIT_BRANCH,
                if self.mutating { "Working…" } else { "Git" },
            )
            .label("Git operations")
            .child(icon_sized(&icons::CHEVRON_DOWN, 12.))
            .on_press_tx(act(&self.path, |view, _| {
                if view.git_menu.is_some() {
                    view.git_menu = None;
                } else {
                    view.git_menu = Some((MenuAnchor::Button, String::new(), vec![]));
                }
                view.branch_menu = None;
                view.branch_menu_task = None;
                view.columns_menu = false;
                view.repository_menu = false;
            })),
        )
        .child(
            button("")
                .key("graph-columns")
                .size(ui(24.), ui(24.))
                .padding(ui(5.))
                .label("Show or hide Git columns")
                .child(icon_sized(&icons::SETTINGS, 14.))
                .on_press_tx(act(&self.path, |view, _| {
                    view.columns_menu = !view.columns_menu;
                    view.repository_menu = false;
                })),
        )
        .child({
            let path = self.path.clone();
            button("")
                .key("expand-git")
                .label(if self.expanded {
                    "Collapse repository panel"
                } else {
                    "Expand repository panel"
                })
                .size(ui(24.), ui(24.))
                .padding(ui(5.))
                .justify_center()
                .child(icon_sized(
                    if self.expanded {
                        &icons::COLLAPSE
                    } else {
                        &icons::EXPAND
                    },
                    14.,
                ))
                .on_press_tx(move |s: &mut Workspace, tx| {
                    s.repository_event(&path, RepositoryEvent::Expand, tx)
                })
        })
    }

    fn repository_menu(&self) -> El {
        let mut menu = menu_surface()
            .key("repository-menu")
            .pin(Some(ui(8.)), Some(ui(32.)), None, None)
            .w(ui(280.))
            .max_w(ui((self.available_width() - 16.).max(180.)))
            .modal(true, |s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut() {
                    view.repository_menu = false;
                }
            });
        for (i, (name, path)) in self.repositories.iter().enumerate() {
            let selected_path = path.clone();
            let removed_path = path.clone();
            let view_path = self.path.clone();
            let remove_view_path = self.path.clone();
            let mut entry = row().items_center().w_full().radius(ui(6.));
            if path == &self.path {
                entry = entry.fill(rgba(0xebebeb0d));
            }
            entry = entry
                .child(
                    button("")
                        .key(format!("workspace-repository-{i}"))
                        .h(ui(32.))
                        .gap(ui(8.))
                        .grow(1.)
                        .shrink()
                        .label(format!("{name}: {path}"))
                        .child(icon(&icons::FOLDER))
                        .child(Ink::small().line_text(name.clone()).grow(1.).shrink())
                        .on_press_tx(move |s: &mut Workspace, tx| {
                            if let Some(view) = s.repository_views.get_mut(&view_path) {
                                view.repository_menu = false;
                            }
                            s.repository_event(
                                &view_path,
                                RepositoryEvent::Select(selected_path.clone()),
                                tx,
                            );
                        }),
                )
                .child(
                    button("")
                        .key(format!("remove-workspace-repository-{i}"))
                        .label(format!(
                            "Close {name}: {path}. Keep project references and files."
                        ))
                        .child(icon_sized(&icons::X, 12.))
                        .on_press_tx(move |s: &mut Workspace, tx| {
                            if let Some(view) = s.repository_views.get_mut(&remove_view_path) {
                                view.repository_menu = false;
                            }
                            s.repository_event(
                                &remove_view_path,
                                RepositoryEvent::Close(removed_path.clone()),
                                tx,
                            );
                        }),
                );
            menu = menu.child(entry);
        }
        if self.has_closed_repositories {
            let path = self.path.clone();
            menu = menu.child(
                button("Reopen closed repositories")
                    .key("reopen-repositories")
                    .on_press_tx(move |s: &mut Workspace, tx| {
                        if let Some(view) = s.repository_views.get_mut(&path) {
                            view.repository_menu = false;
                        }
                        s.repository_event(&path, RepositoryEvent::Reopen, tx);
                    }),
            );
        }
        let path = self.path.clone();
        menu.child(
            button("Add repository…")
                .key("add-workspace-repository")
                .child(icon(&icons::PLUS))
                .on_press_tx(move |s: &mut Workspace, tx| {
                    if let Some(view) = s.repository_views.get_mut(&path) {
                        view.repository_menu = false;
                    }
                    s.repository_event(&path, RepositoryEvent::Add, tx);
                }),
        )
    }

    fn body(&self) -> El {
        let on_right = self.changes_on_right();
        let mut body = if on_right { row() } else { col() }
            .key("repository-body")
            .grow(1.)
            .min_h(0.)
            .min_w(0.);
        if self.history || self.show_diff {
            let mut main = col().grow(1.).min_h(0.).min_w(0.);
            if self.history && !self.show_diff {
                main = main.child(self.graph_table());
            }
            if self.show_diff {
                main = main.child(self.diff_view());
            }
            body = body.child(main);
        }
        if self.changes {
            let split = self.history || self.show_diff;
            let mut panel = col().key("git-changes-panel").min_h(0.).min_w(0.);
            if !split {
                panel = panel.w_full().h_full().grow(1.);
            } else if on_right {
                panel = border_left(panel.w(ui(self.changes_panel_width())).h_full(), 0xebebeb0f);
            } else {
                panel = border_top(panel.h(ui(self.changes_height)).w_full(), 0xebebeb0f);
                if let Some([_, height]) = rune::memo::layout_size("repository-body") {
                    panel = panel.max_h(height * 0.8);
                }
            }
            panel = panel.child(self.changes_panel());
            if split {
                let handle = el()
                    .key("resize-changes")
                    .pin(Some(0.), Some(0.), None, None);
                let handle = if on_right {
                    handle.w(ui(6.)).h_full().cursor(Cursor::ResizeColumn)
                } else {
                    handle.h(ui(6.)).w_full().cursor(Cursor::ResizeRow)
                };
                panel = panel.child(handle.on_drag(changes_resize(&self.path)));
            }
            body = body.child(panel);
        }
        body
    }

    fn snapped_popup(&self, key: &str, (x, y): (f32, f32), popup: El) -> El {
        let [width, height] = rune::memo::layout_size(key).unwrap_or([0., 0.]);
        let [window_width, window_height] =
            rune::memo::layout_size("workspace-root").unwrap_or([f32::MAX, f32::MAX]);
        let x = x.min(window_width - width).max(0.);
        let y = y.min(window_height - height).max(0.);
        popup.pin(
            Some(x - self.origin[0] - 1.),
            Some(y - self.origin[1]),
            None,
            None,
        )
    }

    pub fn render(&self) -> El {
        let path = self.path.clone();
        let mut root = border_left(
            col()
                .key("repository")
                .w_full()
                .h_full()
                .min_w(0.)
                .focusable(true)
                .no_focus_ring(),
            0xebebeb0f,
        )
        .on_key(
            move |s: &mut Workspace, event: &rune::KeyEvent, tx: &mut Tx| {
                let Some(view) = s.repository_views.get_mut(&path) else {
                    return false;
                };
                view.keyboard_active = true;
                super::keyboard::handle_key(s, &path, event, tx)
            },
        )
        .on_layout(layout_watch(&self.path))
        .child(self.toolbar());
        if self.loading && self.graph.commits.is_empty() {
            root = root.child(
                col()
                    .px(ui(12.))
                    .child(Ink::new(11.).text("Reading repository…")),
            );
        }
        if let Some(error) = &self.membership_error {
            root = root.child(
                col()
                    .padding(ui(12.))
                    .child(Ink::new(11.).text(error.clone())),
            );
        }
        if self.missing {
            let path = self.path.clone();
            root = root.child(
                button("Locate folder")
                    .key("locate-repository")
                    .on_press_tx(move |s: &mut Workspace, tx| {
                        s.repository_event(&path, RepositoryEvent::Relink(path.clone()), tx)
                    }),
            );
        }
        if let Some(error) = &self.error {
            root = root.child(
                col()
                    .padding(ui(12.))
                    .child(Ink::new(11.).text(error.clone())),
            );
        }
        root = root.child(self.body());
        if let Some((anchor, _, _)) = &self.git_menu {
            let point = match anchor {
                MenuAnchor::Button => rune::memo::window_layout("git-operations")
                    .map_or((0., 0.), |r| (r[0], r[1] + r[3])),
                MenuAnchor::Point(x, y) => (*x, *y),
            };
            root = root.child(self.snapped_popup("git-context-menu", point, self.git_menu()));
        }
        if self.git_prompt.is_some() {
            root = root.child(self.git_prompt());
        }
        if self.branch_menu.is_some() {
            root = root.child(self.snapped_popup(
                "branch-operation-menu",
                self.branch_menu_position,
                self.branch_menu(),
            ));
        }
        if self.columns_menu {
            root = root.child(self.column_menu());
        }
        if self.repository_menu {
            root = root.child(self.repository_menu());
        }
        if let Some(drag) = self.branch_drag.as_ref().filter(|drag| drag.active) {
            root = root.child(
                drag.badge
                    .element(false)
                    .key("dragged-branch-badge")
                    .pin(
                        Some(drag.pointer[0] - drag.grab[0] - self.origin[0] - 1.),
                        Some(drag.pointer[1] - drag.grab[1] - self.origin[1]),
                        None,
                        None,
                    )
                    .inert(),
            );
        }
        root
    }
}

fn layout_watch(path: &str) -> impl Fn(&mut Workspace, [f32; 4]) + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, rect: [f32; 4]| {
        if let Some(view) = s.repository_views.get_mut(&path) {
            if view.layout_width != Some(rect[2]) {
                view.layout_width = Some(rect[2]);
            }
            view.origin = [rect[0], rect[1]];
        }
    }
}

fn changes_resize(path: &str) -> impl Fn(&mut Workspace, &mut Drag, &mut Tx) + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, drag: &mut Drag, _: &mut Tx| {
        let Some(view) = s.repository_views.get_mut(&path) else {
            return;
        };
        let on_right = view.changes_on_right();
        if drag.phase == Phase::Down {
            view.changes_resize = Some(if on_right {
                view.changes_panel_width()
            } else {
                view.changes_height
            });
        }
        if let Some(size) = view.changes_resize {
            if on_right {
                view.changes_width = (size - drag.dx / crate::zoom::factor())
                    .clamp(180., (view.available_width() - 180.).max(180.));
            } else {
                view.changes_height = (size - drag.dy / crate::zoom::factor()).max(100.);
            }
        }
        if drag.phase == Phase::Up {
            view.changes_resize = None;
        }
    }
}
