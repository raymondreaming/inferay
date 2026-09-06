//! Scope-kind syntax classification. Colour is a renderer concern: this emits a
//! small closed set of kinds, so one cached classification serves every theme.
use serde::Serialize;
#[cfg(test)]
use serde_json::json;
use std::sync::OnceLock;
use syntect::easy::ScopeRegionIterator;
use syntect::parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet};

/// Above these a file renders as plain text: classification cost is unbounded
/// in pathological minified sources and the reader gains nothing.
const MAX_LINES: usize = 50_000;
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 4_000;

/// Kinds a renderer can style, most specific selector first. Anything
/// unrecognised stays `plain` rather than growing this set: a stable vocabulary
/// keeps the stylesheet finite.
const SELECTORS: [(&str, &str); 15] = [
    ("comment", "comment"),
    ("constant.character.escape", "string"),
    ("constant.numeric", "number"),
    ("constant", "constant"),
    ("string", "string"),
    ("keyword.operator", "operator"),
    ("keyword", "keyword"),
    // `storage.type` marks declaration keywords — const, let, fn, class — not
    // type names. Those arrive as entity.name.type / support.type below.
    ("storage", "keyword"),
    ("entity.name.function", "function"),
    ("support.function", "function"),
    ("entity.name.tag", "tag"),
    ("entity.other.attribute-name", "attribute"),
    ("entity.name", "type"),
    ("support.type", "type"),
    ("punctuation", "punctuation"),
];

fn syntaxes() -> &'static SyntaxSet {
    static SET: OnceLock<SyntaxSet> = OnceLock::new();
    SET.get_or_init(SyntaxSet::load_defaults_newlines)
}

/// `punctuation.definition.*` marks the delimiters of the construct it sits
/// inside — a comment's slashes, a string's quotes, a tag's brackets. Those read
/// as the construct, so the walk skips them and lets an outer scope decide.
fn deferred() -> Scope {
    static DEFERRED: OnceLock<Scope> = OnceLock::new();
    *DEFERRED.get_or_init(|| Scope::new("punctuation.definition").expect("static selector"))
}

fn selectors() -> &'static [(Scope, &'static str)] {
    static SELECTOR_SCOPES: OnceLock<Vec<(Scope, &'static str)>> = OnceLock::new();
    SELECTOR_SCOPES.get_or_init(|| {
        SELECTORS
            .iter()
            .filter_map(|(selector, kind)| Some((Scope::new(selector).ok()?, *kind)))
            .collect()
    })
}

/// Extensions the bundled grammars do not carry, mapped to their nearest
/// relative. Kinds are coarse enough that a superset grammar reads correctly:
/// TypeScript's type annotations fall back to `plain`, everything else holds.
const ALIASES: [(&str, &str); 8] = [
    ("ts", "js"),
    ("tsx", "js"),
    ("jsx", "js"),
    ("mjs", "js"),
    ("cjs", "js"),
    ("mts", "js"),
    ("cts", "js"),
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
    if resolved.is_empty() {
        return None;
    }
    set.find_syntax_by_extension(resolved)
        .or_else(|| set.find_syntax_by_token(resolved))
}

/// Innermost scope wins, so walk the stack outwards and stop at the first
/// selector that matches. An unmatched stack is ordinary code.
fn kind(stack: &ScopeStack) -> &'static str {
    for scope in stack.as_slice().iter().rev() {
        if deferred().is_prefix_of(*scope) {
            continue;
        }
        if let Some((_, kind)) = selectors()
            .iter()
            .find(|(selector, _)| selector.is_prefix_of(*scope))
        {
            return kind;
        }
    }
    "plain"
}

#[derive(Serialize)]
pub struct Classified {
    pub version: u8,
    pub language: String,
    /// One entry per line, each a flat `[length, kind, length, kind, …]` run
    /// list. Lengths are UTF-16 code units so the renderer slices the string it
    /// already holds instead of re-encoding it.
    pub lines: Vec<Vec<serde_json::Value>>,
}

fn units(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// Classify a whole document. Callers cache and slice; a partial classification
/// would still have to parse from line zero to carry grammar state.
pub fn classify(path: &str, text: &str) -> Option<Classified> {
    if text.len() > MAX_BYTES {
        return None;
    }
    let syntax = syntax(path)?;
    let set = syntaxes();
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut lines: Vec<Vec<serde_json::Value>> = Vec::new();
    for line in text.split_inclusive('\n') {
        if lines.len() >= MAX_LINES {
            return None;
        }
        // A long line defeats the grammar and dominates the response. Parse it
        // so state still advances, but emit a single plain run.
        let long = line.len() > MAX_LINE_BYTES;
        let ops = state.parse_line(line, set).ok()?;
        let mut runs: Vec<serde_json::Value> = Vec::new();
        let mut open: Option<(&'static str, usize)> = None;
        for (piece, op) in ScopeRegionIterator::new(&ops, line) {
            stack.apply(op).ok()?;
            let piece = piece.trim_end_matches('\n');
            if piece.is_empty() || long {
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
        if long {
            runs.push(serde_json::json!(units(line.trim_end_matches('\n'))));
            runs.push(serde_json::json!("plain"));
        } else if let Some((kind, length)) = open {
            runs.push(serde_json::json!(length));
            runs.push(serde_json::json!(kind));
        }
        lines.push(runs);
    }
    Some(Classified {
        version: 1,
        language: syntax.name.clone(),
        lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(path: &str, text: &str) -> Vec<Vec<serde_json::Value>> {
        classify(path, text).expect("classified").lines
    }

    #[test]
    fn classifies_typescript_through_the_javascript_grammar() {
        let lines = kinds("src/a/b.ts", "// hi\nconst x = 42;\n");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], vec![json!(5), json!("comment")]);
        // `42` must carry the number kind wherever the runs place it.
        assert!(lines[1].chunks(2).any(|run| run[1] == json!("number")));
    }

    #[test]
    fn merges_adjacent_runs_of_one_kind() {
        let lines = kinds("m.rs", "// aaa bbb ccc\n");
        assert_eq!(lines[0], vec![json!(14), json!("comment")]);
    }

    #[test]
    fn counts_utf16_units_so_the_renderer_can_slice() {
        // An emoji is two UTF-16 units and four UTF-8 bytes.
        let lines = kinds("m.rs", "// \u{1F600}\n");
        assert_eq!(lines[0], vec![json!(5), json!("comment")]);
    }

    #[test]
    fn reads_declaration_keywords_as_keywords_not_types() {
        // `storage.type.const` is a declaration keyword; a reader expects the
        // same colour as `return`, never the colour of a type name.
        let lines = kinds("a.ts", "const x = 1;\n");
        assert_eq!(lines[0][1], json!("keyword"));
        assert_eq!(kinds("m.rs", "let y = 1;\n")[0][1], json!("keyword"));
    }

    #[test]
    fn declines_unknown_extensions_and_bare_names() {
        assert!(classify("data.zzz", "x").is_none());
        assert!(classify("Makefile", "x").is_none());
    }

    #[test]
    fn emits_one_plain_run_for_a_line_past_the_budget() {
        let long = format!("let x = \"{}\";\n", "a".repeat(MAX_LINE_BYTES));
        let lines = kinds("m.rs", &long);
        assert_eq!(lines[0].len(), 2);
        assert_eq!(lines[0][1], json!("plain"));
    }
}
