//! Native interpretation of tool input; browser components only render the result.
use crate::mcp_presentation::McpToolSource;
use crate::{utf16_length as javascript_length, utf16_slice as javascript_slice};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize, PartialEq, ts_rs::TS)]
pub struct ToolDisplayInfo {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
    /// Present only for MCP calls, which the transcript brands by server.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<McpToolSource>,
    /// Path of the file the call works on, so the transcript can show its type.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file: Option<String>,
}
#[derive(Clone, Debug, Serialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutputSummary {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_name: Option<String>,
}
#[derive(Clone, Debug, Serialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AskUserQuestion {
    pub question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub options: Option<Vec<QuestionOption>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub multi_select: Option<bool>,
}
#[derive(Clone, Debug, Serialize, PartialEq, ts_rs::TS)]
pub struct QuestionOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}
/// An MCP server asking the user for something mid-turn, most often consent to
/// connect an account. Codex raises it as `mcpServer/elicitation/request`; the
/// turn cannot proceed until the user accepts or declines, so it needs a card
/// rather than a log line.
#[derive(Clone, Debug, Serialize, PartialEq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitation {
    /// What the server is asking, in its own words.
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub server: Option<String>,
    /// A link the user must visit to satisfy the request, when one is offered.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub url: Option<String>,
    /// Free-text the server expects back, rather than a plain accept.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prompt: Option<String>,
}

/// A URL is worth surfacing as an action only when it is one the user's browser
/// can actually open, so anything but http(s) stays text.
fn web_url(value: &Value, key: &str) -> Option<String> {
    let candidate = string(value, key)?;
    (candidate.starts_with("https://") || candidate.starts_with("http://")).then_some(candidate)
}

pub fn elicitation(input: &Value) -> Option<McpElicitation> {
    let message = string(input, "message")?;
    let schema = input.get("requestedSchema");
    // MCP puts the response shape in requestedSchema. A single string property
    // means the server wants text typed back; anything else is accept/decline.
    let prompt = schema
        .and_then(|schema| schema.get("properties"))
        .and_then(Value::as_object)
        .and_then(|properties| {
            let (name, definition) = properties.iter().next()?;
            (properties.len() == 1
                && definition.get("type") == Some(&Value::String("string".into())))
            .then(|| string(definition, "description").unwrap_or_else(|| name.clone()))
        });
    Some(McpElicitation {
        message,
        server: string(input, "server").or_else(|| string(input, "serverName")),
        url: web_url(input, "url").or_else(|| web_url(input, "authorizationUrl")),
        prompt,
    })
}

fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_owned)
}
fn filename(value: Option<&Value>) -> Option<String> {
    let path = value?.as_str()?;
    if path.is_empty() {
        return None;
    }
    Some(
        path.rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(path)
            .into(),
    )
}
fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}
fn truthy(value: &Value) -> bool {
    !matches!(value, Value::Null | Value::Bool(false))
        && value.as_str() != Some("")
        && value.as_f64() != Some(0.0)
}
fn first_files(value: &Value, changes: bool) -> Option<String> {
    let values = value.as_array().filter(|v| !v.is_empty())?;
    let first = if changes && !values[0].is_string() {
        values[0]
            .get("file_path")
            .or_else(|| values[0].get("path"))
            .or_else(|| values[0].get("file"))
    } else {
        Some(&values[0])
    };
    let Some(first) = filename(first) else {
        return changes.then(|| format!("{} changes", values.len()));
    };
    Some(if values.len() == 1 {
        first
    } else {
        format!("{first} +{}", values.len() - 1)
    })
}
pub fn questions(input: &Value) -> Option<Vec<AskUserQuestion>> {
    Some(
        input
            .get("questions")?
            .as_array()?
            .iter()
            .filter_map(|q| {
                Some(AskUserQuestion {
                    question: q.get("question")?.as_str()?.into(),
                    header: string(q, "header"),
                    options: q.get("options").and_then(Value::as_array).map(|options| {
                        options
                            .iter()
                            .filter_map(|o| {
                                Some(QuestionOption {
                                    label: o.get("label")?.as_str()?.into(),
                                    description: string(o, "description"),
                                })
                            })
                            .collect()
                    }),
                    multi_select: q.get("multiSelect").and_then(Value::as_bool),
                })
            })
            .collect(),
    )
}
pub fn summary(input: &Value) -> Option<ToolOutputSummary> {
    let make = |kind, value, file_name| {
        Some(ToolOutputSummary {
            kind,
            value,
            file_name,
        })
    };
    let file = filename(input.get("file_path"));
    if let (Some(file), Some(new)) = (&file, input.get("new_string").and_then(scalar)) {
        return make("edit", new, Some(file.clone()));
    }
    for (keys, kind) in [
        (&["command", "cmd"][..], "command"),
        (&["pattern"][..], "pattern"),
    ] {
        if let Some(value) = keys
            .iter()
            .find_map(|key| input.get(key).filter(|v| truthy(v)).and_then(scalar))
        {
            return make(kind, value, None);
        }
    }
    if let (Some(file), Some(content)) = (
        &file,
        input.get("content").filter(|v| truthy(v)).and_then(scalar),
    ) {
        let value = if javascript_length(&content) > 300 {
            format!("{}...", javascript_slice(&content, 0, 300))
        } else {
            content
        };
        return make("file-content", value, Some(file.clone()));
    }
    if let Some(file) = file.or_else(|| filename(input.get("path").or_else(|| input.get("file")))) {
        return make("accent", file, None);
    }
    for (key, changes) in [("files", false), ("changes", true)] {
        if let Some(value) = input.get(key).and_then(|v| first_files(v, changes)) {
            return make("accent", value, None);
        }
    }
    for (key, kind) in [
        ("glob", "accent"),
        ("include", "accent"),
        ("url", "url"),
        ("query", "accent"),
    ] {
        if let Some(value) = input.get(key).filter(|v| truthy(v)).and_then(scalar) {
            return make(kind, value, None);
        }
    }
    if let Some(tool) = input
        .get("invocation")
        .and_then(|v| v.get("tool"))
        .or_else(|| input.get("tool"))
        .filter(|v| truthy(v))
        .and_then(scalar)
    {
        return make("text", tool, None);
    }
    if let Some(skill) = input.get("skill").filter(|v| truthy(v)).and_then(scalar) {
        return make("text", format!("/{skill}"), None);
    }
    if let Some(prompt) = input.get("prompt").filter(|v| truthy(v)).and_then(scalar) {
        return make("text", prompt, None);
    }
    None
}
fn label(text: impl Into<String>) -> ToolDisplayInfo {
    ToolDisplayInfo {
        label: text.into(),
        detail: None,
        source: None,
        file: None,
    }
}
fn file_target(input: &Value) -> Option<String> {
    ["file_path", "filePath", "notebook_path", "path", "file"]
        .iter()
        .find_map(|key| input.get(key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|path| !path.is_empty() && !path.ends_with('/'))
        .map(str::to_owned)
}
fn words(command: &str) -> Vec<&str> {
    command
        .split(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | ';' | '|' | '&' | '(' | ')'))
        .filter(|s| !s.is_empty())
        .collect()
}
fn sequence(words: &[&str], expected: &[&str]) -> bool {
    words.windows(expected.len()).any(|part| part == expected)
}
fn target(command: &str) -> Option<String> {
    const EXTENSIONS: &[&str] = &[
        "ts", "tsx", "js", "jsx", "json", "md", "css", "scss", "py", "rs", "go", "java", "kt",
        "swift", "rb", "php", "sql", "yaml", "yml", "toml",
    ];
    words(command)
        .into_iter()
        .rev()
        .find(|word| {
            word.rsplit_once('.')
                .is_some_and(|(_, ext)| EXTENSIONS.contains(&ext))
        })
        .map(|word| word.rsplit('/').next().unwrap_or(word).into())
}
pub fn display(tool_name: Option<&str>, input: &Value) -> ToolDisplayInfo {
    // An MCP call names its own server, so it is branded before the generic
    // command and tool heuristics get a chance to describe it anonymously.
    if let Some((source, action)) = tool_name.and_then(crate::mcp_presentation::resolve) {
        return ToolDisplayInfo {
            label: action,
            detail: None,
            source: Some(source),
            file: None,
        };
    }
    let command = input
        .get("command")
        .or_else(|| input.get("cmd"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(command) = command {
        let lower = command.to_lowercase();
        let tokens = words(&lower);
        let has = |word| tokens.contains(&word);
        let seq = |pattern: &[&str]| sequence(&tokens, pattern);
        let package = |action: &str| {
            ["npm", "bun", "pnpm", "yarn"]
                .iter()
                .any(|manager| seq(&[manager, action]) || seq(&[manager, "run", action]))
        };
        let js_test = package("test") || package("vitest") || has("vitest");
        let typecheck = ["tsc", "typecheck", "type-check", "mypy", "pyright"]
            .iter()
            .any(|w| has(w));
        let lint = ["eslint", "ruff", "clippy", "golangci-lint"]
            .iter()
            .any(|w| has(w))
            || seq(&["biome", "check"])
            || seq(&["biome", "lint"])
            || seq(&["npm", "run", "lint"]);
        let build = package("build") || seq(&["cargo", "build"]) || seq(&["go", "build"]);
        if [
            js_test || has("jest") || has("pytest"),
            typecheck,
            lint,
            build,
        ]
        .iter()
        .filter(|v| **v)
        .count()
            > 1
        {
            return label("Running verification checks");
        }
        let presentation = match () {
            _ if js_test => ("Running JavaScript tests", "Testing {}"),
            _ if has("pytest")
                || ["python", "python3"]
                    .iter()
                    .any(|p| seq(&[p, "-m", "pytest"]) || seq(&[p, "-m", "unittest"])) =>
            {
                ("Running Python tests", "Testing {}")
            }
            _ if seq(&["cargo", "test"]) => ("Running Rust tests", ""),
            _ if seq(&["go", "test"]) => ("Running Go tests", ""),
            _ if ["tsc", "typecheck", "type-check"].iter().any(|w| has(w)) => {
                ("Type-checking project", "")
            }
            _ if has("mypy") || has("pyright") => ("Checking Python types", ""),
            _ if has("eslint") || seq(&["npm", "run", "lint"]) => ("Linting project", "Linting {}"),
            _ if seq(&["biome", "check"]) || seq(&["biome", "lint"]) => ("Checking code style", ""),
            _ if ["ruff", "pylint", "flake8"].iter().any(|w| has(w)) => ("Linting Python code", ""),
            _ if seq(&["cargo", "clippy"]) || has("golangci-lint") => ("Analyzing code", ""),
            _ if package("build") => ("Building application", ""),
            _ if seq(&["cargo", "build"]) || seq(&["cargo", "check"]) => {
                ("Checking Rust project", "")
            }
            _ if seq(&["go", "build"]) => ("Building Go project", ""),
            _ if has("prettier") || seq(&["biome", "format"]) => ("Formatting code", ""),
            _ if seq(&["git", "status"]) => ("Checking working tree", ""),
            _ if seq(&["git", "log"]) => (
                if has("-1") || seq(&["-n", "1"]) {
                    "Reading latest commit"
                } else {
                    "Reading commit history"
                },
                "",
            ),
            _ if seq(&["git", "diff"]) => {
                if has("--cached") || has("--staged") {
                    ("Reviewing staged changes", "Reviewing staged {}")
                } else {
                    ("Reviewing working changes", "Reviewing changes in {}")
                }
            }
            _ if seq(&["git", "show"]) => ("Inspecting commit", "Reading committed {}"),
            _ if seq(&["git", "branch"]) || seq(&["git", "rev-parse"]) => {
                ("Identifying current revision", "")
            }
            _ if seq(&["git", "blame"]) => ("Tracing line history", "Tracing {} history"),
            _ if seq(&["git", "fetch"]) || seq(&["git", "pull"]) => {
                ("Refreshing remote changes", "")
            }
            _ if seq(&["git", "push"]) => ("Publishing commits", ""),
            _ if seq(&["git", "checkout"]) || seq(&["git", "switch"]) => ("Switching branch", ""),
            _ if seq(&["git", "add"]) || seq(&["git", "commit"]) => (
                if has("commit") {
                    "Saving changes"
                } else {
                    "Staging changes"
                },
                "",
            ),
            _ if has("rg") || has("grep") => ("Searching source code", "Searching {}"),
            _ if has("find") => ("Discovering files", ""),
            _ if ["sed", "cat", "head", "tail", "less"]
                .iter()
                .any(|w| has(w)) =>
            {
                ("Reading source excerpt", "Reading {}")
            }
            _ if has("ls") || has("tree") => ("Listing project files", ""),
            _ if has("pwd") => ("Checking current location", ""),
            _ if package("install") || package("add") => ("Installing dependencies", ""),
            _ if ["docker", "docker-compose"]
                .iter()
                .any(|c| seq(&[c, "build"]) || seq(&[c, "compose", "build"])) =>
            {
                ("Building containers", "")
            }
            _ if ["docker", "docker-compose"].iter().any(|c| {
                ["run", "up"].iter().any(|a| seq(&[c, a])) || seq(&[c, "compose", "up"])
            }) =>
            {
                ("Starting containers", "")
            }
            _ if ["prisma", "drizzle", "rails", "alembic"]
                .iter()
                .any(|w| has(w))
                && (has("migrate") || has("migration")) =>
            {
                ("Applying database migration", "")
            }
            _ if has("mkdir") || has("touch") => ("Creating files", ""),
            _ if has("cp") => ("Copying files", ""),
            _ if has("mv") => ("Moving files", ""),
            _ if has("rm") => ("Removing files", ""),
            _ if has("ps") || has("lsof") => ("Inspecting running processes", ""),
            _ if has("kill") || has("pkill") => ("Stopping process", ""),
            _ if has("curl") || has("wget") => ("Fetching data", ""),
            _ => ("", ""),
        };
        let (fallback, template) = presentation;
        if !fallback.is_empty() {
            let named = target(command).filter(|_| !template.is_empty());
            return ToolDisplayInfo {
                label: named
                    .as_deref()
                    .map_or_else(|| fallback.into(), |file| template.replace("{}", file)),
                detail: None,
                source: None,
                file: named,
            };
        }
        let detail = ["/bin/zsh -lc ", "/bin/bash -lc ", "/bin/sh -lc "]
            .iter()
            .find_map(|prefix| command.strip_prefix(prefix))
            .unwrap_or(command)
            .trim_matches(['\'', '"'])
            .trim();
        return ToolDisplayInfo {
            label: "Running command".into(),
            detail: Some(if detail.is_empty() { "command" } else { detail }.into()),
            source: None,
            file: None,
        };
    }
    let name = tool_name.unwrap_or_default().trim().to_lowercase();
    let file = match name.as_str() {
        "read" | "read_file" | "view" | "patch" | "apply_patch" | "edit" | "multiedit" | "write"
        | "notebookedit" | "notebook_edit" => file_target(input),
        _ => None,
    };
    ToolDisplayInfo {
        label: match name.as_str() {
            "read" | "read_file" | "view" => {
                if file.is_some() {
                    "Reading file".into()
                } else {
                    "Reading files".into()
                }
            }
            "grep" | "glob" | "search" => "Searching code".into(),
            "web_search" | "websearch" | "webfetch" => "Researching".into(),
            "patch" | "apply_patch" | "edit" | "multiedit" | "write" => "Updating code".into(),
            _ => tool_name
                .filter(|s| !s.is_empty())
                .map_or_else(|| "Running tool".into(), |name| format!("Using {name}")),
        },
        detail: file.as_deref().map(basename).map(str::to_owned),
        source: None,
        file,
    }
}
fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

#[cfg(test)]
mod tool_display_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn file_tools_name_their_file_so_the_transcript_can_show_its_type() {
        let read = display(Some("Read"), &json!({"file_path": "/repo/src/App.tsx"}));
        assert_eq!(read.label, "Reading file");
        assert_eq!(read.file.as_deref(), Some("/repo/src/App.tsx"));
        assert_eq!(read.detail.as_deref(), Some("App.tsx"));
        let write = display(Some("Write"), &json!({"file_path": "notes.md"}));
        assert_eq!(write.file.as_deref(), Some("notes.md"));
    }

    #[test]
    fn searches_and_commands_carry_no_file_icon() {
        let glob = display(Some("Glob"), &json!({"path": "src/modules", "pattern": "*.ts"}));
        assert_eq!(glob.label, "Searching code");
        assert_eq!(glob.file, None);
        assert_eq!(glob.detail, None);
        let read_without_path = display(Some("Read"), &json!({}));
        assert_eq!(read_without_path.label, "Reading files");
        assert_eq!(read_without_path.file, None);
        assert_eq!(display(None, &json!({"command": "ls"})).file, None);
    }

    #[test]
    fn commands_that_name_a_file_show_its_type() {
        let read = display(
            None,
            &json!({"command": "sed -n '1,40p' src/state/executionStatus.ts"}),
        );
        assert_eq!(read.label, "Reading executionStatus.ts");
        assert_eq!(read.file.as_deref(), Some("executionStatus.ts"));
        let search = display(None, &json!({"command": "rg --include '*.rs' handler"}));
        assert_eq!(search.label, "Searching *.rs");
        assert_eq!(search.file.as_deref(), Some("*.rs"));
    }
}
