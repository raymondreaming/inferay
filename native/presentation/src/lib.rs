//! Pure renderer models. Native persistence and side effects remain in core/server.
//! The browser supplies interaction facts and renders the resulting projections.
pub mod appearance;
pub mod chat_retention;
pub mod chat_view;
pub mod composer;
pub mod diff;
pub mod dock;
pub mod dock_session;
pub mod documents;
pub mod git_actions;
pub mod graph;
pub mod graph_response;
pub mod image;
pub mod markdown;
pub mod memory_graph;
pub mod onboarding;
pub mod panels;
pub mod project_editor;
pub mod shortcuts;
pub mod skills;
pub mod transcript;
pub mod ui_performance;
mod wasm_json;
pub mod workbench;
pub mod workspace_session;

use serde::Deserialize;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}
fn string(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}
fn number(value: &Value) -> f64 {
    value.as_f64().unwrap_or_default()
}
fn flag(value: &Value) -> bool {
    value.as_bool().unwrap_or(false)
}

// Each typed dispatch entry also supplies its generated renderer signature.
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
        pub fn projection_contracts(cfg: &ts_rs::Config) -> Vec<(&'static str, String, String)> {
            use ts_rs::TS;
            vec![$(($name, <$request>::name(cfg), <$response>::name(cfg))),*]
        }
    };
}
typed_projections! {
    "effectPresentation" => (inferay_core::projects::EffectState, inferay_core::projects::EffectPresentation, |input: inferay_core::projects::EffectState| Ok::<_, String>(input.presentation())),
    "skillChoices" => (project_editor::SkillChoices, Vec<project_editor::SkillOption>, |input| Ok::<_, String>(project_editor::skill_choices(input))),
    "editToolGrant" => (project_editor::EditToolGrant, Vec<inferay_core::project_files::AgentToolGrant>, |input| Ok::<_, String>(project_editor::edit_tool_grant(input))),
    "newAutomation" => (project_editor::NewAutomation, inferay_core::project_files::AutomationDefinition, |input| Ok::<_, String>(project_editor::new_automation(input))),
    "triggerPreset" => (project_editor::TriggerPreset, inferay_core::project_files::Trigger, project_editor::trigger_preset),
    "proposalPath" => (project_editor::ProposalPath, String, project_editor::proposal_path),
    "memoryGraphLayout" => (memory_graph::MemoryGraphLayout, Vec<(String, memory_graph::GraphPoint)>, |input| Ok::<_, String>(memory_graph::layout(input))),
    "pluginImportManifest" => (std::collections::BTreeMap<String, usize>, (), |files: std::collections::BTreeMap<String, usize>| inferay_core::project_files::validate_import_manifest(files.iter().map(|(path, size)| (path.as_str(), *size)))),
}
pub fn project(operation: &str, input: &Value) -> Result<Value, String> {
    if let Some(result) = typed_project(operation, input) {
        return result;
    }
    Ok(match operation {
        "workspaceChatEntries" => json!(workbench::workspace_chat_entries(input)),
        "markdownImageSource" => image::source(input),
        "syntaxInput" => json!(inferay_core::syntax::input(
            &Vec::<&str>::deserialize(&input["lines"]).map_err(|e| e.to_string())?,
            Option::<Vec<&str>>::deserialize(&input["lineTypes"])
                .map_err(|e| e.to_string())?
                .as_deref(),
            input["enabled"] != false,
        )),
        "dockPointerTarget" => json!(dock::pointer_target(input)),
        "dockWheel" => json!(dock::wheel(input)),
        "responsiveDockColumns" => dock::responsive_columns(input),
        "dropdownPosition" => json!(appearance::dropdown_position(input)),
        "sidebarResize" => json!(appearance::sidebar_resize(input)),
        "backgroundModel" => json!(appearance::background_model(input)),
        "chatList" => json!(chat_view::list(input)?),
        "mergeTranscriptOrder" => transcript::merge_order(input),
        "emptyPanels" => json!(panels::PanelSession::read(&Value::Null)),
        "panelPresentation" => json!(panels::PanelSession::read(input).presentation()),
        "panelVisibility" => json!({
            "graphVisible": input["graphVisible"].as_bool().unwrap_or(true),
            "sidebarVisible": input["sidebarVisible"].as_bool().unwrap_or(true),
        }),
        "panelPreview" => {
            let mut session = panels::PanelSession::read(&input["session"]);
            session.apply(
                serde_json::from_value(input["action"].clone())
                    .map_err(|error| error.to_string())?,
                input["now"].as_u64().unwrap_or(0),
            );
            json!(session)
        }
        "gitOperationModel" => workbench::git_operation_model(input),
        "gitActionFailure" => git_actions::failed_operation(input),
        "nextDiffChange" => diff::next_change(input),
        "diffNavigation" => diff::navigation(input)?,
        "changesPanel" => json!(workbench::changes_panel(input)),
        "adjacentFile" => workbench::adjacent_file(input),
        "selectionAfterToggle" => workbench::selection_after_toggle(input),
        "historicalQuery" => workbench::historical_query(input),
        "repositoryFileSelection" => json!(workbench::file_selection(input)),
        "repositoryPreferences" => json!(workbench::preferences(input)),
        "repositoryResize" => workbench::resize(input),
        "repositoryWorkbenchContext" => workbench::context(input),
        "repositoryInteraction" => json!(workbench::interaction(input)),
        "repositoryKeyboardAction" => workbench::keyboard_action(input),
        "graphFileOpen" => json!(workbench::graph_file_open(input)),
        "diffPrefetchFiles" => diff::diff_prefetch_files(input),
        "diffRequest" => diff::diff_request(input),
        "resizeDockSplit" => dock::resize_preview(input)?,
        "retainedWorkspaces" => workbench::retained_workspaces(input),
        "chatRunStatus" => transcript::run_status(input),
        "chatScrollState" => chat_view::scroll_state(input),
        "chatScrollRestore" => json!(chat_view::restore_scroll(input)),
        "uiTimingSummaries" => ui_performance::summaries(input),
        "onboardingTour" => json!(onboarding::tour(input)),
        "onboardingAdvance" => onboarding::advance(input),
        "onboardingChrome" => onboarding::chrome(input),
        "onboardingSpotlight" => json!(onboarding::spotlight(input)),
        "graphPreferences" => graph::preferences(input),
        "emptyGitGraph" => json!(graph_response::response(&Default::default(), &[], &[], &[])),
        "graphLayout" => graph::layout(input),
        "graphNavigation" => json!(graph::navigation(input)),
        "graphViewport" => json!(graph::viewport(input)),
        "graphReveal" => graph::reveal(input),
        "resizeGraphColumn" => graph::resize_column(input),
        "graphLines" => json!(graph::lines(input)),
        "moveColumn" => graph::move_column(input),
        "nextHistoryLimit" => json!(
            (number(input) + 1000.)
                .max(number(input) * 2.)
                .min(100_000.)
        ),
        "providerSettings" => json!(inferay_core::provider_config::settings_view(input)),
        "composerConfig" => json!(composer::config_controls(input)),
        "completionMenuInput" => composer::menu_input(input),
        "completionMenuCommands" => composer::menu_commands(input),
        "editDiffWindow" => json!(diff::edit_window(input)),
        "chatInputKey" => json!(composer::input_key(input)),
        "completionMenuStep" => composer::menu_step(input),
        "selectCompletion" => composer::select_completion(input),
        "decoratedTextSegments" => json!(composer::decorated_segments(input)),
        "askAnswer" => composer::ask_answer(input),
        "systemNotice" => composer::system_notice(input),
        "prepareChatSend" => composer::prepare_send(input),
        "userMessage" => composer::user_message(input),
        "chatQueue" => match input["action"].as_str() {
            Some("merge") => composer::merge_queue(input),
            Some("stage") => composer::update_queue(input, true),
            Some("resolve") => composer::update_queue(input, false),
            _ => return Err("Unknown chat queue action".into()),
        },
        _ => return Err(format!("Unknown presentation operation: {operation}")),
    })
}

#[wasm_bindgen]
pub fn presentation(operation: &str, input: &str) -> Result<String, JsValue> {
    let run = || -> Result<String, String> {
        let input = serde_json::from_str(input).map_err(|error| error.to_string())?;
        serde_json::to_string(&project(operation, &input)?).map_err(|error| error.to_string())
    };
    run().map_err(|error| JsValue::from_str(&error))
}
