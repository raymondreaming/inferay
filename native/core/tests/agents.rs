use inferay_core::agents::{
    SubagentProfile, explore_model, is_agents_tool, merge_tool_definitions, tool_definitions,
};
use serde_json::json;

#[test]
fn explore_and_general_profiles_parse() {
    assert_eq!(
        SubagentProfile::parse("explore"),
        Some(SubagentProfile::Explore)
    );
    assert_eq!(
        SubagentProfile::parse("GENERAL"),
        Some(SubagentProfile::General)
    );
    assert!(SubagentProfile::parse("reviewer").is_none());
}

#[test]
fn agents_tools_are_named_for_dispatch() {
    assert!(is_agents_tool("run_subagent"));
    assert!(is_agents_tool("read_subagent"));
    assert!(is_agents_tool("list_subagents"));
    assert!(!is_agents_tool("inferay_list_skills"));
}

#[test]
fn merge_tool_definitions_appends_only_when_enabled() {
    let base = json!([{"name":"inferay_list_skills"}]);
    let off = merge_tool_definitions(base.clone(), false);
    assert_eq!(off.as_array().map(|items| items.len()), Some(1));
    let on = merge_tool_definitions(base, true);
    let names: Vec<_> = on
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(names.contains(&"run_subagent"));
    assert!(names.contains(&"read_subagent"));
    assert!(names.contains(&"list_subagents"));
    assert_eq!(tool_definitions().as_array().unwrap().len(), 3);
}

#[test]
fn explore_model_prefers_fast_defaults() {
    assert_eq!(
        explore_model("claude", Some("claude-opus-5-5")).as_deref(),
        Some("claude-haiku-4-5")
    );
    assert_eq!(
        explore_model("codex", Some("gpt-6-astra")).as_deref(),
        Some("gpt-6-luna")
    );
}
