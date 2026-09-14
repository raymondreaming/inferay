//! Agent-facing skill tools; proposals are values, never implicit writes.
use super::{Prompt, filter_prompts, valid_command};
use serde_json::{Value, json};

/// Agent tools read the same store as the editor. Proposals never write it.
pub fn tool_definitions() -> Value {
    json!([
        {"type":"function","name":"inferay_list_skills",
         "description":"Find skills in the user's Inferay library. No filesystem or HTTP lookup needed.",
         "inputSchema":{"type":"object","properties":{"query":{"type":"string","description":"Optional name, command, or description filter"}},"additionalProperties":false}},
        {"type":"function","name":"inferay_read_skill",
         "description":"Read a saved Inferay skill directly by ID, slash command, or exact name. Returns complete instructions and revision, and displays a native skill card.",
         "inputSchema":{"type":"object","properties":{"skill":{"type":"string"}},"required":["skill"],"additionalProperties":false}},
        {"type":"function","name":"inferay_propose_skill",
         "description":"Show a native approval card to create or update an Inferay skill. Does NOT save. For updates first read the skill and pass its ID and updatedAt revision. Wait for the user's approval result; never save through shell or HTTP.",
         "inputSchema":{"type":"object","properties":{
             "action":{"type":"string","enum":["create","update"]},
             "skillId":{"type":"string"},"expectedUpdatedAt":{"type":"integer"},
             "name":{"type":"string"},"command":{"type":"string"},
             "description":{"type":"string"},"promptTemplate":{"type":"string"},"reason":{"type":"string"}
         },"required":["action","name","command","description","promptTemplate","reason"],"additionalProperties":false}}
    ])
}

pub fn validate_tool(tool: &str) -> Result<(), String> {
    if !matches!(
        tool,
        "inferay_list_skills" | "inferay_read_skill" | "inferay_propose_skill"
    ) {
        return Err(format!("Unknown Inferay tool: {tool}"));
    }
    Ok(())
}

/// Returns the tool result and, optionally, a persisted native chat card.
pub fn call_tool(
    skills: &[Prompt],
    tool: &str,
    args: &Value,
) -> Result<(Value, Option<Value>), String> {
    validate_tool(tool)?;
    match tool {
        "inferay_list_skills" => {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            let matches = filter_prompts(skills, "all", &query).into_iter().map(|skill| json!({"_id":skill.id,"name":skill.name,"command":skill.command,
                "description":skill.description,"isBuiltIn":skill.is_built_in,"updatedAt":skill.updated_at})).collect::<Vec<_>>();
            Ok((json!({"skills":matches}), None))
        }
        "inferay_read_skill" => {
            let key = args
                .get("skill")
                .and_then(Value::as_str)
                .ok_or("skill is required")?
                .trim()
                .trim_start_matches('/');
            let matches = skills
                .iter()
                .filter(|skill| {
                    skill.id == key
                        || skill.command.eq_ignore_ascii_case(key)
                        || skill.name.eq_ignore_ascii_case(key)
                })
                .collect::<Vec<_>>();
            if matches.len() != 1 {
                return Err(
                    "Skill not found or ambiguous. Use inferay_list_skills to find its exact ID."
                        .into(),
                );
            }
            let skill = matches[0];
            let result = json!({"_id":skill.id,"name":skill.name,"command":skill.command,
                "description":skill.description,"promptTemplate":skill.prompt_template,
                "isBuiltIn":skill.is_built_in,"updatedAt":skill.updated_at});
            Ok((
                result.clone(),
                Some(json!({"type":"inferay.skill-read","skill":result})),
            ))
        }
        _ => {
            let action = args
                .get("action")
                .and_then(Value::as_str)
                .ok_or("action is required")?;
            if !matches!(action, "create" | "update") {
                return Err("Invalid action".into());
            }
            let mut proposal = json!({"type":"inferay.skill-proposal","action":action});
            for field in ["name", "command", "description", "promptTemplate", "reason"] {
                let value = args
                    .get(field)
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty() && value.len() <= 50_000)
                    .ok_or_else(|| format!("{field} must be nonempty text, at most 50000 bytes"))?;
                proposal[field] = json!(value);
            }
            let command = proposal["command"].as_str().unwrap();
            if !valid_command(command) {
                return Err("Command must start with a lowercase letter and contain only lowercase letters, digits, and hyphens".into());
            }
            let id = args.get("skillId").and_then(Value::as_str).unwrap_or("");
            if skills
                .iter()
                .any(|skill| skill.command == command && (action == "create" || skill.id != id))
            {
                return Err("That command already exists. Choose a unique command.".into());
            }
            if action == "update" {
                let skill = skills
                    .iter()
                    .find(|skill| skill.id == id)
                    .ok_or("Skill no longer exists. Read it again.")?;
                if skill.is_built_in {
                    return Err("Built-in skills are read-only. Propose a custom copy.".into());
                }
                if args.get("expectedUpdatedAt").and_then(Value::as_u64) != Some(skill.updated_at) {
                    return Err("Skill changed. Read it again before proposing an update.".into());
                }
                proposal["skillId"] = json!(id);
                proposal["expectedUpdatedAt"] = json!(skill.updated_at);
            }
            Ok((
                json!({"status":"pending_approval","message":"Approval card displayed. Nothing saved. Do not repeat the proposal as a fenced block. Wait for the user's approval result."}),
                Some(proposal),
            ))
        }
    }
}
