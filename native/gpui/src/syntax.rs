//! Native syntax preparation shared by chat and repository diffs.
use gpui::*;
use inferay_core::syntax::SyntaxKind;
use std::{collections::HashMap, ops::Range, sync::LazyLock};

// These are immutable bundled assets, not a cache of documents or user input.
static PALETTES: LazyLock<HashMap<&'static str, HashMap<&'static str, Hsla>>> = LazyLock::new(|| {
    let mut palettes: HashMap<&'static str, HashMap<&'static str, Hsla>> = HashMap::new();
    for block in include_str!("../assets/syntax-themes.css").split('}') {
        let Some((selector, body)) = block.split_once('{') else { continue; };
        let name = if selector.contains(":root") {
            ""
        } else if let Some((_, tail)) = selector.split_once("[data-inferay-syntax-theme=\"") {
            tail.split_once("\"]").expect("bundled syntax theme selector").0
        } else {
            continue;
        };
        let mut colors: HashMap<_, _> = body.lines().filter_map(|line| {
            let (key, value) = line.trim().strip_prefix("--color-syntax-")?.split_once(": #")?;
            let hex = value.strip_suffix(';')?;
            let color = u32::from_str_radix(hex, 16).expect("bundled syntax color");
            Some((key, if hex.len() == 8 { rgba(color).into() } else { rgb(color).into() }))
        }).collect();
        if let Some(base) = palettes.get("") {
            for (&kind, &color) in base {
                if !matches!(kind, "control" | "variable") { colors.entry(kind).or_insert(color); }
            }
        }
        // Semantic kinds can specialize their palette's declaration/plain colors.
        let keyword = colors["keyword"];
        let plain = colors["plain"];
        colors.entry("control").or_insert(keyword);
        colors.entry("variable").or_insert(plain);
        palettes.insert(name, colors);
    }
    palettes
});

pub(crate) fn highlights(
    text: &str,
    language: &str,
    theme: &str,
) -> Vec<(Range<usize>, HighlightStyle)> {
    let extension = match language.to_ascii_lowercase().as_str() {
        "rust" => "rs",
        "javascript" => "js",
        "typescript" => "ts",
        "python" => "py",
        "shell" | "bash" | "zsh" | "sh" => "sh",
        "ruby" => "rb",
        "csharp" | "c#" => "cs",
        "cpp" | "c++" => "cpp",
        "yaml" => "yml",
        "markdown" => "md",
        "golang" => "go",
        _ => language,
    };
    let Some(classified) = inferay_server::classify_syntax(extension, text) else {
        return vec![];
    };
    let palette = PALETTES.get(theme).unwrap_or(&PALETTES[""]);
    let mut highlights = Vec::new();
    let mut offset = 0;
    for (line, runs) in text.split_inclusive('\n').zip(classified.lines) {
        let mut chars = line.char_indices().peekable();
        for run in runs {
            let start = chars.peek().map_or(line.len(), |(i, _)| *i);
            let mut units = 0;
            while units < run.utf16_len {
                let Some((_, c)) = chars.next() else {
                    break;
                };
                units += c.len_utf16();
            }
            let end = chars.peek().map_or(line.len(), |(i, _)| *i);
            let kind = match run.kind {
                SyntaxKind::Attribute => "attr",
                SyntaxKind::Comment => "comment",
                SyntaxKind::Constant => "constant",
                SyntaxKind::Control => "control",
                SyntaxKind::Variable => "variable",
                SyntaxKind::Function => "function",
                SyntaxKind::Keyword => "keyword",
                SyntaxKind::Number => "number",
                SyntaxKind::Operator => "operator",
                SyntaxKind::Plain => "plain",
                SyntaxKind::Punctuation => "punctuation",
                SyntaxKind::String => "string",
                SyntaxKind::Tag => "tag",
                SyntaxKind::Type => "type",
            };
            highlights.push((
                offset + start..offset + end,
                HighlightStyle {
                    color: Some(palette[kind]),
                    font_style: (run.kind == SyntaxKind::Comment).then_some(FontStyle::Italic),
                    ..Default::default()
                },
            ));
        }
        offset += line.len();
    }
    highlights
}
