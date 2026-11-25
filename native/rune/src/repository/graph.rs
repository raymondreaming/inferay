use super::changes::label;
use super::*;
use crate::colors::{rgb, rgba};
use crate::ui::{Ink, MEDIUM, button_ink};
use crate::zoom::ui;
use rune::{Cursor, Drag, El, GrowthSpec, Phase, ScrollSpec, col, el, row};
use std::borrow::Cow;
use std::rc::Rc;

use super::branches::branch_drag;
pub(super) use super::branches::{BranchBadge, BranchDrag};

struct GraphLayout {
    order: Vec<String>,
    widths: Value,
    display: Value,
    graph_left: f32,
    image_width: f32,
    width: f32,
}

impl RepositoryView {
    pub(super) fn author_avatar(&self, hash: &str, email: &str, name: &str, diameter: f32) -> El {
        let image = self
            .avatars
            .get(&email.trim().to_lowercase())
            .or_else(|| self.avatars.get(hash));
        let avatar = row()
            .size(ui(diameter), ui(diameter))
            .radius(9999.)
            .clip_rounded(ui(diameter) / 2.)
            .items_center()
            .justify_center();
        match image {
            Some(image) => avatar.child(
                el().w_full()
                    .h_full()
                    .radius(9999.)
                    .pixels_fit(image, rune::SurfaceFit::Fill),
            ),
            None => avatar.child(label(
                Ink::new(diameter * 0.28).weight(MEDIUM),
                name.split_whitespace()
                    .take(2)
                    .filter_map(|word| word.chars().next())
                    .collect::<String>()
                    .to_uppercase(),
            )),
        }
    }

    fn graph_layout(&self) -> (GraphLayout, bool) {
        let mut input = self.preferences.clone();
        input["maxColumn"] = self.presentation["maxColumn"].clone();
        input["pinnedColumns"] = self.presentation["pinnedColumns"].clone();
        input["availableWidth"] = json!(self.viewport_width());
        input["stretch"] = json!(true);
        input["toolsWidth"] = json!(0);
        input["count"] = json!(self.graph.commits.len());
        let layout = inferay_presentation::graph::layout(&input);
        (
            GraphLayout {
                order: layout["visibleOrder"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect(),
                widths: layout["columnWidths"].clone(),
                display: layout["displayColumns"].clone(),
                graph_left: layout["graphLeft"].as_f64().unwrap_or(0.) as f32,
                image_width: 27.
                    + (self.presentation["maxColumn"].as_u64().unwrap_or(0) + 2) as f32 * 18.,
                width: layout["tableWidth"].as_f64().unwrap_or(584.) as f32,
            },
            layout["compact"] == true,
        )
    }

    fn graph_header(&self, layout: &GraphLayout, compact: bool) -> El {
        let ink = Ink::new(9.).line(12.).hex(0xebebeb70);
        let mut header = row()
            .key("graph-header")
            .w(ui(layout.width))
            .h(ui(23.))
            .items_center();
        for column in &layout.order {
            let width = layout.widths[column].as_f64().unwrap_or(100.) as f32;
            let resizing = self
                .column_resize
                .as_ref()
                .is_some_and(|(active, _, _)| active == column);
            let key = column.clone();
            let path = self.path.clone();
            let mut handle = el()
                .key(format!("resize-column-{column}"))
                .pin(None, Some(0.), Some(0.), Some(0.))
                .w(ui(7.))
                .cursor(Cursor::ResizeColumn)
                .border_sides([0., 1., 0., 0.], rgba(0xebebeb30));
            handle = if resizing {
                crate::ui::swap_fill(
                    handle,
                    &format!("resize-column-{column}"),
                    Some(rgba(0x8ab4f850)),
                    rgba(0x8ab4f840),
                )
            } else {
                handle.hover(rgba(0x8ab4f840))
            };
            handle = handle.on_drag(move |s: &mut Workspace, drag: &mut Drag, tx: &mut Tx| {
                let Some(view) = s.repository_views.get_mut(&path) else {
                    return;
                };
                if drag.phase == Phase::Down {
                    view.column_resize = Some((key.clone(), width, compact));
                }
                if let Some((column, start, compact)) = view.column_resize.clone() {
                    let width = start + drag.dx / crate::zoom::factor();
                    view.preferences[if compact { "compactWidths" } else { "widths" }][&column] =
                        inferay_presentation::graph::resize_column(
                            &json!({"column":column,"width":width}),
                        );
                }
                if drag.phase == Phase::Up && view.column_resize.take().is_some() {
                    let preferences = view.preferences.clone();
                    s.repository_event(&path, RepositoryEvent::GraphPreferences(preferences), tx);
                }
            });
            header = header.child(
                row()
                    .h_full()
                    .items_center()
                    .w(ui(width))
                    .px(ui(8.))
                    .child(label(
                        ink,
                        if column == "refs" {
                            "BRANCH".into()
                        } else {
                            column.to_uppercase()
                        },
                    ))
                    .child(handle),
            );
        }
        header
    }

    pub(super) fn graph_table(&self) -> El {
        let (layout, compact) = self.graph_layout();
        let header = self.graph_header(&layout, compact);
        let width = layout.width;
        let layout = Rc::new(layout);
        let path = self.path.clone();
        let key_path = self.path.clone();
        let load_path = self.path.clone();
        let rows = col()
            .key("commit-rows")
            .growth(GrowthSpec::default())
            .virtual_rows_version((
                self.graph.revision.clone(),
                self.graph.commits.len(),
                self.limit,
            ))
            .virtual_rows(
                self.graph.commits.len(),
                ui(23.),
                move |s: &Workspace, i| match s
                    .repository_views
                    .get(&key_path)
                    .and_then(|v| v.graph.commits.get(i))
                {
                    Some(commit) => Cow::Owned(format!("commit-{}", commit.id)),
                    None => Cow::Owned(format!("commit-row-{i}")),
                },
                move |s: &Workspace, i| match s.repository_views.get(&path) {
                    Some(view) if i < view.graph.commits.len() => view.commit_row(i, &layout),
                    _ => el().h(ui(23.)),
                },
            )
            .on_visible_rows(move |s: &mut Workspace, range| {
                let Some(view) = s.repository_views.get_mut(&load_path) else {
                    return false;
                };
                if view.graph.has_more
                    && !view.loading
                    && view.error.is_none()
                    && !view.graph.commits.is_empty()
                    && range.end.saturating_add(20) >= view.graph.commits.len()
                {
                    view.limit += 200;
                    view.refresh();
                    return true;
                }
                false
            });
        col()
            .key("history-table")
            .grow(1.)
            .min_h(0.)
            .clip_rounded(0.)
            .on_background_press(move |s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut() {
                    view.keyboard_scope = "graph";
                }
            })
            .child(
                col()
                    .key("graph-scroll-x")
                    .grow(1.)
                    .min_h(0.)
                    .scroll_x()
                    .child(
                        col().w(ui(width)).h_full().child(header).child(
                            col()
                                .key("commit-history")
                                .grow(1.)
                                .min_h(0.)
                                .scroll(ScrollSpec {
                                    stick_bottom: false,
                                })
                                .child(rows),
                        ),
                    ),
            )
    }

    fn commit_row(&self, index: usize, layout: &GraphLayout) -> El {
        let commit = &self.graph.commits[index];
        let is_commit = commit.item_kind == GitGraphItemKind::Commit;
        let selected = self.selected_item.as_deref() == Some(commit.id.as_str());
        let active = selected;
        let tint = self.commit_tint(commit.color_index);
        let center = 27.
            + layout.display[commit.column]
                .as_f64()
                .unwrap_or(commit.column as f64) as f32
                * 18.;
        let hidden = self.preferences["hiddenRefs"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut refs: Vec<_> = commit
            .refs
            .iter()
            .filter(|r| !hidden.iter().any(|v| v.as_str() == Some(&r.full_name)))
            .collect();
        refs.sort_by_key(|r| {
            !self.preferences["pinnedRefs"]
                .as_array()
                .is_some_and(|pins| pins.iter().any(|v| v.as_str() == Some(&r.full_name)))
        });
        if !is_commit {
            refs.clear();
        }
        let ghost: Option<GitGraphRef> = if refs.is_empty() && active && is_commit {
            commit
                .navigation
                .containing_branch
                .as_ref()
                .and_then(|name| {
                    serde_json::from_value(self.presentation["references"][name].clone()).ok()
                })
                .filter(|r: &GitGraphRef| !hidden.iter().any(|v| v.as_str() == Some(&r.full_name)))
        } else {
            None
        };
        let ghost_visible = ghost.is_some();
        if let Some(reference) = &ghost {
            refs.push(reference);
        }
        let has_connector = !refs.is_empty();
        let width = layout.width;
        let id = commit.id.clone();
        let mut line = row()
            .key(format!("commit-{}", commit.id))
            .role("button")
            .label(if commit.item_kind == GitGraphItemKind::WorktreeWip {
                format!(
                    "{} — {}",
                    commit.message,
                    commit.worktree_path.as_deref().unwrap_or("")
                )
            } else {
                commit.message.clone()
            })
            .w(ui(width))
            .h(ui(23.))
            .items_center()
            .cursor(Cursor::Pointer);
        let band_color = rgba((tint << 8) | 107);
        let (band_fill, band_hover) = crate::ui::hover_fill(
            &format!("graph-band-{}-{}", self.path, commit.id),
            selected.then_some(band_color),
            band_color,
        );
        if self.preferences["columns"]["graph"] != false {
            line = line.child(
                el().pin(Some(ui(layout.graph_left + center)), Some(0.), None, None)
                    .h(ui(23.))
                    .w(ui((width - layout.graph_left - center).max(0.)))
                    .live_fill(&band_fill),
            );
        }
        for column in &layout.order {
            let w = layout.widths[column].as_f64().unwrap_or(100.) as f32;
            let cell = row().w(ui(w)).h(ui(23.)).items_center();
            line = line.child(match column.as_str() {
                "graph" => {
                    // Keyed so the selection-only connector never hands its fill
                    // transition to the lane image when it disappears.
                    let mut cell = cell.clip_rounded(0.);
                    if has_connector {
                        cell = cell.child(
                            el().key("graph-connector")
                                .pin(Some(0.), Some(ui(11.)), None, None)
                                .w(ui(center))
                                .h(ui(1.))
                                .fill(rgb(tint)),
                        );
                    }
                    let mut image = el().key("graph-lanes").w(ui(layout.image_width)).h(ui(23.));
                    if let Some(picture) = self.graph_images.get(index) {
                        image = image.pixels(&picture.pixels);
                    }
                    cell = cell.child(image);
                    if is_commit && commit.parents.len() <= 1 {
                        cell = cell.child(
                            col()
                                .pin(Some(ui(center - 7.)), Some(ui(4.5)), None, None)
                                .child(self.author_avatar(
                                    &commit.hash,
                                    &commit.author_email,
                                    &commit.author,
                                    14.,
                                )),
                        );
                    }
                    cell
                }
                "refs" => self.refs_cell(
                    cell,
                    commit,
                    index,
                    &refs,
                    ghost_visible,
                    tint,
                    has_connector,
                ),
                "message" => {
                    let content = ui(w) - ui(24.);
                    let text = if commit.item_kind == GitGraphItemKind::WorktreeWip {
                        format!(
                            "WIP · {} files · {}",
                            commit
                                .change_summary
                                .as_ref()
                                .map_or(0, |summary| summary.files),
                            self.graph
                                .worktrees
                                .iter()
                                .find(|w| Some(&w.path) == commit.worktree_path.as_ref())
                                .and_then(|w| w.branch.as_deref())
                                .unwrap_or("detached HEAD")
                        )
                    } else {
                        commit.message.clone()
                    };
                    let mut cell = cell.px(ui(12.)).gap(ui(8.)).clip_rounded(0.).child(
                        Ink::new(11.)
                            .line_text(text)
                            .shrink()
                            .max_w(content * if commit.body.is_empty() { 1. } else { 0.64 }),
                    );
                    if !commit.body.is_empty() && commit.item_kind != GitGraphItemKind::WorktreeWip
                    {
                        cell = cell.child(
                            Ink::small()
                                .hex(0xebebeb80)
                                .line_text(format!(
                                    "— {}",
                                    commit.body.split_whitespace().collect::<Vec<_>>().join(" ")
                                ))
                                .grow(1.)
                                .shrink(),
                        );
                    }
                    cell
                }
                _ => cell.px(ui(8.)).child(
                    Ink::detail()
                        .hex(0xebebeb80)
                        .line_text(match column.as_str() {
                            "date" => {
                                if commit.item_kind == GitGraphItemKind::WorktreeWip {
                                    String::new()
                                } else {
                                    chrono::DateTime::parse_from_rfc3339(&commit.committed_at)
                                        .map(|date| {
                                            date.with_timezone(&chrono::Local)
                                                .format("%m/%d/%Y %-I:%M %p")
                                                .to_string()
                                        })
                                        .unwrap_or_else(|_| commit.date.clone())
                                }
                            }
                            "author" => commit.author.clone(),
                            "sha" => commit.hash.chars().take(7).collect(),
                            _ => commit.message.clone(),
                        })
                        .shrink(),
                ),
            });
        }
        let hover_id = id.clone();
        // Only real pointer movement lights the band: rows that keyboard navigation
        // scrolls under a resting pointer stay unhovered beside the selection.
        let band_hover = std::rc::Rc::new(band_hover);
        let band_leave = band_hover.clone();
        line = line
            .on_pointer_move_any(move |_, tx| band_hover(true, tx))
            .on_hover_change_any(move |inside, tx| {
                if inside {
                    tx.live_only();
                } else {
                    band_leave(false, tx);
                }
            })
            .on_press_tx(act(&self.path, move |view, _| {
                view.keyboard_scope = "graph";
                view.keyboard_active = true;
                view.select_commit_id(&hover_id)
            }));
        if is_commit {
            let hash = commit.hash.clone();
            let refs = commit.refs.clone();
            let path = self.path.clone();
            line = line.on_secondary_press(move |s: &mut Workspace, press, _| {
                if let Some(view) = s.repository_views.get_mut(&path) {
                    view.git_menu = Some((
                        MenuAnchor::Point(press.x, press.y),
                        hash.clone(),
                        refs.clone(),
                    ));
                    view.branch_menu = None;
                    view.branch_menu_task = None;
                }
            });
        }
        line
    }

    #[allow(clippy::too_many_arguments)]
    fn refs_cell(
        &self,
        cell: El,
        commit: &GraphCommit,
        index: usize,
        refs: &[&GitGraphRef],
        ghost_visible: bool,
        tint: u32,
        has_connector: bool,
    ) -> El {
        let mut cell = cell.clip_rounded(0.).px(ui(8.));
        if let Some(primary) = refs.first().copied() {
            let companion = refs
                .iter()
                .skip(1)
                .filter(|r| {
                    r.kind == GitGraphRefKind::RemoteBranch
                        && primary.kind != GitGraphRefKind::RemoteBranch
                        && r.label == primary.label
                })
                .count();
            let extra = refs.len() - 1 - companion;
            let badge = BranchBadge {
                label: primary.label.clone(),
                tint,
                is_head: primary.is_head,
                companion: companion > 0,
                ghost: ghost_visible,
            };
            let branch = primary.full_name.starts_with("refs/heads/")
                || primary.kind == GitGraphRefKind::RemoteBranch;
            let name = primary
                .full_name
                .strip_prefix("refs/heads/")
                .unwrap_or(&primary.full_name)
                .to_owned();
            let highlight = branch
                && self.branch_drag.as_ref().is_some_and(|drag| {
                    drag.active && drag.target.as_deref() == Some(name.as_str())
                });
            let hash = primary.target.clone();
            let references = if ghost_visible {
                vec![primary.clone()]
            } else {
                commit.refs.clone()
            };
            let path = self.path.clone();
            let id = commit.id.clone();
            let mut element = badge
                .element(highlight)
                .key(format!("branch-label-{}", primary.full_name))
                .role("button")
                .label(format!("Reference {}", primary.display_name))
                .on_secondary_press(move |s: &mut Workspace, press, _| {
                    if let Some(view) = s.repository_views.get_mut(&path) {
                        view.branch_menu = None;
                        view.branch_menu_task = None;
                        view.git_menu = Some((
                            MenuAnchor::Point(press.x, press.y),
                            hash.clone(),
                            references.clone(),
                        ));
                    }
                })
                .on_press_tx(act(&self.path, move |view, _| {
                    view.keyboard_scope = "graph";
                    view.keyboard_active = true;
                    view.select_commit_id(&id)
                }));
            if branch {
                element = element.on_drag(branch_drag(&self.path, name, badge, false));
            }
            cell = cell.child(element);
            if extra > 0 {
                let hash = commit.hash.clone();
                let references = commit.refs.clone();
                let path = self.path.clone();
                cell = cell.child(
                    button_ink(&format!("+{extra}"), Ink::small().hex(0xebebebb8))
                        .key(format!("extra-refs-{index}"))
                        .px(ui(4.))
                        .on_drag(move |s: &mut Workspace, drag: &mut Drag, _: &mut Tx| {
                            if drag.phase != Phase::Up
                                || drag.cancelled()
                                || drag.dx.hypot(drag.dy) > 4.
                            {
                                return;
                            }
                            if let Some(view) = s.repository_views.get_mut(&path) {
                                let [x, y] = drag.window_point();
                                view.branch_menu = None;
                                view.branch_menu_task = None;
                                view.git_menu = Some((
                                    MenuAnchor::Point(x, y),
                                    hash.clone(),
                                    references.clone(),
                                ));
                            }
                        }),
                );
            }
        }
        if has_connector {
            cell = cell.child(
                el().grow(1.)
                    .min_w(ui(4.))
                    .h(ui(1.))
                    .mr(ui(-8.))
                    .fill(rgb(tint)),
            );
        }
        cell
    }
}

#[cfg(test)]
#[path = "graph_tests.rs"]
mod tests;
