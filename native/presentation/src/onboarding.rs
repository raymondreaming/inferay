//! First-run guidance. The renderer observes what the app shows and measures the
//! element a step points at; this model owns the order, what each step waits for,
//! the panels it expects on screen, and the saved progress.
use crate::string;
use serde_json::{Value, json};

struct Step {
    id: &'static str,
    sidebar: Option<bool>,
    changes: Option<bool>,
    graph: Option<bool>,
}

const STEPS: &[Step] = &[
    Step {
        id: "repository",
        sidebar: Some(false),
        changes: Some(false),
        graph: Some(false),
    },
    Step {
        id: "chat",
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
