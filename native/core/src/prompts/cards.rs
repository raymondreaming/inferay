//! Skill card validation and UTF-16 text spans.
use super::{SkillProposal, SkillRead, valid_command};
use serde_json::Value;

/// Presentation validation for saved and live skill cards. Applying a proposal
/// still requires the native store's independent revision/approval validation.
pub fn chat_skill_proposal(value: &Value) -> Option<Value> {
    if value["type"] != "inferay.skill-proposal"
        || !matches!(value["action"].as_str(), Some("create" | "update"))
    {
        return None;
    }
    let fields = ["name", "command", "description", "promptTemplate", "reason"];
    for field in fields {
        let text = value[field].as_str()?;
        if text.trim().is_empty() || text.encode_utf16().count() > 50_000 {
            return None;
        }
    }
    let command = value["command"].as_str()?;
    if !valid_command(command) {
        return None;
    }
    let (skill_id, expected_updated_at) = if value["action"] == "update" {
        let id = value["skillId"].as_str()?;
        let updated = value["expectedUpdatedAt"].as_u64()?;
        if id.is_empty() || updated > 9_007_199_254_740_991 {
            return None;
        }
        (Some(id.to_owned()), Some(updated))
    } else {
        (None, None)
    };
    serde_json::to_value(SkillProposal {
        kind: "inferay.skill-proposal",
        action: value["action"].as_str()?.to_owned(),
        skill_id,
        expected_updated_at,
        name: value["name"].as_str()?.to_owned(),
        command: command.to_owned(),
        description: value["description"].as_str()?.to_owned(),
        prompt_template: value["promptTemplate"].as_str()?.to_owned(),
        reason: value["reason"].as_str()?.to_owned(),
    })
    .ok()
}

pub fn chat_skill_read(value: &Value) -> Option<Value> {
    if value["type"] != "inferay.skill-read" {
        return None;
    }
    let skill: SkillRead = serde_json::from_value(value["skill"].clone()).ok()?;
    serde_json::to_value(skill).ok()
}

/// Text spans use JavaScript UTF-16 coordinates without duplicating message text.
pub fn chat_skill_parts(content: &str, streaming: bool) -> Option<Value> {
    if !content.contains("```inferay-skill") {
        return None;
    }
    let mut parts = Vec::new();
    let mut cursor = 0;
    let mut cursor_utf16 = 0;
    let mut lines = content.split_inclusive('\n').scan(0, |offset, line| {
        let start = *offset;
        *offset += line.len();
        Some((start, line))
    });
    while let Some((start, line)) = lines.next() {
        if !line.ends_with('\n')
            || !line
                .strip_prefix("```inferay-skill")
                .is_some_and(|rest| rest.trim().is_empty())
        {
            continue;
        }
        let body_start = start + line.len();
        let mut closing = None;
        for (end, line) in lines.by_ref() {
            if line
                .strip_suffix('\n')
                .unwrap_or(line)
                .trim_end_matches([' ', '\t'])
                == "```"
            {
                closing = Some((end, end + line.len()));
                break;
            }
        }
        let Some((body_end, block_end)) = closing else {
            break;
        };
        let proposal = serde_json::from_str::<Value>(&content[body_start..body_end])
            .ok()
            .and_then(|value| chat_skill_proposal(&value));
        if let Some(proposal) = proposal {
            let start_utf16 = cursor_utf16 + content[cursor..start].encode_utf16().count();
            if start > cursor {
                parts.push(serde_json::json!({"start":cursor_utf16, "end":start_utf16}));
            }
            parts.push(serde_json::json!({"proposal":proposal, "index":start_utf16}));
            cursor_utf16 = start_utf16 + content[start..block_end].encode_utf16().count();
            cursor = block_end;
        }
    }
    let rest = &content[cursor..];
    let partial = if streaming {
        let mut offset = 0;
        rest.split_inclusive('\n').find_map(|line| {
            let start = offset;
            offset += line.len();
            line.strip_prefix("```inferay-skill")
                .filter(|suffix| suffix.is_empty() || suffix.starts_with(char::is_whitespace))
                .map(|_| start)
        })
    } else {
        None
    };
    if let Some(partial) = partial {
        if partial > 0 {
            parts.push(serde_json::json!({"start":cursor_utf16, "end":cursor_utf16 + rest[..partial].encode_utf16().count()}));
        }
        parts.push(serde_json::json!({"pending":true}));
    } else if !rest.is_empty() {
        parts.push(serde_json::json!({"start":cursor_utf16, "end":cursor_utf16 + rest.encode_utf16().count()}));
    }
    Some(Value::Array(parts))
}

#[cfg(test)]
mod skill_card_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn proposal_contract_validates_revisions_and_preserves_card_fields() {
        let mut proposal = json!({
            "type": "inferay.skill-proposal", "action": "update",
            "skillId": "skill-1", "expectedUpdatedAt": 42,
            "name": "Review", "command": "review-2", "description": "Review changes",
            "promptTemplate": "Check the diff", "reason": "Save this workflow"
        });
        assert_eq!(chat_skill_proposal(&proposal), Some(proposal.clone()));
        proposal["expectedUpdatedAt"] = json!(9_007_199_254_740_992_u64);
        assert!(chat_skill_proposal(&proposal).is_none());
        proposal["action"] = json!("create");
        let created = chat_skill_proposal(&proposal).unwrap();
        assert!(created.get("skillId").is_none());
        assert!(created.get("expectedUpdatedAt").is_none());
        proposal["command"] = json!("Review");
        assert!(chat_skill_proposal(&proposal).is_none());
        proposal["command"] = json!("review");
        proposal["promptTemplate"] = json!("🦀".repeat(25_001));
        assert!(chat_skill_proposal(&proposal).is_none());
    }

    #[test]
    fn read_contract_preserves_extra_fields_and_rejects_invalid_shapes() {
        let mut envelope = json!({"type": "inferay.skill-read", "skill": {
            "_id": "skill-1", "name": "Review", "command": "review",
            "description": "Review changes", "promptTemplate": "Check the diff",
            "isBuiltIn": false, "updatedAt": 42, "futureField": {"enabled": true}
        }});
        assert_eq!(chat_skill_read(&envelope), Some(envelope["skill"].clone()));
        envelope["skill"]["isBuiltIn"] = json!("false");
        assert!(chat_skill_read(&envelope).is_none());
        envelope["skill"]["isBuiltIn"] = json!(false);
        envelope["skill"].as_object_mut().unwrap().remove("name");
        assert!(chat_skill_read(&envelope).is_none());
    }
}
