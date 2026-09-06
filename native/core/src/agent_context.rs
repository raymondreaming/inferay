use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::prompts::Prompt;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextLayer {
    pub instructions: String,
    pub mode: String,
    pub updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveAgentContext {
    pub global: AgentContextLayer,
    pub project: Option<AgentContextLayer>,
    pub chat: Option<AgentContextLayer>,
    pub effective_instructions: String,
    #[serde(skip)]
    pub activated_skills: String,
}

#[derive(Debug)]
pub struct AgentContextUpdate {
    pub scope: String,
    pub cwd: Option<String>,
    pub pane_id: Option<String>,
    pub instructions: String,
    pub mode: Option<String>,
}

#[derive(Debug)]
pub struct AgentContextStore {
    path: PathBuf,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct AgentContextFile {
    global: AgentContextLayer,
    projects: BTreeMap<String, AgentContextLayer>,
    chats: BTreeMap<String, AgentContextLayer>,
}

impl AgentContextStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn resolve(&self, cwd: Option<&str>, pane_id: Option<&str>) -> EffectiveAgentContext {
        let mut stored = self.load();
        let project = project_key(cwd).and_then(|key| stored.projects.remove(&key));
        let chat = pane_id.and_then(|id| stored.chats.remove(id));
        let effective_instructions =
            compose_layers(&stored.global, project.as_ref(), chat.as_ref());
        EffectiveAgentContext {
            global: stored.global,
            project,
            chat,
            effective_instructions,
            activated_skills: String::new(),
        }
    }

    pub fn resolve_for_agent(
        &self,
        cwd: Option<&str>,
        pane_id: Option<&str>,
        text: &str,
        skills: &[Prompt],
    ) -> EffectiveAgentContext {
        let mut context = self.resolve(cwd, pane_id);
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

    pub fn update(&self, update: AgentContextUpdate, now: u64) -> Result<(), String> {
        let mut stored = self.load();
        let layer = AgentContextLayer {
            instructions: update.instructions.trim().to_string(),
            mode: normalize_mode(update.mode.as_deref()),
            updated_at: now,
        };
        match update.scope.as_str() {
            "global" => stored.global = layer,
            "project" | "chat" => {
                let (layers, key) = if update.scope == "project" {
                    (
                        &mut stored.projects,
                        project_key(update.cwd.as_deref())
                            .ok_or_else(|| "A project directory is required".to_string())?,
                    )
                } else {
                    (
                        &mut stored.chats,
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
        let bytes = serde_json::to_vec_pretty(&stored).map_err(|error| error.to_string())?;
        crate::atomic_write::overwrite(&self.path, &bytes)
    }

    fn load(&self) -> AgentContextFile {
        std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
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

fn project_key(cwd: Option<&str>) -> Option<String> {
    let cwd = cwd?.trim();
    if cwd.is_empty() {
        return None;
    }
    std::path::absolute(cwd)
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
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
