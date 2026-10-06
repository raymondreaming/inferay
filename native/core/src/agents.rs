//! Subagent vocabulary and parent-facing tool contracts.
//! Spawn and process policy belong to the server agents runtime.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const MAX_CONCURRENT_WORKERS: usize = 3;
pub const INFERAY_AGENTS_MCP_NAME: &str = "inferay-agents";

pub const EVAL_PASS_MARKER: &str = "[[EVAL_PASS]]";
pub const EVAL_NEEDS_WORK_MARKER: &str = "[[EVAL_NEEDS_WORK]]";

pub const PARENT_INSTRUCTIONS: &str = "\
Inferay subagents are enabled for this chat. Use them to keep your main context clean:\n\
- run_subagent profile \"explore\" for read-only research and codebase mapping.\n\
- run_subagent profile \"general\" for implementation that returns a summary.\n\
- run_subagent profile \"general\" with verify=true for implement → fresh-context evaluate → one retry (default-FAIL).\n\
- run_subagent profile \"evaluate\" to grade existing work without editing (default-FAIL).\n\
- resume_subagent to continue a cancelled/failed worker in the foreground.\n\
- Prefer background=true for long research while you continue; use background=false when you need the result first.\n\
- Use read_subagent / list_subagents for status. Do not spawn nested subagents from a worker.";

pub const HELP_DETAIL: &str = "\
/agents on — enable subagent tools for this chat\n\
/agents off — disable and cancel running workers\n\
/agents status — show mode and workers\n\
/agents cancel <id|all> — cancel worker(s)\n\
/agents help — this help\n\
\n\
Profiles: explore (research), general (implement), evaluate (read-only default-FAIL review).\n\
Tools: run_subagent, resume_subagent, read_subagent, list_subagents.\n\
verify=true on general runs implement → evaluate → one retry.\n\
Pick model Adaptive to auto-route each parent turn; workers still use profile models.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum SubagentProfile {
    Explore,
    General,
    Evaluate,
}

impl SubagentProfile {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "explore" => Some(Self::Explore),
            "general" => Some(Self::General),
            "evaluate" | "evaluator" | "review" => Some(Self::Evaluate),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explore => "explore",
            Self::General => "general",
            Self::Evaluate => "evaluate",
        }
    }

    pub fn worker_instructions(self) -> &'static str {
        match self {
            Self::Explore => {
                "You are an Inferay explore subagent. Research only: read, search, and summarize. \
Do not edit files, commit, or run destructive commands. Return a concise summary of findings \
with file paths. Do not call run_subagent or spawn further workers."
            }
            Self::General => {
                "You are an Inferay general subagent. Complete the assigned task, then return a \
concise summary of what you did and any remaining risks. Do not call run_subagent or spawn \
further workers."
            }
            Self::Evaluate => {
                "You are an Inferay evaluate subagent. Fresh-context review only: read the repo and \
the task/summary you are given. You have no write/edit mandate — do not modify files. \
Default-FAIL: assume the work is incomplete until evidence proves otherwise. \
End with exactly one marker on its own line: [[EVAL_PASS]] if every stated requirement is proven, \
or [[EVAL_NEEDS_WORK]] with specific findings and file paths. Do not spawn workers."
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl SubagentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvalVerdict {
    Pass,
    NeedsWork,
    /// Default-FAIL when the evaluator omitted a marker.
    Inconclusive,
}

pub fn parse_eval_verdict(text: &str) -> EvalVerdict {
    if text.contains(EVAL_PASS_MARKER) && !text.contains(EVAL_NEEDS_WORK_MARKER) {
        EvalVerdict::Pass
    } else if text.contains(EVAL_NEEDS_WORK_MARKER) {
        EvalVerdict::NeedsWork
    } else {
        EvalVerdict::Inconclusive
    }
}

pub fn is_agents_tool(name: &str) -> bool {
    matches!(
        name,
        "run_subagent" | "resume_subagent" | "read_subagent" | "list_subagents"
    )
}

/// Codex dynamicTools entries for subagents (same shape as skill tools).
pub fn tool_definitions() -> Value {
    json!([
        {
            "type": "function",
            "name": "run_subagent",
            "description": "Spawn an Inferay subagent with a fresh context. Profiles: explore (research), general (implement), evaluate (default-FAIL review). Set verify=true with general for implement→evaluate→one retry.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "profile": { "type": "string", "enum": ["explore", "general", "evaluate"] },
                    "title": { "type": "string", "description": "Short label for the subagent panel" },
                    "prompt": { "type": "string", "description": "Task for the subagent" },
                    "background": { "type": "boolean", "description": "If true, return immediately with an id (not allowed with verify)" },
                    "verify": { "type": "boolean", "description": "If true with general: implement, evaluate, retry once on NEEDS_WORK" }
                },
                "required": ["profile", "prompt"],
                "additionalProperties": false
            }
        },
        {
            "type": "function",
            "name": "resume_subagent",
            "description": "Resume a cancelled, failed, or completed Inferay subagent in the foreground with an optional new prompt.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "prompt": { "type": "string", "description": "Optional follow-up; defaults to continuing the prior task" }
                },
                "required": ["id"],
                "additionalProperties": false
            }
        },
        {
            "type": "function",
            "name": "read_subagent",
            "description": "Read status and summary for a previously spawned Inferay subagent.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"],
                "additionalProperties": false
            }
        },
        {
            "type": "function",
            "name": "list_subagents",
            "description": "List Inferay subagents for this chat. Optional status filter: running, completed, failed, cancelled.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["running", "completed", "failed", "cancelled"] }
                },
                "additionalProperties": false
            }
        }
    ])
}

pub fn merge_tool_definitions(base: Value, agents_enabled: bool) -> Value {
    let mut tools = match base {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    if agents_enabled {
        if let Value::Array(extra) = tool_definitions() {
            tools.extend(extra);
        }
    }
    Value::Array(tools)
}

/// Explore/evaluate workers prefer a faster/cheaper model when possible.
pub fn explore_model(agent_kind: &str, parent_model: Option<&str>) -> Option<String> {
    match agent_kind {
        "claude" => Some("claude-haiku-4-5".into()),
        "codex" => Some("gpt-6-luna".into()),
        _ => parent_model.map(str::to_owned),
    }
}

pub fn model_for_profile(
    profile: SubagentProfile,
    agent_kind: &str,
    parent_model: Option<&str>,
) -> Option<String> {
    match profile {
        SubagentProfile::Explore | SubagentProfile::Evaluate => {
            explore_model(agent_kind, parent_model)
        }
        SubagentProfile::General => parent_model.map(str::to_owned),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_and_tools_cover_evaluate_and_resume() {
        assert_eq!(
            SubagentProfile::parse("evaluate"),
            Some(SubagentProfile::Evaluate)
        );
        assert!(is_agents_tool("resume_subagent"));
        assert!(is_agents_tool("run_subagent"));
        let tools = tool_definitions().as_array().unwrap().clone();
        let names: Vec<_> = tools
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert!(names.contains(&"resume_subagent"));
        assert!(names.contains(&"run_subagent"));
        assert!(HELP_DETAIL.contains("/agents help"));
        assert!(PARENT_INSTRUCTIONS.contains("verify=true"));
    }

    #[test]
    fn eval_verdict_defaults_to_fail_without_marker() {
        assert_eq!(
            parse_eval_verdict("looks good to me"),
            EvalVerdict::Inconclusive
        );
        assert_eq!(
            parse_eval_verdict(&format!("done\n{EVAL_PASS_MARKER}")),
            EvalVerdict::Pass
        );
        assert_eq!(
            parse_eval_verdict(&format!("gaps\n{EVAL_NEEDS_WORK_MARKER}")),
            EvalVerdict::NeedsWork
        );
        assert_eq!(
            parse_eval_verdict(&format!(
                "{EVAL_PASS_MARKER}\nbut also {EVAL_NEEDS_WORK_MARKER}"
            )),
            EvalVerdict::NeedsWork
        );
    }

    #[test]
    fn evaluate_uses_fast_model_like_explore() {
        assert_eq!(
            model_for_profile(SubagentProfile::Evaluate, "claude", Some("claude-opus-5-5"))
                .as_deref(),
            Some("claude-haiku-4-5")
        );
        assert_eq!(
            model_for_profile(SubagentProfile::General, "claude", Some("claude-opus-5-5"))
                .as_deref(),
            Some("claude-opus-5-5")
        );
    }
}
