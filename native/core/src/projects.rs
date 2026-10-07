//! Durable project vocabulary. Storage, clocks and processes belong to the server.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub revision: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived: bool,
    pub directory: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectResource {
    pub id: String,
    pub project_id: String,
    pub type_id: String,
    pub name: String,
    pub revision: i64,
    pub schema_version: i64,
    pub body: Value,
    pub archived: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "base", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProjectPath {
    Project { path: String },
    External { path: String },
}
impl Default for ProjectPath {
    fn default() -> Self {
        Self::Project { path: ".".into() }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalTool {
    pub program: String,
    pub entrypoint: ProjectPath,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub working_directory: ProjectPath,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub output_schema: Value,
}
fn default_timeout() -> u64 {
    300
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProjectExecution {
    Tool {
        tool_id: String,
        input: Value,
    },
    Agent {
        instructions: String,
        provider: String,
        model: Option<String>,
        #[serde(default)]
        reasoning_level: Option<String>,
        #[serde(default)]
        skill_ids: Vec<String>,
        #[serde(default)]
        resource_ids: Vec<String>,
        #[serde(default)]
        working_directory: ProjectPath,
        #[serde(default = "default_timeout")]
        timeout_seconds: u64,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAutomation {
    #[serde(default)]
    pub inputs_changed: bool,
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub revision: i64,
    pub execution: ProjectExecution,
    pub interval_seconds: Option<i64>,
    #[serde(default)]
    pub calendar: Option<CalendarSchedule>,
    pub enabled: bool,
    pub next_due_at: Option<i64>,
    pub overlap_policy: String,
    pub archived: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRun {
    pub id: String,
    pub project_id: String,
    pub automation_id: String,
    pub name: String,
    pub status: String,
    pub requested_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub snapshot: Value,
    pub directory: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArtifact {
    pub id: String,
    pub run_id: String,
    pub name: String,
    pub path: String,
    pub byte_size: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPlugin {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub directory: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectResourceType {
    pub id: String,
    pub version: i64,
    pub schema: Value,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalog {
    pub projects: Vec<Project>,
    pub resources: Vec<ProjectResource>,
    pub automations: Vec<ProjectAutomation>,
    pub runs: Vec<ProjectRun>,
    pub artifacts: Vec<ProjectArtifact>,
    pub plugins: Vec<ProjectPlugin>,
    pub resource_types: Vec<ProjectResourceType>,
    pub has_more_runs: bool,
    pub next_run_cursor: Option<String>,
    pub root: String,
    pub conversation_projects: std::collections::BTreeMap<String, String>,
    pub repository_paths: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProjectCommand {
    SaveProject {
        id: Option<String>,
        expected_revision: Option<i64>,
        name: String,
        description: String,
        instructions: String,
        #[serde(default)]
        repository_paths: Option<Vec<String>>,
    },
    ArchiveProject {
        id: String,
        expected_revision: i64,
    },
    SaveResource {
        id: Option<String>,
        project_id: String,
        expected_revision: Option<i64>,
        type_id: String,
        name: String,
        body: Value,
        #[serde(default = "schema_one")]
        schema_version: i64,
    },
    ArchiveResource {
        id: String,
        expected_revision: i64,
    },
    WriteFile {
        project_id: String,
        path: String,
        content: String,
        expected_content: Option<String>,
    },
    SaveAutomation {
        id: Option<String>,
        project_id: String,
        expected_revision: Option<i64>,
        name: String,
        execution: ProjectExecution,
        interval_seconds: Option<i64>,
        #[serde(default)]
        calendar: Option<CalendarSchedule>,
        overlap_policy: String,
    },
    EnableAutomation {
        id: String,
        expected_revision: i64,
        enabled: bool,
    },
    ArchiveAutomation {
        id: String,
        expected_revision: i64,
    },
    RunAutomation {
        id: String,
        request_id: String,
    },
    StopRun {
        id: String,
    },
    RetryRun {
        id: String,
        request_id: String,
    },
    InstallPlugin {
        project_id: String,
        path: String,
    },
    EnablePlugin {
        id: String,
        enabled: bool,
    },
    AssociateConversation {
        project_id: String,
        pane_id: String,
    },
    CreateExample {
        project_id: String,
    },
}
fn schema_one() -> i64 {
    1
}

pub fn bounded_text(value: &str, max: usize, required: bool) -> Result<(), String> {
    if value.contains('\0') || value.len() > max || (required && value.trim().is_empty()) {
        Err(format!(
            "Text must {}fit within {max} bytes and contain no NUL",
            if required { "be nonempty, " } else { "" }
        ))
    } else {
        Ok(())
    }
}
pub fn validate_execution(execution: &ProjectExecution) -> Result<(), String> {
    match execution {
        ProjectExecution::Tool { tool_id, input } => {
            bounded_text(tool_id, 200, true)?;
            if input.to_string().len() > 64_000 {
                return Err("Tool input exceeds 64 KB".into());
            }
        }
        ProjectExecution::Agent {
            instructions,
            provider,
            skill_ids,
            resource_ids,
            timeout_seconds,
            ..
        } => {
            bounded_text(instructions, 64_000, true)?;
            if !["claude", "codex"].contains(&provider.as_str()) {
                return Err("Choose Claude or Codex".into());
            }
            if skill_ids.len() > 20 || resource_ids.len() > 32 {
                return Err("Too many context resources".into());
            }
            if !(1..=86_400).contains(timeout_seconds) {
                return Err("Agent timeout must be 1–86400 seconds (up to 24 hours)".into());
            }
        }
    }
    Ok(())
}

/// Deliberately small, offline JSON Schema subset. Unsupported keywords are rejected at registration.
/// No remote refs, executable validators or implicit network access.
pub fn validate_schema_definition(schema: &Value, depth: usize) -> Result<(), String> {
    if schema.is_null() || schema.is_boolean() {
        return Ok(());
    }
    if depth > 16 {
        return Err("Schema nesting exceeds 16".into());
    }
    let object = schema
        .as_object()
        .ok_or("Schema must be an object or boolean")?;
    for (key, value) in object {
        match key.as_str() {
            "type" => {
                if ![
                    "object", "array", "string", "number", "integer", "boolean", "null",
                ]
                .contains(&value.as_str().unwrap_or(""))
                {
                    return Err("Unsupported schema type".into());
                }
            }
            "properties" => {
                for child in value
                    .as_object()
                    .ok_or("properties must be an object")?
                    .values()
                {
                    validate_schema_definition(child, depth + 1)?;
                }
            }
            "items" => validate_schema_definition(value, depth + 1)?,
            "required" => {
                if !value
                    .as_array()
                    .is_some_and(|a| a.iter().all(Value::is_string))
                {
                    return Err("required must be an array of strings".into());
                }
            }
            "additionalProperties" => {
                if !value.is_boolean() {
                    return Err("additionalProperties must be boolean".into());
                }
            }
            "enum" => {
                if value.as_array().is_none_or(|a| a.is_empty()) {
                    return Err("enum must be nonempty".into());
                }
            }
            "minimum" | "maximum" => {
                if !value.is_number() {
                    return Err("Numeric schema bound required".into());
                }
            }
            "maxLength" | "maxItems" => {
                if value.as_u64().is_none() {
                    return Err("Unsigned schema bound required".into());
                }
            }
            "title" | "description" => {
                if !value.is_string() {
                    return Err("Schema description must be text".into());
                }
            }
            _ => return Err(format!("Unsupported schema keyword: {key}")),
        }
    }
    Ok(())
}
pub fn validate_json(schema: &Value, value: &Value) -> Result<(), String> {
    validate_schema_definition(schema, 0)?;
    validate_json_at(schema, value, "$", 0)
}
fn validate_json_at(schema: &Value, value: &Value, path: &str, depth: usize) -> Result<(), String> {
    if depth > 32 {
        return Err("JSON nesting exceeds 32".into());
    }
    if schema == &Value::Bool(false) {
        return Err(format!("{path}: value is not allowed"));
    }
    let valid = match schema["type"].as_str() {
        Some("object") => value.is_object(),
        Some("array") => value.is_array(),
        Some("string") => value.is_string(),
        Some("number") => value.is_number(),
        Some("integer") => value.as_i64().is_some() || value.as_u64().is_some(),
        Some("boolean") => value.is_boolean(),
        Some("null") => value.is_null(),
        _ => true,
    };
    if !valid {
        return Err(format!("{path}: expected {}", schema["type"]));
    }
    if let Some(options) = schema["enum"].as_array()
        && !options.contains(value)
    {
        return Err(format!("{path}: not in enum"));
    }
    if let Some(object) = value.as_object() {
        if let Some(required) = schema["required"].as_array() {
            for key in required {
                if !object.contains_key(key.as_str().unwrap_or("")) {
                    return Err(format!("{path}: missing {key}"));
                }
            }
        }
        for (key, value) in object {
            if let Some(child) = schema["properties"].get(key) {
                validate_json_at(child, value, &format!("{path}.{key}"), depth + 1)?;
            } else if schema["additionalProperties"] == false {
                return Err(format!("{path}: unknown field {key}"));
            }
        }
    }
    if let Some(items) = value.as_array() {
        if schema["maxItems"]
            .as_u64()
            .is_some_and(|n| items.len() as u64 > n)
        {
            return Err(format!("{path}: too many items"));
        }
        if let Some(item_schema) = schema.get("items") {
            for item in items {
                validate_json_at(item_schema, item, path, depth + 1)?;
            }
        }
    }
    if let Some(text) = value.as_str()
        && schema["maxLength"]
            .as_u64()
            .is_some_and(|n| text.chars().count() as u64 > n)
    {
        return Err(format!("{path}: text too long"));
    }
    if let Some(number) = value.as_f64()
        && (schema["minimum"].as_f64().is_some_and(|n| number < n)
            || schema["maximum"].as_f64().is_some_and(|n| number > n))
    {
        return Err(format!("{path}: outside numeric bounds"));
    }
    Ok(())
}


/// Wall-clock recurrence; weekday is Monday=0 through Sunday=6, or daily when absent.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarSchedule {
    pub time: String,
    pub timezone: String,
    pub weekday: Option<u32>,
}
impl CalendarSchedule {
    /// Spring gaps run at the first valid minute after the requested time.
    /// Fall overlaps run once, at the earlier occurrence.
    pub fn next_after(&self, after_ms: i64) -> Result<i64, String> {
        use chrono::{Datelike, TimeZone};
        let zone: chrono_tz::Tz = self.timezone.parse().map_err(|_| "Choose a valid IANA timezone")?;
        let time = chrono::NaiveTime::parse_from_str(&self.time, "%H:%M").map_err(|_| "Time must be HH:MM")?;
        if self.time.len() != 5 || self.weekday.is_some_and(|d| d > 6) { return Err("Invalid calendar schedule".into()); }
        let date = chrono::DateTime::from_timestamp_millis(after_ms).ok_or("Invalid timestamp")?.with_timezone(&zone).date_naive();
        for offset in 0..=8 {
            let day = date.checked_add_days(chrono::Days::new(offset)).ok_or("Invalid date")?;
            if self.weekday.is_some_and(|d| d != day.weekday().num_days_from_monday()) { continue; }
            let local = day.and_time(time);
            for minute in 0..=180 {
                let candidate = local + chrono::Duration::minutes(minute);
                if let Some(instant) = zone.from_local_datetime(&candidate).earliest() {
                    if instant.timestamp_millis() > after_ms { return Ok(instant.timestamp_millis()); }
                    break;
                }
            }
        }
        Err("Could not resolve the next scheduled time".into())
    }
}

#[cfg(test)]
mod calendar_tests {
    use super::*;
    fn ms(value: &str) -> i64 { chrono::DateTime::parse_from_rfc3339(value).unwrap().timestamp_millis() }
    #[test]
    fn calendar_follows_local_time_across_dst_and_week_boundaries() {
        let mut schedule = CalendarSchedule { time:"09:00".into(),timezone:"America/Chicago".into(),weekday:None };
        assert_eq!(schedule.next_after(ms("2026-03-07T15:00:00Z")).unwrap(),ms("2026-03-08T14:00:00Z"));
        schedule.weekday=Some(0);
        assert_eq!(schedule.next_after(ms("2026-03-07T15:00:00Z")).unwrap(),ms("2026-03-09T14:00:00Z"));
        schedule.weekday=None; schedule.time="02:30".into();
        assert_eq!(schedule.next_after(ms("2026-03-08T06:00:00Z")).unwrap(),ms("2026-03-08T08:00:00Z"));
        schedule.time="01:30".into();
        assert_eq!(schedule.next_after(ms("2026-11-01T06:30:00Z")).unwrap(),ms("2026-11-02T07:30:00Z"));
        schedule.time="25:30".into(); assert!(schedule.next_after(0).is_err());
    }
}
