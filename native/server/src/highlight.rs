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
    /// Native callers use typed runs. Only HTTP serialization flattens each
    /// line to `[length, kind, …]`, with lengths in UTF-16 code units.
    #[serde(serialize_with = "serialize_lines")]
    #[ts(type = "Array<Array<number | string>>")]
    pub lines: Vec<Vec<SyntaxRun>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SyntaxRun {
    pub utf16_len: usize,
    pub kind: SyntaxKind,
}

fn serialize_lines<S: serde::Serializer>(
    lines: &[Vec<SyntaxRun>],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    struct Line<'a>(&'a [SyntaxRun]);
    impl Serialize for Line<'_> {
        fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            use serde::ser::SerializeSeq;
            let mut sequence = serializer.serialize_seq(Some(self.0.len() * 2))?;
            for run in self.0 {
                sequence.serialize_element(&run.utf16_len)?;
                sequence.serialize_element(&run.kind)?;
            }
            sequence.end()
        }
    }
    serializer.collect_seq(lines.iter().map(|runs| Line(runs)))
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
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut lines = Vec::new();
    for line in text.split_inclusive('\n') {
        if lines.len() >= MAX_LINES {
            return None;
        }
        lines.push(classify_line(&mut state, &mut stack, line)?);
    }
    Some(Classified {
        version: 3,
        language: syntax.name.clone(),
        lines,
    })
}

fn classify_line(
    state: &mut ParseState,
    stack: &mut ScopeStack,
    line: &str,
) -> Option<Vec<SyntaxRun>> {
    let ops = state.parse_line(line, syntaxes()).ok()?;
    let mut runs: Vec<SyntaxRun> = Vec::new();
    for (piece, op) in ScopeRegionIterator::new(&ops, line) {
        stack.apply(op).ok()?;
        let piece = piece.trim_end_matches('\n');
        if piece.is_empty() {
            continue;
        }
        let current = kind(stack);
        match runs.last_mut() {
            Some(run) if run.kind == current => run.utf16_len += units(piece),
            _ => runs.push(SyntaxRun {
                utf16_len: units(piece),
                kind: current,
            }),
        }
    }
    Some(runs)
}

/// Parse shared text once, reusing the common suffix only when both grammar
/// and scope state agree. No document or parser state survives this call.
pub fn classify_pair(path: &str, before: &str, after: &str) -> [Option<Classified>; 2] {
    let paired = (|| -> Option<[Classified; 2]> {
        let syntax = syntax(path)?;
        let sources = [before, after];
        if sources.iter().any(|text| {
            text.len() > MAX_BYTES || text.lines().any(|line| line.len() > MAX_LINE_BYTES)
        }) {
            return None;
        }
        let [old, new] = sources.map(|text| text.split_inclusive('\n').collect::<Vec<_>>());
        if old.len().max(new.len()) > MAX_LINES {
            return None;
        }
        let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
        let suffix = old[prefix..]
            .iter()
            .rev()
            .zip(new[prefix..].iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
        let mut state = ParseState::new(syntax);
        let mut stack = ScopeStack::new();
        let mut old_runs = Vec::with_capacity(old.len());
        for line in &old[..prefix] {
            old_runs.push(classify_line(&mut state, &mut stack, line)?);
        }
        let mut new_runs = old_runs.clone();
        let (mut new_state, mut new_stack) = (state.clone(), stack.clone());
        for line in &old[prefix..old.len() - suffix] {
            old_runs.push(classify_line(&mut state, &mut stack, line)?);
        }
        for line in &new[prefix..new.len() - suffix] {
            new_runs.push(classify_line(&mut new_state, &mut new_stack, line)?);
        }
        let mut shared_suffix = false;
        for line in &old[old.len() - suffix..] {
            shared_suffix = shared_suffix || state == new_state && stack == new_stack;
            let runs = classify_line(&mut state, &mut stack, line)?;
            new_runs.push(if shared_suffix {
                runs.clone()
            } else {
                classify_line(&mut new_state, &mut new_stack, line)?
            });
            old_runs.push(runs);
        }
        Some([old_runs, new_runs].map(|lines| Classified {
            version: 3,
            language: syntax.name.clone(),
            lines,
        }))
    })();
    match paired {
        Some(pair) => pair.map(Some),
        None => [classify(path, before), classify(path, after)],
    }
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
    use serde_json::json;

    #[test]
    fn paired_classification_matches_independent_revisions() {
        let fixtures = [
            (
                "rs",
                "fn main() {\n    let value = 1;\n}\n",
                "fn main() {\n    let value = 2;\n}\n",
            ),
            ("rs", "let a = 1;\nlet b = 2;\n", "/*\nlet b = 2;\n"),
            (
                "js",
                "const value = `old\ntext`;\nreturn value;",
                "const value = `new\ntext`;\nreturn value;",
            ),
            ("py", "a = 1\nb = 2\nc = 3\n", "a = 1\n'''\nc = 3\n"),
            (
                "tsx",
                "<div>\n  text\n</div>\n",
                "<div>\n  <span>text</span>\n</div>\n",
            ),
            ("rs", "// café 😀\nlet x = 1;", "// café 😀\nlet x = 2;"),
            ("rs", "same\n", "same"),
            ("rs", "", "let x = 1;\n"),
            ("rs", "let x = 1;\n", ""),
            ("rs", "same\n", "same\n"),
            ("unknown", "plain\n", "other\n"),
        ];
        for (path, before, after) in fixtures {
            let pair = classify_pair(path, before, after);
            for (source, actual) in [before, after].into_iter().zip(pair) {
                assert_eq!(
                    serde_json::to_value(actual).unwrap(),
                    serde_json::to_value(classify(path, source)).unwrap(),
                    "{path}: {source}"
                );
            }
        }
        // Insert/remove delimiters at each row: unchanged text may acquire a
        // different meaning until the multiline grammar states converge.
        for (path, source) in [
            (
                "rs",
                "fn main() {\n/* comment\ncontinued */\nlet x = \"hello\";\n}\n",
            ),
            ("js", "const x = `hello\n${value}\nworld`;\n// done\n"),
        ] {
            let rows = source.split_inclusive('\n').collect::<Vec<_>>();
            for index in 0..rows.len() {
                for replacement in ["", "/*\n", "*/\n", "`\n", "// inserted\n"] {
                    let changed = format!(
                        "{}{}{}",
                        rows[..index].concat(),
                        replacement,
                        rows[index + 1..].concat()
                    );
                    for (source, actual) in [source, changed.as_str()]
                        .into_iter()
                        .zip(classify_pair(path, source, &changed))
                    {
                        assert_eq!(
                            serde_json::to_value(actual).unwrap(),
                            serde_json::to_value(classify(path, source)).unwrap()
                        );
                    }
                }
            }
        }
        let oversized = "x".repeat(MAX_LINE_BYTES + 1);
        let pair = classify_pair("rs", &oversized, "let x = 1;");
        assert!(pair[0].is_none());
        assert!(pair[1].is_some());
    }

    #[test]
    #[ignore = "manual syntax latency measurement"]
    fn benchmark_source_highlighting() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for path in [
            "native/gpui/src/workspace.rs",
            "native/server/src/lib.rs",
            "native/gpui/src/repository/diff.rs",
        ] {
            let source = std::fs::read_to_string(root.join(path)).unwrap();
            for pass in 0..3 {
                let start = std::time::Instant::now();
                let result = classify(path, &source).unwrap();
                eprintln!(
                    "syntax {path} pass={pass} lines={} elapsed={:?}",
                    result.lines.len(),
                    start.elapsed()
                );
                std::hint::black_box(result);
            }
        }
    }

    #[test]
    fn typed_runs_preserve_the_flat_http_contract() {
        let document = Classified {
            version: 3,
            language: "Rust".into(),
            lines: vec![
                vec![
                    SyntaxRun {
                        utf16_len: 3,
                        kind: SyntaxKind::Keyword,
                    },
                    SyntaxRun {
                        utf16_len: 2,
                        kind: SyntaxKind::Plain,
                    },
                ],
                vec![],
            ],
        };
        assert_eq!(
            serde_json::to_value(document).unwrap(),
            json!({
                "version":3, "language":"Rust", "lines":[[3,"keyword",2,"plain"],[]]
            })
        );
    }

    #[test]
    fn classification_covers_unicode_lines_without_duplicate_adjacent_kinds() {
        let source = "const café = \"🦀\";\nif (café) { return café; } // comment\n\n";
        let document = classify("js", source).unwrap();
        assert_eq!(document.lines.len(), source.lines().count());
        for (line, runs) in source.lines().zip(&document.lines) {
            assert_eq!(
                runs.iter().map(|run| run.utf16_len).sum::<usize>(),
                units(line)
            );
            assert!(runs.windows(2).all(|pair| pair[0].kind != pair[1].kind));
        }
        assert!(
            document
                .lines
                .iter()
                .flatten()
                .any(|run| run.kind == SyntaxKind::Control)
        );
        assert!(
            document
                .lines
                .iter()
                .flatten()
                .any(|run| run.kind == SyntaxKind::String)
        );
    }
}
