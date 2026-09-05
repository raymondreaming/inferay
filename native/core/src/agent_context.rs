use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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
    pub scope: String,
    pub skill_count: usize,
    pub skill_manifest: String,
    pub activated_skills: Vec<Value>,
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

    pub fn resolve(
        &self,
        cwd: Option<&str>,
        pane_id: Option<&str>,
        skills: &[Prompt],
    ) -> EffectiveAgentContext {
        let stored = self.load();
        let project = project_key(cwd).and_then(|key| stored.projects.get(&key).cloned());
        let chat = pane_id.and_then(|id| stored.chats.get(id).cloned());
        let effective_instructions =
            compose_layers(&stored.global, project.as_ref(), chat.as_ref());
        let scope = if chat
            .as_ref()
            .is_some_and(|layer| !layer.instructions.trim().is_empty())
        {
            "chat"
        } else if project
            .as_ref()
            .is_some_and(|layer| !layer.instructions.trim().is_empty())
        {
            "project"
        } else {
            "global"
        };
        EffectiveAgentContext {
            global: stored.global,
            project,
            chat,
            effective_instructions,
            scope: scope.into(),
            skill_count: skills.len(),
            skill_manifest: create_skill_manifest(skills),
            activated_skills: Vec::new(),
        }
    }

    pub fn resolve_for_agent(
        &self,
        cwd: Option<&str>,
        pane_id: Option<&str>,
        text: &str,
        skills: &[Prompt],
    ) -> EffectiveAgentContext {
        let mut context = self.resolve(cwd, pane_id, skills);
        let normalized = text.to_lowercase();
        context.activated_skills = skills
            .iter()
            .filter(|skill| {
                let command = skill.command.to_lowercase();
                let explicit = normalized.contains(&format!("/{command}"));
                let trigger_terms = [skill.command.replace('-', " "), skill.name.clone()];
                let automatic = trigger_terms.into_iter().any(|term| {
                    let term = term.to_lowercase().trim().to_string();
                    term.len() >= 4 && normalized.contains(&term)
                });
                explicit || automatic
            })
            .map(|skill| {
                json!({
                    "name": skill.name,
                    "command": skill.command,
                    "instructions": skill.prompt_template,
                })
            })
            .collect();
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
            "project" => {
                let key = project_key(update.cwd.as_deref())
                    .ok_or_else(|| "A project directory is required".to_string())?;
                if layer.instructions.is_empty() {
                    stored.projects.remove(&key);
                } else {
                    stored.projects.insert(key, layer);
                }
            }
            "chat" => {
                let pane_id = update
                    .pane_id
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "A chat pane is required".to_string())?;
                if layer.instructions.is_empty() {
                    stored.chats.remove(&pane_id);
                } else {
                    stored.chats.insert(pane_id, layer);
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

pub fn create_skill_manifest(skills: &[Prompt]) -> String {
    skills
        .iter()
        .map(|skill| {
            let description = if skill.description.is_empty() {
                &skill.name
            } else {
                &skill.description
            };
            format!(
                "- {}: {} (invoke with /{})",
                skill.command, description, skill.command
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
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
    let mut parts = if global.instructions.trim().is_empty() {
        Vec::new()
    } else {
        vec![global.instructions.trim().to_string()]
    };
    for layer in [project, chat].into_iter().flatten() {
        if layer.instructions.trim().is_empty() {
            continue;
        }
        if layer.mode == "replace" {
            parts = vec![layer.instructions.trim().to_string()];
        } else {
            parts.push(layer.instructions.trim().to_string());
        }
    }
    parts.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_scopes_and_removes_empty_overrides() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested/context.json");
        let store = AgentContextStore::new(path.clone());
        assert_eq!(
            store.resolve(None, None, &[]).global,
            AgentContextLayer::default()
        );
        for (scope, instructions, mode) in [
            ("global", " global ", "inherit"),
            ("project", "project", "inherit"),
            ("chat", "chat", "replace"),
            ("chat", "", "inherit"),
            ("project", "", "inherit"),
        ] {
            store
                .update(
                    AgentContextUpdate {
                        scope: scope.into(),
                        cwd: Some("/repo".into()),
                        pane_id: Some("pane".into()),
                        instructions: instructions.into(),
                        mode: Some(mode.into()),
                    },
                    123,
                )
                .unwrap();
            let context =
                AgentContextStore::new(path.clone()).resolve(Some("/repo"), Some("pane"), &[]);
            let expected = match (scope, instructions) {
                ("chat", "chat") => "chat",
                ("project", "project") | ("chat", "") => "global\n\nproject",
                _ => "global",
            };
            assert_eq!(context.effective_instructions, expected);
            assert_eq!(context.global.updated_at, 123);
            if instructions.is_empty() {
                assert!(context.chat.is_none());
                if scope == "project" {
                    assert!(context.project.is_none());
                }
            }
        }
    }

    #[test]
    fn activates_skills_with_the_existing_explicit_and_automatic_rules() {
        let directory = tempfile::tempdir().unwrap();
        let store = AgentContextStore::new(directory.path().join("context.json"));
        let skill = Prompt {
            id: "skill-1".into(),
            name: "Rust Migration".into(),
            description: "Port code".into(),
            command: "rust-migration".into(),
            prompt_template: "Preserve behavior".into(),
            category: None,
            tags: Vec::new(),
            is_built_in: true,
            execution_count: 0,
            last_used: None,
            created_at: 0,
            updated_at: 0,
        };
        let automatic = store.resolve_for_agent(None, None, "start the rust migration", &[skill]);
        assert_eq!(automatic.activated_skills.len(), 1);
        assert_eq!(automatic.activated_skills[0]["command"], "rust-migration");
    }
}
