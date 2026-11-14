use crate::colors::{rgb, rgba};
use crate::syntax::Paint;
use crate::ui::{Ink, SEMIBOLD};
use crate::workspace::Workspace;
use inferay_server::MdInlineToken;
use rune::{El, Link};
use std::{ops::Range, sync::Arc};

pub const SELECTION: u32 = 0x4688cc80;

#[derive(Clone)]
pub struct Prepared {
    content: Arc<str>,
    runs: Arc<[(Range<usize>, Paint)]>,
    links: Arc<[(Range<usize>, String)]>,
}

impl Prepared {
    pub fn plain(content: impl Into<Arc<str>>) -> Self {
        Self::new(content.into(), vec![], vec![])
    }

    pub fn new(
        content: Arc<str>,
        runs: Vec<(Range<usize>, Paint)>,
        links: Vec<(Range<usize>, String)>,
    ) -> Self {
        Self {
            content,
            runs: runs.into(),
            links: links.into(),
        }
    }

    pub fn content(&self) -> &str {
        &self.content
    }

    #[cfg(test)]
    pub fn highlights(&self) -> &[(Range<usize>, Paint)] {
        &self.runs
    }

    pub fn with_highlights(&self, runs: Vec<(Range<usize>, Paint)>) -> Self {
        Self {
            runs: runs.into(),
            ..self.clone()
        }
    }

    pub fn render(&self, key: impl Into<String>, ink: Ink) -> El {
        self.element(key.into(), ink, true)
    }

    pub fn render_line(&self, key: impl Into<String>, ink: Ink) -> El {
        self.element(key.into(), ink, false)
    }

    fn element(&self, key: String, ink: Ink, wrap: bool) -> El {
        let spans = crate::syntax::spans(&self.runs);
        let fit = FIT.get().filter(|_| wrap).map(|available| {
            rune::text::measure(&self.content, &spans, ink.style(), Some(available))
                .0
                .ceil()
                .min(available)
        });
        let mut text = rune::text(self.content.to_string())
            .spans(spans)
            .font(ink.style())
            .color(ink.color)
            .exact_lines()
            .offset(0., ink.baseline());
        if wrap {
            text = text.wrap_anywhere();
        }
        if let Some(width) = fit {
            text = text.w(width);
        }
        for (range, paint) in self.runs.iter() {
            if paint.strike {
                text = text.strike(range.start, range.end, None);
            }
        }
        if !self.links.is_empty() {
            for (range, href) in self.links.iter() {
                if !range.is_empty() {
                    text = text.link(Link::new(range.clone(), href.clone()));
                }
            }
            text = text.on_link(|_: &mut Workspace, href: &str, tx: &mut rune::Tx| {
                if href.starts_with("https://") || href.starts_with("http://") {
                    let _ = tx.open_url(href);
                }
            });
        }
        text.key(key)
            .selectable(true)
            .selection_color(rgba(SELECTION))
    }
}

thread_local! {
    static FIT: std::cell::Cell<Option<f32>> = const { std::cell::Cell::new(None) };
}

pub fn fitted<T>(available: Option<f32>, build: impl FnOnce() -> T) -> T {
    let previous = FIT.replace(available);
    let built = build();
    FIT.set(previous);
    built
}

pub fn inline(tokens: &[MdInlineToken]) -> Prepared {
    fn append(
        tokens: &[MdInlineToken],
        text: &mut String,
        runs: &mut Vec<(Range<usize>, Paint)>,
        links: &mut Vec<(Range<usize>, String)>,
        inherited: Paint,
    ) {
        for token in tokens {
            let mut style = inherited;
            match token.kind {
                "bold" | "bold-italic" => {
                    style.weight = Some(SEMIBOLD);
                    style.color = Some(rgb(0xebebeb));
                }
                "code" | "link" | "url" | "markdown_path" => style.color = Some(rgb(0xb8d7ff)),
                "strikethrough" => style.strike = true,
                _ => {}
            }
            if matches!(token.kind, "italic" | "bold-italic") {
                style.italic = true;
            }
            let start = text.len();
            if let Some(children) = &token.children {
                append(children, text, runs, links, style);
            } else {
                text.push_str(if token.kind == "linebreak" {
                    "\n"
                } else {
                    &token.text
                });
                if text.len() > start {
                    runs.push((start..text.len(), style));
                }
            }
            if let Some(href) = &token.href {
                links.push((start..text.len(), href.clone()));
            }
        }
    }
    let mut text = String::new();
    let mut runs = Vec::new();
    let mut links = Vec::new();
    append(tokens, &mut text, &mut runs, &mut links, Paint::default());
    Prepared::new(text.into(), runs, links)
}

pub fn combine(
    base: impl IntoIterator<Item = (Range<usize>, Paint)>,
    layer: impl IntoIterator<Item = (Range<usize>, Paint)>,
) -> Vec<(Range<usize>, Paint)> {
    let base: Vec<_> = base.into_iter().filter(|(r, _)| !r.is_empty()).collect();
    let layer: Vec<_> = layer.into_iter().filter(|(r, _)| !r.is_empty()).collect();
    let mut points: Vec<usize> = base
        .iter()
        .chain(&layer)
        .flat_map(|(r, _)| [r.start, r.end])
        .collect();
    points.sort_unstable();
    points.dedup();
    let mut cursors = [0usize; 2];
    let mut find = |which: usize, runs: &[(Range<usize>, Paint)], at: usize| {
        while runs.get(cursors[which]).is_some_and(|(r, _)| r.end <= at) {
            cursors[which] += 1;
        }
        runs.get(cursors[which])
            .filter(|(r, _)| r.start <= at)
            .map(|(_, p)| *p)
    };
    let mut out: Vec<(Range<usize>, Paint)> = Vec::new();
    for pair in points.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        let below = find(0, &base, start);
        let above = find(1, &layer, start);
        let paint = match (below, above) {
            (None, None) => continue,
            (Some(p), None) | (None, Some(p)) => p,
            (Some(b), Some(a)) => Paint {
                color: a.color.or(b.color),
                background: a.background.or(b.background),
                underline: a.underline.or(b.underline),
                weight: a.weight.or(b.weight),
                italic: a.italic || b.italic,
                strike: a.strike || b.strike,
            },
        };
        match out.last_mut() {
            Some((range, last)) if range.end == start && *last == paint => range.end = end,
            _ => out.push((start..end, paint)),
        }
    }
    out
}
