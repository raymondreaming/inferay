//! Typed, transport-free prompt/skill persistence for native clients.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use inferay_core::prompts::{Prompt, PromptError, PromptStore};
use serde_json::{Map, Value, json};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct NativePrompts {
    store: Arc<Mutex<PromptStore>>,
}

impl NativePrompts {
    pub(crate) fn new(store: Arc<Mutex<PromptStore>>) -> Self {
        Self { store }
    }

    pub async fn list(&self) -> Result<Vec<Prompt>, String> {
        self.store.lock().await.list_by_usage()
    }

    /// Expansion happens once at chat admission. Queued sends carry
    /// prepared text without the expansion flag, so replay never expands again.
    pub(crate) async fn expand_chat_commands(
        &self,
        text: &str,
        command_id: Option<&str>,
        args: Option<&str>,
    ) -> Result<String, String> {
        let store = self.store.lock().await;
        let skills = store.list_by_usage()?;
        let (expanded, used) = expand_commands(text, &skills, command_id, args);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        for id in used {
            store
                .increment_usage(&id, now)
                .map_err(|error| error.message)?;
        }
        Ok(expanded)
    }

    /// Agent tools read the same store as the editor. Proposals never write it.
    pub(crate) fn tool_definitions() -> Value {
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

    /// Returns the tool result and, optionally, a persisted native chat card.
    pub(crate) async fn call_tool(
        &self,
        tool: &str,
        args: &Value,
    ) -> Result<(Value, Option<Value>), String> {
        if !matches!(
            tool,
            "inferay_list_skills" | "inferay_read_skill" | "inferay_propose_skill"
        ) {
            return Err(format!("Unknown Inferay tool: {tool}"));
        }
        let skills = self.list().await?;
        match tool {
            "inferay_list_skills" => {
                let query = args
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_lowercase();
                let matches = skills.iter().filter(|skill| {
                    format!("{} {} {}", skill.name, skill.command, skill.description).to_lowercase().contains(&query)
                }).map(|skill| json!({"_id":skill.id,"name":skill.name,"command":skill.command,
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
                    return Err("Skill not found or ambiguous. Use inferay_list_skills to find its exact ID.".into());
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
                        .ok_or_else(|| {
                            format!("{field} must be nonempty text, at most 50000 bytes")
                        })?;
                    proposal[field] = json!(value);
                }
                let command = proposal["command"].as_str().unwrap();
                if !command.starts_with(|ch: char| ch.is_ascii_lowercase())
                    || !command
                        .chars()
                        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
                {
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
                    if args.get("expectedUpdatedAt").and_then(Value::as_u64)
                        != Some(skill.updated_at)
                    {
                        return Err(
                            "Skill changed. Read it again before proposing an update.".into()
                        );
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

    pub async fn delete(&self, id: &str) -> Result<(), PromptError> {
        self.store.lock().await.delete(id)
    }

    pub async fn increment_usage_at(&self, id: &str, now: u64) -> Result<(), PromptError> {
        self.store.lock().await.increment_usage(id, now)
    }

    pub(crate) async fn create_json(
        &self,
        body: Map<String, Value>,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        self.store.lock().await.create(&body, now)
    }

    pub(crate) async fn update_json(
        &self,
        id: &str,
        body: Map<String, Value>,
        now: u64,
    ) -> Result<Prompt, PromptError> {
        self.store.lock().await.update(id, &body, now)
    }
}

fn expand_commands(
    text: &str,
    skills: &[Prompt],
    command_id: Option<&str>,
    args: Option<&str>,
) -> (String, Vec<String>) {
    let expand = |skill: &Prompt, token: &str, args: &str| {
        if skill.prompt_template.is_empty() {
            token.trim().to_owned()
        } else {
            skill
                .prompt_template
                .replacen("{args}", args, 1)
                .trim()
                .to_owned()
        }
    };
    if let Some(id) = command_id {
        return skills
            .iter()
            .find(|skill| skill.id == id)
            .map(|skill| {
                (
                    expand(skill, text, args.unwrap_or("")),
                    vec![skill.id.clone()],
                )
            })
            .unwrap_or_else(|| (text.to_owned(), Vec::new()));
    }
    static TOKENS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let tokens = TOKENS.get_or_init(|| regex::Regex::new(r"/[a-zA-Z][a-zA-Z0-9_-]*").unwrap());
    let mut output = String::with_capacity(text.len());
    let mut used = Vec::new();
    let mut offset = 0;
    for token in tokens.find_iter(text) {
        if text[..token.start()]
            .chars()
            .next_back()
            .is_some_and(|c| !c.is_whitespace())
            || text[token.end()..]
                .chars()
                .next()
                .is_some_and(|c| !c.is_whitespace())
        {
            continue;
        }
        // Local UI commands shadow library commands of the same name.
        let name = &token.as_str()[1..];
        if ["exit", "clear", "help"]
            .iter()
            .any(|local| name.eq_ignore_ascii_case(local))
        {
            continue;
        }
        if let Some(skill) = skills
            .iter()
            .find(|skill| skill.command.eq_ignore_ascii_case(name))
        {
            output.push_str(&text[offset..token.start()]);
            output.push_str(&expand(skill, token.as_str(), ""));
            used.push(skill.id.clone());
            offset = token.end();
        }
    }
    output.push_str(&text[offset..]);
    (output, used)
}
