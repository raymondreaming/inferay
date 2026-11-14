//! Pure renderer models. Native persistence and side effects remain in core/server.
//! The Rune desktop UI supplies interaction facts and renders the resulting projections.
pub mod appearance;
pub mod chat_view;
pub mod composer;
pub mod diff;
pub mod dock;
pub mod git_actions;
pub mod graph;
pub mod graph_response;
pub mod image;
pub mod memory_graph;
pub mod onboarding;
pub mod panels;
pub mod project_editor;
pub mod shortcuts;
pub mod transcript;
pub mod ui_performance;
pub mod workbench;

use serde_json::Value;

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
