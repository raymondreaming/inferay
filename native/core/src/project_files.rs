//! Portable project definitions. Filesystem inspection belongs to the server.
use crate::projects::{CalendarSchedule, bounded_text, validate_json, validate_schema_definition};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use ts_rs::TS;

pub const MANIFEST_LIMIT: usize = 131_072;
pub const ENTRYPOINT_LIMIT: usize = 1_000_000;
pub const PLUGIN_BYTE_LIMIT: usize = 50_000_000;
pub const PLUGIN_ENTRY_LIMIT: usize = 1_000;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProjectFileCommand {
    SaveDefinition {
        project_id: String,
        path: String,
        content: String,
        expected_hash: Option<String>,
    },
    ReviewAutomation {
        id: String,
    },
    ApproveAutomation {
        id: String,
        expected_inputs_hash: String,
        enable: bool,
    },
    DisableAutomation {
        id: String,
    },
    RunAutomation {
        id: String,
        request_id: String,
    },
    RetryRun {
        id: String,
        request_id: String,
    },
    StopRun {
        id: String,
    },
    LinkRepository {
        project_id: String,
        repository_id: String,
        expected_project_hash: String,
        path: String,
    },
    AssociateConversation {
        project_id: String,
        pane_id: String,
    },
}

/// A file observed by the index. Invalid files remain visible and editable;
/// their last valid definition is never silently substituted.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDefinition<T> {
    pub id: String,
    pub project_id: String,
    pub plugin_id: Option<String>,
    pub source_path: String,
    pub source_hash: Option<String>,
    pub error: Option<String>,
    pub definition: Option<T>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IndexedAutomation {
    pub file: IndexedDefinition<AutomationDefinition>,
    pub enabled: bool,
    pub next_due_at: Option<i64>,
    pub inputs_changed: bool,
    pub execution_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct IndexedPlugin {
    pub file: IndexedDefinition<PluginDefinition>,
    pub approved_hash: Option<String>,
    pub approved_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionIssue {
    pub project_id: String,
    pub source_path: String,
    pub error: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileCatalog {
    pub projects: Vec<IndexedDefinition<ProjectDefinition>>,
    pub resources: Vec<IndexedDefinition<ResourceDefinition>>,
    pub plugins: Vec<IndexedPlugin>,
    pub automations: Vec<IndexedAutomation>,
    pub issues: Vec<DefinitionIssue>,
    pub repository_paths: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    ReadRepositories,
    WriteRepositories,
    Commit,
    Push,
    OpenPr,
    Network,
    WriteProjectFiles,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RepositoryDefinition {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProjectDefinition {
    #[serde(default)]
    pub archived: bool,
    pub schema: String,
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub repositories: Vec<RepositoryDefinition>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceDefinition {
    pub schema: String,
    pub id: String,
    #[serde(rename = "type")]
    pub type_id: String,
    pub type_version: u32,
    pub name: String,
    pub archived: bool,
    pub body: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PluginDefinition {
    pub schema: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub may: BTreeSet<Permission>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolDefinition {
    pub schema: String,
    pub id: String,
    pub name: String,
    pub program: String,
    pub entrypoint: String,
    pub args: Vec<String>,
    pub timeout_seconds: u64,
    pub input_schema: Value,
    pub output_schema: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "base", rename_all = "camelCase", deny_unknown_fields)]
pub enum DefinitionDirectory {
    Repository { id: String },
    Project { path: String },
    Plugin { path: String },
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Trigger {
    Manual,
    Interval {
        seconds: u64,
    },
    Calendar {
        timezone: String,
        days: Vec<u32>,
        times: Vec<String>,
    },
}
impl Trigger {
    pub fn next_after(&self, after_ms: i64) -> Result<Option<i64>, String> {
        match self {
            Self::Manual => Ok(None),
            Self::Interval { seconds } => {
                if !(60..=31_536_000).contains(seconds) {
                    return Err("trigger.seconds must be 60–31536000".into());
                }
                after_ms
                    .checked_add(*seconds as i64 * 1000)
                    .map(Some)
                    .ok_or("trigger time overflow".into())
            }
            Self::Calendar {
                timezone,
                days,
                times,
            } => {
                if days.is_empty()
                    || days.len() > 7
                    || days.iter().any(|d| !(1..=7).contains(d))
                    || days.iter().collect::<BTreeSet<_>>().len() != days.len()
                    || times.is_empty()
                    || times.len() > 24
                    || times.iter().collect::<BTreeSet<_>>().len() != times.len()
                {
                    return Err("trigger requires unique days 1–7 and 1–24 unique times".into());
                }
                let mut next = None;
                for day in days {
                    for time in times {
                        let value = CalendarSchedule {
                            time: time.clone(),
                            timezone: timezone.clone(),
                            weekday: Some(day - 1),
                        }
                        .next_after(after_ms)?;
                        next = Some(next.map_or(value, |current: i64| current.min(value)));
                    }
                }
                Ok(next)
            }
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DefinitionExecution {
    Tool {
        tool: String,
        input: Value,
    },
    Agent {
        provider: String,
        model: Option<String>,
        reasoning_level: Option<String>,
        instructions: String,
        skills: Vec<String>,
        resources: Vec<String>,
        repositories: Vec<String>,
        working_directory: DefinitionDirectory,
        timeout_seconds: u64,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Overlap {
    Skip,
    QueueOne,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AutomationDefinition {
    #[serde(default)]
    pub archived: bool,
    pub schema: String,
    pub id: String,
    pub name: String,
    pub trigger: Trigger,
    pub overlap: Overlap,
    pub execution: DefinitionExecution,
    pub may: BTreeSet<Permission>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SkillDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: Option<String>,
    pub instructions: String,
}

pub fn relative_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains(['\0', '\\', ':'])
        || path.starts_with('/')
        || path.split('/').any(|part| part == ".." || part.is_empty())
    {
        return Err("path must be relative without traversal".into());
    }
    Ok(())
}
fn identity(schema: &str, expected: &str, id: &str, name: &str) -> Result<(), String> {
    if schema != expected {
        return Err(format!("schema must be {expected}"));
    }
    uuid::Uuid::parse_str(id).map_err(|_| "id must be a UUID")?;
    bounded_text(name, 200, true)
}
pub trait Definition: serde::de::DeserializeOwned {
    fn validate(&self) -> Result<(), String>;
}
pub fn parse<T: Definition>(path: &str, bytes: &[u8]) -> Result<T, String> {
    if bytes.len() > MANIFEST_LIMIT {
        return Err(format!("{path}: exceeds 131072 bytes"));
    }
    let value: T = serde_json::from_slice(bytes).map_err(|e| format!("{path}: {e}"))?;
    value.validate().map_err(|e| format!("{path}: {e}"))?;
    Ok(value)
}
impl Definition for ProjectDefinition {
    fn validate(&self) -> Result<(), String> {
        identity(&self.schema, "inferay.project/1", &self.id, &self.name)?;
        bounded_text(&self.description, 8000, false)?;
        bounded_text(&self.instructions, 64000, false)?;
        if self.repositories.len() > 512 {
            return Err("repositories exceeds 512".into());
        }
        let mut ids = BTreeSet::new();
        for repo in &self.repositories {
            uuid::Uuid::parse_str(&repo.id).map_err(|_| "repository.id must be a UUID")?;
            bounded_text(&repo.name, 200, true)?;
            if !ids.insert(&repo.id) {
                return Err("duplicate repository.id".into());
            }
            if let Some(remote) = &repo.remote {
                bounded_text(remote, 2048, true)?;
            }
        }
        Ok(())
    }
}
impl Definition for PluginDefinition {
    fn validate(&self) -> Result<(), String> {
        identity(&self.schema, "inferay.plugin/1", &self.id, &self.name)?;
        bounded_text(&self.version, 100, true)?;
        bounded_text(&self.description, 8000, false)
    }
}
impl Definition for ToolDefinition {
    fn validate(&self) -> Result<(), String> {
        identity(&self.schema, "inferay.tool/1", &self.id, &self.name)?;
        bounded_text(&self.program, 1024, true)?;
        // The executable is resolved locally; host-specific absolute paths are not portable.
        relative_path(&self.program)?;
        relative_path(&self.entrypoint)?;
        if !(1..=3600).contains(&self.timeout_seconds) || self.args.len() > 64 {
            return Err("invalid tool timeout or argument count".into());
        }
        for arg in &self.args {
            bounded_text(arg, 8000, false)?;
        }
        validate_schema_definition(&self.input_schema, 0)?;
        validate_schema_definition(&self.output_schema, 0)
    }
}
pub fn builtin_resource_schema(kind: &str) -> Option<Value> {
    Some(match kind {
        "brand.brand" => {
            json!({"type":"object","properties":{"description":{"type":"string"},"voice":{"type":"string"},"parentBrandId":{"type":"string"}}})
        }
        "brand.mind" => {
            json!({"type":"object","required":["brandId"],"properties":{"brandId":{"type":"string"},"instructions":{"type":"string"},"knowledge":{"type":"array","maxItems":1000}}})
        }
        "brand.genome" => {
            json!({"type":"object","required":["brandId"],"properties":{"brandId":{"type":"string"},"colors":{"type":"array","items":{"type":"string"}},"typography":{"type":"array","items":{"type":"string"}},"rules":{"type":"array","items":{"type":"string"}}}})
        }
        _ => return None,
    })
}
impl Definition for ResourceDefinition {
    fn validate(&self) -> Result<(), String> {
        identity(&self.schema, "inferay.resource/1", &self.id, &self.name)?;
        if self.type_version == 0 || !self.body.is_object() {
            return Err("typeVersion must be positive and body must be an object".into());
        }
        relative_path(&self.type_id)?;
        if let Some(schema) = builtin_resource_schema(&self.type_id) {
            validate_json(&schema, &self.body)?;
        }
        Ok(())
    }
}
impl Definition for AutomationDefinition {
    fn validate(&self) -> Result<(), String> {
        identity(&self.schema, "inferay.automation/1", &self.id, &self.name)?;
        self.trigger.next_after(0)?;
        match &self.execution {
            DefinitionExecution::Tool { tool, input } => {
                relative_path(tool)?;
                if input.to_string().len() > 64000 {
                    return Err("execution.input exceeds 64 KB".into());
                }
            }
            DefinitionExecution::Agent {
                provider,
                instructions,
                skills,
                resources,
                repositories,
                working_directory,
                timeout_seconds,
                ..
            } => {
                if !["codex", "claude"].contains(&provider.as_str()) {
                    return Err("execution.provider must be codex or claude".into());
                }
                bounded_text(instructions, 64000, true)?;
                if !(1..=86400).contains(timeout_seconds)
                    || skills.len() > 20
                    || resources.len() > 32
                    || repositories.len() > 512
                {
                    return Err("execution limits exceeded".into());
                }
                match working_directory {
                    DefinitionDirectory::Repository { id } => {
                        uuid::Uuid::parse_str(id)
                            .map_err(|_| "workingDirectory.id must be a UUID")?;
                    }
                    DefinitionDirectory::Project { path }
                    | DefinitionDirectory::Plugin { path } => relative_path(path)?,
                }
            }
        }
        Ok(())
    }
}
/// References are resolved against a caller-supplied inventory, never the filesystem.
pub fn validate_references(
    automation: &AutomationDefinition,
    plugin: &PluginDefinition,
    skills: &BTreeSet<String>,
    tools: &BTreeSet<String>,
    resources: &BTreeSet<String>,
    repositories: &BTreeSet<String>,
) -> Result<(), String> {
    if !automation.may.is_subset(&plugin.may) {
        return Err("may exceeds plugin permissions".into());
    }
    let check = |kind: &str, id: &str, available: &BTreeSet<String>| {
        if available.contains(id) {
            Ok(())
        } else {
            Err(format!("unresolved {kind}: {id}"))
        }
    };
    match &automation.execution {
        DefinitionExecution::Tool { tool, .. } => check("tool", tool, tools)?,
        DefinitionExecution::Agent {
            skills: selected,
            resources: refs,
            repositories: repos,
            working_directory,
            ..
        } => {
            for id in selected {
                if let Some(global_id) = id.strip_prefix("global:") {
                    bounded_text(global_id, 200, true)
                        .map_err(|_| format!("invalid global skill reference: {id}"))?;
                } else {
                    uuid::Uuid::parse_str(id).map_err(|_| {
                        format!("skill reference must be a UUID or global:<id>: {id}")
                    })?;
                }
                check("skill", id, skills)?;
            }
            for id in refs {
                check("resource", id, resources)?;
            }
            for id in repos {
                check("repository", id, repositories)?;
            }
            if let DefinitionDirectory::Repository { id } = working_directory {
                check("repository", id, repositories)?;
            }
        }
    }
    Ok(())
}
pub fn parse_skill(path: &str, text: &str) -> Result<SkillDefinition, String> {
    if text.len() > MANIFEST_LIMIT {
        return Err(format!("{path}: skill exceeds 131072 bytes"));
    }
    let text = text.replace("\r\n", "\n");
    let (header, instructions) = text
        .strip_prefix("---\n")
        .and_then(|s| s.split_once("\n---\n"))
        .ok_or_else(|| format!("{path}: Markdown front matter required"))?;
    let mut fields = BTreeMap::new();
    for line in header.lines() {
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| format!("{path}: invalid front matter"))?;
        let value = value.trim();
        let value = if value.starts_with('"') {
            serde_json::from_str::<String>(value)
                .map_err(|e| format!("{path}: invalid quoted {key}: {e}"))?
        } else {
            value.to_owned()
        };
        if !["id", "name", "description", "command"].contains(&key)
            || fields.insert(key, value).is_some()
        {
            return Err(format!("{path}: unknown or duplicate field {key}"));
        }
    }
    let value = SkillDefinition {
        id: fields.remove("id").ok_or("skill.id required")?,
        name: fields.remove("name").ok_or("skill.name required")?,
        description: fields
            .remove("description")
            .ok_or("skill.description required")?,
        command: fields.remove("command"),
        instructions: instructions.into(),
    };
    uuid::Uuid::parse_str(&value.id).map_err(|_| format!("{path}: id must be a UUID"))?;
    bounded_text(&value.name, 200, true)?;
    bounded_text(&value.description, 8000, false)?;
    bounded_text(&value.instructions, 64000, true)?;
    if let Some(command) = &value.command {
        relative_path(command.trim_start_matches('/'))?;
    }
    Ok(value)
}
