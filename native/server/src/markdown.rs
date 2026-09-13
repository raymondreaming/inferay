//! Shared, bounded Markdown preparation for document and streaming chat views.
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

const MAX_DEPTH: usize = 16;
pub(crate) const MAX_PARSE_BYTES: usize = 2 * 1024 * 1024;
static LIST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$").unwrap());
static HEADING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(#{1,6})\s+(.*)$").unwrap());
static AUTO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:https?://[^\s)<>]+|[\w./-]+\.md\b|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s)<>]*)",
    )
    .unwrap()
});

#[derive(Debug, Serialize, ts_rs::TS)]
pub struct PreparedMarkdown {
    #[ts(type = "1")]
    pub version: u8,
    pub blocks: Vec<MdBlock>,
}
#[derive(Debug, Serialize, ts_rs::TS)]
pub struct MdBlock {
    #[serde(rename = "type")]
    #[ts(
        type = "'heading' | 'code' | 'mermaid' | 'blockquote' | 'hr' | 'table' | 'ul' | 'ol' | 'checklist' | 'paragraph'"
    )]
    pub kind: &'static str,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tokens: Option<Vec<MdInlineToken>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub level: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rows: Option<Vec<Vec<Vec<MdInlineToken>>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub items: Option<Vec<MdListItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub children: Option<Vec<MdBlock>>,
}
#[derive(Debug, Serialize, ts_rs::TS)]
pub struct MdListItem {
    pub bullet: String,
    pub tokens: Vec<MdInlineToken>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub checked: Option<bool>,
    pub indent: usize,
}
#[derive(Debug, Serialize, ts_rs::TS)]
pub struct MdInlineToken {
    #[serde(rename = "type")]
    #[ts(
        type = "'text' | 'bold' | 'italic' | 'bold-italic' | 'strikethrough' | 'code' | 'link' | 'image' | 'linebreak' | 'markdown_path' | 'url'"
    )]
    pub kind: &'static str,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub href: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub children: Option<Vec<MdInlineToken>>,
}
impl MdBlock {
    fn new(kind: &'static str, content: &str) -> Self {
        Self {
            kind,
            content: content.into(),
            tokens: None,
            level: None,
            lang: None,
            rows: None,
            items: None,
            children: None,
        }
    }
}
impl MdInlineToken {
    fn new(kind: &'static str, text: &str) -> Self {
        Self {
            kind,
            text: text.into(),
            href: None,
            alt: None,
            children: None,
        }
    }
}
fn safe_href(href: &str) -> bool {
    if href.chars().any(char::is_control) {
        return false;
    }
    let href = href.trim();
    match href.find(':') {
        Some(colon) if !href[..colon].contains(['/', '?', '#']) => matches!(
            href[..colon].to_ascii_lowercase().as_str(),
            "http" | "https" | "mailto" | "tel"
        ),
        _ => true,
    }
}
struct Parser {
    chat: bool,
    streaming: bool,
    budget: usize,
}
impl Parser {
    fn inline(&mut self, src: &str, depth: usize) -> Vec<MdInlineToken> {
        if depth >= MAX_DEPTH || self.budget < src.len() {
            return vec![MdInlineToken::new("text", src)];
        }
        self.budget -= src.len();
        let mut out: Vec<MdInlineToken> = Vec::new();
        let mut pos = 0;
        while pos < src.len() {
            let s = &src[pos..];
            let mut matched = None;
            // Charge delimiter searches against a shared budget, so malformed repeated
            // delimiters cannot cause quadratic scanning or excessive nested expansion.
            let special = s.starts_with(['!', '[', '`', '*', '_', '~']);
            if special && self.budget > 0 {
                let image = s.starts_with("![");
                if image || s.starts_with('[') {
                    let start = if image { 2 } else { 1 };
                    if let Some(end) =
                        find_budget(&s[start..], "](", &mut self.budget).map(|n| n + start)
                        && let Some(close) =
                            find_budget(&s[end + 2..], ")", &mut self.budget).map(|n| n + end + 2)
                    {
                        let label = &s[start..end];
                        let href = &s[end + 2..close];
                        let mut token =
                            MdInlineToken::new(if image { "image" } else { "link" }, label);
                        if safe_href(href) {
                            token.href = Some(href.trim().into());
                            if image {
                                token.alt = Some(label.into());
                            } else {
                                let chat = self.chat;
                                self.chat = false;
                                token.children = Some(self.inline(label, depth + 1));
                                self.chat = chat;
                                token.text.clear();
                            }
                        } else {
                            token = MdInlineToken::new("text", &s[..=close]);
                        }
                        matched = Some((close + 1, token));
                    }
                }
                if matched.is_none() {
                    for (mark, kind) in [
                        ("`", "code"),
                        ("***", "bold-italic"),
                        ("___", "bold-italic"),
                        ("**", "bold"),
                        ("__", "bold"),
                        ("~~", "strikethrough"),
                        ("*", "italic"),
                        ("_", "italic"),
                    ] {
                        if let Some(rest) = s.strip_prefix(mark)
                            && let Some(end) = closing_delimiter(rest, mark, &mut self.budget)
                        {
                            let text = &rest[..end];
                            if !text.is_empty() && (kind == "code" || text.trim() == text) {
                                let mut token = MdInlineToken::new(kind, text);
                                if kind != "code" {
                                    token.children = Some(self.inline(text, depth + 1));
                                    token.text.clear();
                                }
                                matched = Some((mark.len() * 2 + end, token));
                                break;
                            }
                        }
                    }
                }
            }
            if matched.is_none() && (s.starts_with("\\\n") || s.starts_with("\\n")) {
                matched = Some((2, MdInlineToken::new("linebreak", "")));
            }
            if matched.is_none() && s.starts_with("  ") {
                let spaces = s.bytes().take_while(|b| *b == b' ').count();
                if s[spaces..].starts_with('\n') {
                    matched = Some((spaces + 1, MdInlineToken::new("linebreak", "")));
                } else {
                    matched = Some((spaces, MdInlineToken::new("text", &s[..spaces])));
                }
            }
            if matched.is_none()
                && self.chat
                && (pos == 0
                    || !src[..pos]
                        .chars()
                        .next_back()
                        .is_some_and(|c| c.is_alphanumeric() || matches!(c, '/' | '.' | '_' | '-')))
                && let Some(m) = AUTO.find(s)
            {
                let value = m.as_str();
                let path =
                    value.to_ascii_lowercase().ends_with(".md") && !value.starts_with("http");
                let mut token =
                    MdInlineToken::new(if path { "markdown_path" } else { "url" }, value);
                if !path {
                    token.href = Some(if value.starts_with("http") {
                        value.into()
                    } else {
                        format!("https://{value}")
                    });
                }
                matched = Some((value.len(), token));
            }
            if let Some((len, token)) = matched {
                pos += len;
                out.push(token);
            } else {
                let ch = s.chars().next().unwrap();
                pos += ch.len_utf8();
                if let Some(last) = out.last_mut().filter(|t| t.kind == "text") {
                    last.text.push(ch);
                } else {
                    out.push(MdInlineToken::new("text", &ch.to_string()));
                }
            }
        }
        out
    }
    fn text_block(&mut self, kind: &'static str, text: &str) -> MdBlock {
        let mut b = MdBlock::new(kind, "");
        b.tokens = Some(self.inline(text, 0));
        b
    }
    fn blocks(&mut self, src: &str, depth: usize) -> Vec<MdBlock> {
        self.blocks_recorded(src, depth, None, 0)
    }
    fn blocks_recorded(
        &mut self,
        src: &str,
        depth: usize,
        mut starts: Option<&mut Vec<BlockStart>>,
        source_offset: usize,
    ) -> Vec<MdBlock> {
        if depth >= MAX_DEPTH {
            return vec![self.text_block("paragraph", src)];
        }
        let lines: Vec<_> = src.split('\n').collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < lines.len() {
            let line = lines[i];
            let trimmed = line.trim();
            if trimmed.is_empty() {
                i += 1;
                continue;
            }
            if let Some(starts) = starts.as_mut() {
                starts.push(BlockStart {
                    offset: source_offset + (line.as_ptr() as usize - src.as_ptr() as usize),
                    budget: self.budget,
                });
            }
            if let Some(fence) = fence(line) {
                let lang = line.trim_start()[fence.len()..].trim();
                let start = i + 1;
                i = start;
                while i < lines.len() && !lines[i].trim_start().starts_with(&fence) {
                    i += 1;
                }
                let mut b = MdBlock::new(
                    if lang == "mermaid" { "mermaid" } else { "code" },
                    &lines[start..i].join("\n"),
                );
                b.lang = Some(lang.into());
                out.push(b);
                i += usize::from(i < lines.len());
                continue;
            }
            if let Some(m) = HEADING.captures(line) {
                let text = m[2].trim_end();
                let without_hashes = text.trim_end_matches('#');
                let text = if without_hashes.ends_with(char::is_whitespace) {
                    without_hashes.trim_end()
                } else {
                    text
                };
                let mut b = self.text_block("heading", text);
                b.level = Some(m[1].len());
                out.push(b);
                i += 1;
                continue;
            }
            if i + 1 < lines.len() && setext(lines[i + 1]) {
                let mut b = self.text_block("heading", trimmed);
                b.level = Some(if lines[i + 1].starts_with('=') { 1 } else { 2 });
                out.push(b);
                i += 2;
                continue;
            }
            if hr(trimmed) {
                out.push(MdBlock::new("hr", ""));
                i += 1;
                continue;
            }
            if let Some(end) = self.table_end(&lines, i, src.ends_with('\n')) {
                let mut rows = Vec::new();
                for (offset, row) in lines[i..end].iter().enumerate() {
                    if offset == 1 && separator(row) {
                        continue;
                    }
                    rows.push(cells(row).iter().map(|c| self.inline(c, 0)).collect());
                }
                let mut b = MdBlock::new("table", "");
                b.rows = Some(rows);
                out.push(b);
                i = end;
                continue;
            }
            if line.starts_with("> ") || line == ">" {
                let mut quoted = Vec::new();
                while i < lines.len() && (lines[i].starts_with("> ") || lines[i] == ">") {
                    quoted.push(
                        lines[i]
                            .strip_prefix('>')
                            .unwrap()
                            .strip_prefix(' ')
                            .unwrap_or(&lines[i][1..]),
                    );
                    i += 1;
                }
                let text = quoted.join("\n");
                let mut b = MdBlock::new("blockquote", "");
                b.children = Some(self.blocks(&text, depth + 1));
                out.push(b);
                continue;
            }
            if let Some(first) = LIST.captures(line) {
                let ordered = first[2].starts_with(|c: char| c.is_ascii_digit());
                let mut items = Vec::new();
                while i < lines.len() {
                    let Some(m) = LIST.captures(lines[i]) else {
                        break;
                    };
                    if m[2].starts_with(|c: char| c.is_ascii_digit()) != ordered {
                        break;
                    }
                    let mut text = m[3].to_string();
                    let mut checked = None;
                    if (text.starts_with("[ ]")
                        || text.starts_with("[x]")
                        || text.starts_with("[X]"))
                        && let Some(space) = text[3..].chars().next().filter(|c| c.is_whitespace())
                    {
                        checked = Some(!text.starts_with("[ ]"));
                        text = text[3 + space.len_utf8()..].into();
                    }
                    let tokens = self.inline(&text, 0);
                    items.push(MdListItem {
                        bullet: m[2].into(),
                        tokens,
                        checked,
                        indent: m[1].len(),
                    });
                    i += 1;
                }
                let mut b = MdBlock::new(
                    if items.iter().any(|it| it.checked.is_some()) {
                        "checklist"
                    } else if ordered {
                        "ol"
                    } else {
                        "ul"
                    },
                    "",
                );
                b.items = Some(items);
                out.push(b);
                continue;
            }
            let start = i;
            i += 1;
            while i < lines.len()
                && !lines[i].trim().is_empty()
                && fence(lines[i]).is_none()
                && !HEADING.is_match(lines[i])
                && !hr(lines[i].trim())
                && !lines[i].starts_with('>')
                && !LIST.is_match(lines[i])
                && self.table_end(&lines, i, src.ends_with('\n')).is_none()
                && !(i + 1 < lines.len() && setext(lines[i + 1]))
            {
                i += 1;
            }
            out.push(self.text_block("paragraph", &lines[start..i].join("\n")));
        }
        out
    }
    fn table_end(&self, lines: &[&str], i: usize, trailing_newline: bool) -> Option<usize> {
        let t = lines[i].trim();
        if self.chat {
            if !t.starts_with('|')
                || !(t.ends_with('|')
                    || (self.streaming && (i + 1 < lines.len() || trailing_newline)))
            {
                return None;
            }
            let mut end = i + 1;
            while end < lines.len()
                && lines[end].trim().starts_with('|')
                && (self.streaming || lines[end].trim().ends_with('|'))
            {
                end += 1;
            }
            return (end > i + 1 || self.streaming).then_some(end);
        }
        if !t.contains('|') || i + 1 >= lines.len() || !separator(lines[i + 1]) {
            return None;
        }
        let mut end = i + 2;
        while end < lines.len() && lines[end].contains('|') {
            end += 1;
        }
        Some(end)
    }
}
fn find_budget(haystack: &str, needle: &str, budget: &mut usize) -> Option<usize> {
    let mut limit = haystack.len().min(*budget);
    while !haystack.is_char_boundary(limit) {
        limit -= 1;
    }
    let found = haystack[..limit].find(needle);
    *budget -= found.map_or(limit, |offset| offset + needle.len());
    found
}
fn closing_delimiter(rest: &str, mark: &str, budget: &mut usize) -> Option<usize> {
    let mut offset = 0;
    loop {
        let first = offset + find_budget(&rest[offset..], mark, budget)?;
        if mark == "`" {
            return Some(first);
        }
        // Use the end of a closing run so nested emphasis closes inside-out.
        let marker = mark.as_bytes()[0];
        let run = rest[first..].bytes().take_while(|b| *b == marker).count();
        *budget = budget.saturating_sub(run.saturating_sub(mark.len()));
        if mark.len() == 1 && run == 2 {
            offset = first + run;
            continue;
        }
        return Some(first + run - mark.len());
    }
}
fn fence(line: &str) -> Option<String> {
    let n = line.trim_start().bytes().take_while(|b| *b == b'`').count();
    (n >= 3).then(|| "`".repeat(n))
}
fn setext(line: &str) -> bool {
    let s = line.trim_end();
    s.len() >= 2 && (s.bytes().all(|c| c == b'=') || s.bytes().all(|c| c == b'-'))
}
fn hr(line: &str) -> bool {
    line.len() >= 3
        && [b'-', b'*', b'_']
            .iter()
            .any(|c| line.bytes().all(|b| b == *c))
}
fn cells(row: &str) -> Vec<&str> {
    let row = row.trim();
    let row = row.strip_prefix('|').unwrap_or(row);
    let row = row.strip_suffix('|').unwrap_or(row);
    row.split('|').map(str::trim).collect()
}
fn separator(row: &str) -> bool {
    let c = cells(row);
    !c.is_empty()
        && c.iter().all(|s| {
            let s = s.trim_matches(':');
            !s.is_empty() && s.bytes().all(|b| b == b'-')
        })
}

pub fn prepare(text: &str, streaming: bool, chat: bool) -> PreparedMarkdown {
    let mut parser = Parser {
        chat,
        streaming,
        budget: MAX_PARSE_BYTES * 4,
    };
    let blocks = if text.len() > MAX_PARSE_BYTES {
        let mut block = MdBlock::new("paragraph", "");
        block.tokens = Some(vec![MdInlineToken::new("text", text)]);
        vec![block]
    } else {
        parser.blocks(text, 0)
    };
    PreparedMarkdown { version: 1, blocks }
}

#[derive(Clone, Copy)]
struct BlockStart {
    offset: usize,
    budget: usize,
}

/// Checkpoints retain parser budget as well as source offsets. Replaying a tail
/// must have exactly the same delimiter-search budget as parsing the whole text.
#[derive(Default)]
pub(crate) struct IncrementalMarkdown {
    text: String,
    starts: Vec<BlockStart>,
    lines: usize,
    streaming: bool,
    chat: bool,
    pub revision: u64,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownPatch {
    #[ts(type = "1")]
    pub version: u8,
    pub revision: u32,
    pub reset: bool,
    pub start: usize,
    pub delete_count: usize,
    pub blocks: Vec<MdBlock>,
}

impl IncrementalMarkdown {
    pub fn weight(&self) -> usize {
        self.text.capacity() + self.starts.capacity() * std::mem::size_of::<BlockStart>()
    }

    pub fn update(
        &mut self,
        text: &str,
        reset: bool,
        streaming: bool,
        chat: bool,
    ) -> Result<MarkdownPatch, &'static str> {
        let bytes = if reset { 0 } else { self.text.len() };
        let lines =
            if reset { 1 } else { self.lines } + text.bytes().filter(|b| *b == b'\n').count();
        if bytes + text.len() > MAX_PARSE_BYTES || lines > 50_000 {
            return Err("Markdown exceeds the 2 MiB or 50,000 line preparation limit");
        }
        if !reset && self.revision >= u32::MAX as u64 {
            return Err("Markdown stream revision limit reached");
        }
        let old_count = self.starts.len();
        // The last line can change the interpretation of the preceding block
        // (setext headings, table lookahead, or a partial block delimiter).
        // Keep two blocks mutable; all earlier top-level blocks are complete.
        let start = if reset || streaming != self.streaming || chat != self.chat {
            0
        } else {
            old_count.saturating_sub(2)
        };
        let checkpoint = if start == 0 {
            BlockStart {
                offset: 0,
                budget: MAX_PARSE_BYTES * 4,
            }
        } else {
            self.starts[start]
        };
        if reset {
            self.text.clear();
            self.revision = 0;
        }
        self.text.push_str(text);
        self.lines = lines;
        self.streaming = streaming;
        self.chat = chat;
        self.starts.truncate(start);
        let mut parser = Parser {
            streaming,
            chat,
            budget: checkpoint.budget,
        };
        let blocks = parser.blocks_recorded(
            &self.text[checkpoint.offset..],
            0,
            Some(&mut self.starts),
            checkpoint.offset,
        );
        self.revision += 1;
        Ok(MarkdownPatch {
            version: 1,
            revision: self.revision as u32,
            reset,
            start,
            delete_count: old_count - start,
            blocks,
        })
    }
}

#[cfg(test)]
mod incremental_tests {
    use super::*;
    use serde_json::{Value, json};

    fn check_prefixes(text: &str, stride: usize, chat: bool) {
        let mut model = IncrementalMarkdown::default();
        let mut blocks = Vec::<Value>::new();
        let mut previous = 0;
        let mut ends: Vec<_> = text
            .char_indices()
            .map(|(i, _)| i)
            .step_by(stride)
            .collect();
        ends.push(text.len());
        for end in ends {
            let patch = model
                .update(&text[previous..end], previous == 0, true, chat)
                .unwrap();
            let value = serde_json::to_value(&patch).unwrap();
            let inserted = value["blocks"].as_array().unwrap().clone();
            if patch.reset {
                blocks = inserted;
            } else {
                blocks.splice(patch.start..patch.start + patch.delete_count, inserted);
            }
            assert_eq!(
                json!(blocks),
                serde_json::to_value(prepare(&text[..end], true, chat)).unwrap()["blocks"],
                "prefix {end}: {:?}",
                &text[..end]
            );
            previous = end;
        }
        let patch = model.update("", false, false, chat).unwrap();
        let value = serde_json::to_value(&patch).unwrap();
        blocks.splice(
            patch.start..patch.start + patch.delete_count,
            value["blocks"].as_array().unwrap().clone(),
        );
        assert_eq!(
            json!(blocks),
            serde_json::to_value(prepare(text, false, chat)).unwrap()["blocks"]
        );
    }

    #[test]
    fn incremental_matches_full_parser_at_every_character_and_finalization() {
        let fixtures = [
            "intro\n\nsecond\n\nthird\n\nHeading\n---\n\nTail 🦀 *emphasis* and [link](https://example.com)",
            "intro\n\nsecond\n\nthird\n| column | other |\n| --- | --- |\n| cell | partial",
            "intro\n\nsecond\n\nthird\n```rust\nfn main() {}\n\n# still code\n```\n\nlast",
            "intro\n\nsecond\n\nthird\n> quoted\n> ## heading\n> - list\n> ```\n> code\n> ```\nend",
            "intro\n\nsecond\n\nthird\n- a\n- [x] task\n1. one\n2. two\n\nend",
            "intro\n\nsecond\n\nthird\n   \n    tail\n\n| alone |\n\nnext\n___\nend",
            "a\n\nb\n\nc\n**bold _nested_** ![image](file.md)  \nline\\nmore\n\nfin",
        ];
        for chat in [false, true] {
            for fixture in fixtures {
                check_prefixes(fixture, 1, chat);
            }
        }
    }

    #[test]
    fn incremental_preserves_search_budget_and_limits_without_partial_mutation() {
        let text = format!("{}\n\n{}\n\nend", "[".repeat(12000), "*a* ".repeat(100));
        check_prefixes(&text, 257, true);
        let mut model = IncrementalMarkdown::default();
        model.update("safe", true, true, true).unwrap();
        assert!(
            model
                .update(&"x".repeat(MAX_PARSE_BYTES), false, true, true)
                .is_err()
        );
        assert_eq!(model.text, "safe");
        assert_eq!(model.revision, 1);
        assert!(
            model
                .update(&"\n".repeat(50_000), false, true, true)
                .is_err()
        );
        assert_eq!(model.text, "safe");
    }

    #[test]
    fn incremental_matches_mixed_boundaries_across_irregular_chunks() {
        let lines = [
            "",
            "plain",
            "---",
            "==",
            "# title",
            "```",
            "```rs",
            "|a|b|",
            "|--|--|",
            "|partial",
            "> quote",
            ">",
            "- item",
            "1. item",
            "[x](https://example.com)",
            "**incomplete",
            "  ",
            "🦀",
        ];
        let mut seed = 42u64;
        for round in 0..80 {
            let mut text = String::new();
            for _ in 0..40 {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                text.push_str(lines[(seed >> 32) as usize % lines.len()]);
                text.push('\n');
            }
            check_prefixes(&text, round % 13 + 1, round % 2 == 0);
        }
    }
}
