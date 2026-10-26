//! Native rendering of the same Markdown blocks and syntax kinds as the shipping chat.
use gpui::{prelude::*, *};
use inferay_server::{MdBlock, MdInlineToken};
use std::{collections::HashMap, ops::Range};

pub struct RichText {
    blocks: Vec<MdBlock>,
    code: HashMap<String, Vec<(Range<usize>, HighlightStyle)>>,
}
impl RichText {
    pub fn prepare(text: &str, tool: bool, theme: &str) -> Self {
        let blocks = if tool {
            vec![MdBlock {
                kind: "tool",
                content: text.into(),
                lang: Some("text".into()),
                tokens: None,
                level: None,
                rows: None,
                items: None,
                children: None,
            }]
        } else {
            inferay_server::prepare_markdown(text, false, true).blocks
        };
        let mut code = HashMap::new();
        fn classify(
            blocks: &[MdBlock],
            code: &mut HashMap<String, Vec<(Range<usize>, HighlightStyle)>>,
            theme: &str,
        ) {
            for block in blocks {
                if matches!(block.kind, "code" | "mermaid") {
                    code.insert(
                        block.content.clone(),
                        crate::syntax::highlights(
                            &block.content,
                            block.lang.as_deref().unwrap_or("text"),
                            theme,
                        ),
                    );
                }
                if let Some(children) = &block.children {
                    classify(children, code, theme);
                }
            }
        }
        classify(&blocks, &mut code, theme);
        Self { blocks, code }
    }
    pub fn message(
        message: &inferay_core::chat_protocol::ChatTranscriptMessage,
        theme: &str,
    ) -> Self {
        if message.role != "tool" {
            return Self::prepare(&message.content, false, theme);
        }
        let render = message.render.as_ref();
        let summary = render.and_then(|r| r.summary.as_ref());
        let output = render.and_then(|r| r.output_start).map(|start| {
            inferay_core::utf16_slice(
                &message.content,
                start,
                inferay_core::utf16_length(&message.content),
            )
        });
        let mut text = summary
            .map(|s| match s.kind {
                "command" => format!("$ {}", s.value),
                "pattern" => format!("/{}/", s.value),
                _ => s
                    .file_name
                    .as_ref()
                    .map(|f| format!("{f}\n{}", s.value))
                    .unwrap_or_else(|| s.value.clone()),
            })
            .unwrap_or_else(|| message.content.clone());
        if summary.is_some()
            && let Some(output) = output
            && !output.is_empty()
        {
            text.push('\n');
            text.push_str(&output);
        }
        let mut rich = Self::prepare(&text, true, theme);
        if let Some(summary) = summary {
            let first_line = text.find('\n').unwrap_or(text.len());
            rich.code.insert(
                text.clone(),
                vec![(
                    0..first_line,
                    HighlightStyle {
                        color: Some(rgb(0xb8d7ff).into()),
                        ..Default::default()
                    },
                )],
            );
            if summary.kind == "command" {
                rich.blocks[0].lang = Some("shell".into());
            }
        }
        rich
    }
    pub fn render(&self, id: &str) -> AnyElement {
        self.blocks(&self.blocks, id).into_any_element()
    }
    fn blocks(&self, blocks: &[MdBlock], id: &str) -> Div {
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .min_w_0()
            .children(blocks.iter().enumerate().map(|(index, block)| {
                let id = format!("{id}-{index}");
                match block.kind {
                    "code" | "mermaid" | "tool" => {
                        let copy = block.content.clone();
                        div()
                            .min_w_0()
                            .rounded(px(4.))
                            .border_1()
                            .border_color(rgba(0xebebeb18))
                            .bg(rgba(0x181818dc))
                            .child(
                                div()
                                    .flex()
                                    .justify_between()
                                    .px(px(8.))
                                    .py(px(4.))
                                    .text_size(px(10.))
                                    .text_color(rgba(0xebebeb80))
                                    .child(block.lang.clone().unwrap_or_default())
                                    .child(
                                        crate::button(
                                            SharedString::from(format!("copy-code-{id}")),
                                            "Copy",
                                        )
                                        .on_click(
                                            move |_, _, cx| {
                                                cx.write_to_clipboard(ClipboardItem::new_string(
                                                    copy.clone(),
                                                ))
                                            },
                                        ),
                                    ),
                            )
                            .child(
                                div()
                                    .id(SharedString::from(format!("code-{id}")))
                                    .overflow_x_scroll()
                                    .when(block.kind == "tool", |d| {
                                        d.max_h(px(112.)).overflow_y_scroll()
                                    })
                                    .px(px(8.))
                                    .py(px(6.))
                                    .font_family("Menlo")
                                    .text_size(px(crate::colors::CHAT_SMALL))
                                    .line_height(px(crate::colors::CHAT_SMALL * 1.625))
                                    .whitespace_nowrap()
                                    .when(block.kind == "tool", |d| {
                                        d.whitespace_normal()
                                            .text_size(px(crate::colors::CHAT_DETAIL))
                                            .line_height(px(crate::colors::CHAT_DETAIL * 1.6))
                                    })
                                    .child(crate::selectable::SelectableText {
                                        id: format!("code-text-{id}").into(), text: block.content.clone(),
                                        highlights: self.code.get(&block.content).cloned().unwrap_or_default(), links: vec![],
                                    }),
                            )
                            .into_any_element()
                    }
                    "hr" => div()
                        .my(px(8.))
                        .h(px(1.))
                        .bg(rgba(0xebebeb18))
                        .into_any_element(),
                    "blockquote" => div()
                        .pl(px(crate::colors::CHAT_SMALL))
                        .border_l_2()
                        .border_color(rgba(0xebebeb40))
                        .child(self.blocks(block.children.as_deref().unwrap_or_default(), &id))
                        .into_any_element(),
                    "table" => div()
                        .id(SharedString::from(id.clone()))
                        .overflow_x_scroll()
                        .children(block.rows.iter().flatten().enumerate().map(|(row, cells)| {
                            div()
                                .flex()
                                .children(cells.iter().enumerate().map(|(col, tokens)| {
                                    div()
                                        .w(px(180.))
                                        .flex_shrink_0()
                                        .px(px(10.))
                                        .py(px(6.))
                                        .border_b_1()
                                        .border_color(rgba(0xebebeb18))
                                        .when(row == 0, |d| {
                                            d.font_weight(FontWeight::SEMIBOLD).bg(rgba(0xffffff08))
                                        })
                                        .child(inline(tokens, &format!("{id}-{row}-{col}")))
                                }))
                        }))
                        .into_any_element(),
                    "ul" | "ol" | "checklist" => div()
                        .flex()
                        .flex_col()
                        .children(block.items.iter().flatten().enumerate().map(|(i, item)| {
                            div()
                                .flex()
                                .gap(px(8.))
                                .pl(px(item.indent as f32 * 4.))
                                .child(
                                    div().w(px(20.)).flex_shrink_0().child(
                                        item.checked
                                            .map(|c| if c { "✓" } else { "□" })
                                            .unwrap_or(&item.bullet)
                                            .to_string(),
                                    ),
                                )
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .child(inline(&item.tokens, &format!("{id}-{i}"))),
                                )
                        }))
                        .into_any_element(),
                    _ => div()
                        .line_height(px(crate::colors::CHAT_BODY * 1.6))
                        .text_size(px(crate::colors::CHAT_BODY))
                        .when(block.kind == "heading", |d| {
                            d.font_weight(FontWeight::SEMIBOLD)
                                .text_color(rgb(0xebebeb))
                                .mt(px(8.))
                        })
                        .child(inline(block.tokens.as_deref().unwrap_or_default(), &id))
                        .into_any_element(),
                }
            }))
    }
}
fn inline(tokens: &[MdInlineToken], id: &str) -> crate::selectable::SelectableText {
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
    crate::selectable::SelectableText { id: format!("inline-{id}").into(), text, highlights, links }

}
pub fn edit_card(edit: &inferay_core::chat_protocol::ChatEdit) -> Div {
    div()
        .rounded(px(4.))
        .border_1()
        .border_color(rgba(0xebebeb18))
        .overflow_hidden()
        .mb(px(8.))
        .child(
            div()
                .px(px(10.))
                .py(px(6.))
                .text_size(px(crate::colors::CHAT_SMALL))
                .child(edit.file_path.clone()),
        )
        .children(
            [
                (&edit.old_string, 0xff686818, "−"),
                (&edit.new_string, 0x55d68b18, "+"),
            ]
            .into_iter()
            .filter(|(s, _, _)| !s.is_empty())
            .map(|(text, bg, sign)| {
                div()
                    .bg(rgba(bg))
                    .px(px(8.))
                    .py(px(4.))
                    .font_family("Menlo")
                    .text_size(px(crate::colors::CHAT_SMALL))
                    .child(format!("{sign} {text}"))
            }),
        )
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
        ("Skill loaded".into(), skill["name"].as_str().map(str::to_owned),
            skill["description"].as_str().map(str::to_owned),
            skill["command"].as_str().map(|command| format!("/{command}")), 0x8ab4f8, "✦", false)
    } else if let Some(proposal) = &render.skill_proposal {
        let proposal = serde_json::to_value(proposal).ok()?;
        ("Skill proposal".into(), proposal["name"].as_str().map(str::to_owned),
            proposal["description"].as_str().map(str::to_owned),
            Some("Not applied".into()), 0xf4bd50, "✦", false)
    } else if render.automation_definition_proposal.is_some() || render.automation_proposal.is_some() || render.plugin_proposal.is_some() {
        let (title, value) = if let Some(proposal) = &render.automation_definition_proposal {
            ("Automation proposal", serde_json::to_value(proposal).ok()?)
        } else if let Some(proposal) = &render.automation_proposal {
            ("Automation proposal", serde_json::to_value(proposal).ok()?)
        } else {
            ("Plugin proposal", serde_json::to_value(&render.plugin_proposal).ok()?)
        };
        let definition = value["content"].as_str().and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok()).unwrap_or(value);
        let name = definition["name"].as_str().map(str::to_owned);
        let detail = definition["description"].as_str()
            .or_else(|| definition["execution"]["instructions"].as_str())
            .map(str::to_owned);
        (title.into(), name, detail, Some("Not applied".into()), 0xf4bd50, "◇", false)
    } else {
        return None;
    };
    Some(
        div()
            .flex()
            .gap(px(8.))
            .my(px(4.))
            .py(px(8.))
            .px(px(10.))
            .rounded(px(6.))
            .border_1()
            .border_color(rgba((accent << 8) | 0x40))
            .bg(rgba(0xffffff05))
            .child(
                div()
                    .size(px(24.))
                    .flex_shrink_0()
                    .rounded(px(4.))
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
                            .gap(px(8.))
                            .text_size(px(crate::colors::CHAT_SMALL))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(title)
                            .child(div().flex_1())
                            .when_some(turns, |d, turns| {
                                d.child(
                                    div()
                                        .text_size(px(crate::colors::CHAT_DETAIL))
                                        .font_family("Menlo")
                                        .text_color(rgba(0xebebeb80))
                                        .child(turns),
                                )
                            }),
                    )
                    .when_some(objective, |d, objective| {
                        d.child(
                            div()
                                .mt(px(2.))
                                .text_size(px(crate::colors::CHAT_BODY))
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
                                .mt(px(2.))
                                .text_size(px(crate::colors::CHAT_SMALL))
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
        assert_eq!(
            RichText::message(message, "vscode-black").blocks[0].content,
            "$ cargo test\npassed 🌳"
        );
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
        assert_eq!(
            RichText::prepare("output\n````\nmore", true, "vscode-black").blocks[0].content,
            "output\n````\nmore"
        );
    }
    #[test]
    fn selected_palette_preserves_control_variables_comments_and_alpha() {
        let code = "const value = \"hello\";\nif (value) { return value; } // comment\n";
        let black = crate::syntax::highlights(code, "js", "vscode-black");
        let contrast = crate::syntax::highlights(code, "js", "contrast");
        for color in [0xc586c0, 0x9cdcfe, 0xce9178] {
            assert!(
                black
                    .iter()
                    .any(|(_, style)| style.color == Some(rgb(color).into())),
                "missing {color:x}"
            );
        }
        assert!(
            black
                .iter()
                .any(|(_, style)| style.font_style == Some(FontStyle::Italic))
        );
        assert!(
            contrast
                .iter()
                .any(|(_, style)| style.color == Some(rgb(0xff9492).into()))
        );
        assert!(
            !contrast
                .iter()
                .any(|(_, style)| style.color == Some(rgb(0xc586c0).into()))
        );
        let vitesse = crate::syntax::highlights("let value = 1;", "js", "vitesse");
        assert!(
            vitesse
                .iter()
                .any(|(_, style)| style.color == Some(rgba(0xdbd7caee).into()))
        );
    }
    #[test]
    fn preserves_rich_blocks_and_unicode_syntax_ranges() {
        let rich = RichText::prepare(
            "**Bold** and [link](https://example.com)\n\n- one\n- two\n\n```rust\nlet emoji = \"😀\";\n```",
            false,
            "vscode-black",
        );
        assert!(rich.blocks.iter().any(|b| b.kind == "ul"));
        let code = rich.blocks.iter().find(|b| b.kind == "code").unwrap();
        let spans = &rich.code[&code.content];
        assert!(
            spans
                .iter()
                .any(|(_, style)| style.color == Some(rgb(0x569cd6).into()))
        );
        assert!(
            spans
                .iter()
                .all(|(r, _)| code.content.get(r.clone()).is_some())
        );
    }
}
