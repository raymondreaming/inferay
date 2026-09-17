//! Guided first-run tour. The renderer observes app facts and element geometry;
//! this model owns the step order, what each step waits for, saved progress,
//! and where a callout sits next to its anchor.
use crate::{array, flag, number, string};
use serde_json::{Value, json};

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingTour {
    pub active: bool,
    pub step: Option<OnboardingStep>,
    pub position: usize,
    pub total: usize,
    pub steps: Vec<OnboardingMarker>,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingMarker {
    pub id: String,
    pub act: String,
    pub visited: bool,
    pub current: bool,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStep {
    pub id: String,
    pub act: String,
    pub title: String,
    pub body: String,
    pub anchors: Vec<String>,
    pub tight: bool,
    #[ts(type = "'top' | 'bottom' | 'left' | 'right' | 'center' | 'over'")]
    pub placement: String,
    pub hotkeys: Vec<OnboardingHotkey>,
    pub task: Option<String>,
    pub task_done: bool,
    pub action: Option<String>,
    pub action_label: Option<String>,
    pub primary_label: String,
    pub can_advance: bool,
    pub first: bool,
    pub last: bool,
    pub sidebar: Option<bool>,
    pub changes: Option<bool>,
    pub graph: Option<bool>,
    pub card: bool,
    pub placeholder: Option<String>,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingHotkey {
    pub keys: Vec<String>,
    pub label: String,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCallout {
    pub card: OnboardingRect,
    #[ts(type = "'top' | 'bottom' | 'left' | 'right' | 'center'")]
    pub side: String,
    pub spotlight: Option<OnboardingRect>,
    pub arrow: Option<OnboardingPoint>,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPoint {
    pub x: f64,
    pub y: f64,
}

struct Step {
    id: &'static str,
    act: &'static str,
    title: &'static str,
    body: &'static str,
    anchors: &'static [&'static str],
    tight: bool,
    placement: &'static str,
    task: Option<&'static str>,
    requires: Option<&'static str>,
    action: Option<(&'static str, &'static str)>,
    hotkeys: &'static [(&'static [&'static str], &'static str)],
    sidebar: Option<bool>,
    changes: Option<bool>,
    graph: Option<bool>,
    card: bool,
    placeholder: Option<&'static str>,
}

const STEPS: &[Step] = &[
    Step {
        id: "repository",
        act: "Setup",
        title: "Start with a repository",
        body: "Search for a folder on this machine and pick it. Inferay opens it as a workspace: its history, its uncommitted work, and the chats you run against it.",
        anchors: &["[data-onboarding='repository-picker']"],
        tight: false,
        placement: "top",
        task: Some("Choose a folder to continue"),
        requires: Some("repositoryChosen"),
        action: None,
        hotkeys: &[],
        sidebar: Some(false),
        changes: Some(false),
        graph: Some(false),
        card: false,
        placeholder: None,
    },
    Step {
        id: "chat",
        act: "Agents",
        title: "Ask for the first thing",
        body: "Your message starts the agent inside that folder, and the repository opens around it.",
        anchors: &["[data-chat-composer-frame]"],
        tight: false,
        placement: "top",
        task: Some("Send your first message"),
        requires: Some("hasMessage"),
        action: None,
        hotkeys: &[],
        sidebar: Some(false),
        changes: Some(false),
        graph: Some(false),
        card: false,
        placeholder: Some("Send your first message"),
    },
    Step {
        id: "newChat",
        act: "Workspace",
        title: "Start another chat",
        body: "New starts another chat against the same repository, or opens a second repository beside it.",
        anchors: &[
            "[aria-label='New chat']",
            "[aria-label='New chat or repository']",
        ],
        tight: true,
        placement: "bottom",
        task: Some("Start a second chat"),
        requires: Some("secondChat"),
        action: None,
        hotkeys: &[],
        sidebar: Some(true),
        changes: Some(false),
        graph: Some(false),
        card: false,
        placeholder: None,
    },
    Step {
        id: "changesPanel",
        act: "Changes",
        title: "Open the changes sidebar",
        body: "The panel icon opens the files of the selected repository beside your chats.",
        anchors: &["[aria-label='Toggle changes sidebar']"],
        tight: true,
        placement: "bottom",
        task: Some("Open the changes sidebar"),
        requires: Some("changesVisible"),
        action: None,
        hotkeys: &[],
        sidebar: None,
        changes: None,
        graph: Some(false),
        card: false,
        placeholder: None,
    },
    Step {
        id: "graphPanel",
        act: "History",
        title: "Open the commit graph",
        body: "The branch icon opens the repository history in the same panel.",
        anchors: &["[aria-label='Toggle commit graph']"],
        tight: true,
        placement: "bottom",
        task: Some("Open the commit graph"),
        requires: Some("graphOpen"),
        action: None,
        hotkeys: &[],
        sidebar: None,
        changes: None,
        graph: None,
        card: false,
        placeholder: None,
    },
];

fn status(progress: &Value) -> &str {
    match string(&progress["status"]) {
        "running" => "running",
        "done" => "done",
        "skipped" => "skipped",
        _ => "new",
    }
}

fn index_of(id: &str) -> Option<usize> {
    STEPS.iter().position(|step| step.id == id)
}

fn current_index(progress: &Value) -> usize {
    index_of(string(&progress["step"])).unwrap_or(0)
}

fn visited(progress: &Value) -> Vec<&str> {
    array(&progress["visited"])
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| index_of(id).is_some())
        .collect()
}

pub fn tour(input: &Value) -> OnboardingTour {
    let progress = &input["progress"];
    let facts = &input["facts"];
    let stored = current_index(progress);
    // Setup steps stand on what the app shows. Undoing one returns the tour to it.
    let position = STEPS
        .iter()
        .take(stored + 1)
        .position(|step| {
            !step.card && step.requires.is_some_and(|fact| !flag(&facts[fact]))
        })
        .unwrap_or(stored);
    let seen = visited(progress);
    let active = matches!(status(progress), "new" | "running");
    let step = STEPS.get(position).filter(|_| active).map(|step| {
        let done = step.requires.is_none_or(|fact| flag(&facts[fact]));
        OnboardingStep {
            id: step.id.to_owned(),
            act: step.act.to_owned(),
            title: step.title.to_owned(),
            body: step.body.to_owned(),
            anchors: step.anchors.iter().map(|a| (*a).to_owned()).collect(),
            tight: step.tight,
            placement: step.placement.to_owned(),
            hotkeys: step
                .hotkeys
                .iter()
                .map(|(keys, label)| OnboardingHotkey {
                    keys: keys.iter().map(|key| (*key).to_owned()).collect(),
                    label: (*label).to_owned(),
                })
                .collect(),
            task: step.task.map(str::to_owned),
            task_done: step.task.is_some() && done,
            action: step
                .action
                .filter(|_| !done)
                .map(|(action, _)| action.to_owned()),
            action_label: step
                .action
                .filter(|_| !done)
                .map(|(_, label)| label.to_owned()),
            primary_label: if position == 0 {
                "Start the tour".to_owned()
            } else if position + 1 == STEPS.len() {
                "Finish".to_owned()
            } else {
                "Next".to_owned()
            },
            can_advance: done,
            first: position == 0,
            last: position + 1 == STEPS.len(),
            sidebar: step.sidebar,
            changes: step.changes,
            graph: step.graph,
            card: step.card,
            placeholder: step.placeholder.map(str::to_owned),
        }
    });
    OnboardingTour {
        active,
        step,
        position: position + 1,
        total: STEPS.len(),
        steps: STEPS
            .iter()
            .enumerate()
            .map(|(index, step)| OnboardingMarker {
                id: step.id.to_owned(),
                act: step.act.to_owned(),
                visited: index < position || seen.contains(&step.id),
                current: index == position,
            })
            .collect(),
    }
}

pub fn chrome(input: &Value) -> Value {
    let progress = &input["progress"];
    let step = matches!(status(progress), "new" | "running")
        .then(|| STEPS.get(current_index(progress)))
        .flatten();
    json!({
        "sidebar": step.and_then(|step| step.sidebar),
        "changes": step.and_then(|step| step.changes),
        "graph": step.and_then(|step| step.graph),
    })
}

pub fn advance(input: &Value) -> Value {
    let progress = &input["progress"];
    let position = current_index(progress);
    let mut seen = visited(progress)
        .iter()
        .map(|id| (*id).to_owned())
        .collect::<Vec<_>>();
    let record = |seen: &mut Vec<String>, index: usize| {
        let id = STEPS[index].id.to_owned();
        if !seen.contains(&id) {
            seen.push(id);
        }
    };
    let (status, next) = match string(&input["action"]) {
        "restart" => ("running", 0),
        "skip" => ("skipped", position),
        "finish" => {
            record(&mut seen, position);
            ("done", position)
        }
        "back" => ("running", position.saturating_sub(1)),
        "next" if position + 1 == STEPS.len() => {
            record(&mut seen, position);
            ("done", position)
        }
        "next" => {
            record(&mut seen, position);
            ("running", position + 1)
        }
        _ => (status(progress), position),
    };
    json!({
        "status": status,
        "step": STEPS[next].id,
        "visited": seen,
    })
}

const SPOTLIGHT_PADDING: f64 = 6.;
const CALLOUT_GAP: f64 = 14.;
const VIEWPORT_MARGIN: f64 = 16.;
const ARROW_INSET: f64 = 22.;

fn rect(value: &Value) -> Option<OnboardingRect> {
    value.is_object().then(|| OnboardingRect {
        x: number(&value["x"]),
        y: number(&value["y"]),
        width: number(&value["width"]),
        height: number(&value["height"]),
    })
}

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    value.min(high).max(low)
}

pub fn callout(input: &Value) -> OnboardingCallout {
    let card_width = number(&input["card"]["width"]).max(1.);
    let card_height = number(&input["card"]["height"]).max(1.);
    let view_width = number(&input["viewport"]["width"]).max(1.);
    let view_height = number(&input["viewport"]["height"]).max(1.);
    let centered = |side: &str| OnboardingCallout {
        card: OnboardingRect {
            x: ((view_width - card_width) / 2.).max(VIEWPORT_MARGIN),
            y: ((view_height - card_height) / 2.4).max(VIEWPORT_MARGIN),
            width: card_width,
            height: card_height,
        },
        side: side.to_owned(),
        spotlight: None,
        arrow: None,
    };
    let Some(anchor) = rect(&input["anchor"]).filter(|rect| rect.width > 0. && rect.height > 0.)
    else {
        return centered("center");
    };
    let padding = if flag(&input["tight"]) {
        0.
    } else {
        SPOTLIGHT_PADDING
    };
    let left = clamp(anchor.x - padding, 0., view_width);
    let top = clamp(anchor.y - padding, 0., view_height);
    let right = clamp(anchor.x + anchor.width + padding, 0., view_width);
    let bottom = clamp(anchor.y + anchor.height + padding, 0., view_height);
    let spotlight = OnboardingRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
    let fits = |side: &str| match side {
        "left" => spotlight.x - CALLOUT_GAP - card_width >= VIEWPORT_MARGIN,
        "right" => {
            spotlight.x + spotlight.width + CALLOUT_GAP + card_width
                <= view_width - VIEWPORT_MARGIN
        }
        "top" => spotlight.y - CALLOUT_GAP - card_height >= VIEWPORT_MARGIN,
        _ => {
            spotlight.y + spotlight.height + CALLOUT_GAP + card_height
                <= view_height - VIEWPORT_MARGIN
        }
    };
    let preferred = string(&input["placement"]);
    if preferred == "over" {
        return OnboardingCallout {
            card: OnboardingRect {
                x: clamp(
                    anchor.x + anchor.width / 2. - card_width / 2.,
                    VIEWPORT_MARGIN,
                    (view_width - card_width - VIEWPORT_MARGIN).max(VIEWPORT_MARGIN),
                ),
                y: clamp(
                    anchor.y + anchor.height / 2. - card_height / 2.,
                    VIEWPORT_MARGIN,
                    (view_height - card_height - VIEWPORT_MARGIN).max(VIEWPORT_MARGIN),
                ),
                width: card_width,
                height: card_height,
            },
            side: "center".to_owned(),
            spotlight: Some(spotlight),
            arrow: None,
        };
    }
    let opposite = match preferred {
        "left" => "right",
        "right" => "left",
        "top" => "bottom",
        _ => "top",
    };
    let Some(side) = [preferred, opposite, "bottom", "top", "right", "left"]
        .into_iter()
        .find(|side| fits(side))
    else {
        return OnboardingCallout {
            spotlight: Some(spotlight),
            ..centered("center")
        };
    };
    let (x, y) = match side {
        "left" => (
            spotlight.x - CALLOUT_GAP - card_width,
            anchor.y + anchor.height / 2. - card_height / 2.,
        ),
        "right" => (
            spotlight.x + spotlight.width + CALLOUT_GAP,
            anchor.y + anchor.height / 2. - card_height / 2.,
        ),
        "top" => (
            anchor.x + anchor.width / 2. - card_width / 2.,
            spotlight.y - CALLOUT_GAP - card_height,
        ),
        _ => (
            anchor.x + anchor.width / 2. - card_width / 2.,
            spotlight.y + spotlight.height + CALLOUT_GAP,
        ),
    };
    let card = OnboardingRect {
        x: clamp(
            x,
            VIEWPORT_MARGIN,
            (view_width - card_width - VIEWPORT_MARGIN).max(VIEWPORT_MARGIN),
        ),
        y: clamp(
            y,
            VIEWPORT_MARGIN,
            (view_height - card_height - VIEWPORT_MARGIN).max(VIEWPORT_MARGIN),
        ),
        width: card_width,
        height: card_height,
    };
    let arrow = OnboardingPoint {
        x: clamp(
            anchor.x + anchor.width / 2. - card.x,
            ARROW_INSET,
            (card_width - ARROW_INSET).max(ARROW_INSET),
        ),
        y: clamp(
            anchor.y + anchor.height / 2. - card.y,
            ARROW_INSET,
            (card_height - ARROW_INSET).max(ARROW_INSET),
        ),
    };
    OnboardingCallout {
        card,
        side: side.to_owned(),
        spotlight: Some(spotlight),
        arrow: Some(arrow),
    }
}
