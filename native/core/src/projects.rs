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
/// Invocation protocol for reusable local scripts. Neither mode invokes a shell.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ToolInterface {
    #[default]
    JsonStdin,
    Cli,
}
/// Resolved literals stay literal, including strings supplied by a tool caller.
/// Runtime paths are represented separately until the run directory exists.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum ToolArgument {
    Literal(String),
    Runtime { runtime: ToolRuntimeArgument },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ToolRuntimeArgument {
    Output { path: String },
}
impl ToolArgument {
    pub fn resolve(&self, output_directory: &str) -> String {
        match self {
            Self::Literal(value) => value.clone(),
            Self::Runtime {
                runtime: ToolRuntimeArgument::Output { path },
            } => {
                if path.is_empty() {
                    output_directory.into()
                } else {
                    format!("{output_directory}/{path}")
                }
            }
        }
    }
}
impl ToolInterface {
    pub fn validate_arguments(self, args: &[String]) -> Result<(), String> {
        if args.len() > 64 {
            return Err("Tool supports at most 64 arguments".into());
        }
        if self == Self::Cli
            && args
                .iter()
                .filter(|arg| arg.as_str() == "{entrypoint}")
                .count()
                != 1
        {
            return Err("CLI args must include exactly one {entrypoint} argument".into());
        }
        for arg in args {
            if self == Self::Cli && arg.contains("{entrypoint}") && arg != "{entrypoint}" {
                return Err("{entrypoint} must occupy an entire CLI argument".into());
            }
            if self == Self::Cli && arg.contains("{output}") {
                Self::output_path(arg)?;
            }
            bounded_text(arg, 8000, false)?;
            if self == Self::Cli && arg.contains("{input.") {
                Self::input_key(arg)?;
            }
        }
        Ok(())
    }
    fn output_path(arg: &str) -> Result<&str, String> {
        if arg == "{output}" {
            return Ok("");
        }
        let path = arg
            .strip_prefix("{output}/")
            .ok_or("CLI output arguments must be {output} or {output}/relative-path")?;
        crate::project_files::relative_path(path)?;
        if path.contains(['{', '}']) {
            return Err("Output paths cannot contain placeholders".into());
        }
        Ok(path)
    }
    fn input_key(arg: &str) -> Result<&str, String> {
        let key = arg
            .strip_prefix("{input.")
            .and_then(|v| v.strip_suffix('}'))
            .filter(|key| {
                !key.is_empty()
                    && key
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            });
        key.ok_or_else(|| {
            "CLI input placeholders must occupy an entire argument: {input.field}".into()
        })
    }
    pub fn arguments(
        self,
        args: &[String],
        input: &Value,
        entrypoint: &str,
    ) -> Result<Vec<ToolArgument>, String> {
        self.validate_arguments(args)?;
        if self == Self::JsonStdin {
            return Ok(std::iter::once(entrypoint.to_owned())
                .chain(args.iter().cloned())
                .map(ToolArgument::Literal)
                .collect());
        }
        args.iter()
            .map(|arg| {
                if arg == "{entrypoint}" {
                    return Ok(ToolArgument::Literal(entrypoint.to_owned()));
                }
                if arg.contains("{output}") {
                    return Ok(ToolArgument::Runtime {
                        runtime: ToolRuntimeArgument::Output {
                            path: Self::output_path(arg)?.into(),
                        },
                    });
                }
                if !arg.contains("{input.") {
                    return Ok(ToolArgument::Literal(arg.clone()));
                }
                let key = Self::input_key(arg)?;
                let value = match input.get(key) {
                    Some(Value::String(value)) => value.clone(),
                    Some(value @ (Value::Number(_) | Value::Bool(_))) => value.to_string(),
                    _ => {
                        return Err(format!(
                            "CLI input {key} must be a string, number or boolean"
                        ));
                    }
                };
                bounded_text(&value, 8000, false)?;
                Ok(ToolArgument::Literal(value))
            })
            .collect()
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalTool {
    #[serde(default)]
    pub interface: ToolInterface,
    pub program: String,
    pub entrypoint: ProjectPath,
    #[serde(default)]
    pub arguments: Vec<ToolArgument>,
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
    /// A finished agent run has a nonempty retained transcript available to open.
    #[serde(default)]
    pub conversation_available: bool,
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
/// Durable execution history, independent of definition storage.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHistory {
    pub runs: Vec<ProjectRun>,
    pub artifacts: Vec<ProjectArtifact>,
    pub has_more_runs: bool,
    pub next_run_cursor: Option<String>,
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

/// Read-only payload retained for automation cards in persisted older chats.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LegacyAutomationProposal {
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
        let zone: chrono_tz::Tz = self
            .timezone
            .parse()
            .map_err(|_| "Choose a valid IANA timezone")?;
        let time = chrono::NaiveTime::parse_from_str(&self.time, "%H:%M")
            .map_err(|_| "Time must be HH:MM")?;
        if self.time.len() != 5 || self.weekday.is_some_and(|d| d > 6) {
            return Err("Invalid calendar schedule".into());
        }
        let date = chrono::DateTime::from_timestamp_millis(after_ms)
            .ok_or("Invalid timestamp")?
            .with_timezone(&zone)
            .date_naive();
        for offset in 0..=8 {
            let day = date
                .checked_add_days(chrono::Days::new(offset))
                .ok_or("Invalid date")?;
            if self
                .weekday
                .is_some_and(|d| d != day.weekday().num_days_from_monday())
            {
                continue;
            }
            let local = day.and_time(time);
            for minute in 0..=180 {
                let candidate = local + chrono::Duration::minutes(minute);
                if let Some(instant) = zone.from_local_datetime(&candidate).earliest() {
                    if instant.timestamp_millis() > after_ms {
                        return Ok(instant.timestamp_millis());
                    }
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
    fn ms(value: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .timestamp_millis()
    }
    #[test]
    fn calendar_follows_local_time_across_dst_and_week_boundaries() {
        let mut schedule = CalendarSchedule {
            time: "09:00".into(),
            timezone: "America/Chicago".into(),
            weekday: None,
        };
        assert_eq!(
            schedule.next_after(ms("2026-03-07T15:00:00Z")).unwrap(),
            ms("2026-03-08T14:00:00Z")
        );
        schedule.weekday = Some(0);
        assert_eq!(
            schedule.next_after(ms("2026-03-07T15:00:00Z")).unwrap(),
            ms("2026-03-09T14:00:00Z")
        );
        schedule.weekday = None;
        schedule.time = "02:30".into();
        assert_eq!(
            schedule.next_after(ms("2026-03-08T06:00:00Z")).unwrap(),
            ms("2026-03-08T08:00:00Z")
        );
        schedule.time = "01:30".into();
        assert_eq!(
            schedule.next_after(ms("2026-11-01T06:30:00Z")).unwrap(),
            ms("2026-11-02T07:30:00Z")
        );
        schedule.time = "25:30".into();
        assert!(schedule.next_after(0).is_err());
    }
}
