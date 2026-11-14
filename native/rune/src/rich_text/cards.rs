use crate::colors::{CHAT_BODY, CHAT_SMALL, rgb, rgba};
use crate::ui::{Ink, SEMIBOLD, border};
use crate::zoom::ui;
use inferay_core::chat_protocol::{GoalCardStatus, NativeChatRender};
use rune::{El, col, el, row};

pub fn system_card(render: &NativeChatRender) -> Option<El> {
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
            title.to_owned(),
            name,
            detail,
            Some("Not applied".to_owned()),
            0xf4bd50,
            "◇",
            false,
        )
    } else {
        return None;
    };
    let mut heading = row()
        .items_center()
        .gap(ui(8.))
        .child(Ink::small().weight(SEMIBOLD).text(title))
        .child(el().grow(1.));
    if let Some(turns) = turns {
        heading = heading.child(
            Ink::detail()
                .mono()
                .weight(SEMIBOLD)
                .hex(0xebebeb80)
                .text(turns),
        );
    }
    let mut body = col().grow(1.).min_w(0.).child(heading);
    if let Some(objective) = objective {
        let mut ink = Ink::new(CHAT_BODY).line(CHAT_BODY * 1.45);
        ink = if command {
            ink.color(rgb(accent)).mono().weight(SEMIBOLD)
        } else {
            ink.hex(0xebebebb8)
        };
        body = body.child(col().mt(ui(2.)).child(ink.text(objective)));
    }
    if let Some(detail) = detail {
        body = body.child(
            col()
                .mt(ui(2.))
                .child(Ink::new(CHAT_SMALL).hex(0xebebeb80).text(detail)),
        );
    }
    Some(
        border(
            row()
                .gap(ui(8.))
                .my(ui(4.))
                .py(ui(8.))
                .px(ui(10.))
                .radius(ui(6.))
                .fill(rgba(0xffffff05)),
            (accent << 8) | 0x40,
        )
        .child(
            row()
                .size(ui(24.), ui(24.))
                .radius(ui(4.))
                .fill(rgba(0xffffff08))
                .items_center()
                .justify_center()
                .child(Ink::body().color(rgb(accent)).line_text(glyph)),
        )
        .child(body),
    )
}
