use super::{Block, Prepared};
use crate::colors::{CHAT_BODY, CHAT_DETAIL, CHAT_SMALL, rgb, rgba};
use crate::copy_button::copy_button;
use crate::ui::{Ink, SEMIBOLD, border, button};
use crate::zoom::ui;
use rune::{El, Family, col, el, row};

pub(super) fn render(blocks: &[Block], id: &str, ink: Ink) -> El {
    if let [Block::Plain(text)] = blocks {
        return text.render(format!("message-text-{id}"), ink);
    }
    if blocks
        .iter()
        .any(|block| matches!(block, Block::Code { tool: true, .. }))
    {
        let copy: Vec<String> = blocks
            .iter()
            .filter_map(|block| match block {
                Block::Code { text, .. } => Some(text.content().to_owned()),
                _ => None,
            })
            .collect();
        return border(
            col()
                .key(format!("tool-details-{id}"))
                .min_w(0.)
                .radius(ui(4.))
                .fill(rgba(0x181818dc)),
            0xebebeb18,
        )
        .child(
            col()
                .key(format!("tool-details-body-{id}"))
                .max_h(ui(320.))
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .pl(ui(8.))
                .pr(ui(28.))
                .py(ui(8.))
                .child(stack(blocks, id, ink).selection_group(true)),
        )
        .child(
            copy_button(
                format!("copy-tool-{id}"),
                button("")
                    .label("Copy tool details")
                    .pin(None, Some(ui(2.)), Some(ui(2.)), None)
                    .w(ui(22.))
                    .h(ui(22.))
                    .padding(ui(4.))
                    .justify_center(),
                move || copy.join("\n\n"),
            )
            .key("tool-details-copy"),
        );
    }
    stack(blocks, id, ink).selection_group(true)
}

fn stack(blocks: &[Block], id: &str, ink: Ink) -> El {
    col().gap(ui(4.)).min_w(0.).children(
        blocks
            .iter()
            .enumerate()
            .map(|(index, block)| block_element(block, &format!("{id}-{index}"), ink)),
    )
}

fn block_element(block: &Block, id: &str, ink: Ink) -> El {
    match block {
        Block::Edit(edit) => edit.render(id, ink),
        Block::Code { lang, text, tool } => {
            if *tool {
                return col().child(text.render(
                    format!("tool-text-{id}"),
                    ink.size(CHAT_DETAIL).line(CHAT_DETAIL * 1.6).mono(),
                ));
            }
            code_card(lang, text, id, ink)
        }
        Block::Rule => el().my(ui(8.)).h(ui(1.)).fill(rgba(0xebebeb18)),
        Block::Quote(children) => col()
            .pl(ui(CHAT_SMALL))
            .border_sides([0., 0., 0., 2.], rgba(0xebebeb40))
            .border_layout()
            .child(stack(children, id, ink)),
        Block::Table(rows) => table(rows, id, ink),
        Block::List(items) => col().children(items.iter().enumerate().map(|(i, item)| {
            row()
                .gap(ui(8.))
                .pl(ui(item.indent as f32 * 4.))
                .child(
                    col()
                        .w(ui(20.))
                        .child(ink.text(item.bullet.clone()).exact_lines()),
                )
                .child(
                    col()
                        .grow(1.)
                        .min_w(0.)
                        .child(item.text.render(format!("inline-{id}-{i}"), ink)),
                )
        })),
        Block::Plain(text) => text.render(id.to_owned(), ink),
        Block::Text { heading, text } => {
            let mut body = ink.size(CHAT_BODY).line(CHAT_BODY * 1.6);
            let mut wrapper = col();
            if *heading {
                body = body.weight(SEMIBOLD).color(rgb(0xebebeb));
                wrapper = wrapper.mt(ui(8.));
            }
            wrapper.child(text.render(format!("inline-{id}"), body))
        }
    }
}

fn code_card(lang: &str, text: &Prepared, id: &str, ink: Ink) -> El {
    let copy = text.content().to_owned();
    let mut label = Ink::new(9.).line(12.).hex(0xebebeb70).style();
    label = label.family(Family::Named("System Font"));
    border(
        col()
            .key(format!("code-card-{id}"))
            .min_w(0.)
            .radius(ui(4.))
            .fill(rgba(0x181818dc)),
        0xebebeb18,
    )
    .child(
        row()
            .justify_between()
            .items_center()
            .px(ui(8.))
            .py(ui(1.))
            .child(
                rune::text(lang.to_owned())
                    .font(label)
                    .color(rgba(0xebebeb70))
                    .wrap()
                    .rounded_lines()
                    .offset(0., crate::ui::text_baseline(&label)),
            )
            .child(copy_button(
                format!("copy-code-{id}"),
                button("")
                    .label("Copy code")
                    .w(ui(22.))
                    .h(ui(22.))
                    .padding(ui(4.))
                    .justify_center(),
                move || copy.clone(),
            )),
    )
    .child(
        col()
            .key(format!("code-{id}"))
            .scroll_x()
            .px(ui(8.))
            .pt(ui(2.))
            .pb(ui(6.))
            .child(text.render_line(
                format!("code-text-{id}"),
                ink.size(CHAT_SMALL).line(CHAT_SMALL * 1.625).mono(),
            )),
    )
}

fn table(rows: &[Vec<Prepared>], id: &str, ink: Ink) -> El {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    let widths: Vec<f32> = (0..columns)
        .map(|column| {
            let characters = rows
                .iter()
                .filter_map(|row| row.get(column))
                .flat_map(|text| text.content().lines())
                .map(|line| line.chars().count())
                .max()
                .unwrap_or(0);
            (characters as f32 * 7. + 16.).clamp(64., 240.)
        })
        .collect();
    let width: f32 = widths.iter().sum();
    let cell_ink = ink.size(CHAT_SMALL).line(18.);
    let body = col()
        .w(ui(width))
        .children(rows.iter().enumerate().map(|(r, cells)| {
            row()
                .w(ui(width))
                .children(cells.iter().enumerate().map(|(c, text)| {
                    let mut cell = col()
                        .key(format!("chat-table-cell-{r}-{c}"))
                        .w(ui(widths[c]))
                        .min_w(0.)
                        .px(ui(8.))
                        .py(ui(3.))
                        .border_sides([0., 0., 1., 0.], rgba(0xebebeb18))
                        .border_layout();
                    let mut text_ink = cell_ink;
                    if r == 0 {
                        text_ink = text_ink.weight(SEMIBOLD);
                        cell = cell.fill(rgba(0xffffff08));
                    }
                    cell.child(text.render(format!("inline-{id}-{r}-{c}"), text_ink))
                }))
        }));
    border(
        col()
            .key("chat-table")
            .w_full()
            .min_w(0.)
            .scroll_x()
            .radius(ui(4.))
            .clip_rounded(ui(4.)),
        0xebebeb18,
    )
    .child(body)
}
