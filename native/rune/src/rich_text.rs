mod blocks;
mod cards;
mod prepared;
#[cfg(test)]
mod tests;

pub use cards::system_card;
pub use prepared::{Prepared, combine, fitted};

use crate::ui::Ink;
use inferay_core::chat_protocol::ChatTranscriptMessage;
use inferay_server::MdBlock;
use prepared::inline;
use rune::El;

#[derive(Clone)]
pub struct RichText {
    blocks: Vec<Block>,
}

#[derive(Clone)]
enum Block {
    Edit(crate::chat_inline_diff::EditDiff),
    Plain(Prepared),
    Text {
        heading: bool,
        text: Prepared,
    },
    Code {
        lang: String,
        text: Prepared,
        tool: bool,
    },
    Rule,
    Quote(Vec<Block>),
    Table(Vec<Vec<Prepared>>),
    List(Vec<ListItem>),
}

#[derive(Clone)]
struct ListItem {
    indent: usize,
    bullet: String,
    text: Prepared,
}

impl Block {
    fn prepare(block: MdBlock, theme: &str) -> Self {
        match block.kind {
            "code" | "mermaid" => {
                let runs = crate::syntax::highlights(
                    &block.content,
                    block.lang.as_deref().unwrap_or("text"),
                    theme,
                );
                Self::Code {
                    lang: block.lang.unwrap_or_default(),
                    text: Prepared::new(block.content.into(), runs, vec![]),
                    tool: false,
                }
            }
            "hr" => Self::Rule,
            "blockquote" => Self::Quote(
                block
                    .children
                    .unwrap_or_default()
                    .into_iter()
                    .map(|block| Self::prepare(block, theme))
                    .collect(),
            ),
            "table" => Self::Table(
                block
                    .rows
                    .unwrap_or_default()
                    .into_iter()
                    .map(|row| row.into_iter().map(|tokens| inline(&tokens)).collect())
                    .collect(),
            ),
            "ul" | "ol" | "checklist" => Self::List(
                block
                    .items
                    .unwrap_or_default()
                    .into_iter()
                    .map(|item| ListItem {
                        indent: item.indent,
                        bullet: item
                            .checked
                            .map(|checked| if checked { "✓".into() } else { "□".into() })
                            .unwrap_or(item.bullet),
                        text: inline(&item.tokens),
                    })
                    .collect(),
            ),
            _ => Self::Text {
                heading: block.kind == "heading",
                text: inline(block.tokens.as_deref().unwrap_or_default()),
            },
        }
    }
}

impl RichText {
    pub(crate) fn prepare(text: &str, theme: &str) -> Self {
        Self {
            blocks: inferay_server::prepare_markdown(text, false, true)
                .blocks
                .into_iter()
                .map(|block| Block::prepare(block, theme))
                .collect(),
        }
    }

    pub fn retheme(&self, theme: &str) -> Self {
        fn recolor(blocks: &mut [Block], theme: &str) {
            for block in blocks {
                match block {
                    Block::Code { text, lang, .. } => {
                        *text = text.with_highlights(crate::syntax::highlights(
                            text.content(),
                            lang,
                            theme,
                        ));
                    }
                    Block::Quote(children) => recolor(children, theme),
                    Block::Edit(edit) => *edit = edit.retheme(theme),
                    _ => {}
                }
            }
        }
        let mut prepared = self.clone();
        recolor(&mut prepared.blocks, theme);
        prepared
    }

    pub fn message(message: &ChatTranscriptMessage, theme: &str) -> Self {
        if message.role == "user" {
            return Self {
                blocks: vec![Block::Plain(Prepared::plain(message.content.as_str()))],
            };
        }
        if message.role != "tool" {
            return Self::prepare(&message.content, theme);
        }
        if let Some(edit) = message
            .render
            .as_ref()
            .and_then(|render| render.edit.as_ref())
        {
            return Self {
                blocks: vec![Block::Edit(crate::chat_inline_diff::EditDiff::prepare(
                    edit, theme,
                ))],
            };
        }
        let mut blocks = Vec::new();
        let mut code = |language: &str, content: String| {
            if content.trim().is_empty() {
                return;
            }
            let runs = crate::syntax::highlights(&content, language, theme);
            blocks.push(Block::Code {
                lang: language.to_owned(),
                text: Prepared::new(content.into(), runs, vec![]),
                tool: true,
            });
        };
        let mut parser =
            serde_json::Deserializer::from_str(&message.content).into_iter::<serde_json::Value>();
        if let Some(Ok(input)) = parser
            .next()
            .filter(|result| result.as_ref().is_ok_and(|v| v.is_object()))
        {
            let output = message.content[parser.byte_offset()..].trim();
            let output = if output.eq_ignore_ascii_case("completed") {
                ""
            } else {
                output
            };
            if let Some(command) = message
                .render
                .as_ref()
                .and_then(|r| r.summary.as_ref())
                .filter(|s| s.kind == "command")
                .map(|s| s.value.as_str())
            {
                code("sh", command.to_owned());
                if let Some(cwd) = input["cwd"].as_str() {
                    code("text", cwd.to_owned());
                }
            } else {
                code(
                    "json",
                    serde_json::to_string_pretty(&input).unwrap_or_default(),
                );
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(output) {
                code(
                    "json",
                    serde_json::to_string_pretty(&value).unwrap_or_default(),
                );
            } else {
                let language = message
                    .render
                    .as_ref()
                    .and_then(|render| {
                        if render.summary.as_ref().is_some_and(|s| s.kind == "command") {
                            None
                        } else {
                            render.display.as_ref().and_then(|d| d.file.as_deref())
                        }
                    })
                    .unwrap_or("text");
                code(language, output.to_owned());
            }
        } else if !message.content.trim().eq_ignore_ascii_case("completed") {
            code("text", message.content.clone());
        }
        Self { blocks }
    }

    pub fn render(&self, id: &str) -> El {
        self.render_in(id, Ink::body())
    }

    pub fn render_in(&self, id: &str, ink: Ink) -> El {
        blocks::render(&self.blocks, id, ink)
    }
}
