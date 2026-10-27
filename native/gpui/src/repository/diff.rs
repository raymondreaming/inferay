use super::*;

type LineStyles = Vec<(std::ops::Range<usize>, HighlightStyle)>;

#[derive(Clone)]
pub(super) struct PreparedDiff {
    pub(super) diff: Arc<GitHunkDiff>,
    pub(super) path: SharedString,
    pub(super) theme: String,
    pub(super) old: Arc<[LineStyles]>,
    pub(super) new: Arc<[LineStyles]>,
    pub(super) inline: Arc<[GitDiffLine]>,
    inline_sources: Arc<[Option<(bool, usize)>]>,
    pub(super) colored: bool,
    split_ranges: Arc<[[usize; 2]]>,
    inline_ranges: Arc<[[usize; 2]]>,
    split_minimap: Arc<[inferay_native_diff::MinimapSegment]>,
    inline_minimap: Arc<[inferay_native_diff::MinimapSegment]>,
}
impl PreparedDiff {
    pub(super) fn classify(lines: &[GitDiffLine], path: &str, theme: &str) -> Vec<LineStyles> {
        let source: Vec<_> = lines
            .iter()
            .map(|line| {
                if matches!(
                    line.line_type,
                    GitDiffLineType::Hunk | GitDiffLineType::Spacer
                ) {
                    ""
                } else {
                    line.content.as_str()
                }
            })
            .collect();
        crate::syntax::line_highlights(&source, path, theme)
    }

    #[cfg(test)]
    pub(super) fn new(diff: GitHunkDiff, path: &str, theme: &str) -> Self {
        Self::plain(diff, path, theme).retheme(theme)
    }
    pub(super) fn plain(diff: GitHunkDiff, path: &str, theme: &str) -> Self {
        let inline: Arc<[GitDiffLine]> = diff
            .compact_lines
            .clone()
            .unwrap_or_else(|| {
                inferay_native_diff::prepare_inline_lines(&diff.old_lines, &diff.new_lines)
            })
            .into();
        let count = diff.old_lines.len().max(diff.new_lines.len());
        let changed = |line: &GitDiffLine| {
            matches!(
                line.line_type,
                GitDiffLineType::Add | GitDiffLineType::Remove
            )
        };
        let split_ranges = inferay_native_diff::change_ranges((0..count).map(|i| {
            diff.old_lines.get(i).is_some_and(changed) || diff.new_lines.get(i).is_some_and(changed)
        }))
        .into();
        let inline_ranges = inferay_native_diff::change_ranges(inline.iter().map(changed)).into();
        let mut split_minimap =
            inferay_native_diff::minimap_segments(&diff.old_lines, "left", count);
        split_minimap.extend(inferay_native_diff::minimap_segments(
            &diff.new_lines,
            "right",
            count,
        ));
        let inline_minimap =
            inferay_native_diff::minimap_segments(&inline, "full", inline.len()).into();
        let old_rows: std::collections::HashMap<_, _> = diff
            .old_lines
            .iter()
            .enumerate()
            .filter_map(|(i, line)| line.number.map(|n| (n, i)))
            .collect();
        let new_rows: std::collections::HashMap<_, _> = diff
            .new_lines
            .iter()
            .enumerate()
            .filter_map(|(i, line)| line.number.map(|n| (n, i)))
            .collect();
        let inline_sources = inline
            .iter()
            .map(|line| {
                let removed = line.line_type == GitDiffLineType::Remove;
                line.number
                    .and_then(|number| {
                        if removed {
                            old_rows.get(&number)
                        } else {
                            new_rows.get(&number)
                        }
                    })
                    .map(|&index| (removed, index))
            })
            .collect();
        Self {
            split_ranges,
            inline_ranges,
            split_minimap: split_minimap.into(),
            inline_minimap,
            inline_sources,
            colored: false,
            inline,
            old: Arc::new([]),
            new: Arc::new([]),
            diff: Arc::new(diff),
            path: path.to_owned().into(),
            theme: theme.into(),
        }
    }
    pub(super) fn retheme(&self, theme: &str) -> Self {
        let mut next = self.clone();
        next.old = Self::classify(&self.diff.old_lines, &self.path, theme).into();
        next.new = Self::classify(&self.diff.new_lines, &self.path, theme).into();
        next.theme = theme.into();
        next.colored = true;
        next
    }
    fn uncolored(&self, theme: &str) -> Self {
        let mut next = self.clone();
        next.old = Arc::new([]);
        next.new = Arc::new([]);
        next.theme = theme.into();
        next.colored = false;
        next
    }
    fn inline_styles(&self, index: usize) -> &[(std::ops::Range<usize>, HighlightStyle)] {
        self.inline_sources
            .get(index)
            .and_then(|source| *source)
            .and_then(|(old, index)| {
                if old {
                    self.old.get(index)
                } else {
                    self.new.get(index)
                }
            })
            .map_or(&[], Vec::as_slice)
    }

    pub(super) fn bytes(&self) -> usize {
        let source = self
            .diff
            .old_lines
            .iter()
            .chain(&self.diff.new_lines)
            .chain(self.inline.iter())
            .map(|line| line.content.capacity())
            .sum::<usize>()
            + (self.diff.old_lines.capacity() + self.diff.new_lines.capacity() + self.inline.len())
                * std::mem::size_of::<GitDiffLine>();
        let styles = self
            .old
            .iter()
            .chain(self.new.iter())
            .map(|line| {
                std::mem::size_of_val(line)
                    + line.capacity()
                        * std::mem::size_of::<(std::ops::Range<usize>, HighlightStyle)>()
            })
            .sum::<usize>();
        source
            + styles
            + self.diff.raw_patch.as_ref().map_or(0, String::capacity)
            + self.inline_sources.len() * std::mem::size_of::<Option<(bool, usize)>>()
            + (self.split_ranges.len() + self.inline_ranges.len())
                * 2
                * std::mem::size_of::<usize>()
            + (self.split_minimap.len() + self.inline_minimap.len())
                * std::mem::size_of::<inferay_native_diff::MinimapSegment>()
    }
}

impl RepositoryView {
    pub(super) fn diff_key(&self, path: String, staged: bool) -> DiffKey {
        DiffKey {
            cwd: self.selected_worktree.as_ref().unwrap_or(&self.cwd).clone(),
            commit: self.selected.clone(),
            path,
            staged,
        }
    }

    pub(super) fn show_prepared_diff(&mut self, data: Arc<PreparedDiff>, cx: &mut Context<Self>) {
        let data = if data.theme == self.syntax_theme {
            data
        } else {
            Arc::new(data.uncolored(&self.syntax_theme))
        };
        self.diff = Some(data.clone());
        self.jump_diff_change(0);
        self.color_diff(data, cx);
    }

    pub(super) fn color_diff(&mut self, data: Arc<PreparedDiff>, cx: &mut Context<Self>) {
        if data.colored && data.theme == self.syntax_theme {
            return;
        }
        let theme = self.syntax_theme.clone();
        let key = self.diff_key(data.path.to_string(), self.selected_staged);
        let cache = self.diff_cache.clone();
        let work = cx
            .background_executor()
            .spawn_with_priority(Priority::Low, async move {
                let prepared = Arc::new(data.retheme(&theme));
                cache.lock().unwrap().publish_colors(key, prepared.clone());
                prepared
            });
        self.theme_task = Some(cx.spawn(async move |this, cx| {
            let prepared = work.await;
            let _ = this.update(cx, |view, cx| {
                if view.syntax_theme == prepared.theme
                    && view
                        .diff
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(&current.diff, &prepared.diff))
                {
                    view.diff = Some(prepared);
                    cx.notify();
                }
            });
        }));
    }

    pub(super) fn prefetch_diffs(&mut self, cx: &mut Context<Self>) {
        // Working-tree inputs require Git validation when selected anyway;
        // pre-reading them would add redundant Git processes while navigating.
        if self.selected.is_none() {
            return;
        }
        let files = self.file_entries();
        let current = files.iter().position(|file| {
            self.file.as_deref() == Some(&file.0) && file.4 == self.selected_staged
        });
        let targets = inferay_presentation::diff::diff_prefetch_files(
            &json!({"count":files.len(),"current":current}),
        );
        let keys: Vec<_> = targets
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|index| files.get(index.as_u64()? as usize))
            .map(|file| self.diff_key(file.0.clone(), file.4))
            .collect();
        let cache = self.diff_cache.clone();
        let theme = self.syntax_theme.clone();
        self.diff_prefetch_task = Some(cx.background_executor().spawn_with_priority(
            Priority::Low,
            async move {
                for key in keys {
                    DiffCache::load(&cache, &key, &theme);
                }
            },
        ));
    }

    fn diff_ranges(&self) -> &[[usize; 2]] {
        self.diff.as_ref().map_or(&[], |data| {
            if self.split_diff {
                &data.split_ranges
            } else {
                &data.inline_ranges
            }
        })
    }

    pub(super) fn jump_diff_change(&mut self, index: usize) {
        if let Some(range) = self.diff_ranges().get(index) {
            self.diff_scroll
                .scroll_to_item_strict(range[0].saturating_sub(5), ScrollStrategy::Top);
            self.diff_change = Some(index);
        }
    }

    pub(super) fn step_diff_change(&mut self, direction: i32, window: &Window) {
        let ranges = self.diff_ranges();
        if ranges.is_empty() {
            return;
        }
        let index = if let Some(current) = self.diff_change {
            (current as i32 + direction).rem_euclid(ranges.len() as i32) as usize
        } else {
            let top = -f64::from(f32::from(
                self.diff_scroll.0.borrow().base_handle.offset().y,
            ));
            inferay_presentation::diff::next_change_index(
                ranges,
                (top / colors::DIFF_ROW as f64 / crate::zoom::factor(window) as f64).round() + 5.,
                direction,
            )
            .unwrap()
        };
        self.jump_diff_change(index);
    }

    pub(super) fn scroll_minimap(&mut self, y: Pixels, grab: Pixels, window: &mut Window) {
        let handle = &self.diff_scroll.0.borrow().base_handle;
        let thumb = minimap_thumb(self.minimap_bounds, handle, window);
        let travel = f32::from(self.minimap_bounds.size.height - thumb.size.height).max(1.);
        let progress = (f32::from(y - self.minimap_bounds.top() - grab) / travel).clamp(0., 1.);
        handle.set_offset(point(handle.offset().x, -handle.max_offset().y * progress));
        self.diff_change = None;
        window.refresh();
    }

    fn diff_minimap(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let data = self.diff.clone();
        let split = self.split_diff;
        let handle = self.diff_scroll.clone();
        let entity = cx.weak_entity();
        div()
            .id("diff-minimap")
            .debug_selector(|| "diff-minimap".into())
            .role(Role::Button)
            .aria_label("Scroll diff overview")
            .cursor_pointer()
            .w(ui(20.))
            .h_full()
            .flex_shrink_0()
            .relative()
            .border_l_1()
            .border_color(rgba(0xebebeb0f))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        let _ = entity.update(cx, |view, _| view.minimap_bounds = bounds);
                    },
                    move |bounds, _, window, _| {
                        let Some(data) = &data else {
                            return;
                        };
                        let (segments, count) = if split {
                            (
                                &data.split_minimap,
                                data.diff.old_lines.len().max(data.diff.new_lines.len()),
                            )
                        } else {
                            (&data.inline_minimap, data.inline.len())
                        };
                        if count == 0 {
                            return;
                        }
                        for segment in segments.iter() {
                            let left = if segment.side == "right" { 0.5 } else { 0. };
                            let width = if segment.side == "full" { 1. } else { 0.5 };
                            let top =
                                bounds.size.height * (segment.start_line as f32 / count as f32);
                            let height = (bounds.size.height
                                * ((segment.end_line - segment.start_line) as f32 / count as f32))
                                .max(crate::zoom::pixels(2., window));
                            let marker = Bounds::new(
                                bounds.origin + point(bounds.size.width * left, top),
                                size(
                                    bounds.size.width * width,
                                    height.min(bounds.size.height - top),
                                ),
                            );
                            let color = if segment.r#type == "add" {
                                colors::ADDED
                            } else {
                                colors::DELETED
                            };
                            window.paint_quad(fill(marker, rgba((color << 8) | 0x99)));
                        }
                        let thumb = minimap_thumb(bounds, &handle.0.borrow().base_handle, window);
                        window.paint_quad(quad(
                            thumb,
                            crate::zoom::pixels(2., window),
                            rgba(0xffffff14),
                            px(1.),
                            rgba(0xffffff55),
                            BorderStyle::Solid,
                        ));
                    },
                )
                .size_full(),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|view, event: &MouseDownEvent, window, cx| {
                    let thumb = minimap_thumb(
                        view.minimap_bounds,
                        &view.diff_scroll.0.borrow().base_handle,
                        window,
                    );
                    let grab =
                        if event.position.y >= thumb.top() && event.position.y <= thumb.bottom() {
                            event.position.y - thumb.top()
                        } else {
                            thumb.size.height / 2.
                        };
                    view.minimap_drag = Some(grab);
                    view.keyboard_scope = "diff";
                    window.focus(&view.focus, cx);
                    view.scroll_minimap(event.position.y, grab, window);
                    cx.stop_propagation();
                }),
            )
    }

    pub(super) fn diff_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let diff = self.diff.clone();
        let count = diff.as_ref().map_or(0, |d| {
            if self.split_diff {
                d.diff.old_lines.len().max(d.diff.new_lines.len())
            } else {
                d.inline.len()
            }
        });
        let split = self.split_diff;
        let active = self
            .diff_change
            .and_then(|i| self.diff_ranges().get(i))
            .copied();
        div()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|s, _, _, _| s.keyboard_scope = "diff"),
            )
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .h(ui(32.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .gap(ui(8.))
                    .px(ui(8.))
                    .child(button("close-diff", "← Graph").on_click(cx.listener(
                        |s, _, window, cx| {
                            s.show_diff = false;
                            s.open_after_selection = false;
                            s.history = true;
                            s.keyboard_scope = "graph";
                            window.focus(&s.focus, cx);
                            cx.notify();
                        },
                    )))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(ui(11.))
                            .text_ellipsis()
                            .child(self.file.clone().unwrap_or_default()),
                    )
                    .child(
                        button("diff-mode", if split { "Split" } else { "Unified" }).on_click(
                            cx.listener(|s, _, _, cx| {
                                s.split_diff = !s.split_diff;
                                s.diff_change = None;
                                s.jump_diff_change(0);
                                cx.notify();
                            }),
                        ),
                    ),
            )
            .when(diff.as_ref().is_some_and(|d| d.diff.is_binary), |d| {
                d.child(div().p(ui(12.)).child("Binary file"))
            })
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .on_scroll_wheel(cx.listener(|view, _, _, _| view.diff_change = None))
                    .child(
                        uniform_list("diff-lines", count, move |range, _, _| {
                            let Some(data) = diff.as_ref() else {
                                return Vec::new();
                            };
                            let diff = &data.diff;
                            range
                                .map(|i| {
                                    let row = div()
                                        .debug_selector(move || format!("diff-row-{i}"))
                                        .when(
                                            active
                                                .is_some_and(|range| i >= range[0] && i < range[1]),
                                            |d| d.border_l_2().border_color(rgba(0xebebeb80)),
                                        )
                                        .w_full()
                                        .overflow_hidden()
                                        .h(ui(colors::DIFF_ROW))
                                        .flex()
                                        .font_family("Menlo")
                                        .line_height(ui(colors::DIFF_ROW))
                                        .text_size(ui(colors::DIFF_TEXT));
                                    if split {
                                        row.children(
                                            [diff.old_lines.get(i), diff.new_lines.get(i)]
                                                .into_iter()
                                                .enumerate()
                                                .map(|(side, line)| {
                                                    let tint = match line.map(|l| &l.line_type) {
                                                        Some(GitDiffLineType::Add) => 0x55d68b18,
                                                        Some(GitDiffLineType::Remove) => 0xff686818,
                                                        _ => 0,
                                                    };
                                                    div()
                                                        .w(relative(0.5))
                                                        .flex_shrink_0()
                                                        .min_w_0()
                                                        .h_full()
                                                        .overflow_hidden()
                                                        .bg(rgba(tint))
                                                        .flex()
                                                        .gap(ui(8.))
                                                        .border_r_1()
                                                        .border_color(rgba(0xebebeb0f))
                                                        .child(
                                                            div()
                                                                .w(ui(colors::DIFF_GUTTER))
                                                                .text_size(ui(colors::DIFF_NUMBER))
                                                                .text_right()
                                                                .flex_shrink_0()
                                                                .text_color(rgba(0xebebeb60))
                                                                .child(
                                                                    line.and_then(|l| l.number)
                                                                        .map(|n| n.to_string())
                                                                        .unwrap_or_default(),
                                                                ),
                                                        )
                                                        .child(
                                                            StyledText::new(
                                                                line.map(|l| l.content.clone())
                                                                    .unwrap_or_default(),
                                                            )
                                                            .with_highlights(
                                                                if side == 0 {
                                                                    &data.old
                                                                } else {
                                                                    &data.new
                                                                }
                                                                .get(i)
                                                                .into_iter()
                                                                .flatten()
                                                                .cloned(),
                                                            ),
                                                        )
                                                }),
                                        )
                                    } else {
                                        let line = data.inline.get(i);
                                        let tint = match line.map(|line| line.line_type) {
                                            Some(GitDiffLineType::Add) => 0x55d68b18,
                                            Some(GitDiffLineType::Remove) => 0xff686818,
                                            _ => 0,
                                        };
                                        row.bg(rgba(tint)).child(
                                            StyledText::new(
                                                line.map(|l| l.content.clone()).unwrap_or_default(),
                                            )
                                            .with_highlights(data.inline_styles(i).iter().cloned()),
                                        )
                                    }
                                })
                                .collect()
                        })
                        .track_scroll(&self.diff_scroll)
                        .flex_1()
                        .min_h_0()
                        .min_w_0(),
                    )
                    .child(self.diff_minimap(cx)),
            )
    }
}

fn minimap_thumb(bounds: Bounds<Pixels>, handle: &ScrollHandle, window: &Window) -> Bounds<Pixels> {
    let viewport = handle.bounds().size.height;
    let content = viewport + handle.max_offset().y;
    let ratio = if content > px(0.) {
        f32::from(viewport) / f32::from(content)
    } else {
        1.
    };
    let height = (bounds.size.height * ratio)
        .max(crate::zoom::pixels(16., window))
        .min(bounds.size.height);
    let progress = if handle.max_offset().y > px(0.) {
        (-f32::from(handle.offset().y) / f32::from(handle.max_offset().y)).clamp(0., 1.)
    } else {
        0.
    };
    Bounds::new(
        bounds.origin + point(px(0.), (bounds.size.height - height) * progress),
        size(bounds.size.width, height),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    #[ignore = "release diagnostic; read-only local repository"]
    fn profile_diff_open() {
        use std::time::Instant;
        assert!(!std::hint::black_box(cfg!(debug_assertions)));
        let cwd = std::env::var("INFERAY_DIFF_PROFILE_CWD").unwrap();
        let revision =
            std::env::var("INFERAY_DIFF_PROFILE_COMMIT").unwrap_or_else(|_| "HEAD".into());
        let details =
            inferay_native_diff::get_git_commit_details_for_parent(&cwd, &revision, None).unwrap();
        for file in details.files.iter().take(6) {
            let started = Instant::now();
            let diff = inferay_native_diff::get_git_commit_hunk_diff_for_parent(
                &cwd,
                &details.hash,
                None,
                &file.path,
                false,
            )
            .unwrap();
            let read = started.elapsed();
            let prepared = PreparedDiff::plain(diff, &file.path, "vscode-black");
            println!(
                "{}",
                json!({"file":file.path,"git_ms":read.as_secs_f64()*1000.,"prepare_ms":(started.elapsed()-read).as_secs_f64()*1000.,"rows":prepared.diff.old_lines.len().max(prepared.diff.new_lines.len())})
            );
        }
    }

    #[gpui::test]
    fn revisiting_cached_commits_publishes_immediately_without_a_git_job(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = RepositoryView::new(
                "/not-a-repository".into(),
                json!({}),
                "vscode-black".into(),
                0,
                cx,
            );
            view.task = None;
            view.selected = Some("0123456789012345678901234567890123456789".into());
            for path in ["a.rs", "b.rs"] {
                let prepared = Arc::new(PreparedDiff::new(
                    GitHunkDiff::default(),
                    path,
                    "vscode-black",
                ));
                let key = view.diff_key(path.into(), false);
                view.diff_cache.lock().unwrap().put(key, prepared);
            }
            view
        });
        for path in ["a.rs", "b.rs", "a.rs"] {
            view.update(cx, |view, cx| {
                view.open_file(path.into(), false, cx);
                assert_eq!(view.diff.as_ref().unwrap().path.as_ref(), path);
                assert!(view.diff.as_ref().unwrap().colored);
                assert!(view.diff_task.is_none());
                assert!(view.theme_task.is_none());
            });
        }
    }

    #[gpui::test]
    fn space_wraps_changes_and_minimap_clicks_scroll_the_same_view(cx: &mut TestAppContext) {
        let root = tempfile::tempdir().unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = RepositoryView::new(
                root.path().to_string_lossy().into(),
                json!({}),
                "vscode-black".into(),
                colors::CANVAS,
                cx,
            );
            view.task = None;
            view.loading = false;
            view.show_diff = true;
            view.history = false;
            view.changes = false;
            view.file = Some("file.rs".into());
            view.keyboard_scope = "diff";
            let old: Vec<_> = (0..180)
                .map(|i| GitDiffLine {
                    number: Some(i + 1),
                    content: format!("let value = {i};"),
                    line_type: if [20, 80, 160].contains(&i) {
                        GitDiffLineType::Remove
                    } else {
                        GitDiffLineType::Context
                    },
                })
                .collect();
            let new = old
                .iter()
                .map(|line| GitDiffLine {
                    line_type: if line.line_type == GitDiffLineType::Remove {
                        GitDiffLineType::Add
                    } else {
                        line.line_type
                    },
                    ..line.clone()
                })
                .collect();
            view.diff = Some(Arc::new(PreparedDiff::new(
                GitHunkDiff {
                    old_lines: old,
                    new_lines: new,
                    ..Default::default()
                },
                "file.rs",
                "vscode-black",
            )));
            view.jump_diff_change(0);
            view
        });
        cx.simulate_resize(size(px(800.), px(500.)));
        let draw = |cx: &mut VisualTestContext| {
            cx.draw(point(px(0.), px(0.)), size(px(800.), px(500.)), |_, _| {
                view.clone().into_any_element()
            });
        };
        draw(cx);
        let row = cx.debug_bounds("diff-row-20").unwrap();
        cx.simulate_click(row.center(), Modifiers::default());
        for (key, expected, row) in [
            ("space", 1, 80),
            ("space", 2, 160),
            ("space", 0, 20),
            ("shift-space", 2, 160),
        ] {
            cx.simulate_keystrokes(key);
            draw(cx);
            view.read_with(cx, |view, _| assert_eq!(view.diff_change, Some(expected)));
            assert!(
                cx.debug_bounds(match row {
                    80 => "diff-row-80",
                    160 => "diff-row-160",
                    _ => "diff-row-20",
                })
                .is_some()
            );
        }
        let rail = cx.debug_bounds("diff-minimap").unwrap();
        cx.simulate_click(
            rail.origin + point(rail.size.width / 2., rail.size.height * 0.25),
            Modifiers::default(),
        );
        draw(cx);
        view.read_with(cx, |view, _| {
            assert!(view.diff_change.is_none());
            let handle = &view.diff_scroll.0.borrow().base_handle;
            assert!(handle.offset().y < px(0.));
            assert!(-handle.offset().y < handle.max_offset().y * 0.6);
            assert!(view.minimap_drag.is_none());
        });
        // Unified mode uses its own displayed row positions and the same navigation policy.
        view.update(cx, |view, cx| {
            view.split_diff = false;
            view.diff_change = None;
            view.jump_diff_change(0);
            cx.notify();
        });
        draw(cx);
        cx.simulate_keystrokes("space");
        draw(cx);
        view.read_with(cx, |view, _| assert_eq!(view.diff_change, Some(1)));
    }
}
