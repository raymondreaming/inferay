use super::*;
use crate::colors::{self, rgb, rgba};
use crate::icons;
use crate::ui::{Ink, button, icon_sized, plain_button};
use crate::zoom::ui;
use rune::{El, ScrollSpec, col, el, row};
use std::borrow::Cow;
use std::rc::Rc;

/// Path, status, additions, deletions, staged, and the path a rename came from.
pub(super) type FileEntry = (String, String, usize, usize, bool, Option<String>);

pub(super) fn label(ink: Ink, content: impl Into<String>) -> El {
    rune::text(content).font(ink.style()).color(ink.color)
}

pub(super) fn toggle_button(key: &str, selected: bool) -> El {
    let button = plain_button("").key(key.to_owned());
    if selected {
        crate::ui::swap_fill(button, key, Some(rgba(0xebebeb20)), rgba(0xffffff0d))
    } else {
        button.hover(rgba(0xffffff0d))
    }
}

pub(super) fn border_left(el: El, hex: u32) -> El {
    el.border_sides([0., 0., 0., 1.], rgba(hex)).border_layout()
}

pub(super) fn border_top(el: El, hex: u32) -> El {
    el.border_sides([1., 0., 0., 0.], rgba(hex)).border_layout()
}

pub(super) fn border_bottom(el: El, hex: u32) -> El {
    el.border_sides([0., 0., 1., 0.], rgba(hex)).border_layout()
}

pub(super) fn border_right(el: El, hex: u32) -> El {
    el.border_sides([0., 1., 0., 0.], rgba(hex)).border_layout()
}

enum FileRow {
    Directory {
        name: String,
        directory: String,
        collapsed: bool,
        staged: bool,
        depth: usize,
        changes: [usize; 3],
    },
    File {
        index: usize,
        file: FileEntry,
        depth: usize,
    },
}

struct FileList {
    path: String,
    rows: Vec<FileRow>,
    selected: Option<(String, bool)>,
    stageable: bool,
    mutating: bool,
    tree: bool,
}

impl FileList {
    fn key(&self, i: usize) -> String {
        match &self.rows[i] {
            FileRow::Directory {
                directory, staged, ..
            } => format!("directory-{staged}-{directory}"),
            FileRow::File { index, file, .. } => format!("changed-file-{}-{index}", file.4),
        }
    }

    fn row(&self, i: usize) -> El {
        let (index, (path, status, additions, deletions, staged, original), depth) = match &self
            .rows[i]
        {
            FileRow::Directory {
                name,
                directory,
                collapsed,
                depth,
                changes,
                ..
            } => {
                let directory = directory.clone();
                let mut folder = button(name)
                    .key(self.key(i))
                    .h(ui(26.))
                    .pl(ui(12. + *depth as f32 * 14.))
                    .child(crate::ui::icon(if *collapsed {
                        &icons::CHEVRON_RIGHT
                    } else {
                        &icons::CHEVRON_DOWN
                    }));
                if *collapsed {
                    for ((glyph, tint), count) in [
                        (&icons::PENCIL, colors::MODIFIED),
                        (&icons::PLUS, colors::ADDED),
                        (&icons::MINUS, colors::DELETED),
                    ]
                    .into_iter()
                    .zip(*changes)
                    .filter(|(_, count)| *count > 0)
                    {
                        folder = folder.child(
                            row()
                                .items_center()
                                .gap(ui(3.))
                                .ml(ui(6.))
                                .child(icon_sized(glyph, 12.).color(rgb(tint)))
                                .child(label(Ink::new(11.).color(rgb(tint)), count.to_string())),
                        );
                    }
                }
                return folder.on_press_tx(act(&self.path, move |view, _| {
                    if !view.collapsed_directories.remove(&directory) {
                        view.collapsed_directories.insert(directory.clone());
                    }
                    view.keyboard_scope = "sidebar";
                }));
            }
            FileRow::File { index, file, depth } => (index, file, depth),
        };
        let staged = *staged;
        let selected = self
            .selected
            .as_ref()
            .is_some_and(|(file, in_index)| file == path && *in_index == staged);
        let (glyph, tint, change) = match status.as_str() {
            "A" | "?" | "??" => (&icons::PLUS, colors::ADDED, "Added"),
            "D" => (&icons::MINUS, colors::DELETED, "Deleted"),
            status if status.starts_with('R') => (&icons::RENAME, colors::RENAMED, "Renamed"),
            _ => (&icons::PENCIL, colors::MODIFIED, "Modified"),
        };
        let ink = Ink::new(11.);
        let mut name = row().grow(1.).shrink().clip_rounded(0.).items_center();
        if !self.tree {
            name = name.child(
                row()
                    .grow(1.)
                    .shrink()
                    .clip_rounded(0.)
                    .justify_end()
                    .child(label(
                        ink.hex(0xebebeb80),
                        path.rfind('/')
                            .map(|end| path[..end + 1].to_owned())
                            .unwrap_or_default(),
                    )),
            );
        }
        name = name.child(
            ink.color(rgb(0xffffff))
                .line_text(path.rsplit('/').next().unwrap_or(path).to_owned())
                .shrink(),
        );
        let fill_key = format!("changed-file-{staged}-{index}");
        let mut file_row = row()
            .key(fill_key.clone())
            .role("button")
            .label(match original {
                Some(original) => format!("{change}: {original} → {path}"),
                None => format!("{change}: {path}"),
            })
            .h(ui(26.))
            .items_center()
            .gap(ui(8.))
            .pr(ui(12.))
            .pl(ui(12. + *depth as f32 * 14.))
            .cursor(rune::Cursor::Pointer);
        file_row = if selected {
            crate::ui::swap_fill(
                file_row,
                &fill_key,
                Some(rgba(0xebebeb17)),
                rgba(0xebebeb0d),
            )
        } else {
            file_row.hover(rgba(0xebebeb0d))
        };
        file_row = file_row
            .child(icon_sized(glyph, 12.).color(rgb(tint)))
            .child(name)
            .child(label(
                ink.color(rgb(colors::ADDED)),
                format!("+{additions}"),
            ))
            .child(label(
                ink.color(rgb(colors::DELETED)),
                format!("−{deletions}"),
            ));
        if self.stageable {
            let action_path = path.clone();
            let mut stage = button("")
                .key(format!("stage-{staged}-{index}"))
                .label(format!(
                    "{} {action_path}",
                    if staged { "Unstage" } else { "Stage" }
                ))
                .h(ui(22.))
                .w(ui(22.))
                .padding(ui(4.))
                .justify_center()
                .child(icon_sized(
                    if staged { &icons::MINUS } else { &icons::PLUS },
                    14.,
                ))
                .on_press_tx(act(&self.path, move |view, _| {
                    view.keyboard_scope = "sidebar";
                    view.stage(Some(action_path.clone()), staged)
                }));
            if self.mutating {
                stage = stage.opacity(0.4);
            }
            file_row = file_row.child(stage);
        }
        let open_path = path.clone();
        file_row.on_press_tx(act(&self.path, move |view, tx| {
            view.keyboard_scope = "sidebar";
            view.open_file(open_path.clone(), staged, tx)
        }))
    }
}

impl RepositoryView {
    pub(super) fn file_entries(&self) -> Vec<FileEntry> {
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
                        f.original_path.clone(),
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
                        .is_none_or(|path| path == &self.path)
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
                                f.original_path.clone(),
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

    pub(super) fn stage(&mut self, path: Option<String>, staged: bool) {
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
        let cwd = self.work_cwd();
        self.mutation_task = Some(self.spawn(
            move || {
                if staged {
                    inferay_native_diff::unstage_git(&cwd, path.as_deref())
                } else {
                    inferay_native_diff::stage_git(&cwd, path.as_deref())
                }
            },
            move |s, success, tx| {
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
                                s.open_file(path, staged, tx);
                            }
                        } else if let Some(current) = s.file.clone()
                            && (changed_path.is_none() || changed_path.as_ref() == Some(&current))
                        {
                            s.clear_diff();
                            s.open_file(current, s.selected_staged, tx);
                        }
                    }
                    s.refresh();
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
            },
        ));
    }

    fn files(&self, staged: Option<bool>) -> El {
        let group = usize::from(staged == Some(true));
        let files: Vec<_> = self
            .file_entries()
            .into_iter()
            .filter(|file| staged.is_none_or(|value| file.4 == value))
            .collect();
        let list = col()
            .key(format!("changed-files-{group}"))
            .grow(1.)
            .min_h(0.)
            .min_w(0.)
            .scroll(ScrollSpec {
                stick_bottom: false,
            })
            .on_background_press(move |s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut() {
                    view.keyboard_scope = "sidebar";
                }
            });
        if files.is_empty() {
            return list.child(
                col()
                    .padding(ui(16.))
                    .child(Ink::new(12.).hex(0xebebeb80).text(
                        if self.selected.is_some() && self.details.is_none() {
                            "Loading commit…"
                        } else {
                            "No changes"
                        },
                    )),
            );
        }
        let mut changes: HashMap<String, [usize; 3]> = HashMap::new();
        if self.tree_files {
            for file in &files {
                let kind = match file.1.as_str() {
                    "A" | "?" | "??" => 1,
                    "D" => 2,
                    _ => 0,
                };
                for (end, _) in file.0.match_indices('/') {
                    changes.entry(file.0[..end].to_owned()).or_default()[kind] += 1;
                }
            }
        }
        let mut rows = Vec::new();
        let mut seen_directories = HashSet::new();
        for (index, file) in files.into_iter().enumerate() {
            let mut hidden = false;
            let mut depth = 0;
            if self.tree_files {
                let mut prefix = String::new();
                let parts: Vec<_> = file.0.split('/').collect();
                for part in &parts[..parts.len().saturating_sub(1)] {
                    if !prefix.is_empty() {
                        prefix.push('/');
                    }
                    prefix.push_str(part);
                    if seen_directories.insert(prefix.clone()) && !hidden {
                        rows.push(FileRow::Directory {
                            name: (*part).to_owned(),
                            directory: prefix.clone(),
                            collapsed: self.collapsed_directories.contains(&prefix),
                            staged: file.4,
                            depth,
                            changes: changes.get(&prefix).copied().unwrap_or_default(),
                        });
                    }
                    hidden |= self.collapsed_directories.contains(&prefix);
                    depth += 1;
                }
            }
            if !hidden {
                rows.push(FileRow::File { index, file, depth });
            }
        }
        let rows = Rc::new(FileList {
            path: self.path.clone(),
            rows,
            selected: self.file.clone().map(|file| (file, self.selected_staged)),
            stageable: self.selected.is_none(),
            mutating: self.mutating,
            tree: self.tree_files,
        });
        let keys = rows.clone();
        list.child(
            col()
                .key(format!("changed-file-rows-{group}"))
                .growth(rune::GrowthSpec::default())
                .virtual_rows(
                    rows.rows.len(),
                    ui(26.),
                    move |_: &Workspace, i| Cow::Owned(keys.key(i)),
                    move |_: &Workspace, i| rows.row(i),
                ),
        )
    }

    fn commit_description(&self, body_height: Option<f32>) -> El {
        let on_right = self.changes_on_right();
        let mut description = col()
            .key("commit-description")
            .scroll(ScrollSpec {
                stick_bottom: false,
            })
            .min_w(0.)
            .padding(ui(12.));
        description = if on_right {
            let mut d = border_bottom(description.w_full(), 0xebebeb0f);
            if let Some(height) = body_height {
                d = d.max_h(height * 0.4);
            }
            d
        } else {
            border_right(description.w_frac(0.5).h_full(), 0xebebeb0f)
        };
        let mut content = col();
        if let Some(details) = self.details.as_ref() {
            let small = Ink::small();
            let detail = Ink::detail().hex(0xebebeb80);
            let hash = details.hash.clone();
            content = content
                .child(
                    row()
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
                            col()
                                .min_w(0.)
                                .child(label(small, details.author.clone()))
                                .child(
                                    row()
                                        .items_center()
                                        .gap(ui(4.))
                                        .child(label(
                                            detail,
                                            details.hash.chars().take(7).collect::<String>(),
                                        ))
                                        .child(
                                            button("")
                                                .key("copy-commit-hash")
                                                .label("Copy commit hash")
                                                .h(ui(20.))
                                                .px(ui(3.))
                                                .child(icon_sized(&icons::COPY, 12.))
                                                .on_press_tx(move |_: &mut Workspace, tx| {
                                                    tx.copy(hash.clone())
                                                }),
                                        ),
                                )
                                .child(label(
                                    detail,
                                    chrono::DateTime::parse_from_rfc3339(&details.authored_at)
                                        .map(|date| {
                                            date.with_timezone(&chrono::Local)
                                                .format("%b %-d, %Y · %-I:%M %p")
                                                .to_string()
                                        })
                                        .unwrap_or_else(|_| details.authored_at.clone()),
                                )),
                        ),
                )
                .child(
                    col().mb(ui(6.)).child(
                        small
                            .weight(crate::ui::MEDIUM)
                            .text(details.message.clone()),
                    ),
                )
                .child(small.hex(0xebebebb8).text(details.body.clone()));
        }
        description.child(content)
    }

    pub(super) fn changes_panel(&self) -> El {
        let historical = self.selected.is_some();
        let entries = self.file_entries();
        let mut header = border_bottom(row().items_center().h(ui(32.)).px(ui(8.)), 0xebebeb0f);
        for (tree, label_text) in [(false, "Path"), (true, "Tree")] {
            let selected = self.tree_files == tree;
            let mut ink = Ink::new(11.);
            if selected {
                ink = ink.color(rgb(0xffffff));
            }
            header = header.child(
                toggle_button(label_text, selected)
                    .role("radio")
                    .label(label_text)
                    .checked(selected)
                    .h(ui(24.))
                    .px(ui(6.))
                    .child(icon_sized(
                        if tree {
                            &icons::FILE_TREE
                        } else {
                            &icons::FILE_PATH
                        },
                        14.,
                    ))
                    .child(ink.line_text(label_text))
                    .on_press_tx(act(&self.path, move |view, _| view.tree_files = tree)),
            );
        }
        header = header
            .child(el().grow(1.))
            .child(label(
                Ink::new(11.).color(rgb(colors::ADDED)),
                format!("+{}", entries.iter().map(|f| f.2).sum::<usize>()),
            ))
            .child(col().ml(ui(8.)).child(label(
                Ink::new(11.).color(rgb(colors::DELETED)),
                format!("−{}", entries.iter().map(|f| f.3).sum::<usize>()),
            )));
        let on_right = self.changes_on_right();
        let body_height = rune::memo::layout_size("git-changes-body").map(|size| size[1]);
        let mut body = if on_right { col() } else { row() }
            .key("git-changes-body")
            .grow(1.)
            .min_h(0.)
            .min_w(0.);
        if historical {
            body = body
                .child(self.commit_description(body_height))
                .child(self.files(None));
        } else {
            for staged in [false, true] {
                let count = entries.iter().filter(|f| f.4 == staged).count();
                let mut group = col()
                    .key(if staged {
                        "staged-files"
                    } else {
                        "unstaged-files"
                    })
                    .grow(1.)
                    .min_w(0.)
                    .min_h(0.);
                if staged && !on_right {
                    group = border_left(group, 0xebebeb0f);
                }
                if staged && on_right {
                    group = border_top(group, 0xebebeb0f);
                }
                let mut title = row()
                    .items_center()
                    .h(ui(28.))
                    .px(ui(8.))
                    .child(label(
                        Ink::small(),
                        format!("{} ({count})", if staged { "Staged" } else { "Unstaged" }),
                    ))
                    .child(el().grow(1.));
                if count > 0 {
                    let text = if staged { "Unstage all" } else { "Stage all" };
                    title = title.child(
                        crate::ui::button_ink(text, Ink::detail())
                            .key(if staged { "unstage-all" } else { "stage-all" })
                            .h(ui(22.))
                            .on_press_tx(act(&self.path, move |view, _| view.stage(None, staged))),
                    );
                }
                body = body.child(group.child(title).child(self.files(Some(staged))));
            }
        }
        let mut panel = col().w_full().h_full().min_h(0.).child(header).child(body);
        if !historical {
            panel = panel.child(self.commit_panel());
        }
        panel
    }
}
