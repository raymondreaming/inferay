//! Prepared native text: Markdown interpretation and style allocation happen off the UI thread.
use crate::selectable::PreparedText;
use crate::zoom::ui;
use gpui::{prelude::*, *};
use inferay_server::{MdBlock, MdInlineToken};
use std::ops::Range;

#[derive(Clone)]
pub struct RichText {
    blocks: Vec<Block>,
}
#[derive(Clone)]
enum Block {
    Edit(crate::chat_inline_diff::EditDiff),
    Plain(PreparedText),
    Text {
        heading: bool,
        text: PreparedText,
    },
    Code {
        lang: SharedString,
        text: PreparedText,
        tool: bool,
    },
    Rule,
    Quote(Vec<Block>),
    Table(Vec<Vec<PreparedText>>),
    List(Vec<ListItem>),
}
#[derive(Clone)]
struct ListItem {
    indent: usize,
    bullet: SharedString,
    text: PreparedText,
}
impl Block {
    fn prepare(block: MdBlock, theme: &str) -> Self {
        match block.kind {
            "code" | "mermaid" => {
                let spans = crate::syntax::highlights(
                    &block.content,
                    block.lang.as_deref().unwrap_or("text"),
                    theme,
                );
                Self::Code {
                    lang: block.lang.unwrap_or_default().into(),
                    text: PreparedText::new(block.content.into(), spans, vec![]),
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
                            .unwrap_or(item.bullet)
                            .into(),
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
    fn prepare(text: &str, theme: &str) -> Self {
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
    pub fn message(
        message: &inferay_core::chat_protocol::ChatTranscriptMessage,
        theme: &str,
    ) -> Self {
        if message.role == "user" {
            return Self {
                blocks: vec![Block::Plain(PreparedText::plain(message.content.clone()))],
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
            let spans = crate::syntax::highlights(&content, language, theme);
            blocks.push(Block::Code {
                lang: language.to_owned().into(),
                text: PreparedText::new(content.into(), spans, vec![]),
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
                // A command mentioning a file can return terminal logs rather
                // than source. Only direct file-tool results inherit its grammar.
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
        } else {
            if !message.content.trim().eq_ignore_ascii_case("completed") {
                code("text", message.content.clone());
            }
        }
        Self { blocks }
    }
    pub fn render(&self, id: &str) -> AnyElement {
        if let [Block::Plain(text)] = self.blocks.as_slice() {
            return text.render(format!("message-text-{id}")).into_any_element();
        }
        if self
            .blocks
            .iter()
            .any(|block| matches!(block, Block::Code { tool: true, .. }))
        {
            let copy = self
                .blocks
                .iter()
                .filter_map(|block| match block {
                    Block::Code { text, .. } => Some(text.content().clone()),
                    _ => None,
                })
                .collect::<Vec<_>>();
            let selector = format!("tool-details-{id}");
            return div()
                .debug_selector(move || selector)
                .relative()
                .min_w_0()
                .rounded(ui(4.))
                .border_1()
                .border_color(rgba(0xebebeb18))
                .bg(rgba(0x181818dc))
                .child(
                    div()
                        .id(SharedString::from(format!("tool-details-body-{id}")))
                        .max_h(ui(320.))
                        .overflow_y_scroll()
                        .overflow_x_scroll()
                        .pl(ui(8.))
                        .pr(ui(28.))
                        .py(ui(8.))
                        .child(self.blocks(&self.blocks, id)),
                )
                .child(crate::copy_button::copy_button(
                    crate::button(SharedString::from(format!("copy-tool-{id}")), "")
                        .debug_selector(|| "tool-details-copy".into())
                        .aria_label("Copy tool details")
                        .absolute()
                        .right(ui(2.))
                        .top(ui(2.))
                        .size(ui(22.))
                        .p(ui(4.))
                        .justify_center(),
                    move || {
                        copy.iter()
                            .map(|text| text.as_ref())
                            .collect::<Vec<_>>()
                            .join("\n\n")
                    },
                ))
                .into_any_element();
        }
        self.blocks(&self.blocks, id).into_any_element()
    }
    fn blocks(&self, blocks: &[Block], id: &str) -> Div {
        div()
            .flex()
            .flex_col()
            .gap(ui(4.))
            .min_w_0()
            .children(blocks.iter().enumerate().map(|(index, block)| {
                let id = format!("{id}-{index}");
                match block {
                    Block::Edit(edit) => edit.render(&id).into_any_element(),
                    Block::Code { lang, text, tool } => {
                        if *tool {
                            return div()
                                .font_family("Menlo")
                                .text_size(ui(crate::colors::CHAT_DETAIL))
                                .line_height(ui(crate::colors::CHAT_DETAIL * 1.6))
                                .child(text.render(format!("tool-text-{id}")))
                                .into_any_element();
                        }
                        let copy = text.content().clone();
                        let selector = format!("code-card-{id}");
                        div()
                            .debug_selector(move || selector)
                            .min_w_0()
                            .rounded(ui(4.))
                            .border_1()
                            .border_color(rgba(0xebebeb18))
                            .bg(rgba(0x181818dc))
                            .child(
                                div()
                                    .flex()
                                    .justify_between()
                                    .items_center()
                                    .px(ui(8.))
                                    .py(ui(1.))
                                    .text_size(ui(9.))
                                    .line_height(ui(12.))
                                    .font_family(".SystemUIFont")
                                    .font_weight(FontWeight::NORMAL)
                                    .text_color(rgba(0xebebeb70))
                                    .child(lang.clone())
                                    .child(crate::copy_button::copy_button(
                                        crate::button(
                                            SharedString::from(format!("copy-code-{id}")),
                                            "",
                                        )
                                        .aria_label("Copy code")
                                        .size(ui(22.))
                                        .p(ui(4.))
                                        .justify_center(),
                                        move || copy.to_string(),
                                    )),
                            )
                            .child(
                                div()
                                    .id(SharedString::from(format!("code-{id}")))
                                    .overflow_x_scroll()
                                    .px(ui(8.))
                                    .pt(ui(2.))
                                    .pb(ui(6.))
                                    .font_family("Menlo")
                                    .text_size(ui(crate::colors::CHAT_SMALL))
                                    .line_height(ui(crate::colors::CHAT_SMALL * 1.625))
                                    .whitespace_nowrap()
                                    .child(text.render(format!("code-text-{id}"))),
                            )
                            .into_any_element()
                    }
                    Block::Rule => div()
                        .my(ui(8.))
                        .h(ui(1.))
                        .bg(rgba(0xebebeb18))
                        .into_any_element(),
                    Block::Quote(children) => div()
                        .pl(ui(crate::colors::CHAT_SMALL))
                        .border_l_2()
                        .border_color(rgba(0xebebeb40))
                        .child(self.blocks(children, &id))
                        .into_any_element(),
                    Block::Table(rows) => div()
                        .id(SharedString::from(id.clone()))
                        .overflow_x_scroll()
                        .children(rows.iter().enumerate().map(|(row, cells)| {
                            div()
                                .flex()
                                .children(cells.iter().enumerate().map(|(col, text)| {
                                    div()
                                        .w(ui(180.))
                                        .flex_shrink_0()
                                        .px(ui(10.))
                                        .py(ui(6.))
                                        .border_b_1()
                                        .border_color(rgba(0xebebeb18))
                                        .when(row == 0, |d| {
                                            d.font_weight(FontWeight::SEMIBOLD).bg(rgba(0xffffff08))
                                        })
                                        .child(text.render(format!("inline-{id}-{row}-{col}")))
                                }))
                        }))
                        .into_any_element(),
                    Block::List(items) => div()
                        .flex()
                        .flex_col()
                        .children(items.iter().enumerate().map(|(i, item)| {
                            div()
                                .flex()
                                .gap(ui(8.))
                                .pl(ui(item.indent as f32 * 4.))
                                .child(div().w(ui(20.)).flex_shrink_0().child(item.bullet.clone()))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .child(item.text.render(format!("inline-{id}-{i}"))),
                                )
                        }))
                        .into_any_element(),
                    Block::Plain(text) => text.render(id).into_any_element(),
                    Block::Text { heading, text } => div()
                        .line_height(ui(crate::colors::CHAT_BODY * 1.6))
                        .text_size(ui(crate::colors::CHAT_BODY))
                        .when(*heading, |d| {
                            d.font_weight(FontWeight::SEMIBOLD)
                                .text_color(rgb(0xebebeb))
                                .mt(ui(8.))
                        })
                        .child(text.render(format!("inline-{id}")))
                        .into_any_element(),
                }
            }))
    }
}
fn inline(tokens: &[MdInlineToken]) -> PreparedText {
    let mut text = String::new();
    let mut highlights = Vec::new();
    let mut links = Vec::new();
    fn append(
        tokens: &[MdInlineToken],
        text: &mut String,
        highlights: &mut Vec<(Range<usize>, HighlightStyle)>,
        links: &mut Vec<(Range<usize>, String)>,
        inherited: HighlightStyle,
    ) {
        for token in tokens {
            let mut style = inherited;
            match token.kind {
                "bold" | "bold-italic" => {
                    style.font_weight = Some(FontWeight::SEMIBOLD);
                    style.color = Some(rgb(0xebebeb).into());
                }
                "code" | "link" | "url" | "markdown_path" => {
                    style.color = Some(rgb(0xb8d7ff).into())
                }
                "strikethrough" => {
                    style.strikethrough = Some(StrikethroughStyle {
                        thickness: px(1.),
                        color: None,
                    })
                }
                _ => {}
            }
            if matches!(token.kind, "italic" | "bold-italic") {
                style.font_style = Some(FontStyle::Italic);
            }
            let start = text.len();
            if let Some(children) = &token.children {
                append(children, text, highlights, links, style);
            } else {
                text.push_str(if token.kind == "linebreak" {
                    "\n"
                } else {
                    &token.text
                });
                highlights.push((start..text.len(), style));
            }
            if let Some(href) = &token.href {
                links.push((start..text.len(), href.clone()));
            }
        }
    }
    append(
        tokens,
        &mut text,
        &mut highlights,
        &mut links,
        HighlightStyle::default(),
    );
    PreparedText::new(text.into(), highlights, links)
}
pub fn system_card(render: &inferay_core::chat_protocol::NativeChatRender) -> Option<AnyElement> {
    use inferay_core::chat_protocol::GoalCardStatus;
    let (title, objective, detail, turns, accent, glyph, command) = if let Some(goal) = &render.goal
    {
        let (accent, glyph) = match goal.status {
            GoalCardStatus::Active => (0x8ab4f8, "◎"),
            GoalCardStatus::Paused => (0xf4bd50, "Ⅱ"),
            GoalCardStatus::Complete => (0x55d68b, "✓"),
            _ => (0x888888, "◎"),
        };
        (
            goal.title.clone(),
            goal.objective.clone(),
            goal.detail.clone(),
            goal.turns_label.clone(),
            accent,
            glyph,
            false,
        )
    } else if let Some(command) = &render.command {
        (
            "Running Command".into(),
            Some(command.label.clone()),
            command.description.clone(),
            None,
            0x8ab4f8,
            "⋮",
            true,
        )
    } else if let Some(skill) = &render.skill_read {
        let skill = serde_json::to_value(skill).ok()?;
        (
            "Skill loaded".into(),
            skill["name"].as_str().map(str::to_owned),
            skill["description"].as_str().map(str::to_owned),
            skill["command"]
                .as_str()
                .map(|command| format!("/{command}")),
            0x8ab4f8,
            "✦",
            false,
        )
    } else if render.automation_definition_proposal.is_some()
        || render.automation_proposal.is_some()
        || render.plugin_proposal.is_some()
    {
        let (title, value) = if let Some(proposal) = &render.automation_definition_proposal {
            ("Automation proposal", serde_json::to_value(proposal).ok()?)
        } else if let Some(proposal) = &render.automation_proposal {
            ("Automation proposal", serde_json::to_value(proposal).ok()?)
        } else {
            (
                "Plugin proposal",
                serde_json::to_value(&render.plugin_proposal).ok()?,
            )
        };
        let definition = value["content"]
            .as_str()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
            .unwrap_or(value);
        let name = definition["name"].as_str().map(str::to_owned);
        let detail = definition["description"]
            .as_str()
            .or_else(|| definition["execution"]["instructions"].as_str())
            .map(str::to_owned);
        (
            title.into(),
            name,
            detail,
            Some("Not applied".into()),
            0xf4bd50,
            "◇",
            false,
        )
    } else {
        return None;
    };
    Some(
        div()
            .flex()
            .gap(ui(8.))
            .my(ui(4.))
            .py(ui(8.))
            .px(ui(10.))
            .rounded(ui(6.))
            .border_1()
            .border_color(rgba((accent << 8) | 0x40))
            .bg(rgba(0xffffff05))
            .child(
                div()
                    .size(ui(24.))
                    .flex_shrink_0()
                    .rounded(ui(4.))
                    .bg(rgba(0xffffff08))
                    .text_color(rgb(accent))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(glyph),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(ui(8.))
                            .text_size(ui(crate::colors::CHAT_SMALL))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(title)
                            .child(div().flex_1())
                            .when_some(turns, |d, turns| {
                                d.child(
                                    div()
                                        .text_size(ui(crate::colors::CHAT_DETAIL))
                                        .font_family("Menlo")
                                        .text_color(rgba(0xebebeb80))
                                        .child(turns),
                                )
                            }),
                    )
                    .when_some(objective, |d, objective| {
                        d.child(
                            div()
                                .mt(ui(2.))
                                .text_size(ui(crate::colors::CHAT_BODY))
                                .line_height(relative(1.45))
                                .text_color(if command {
                                    rgb(accent)
                                } else {
                                    rgba(0xebebebb8)
                                })
                                .when(command, |d| {
                                    d.font_family("Menlo").font_weight(FontWeight::SEMIBOLD)
                                })
                                .child(objective),
                        )
                    })
                    .when_some(detail, |d, detail| {
                        d.child(
                            div()
                                .mt(ui(2.))
                                .text_size(ui(crate::colors::CHAT_SMALL))
                                .text_color(rgba(0xebebeb80))
                                .child(detail),
                        )
                    }),
            )
            .into_any_element(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    #[ignore = "paired release benchmark"]
    fn benchmark_retained_inline_text() {
        use std::hint::black_box;
        for words in [64, 256, 1024] {
            let source = "**café** and [🦀](https://example.com) with `code` ".repeat(words);
            let mut parsed = inferay_server::prepare_markdown(&source, false, true).blocks;
            let tokens = parsed.remove(0).tokens.unwrap();
            let prepared = inline(&tokens);
            assert_eq!(
                prepared.content().as_ref(),
                "café and 🦀 with code ".repeat(words)
            );
            crate::performance::compare(&format!("inline_projection_{words}"), |retained| {
                black_box(if retained {
                    prepared.render("paragraph")
                } else {
                    inline(black_box(&tokens)).render("paragraph")
                });
            });
        }
    }

    #[gpui::test]
    #[ignore = "paired release GPUI frame benchmark"]
    fn benchmark_retained_text_frame(cx: &mut gpui::TestAppContext) {
        struct TextView {
            tokens: Vec<MdInlineToken>,
            prepared: PreparedText,
            retained: bool,
        }
        impl Render for TextView {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().size_full().overflow_hidden().child(if self.retained {
                    self.prepared.render("paragraph")
                } else {
                    inline(&self.tokens).render("paragraph")
                })
            }
        }
        let source = "**café** and [🦀](https://example.com) with `code` ".repeat(512);
        let mut parsed = inferay_server::prepare_markdown(&source, false, true).blocks;
        let tokens = parsed.remove(0).tokens.unwrap();
        let prepared = inline(&tokens);
        let (view, cx) = cx.add_window_view(|_, _| TextView {
            tokens,
            prepared,
            retained: false,
        });
        cx.simulate_resize(size(px(624.), px(600.)));
        crate::performance::compare("gpui_retained_text_frame_512", |retained| {
            view.update(cx, |view, cx| {
                view.retained = retained;
                cx.notify();
            });
            cx.draw(point(px(0.), px(0.)), size(px(624.), px(600.)), |_, _| {
                view.clone().into_any_element()
            });
        });
    }

    #[gpui::test]
    fn prepared_markdown_selection_copies_visible_unicode_text(cx: &mut gpui::TestAppContext) {
        struct Message(RichText);
        impl Render for Message {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().size_full().child(self.0.render("message"))
            }
        }
        let (view, cx) = cx.add_window_view(|_, _| {
            Message(RichText::prepare(
                "**Hello café** [🦀](https://example.com)",
                "vscode-black",
            ))
        });
        cx.draw(point(px(0.), px(0.)), size(px(400.), px(200.)), |_, _| {
            view.clone().into_any_element()
        });
        let bounds = cx.debug_bounds("selectable-text").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-a cmd-c");
        assert_eq!(
            cx.read_from_clipboard()
                .and_then(|item| item.text())
                .as_deref(),
            Some("Hello café 🦀")
        );
    }

    #[gpui::test]
    fn tool_details_use_one_card_and_copy_without_nested_labels(cx: &mut gpui::TestAppContext) {
        struct Details(RichText);
        impl Render for Details {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().size_full().child(self.0.render("tool"))
            }
        }
        let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
        buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"tool","name":"exec_command","input":{"cmd":"echo café"},"output":"café 🌳","done":true}));
        let rich = RichText::message(&buffer.messages()[0], "vscode-black");
        let (view, cx) = cx.add_window_view(|_, _| Details(rich));
        cx.draw(point(px(0.), px(0.)), size(px(600.), px(400.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("tool-details-tool").is_some());
        assert!(cx.debug_bounds("code-card-tool-0").is_none());
        assert!(cx.debug_bounds("code-card-tool-1").is_none());
        let copy = cx.debug_bounds("tool-details-copy").unwrap();
        cx.simulate_click(copy.center(), Modifiers::default());
        assert_eq!(
            cx.read_from_clipboard()
                .and_then(|item| item.text())
                .as_deref(),
            Some("echo café\n\ncafé 🌳")
        );
    }
    #[test]
    fn restored_tools_show_commands_outputs_and_edit_payloads() {
        let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
        buffer.replace_messages(vec![
            serde_json::from_value(serde_json::json!({"id":"command", "role":"tool", "toolName":"exec", "content":"{\"cmd\":\"cargo test\"}\n\npassed 🌳"})).unwrap(),
            serde_json::from_value(serde_json::json!({"id":"edit", "role":"tool", "toolName":"Edit", "content":"{\"file_path\":\"main.rs\",\"old_string\":\"old\",\"new_string\":\"new\"}"})).unwrap(),
        ]);
        let message = &buffer.messages()[0];
        assert_ne!(
            message
                .render
                .as_ref()
                .unwrap()
                .display
                .as_ref()
                .unwrap()
                .label,
            "exec"
        );
        let rich = RichText::message(message, "vscode-black");
        let Block::Code { text, lang, .. } = &rich.blocks[0] else {
            panic!("tool code block")
        };
        assert_eq!(text.content().as_ref(), "cargo test");
        assert_eq!(lang.as_ref(), "sh");
        let Block::Code { text, lang, .. } = &rich.blocks[1] else {
            panic!("separate output")
        };
        assert_eq!(text.content().as_ref(), "passed 🌳");
        assert_eq!(lang.as_ref(), "text");
        assert_eq!(
            buffer.messages()[1]
                .render
                .as_ref()
                .unwrap()
                .edit
                .as_ref()
                .unwrap()
                .file_path,
            "main.rs"
        );
        let raw = serde_json::from_value(
            serde_json::json!({"id":"raw", "role":"tool", "content":"output\n````\nmore"}),
        )
        .unwrap();
        let rich = RichText::message(&raw, "vscode-black");
        let Block::Code { text, .. } = &rich.blocks[0] else {
            panic!("literal tool output")
        };
        assert_eq!(text.content().as_ref(), "output\n````\nmore");
    }

    #[test]
    fn tool_cards_highlight_source_json_and_shell_and_follow_theme_changes() {
        let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
        for event in [
            serde_json::json!({"type":"inferay.tool","id":"read","name":"Read","input":{"file_path":"/src/App.tsx"},"output":"const title = \"café 🌳\";\nexport default function App() { return <h1>{title}</h1>; }","done":true}),
            serde_json::json!({"type":"inferay.tool","id":"shell","name":"exec_command","input":{"cmd":"echo \"café\"","cwd":"/tmp"},"output":"{\"ok\":true,\"count\":2}","done":true}),
        ] {
            buffer.apply_event(&event);
        }
        for message in buffer.messages() {
            let rich = RichText::message(message, "vscode-black");
            let recolored = rich.retheme("contrast");
            for (before, after) in rich.blocks.iter().zip(&recolored.blocks) {
                let Block::Code { lang, text, .. } = before else {
                    panic!("tool card")
                };
                let Block::Code { text: changed, .. } = after else {
                    panic!("recolored tool card")
                };
                assert_eq!(text.content(), changed.content());
                assert_eq!(
                    text.highlights(),
                    crate::syntax::highlights(text.content(), lang, "vscode-black")
                );
                assert_eq!(
                    changed.highlights(),
                    crate::syntax::highlights(text.content(), lang, "contrast")
                );
                if lang.as_ref() != "text" {
                    assert!(!text.highlights().is_empty(), "{lang}");
                    assert_ne!(text.highlights(), changed.highlights(), "{lang}");
                }
                if message.id == "read" && lang.as_ref() != "json" {
                    assert_eq!(lang.as_ref(), "/src/App.tsx");
                }
            }
        }
    }

    #[test]
    fn command_logs_stay_literal_and_progress_notes_render_markdown() {
        let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
        buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"logs","name":"exec_command","input":{"cmd":"git diff --cached App.tsx; echo finished"},"output":"Formatted 670 files.\ncreate mode 100644 App.tsx","done":true}));
        let rich = RichText::message(&buffer.messages()[0], "vscode-black");
        let Block::Code { lang, text, .. } = &rich.blocks[1] else {
            panic!("terminal output")
        };
        assert_eq!(lang.as_ref(), "text");
        assert!(text.highlights().is_empty());
        let note = serde_json::from_value(
            serde_json::json!({"id":"note","role":"system","content":"**Checking file status**"}),
        )
        .unwrap();
        let rich = RichText::message(&note, "vscode-black");
        let Block::Text { text, .. } = &rich.blocks[0] else {
            panic!("Markdown progress note")
        };
        assert_eq!(text.content().as_ref(), "Checking file status");
        assert!(
            text.highlights()
                .iter()
                .any(|(_, s)| s.font_weight == Some(FontWeight::SEMIBOLD))
        );
    }

    #[test]
    fn completion_filler_is_hidden_without_discarding_substantive_results() {
        for (output, count) in [
            ("completed", 1),
            (" Completed\n", 1),
            ("completed 3 files", 2),
            ("{\"status\":\"completed\"}", 2),
        ] {
            let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
            buffer.apply_event(&serde_json::json!({"type":"inferay.tool","id":"hook","name":"stop hook","input":{"event":"stop"},"output":output,"done":true}));
            let rich = RichText::message(&buffer.messages()[0], "vscode-black");
            assert_eq!(rich.blocks.len(), count, "{output}");
        }
    }
    #[test]
    fn preserves_rich_blocks_and_unicode_syntax_ranges() {
        let rich = RichText::prepare(
            "**Bold** and [link](https://example.com)\n\n- one\n- two\n\n```rust\nlet emoji = \"😀\";\n```",
            "vscode-black",
        );
        assert!(
            rich.blocks
                .iter()
                .any(|block| matches!(block, Block::List(_)))
        );
        let Block::Code { text, .. } = rich
            .blocks
            .iter()
            .find(|block| matches!(block, Block::Code { .. }))
            .unwrap()
        else {
            unreachable!()
        };
        assert_eq!(text.content().as_ref(), "let emoji = \"😀\";");
    }
}
