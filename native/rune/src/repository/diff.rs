use super::*;
use crate::colors;
use crate::syntax::{LineStyles, Paint};

#[derive(Clone)]
pub(super) struct PreparedDiff {
    pub(super) diff: Arc<GitHunkDiff>,
    pub(super) path: String,
    pub(super) theme: String,
    pub(super) old: Arc<[LineStyles]>,
    pub(super) new: Arc<[LineStyles]>,
    pub(super) inline: Arc<[GitDiffLine]>,
    inline_sources: Arc<[Option<(bool, usize)>]>,
    pub(super) line_widths: [f32; 2],
    pub(super) colored: bool,
    split_ranges: Arc<[[usize; 2]]>,
    inline_ranges: Arc<[[usize; 2]]>,
    pub(super) split_minimap: Arc<[inferay_native_diff::MinimapSegment]>,
    pub(super) inline_minimap: Arc<[inferay_native_diff::MinimapSegment]>,
}

impl PreparedDiff {
    fn source_lines(lines: &[GitDiffLine]) -> Vec<&str> {
        lines
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
            .collect()
    }

    #[cfg(test)]
    pub(super) fn classify(lines: &[GitDiffLine], path: &str, theme: &str) -> Vec<LineStyles> {
        crate::syntax::line_highlights(&Self::source_lines(lines), path, theme)
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
        let old_rows: HashMap<_, _> = diff
            .old_lines
            .iter()
            .enumerate()
            .filter_map(|(i, line)| line.number.map(|n| (n, i)))
            .collect();
        let new_rows: HashMap<_, _> = diff
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
        let line_widths = [&diff.old_lines, &diff.new_lines].map(|lines| {
            lines
                .iter()
                .map(|line| {
                    line.content
                        .chars()
                        .map(|c| {
                            if c == '\t' {
                                4
                            } else if c.is_ascii() {
                                1
                            } else {
                                2
                            }
                        })
                        .sum::<usize>()
                })
                .max()
                .unwrap_or(0) as f32
                * colors::DIFF_TEXT
                * 0.61
                + 8.
        });
        Self {
            line_widths,
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
            path: path.to_owned(),
            theme: theme.into(),
        }
    }

    pub(super) fn retheme(&self, theme: &str) -> Self {
        let mut next = self.clone();
        let [old, new] = crate::syntax::diff_highlights(
            [
                &Self::source_lines(&self.diff.old_lines),
                &Self::source_lines(&self.diff.new_lines),
            ],
            &self.path,
            theme,
        );
        next.old = old.into();
        next.new = new.into();
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

    pub(super) fn inline_styles(&self, index: usize) -> &[(std::ops::Range<usize>, Paint)] {
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
                    + line.capacity() * std::mem::size_of::<(std::ops::Range<usize>, Paint)>()
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
    fn load_diff_images(&mut self, data: Arc<PreparedDiff>) {
        self.diff_images = [None, None];
        let Some(backend) = self.backend.get().cloned() else {
            self.diff_images = std::array::from_fn(|_| {
                Some(Err("Inferay services are not connected yet.".into()))
            });
            return;
        };
        self.image_task = Some(self.spawn(
            move || {
                let mut images = [None, None];
                for (side, endpoint) in [data.diff.old_image.as_ref(), data.diff.new_image.as_ref()]
                    .into_iter()
                    .enumerate()
                {
                    if let Some(endpoint) = endpoint {
                        images[side] = Some(
                            (|| -> anyhow::Result<Pixels> {
                                let bytes = crate::backend::RUNTIME
                                    .block_on(backend.image_bytes(endpoint))?;
                                if data.path.to_ascii_lowercase().ends_with(".svg") {
                                    return graph_images::rasterize_svg(&bytes, 2.)
                                        .ok_or_else(|| anyhow::anyhow!("Could not render SVG"));
                                }
                                match image::guess_format(&bytes)? {
                                    image::ImageFormat::Png
                                    | image::ImageFormat::Jpeg
                                    | image::ImageFormat::Gif
                                    | image::ImageFormat::WebP
                                    | image::ImageFormat::Bmp
                                    | image::ImageFormat::Ico => {}
                                    _ => anyhow::bail!("Unsupported image format"),
                                }
                                let decoded = image::load_from_memory(&bytes)?.to_rgba8();
                                let pixels = Pixels::new();
                                pixels.set(decoded.width(), decoded.height(), decoded.into_raw());
                                Ok(pixels)
                            })()
                            .map_err(|error| error.to_string()),
                        );
                    }
                }
                (data, images)
            },
            |view, (data, images), _| {
                if view
                    .diff
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(&current.diff, &data.diff))
                {
                    view.diff_images = images;
                }
            },
        ));
    }

    pub(super) fn diff_key(&self, path: String, staged: bool) -> DiffKey {
        DiffKey {
            cwd: self.work_cwd(),
            commit: self.selected.clone(),
            path,
            staged,
        }
    }

    pub(super) fn show_prepared_diff(&mut self, data: Arc<PreparedDiff>, tx: &mut Tx) {
        let data = if data.theme == self.syntax_theme {
            data
        } else {
            Arc::new(data.uncolored(&self.syntax_theme))
        };
        self.diff = Some(data.clone());
        if data.diff.is_image == Some(true) {
            self.load_diff_images(data.clone());
        }
        self.jump_diff_change(0, tx);
        self.color_diff(data);
    }

    pub(super) fn color_diff(&mut self, data: Arc<PreparedDiff>) {
        if data.diff.is_binary {
            return;
        }
        if data.colored && data.theme == self.syntax_theme {
            return;
        }
        let theme = self.syntax_theme.clone();
        let key = self.diff_key(data.path.clone(), self.selected_staged);
        let cache = self.diff_cache.clone();
        self.theme_task = Some(self.spawn(
            move || {
                let prepared = Arc::new(data.retheme(&theme));
                cache.lock().unwrap().publish_colors(key, prepared.clone());
                prepared
            },
            |view, prepared, _| {
                view.theme_task = None;
                if view.syntax_theme == prepared.theme
                    && view
                        .diff
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(&current.diff, &prepared.diff))
                {
                    view.diff = Some(prepared);
                }
            },
        ));
    }

    pub(super) fn prefetch_diffs(&mut self) {
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
        self.diff_prefetch_task = Some(self.spawn(
            move || {
                for key in keys {
                    DiffCache::load(&cache, &key, &theme);
                }
            },
            |_, _, _| {},
        ));
    }

    pub(super) fn effective_split_diff(&self) -> bool {
        self.split_diff
            && !self.file_entries().iter().any(|file| {
                self.file.as_deref() == Some(file.0.as_str())
                    && file.4 == self.selected_staged
                    && matches!(file.1.as_str(), "A" | "D" | "?" | "??")
            })
    }

    pub(super) fn diff_ranges(&self) -> &[[usize; 2]] {
        if self.file_view {
            return &[];
        }
        self.diff.as_ref().map_or(&[], |data| {
            if self.effective_split_diff() {
                &data.split_ranges
            } else {
                &data.inline_ranges
            }
        })
    }

    pub(super) fn jump_diff_change(&mut self, index: usize, tx: &mut Tx) {
        if let Some(range) = self.diff_ranges().get(index) {
            let row = range[0].saturating_sub(5);
            tx.scroll_to_y("diff-lines", row as f32 * crate::zoom::ui(colors::DIFF_ROW));
            self.diff_change = Some(index);
        }
    }

    pub(super) fn step_diff_change(&mut self, direction: i32, tx: &mut Tx) {
        let ranges = self.diff_ranges();
        if ranges.is_empty() {
            return;
        }
        let index = if let Some(current) = self.diff_change {
            (current as i32 + direction).rem_euclid(ranges.len() as i32) as usize
        } else {
            let top = self.diff_scroll.get()[0] as f64;
            inferay_presentation::diff::next_change_index(
                ranges,
                (top / colors::DIFF_ROW as f64 / crate::zoom::factor() as f64).round() + 5.,
                direction,
            )
            .unwrap()
        };
        self.jump_diff_change(index, tx);
    }

    pub(super) fn minimap_thumb(&self, height: f32) -> (f32, f32) {
        let [offset, max, viewport, _] = self.diff_scroll.get();
        thumb(height, offset, max, viewport)
    }

    pub(super) fn scroll_minimap(&mut self, y: f32, grab: f32, height: f32, tx: &mut Tx) {
        let (_, thumb_height) = self.minimap_thumb(height);
        let travel = (height - thumb_height).max(1.);
        let progress = ((y - grab) / travel).clamp(0., 1.);
        let max = self.diff_scroll.get()[1];
        tx.scroll_to_y("diff-lines", max * progress);
        self.diff_change = None;
    }
}

pub(super) fn thumb(height: f32, offset: f32, max: f32, viewport: f32) -> (f32, f32) {
    let content = viewport + max;
    let ratio = if content > 0. { viewport / content } else { 1. };
    let size = (height * ratio).max(crate::zoom::ui(16.)).min(height);
    let progress = if max > 0. {
        (offset / max).clamp(0., 1.)
    } else {
        0.
    };
    ((height - size) * progress, size)
}

#[cfg(test)]
#[path = "diff_tests.rs"]
mod tests;
