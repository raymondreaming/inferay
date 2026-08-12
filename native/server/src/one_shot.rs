use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use super::{
    ServerState,
    automation_service::{RunAutomationError, extract_one_shot_output},
    json_response, request_json, safe_cwd,
};
use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use inferay_core::agent_command::AgentKind;
use inferay_core::agent_protocol::build_claude_invocation_args;
use serde_json::{Value, json};
use tokio::process::Command;

const CLAUDE_HAIKU_MODEL: &str = "claude-haiku-4-5";
const GIT_MAX_BUFFER: usize = 512 * 1024;

pub(super) fn is_route(state: &ServerState, path: &str, method: &Method) -> bool {
    matches!(
        (path, method),
        ("/api/generate-title", &Method::POST)
            | ("/api/git/generate-commit-message", &Method::POST)
    ) || (state.automation_routes_enabled
        && matches!(
            (path, method),
            ("/api/automations", &Method::GET)
                | ("/api/automations", &Method::PUT)
                | ("/api/automations/run", &Method::POST)
        ))
}

pub(super) async fn handle_request(state: &ServerState, path: &str, request: Request) -> Response {
    let headers = request.headers().clone();
    match (path, request.method()) {
        ("/api/generate-title", &Method::POST) => generate_title_route(state, request).await,
        ("/api/git/generate-commit-message", &Method::POST) => {
            generate_commit_message_route(state, request).await
        }
        ("/api/automations", &Method::GET) => match state.automation_service.load().await {
            Ok(store) => json_response(StatusCode::OK, json!(store), &headers),
            Err(error) => route_error(error, &headers),
        },
        ("/api/automations", &Method::PUT) => {
            let body: Value = match request_json(request, &headers).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            match state.automation_service.save(&body).await {
                Ok(store) => json_response(StatusCode::OK, json!(store), &headers),
                Err(error) => route_error(error, &headers),
            }
        }
        ("/api/automations/run", &Method::POST) => run_automation_route(state, request).await,
        _ => unreachable!("one-shot handler called for an unknown route"),
    }
}

async fn generate_title_route(state: &ServerState, request: Request) -> Response {
    let headers = request.headers().clone();
    let body: Value = match request_json(request, &headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(message) = body.get("message").and_then(Value::as_str) else {
        return bad_request("Missing message", &headers);
    };
    if message.trim().is_empty() {
        return bad_request("Missing message", &headers);
    }
    let prompt = format!(
        "Generate a concise title (max 6 words) that summarizes what this chat is about. Output ONLY the title, nothing else.\n\nUser message:\n{}",
        javascript_slice(message, 0, 500)
    );
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let title = run_claude_once(state, &prompt, &cwd, CLAUDE_HAIKU_MODEL, 20_000)
        .await
        .map(|result| strip_title_quotes(&result))
        .unwrap_or_else(|| fallback_title(message));
    json_response(StatusCode::OK, json!({ "title": title }), &headers)
}

async fn generate_commit_message_route(state: &ServerState, request: Request) -> Response {
    let headers = request.headers().clone();
    let body: Value = match request_json(request, &headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(cwd) = body.get("cwd").and_then(Value::as_str) else {
        return bad_request("Missing cwd", &headers);
    };
    if cwd.trim().is_empty() {
        return bad_request("Missing cwd", &headers);
    }
    let Some(cwd) = safe_cwd(state, cwd) else {
        return json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "Path is outside allowed local roots" }),
            &headers,
        );
    };
    let cwd = PathBuf::from(cwd);
    let Some(diff) = staged_diff(&cwd).await else {
        return no_commit_message(&headers);
    };
    let truncated_diff = if javascript_len(&diff) > 8_000 {
        format!(
            "{}\n\n[diff truncated...]",
            javascript_slice(&diff, 0, 8_000)
        )
    } else {
        diff
    };
    let prompt = format!(
        "You are a git commit message generator. Based on the following staged diff, write a concise commit message.\n\nRules:\n- First line: imperative summary, max 72 chars (e.g. \"Add user auth flow\", \"Fix sidebar overflow bug\")\n- If needed, add a blank line then 1-3 bullet points explaining key changes\n- Focus on WHAT changed and WHY, not HOW\n- Be specific but brief\n- Output ONLY the commit message, no quotes or prefixes\n\nStaged diff:\n{truncated_diff}"
    );
    match run_claude_once(state, &prompt, &cwd, CLAUDE_HAIKU_MODEL, 30_000).await {
        Some(message) => json_response(StatusCode::OK, json!({ "message": message }), &headers),
        None => no_commit_message(&headers),
    }
}

async fn run_automation_route(state: &ServerState, request: Request) -> Response {
    let headers = request.headers().clone();
    let body: Value = match request_json(request, &headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    match state.automation_service.run_once(&body).await {
        Ok(result) => json_response(StatusCode::OK, json!({ "result": result }), &headers),
        Err(RunAutomationError::MissingPrompt) => bad_request("prompt is required", &headers),
    }
}

async fn run_claude_once(
    state: &ServerState,
    prompt: &str,
    cwd: &Path,
    model: &str,
    timeout_ms: u64,
) -> Option<String> {
    let binary = state
        .agent_command_resolver
        .resolve_agent_binary(AgentKind::Claude);
    let arguments = build_claude_invocation_args(&binary, prompt, Some(model), None);
    let mut command = Command::new(&arguments[0]);
    command
        .args(&arguments[1..])
        .current_dir(cwd)
        .envs(
            state
                .agent_command_resolver
                .create_agent_env(AgentKind::Claude),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_millis(timeout_ms), command.output())
        .await
        .ok()?
        .ok()?;
    extract_one_shot_output(&String::from_utf8_lossy(&output.stdout))
}

async fn staged_diff(cwd: &Path) -> Option<String> {
    let stat = run_git_capture(cwd, &["diff", "--cached", "--stat"]).await?;
    if stat.trim().is_empty() {
        return None;
    }
    run_git_capture(cwd, &["diff", "--cached"]).await
}

async fn run_git_capture(cwd: &Path, arguments: &[&str]) -> Option<String> {
    let mut command = Command::new("git");
    command
        .args(arguments)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_millis(10_000), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success()
        || output.stdout.len() > GIT_MAX_BUFFER
        || output.stderr.len() > GIT_MAX_BUFFER
    {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn fallback_title(message: &str) -> String {
    let line = message.trim().split('\n').next().unwrap_or_default();
    if javascript_len(line) > 60 {
        format!("{}...", javascript_slice(line, 0, 57))
    } else {
        line.to_string()
    }
}

fn strip_title_quotes(value: &str) -> String {
    let value = value.strip_prefix(['"', '\'']).unwrap_or(value).to_string();
    value
        .strip_suffix(['"', '\''])
        .unwrap_or(&value)
        .to_string()
}

fn javascript_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn javascript_slice(value: &str, start: usize, end: usize) -> String {
    let units = value.encode_utf16().collect::<Vec<_>>();
    String::from_utf16_lossy(&units[start.min(units.len())..end.min(units.len())])
}

fn bad_request(message: &str, headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        json!({ "error": message }),
        headers,
    )
}

fn no_commit_message(headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        json!({ "error": "No staged changes or Claude is unavailable" }),
        headers,
    )
}

fn route_error(message: String, headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": message }),
        headers,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_one_shot_claude_output_with_the_existing_priority() {
        let output = [
            r#"{"type":"content_block_start","content_block":{"type":"text","text":"stream "}}"#,
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"text"}}"#,
            "not-json",
            r#"{"type":"result","result":" final result "}"#,
        ]
        .join("\n");
        assert_eq!(
            extract_one_shot_output(&output).as_deref(),
            Some("final result")
        );
        assert_eq!(
            extract_one_shot_output(
                r#"{"type":"content_block_start","content_block":{"type":"text","text":"only"}}"#
            )
            .as_deref(),
            Some("only")
        );
    }

    #[test]
    fn preserves_title_fallback_and_quote_cleanup() {
        assert_eq!(
            fallback_title("  A short title\nsecond line  "),
            "A short title"
        );
        assert_eq!(
            fallback_title(&"x".repeat(61)),
            format!("{}...", "x".repeat(57))
        );
        assert_eq!(strip_title_quotes("\"A title\""), "A title");
        assert_eq!(strip_title_quotes("'A title'"), "A title");
    }

    #[test]
    fn uses_javascript_utf16_lengths_for_prompt_limits() {
        assert_eq!(javascript_len("a😀b"), 4);
        assert_eq!(javascript_slice("a😀b", 0, 3), "a😀");
    }
}
