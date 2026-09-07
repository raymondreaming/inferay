//! Pure renderer models. Native persistence and side effects remain in core/server.
//! The browser supplies interaction facts and renders the resulting projections.
pub mod appearance;
pub mod chat_view;
mod composer;
pub mod graph;
pub mod liquid;
pub mod panels;
pub mod repository;
pub mod shadow;
pub mod skills;
pub mod transcript;
mod workbench;

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
        "shadowLayers" => json!(shadow::parse(string(input))),
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
        "panelPreview" => {
            let mut session = input["session"].clone();
            panels::apply_action(
                &mut session,
                &input["action"],
                input["now"].as_u64().unwrap_or(0),
            )?;
            panels::normalize(&session)
        }
        "diffViewer" => workbench::diff_viewer(input),
        "changesPanel" => workbench::changes_panel(input),
        "visibleFiles" => workbench::visible_files(input),
        "adjacentFile" => workbench::adjacent_file(input),
        "selectionAfterToggle" => workbench::selection_after_toggle(input),
        "historicalQuery" => workbench::historical_query(input),
        "diffRequest" => workbench::diff_request(input),
        "workspaceSelection" => workbench::workspace_selection(input),
        "graphPreferences" => graph::preferences(input),
        "graphLayout" => graph::layout(input),
        "graphLines" => json!(graph::lines(input)),
        "moveColumn" => graph::move_column(input),
        "nextHistoryLimit" => json!(
            (number(input) + 1000.)
                .max(number(input) * 2.)
                .min(100_000.)
        ),
        "emptySkillForm" => skills::empty(),
        "skillDialog" => skills::dialog(input),
        "skillEdit" => skills::edit(input),
        "skillDuplicate" => skills::duplicate(input),
        "skillDirty" => skills::dirty(input),
        "trigger" => composer::trigger(input),
        "completion" => composer::completion(input),
        "decoratedTokens" => composer::decorated_tokens(input),
        "askAnswer" => composer::ask_answer(input),
        "userMessage" => composer::user_message(input),
        "mergeQueue" => composer::merge_queue(input),
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
