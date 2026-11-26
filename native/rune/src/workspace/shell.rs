use super::*;
use crate::colors::{self, rgb, rgba};
use crate::icons;
use crate::input;
use crate::ui::{Ink, MEDIUM, border, button, icon, icon_sized, menu_surface, titlebar_surface};
use crate::zoom::ui;
use rune::{Cx, El, Phase, col, el, row};

pub(crate) fn view(s: &Workspace, cx: &mut Cx<Workspace>) -> El {
    crate::zoom::apply(s.zoom);
    crate::zoom::set_scale(cx.env().scale);
    crate::baseline::set_frame(s.font, cx.env().scale);
    let height = s.zoom.titlebar_height();
    cx.set_titlebar(rune::Titlebar::new(height).traffic_lights(16., (height - 14.) / 2.));
    s.root()
        .key("workspace-root")
        .instant_changes()
        .hover_motion_within(rune::Anim::INSTANT, rune::Anim::INSTANT)
        .on_layout(|s: &mut Workspace, rect| {
            let size = (rect[2], rect[3]);
            if s.viewport != size {
                s.viewport = size;
            }
            let width = size.0 / crate::zoom::factor();
            if s.project_pages.viewport_width != width {
                s.project_pages.viewport_width = width;
            }
        })
}

impl Workspace {
    fn shell_colors(&self) -> (rune::Color, rune::Color) {
        let shell = match self.appearance {
            Appearance::Dark => rgba((colors::SURFACE << 8) | 255),
            Appearance::Glass => rgba((self.glass_opacity * 255.) as u32),
            Appearance::Scene => rgba(0x18212a88),
        };
        let canvas = match self.appearance {
            Appearance::Dark => rgba((colors::CANVAS << 8) | 255),
            Appearance::Glass => rgba(0x04040478),
            Appearance::Scene => rgba(0x03030470),
        };
        (shell, canvas)
    }

    fn root(&self) -> El {
        let (shell, canvas) = self.shell_colors();
        if self.project_picker
            || self
                .projects
                .iter()
                .all(|p| self.closed_projects.contains(p.id.as_deref().unwrap_or("")))
        {
            let body = Ink::body();
            let mut picker = col()
                .padding(ui(24.))
                .gap(ui(8.))
                .child(body.text("Open a workspace"))
                .child(body.text("Closing a tab keeps its chats, repositories and files."));
            for (index, project) in self.projects.iter().enumerate() {
                picker = picker.child(
                    button(&project.name)
                        .key(format!("reopen-project-{index}"))
                        .on_press_tx(move |s: &mut Workspace, tx| {
                            s.select_project(index, tx);
                            s.persist_workspace_preferences(None);
                        }),
                );
            }
            return col()
                .w_full()
                .h_full()
                .fill(shell)
                .child(self.titlebar())
                .child(picker)
                .children(self.new_menu_overlay());
        }
        let mut root = el().w_full().h_full().fill(shell);
        if self.appearance == Appearance::Scene {
            if let Some(scene) = &self.scene {
                root = root.child(
                    el().pin(Some(0.), Some(0.), Some(0.), Some(0.))
                        .pixels_fit(scene, rune::SurfaceFit::Fill),
                );
            }
            root = root.child(
                el().pin(Some(0.), Some(0.), Some(0.), Some(0.))
                    .fill(rgba((self.scene_dim * 255.) as u32)),
            );
        }
        if self.appearance == Appearance::Glass {
            root = root.child(
                el().pin(Some(0.), Some(0.), Some(0.), Some(0.))
                    .fill(rgba(0xebebeb08)),
            );
        }
        if self.settings {
            return root.child(self.settings_view(canvas));
        }
        let mut body = row().grow(1.).min_h(0.).pr(ui(6.)).pb(ui(6.));
        if !self.sidebar {
            body = body.pl(ui(6.));
        } else {
            body = body.child(self.sidebar_view());
        }
        let mut card = border(
            row()
                .grow(1.)
                .min_w(0.)
                .h_full()
                .radius(ui(12.))
                .clip_rounded(ui(12.))
                .fill(canvas),
            0xebebeb0a,
        );
        if self.project_pages.page.is_some() {
            card = card.child(self.project_page());
        } else {
            if !(self.repository && self.repository_expanded) {
                card = card.child(self.chat_grid());
            }
            if self.repository
                && let Some(path) = &self.repository_view
                && let Some(view) = self.repository_views.get(path)
            {
                let mut panel = col().h_full().min_w(0.);
                panel = if self.repository_expanded {
                    panel.grow(1.)
                } else {
                    panel.w(ui(self.repository_width.min(self.max_repository_width())))
                };
                panel = panel.child(view.render());
                if !self.repository_expanded {
                    let start = self.repository_width.min(self.max_repository_width());
                    panel = panel.child(
                        el().key("resize-repository")
                            .pin(Some(0.), Some(0.), None, Some(0.))
                            .w(ui(6.))
                            .cursor(rune::Cursor::ResizeColumn)
                            .on_drag(move |s: &mut Workspace, drag, _| {
                                if drag.phase == Phase::Down {
                                    s.repository_resize = Some(start);
                                }
                                if let Some(width) = s.repository_resize {
                                    s.repository_width = (width - drag.dx / crate::zoom::factor())
                                        .clamp(280., s.max_repository_width());
                                }
                                if matches!(drag.phase, Phase::Up) {
                                    s.repository_resize = None;
                                }
                            }),
                    );
                }
                card = card.child(panel);
            }
        }
        root.child(
            col()
                .w_full()
                .h_full()
                .child(self.titlebar())
                .child(body.child(card)),
        )
        .children(self.project_page_overlay())
        .children(self.new_menu_overlay())
    }

    fn titlebar(&self) -> El {
        let mut tabs = row()
            .key("project-tabs")
            .gap(ui(6.))
            .grow(1.)
            .min_w(0.)
            .scroll_x();
        let mut strip = row().gap(ui(6.)).h_full().items_center();
        for (i, project) in self.projects.iter().enumerate() {
            if self
                .closed_projects
                .contains(project.id.as_deref().unwrap_or(""))
            {
                continue;
            }
            let name = project.name.clone();
            let mut tab = row()
                .key(format!("project-{i}"))
                .role("tab")
                .label(name.clone())
                .h(ui(30.))
                .pl(ui(12.))
                .pr(ui(4.))
                .items_center()
                .gap(ui(7.))
                .radius(ui(7.))
                .cursor(rune::Cursor::Pointer);
            tab = if self.project == i {
                crate::ui::swap_fill(
                    tab,
                    &format!("project-{i}"),
                    Some(rgba(0xebebeb17)),
                    rgba(0xebebeb10),
                )
            } else {
                tab.hover(rgba(0xebebeb10))
            };
            tab = tab
                .child(icon(&icons::FOLDER))
                .child(Ink::small().weight(MEDIUM).line_text(name.clone()));
            {
                let (additions, deletions) = project
                    .repositories
                    .iter()
                    .filter(|(_, path)| self.repository_open_in(i, path))
                    .filter_map(|(_, path)| self.repository_stats.get(path))
                    .fold((0, 0), |(a, d), stats| {
                        (a + stats.additions, d + stats.deletions)
                    });
                if additions + deletions > 0 {
                    tab = tab.child(
                        row()
                            .key(format!("project-changes-{i}"))
                            .gap(ui(4.))
                            .child(
                                Ink::new(11.)
                                    .color(rgb(0x4fbd83))
                                    .line_text(format!("+{additions}")),
                            )
                            .child(
                                Ink::new(11.)
                                    .color(rgb(0xdf6464))
                                    .line_text(format!("−{deletions}")),
                            ),
                    );
                }
            }
            if self
                .conversations
                .iter()
                .any(|chat| !chat.closed && chat.project == i && chat.run.is_loading)
            {
                tab = tab.child(
                    crate::ui::border_beam(&format!("project-{i}"), ui(7.))
                        .key(format!("project-beam-{i}")),
                );
            }
            tab = tab
                .child(
                    button("")
                        .key(format!("close-project-{i}"))
                        .label(format!("Close {name} workspace tab"))
                        .px(ui(0.))
                        .w(ui(24.))
                        .h(ui(24.))
                        .justify_center()
                        .child(icon_sized(&icons::X, 12.))
                        .on_press_tx(move |s: &mut Workspace, tx| s.close_project_tab(i, tx)),
                )
                .on_press_tx(move |s: &mut Workspace, tx| {
                    s.select_project(i, tx);
                    s.persist_workspace_preferences(None);
                });
            strip = strip.child(tab);
        }
        tabs = tabs.child(strip.child(el().grow(1.).h_full().min_w(ui(16.)).window_drag()));
        titlebar_surface()
            .key("workspace-titlebar")
            .pr(ui(8.))
            .gap(ui(4.))
            .child(
                button("")
                    .key("sidebar-toggle")
                    .label("Toggle sidebar")
                    .child(icon(&icons::PANEL_LEFT))
                    .on_press(|s: &mut Workspace| {
                        s.sidebar = !s.sidebar;
                        s.persist_workspace_preferences(None);
                    }),
            )
            .child(
                button("New")
                    .key("new-button")
                    .child(icon(&icons::CHEVRON_DOWN))
                    .on_press(|s: &mut Workspace| s.new_menu = !s.new_menu),
            )
            .child(tabs)
            .child(
                button("")
                    .key("repository-toggle")
                    .label("Toggle repository panel")
                    .child(icon(&icons::COMMIT_GRAPH))
                    .on_press(|s: &mut Workspace| s.repository = !s.repository),
            )
    }

    fn new_menu_overlay(&self) -> Option<El> {
        if !(self.new_menu || self.new_project_name.is_some()) {
            return None;
        }
        let close = |s: &mut Workspace| {
            if s.new_project_task.is_none() {
                s.new_menu = false;
                s.new_project_name = None;
                s.new_project_repository = None;
            }
        };
        let mut menu = menu_surface()
            .key("new-menu")
            .w(ui(if self.new_project_name.is_some() {
                320.
            } else {
                240.
            }))
            .anchored("new-button", rune::Side::Bottom, rune::Align::Start, 0.)
            .modal(true, close);
        if let Some(name) = &self.new_project_name {
            let field = input::field(name, "new-project-name", |s: &mut Workspace| {
                s.new_project_name.as_mut().expect("new project name")
            })
            .single_line()
            .on_submit(|s: &mut Workspace, tx| s.create_project(tx));
            let body = Ink::body();
            menu = menu
                .padding(ui(10.))
                .gap(ui(8.))
                .child(body.text("New project"))
                .child(input::frame(name, field));
            menu = menu.child(
                button(if self.new_project_repository.is_some() {
                    "Change repository folder…"
                } else {
                    "Choose repository folder…"
                })
                .key("new-project-repository")
                .on_press(|s: &mut Workspace| {
                    if s.new_project_task.is_some() {
                        return;
                    }
                    crate::platform::prompt_for_paths(
                        crate::platform::PathPrompt {
                            files: false,
                            directories: true,
                            multiple: false,
                            prompt: Some("Choose repository"),
                        },
                        |s, paths, _| {
                            if s.new_project_task.is_some() {
                                return;
                            }
                            let Some(name) = s.new_project_name.as_mut() else {
                                return;
                            };
                            if let Some(path) = paths.and_then(|paths| paths.into_iter().next()) {
                                if name.content().trim().is_empty()
                                    && let Some(folder) = path.file_name()
                                {
                                    name.set_content(&folder.to_string_lossy());
                                }
                                s.new_project_repository = Some(path);
                            }
                        },
                    );
                }),
            );
            if let Some(path) = &self.new_project_repository {
                menu = menu
                    .child(Ink::small().text(path.to_string_lossy().into_owned()))
                    .child(
                        button("Remove folder")
                            .key("clear-project-repository")
                            .on_press(|s: &mut Workspace| {
                                if s.new_project_task.is_none() {
                                    s.new_project_repository = None;
                                }
                            }),
                    );
            }
            menu = menu.child(Ink::small().text(
                "Optional. Linked repositories are available to every chat in this project.",
            ));
            if !self.status.is_empty() {
                menu = menu.child(body.text(self.status.clone()));
            }
            menu = menu.child(
                row()
                    .justify_end()
                    .gap(ui(6.))
                    .child(button("Cancel").key("cancel-new-project").on_press(
                        |s: &mut Workspace| {
                            if s.new_project_task.is_none() {
                                s.new_project_name = None;
                                s.new_project_repository = None;
                            }
                        },
                    ))
                    .child(
                        button(if self.new_project_task.is_some() {
                            "Creating…"
                        } else {
                            "Create"
                        })
                        .key("create-new-project")
                        .on_press_tx(|s: &mut Workspace, tx| s.create_project(tx)),
                    ),
            );
        } else {
            menu = menu
                .child(
                    button("Chat")
                        .key("new-chat")
                        .label("New chat")
                        .w_full()
                        .on_press_tx(|s: &mut Workspace, tx| {
                            s.new_menu = false;
                            s.new_chat(tx);
                        }),
                )
                .child(
                    button("Project")
                        .key("new-project")
                        .label("New project")
                        .w_full()
                        .on_press(|s: &mut Workspace| s.begin_project_creation()),
                )
                .child(
                    button("Add repository…")
                        .key("new-repository")
                        .label("Add repository to current project")
                        .w_full()
                        .on_press_tx(|s: &mut Workspace, tx| {
                            s.new_menu = false;
                            s.edit_repository(None, tx);
                        }),
                );
        }
        Some(menu)
    }

    fn sidebar_view(&self) -> El {
        let small = Ink::small();
        let viewport = rune::memo::layout_size("sidebar-scroll").map_or(0., |[_, h]| h);
        let mut content = col().min_h(viewport);
        for (glyph, name) in [
            (&icons::BOOKMARK, "Memory"),
            (&icons::SPARKLES, "Plugins"),
            (&icons::WORKFLOW, "Automations"),
        ] {
            let mut item = button("")
                .key(format!("page-{name}"))
                .label(name)
                .h(ui(32.))
                .gap(ui(10.));
            if self.project_pages.page == Some(name) {
                item = crate::ui::plain_button("")
                    .key(format!("page-{name}"))
                    .label(name)
                    .h(ui(32.))
                    .gap(ui(10.));
                item = crate::ui::swap_fill(
                    item,
                    &format!("page-{name}"),
                    Some(rgba(0xebebeb10)),
                    rgba(0xffffff0d),
                );
            }
            content = content.child(
                item.child(icon(glyph))
                    .child(small.line_text(name))
                    .on_press_tx(move |s: &mut Workspace, tx| s.open_project_page(name, tx)),
            );
        }
        content = content.child(
            button("")
                .key("repositories-toggle")
                .h(ui(32.))
                .gap(ui(10.))
                .child(icon(&icons::GIT_BRANCH))
                .child(small.line_text("Repositories"))
                .child(el().grow(1.))
                .child(icon(if self.repositories_collapsed {
                    &icons::CHEVRON_RIGHT
                } else {
                    &icons::CHEVRON_DOWN
                }))
                .on_press(|s: &mut Workspace| s.repositories_collapsed = !s.repositories_collapsed),
        );
        content = content.child(
            button(if self.repository_edit_task.is_some() {
                "Updating repositories…"
            } else {
                "Add repository…"
            })
            .key("sidebar-add-repository")
            .label("Add repository to current project")
            .h(ui(32.))
            .child(icon(&icons::PLUS))
            .on_press_tx(|s: &mut Workspace, tx| s.edit_repository(None, tx)),
        );
        for (i, (name, path)) in self.projects[self.project].repositories.iter().enumerate() {
            if self.repositories_collapsed || !self.repository_is_open(path) {
                continue;
            }
            let selected_path = path.clone();
            let removed_path = path.clone();
            let mut entry = button("")
                .key(format!("repo-{i}"))
                .label(format!("{name}: {path}"))
                .h(ui(32.))
                .grow(1.)
                .min_w(0.)
                .pl(ui(26.))
                .child(icon(&icons::GIT_BRANCH))
                .child(small.line_text(name.clone()).grow(1.).min_w(0.));
            if let Some(stats) = self.repository_stats.get(path) {
                entry = entry
                    .child(
                        Ink::new(11.)
                            .color(rgb(0x4fbd83))
                            .line_text(format!("+{}", stats.additions)),
                    )
                    .child(
                        Ink::new(11.)
                            .color(rgb(0xdf6464))
                            .line_text(format!("−{}", stats.deletions)),
                    );
            }
            content = content.child(
                row()
                    .items_center()
                    .child(entry.on_press_tx(move |s: &mut Workspace, tx| {
                        s.show_graph(Some(selected_path.clone()), tx);
                    }))
                    .child(
                        button("")
                            .key(format!("remove-repository-{i}"))
                            .label(format!(
                                "Close {name}: {path}. Keep project references and files."
                            ))
                            .child(icon_sized(&icons::X, 12.))
                            .on_press(move |s: &mut Workspace| {
                                s.close_repository(removed_path.clone())
                            }),
                    ),
            );
        }
        content = content.child(el().h(ui(1.)).fill(rgba(0xebebeb0f)).my(ui(14.)));
        for (i, chat) in self.conversations.iter().enumerate() {
            if chat.closed || chat.project != self.project {
                continue;
            }
            let selected = i == self.selected;
            let mut item = row()
                .key(format!("sidebar-chat-{i}"))
                .role("button")
                .label(chat.title.clone())
                .items_center()
                .gap(ui(8.))
                .px(ui(9.))
                .min_h(ui(36.))
                .py(ui(8.))
                .mb(ui(3.))
                .radius(ui(6.))
                .border(1., if selected { rgba(0xebebeb0f) } else { rgba(0) })
                .border_layout()
                .cursor(rune::Cursor::Pointer);
            item = if selected {
                crate::ui::swap_fill(
                    item,
                    &format!("sidebar-chat-{i}"),
                    Some(rgba(0xebebeb17)),
                    rgba(0xebebeb0d),
                )
            } else {
                item.hover(rgba(0xebebeb0d))
            };
            content = content.child(
                item.child(icon(&icons::CODEX))
                    .child(
                        col()
                            .grow(1.)
                            .min_w(0.)
                            .child(Ink::small().line(15.).text(chat.title.clone())),
                    )
                    .child(
                        button("")
                            .key(format!("close-chat-{i}"))
                            .label("Close chat and stop agent")
                            .child(icon_sized(&icons::X, 12.))
                            .on_press(move |s: &mut Workspace| s.close_chat(i)),
                    )
                    .on_press_tx(move |s: &mut Workspace, tx| {
                        s.project_pages.page = None;
                        // A full-screen graph hides the chats; choosing one returns to them.
                        if s.repository_expanded {
                            s.repository = false;
                        }
                        s.selected = i;
                        s.projects[s.project].selected = i;
                        s.persist_workspace_preferences(None);
                        s.settings = false;
                        if !s.conversations[i].loaded && !s.conversations[i].loading {
                            s.load_transcript(200, tx);
                        }
                    }),
            );
        }
        content = content.child(el().grow(1.)).child(
            button("")
                .key("settings")
                .child(icon(&icons::SETTINGS))
                .child(small.line_text("Settings"))
                .on_press(|s: &mut Workspace| s.set_settings(true)),
        );
        if self.update_available {
            content = content.child(button("Update available").key("update-available").on_press(
                |s: &mut Workspace| {
                    s.set_settings(true);
                    s.settings_page("about");
                },
            ));
        }
        let start = self.sidebar_width;
        el().key("sidebar")
            .w(ui(self.sidebar_width))
            .h_full()
            .child(
                col()
                    .key("sidebar-scroll")
                    .w_full()
                    .h_full()
                    .px(ui(8.))
                    .scroll(rune::ScrollSpec {
                        stick_bottom: false,
                    })
                    .child(content),
            )
            .child(
                el().key("sidebar-resize")
                    .pin(None, Some(0.), Some(ui(-2.)), Some(0.))
                    .w(ui(5.))
                    .cursor(rune::Cursor::ResizeColumn)
                    .on_drag(move |s: &mut Workspace, drag, _| {
                        if drag.phase == Phase::Down {
                            s.sidebar_resize = Some(SidebarResize { width: start });
                        }
                        if let Some(resize) = &s.sidebar_resize {
                            s.sidebar_width =
                                (resize.width + drag.dx / crate::zoom::factor()).clamp(188., 340.);
                        }
                        if matches!(drag.phase, Phase::Up) && s.sidebar_resize.take().is_some() {
                            s.persist_workspace_preferences(None);
                        }
                    }),
            )
    }
}
