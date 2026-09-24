use inferay_core::provider_config::{reasoning_levels_for, resolve};
use serde_json::json;

fn resolved_reasoning(model: &str, level: &str) -> String {
    resolve(&json!({"agentKind": "codex", "model": model, "reasoningLevel": level})).reasoning_level
}

#[test]
fn codex_reasoning_never_exceeds_the_selected_model() {
    assert_eq!(resolved_reasoning("gpt-6-sol", "ultra"), "ultra");
    assert_eq!(resolved_reasoning("gpt-6-luna", "ultra"), "max");
    assert_eq!(resolved_reasoning("gpt-5.5", "ultra"), "xhigh");
    assert_eq!(resolved_reasoning("gpt-5.5", "medium"), "medium");
    assert_eq!(resolved_reasoning("gpt-6-sol", "unknown"), "low");
    assert_eq!(
        reasoning_levels_for("gpt-6-luna")
            .iter()
            .map(|level| level.id.as_str())
            .collect::<Vec<_>>(),
        ["low", "medium", "high", "xhigh", "max"]
    );
}
