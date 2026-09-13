//! Context composition and skill activation. Project keys are normalized by the caller.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::prompts::Prompt;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextLayer {
    pub instructions: String,
    #[ts(type = "'inherit' | 'replace'")]
    pub mode: String,
    pub updated_at: u64,
}

#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveAgentContext {
    pub global: AgentContextLayer,
    pub project: Option<AgentContextLayer>,
    pub chat: Option<AgentContextLayer>,
    pub effective_instructions: String,
    #[serde(skip)]
    pub activated_skills: String,
}

#[derive(Debug, ts_rs::TS)]
#[ts(rename_all = "camelCase")]
pub struct AgentContextUpdate {
    #[ts(type = "'global' | 'project' | 'chat'")]
    pub scope: String,
    #[ts(optional)]
    pub cwd: Option<String>,
    #[ts(optional)]
    pub pane_id: Option<String>,
    pub instructions: String,
    #[ts(optional, type = "'inherit' | 'replace'")]
    pub mode: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AgentContextState {
    global: AgentContextLayer,
    projects: BTreeMap<String, AgentContextLayer>,
    chats: BTreeMap<String, AgentContextLayer>,
}

impl AgentContextState {
    pub fn resolve(
        mut self,
        project_key: Option<&str>,
        pane_id: Option<&str>,
    ) -> EffectiveAgentContext {
        let project = project_key.and_then(|key| self.projects.remove(key));
        let chat = pane_id.and_then(|id| self.chats.remove(id));
        let effective_instructions = compose_layers(&self.global, project.as_ref(), chat.as_ref());
        EffectiveAgentContext {
            global: self.global,
            project,
            chat,
            effective_instructions,
            activated_skills: String::new(),
        }
    }

    pub fn resolve_for_agent(
        self,
        project_key: Option<&str>,
        pane_id: Option<&str>,
        text: &str,
        skills: &[Prompt],
    ) -> EffectiveAgentContext {
        let mut context = self.resolve(project_key, pane_id);
        let normalized = text.to_lowercase();
        context.activated_skills = skills
            .iter()
            .filter(|skill| {
                normalized.contains(&format!("/{}", skill.command.to_lowercase()))
                    || [skill.command.replace('-', " ").as_str(), &skill.name]
                        .into_iter()
                        .any(|term| {
                            let lower = term.to_lowercase();
                            let term = lower.trim();
                            term.len() >= 4 && normalized.contains(term)
                        })
            })
            .map(|skill| {
                format!(
                    "<activated-skill name=\"{}\">\n{}\n</activated-skill>",
                    skill.command, skill.prompt_template
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        context
    }

    pub fn update(&mut self, update: AgentContextUpdate, now: u64) -> Result<(), String> {
        let layer = AgentContextLayer {
            instructions: update.instructions.trim().to_string(),
            mode: normalize_mode(update.mode.as_deref()),
            updated_at: now,
        };
        match update.scope.as_str() {
            "global" => self.global = layer,
            "project" | "chat" => {
                let (layers, key) = if update.scope == "project" {
                    (
                        &mut self.projects,
                        update
                            .cwd
                            .filter(|key| !key.is_empty())
                            .ok_or_else(|| "A project directory is required".to_string())?,
                    )
                } else {
                    (
                        &mut self.chats,
                        update
                            .pane_id
                            .filter(|value| !value.is_empty())
                            .ok_or_else(|| "A chat pane is required".to_string())?,
                    )
                };
                if layer.instructions.is_empty() {
                    layers.remove(&key);
                } else {
                    layers.insert(key, layer);
                }
            }
            _ => return Err("scope is invalid".into()),
        }
        Ok(())
    }
}

impl Default for AgentContextLayer {
    fn default() -> Self {
        Self {
            instructions: String::new(),
            mode: "inherit".into(),
            updated_at: 0,
        }
    }
}

fn normalize_mode(value: Option<&str>) -> String {
    if value == Some("replace") {
        "replace".into()
    } else {
        "inherit".into()
    }
}

fn compose_layers(
    global: &AgentContextLayer,
    project: Option<&AgentContextLayer>,
    chat: Option<&AgentContextLayer>,
) -> String {
    let mut parts = Vec::new();
    for layer in [Some(global), project, chat].into_iter().flatten() {
        let instructions = layer.instructions.trim();
        if instructions.is_empty() {
            continue;
        }
        if layer.mode == "replace" {
            parts.clear();
        }
        parts.push(instructions);
    }
    parts.join("\n\n")
}
