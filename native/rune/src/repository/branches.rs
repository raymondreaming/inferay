use super::changes::label;
use super::*;
use crate::colors::{rgb, rgba};
use crate::ui::{Ink, button, menu_surface};
use crate::zoom::ui;
use rune::{Cursor, Drag, El, Phase, col, row};

#[derive(Clone)]
pub(super) struct BranchBadge {
    pub(super) label: String,
    pub(super) tint: u32,
    pub(super) is_head: bool,
    pub(super) companion: bool,
    pub(super) ghost: bool,
}

impl BranchBadge {
    pub(super) fn element(&self, highlight: bool) -> El {
        let fill = if highlight {
            rgb(0x405a80)
        } else {
            rgba((self.tint << 8) | if self.is_head { 128 } else { 64 })
        };
        let ink = Ink::detail().hex(if self.is_head { 0xffffffff } else { 0xffffff80 });
        let mut badge = row()
            .items_center()
            .gap(ui(4.))
            .shrink()
            .clip_rounded(ui(2.))
            .px(ui(6.))
            .h(ui(17.))
            .radius(ui(2.))
            .fill(fill)
            .child(ink.line_text(self.label.clone()).shrink());
        if self.ghost {
            badge = badge.opacity(0.36);
        }
        if self.companion {
            badge = badge.child(label(ink, "↗"));
        }
        badge
    }
}

#[derive(Clone)]
pub(super) struct BranchDrag {
    pub(super) cwd: String,
    pub(super) name: String,
    pub(super) badge: BranchBadge,
    pub(super) from_menu: bool,
    pub(super) grab: [f32; 2],
    pub(super) pointer: [f32; 2],
    pub(super) active: bool,
    pub(super) target: Option<String>,
}

fn drop_target(view: &RepositoryView, path: &str) -> Option<String> {
    view.graph
        .commits
        .iter()
        .flat_map(|commit| commit.refs.iter())
        .filter(|r| {
            r.full_name.starts_with("refs/heads/") || r.kind == GitGraphRefKind::RemoteBranch
        })
        .filter(|r| {
            let key = format!("branch-label-{}", r.full_name);
            path.match_indices(&key).any(|(at, _)| {
                let rest = &path[at + key.len()..];
                rest.is_empty() || rest.starts_with('/')
            })
        })
        .max_by_key(|r| r.full_name.len())
        .map(|r| {
            r.full_name
                .strip_prefix("refs/heads/")
                .unwrap_or(&r.full_name)
                .to_owned()
        })
}

pub(super) fn branch_drag(
    path: &str,
    name: String,
    badge: BranchBadge,
    from_menu: bool,
) -> impl Fn(&mut Workspace, &mut Drag, &mut Tx) + 'static {
    let path = path.to_owned();
    move |s: &mut Workspace, drag: &mut Drag, tx: &mut Tx| {
        let Some(view) = s.repository_views.get_mut(&path) else {
            return;
        };
        match drag.phase {
            Phase::Down => {
                if drag.clicks == 2 && !from_menu {
                    view.branch_drag = None;
                    view.run_branch_action("checkout", name.clone(), String::new());
                    return;
                }
                if view.mutating {
                    return;
                }
                view.branch_drag = Some(BranchDrag {
                    cwd: view.path.clone(),
                    name: name.clone(),
                    badge: badge.clone(),
                    from_menu,
                    grab: [drag.start_x, drag.start_y],
                    pointer: drag.window_point(),
                    active: false,
                    target: None,
                });
            }
            Phase::Up => {
                let Some(state) = view.branch_drag.take() else {
                    return;
                };
                if state.from_menu && state.active {
                    view.git_menu = None;
                }
                if !state.active || drag.cancelled() {
                    return;
                }
                let [x, y] = drag.window_point();
                view.branch_menu_position = (x, y);
                let path = path.clone();
                tx.element_at_in(
                    "commit-history",
                    x,
                    y,
                    move |s: &mut Workspace, picked, _| {
                        if let Some(view) = s.repository_views.get_mut(&path)
                            && let Some(picked) = picked
                            && let Some(target) = drop_target(view, picked.path())
                            && state.cwd == view.path
                        {
                            view.open_branch_menu(state.name.clone(), target);
                        }
                    },
                );
            }
            _ => {
                let Some(state) = view.branch_drag.as_mut() else {
                    return;
                };
                state.pointer = drag.window_point();
                if !state.active && drag.dx.hypot(drag.dy) < 2. {
                    return;
                }
                state.active = true;
                let [x, y] = state.pointer;
                let path = path.clone();
                tx.element_at_in(
                    "commit-history",
                    x,
                    y,
                    move |s: &mut Workspace, picked, _| {
                        if let Some(view) = s.repository_views.get_mut(&path) {
                            let target = picked.and_then(|picked| drop_target(view, picked.path()));
                            if let Some(state) = view.branch_drag.as_mut() {
                                state.target = target;
                            }
                        }
                    },
                );
            }
        }
    }
}

impl RepositoryView {
    pub(super) fn open_branch_menu(&mut self, source: String, target: String) {
        if self.mutating || source == target {
            return;
        }
        self.branch_menu = None;
        self.git_menu = None;
        let cwd = self.path.clone();
        self.branch_menu_task = Some(self.spawn(
            move || inferay_native_diff::preflight_git_ref_operation(&cwd, &source, &target),
            |view, menu, _| {
                view.branch_menu_task = None;
                view.branch_menu = Some(menu);
            },
        ));
    }

    pub(super) fn branch_menu(&self) -> El {
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
        let mut popup = menu_surface()
            .key("branch-operation-menu")
            .w(ui(360.))
            .modal(true, |s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut() {
                    view.branch_menu = None;
                }
            });
        for (operation, text, enabled) in [
            (
                "merge",
                format!("Merge {source} into {}", local_destination(&menu.target)),
                menu.can_merge,
            ),
            (
                "fastForward",
                format!(
                    "Fast-forward {} to {source}",
                    local_destination(&menu.target)
                ),
                menu.can_fast_forward,
            ),
            (
                "rebase",
                format!("Rebase {} onto {target}", local_destination(&menu.source)),
                menu.can_rebase,
            ),
        ] {
            let source = menu.source.clone();
            let target = menu.target.clone();
            let mut entry = row()
                .key(format!("branch-operation-{operation}"))
                .role("button")
                .label(text.clone())
                .focusable(true)
                .no_focus_ring()
                .items_center()
                .gap(ui(6.))
                .px(ui(9.))
                .w_full()
                .min_h(ui(28.))
                .py(ui(5.))
                .radius(ui(6.))
                .cursor(Cursor::Pointer)
                .hover(rgba(0xffffff0d))
                .child(Ink::small().line(17.).text(text).grow(1.).shrink())
                .on_press_tx(act(&self.path, move |view, _| {
                    if enabled {
                        view.run_branch_action(operation, source.clone(), target.clone());
                    }
                }));
            if !enabled {
                entry = entry.opacity(0.4);
            }
            popup = popup.child(entry);
        }
        if menu.source.starts_with("refs/remotes/") || menu.target.starts_with("refs/remotes/") {
            popup = popup.child(col().px(ui(8.)).py(ui(4.)).child(Ink::new(11.).text(
                "Remote destinations use a local tracking branch, creating it if needed. Nothing is pushed.",
            )));
        }
        for reason in &menu.reasons {
            popup = popup.child(
                col()
                    .px(ui(8.))
                    .py(ui(4.))
                    .child(Ink::new(11.).text(reason.clone())),
            );
        }
        popup
    }

    pub(super) fn column_menu(&self) -> El {
        let mut menu = menu_surface()
            .key("graph-column-menu")
            .pin(None, Some(ui(32.)), Some(ui(8.)), None)
            .w(ui(200.))
            .modal(true, |s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut() {
                    view.columns_menu = false;
                }
            })
            .child(
                col()
                    .px(ui(9.))
                    .py(ui(6.))
                    .child(Ink::new(11.).hex(0xebebeb80).text("Show columns")),
            );
        for (key, text) in [
            ("date", "Date"),
            ("refs", "Branch"),
            ("graph", "Graph"),
            ("message", "Message"),
            ("author", "Author"),
            ("sha", "SHA"),
        ] {
            let visible = self.preferences["columns"][key].as_bool().unwrap_or(true);
            let path = self.path.clone();
            menu = menu.child(
                button("")
                    .key(format!("column-{key}"))
                    .label(format!("{} {text}", if visible { "Hide" } else { "Show" }))
                    .child(
                        row()
                            .w(ui(16.))
                            .child(label(Ink::small(), if visible { "✓" } else { "" })),
                    )
                    .child(label(Ink::small(), text))
                    .on_press_tx(move |s: &mut Workspace, tx| {
                        let Some(view) = s.repository_views.get_mut(&path) else {
                            return;
                        };
                        let visible = view.preferences["columns"][key].as_bool().unwrap_or(true);
                        if visible
                            && view.preferences["columns"]
                                .as_object()
                                .is_some_and(|columns| {
                                    columns.values().filter(|v| **v == true).count() == 1
                                })
                        {
                            return;
                        }
                        view.preferences["columns"][key] = json!(!visible);
                        let preferences = view.preferences.clone();
                        s.repository_event(
                            &path,
                            RepositoryEvent::GraphPreferences(preferences),
                            tx,
                        );
                    }),
            );
        }
        menu
    }
}
