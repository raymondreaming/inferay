#![allow(dead_code)]
use inferay_presentation::{
    diff, dock, graph, memory_graph, onboarding, panels, project_editor, workbench,
};
use serde::Deserialize;
use serde_json::{Value, json};

macro_rules! typed_projections {
    ($($name:literal => ($request:ty, $response:ty, $handler:expr)),* $(,)?) => {
        fn typed_project(operation: &str, input: &Value) -> Option<Result<Value, String>> {
            match operation {
                $($name => Some((|| {
                    let request = <$request>::deserialize(input).map_err(|e| e.to_string())?;
                    let response: $response = ($handler)(request)?;
                    serde_json::to_value(response).map_err(|e| e.to_string())
                })()),)*
                _ => None,
            }
        }

    };
}
typed_projections! {
    "effectPresentation" => (inferay_core::projects::EffectState, inferay_core::projects::EffectPresentation, |input: inferay_core::projects::EffectState| Ok::<_, String>(input.presentation())),
    "skillChoices" => (project_editor::SkillChoices, Vec<project_editor::SkillOption>, |input| Ok::<_, String>(project_editor::skill_choices(input))),
    "newAutomation" => (project_editor::NewAutomation, inferay_core::project_files::AutomationDefinition, |input| Ok::<_, String>(project_editor::new_automation(input))),
    "triggerPreset" => (project_editor::TriggerPreset, inferay_core::project_files::Trigger, project_editor::trigger_preset),
    "memoryGraphLayout" => (memory_graph::MemoryGraphLayout, Vec<(String, memory_graph::GraphPoint)>, |input| Ok::<_, String>(memory_graph::layout(input))),
}
pub fn project(operation: &str, input: &Value) -> Result<Value, String> {
    if let Some(result) = typed_project(operation, input) {
        return result;
    }
    Ok(match operation {
        "panelPreview" => {
            let mut session = panels::PanelSession::read(&input["session"]);
            session.apply(
                serde_json::from_value(input["action"].clone())
                    .map_err(|error| error.to_string())?,
                input["now"].as_u64().unwrap_or(0),
            );
            json!(session)
        }
        "diffNavigation" => diff::navigation(input)?,
        "changesPanel" => json!(workbench::changes_panel(input)),
        "adjacentFile" => workbench::adjacent_file(input),
        "repositoryKeyboardAction" => workbench::keyboard_action(input),
        "resizeDockSplit" => dock::resize_preview(input)?,
        "onboardingAdvance" => onboarding::advance(input),
        "onboardingChrome" => onboarding::chrome(input),
        "graphLayout" => graph::layout(input),
        "graphNavigation" => json!(graph::navigation(input)),
        _ => return Err(format!("Unknown presentation operation: {operation}")),
    })
}
