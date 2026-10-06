//! Inferay Adaptive: per-turn model routing without owning an LLM.
//! The chat harness keeps the transcript; this module only picks which
//! catalog model receives the next provider call.

use serde::{Deserialize, Serialize};

pub const ADAPTIVE_MODEL_ID: &str = "adaptive";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AdaptiveTier {
    Fast,
    Standard,
    Frontier,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdaptiveRoute {
    pub model: String,
    pub reasoning_level: Option<String>,
    pub tier: AdaptiveTier,
    /// True when we kept the previous concrete model for cache continuity.
    pub sticky: bool,
}

pub fn is_adaptive(model: Option<&str>) -> bool {
    model.is_some_and(|value| value.eq_ignore_ascii_case(ADAPTIVE_MODEL_ID))
}

/// Route a user turn to a concrete catalog model for `agent_kind`.
///
/// Stickiness: short follow-ups stay on `previous` when present so prompt
/// caching remains useful across turns (same idea as Devin Adaptive).
pub fn route(
    agent_kind: &str,
    prompt: &str,
    has_images: bool,
    previous: Option<&str>,
) -> AdaptiveRoute {
    let tier = classify(prompt, has_images);
    let sticky_follow_up = is_short_follow_up(prompt) && previous.is_some();
    if sticky_follow_up {
        let previous = previous.unwrap();
        return AdaptiveRoute {
            model: previous.to_owned(),
            reasoning_level: reasoning_for(agent_kind, tier_of_model(agent_kind, previous)),
            tier: tier_of_model(agent_kind, previous),
            sticky: true,
        };
    }
    let model = model_for(agent_kind, tier).to_owned();
    AdaptiveRoute {
        reasoning_level: reasoning_for(agent_kind, tier),
        tier,
        sticky: previous == Some(model.as_str()),
        model,
    }
}

fn classify(prompt: &str, has_images: bool) -> AdaptiveTier {
    let lower = prompt.to_ascii_lowercase();
    let len = prompt.chars().count();
    let frontier_hits = [
        "architect",
        "architecture",
        "migrate",
        "migration",
        "security",
        "refactor the whole",
        "multi-agent",
        "agentic",
        "from scratch",
        "redesign",
        "production incident",
        "data loss",
        "race condition",
        "distributed",
    ]
    .iter()
    .filter(|needle| lower.contains(*needle))
    .count();
    let standard_hits = [
        "implement",
        "fix",
        "bug",
        "error",
        "test",
        "pr ",
        "pull request",
        "refactor",
        "feature",
        "add ",
        "change ",
        "update ",
        "debug",
        "failing",
        "compile",
        "type error",
        "write a",
        "build ",
    ]
    .iter()
    .filter(|needle| lower.contains(*needle))
    .count();

    if frontier_hits > 0 || len > 4_000 || (has_images && len > 1_200) {
        AdaptiveTier::Frontier
    } else if standard_hits > 0 || len > 800 || has_images {
        AdaptiveTier::Standard
    } else {
        AdaptiveTier::Fast
    }
}

fn is_short_follow_up(prompt: &str) -> bool {
    let trimmed = prompt.trim();
    if trimmed.chars().count() > 80 {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "yes"
            | "y"
            | "ok"
            | "okay"
            | "sure"
            | "continue"
            | "go on"
            | "keep going"
            | "do it"
            | "please"
            | "thanks"
            | "thank you"
            | "lgtm"
            | "ship it"
    ) || lower.starts_with("continue")
        || lower.starts_with("yes ")
        || lower.starts_with("ok ")
}

fn model_for(agent_kind: &str, tier: AdaptiveTier) -> &'static str {
    match (agent_kind, tier) {
        ("claude", AdaptiveTier::Fast) => "claude-haiku-4-5",
        ("claude", AdaptiveTier::Standard) => "claude-sonnet-5",
        ("claude", AdaptiveTier::Frontier) => "claude-opus-5-5",
        ("codex", AdaptiveTier::Fast) => "gpt-6-luna",
        ("codex", AdaptiveTier::Standard) => "gpt-6-sol",
        ("codex", AdaptiveTier::Frontier) => "gpt-6-astra",
        (_, AdaptiveTier::Fast) => "claude-haiku-4-5",
        (_, AdaptiveTier::Standard) => "claude-sonnet-5",
        (_, AdaptiveTier::Frontier) => "claude-opus-5-5",
    }
}

fn reasoning_for(agent_kind: &str, tier: AdaptiveTier) -> Option<String> {
    if agent_kind != "codex" {
        return None;
    }
    Some(
        match tier {
            AdaptiveTier::Fast => "low",
            AdaptiveTier::Standard => "medium",
            AdaptiveTier::Frontier => "high",
        }
        .into(),
    )
}

fn tier_of_model(agent_kind: &str, model: &str) -> AdaptiveTier {
    match (agent_kind, model) {
        ("claude", "claude-haiku-4-5") | ("codex", "gpt-6-luna") => AdaptiveTier::Fast,
        ("claude", "claude-sonnet-5" | "claude-sonnet-4-6")
        | ("codex", "gpt-6-sol" | "gpt-5.6-sol" | "gpt-5.6-terra") => AdaptiveTier::Standard,
        _ => AdaptiveTier::Frontier,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adaptive_id_detection() {
        assert!(is_adaptive(Some("adaptive")));
        assert!(is_adaptive(Some("Adaptive")));
        assert!(!is_adaptive(Some("claude-opus-5-5")));
        assert!(!is_adaptive(None));
    }

    #[test]
    fn routes_simple_questions_to_fast() {
        let route = route("claude", "What does this function do?", false, None);
        assert_eq!(route.model, "claude-haiku-4-5");
        assert_eq!(route.tier, AdaptiveTier::Fast);
        assert!(!route.sticky);
    }

    #[test]
    fn routes_implementation_to_standard() {
        let route = route(
            "codex",
            "Implement a fix for the failing auth test",
            false,
            None,
        );
        assert_eq!(route.model, "gpt-6-sol");
        assert_eq!(route.reasoning_level.as_deref(), Some("medium"));
    }

    #[test]
    fn routes_architecture_to_frontier() {
        let route = route(
            "claude",
            "Redesign the architecture for a multi-agent orchestrator",
            false,
            None,
        );
        assert_eq!(route.model, "claude-opus-5-5");
        assert_eq!(route.tier, AdaptiveTier::Frontier);
    }

    #[test]
    fn sticky_follow_ups_keep_previous_model() {
        let route = route("claude", "continue", false, Some("claude-opus-5-5"));
        assert_eq!(route.model, "claude-opus-5-5");
        assert!(route.sticky);
    }
}
