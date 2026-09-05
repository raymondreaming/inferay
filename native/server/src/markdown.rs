//! Shared, bounded Markdown preparation for document and streaming chat views.
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

const MAX_DEPTH: usize = 16;
const MAX_PARSE_BYTES: usize = 2 * 1024 * 1024;
static LIST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$").unwrap());
static HEADING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(#{1,6})\s+(.*)$").unwrap());
static AUTO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:https?://[^\s)<>]+|[\w./-]+\.md\b|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s)<>]*)",
    )
    .unwrap()
});

#[derive(Debug, Serialize)]
pub struct PreparedMarkdown {
    pub version: u8,
    pub blocks: Vec<MdBlock>,
}
#[derive(Debug, Serialize)]
pub struct MdBlock {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<Vec<MdInlineToken>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<Vec<MdInlineToken>>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<MdListItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<MdBlock>>,
}
#[derive(Debug, Serialize)]
pub struct MdListItem {
    pub bullet: String,
    pub content: String,
    pub tokens: Vec<MdInlineToken>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    pub indent: usize,
    pub children: Vec<MdListItem>,
}
#[derive(Debug, Serialize)]
pub struct MdInlineToken {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
                        content: String::new(),
                        tokens,
                        checked,
                        indent: m[1].len(),
                        children: Vec::new(),
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_features() {
        let p = prepare("**bold *inner*** and C#", false, false);
        let token = &p.blocks[0].tokens.as_ref().unwrap()[0];
        assert_eq!(token.kind, "bold");
        assert_eq!(token.children.as_ref().unwrap()[1].kind, "italic");
        assert_eq!(
            prepare("# C#", false, false).blocks[0]
                .tokens
                .as_ref()
                .unwrap()[0]
                .text,
            "C#"
        );
        let p = prepare("*italic **bold***", false, false);
        assert_eq!(
            p.blocks[0].tokens.as_ref().unwrap()[0]
                .children
                .as_ref()
                .unwrap()[1]
                .kind,
            "bold"
        );
        assert_eq!(cells("|| second |"), ["", "second"]);
        let p = prepare(
            "Title\n===\n\n> **bold *inner***\n\n- [x] done\n  - nested\n\n```mermaid\ngraph TD\n```\n\n| A | B |\n| -- | -- |\n| ü | `x` |",
            false,
            false,
        );
        assert_eq!(
            p.blocks.iter().map(|b| b.kind).collect::<Vec<_>>(),
            ["heading", "blockquote", "checklist", "mermaid", "table"]
        );
        assert_eq!(p.blocks[2].items.as_ref().unwrap()[0].checked, Some(true));
        assert_eq!(p.blocks[2].items.as_ref().unwrap()[1].indent, 2);
        assert_eq!(p.blocks[1].children.as_ref().unwrap()[0].kind, "paragraph");
        assert_eq!(p.blocks[3].content, "graph TD");
        assert!(p.blocks[0].content.is_empty());
        assert!(p.blocks[2].items.as_ref().unwrap()[0].content.is_empty());
        let lists = prepare("5. first\n6. second\n\n- bullet\n\n---", false, false);
        assert_eq!(lists.blocks[0].items.as_ref().unwrap()[0].bullet, "5.");
        assert_eq!(
            lists.blocks.iter().map(|b| b.kind).collect::<Vec<_>>(),
            ["ol", "ul", "hr"]
        );
        assert_eq!(p.blocks[4].rows.as_ref().unwrap()[1][0][0].text, "ü");
    }
    #[test]
    fn streaming_tables() {
        assert_eq!(prepare("| A | B", true, true).blocks[0].kind, "paragraph");
        assert_eq!(prepare("| A | B |", true, true).blocks[0].kind, "table");
        let p = prepare("| A | B |\n| -- | -- |\n| partial", true, true);
        assert_eq!(p.blocks[0].rows.as_ref().unwrap().len(), 2);
        assert_eq!(
            prepare("| A | B |", false, true).blocks[0].kind,
            "paragraph"
        );
    }
    #[test]
    fn unicode_and_links() {
        let p = prepare(
            "你好 **世界** read docs/plan.md and example.com [bad](javascript:alert) ![bad](data:x)",
            false,
            true,
        );
        let tokens = p.blocks[0].tokens.as_ref().unwrap();
        assert!(tokens.iter().any(|t| t.kind == "markdown_path"));
        assert!(tokens.iter().any(|t| t.kind == "url"));
        assert!(!tokens.iter().any(|t| matches!(t.kind, "link" | "image")));
        assert!(!safe_href("java\nscript:x"));
    }
    #[test]
    fn bounded_malformed_input() {
        let p = prepare(&"**bold** ".repeat(200), false, false);
        assert_eq!(
            p.blocks[0]
                .tokens
                .as_ref()
                .unwrap()
                .iter()
                .filter(|t| t.kind == "bold")
                .count(),
            200
        );
        let text = "[".repeat(100_000);
        let p = prepare(&text, false, false);
        assert_eq!(
            p.blocks[0]
                .tokens
                .as_ref()
                .unwrap()
                .iter()
                .map(|t| t.text.len())
                .sum::<usize>(),
            text.len()
        );
        let p = prepare(&format!("{}x", "> ".repeat(100)), false, false);
        assert_eq!(p.version, 1);
    }
}
