//! Pure skill editing and proposal decisions over an in-memory library.
use super::{
    Prompt, PromptError, SkillProposalView, normalize_prompt_fields, not_found, string_value,
};
use serde_json::{Map, Value, json};

#[derive(Debug)]
pub struct PromptLibrary {
    prompts: Vec<Prompt>,
}

impl Prompt {
    pub fn custom(body: &Map<String, Value>, now: u64) -> Result<Self, PromptError> {
        let body = normalize_prompt_fields(body, true)?;
        let body = &body;
        let command = string_value(body, "command").unwrap_or_default();
        let name = string_value(body, "name").unwrap_or_default();
        Ok(Self {
            id: format!("custom-{now}"),
            name: name.clone(),
            description: string_value(body, "description")
                .filter(|value| !value.is_empty())
                .unwrap_or(name),
            command,
            prompt_template: string_value(body, "promptTemplate").unwrap_or_default(),
            is_built_in: false,
            created_at: now,
            updated_at: now,
        })
    }
}

/// Validated proposal intent. The adapter loads a library only when required.
pub struct ProposalRequest<'a> {
    proposal: &'a Value,
    action: &'a str,
    decision: Option<&'a str>,
    outcome: Value,
    prepared: Option<Prompt>,
    now: u64,
}

impl<'a> ProposalRequest<'a> {
    pub fn new(
        proposal: &'a Value,
        stored: &Value,
        decision: Option<&'a str>,
        now: u64,
    ) -> Result<Self, PromptError> {
        let invalid = || PromptError {
            status: 400,
            message: "Invalid skill proposal".into(),
        };
        proposal.as_object().ok_or_else(invalid)?;
        let action = proposal["action"]
            .as_str()
            .filter(|action| matches!(*action, "create" | "update"))
            .ok_or_else(invalid)?;
        let signature = stored["proposal"]
            .as_str()
            .and_then(|text| serde_json::from_str::<Value>(text).ok());
        let outcome = if signature.as_ref() == Some(proposal) {
            stored["outcome"].clone()
        } else {
            Value::Null
        };
        let mut prepared = None;
        if outcome.is_null() {
            match decision {
                Some("approve") if action == "create" => {
                    prepared = Some(Prompt::custom(proposal.as_object().unwrap(), now)?);
                }
                Some("approve") => {
                    proposal["skillId"]
                        .as_str()
                        .filter(|id| !id.is_empty())
                        .ok_or_else(invalid)?;
                    proposal["expectedUpdatedAt"].as_u64().ok_or_else(invalid)?;
                }
                None | Some("reject") => {}
                _ => return Err(invalid()),
            }
        }
        Ok(Self {
            proposal,
            action,
            decision,
            outcome,
            prepared,
            now,
        })
    }

    pub fn needs_library(&self) -> bool {
        self.action == "update" || self.decision == Some("approve") && self.outcome.is_null()
    }
}

impl PromptLibrary {
    pub fn new(prompts: Vec<Prompt>) -> Self {
        Self { prompts }
    }

    pub fn prompts(&self) -> &[Prompt] {
        &self.prompts
    }

    pub fn create(&mut self, body: &Map<String, Value>, now: u64) -> Result<Prompt, PromptError> {
        self.insert(Prompt::custom(body, now)?)
    }

    pub fn insert(&mut self, prompt: Prompt) -> Result<Prompt, PromptError> {
        let prompts = &mut self.prompts;
        if prompts
            .iter()
            .any(|existing| existing.command == prompt.command)
        {
            return Err(PromptError {
                status: 400,
                message: format!("Command /{} already exists", prompt.command),
            });
        }
        prompts.push(prompt.clone());
        Ok(prompt)
    }

    pub fn update(
        &mut self,
        id: &str,
        body: &Map<String, Value>,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        let prompts = &mut self.prompts;
        let Some(index) = prompts.iter().position(|prompt| prompt.id == id) else {
            return Err(not_found());
        };
        if prompts[index].is_built_in {
            return Err(PromptError {
                status: 400,
                message: "Cannot edit built-in prompts".into(),
            });
        }
        if let Some(expected) = body.get("expectedUpdatedAt")
            && expected.as_u64() != Some(prompts[index].updated_at)
        {
            return Err(PromptError {
                status: 409,
                message:
                    "This skill changed after the proposal. Review a fresh proposal before saving."
                        .into(),
            });
        }
        let body = normalize_prompt_fields(body, false)?;
        let body = &body;
        if let Some(command) = string_value(body, "command")
            && command != prompts[index].command
            && prompts
                .iter()
                .any(|prompt| prompt.id != id && prompt.command == command)
        {
            return Err(PromptError {
                status: 400,
                message: format!("Command /{command} already exists"),
            });
        }

        let current = &mut prompts[index];
        for (key, field) in [
            ("name", &mut current.name),
            ("description", &mut current.description),
            ("command", &mut current.command),
            ("promptTemplate", &mut current.prompt_template),
        ] {
            if let Some(value) = string_value(body, key) {
                *field = value;
            }
        }
        current.updated_at = now.max(current.updated_at.saturating_add(1));
        let updated = current.clone();
        Ok(updated)
    }

    pub fn proposal(
        &mut self,
        request: ProposalRequest<'_>,
    ) -> Result<(SkillProposalView, Option<Value>), PromptError> {
        let ProposalRequest {
            proposal,
            action,
            decision,
            mut outcome,
            prepared,
            now,
        } = request;
        let mut record = None;
        let mut message = None;
        if outcome.is_null() {
            match decision {
                Some("approve") => {
                    let saved = if action == "create" {
                        self.insert(prepared.expect("create proposal was validated"))?
                    } else {
                        self.update(
                            proposal["skillId"].as_str().unwrap(),
                            proposal.as_object().unwrap(),
                            now,
                        )?
                    };
                    outcome = json!({"status":"saved","skillId":saved.id});
                    message = Some(format!(
                        "I approved the skill proposal. Inferay successfully {} /{} (skill ID: {}).",
                        if action == "create" {
                            "created"
                        } else {
                            "updated"
                        },
                        saved.command,
                        saved.id
                    ));
                }
                Some("reject") => {
                    outcome = json!({"status":"rejected"});
                    message = Some(format!(
                        "I declined the proposed skill change for /{}. Do not apply it.",
                        proposal["command"].as_str().unwrap_or_default()
                    ));
                }
                None => {}
                _ => unreachable!("proposal decision was validated"),
            }
            if !outcome.is_null() {
                record = Some(json!({"proposal":proposal.to_string(),"outcome":outcome}));
            }
        }
        let existing = if action == "update" {
            self.prompts
                .iter()
                .find(|skill| Some(skill.id.as_str()) == proposal["skillId"].as_str())
        } else {
            None
        };
        let decided = !outcome.is_null();
        let blocked = !decided
            && action == "update"
            && existing.as_ref().is_none_or(|skill| {
                skill.is_built_in
                    || Some(skill.updated_at) != proposal["expectedUpdatedAt"].as_u64()
            });
        let (title, status) = match outcome["status"].as_str() {
            Some("saved") => ("Skill saved", "Saved to your local skills library."),
            Some("rejected") => ("Skill change declined", "No changes were made."),
            _ => (
                if action == "create" {
                    "Create skill"
                } else {
                    "Update skill"
                },
                "Your approval is required. Nothing has been changed.",
            ),
        };
        Ok((SkillProposalView {
            title: title.into(), status: status.into(), decided,
            saved_skill_id: outcome["skillId"].as_str().map(str::to_owned),
            current_instructions: existing.map(|skill| skill.prompt_template.clone()),
            blocked_reason: blocked.then(|| "This skill changed or is no longer editable. Ask the agent for a fresh proposal.".into()),
            message,
        }, record))
    }

    pub fn delete(&mut self, id: &str) -> Result<(), PromptError> {
        let prompts = &mut self.prompts;
        let Some(prompt) = prompts.iter().find(|prompt| prompt.id == id) else {
            return Err(not_found());
        };
        if prompt.is_built_in {
            return Err(PromptError {
                status: 400,
                message: "Cannot delete built-in prompts".into(),
            });
        }
        prompts.retain(|prompt| prompt.id != id);
        Ok(())
    }
}

#[cfg(test)]
mod store_behavior_tests {
    use super::*;
    use crate::prompts::{commands, tools};

    fn propose(
        library: &mut PromptLibrary,
        proposal: &Value,
        stored: &Value,
        decision: Option<&str>,
        now: u64,
    ) -> Result<(SkillProposalView, Option<Value>), PromptError> {
        library.proposal(ProposalRequest::new(proposal, stored, decision, now)?)
    }

    #[test]
    fn expansion_and_proposals_share_the_saved_library_without_implicit_writes() {
        let mut store = PromptLibrary::new(Vec::new());
        let skill = store
            .create(
                json!({"name":"Review", "command":"review", "description":"Review changes",
            "promptTemplate":"Inspect {args}"})
                .as_object()
                .unwrap(),
                42,
            )
            .unwrap();
        for (input, expected) in [
            (" /REVIEW\t/review\n", " Inspect\tInspect\n"),
            (
                "/review, x/review /review/foo /reviewé",
                "/review, x/review /review/foo /reviewé",
            ),
            ("\u{2003}/review\u{2003}", "\u{2003}Inspect\u{2003}"),
            ("/help /unknown", "/help /unknown"),
        ] {
            assert_eq!(
                commands::expand_chat_commands(&store.prompts, input, None, None),
                expected
            );
        }
        assert_eq!(
            commands::expand_chat_commands(
                &store.prompts,
                "/review",
                Some(&skill.id),
                Some("changes")
            ),
            "Inspect changes"
        );
        let (result, card) = tools::call_tool(
            &store.prompts,
            "inferay_read_skill",
            &json!({"skill":"review"}),
        )
        .unwrap();
        assert_eq!(result["_id"], skill.id);
        assert_eq!(card.unwrap()["type"], "inferay.skill-read");
        let proposal = json!({"action":"update", "skillId":skill.id, "expectedUpdatedAt":42,
            "name":"New name", "command":"review", "description":"New description",
            "promptTemplate":"New instructions", "reason":"Improve review"});
        assert!(
            tools::call_tool(&store.prompts, "inferay_propose_skill", &proposal)
                .unwrap()
                .1
                .is_some()
        );
        assert_eq!(store.prompts[0].name, "Review");
        let mut stale = proposal.clone();
        stale["expectedUpdatedAt"] = json!(41);
        assert!(tools::call_tool(&store.prompts, "inferay_propose_skill", &stale).is_err());
        assert!(tools::call_tool(&store.prompts, "unknown", &proposal).is_err());

        let (view, record) = propose(&mut store, &stale, &Value::Null, None, 43).unwrap();
        assert!(view.blocked_reason.is_some());
        assert!(record.is_none());
        assert_eq!(
            propose(&mut store, &stale, &Value::Null, Some("approve"), 43)
                .unwrap_err()
                .status,
            409
        );
        let (saved, record) =
            propose(&mut store, &proposal, &Value::Null, Some("approve"), 43).unwrap();
        assert_eq!(saved.saved_skill_id.as_deref(), Some(skill.id.as_str()));
        assert!(saved.message.unwrap().contains("updated /review"));
        let record = record.unwrap();
        let (replayed, replacement) =
            propose(&mut store, &proposal, &record, Some("approve"), 44).unwrap();
        assert!(replayed.decided);
        assert!(replayed.message.is_none());
        assert!(replacement.is_none());
        assert_eq!(store.prompts[0].updated_at, 43);
        let revised = json!({"action":"create","name":"Build","command":"/BUILD","promptTemplate":"Build it"});
        let (rejected, rejected_record) =
            propose(&mut store, &revised, &record, Some("reject"), 45).unwrap();
        assert!(rejected.decided);
        assert!(rejected.saved_skill_id.is_none());
        assert_eq!(store.prompts.len(), 1);
        let (replayed, _) = propose(
            &mut store,
            &revised,
            &rejected_record.unwrap(),
            Some("approve"),
            46,
        )
        .unwrap();
        assert_eq!(replayed.title, "Skill change declined");
        assert_eq!(store.prompts.len(), 1);
        let (created, _) =
            propose(&mut store, &revised, &Value::Null, Some("approve"), 47).unwrap();
        assert!(created.message.unwrap().contains("created /build"));
        assert_eq!(store.prompts.len(), 2);
    }
}
