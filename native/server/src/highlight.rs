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
const SELECTORS: &[(&str, &str)] = &[
    ("comment", "comment"),
    ("constant.character.escape", "string"),
    ("constant.numeric", "number"),
    ("constant", "constant"),
    ("string", "string"),
    ("keyword.control", "control"),
    ("keyword.operator.word", "keyword"),
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
    ("support.class", "type"),
    ("variable.type", "type"),
    ("variable.function", "function"),
    ("variable", "variable"),
    ("support.variable", "variable"),
    ("meta.object-literal.key", "variable"),
    ("meta.property.object", "variable"),
    ("punctuation", "punctuation"),
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

fn selectors() -> &'static [(Scope, &'static str)] {
    static SELECTOR_SCOPES: OnceLock<Vec<(Scope, &'static str)>> = OnceLock::new();
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
        let mut open: Option<(&'static str, usize)> = None;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_control_variables_and_constructor_types() {
        let source =
            "import { buildPayload } from './types.js';\nconst value = new Agent(config.name);\n";
        let result = classify("example.js", source).unwrap();
        let mut tokens = Vec::new();
        for (line, runs) in source.lines().zip(result.lines) {
            let mut offset = 0;
            for run in runs.chunks_exact(2) {
                let end = offset + run[0].as_u64().unwrap() as usize;
                tokens.push((
                    line[offset..end].to_string(),
                    run[1].as_str().unwrap().to_string(),
                ));
                offset = end;
            }
        }
        for (text, kind) in [
            ("import", "control"),
            ("buildPayload", "variable"),
            ("const", "keyword"),
            ("value", "variable"),
            ("Agent", "type"),
            ("name", "variable"),
        ] {
            assert!(
                tokens
                    .iter()
                    .any(|(token, category)| token.trim() == text && category == kind),
                "{text}: {tokens:?}"
            );
        }
    }

    #[test]
    #[ignore = "manual syntax throughput measurement"]
    fn benchmark_classification() {
        let text = include_str!("lib.rs");
        // Warm grammars independently of document classification.
        classify("warm.rs", "fn main() {}\n").unwrap();
        let start = std::time::Instant::now();
        for _ in 0..3 {
            let result = classify("lib.rs", text).unwrap();
            assert_eq!(result.lines.len(), text.lines().count());
        }
        eprintln!(
            "highlight: {} lines, {:.1} ms/document",
            text.lines().count(),
            start.elapsed().as_secs_f64() * 1000.0 / 3.0
        );
    }

    fn kinds(path: &str, text: &str) -> Vec<Vec<serde_json::Value>> {
        classify(path, text).expect("classified").lines
    }

    #[test]
    fn classifies_typescript_with_its_own_grammar() {
        let lines = kinds("src/a/b.ts", "// hi\nconst x = 42;\n");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], vec![json!(5), json!("comment")]);
        // `42` must carry the number kind wherever the runs place it.
        assert!(lines[1].chunks(2).any(|run| run[1] == json!("number")));
    }

    #[test]
    fn supports_repository_languages_and_extensionless_files() {
        for path in [
            "main.rs",
            "main.ts",
            "main.tsx",
            "main.jsx",
            "main.py",
            "main.go",
            "main.java",
            "main.kt",
            "main.swift",
            "main.c",
            "main.cpp",
            "main.cs",
            "main.rb",
            "main.php",
            "main.sh",
            "main.zig",
            "main.lua",
            "main.ex",
            "main.dart",
            "main.vue",
            "main.svelte",
            "main.sql",
            "config.toml",
            "config.yaml",
            "config.json",
            "main.scss",
            "main.html",
            "README.md",
            "Dockerfile",
            "Makefile",
            "CMakeLists.txt",
        ] {
            assert!(syntax(path).is_some(), "missing grammar: {path}");
        }
        assert!(classify("script", "#!/usr/bin/env python3\nprint('hello')\n").is_some());
        eprintln!("{} bundled syntax definitions", syntaxes().syntaxes().len());
    }

    #[test]
    fn tsx_fragments_do_not_turn_following_code_into_strings() {
        let text = "interface Props { visible: boolean }\nconst view = (props: Props) => (\n<>\n{props.visible ? <><div id=\"appearance\">Hello</div></> : null}\n<section title=\"next\">{props.visible && <Button />}</section>\n</>\n);\nconst after = 42;\n";
        let result = classify("view.tsx", text).unwrap();
        assert_ne!(result.language, "JavaScript");
        let last = result.lines.last().unwrap();
        assert_eq!(last[1], json!("keyword"));
        assert!(!last.chunks_exact(2).any(|run| run[1] == json!("string")));
        assert!(last.chunks_exact(2).any(|run| run[1] == json!("number")));
        // Also cover the real component that exposed the JSX fragment failure.
        let source =
            include_str!("../../../src/modules/settings/components/Settings/SettingsContent.tsx");
        let result = classify("SettingsContent.tsx", source).unwrap();
        for (line, runs) in source.lines().zip(result.lines) {
            if line.trim_start().starts_with("import ") {
                assert!(runs.chunks_exact(2).any(|run| run[1] == json!("control")));
            }
        }
    }

    #[test]
    fn hunk_headers_and_removed_strings_do_not_poison_added_code() {
        let text = "@@ -1,1 +1,1 @@\nconst old = `unterminated\nconst value = 42;\n@@ -20,1 +20,1 @@\nreturn value;";
        let types = ["hunk", "remove", "add", "hunk", "context"].map(str::to_owned);
        let result = classify_diff("file.ts", text, &types).unwrap();
        assert!(result.lines[0].is_empty());
        assert_eq!(result.lines[2][1], json!("keyword"));
        assert!(
            result.lines[2]
                .chunks_exact(2)
                .any(|r| r[1] == json!("number"))
        );
        assert_eq!(result.lines[4][1], json!("control"));
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
        assert!(classify("unknown-file", "x").is_none());
    }

    #[test]
    fn declines_long_lines_before_entering_the_grammar() {
        let long = format!("let x = \"{}\";\n", "a".repeat(MAX_LINE_BYTES));
        assert!(classify("m.rs", &long).is_none());
        // The line limit excludes the newline itself.
        let boundary = format!("//{}\n", "a".repeat(MAX_LINE_BYTES - 2));
        assert_eq!(
            kinds("m.rs", &boundary)[0],
            vec![json!(MAX_LINE_BYTES), json!("comment")]
        );
    }
}
