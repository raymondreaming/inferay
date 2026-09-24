//! Subagent vocabulary and parent-facing tool contracts.
//! Spawn and process policy belong to the server agents runtime.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const MAX_CONCURRENT_WORKERS: usize = 3;
pub const INFERAY_AGENTS_MCP_NAME: &str = "inferay-agents";

pub const PARENT_INSTRUCTIONS: &str = "\
Inferay subagents are enabled for this chat. Use them to keep your main context clean:\n\
- run_subagent with profile \"explore\" for read-only research and codebase mapping.\n\
- run_subagent with profile \"general\" for implementation work that should return a summary.\n\
- Prefer background=true for long research while you continue; use background=false when you need the result before continuing.\n\
- Use read_subagent / list_subagents to check status. Do not spawn nested subagents from a worker.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum SubagentProfile {
    Explore,
    General,
}

impl SubagentProfile {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "explore" => Some(Self::Explore),
            "general" => Some(Self::General),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explore => "explore",
            Self::General => "general",
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

pub fn is_agents_tool(name: &str) -> bool {
    matches!(
        name,
        "run_subagent" | "read_subagent" | "list_subagents"
    )
}

/// Codex dynamicTools entries for subagents (same shape as skill tools).
pub fn tool_definitions() -> Value {
    json!([
        {
            "type": "function",
            "name": "run_subagent",
            "description": "Spawn an Inferay subagent with a fresh context. Use explore for research, general for implementation. Returns a summary when background is false; returns an id immediately when background is true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "profile": { "type": "string", "enum": ["explore", "general"] },
                    "title": { "type": "string", "description": "Short label for the subagent panel" },
                    "prompt": { "type": "string", "description": "Task for the subagent" },
                    "background": { "type": "boolean", "description": "If true, return immediately with an id" }
                },
                "required": ["profile", "prompt"],
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

/// Explore workers prefer a faster/cheaper model when the parent is Claude or Codex.
pub fn explore_model(agent_kind: &str, parent_model: Option<&str>) -> Option<String> {
    match agent_kind {
        "claude" => Some("claude-haiku-4-5".into()),
        "codex" => Some("gpt-6-luna".into()),
        _ => parent_model.map(str::to_owned),
    }
}
