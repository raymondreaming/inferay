//! First-run guidance. The renderer observes what the app shows and measures the
//! element a step points at; this model owns the order, what each step waits for,
//! the panels it expects on screen, and the saved progress.
use crate::{flag, number, string};
use serde_json::{Value, json};

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingTour {
    pub active: bool,
    pub step: Option<OnboardingStep>,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStep {
    pub id: String,
    pub anchors: Vec<String>,
    pub task: String,
    pub task_done: bool,
    pub placeholder: Option<String>,
    pub sidebar: Option<bool>,
    pub changes: Option<bool>,
    pub graph: Option<bool>,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

struct Step {
    id: &'static str,
    anchors: &'static [&'static str],
    task: &'static str,
    requires: &'static str,
    placeholder: Option<&'static str>,
    sidebar: Option<bool>,
    changes: Option<bool>,
    graph: Option<bool>,
}

const STEPS: &[Step] = &[
    Step {
        id: "repository",
        anchors: &["[data-onboarding='repository-picker']"],
        task: "Choose a folder to continue",
        requires: "repositoryChosen",
        placeholder: None,
        sidebar: Some(false),
        changes: Some(false),
        graph: Some(false),
    },
    Step {
        id: "chat",
        anchors: &["[data-chat-composer-frame]"],
        task: "Send your first message",
        requires: "hasMessage",
        placeholder: Some("Send your first message"),
        sidebar: Some(false),
        changes: Some(false),
        graph: Some(false),
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

fn current_index(progress: &Value) -> usize {
    STEPS
        .iter()
        .position(|step| step.id == string(&progress["step"]))
        .unwrap_or(0)
}

pub fn tour(input: &Value) -> OnboardingTour {
    let progress = &input["progress"];
    let facts = &input["facts"];
    let stored = current_index(progress);
    // A step stands on what the app shows: undoing one returns the tour to it.
    let position = STEPS
        .iter()
        .take(stored + 1)
        .position(|step| !flag(&facts[step.requires]))
        .unwrap_or(stored);
    let active = status(progress) == "running";
    OnboardingTour {
        active,
        step: STEPS
            .get(position)
            .filter(|_| active)
            .map(|step| OnboardingStep {
                id: step.id.to_owned(),
                anchors: step.anchors.iter().map(|a| (*a).to_owned()).collect(),
                task: step.task.to_owned(),
                task_done: flag(&facts[step.requires]),
                placeholder: step.placeholder.map(str::to_owned),
                sidebar: step.sidebar,
                changes: step.changes,
                graph: step.graph,
            }),
    }
}

/// What the saved step expects on screen, so panels never flash open behind it.
pub fn chrome(input: &Value) -> Value {
    let progress = &input["progress"];
    let step = (status(progress) == "running")
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
    let (status, next) = match string(&input["action"]) {
        "start" | "restart" => ("running", 0),
        "dismiss" => ("done", position),
        "skip" => ("skipped", position),
        "next" if position + 1 == STEPS.len() => ("done", position),
        "next" => ("running", position + 1),
        _ => (status(progress), position),
    };
    json!({"status": status, "step": STEPS[next].id})
}

const SPOTLIGHT_PADDING: f64 = 6.;

pub fn spotlight(input: &Value) -> Option<OnboardingRect> {
    let anchor = &input["anchor"];
    let (width, height) = (number(&anchor["width"]), number(&anchor["height"]));
    if width <= 0. || height <= 0. {
        return None;
    }
    let view_width = number(&input["viewport"]["width"]).max(1.);
    let view_height = number(&input["viewport"]["height"]).max(1.);
    let clamp = |value: f64, high: f64| value.min(high).max(0.);
    let left = clamp(number(&anchor["x"]) - SPOTLIGHT_PADDING, view_width);
    let top = clamp(number(&anchor["y"]) - SPOTLIGHT_PADDING, view_height);
    let right = clamp(number(&anchor["x"]) + width + SPOTLIGHT_PADDING, view_width);
    let bottom = clamp(
        number(&anchor["y"]) + height + SPOTLIGHT_PADDING,
        view_height,
    );
    Some(OnboardingRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}
