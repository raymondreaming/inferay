use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

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
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum ToolInterface {
    #[default]
    JsonStdin,
    Cli,
    Mcp {
        tool: String,
    },
}
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
    pub fn validate_arguments(&self, args: &[String]) -> Result<(), String> {
        if let Self::Mcp { tool } = self
            && (tool.is_empty()
                || tool.len() > 128
                || !tool
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)))
        {
            return Err(
                "MCP tool name must contain 1–128 letters, digits, underscores, dots or hyphens"
                    .into(),
            );
        }
        if args.len() > 64 {
            return Err("Tool supports at most 64 arguments".into());
        }
        if self == &Self::Cli
            && args
                .iter()
                .filter(|arg| arg.as_str() == "{entrypoint}")
                .count()
                != 1
        {
            return Err("CLI args must include exactly one {entrypoint} argument".into());
        }
        for arg in args {
            if self == &Self::Cli && arg.contains("{entrypoint}") && arg != "{entrypoint}" {
                return Err("{entrypoint} must occupy an entire CLI argument".into());
            }
            if self == &Self::Cli && arg.contains("{output}") {
                Self::output_path(arg)?;
            }
            bounded_text(arg, 8000, false)?;
            if self == &Self::Cli && arg.contains("{input.") {
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
        &self,
        args: &[String],
        input: &Value,
        entrypoint: &str,
    ) -> Result<Vec<ToolArgument>, String> {
        self.validate_arguments(args)?;
        if !matches!(self, Self::Cli) {
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
pub struct RunUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub reported_cost_usd: Option<f64>,
}
impl RunUsage {
    pub fn from_provider(event: &Value) -> Option<Self> {
        let usage = &event["usage"];
        let (input_tokens, output_tokens, cached_input_tokens, cost) =
            match event["provider"].as_str()? {
                "codex" => (
                    usage.pointer("/total/inputTokens").and_then(Value::as_u64),
                    usage.pointer("/total/outputTokens").and_then(Value::as_u64),
                    usage
                        .pointer("/total/cachedInputTokens")
                        .and_then(Value::as_u64),
                    None,
                ),
                "claude" => (
                    usage["input_tokens"].as_u64().and_then(|input| {
                        input
                            .checked_add(
                                usage
                                    .get("cache_read_input_tokens")
                                    .map_or(Some(0), Value::as_u64)?,
                            )?
                            .checked_add(
                                usage
                                    .get("cache_creation_input_tokens")
                                    .map_or(Some(0), Value::as_u64)?,
                            )
                    }),
                    usage["output_tokens"].as_u64(),
                    usage["cache_read_input_tokens"].as_u64(),
                    event["reportedCostUsd"]
                        .as_f64()
                        .filter(|value| value.is_finite() && *value >= 0.0),
                ),
                _ => return None,
            };
        if input_tokens.is_none() && output_tokens.is_none() && cost.is_none() {
            return None;
        }
        Some(Self {
            input_tokens,
            output_tokens,
            cached_input_tokens,
            reported_cost_usd: cost,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRun {
    #[serde(default)]
    pub presentation: RunPresentation,
    #[serde(default)]
    pub usage: Option<RunUsage>,
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
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RunPresentation {
    pub status: String,
    pub active: bool,
    pub retry: bool,
    pub logs: Vec<[String; 2]>,
    pub summary: Option<String>,
}
impl ProjectRun {
    pub fn presentation(&self) -> RunPresentation {
        let kind = self.snapshot["execution"]["kind"].as_str().unwrap_or("");
        let mut logs = vec![[
            "Execution log".into(),
            if kind == "agent" {
                "logs/agent.jsonl"
            } else {
                "logs/stdout.txt"
            }
            .into(),
        ]];
        if kind == "tool" {
            logs.push(["Error log".into(), "logs/stderr.txt".into()]);
        }
        RunPresentation {
            status: if self.status == "succeeded" && kind == "agent" {
                "Agent finished".into()
            } else {
                self.status.replace('_', " ")
            },
            active: matches!(self.status.as_str(), "queued" | "running" | "waiting_input"),
            retry: matches!(
                self.status.as_str(),
                "failed" | "cancelled" | "interrupted" | "waiting_input"
            ),
            logs,
            summary: self
                .result
                .as_ref()
                .and_then(|r| r["message"].as_str())
                .map(str::to_owned),
        }
    }
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
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHistory {
    pub runs: Vec<ProjectRun>,
    pub artifacts: Vec<ProjectArtifact>,
    pub effects: Vec<ProjectEffectIntent>,
    pub has_more_runs: bool,
    pub next_run_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectIntent {
    pub schema: String,
    pub key: String,
    pub kind: String,
    pub target: String,
    pub payload: Value,
    pub not_before: Option<i64>,
}
impl EffectIntent {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema != "inferay.effect/1" {
            return Err("Unsupported effect intent schema".into());
        }
        for (label, value, limit) in [
            ("key", &self.key, 128),
            ("kind", &self.kind, 128),
            ("target", &self.target, 512),
        ] {
            if value.trim().is_empty() || value.len() > limit || value.chars().any(char::is_control)
            {
                return Err(format!(
                    "Effect {label} must be nonempty text under {limit} bytes without control characters"
                ));
            }
        }
        if !self.payload.is_object()
            || serde_json::to_vec(&self.payload)
                .map_err(|e| e.to_string())?
                .len()
                > 65_536
        {
            return Err("Effect payload must be an object under 64 KiB".into());
        }
        if self.not_before.is_some_and(|time| time < 0) {
            return Err(
                "Effect notBefore must be a nonnegative Unix timestamp in milliseconds".into(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEffectIntent {
    pub id: String,
    pub run_id: String,
    pub artifact: String,
    pub intent: EffectIntent,
    pub created_at: i64,
    pub intent_hash: String,
    pub dismissed_at: Option<i64>,
    #[serde(default)]
    pub delivery: Option<EffectDelivery>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum EffectDeliveryState {
    Queued,
    InFlight,
    Uncertain,
    Delivered,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectReceipt {
    pub delivery_id: String,
    pub intent_hash: String,
    pub destination_id: String,
    pub completed_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EffectDelivery {
    pub id: String,
    pub state: EffectDeliveryState,
    pub cancellation_requested_at: Option<i64>,
    pub receipt: Option<EffectReceipt>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EffectState {
    pub delivery: Option<EffectDelivery>,
    pub dismissed_at: Option<i64>,
}
#[derive(Serialize, TS)]
pub struct EffectPresentation {
    pub status: String,
    pub dismissible: bool,
    pub cancel: Option<String>,
}
impl EffectState {
    pub fn presentation(self) -> EffectPresentation {
        use EffectDeliveryState::*;
        let state = self.delivery.as_ref().map(|d| &d.state);
        let stopping = self
            .delivery
            .as_ref()
            .is_some_and(|d| d.cancellation_requested_at.is_some());
        let status = match state {
            Some(Queued) => "Queued · Not sent",
            Some(InFlight) => "In progress · Outcome pending",
            Some(Uncertain) if stopping => "Stop requested · Outcome unknown",
            Some(Uncertain) => "Outcome unknown · Needs reconciliation",
            Some(Delivered) => "Delivered",
            Some(Cancelled) => "Cancelled · Not sent",
            None if self.dismissed_at.is_none() => "Pending review · Not sent",
            None => "Dismissed · Not sent",
        }
        .into();
        EffectPresentation {
            status,
            dismissible: state.is_none() && self.dismissed_at.is_none(),
            cancel: if stopping {
                None
            } else {
                match state {
                    Some(Queued) => Some("Cancel delivery".into()),
                    Some(InFlight | Uncertain) => Some("Request stop".into()),
                    _ => None,
                }
            },
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EffectInboxPage {
    pub effects: Vec<ProjectEffectIntent>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectReviewRequest {
    pub id: String,
    pub intent_hash: String,
}
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
            "title" | "description" | "$schema" => {
                if !value.is_string() {
                    return Err("Schema description must be text".into());
                }
            }
            "default" | "examples" => {} // Annotations do not constrain accepted values.
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarSchedule {
    pub time: String,
    pub timezone: String,
    pub weekday: Option<u32>,
}
impl CalendarSchedule {
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
