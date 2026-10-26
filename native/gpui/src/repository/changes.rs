use super::*;
use crate::zoom::ui;

impl RepositoryView {
    pub(super) fn file_entries(&self) -> Vec<(String, String, usize, usize, bool)> {
        let mut files: Vec<_> = if let Some(details) = &self.details {
            details
                .files
                .iter()
                .map(|f| {
                    (
                        f.path.clone(),
                        f.status.clone(),
                        f.additions,
                        f.deletions,
                        false,
                    )
                })
                .collect()
        } else if self.selected.is_none() {
            self.selected_worktree
                .as_ref()
                .and_then(|path| self.graph.worktrees.iter().find(|tree| &tree.path == path))
                .and_then(|tree| tree.status.as_ref())
                .or(self.status.as_ref().filter(|_| {
                    self.selected_worktree
                        .as_ref()
                        .is_none_or(|path| path == &self.cwd)
                }))
                .map(|s| {
                    s.files
                        .iter()
                        .map(|f| {
                            (
                                f.path.clone(),
                                f.status.clone(),
                                f.additions.unwrap_or(0),
                                f.deletions.unwrap_or(0),
                                f.staged,
                            )
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            vec![]
        };
        files.sort_by(|a, b| a.4.cmp(&b.4).then_with(|| a.0.cmp(&b.0)));
        files
    }
    pub(super) fn stage(&mut self, path: Option<String>, staged: bool, cx: &mut Context<Self>) {
        if self.mutating || self.selected.is_some() {
            return;
        }
        self.mutating = true;
        let target = self.selected_worktree.clone();
        let selected = (self.file.clone(), self.selected_staged);
        let changed_path = path.clone();
        let next_selection =
            if path.is_some() && path == self.file && staged == self.selected_staged {
                let files: Vec<_> = self
                    .file_entries()
                    .into_iter()
                    .map(|file| json!({"path":file.0,"staged":file.4}))
                    .collect();
                let next = inferay_presentation::workbench::selection_after_toggle(&json!({
                    "files":files,"selected":{"path":path,"staged":staged}
                }));
                next["path"]
                    .as_str()
                    .map(|path| (path.to_owned(), next["staged"].as_bool().unwrap_or(false)))
            } else {
                None
            };
        let cwd = self.selected_worktree.as_ref().unwrap_or(&self.cwd).clone();
        let work = cx.background_executor().spawn(async move {
            if staged {
                inferay_native_diff::unstage_git(&cwd, path.as_deref())
            } else {
                inferay_native_diff::stage_git(&cwd, path.as_deref())
            }
        });
        self.mutation_task = Some(cx.spawn(async move |this, cx| {
            let success = work.await;
            let _ = this.update(cx, |s, cx| {
                s.mutating = false;
                if success {
                    s.task = None;
                    s.loading = false;
                    if s.selected.is_none() && s.selected_worktree == target {
                        if (s.file.clone(), s.selected_staged) == selected {
                            s.clear_diff();
                            s.file = None;
                            s.show_diff = false;
                            if let Some((path, staged)) = next_selection {
                                s.open_file(path, staged, cx);
                            }
                        } else if let Some(current) = s.file.clone()
                            && (changed_path.is_none() || changed_path.as_ref() == Some(&current))
                        {
                            s.clear_diff();
                            s.open_file(current, s.selected_staged, cx);
                        }
                    }
                    s.refresh(cx);
                } else {
                    s.error = Some(
                        if staged {
                            "Could not unstage changes."
                        } else {
                            "Could not stage changes."
                        }
                        .into(),
                    );
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn files(&self, staged: Option<bool>, cx: &mut Context<Self>) -> impl IntoElement {
        let files: Vec<_> = self
            .file_entries()
            .into_iter()
            .filter(|file| staged.is_none_or(|value| file.4 == value))
            .collect();
        let mut seen_directories = std::collections::HashSet::new();
        div()
            .id(("changed-files", usize::from(staged == Some(true))))
            .track_scroll(&self.files_scroll[usize::from(staged == Some(true))])
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|s, _, _, _| s.keyboard_scope = "sidebar"),
            )
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_y_scroll()
            .when(files.is_empty(), |d| {
                d.child(
                    div()
                        .p(ui(16.))
                        .text_size(ui(12.))
                        .text_color(rgba(0xebebeb80))
                        .child(if self.selected.is_some() && self.details.is_none() {
                            "Loading commit…"
                        } else {
                            "No changes"
                        }),
                )
            })
            .children(files.into_iter().enumerate().map(
                |(i, (path, status, additions, deletions, staged))| {
                    let selected =
                        self.file.as_ref() == Some(&path) && self.selected_staged == staged;
                    let tint = match status.as_str() {
                        "A" | "?" | "??" => colors::ADDED,
                        "D" => colors::DELETED,
                        "R" => colors::RENAMED,
                        _ => colors::MODIFIED,
                    };
                    let mut directories = Vec::new();
                    let mut hidden = false;
                    let mut depth = 0;
                    if self.tree_files {
                        let mut prefix = String::new();
                        let parts: Vec<_> = path.split('/').collect();
                        for part in &parts[..parts.len().saturating_sub(1)] {
                            if !prefix.is_empty() {
                                prefix.push('/');
                            }
                            prefix.push_str(part);
                            if seen_directories.insert(prefix.clone()) && !hidden {
                                let directory = prefix.clone();
                                let collapsed = self.collapsed_directories.contains(&directory);
                                directories.push(
                                    button(
                                        SharedString::from(format!(
                                            "directory-{staged}-{directory}"
                                        )),
                                        *part,
                                    )
                                    .h(ui(26.))
                                    .pl(ui(12. + depth as f32 * 14.))
                                    .child(icon(if collapsed {
                                        "ChevronRight"
                                    } else {
                                        "ChevronDown"
                                    }))
                                    .on_click(cx.listener(move |view, _, _, cx| {
                                        if !view.collapsed_directories.remove(&directory) {
                                            view.collapsed_directories.insert(directory.clone());
                                        }
                                        cx.notify();
                                    }))
                                    .into_any_element(),
                                );
                            }
                            hidden |= self.collapsed_directories.contains(&prefix);
                            depth += 1;
                        }
                    }
                    let label = if self.tree_files {
                        path.rsplit('/').next().unwrap_or(&path).to_owned()
                    } else {
                        path.clone()
                    };
                    let action_path = path.clone();
                    let row = div()
                        .id(SharedString::from(format!("changed-file-{staged}-{i}")))
                        .role(Role::Button)
                        .aria_label(label.clone())
                        .h(ui(26.))
                        .flex()
                        .items_center()
                        .gap(ui(8.))
                        .px(ui(12.))
                        .pl(ui(12. + depth as f32 * 14.))
                        .cursor_pointer()
                        .text_size(ui(11.))
                        .when(selected, |d| d.bg(rgba(0xebebeb17)))
                        .hover(|d| d.bg(rgba(0xebebeb0d)))
                        .child(div().text_color(rgb(tint)).child(status))
                        .child(div().flex_1().min_w_0().text_ellipsis().child(label))
                        .child(
                            div()
                                .text_color(rgb(colors::ADDED))
                                .child(format!("+{additions}")),
                        )
                        .child(
                            div()
                                .text_color(rgb(colors::DELETED))
                                .child(format!("−{deletions}")),
                        )
                        .when(self.selected.is_none(), |d| {
                            d.child(
                                button(SharedString::from(format!("stage-{staged}-{i}")), "")
                                    .aria_label(format!(
                                        "{} {action_path}",
                                        if staged { "Unstage" } else { "Stage" }
                                    ))
                                    .h(ui(22.))
                                    .w(ui(22.))
                                    .p(ui(4.))
                                    .flex_shrink_0()
                                    .justify_center()
                                    .child(
                                        icon(if staged { "Minus" } else { "Plus" }).size(ui(14.)),
                                    )
                                    .when(self.mutating, |d| d.opacity(0.4))
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        cx.stop_propagation();
                                        s.stage(Some(action_path.clone()), staged, cx);
                                    })),
                            )
                        })
                        .on_click(
                            cx.listener(move |s, _, _, cx| s.open_file(path.clone(), staged, cx)),
                        );
                    div().children(directories).when(!hidden, |d| d.child(row))
                },
            ))
    }
    pub(super) fn changes_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let historical = self.selected.is_some();
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .child(
                div()
                    .flex()
                    .items_center()
                    .h(ui(32.))
                    .flex_shrink_0()
                    .px(ui(8.))
                    .border_b_1()
                    .border_color(rgba(0xebebeb0f))
                    .children(
                        [(false, "Path"), (true, "Tree")]
                            .into_iter()
                            .map(|(tree, label)| {
                                button(label, label)
                                    .h(ui(26.))
                                    .when(self.tree_files == tree, |d| d.bg(rgba(0xebebeb17)))
                                    .on_click(cx.listener(move |view, _, _, cx| {
                                        view.tree_files = tree;
                                        cx.notify();
                                    }))
                            }),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .text_size(ui(11.))
                            .text_color(rgb(colors::ADDED))
                            .child(format!(
                                "+{}",
                                self.file_entries().iter().map(|f| f.2).sum::<usize>()
                            )),
                    )
                    .child(
                        div()
                            .ml(ui(8.))
                            .text_size(ui(11.))
                            .text_color(rgb(colors::DELETED))
                            .child(format!(
                                "−{}",
                                self.file_entries().iter().map(|f| f.3).sum::<usize>()
                            )),
                    )
                    .when(historical, |d| {
                        d.child(
                            div()
                                .text_size(ui(colors::CHAT_DETAIL))
                                .text_color(rgba(0xebebeb80))
                                .child(
                                    self.selected
                                        .as_ref()
                                        .map(|s| s.chars().take(7).collect::<String>())
                                        .unwrap_or_default(),
                                ),
                        )
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .when(self.expanded, |d| d.flex_col())
                    .when(historical, |d| {
                        d.child(
                            div()
                                .id("commit-description")
                                .overflow_y_scroll()
                                .min_w_0()
                                .when(!self.expanded, |d| {
                                    d.w(relative(0.5)).flex_shrink_0().h_full().border_r_1()
                                })
                                .when(self.expanded, |d| {
                                    d.max_h(relative(0.4)).w_full().border_b_1()
                                })
                                .border_color(rgba(0xebebeb0f))
                                .p(ui(12.))
                                .text_size(ui(colors::CHAT_SMALL))
                                .when_some(self.details.as_ref(), |d, details| {
                                    d.child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(ui(8.))
                                            .mb(ui(10.))
                                            .child(self.author_avatar(
                                                &details.hash,
                                                &details.author_email,
                                                &details.author,
                                                28.,
                                            ))
                                            .child(
                                                div()
                                                    .min_w_0()
                                                    .child(details.author.clone())
                                                    .child(
                                                    div()
                                                        .text_size(ui(colors::CHAT_DETAIL))
                                                        .text_color(rgba(0xebebeb80))
                                                        .child(
                                                            chrono::DateTime::parse_from_rfc3339(
                                                                &details.authored_at,
                                                            )
                                                            .map(|date| {
                                                                date.with_timezone(&chrono::Local)
                                                                    .format(
                                                                        "%b %-d, %Y · %-I:%M %p",
                                                                    )
                                                                    .to_string()
                                                            })
                                                            .unwrap_or_else(|_| {
                                                                details.authored_at.clone()
                                                            }),
                                                        ),
                                                ),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .mb(ui(6.))
                                            .child(details.message.clone()),
                                    )
                                    .child(
                                        div()
                                            .text_color(rgba(0xebebebb8))
                                            .child(details.body.clone()),
                                    )
                                }),
                        )
                        .child(self.files(None, cx))
                    })
                    .when(!historical, |d| {
                        d.children([false, true].into_iter().map(|staged| {
                            let count =
                                self.file_entries().iter().filter(|f| f.4 == staged).count();
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .min_h_0()
                                .when(staged && !self.expanded, |d| {
                                    d.border_l_1().border_color(rgba(0xebebeb0f))
                                })
                                .when(staged && self.expanded, |d| {
                                    d.border_t_1().border_color(rgba(0xebebeb0f))
                                })
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .h(ui(28.))
                                        .flex_shrink_0()
                                        .px(ui(8.))
                                        .text_size(ui(colors::CHAT_SMALL))
                                        .child(format!(
                                            "{} ({count})",
                                            if staged { "Staged" } else { "Unstaged" }
                                        ))
                                        .child(div().flex_1())
                                        .when(count > 0, |d| {
                                            d.child(
                                                button(
                                                    if staged {
                                                        "unstage-all"
                                                    } else {
                                                        "stage-all"
                                                    },
                                                    if staged {
                                                        "Unstage all"
                                                    } else {
                                                        "Stage all"
                                                    },
                                                )
                                                .h(ui(22.))
                                                .text_size(ui(colors::CHAT_DETAIL))
                                                .on_click(cx.listener(move |s, _, _, cx| {
                                                    s.stage(None, staged, cx)
                                                })),
                                            )
                                        }),
                                )
                                .child(self.files(Some(staged), cx))
                        }))
                    }),
            )
    }
}
