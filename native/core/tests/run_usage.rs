use inferay_core::projects::RunUsage;
use serde_json::json;

#[test]
fn provider_totals_keep_cache_semantics_and_unknown_prices() {
    let codex = RunUsage::from_provider(&json!({"provider":"codex","usage":{"total":{"inputTokens":100,"cachedInputTokens":70,"outputTokens":12},"last":{"inputTokens":20}}})).unwrap();
    assert_eq!(codex.input_tokens, Some(100));
    assert_eq!(codex.cached_input_tokens, Some(70));
    assert_eq!(codex.reported_cost_usd, None);
    let claude = RunUsage::from_provider(&json!({"provider":"claude","usage":{"input_tokens":10,"cache_read_input_tokens":70,"cache_creation_input_tokens":20,"output_tokens":12},"reportedCostUsd":0.0123})).unwrap();
    assert_eq!(claude.input_tokens, Some(100));
    assert_eq!(claude.output_tokens, Some(12));
    assert_eq!(claude.reported_cost_usd, Some(0.0123));
    assert!(RunUsage::from_provider(&json!({"provider":"codex","usage":{}})).is_none());
    assert!(RunUsage::from_provider(&json!({"provider":"claude","usage":{"input_tokens":1,"cache_read_input_tokens":-1},"reportedCostUsd":-1})).is_none());
    assert!(RunUsage::from_provider(&json!({"provider":"claude","usage":{"input_tokens":u64::MAX,"cache_creation_input_tokens":1}})).is_none());
}
