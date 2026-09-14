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
pub mod panels;
pub mod repository_tabs;
/// Renderer compatibility facade for repository contracts owned by the core.
pub mod repository {
    pub use inferay_core::repository::*;
}
pub mod skills;
pub mod transcript;
pub mod ui_performance;
pub mod workbench;
pub mod workspace_session;

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

pub fn project(operation: &str, input: &Value) -> Result<Value, String> {
    Ok(match operation {
        "markdownImageSource" => image::source(input),
        "syntaxInput" => json!(inferay_core::syntax::input(
            &serde_json::from_value::<Vec<String>>(input["lines"].clone())
                .map_err(|e| e.to_string())?,
            serde_json::from_value::<Option<Vec<String>>>(input["lineTypes"].clone())
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
        "chatOffsets" => json!(chat_view::offsets(
            &serde_json::from_value::<Vec<Option<f64>>>(input.clone())
                .map_err(|error| error.to_string())?
        )),
        "chatWindow" => json!(chat_view::window(
            &serde_json::from_value::<chat_view::ChatViewport>(input.clone())
                .map_err(|error| error.to_string())?
        )),
        "mergeTranscriptOrder" => transcript::merge_order(input),
        "emptyPanels" => panels::normalize(&Value::Null),
        "panelSidebarContent" => json!(panels::sidebar_content(input)),
        "panelVisibility" => json!({
            "graphVisible": input["graphVisible"].as_bool().unwrap_or(true),
            "sidebarVisible": input["sidebarVisible"].as_bool().unwrap_or(true),
        }),
        "panelPreview" => {
            let mut session = input["session"].clone();
            panels::apply_action(
                &mut session,
                &input["action"],
                input["now"].as_u64().unwrap_or(0),
            )?;
            panels::normalize(&session)
        }
        "gitOperationModel" => workbench::git_operation_model(input),
        "gitActionFailure" => git_actions::failed_operation(input),
        "nextDiffChange" => diff::next_change(input),
        "diffNavigation" => diff::navigation(input)?,
        "changesPanel" => workbench::changes_panel(input),
        "visibleFiles" => workbench::visible_files(input),
        "adjacentFile" => workbench::adjacent_file(input),
        "selectionAfterToggle" => workbench::selection_after_toggle(input),
        "historicalQuery" => workbench::historical_query(input),
        "repositoryFileSelection" => json!(workbench::file_selection(input)),
        "repositoryPreferences" => json!(workbench::preferences(input)),
        "repositoryResize" => workbench::resize(input),
        "repositoryWorkbenchContext" => workbench::context(input),
        "repositorySelectedWorktree" => workbench::selected_worktree(input),
        "repositoryInteraction" => json!(workbench::interaction(input)),
        "repositoryKeyboardAction" => workbench::keyboard_action(input),
        "repositoryResizeStart" => workbench::resize_start(input),
        "retainedGraphSelection" => json!(workbench::retained_graph_selection(input)),
        "graphFileOpen" => json!(workbench::graph_file_open(input)),
        "diffPrefetchFiles" => diff::diff_prefetch_files(input),
        "diffRequest" => diff::diff_request(input),
        "resizeDockSplit" => dock::resize_preview(input)?,
        "retainedWorkspaces" => workbench::retained_workspaces(input),
        "chatRunStatus" => transcript::run_status(input),
        "chatScrollState" => chat_view::scroll_state(input),
        "chatScrollRestore" => json!(chat_view::restore_scroll(input)),
        "uiTimingSummaries" => ui_performance::summaries(input),
        "graphPreferences" => graph::preferences(input),
        "emptyGitGraph" => graph_response::response(Default::default(), &[], &[], &[]),
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
