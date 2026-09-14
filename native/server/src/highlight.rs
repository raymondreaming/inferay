//! Scope-kind syntax classification. Colour is a renderer concern: this emits a
//! small closed set of kinds, so one cached classification serves every theme.
use serde::Serialize;
use std::sync::OnceLock;
use syntect::easy::ScopeRegionIterator;
use syntect::parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet};

use inferay_core::syntax::{MAX_BYTES, MAX_LINE_BYTES, MAX_LINES, SyntaxKind};

/// Kinds a renderer can style, most specific selector first. Anything
/// unrecognised stays `plain` rather than growing this set: a stable vocabulary
/// keeps the stylesheet finite.
const SELECTORS: &[(&str, SyntaxKind)] = &[
    ("comment", SyntaxKind::Comment),
    ("constant.character.escape", SyntaxKind::String),
    ("constant.numeric", SyntaxKind::Number),
    ("constant", SyntaxKind::Constant),
    ("string", SyntaxKind::String),
    ("keyword.control", SyntaxKind::Control),
    ("keyword.operator.word", SyntaxKind::Keyword),
    ("keyword.operator", SyntaxKind::Operator),
    ("keyword", SyntaxKind::Keyword),
    // `storage.type` marks declaration keywords — const, let, fn, class — not
    // type names. Those arrive as entity.name.type / support.type below.
    ("storage", SyntaxKind::Keyword),
    ("entity.name.function", SyntaxKind::Function),
    ("support.function", SyntaxKind::Function),
    ("entity.name.tag", SyntaxKind::Tag),
    ("entity.other.attribute-name", SyntaxKind::Attribute),
    ("entity.name", SyntaxKind::Type),
    ("support.type", SyntaxKind::Type),
    ("support.class", SyntaxKind::Type),
    ("variable.type", SyntaxKind::Type),
    ("variable.function", SyntaxKind::Function),
    ("variable", SyntaxKind::Variable),
    ("support.variable", SyntaxKind::Variable),
    ("meta.object-literal.key", SyntaxKind::Variable),
    ("meta.property.object", SyntaxKind::Variable),
    ("punctuation", SyntaxKind::Punctuation),
];

fn syntaxes() -> &'static SyntaxSet {
    static SET: OnceLock<SyntaxSet> = OnceLock::new();
    SET.get_or_init(|| {
        syntect::dumps::from_uncompressed_data(include_bytes!("../syntaxes/syntaxes.bin"))
            .expect("bundled native syntax definitions")
    })
}

/// `punctuation.definition.*` marks the delimiters of the construct it sits
/// inside — a comment's slashes, a string's quotes, a tag's brackets. Those read
/// as the construct, so the walk skips them and lets an outer scope decide.
fn deferred() -> Scope {
    static DEFERRED: OnceLock<Scope> = OnceLock::new();
    *DEFERRED.get_or_init(|| Scope::new("punctuation.definition").expect("static selector"))
}

fn selectors() -> &'static [(Scope, SyntaxKind)] {
    static SELECTOR_SCOPES: OnceLock<Vec<(Scope, SyntaxKind)>> = OnceLock::new();
    SELECTOR_SCOPES.get_or_init(|| {
        SELECTORS
            .iter()
            .filter_map(|(selector, kind)| Some((Scope::new(selector).ok()?, *kind)))
            .collect()
    })
}

/// Alternate extensions use their matching bundled language grammar.
const ALIASES: [(&str, &str); 6] = [
    ("jsx", "tsx"),
    ("mjs", "js"),
    ("cjs", "js"),
    ("mts", "ts"),
    ("cts", "ts"),
    ("scss", "css"),
];

pub fn extension(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    let extension = name.rsplit('.').next().unwrap_or_default();
    if extension == name { "" } else { extension }
}

fn syntax(path: &str) -> Option<&'static SyntaxReference> {
    let set = syntaxes();
    let extension = extension(path);
    let resolved = ALIASES
        .iter()
        .find(|(from, _)| *from == extension)
        .map_or(extension, |(_, to)| to);
    let name = path.rsplit('/').next().unwrap_or(path);
    set.find_syntax_by_extension(name)
        .or_else(|| set.find_syntax_by_extension(extension))
        .or_else(|| {
            (!resolved.is_empty())
                .then(|| set.find_syntax_by_extension(resolved))
                .flatten()
        })
}

/// Innermost scope wins, so walk the stack outwards and stop at the first
/// selector that matches. An unmatched stack is ordinary code.
fn kind(stack: &ScopeStack) -> SyntaxKind {
    for scope in stack.as_slice().iter().rev() {
        if deferred().is_prefix_of(*scope) {
            continue;
        }
        if let Some((_, kind)) = selectors()
            .iter()
            .find(|(selector, _)| selector.is_prefix_of(*scope))
        {
            return *kind;
        }
    }
    SyntaxKind::Plain
}

#[derive(Serialize, ts_rs::TS)]
#[ts(rename = "ClassifiedDocument")]
pub struct Classified {
    pub version: u8,
    pub language: String,
    /// One entry per line, each a flat `[length, kind, length, kind, …]` run
    /// list. Lengths are UTF-16 code units so the renderer slices the string it
    /// already holds instead of re-encoding it.
    #[ts(type = "Array<Array<number | string>>")]
    pub lines: Vec<Vec<serde_json::Value>>,
}

fn units(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// Classify a whole document. Callers cache and slice; a partial classification
/// would still have to parse from line zero to carry grammar state.
pub fn classify(path: &str, text: &str) -> Option<Classified> {
    if text.len() > MAX_BYTES || text.lines().any(|line| line.len() > MAX_LINE_BYTES) {
        return None;
    }
    let syntax = syntax(path).or_else(|| {
        syntaxes().find_syntax_by_first_line(text.lines().next().unwrap_or_default())
    })?;
    let set = syntaxes();
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut lines: Vec<Vec<serde_json::Value>> = Vec::new();
    for line in text.split_inclusive('\n') {
        if lines.len() >= MAX_LINES {
            return None;
        }
        let ops = state.parse_line(line, set).ok()?;
        let mut runs: Vec<serde_json::Value> = Vec::new();
        let mut open: Option<(SyntaxKind, usize)> = None;
        for (piece, op) in ScopeRegionIterator::new(&ops, line) {
            stack.apply(op).ok()?;
            let piece = piece.trim_end_matches('\n');
            if piece.is_empty() {
                continue;
            }
            let current = kind(&stack);
            match open {
                Some((kind, length)) if kind == current => {
                    open = Some((kind, length + units(piece)))
                }
                Some((kind, length)) => {
                    runs.push(serde_json::json!(length));
                    runs.push(serde_json::json!(kind));
                    open = Some((current, units(piece)));
                }
                None => open = Some((current, units(piece))),
            }
        }
        if let Some((kind, length)) = open {
            runs.push(serde_json::json!(length));
            runs.push(serde_json::json!(kind));
        }
        lines.push(runs);
    }
    Some(Classified {
        version: 3,
        language: syntax.name.clone(),
        lines,
    })
}

/// Diff headers are not source, and before/after revisions have independent
/// parser state. Reset at omitted hunks and map each side back to display rows.
pub fn classify_diff(path: &str, text: &str, types: &[String]) -> Option<Classified> {
    let rows: Vec<_> = text.split('\n').collect();
    if rows.len() != types.len() || rows.len() > MAX_LINES || text.len() > MAX_BYTES {
        return None;
    }
    let mut result = Classified {
        version: 3,
        language: syntax(path)?.name.clone(),
        lines: vec![Vec::new(); rows.len()],
    };
    let mut start = 0;
    while start < rows.len() {
        if types[start] == "hunk" {
            start += 1;
            continue;
        }
        let end = (start..rows.len())
            .find(|&i| types[i] == "hunk")
            .unwrap_or(rows.len());
        let has_removed = types[start..end].iter().any(|kind| kind == "remove");
        let has_added = types[start..end].iter().any(|kind| kind == "add");
        let sides: &[bool] = if has_removed && has_added {
            &[true, false]
        } else if has_removed {
            &[true]
        } else {
            &[false]
        };
        for &removed in sides {
            let indices: Vec<_> = (start..end)
                .filter(|&i| {
                    types[i] != "spacer"
                        && if removed {
                            types[i] != "add"
                        } else {
                            types[i] != "remove"
                        }
                })
                .collect();
            if indices.is_empty() {
                continue;
            }
            let mut source = indices
                .iter()
                .map(|&i| rows[i])
                .collect::<Vec<_>>()
                .join("\n");
            source.push('\n');
            let classified = classify(path, &source)?;
            for (index, runs) in indices.into_iter().zip(classified.lines) {
                result.lines[index] = runs;
            }
        }
        start = end;
    }
    Some(result)
}
