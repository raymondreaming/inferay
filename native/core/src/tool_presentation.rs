//! Native interpretation of tool input; browser components only render the result.
use crate::chat_protocol::{javascript_length, javascript_slice};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize, PartialEq)]
pub struct ToolDisplayInfo {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutputSummary {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AskUserQuestion {
    pub question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<QuestionOption>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multi_select: Option<bool>,
}
#[derive(Debug, Serialize, PartialEq)]
pub struct QuestionOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
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
    }
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
        let file = target(command);
        let with_target = |prefix: &str, fallback: &str| {
            label(
                file.as_ref()
                    .map_or_else(|| fallback.into(), |file| format!("{prefix}{file}")),
            )
        };
        if js_test {
            return with_target("Testing ", "Running JavaScript tests");
        }
        if has("pytest")
            || ["python", "python3"]
                .iter()
                .any(|p| seq(&[p, "-m", "pytest"]) || seq(&[p, "-m", "unittest"]))
        {
            return with_target("Testing ", "Running Python tests");
        }
        if seq(&["cargo", "test"]) {
            return label("Running Rust tests");
        }
        if seq(&["go", "test"]) {
            return label("Running Go tests");
        }
        if ["tsc", "typecheck", "type-check"].iter().any(|w| has(w)) {
            return label("Type-checking project");
        }
        if has("mypy") || has("pyright") {
            return label("Checking Python types");
        }
        if has("eslint") || seq(&["npm", "run", "lint"]) {
            return with_target("Linting ", "Linting project");
        }
        if seq(&["biome", "check"]) || seq(&["biome", "lint"]) {
            return label("Checking code style");
        }
        if ["ruff", "pylint", "flake8"].iter().any(|w| has(w)) {
            return label("Linting Python code");
        }
        if seq(&["cargo", "clippy"]) || has("golangci-lint") {
            return label("Analyzing code");
        }
        if package("build") {
            return label("Building application");
        }
        if seq(&["cargo", "build"]) || seq(&["cargo", "check"]) {
            return label("Checking Rust project");
        }
        if seq(&["go", "build"]) {
            return label("Building Go project");
        }
        if has("prettier") || seq(&["biome", "format"]) {
            return label("Formatting code");
        }
        if seq(&["git", "status"]) {
            return label("Checking working tree");
        }
        if seq(&["git", "log"]) {
            return label(if has("-1") || seq(&["-n", "1"]) {
                "Reading latest commit"
            } else {
                "Reading commit history"
            });
        }
        if seq(&["git", "diff"]) {
            return if has("--cached") || has("--staged") {
                with_target("Reviewing staged ", "Reviewing staged changes")
            } else {
                with_target("Reviewing changes in ", "Reviewing working changes")
            };
        }
        if seq(&["git", "show"]) {
            return with_target("Reading committed ", "Inspecting commit");
        }
        if seq(&["git", "branch"]) || seq(&["git", "rev-parse"]) {
            return label("Identifying current revision");
        }
        if seq(&["git", "blame"]) {
            return label(file.as_ref().map_or_else(
                || "Tracing line history".into(),
                |f| format!("Tracing {f} history"),
            ));
        }
        for (commands, text) in [
            (&["fetch", "pull"][..], "Refreshing remote changes"),
            (&["push"][..], "Publishing commits"),
            (&["checkout", "switch"][..], "Switching branch"),
        ] {
            if commands.iter().any(|c| seq(&["git", c])) {
                return label(text);
            }
        }
        if seq(&["git", "add"]) || seq(&["git", "commit"]) {
            return label(if has("commit") {
                "Saving changes"
            } else {
                "Staging changes"
            });
        }
        if has("rg") || has("grep") {
            return with_target("Searching ", "Searching source code");
        }
        if has("find") {
            return label("Discovering files");
        }
        if ["sed", "cat", "head", "tail", "less"]
            .iter()
            .any(|w| has(w))
        {
            return with_target("Reading ", "Reading source excerpt");
        }
        if has("ls") || has("tree") {
            return label("Listing project files");
        }
        if has("pwd") {
            return label("Checking current location");
        }
        if package("install") || package("add") {
            return label("Installing dependencies");
        }
        if ["docker", "docker-compose"]
            .iter()
            .any(|c| seq(&[c, "build"]) || seq(&[c, "compose", "build"]))
        {
            return label("Building containers");
        }
        if ["docker", "docker-compose"]
            .iter()
            .any(|c| ["run", "up"].iter().any(|a| seq(&[c, a])) || seq(&[c, "compose", "up"]))
        {
            return label("Starting containers");
        }
        if ["prisma", "drizzle", "rails", "alembic"]
            .iter()
            .any(|w| has(w))
            && (has("migrate") || has("migration"))
        {
            return label("Applying database migration");
        }
        for (commands, text) in [
            (&["mkdir", "touch"][..], "Creating files"),
            (&["cp"][..], "Copying files"),
            (&["mv"][..], "Moving files"),
            (&["rm"][..], "Removing files"),
            (&["ps", "lsof"][..], "Inspecting running processes"),
            (&["kill", "pkill"][..], "Stopping process"),
            (&["curl", "wget"][..], "Fetching data"),
        ] {
            if commands.iter().any(|w| has(w)) {
                return label(text);
            }
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
        };
    }
    label(
        match tool_name.unwrap_or_default().trim().to_lowercase().as_str() {
            "read" | "read_file" | "view" => "Reading files".into(),
            "grep" | "glob" | "search" => "Searching code".into(),
            "web_search" | "websearch" | "webfetch" => "Researching".into(),
            "patch" | "apply_patch" | "edit" | "write" => "Updating code".into(),
            _ => tool_name
                .filter(|s| !s.is_empty())
                .map_or_else(|| "Running tool".into(), |name| format!("Using {name}")),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn classifies_commands_and_targets() {
        for (command, expected) in [
            ("/bin/zsh -lc 'git status --short'", "Checking working tree"),
            (
                "git diff --cached -- src/app/actions.ts",
                "Reviewing staged actions.ts",
            ),
            ("npx tsc --noEmit", "Type-checking project"),
            (
                "npm test && npm run lint && npm run build",
                "Running verification checks",
            ),
            (
                "cargo test --workspace --all-targets --all-features --locked",
                "Running Rust tests",
            ),
            ("pytest tests/main.py", "Testing main.py"),
            ("git blame src/app.ts", "Tracing app.ts history"),
            ("bun run build", "Building application"),
            ("git log -n 1", "Reading latest commit"),
            ("docker compose up", "Starting containers"),
        ] {
            assert_eq!(
                display(Some("exec"), &json!({"cmd":command})).label,
                expected,
                "{command}"
            );
        }
        assert_eq!(
            display(
                Some("exec"),
                &json!({"cmd":"/bin/bash -lc 'custom --flag'"})
            )
            .detail
            .as_deref(),
            Some("custom --flag")
        );
        assert_eq!(display(Some("Read"), &Value::Null).label, "Reading files");
    }
    #[test]
    fn summaries_and_question_fields_are_validated() {
        assert_eq!(
            serde_json::to_value(summary(&json!({"command":"bun test"}))).unwrap(),
            json!({"type":"command","value":"bun test"})
        );
        assert_eq!(
            summary(&json!({"changes":[{"path":"a.rs"},{"path":"b.rs"}]}))
                .unwrap()
                .value,
            "a.rs +1"
        );
        let content = "😀".repeat(151);
        assert_eq!(
            summary(&json!({"file_path":"a.txt","content":content}))
                .unwrap()
                .value,
            format!("{}...", "😀".repeat(150))
        );
        assert!(summary(&Value::Null).is_none());
        assert!(summary(&json!({"unknown":"raw"})).is_none());
        let value = questions(&json!({"questions":[null,{"question":3},{"question":"Choose","header":false,"multiSelect":"yes","options":[null,{"label":4},{"label":"A","description":5},{"label":"B","description":"Valid"}]}]})).unwrap();
        assert_eq!(
            serde_json::to_value(value).unwrap(),
            json!([{"question":"Choose","options":[{"label":"A"},{"label":"B","description":"Valid"}]}])
        );
        assert!(questions(&json!({"questions":{}})).is_none());
    }
}
