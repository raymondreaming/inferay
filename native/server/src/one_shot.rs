use inferay_core::{utf16_length as javascript_len, utf16_slice as javascript_slice};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use super::{ApiResult, ServerState, api_body, api_error, required, safe_cwd};
use axum::extract::Request;
use axum::http::StatusCode;
use inferay_core::agent_command::{AgentCommandResolver, AgentKind};
use inferay_core::agent_protocol::{build_claude_invocation_args, truncate_agent_result};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

const CLAUDE_HAIKU_MODEL: &str = "claude-haiku-4-5";
const GIT_MAX_BUFFER: usize = 512 * 1024;

pub(super) async fn generate_title_route(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let message = required(
        body["message"]
            .as_str()
            .filter(|message| !message.trim().is_empty()),
        "Missing message",
    )?;
    let prompt = format!(
        "Generate a concise title (max 6 words) that summarizes what this chat is about. Output ONLY the title, nothing else.\n\nUser message:\n{}",
        javascript_slice(message, 0, 500)
    );
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let title = run_claude_once(state, &prompt, &cwd, CLAUDE_HAIKU_MODEL, 20_000)
        .await
        .map(|result| strip_title_quotes(&result))
        .unwrap_or_else(|| fallback_title(message));
    Ok(json!({ "title": title }))
}

pub(super) async fn generate_commit_message_route(
    state: &ServerState,
    request: Request,
) -> ApiResult {
    let body: Value = api_body(request).await?;
    let cwd = required(
        body["cwd"].as_str().filter(|cwd| !cwd.trim().is_empty()),
        "Missing cwd",
    )?;
    let cwd =
        PathBuf::from(safe_cwd(state, cwd).ok_or_else(|| {
            api_error(StatusCode::FORBIDDEN, "Path is outside allowed local roots")
        })?);
    let diff = required(
        staged_diff(&cwd).await,
        "No staged changes or Claude is unavailable",
    )?;
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
    let message = required(
        run_claude_once(state, &prompt, &cwd, CLAUDE_HAIKU_MODEL, 30_000).await,
        "No staged changes or Claude is unavailable",
    )?;
    Ok(json!({"message":message}))
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
    let child = crate::agent_runner::spawn_direct(
        &arguments,
        cwd,
        &state
            .agent_command_resolver
            .create_agent_env(AgentKind::Claude),
    )
    .ok()?;
    let output = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait_with_output())
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

enum ClaudeText<'a> {
    Delta(&'a str),
    Result(&'a str),
}

fn claude_text(event: &Value) -> Option<ClaudeText<'_>> {
    match event["type"].as_str()? {
        "content_block_start" if event["content_block"]["type"] == "text" => event["content_block"]
            ["text"]
            .as_str()
            .filter(|text| !text.is_empty())
            .map(ClaudeText::Delta),
        "content_block_delta" if event["delta"]["type"] == "text_delta" => {
            event["delta"]["text"].as_str().map(ClaudeText::Delta)
        }
        "result" => event["result"].as_str().map(ClaudeText::Result),
        _ => None,
    }
}

pub(crate) fn extract_one_shot_output(stdout: &str) -> Option<String> {
    let mut result = String::new();
    let mut streamed = String::new();
    for event in stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
    {
        match claude_text(&event) {
            Some(ClaudeText::Delta(text)) => streamed.push_str(text),
            Some(ClaudeText::Result(text)) => result = truncate_agent_result(text),
            None => {}
        }
    }
    let text = if result.is_empty() {
        &streamed
    } else {
        &result
    }
    .trim();
    (!text.is_empty()).then(|| text.to_owned())
}

/// Runs the lightweight "by the way" Claude prompt and emits the same
/// `chat:btw:*` messages as the former Bun implementation.
pub async fn run_btw_chat_message<F>(
    pane_id: &str,
    text: &str,
    cwd: &Path,
    resolver: &AgentCommandResolver,
    mut emit: F,
) where
    F: FnMut(Value),
{
    emit(json!({
        "type": "chat:btw:start",
        "paneId": pane_id,
        "question": text,
    }));

    let mut full_text = String::new();
    let run_result = run_claude(cwd, text, resolver, |event| match event {
        ClaudeText::Delta(delta) => {
            full_text.push_str(delta);
            emit(json!({
                "type": "chat:btw:delta",
                "paneId": pane_id,
                "text": delta,
            }));
        }
        ClaudeText::Result(result) if full_text.is_empty() => {
            full_text.push_str(result);
        }
        ClaudeText::Result(_) => {}
    })
    .await;

    match run_result {
        Ok(output) => {
            if full_text.is_empty() && !output.trim().is_empty() {
                full_text = output.trim().to_string();
            }
        }
        Err(error) if full_text.is_empty() => full_text = error.to_string(),
        Err(_) => {}
    }

    emit(json!({
        "type": "chat:btw:done",
        "paneId": pane_id,
        "answer": if full_text.is_empty() { "(no response)" } else { &full_text },
    }));
}

async fn run_claude<F>(
    cwd: &Path,
    text: &str,
    resolver: &AgentCommandResolver,
    mut emit_delta: F,
) -> std::io::Result<String>
where
    F: for<'a> FnMut(ClaudeText<'a>),
{
    let binary = resolver.resolve_agent_binary(AgentKind::Claude);
    let mut child = crate::agent_runner::spawn_direct(
        &[
            binary.as_os_str(),
            OsStr::new("-p"),
            OsStr::new(text),
            OsStr::new("--dangerously-skip-permissions"),
            OsStr::new("--output-format"),
            OsStr::new("stream-json"),
            OsStr::new("--verbose"),
        ],
        cwd,
        &resolver.create_agent_env(AgentKind::Claude),
    )?;

    let stdout = child.stdout.take().expect("piped Claude stdout");
    let mut stderr = child.stderr.take().expect("piped Claude stderr");
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).await?;
        Ok::<_, std::io::Error>(crate::agent_runner::tail_javascript_chars(
            &String::from_utf8_lossy(&bytes),
            64_000,
        ))
    });

    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line).await?;
        if read == 0 {
            break;
        }
        if let Ok(event) = serde_json::from_slice::<Value>(&line)
            && let Some(text) = claude_text(&event)
        {
            emit_delta(text);
        }
    }

    child.wait().await?;
    let stderr = stderr_task.await.map_err(std::io::Error::other)??;
    Ok(stderr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

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
            extract_one_shot_output(&format!(
                "{output}\n{}",
                json!({"type":"result", "result":""})
            ))
            .as_deref(),
            Some("stream text")
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
    #[cfg(unix)]
    fn fake_resolver(script: &str) -> (TempDir, AgentCommandResolver) {
        use std::os::unix::fs::PermissionsExt;

        let home = TempDir::new().unwrap();
        let bin = home.path().join(".local/bin");
        fs::create_dir_all(&bin).unwrap();
        let executable = bin.join("claude");
        fs::write(&executable, script).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let resolver = AgentCommandResolver::new(home.path());
        (home, resolver)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn emits_start_streamed_deltas_and_done_with_exact_arguments() {
        let (_home, resolver) = fake_resolver(
            r###"#!/bin/sh
if [ "$1" != "-p" ] || [ "$2" != "why?" ] || [ "$3" != "--dangerously-skip-permissions" ] || [ "$4" != "--output-format" ] || [ "$5" != "stream-json" ] || [ "$6" != "--verbose" ] || [ "$#" != "6" ]; then
  echo "wrong arguments" >&2
  exit 9
fi
printf '%s\n' '{"type":"content_block_start","content_block":{"type":"text","text":"Hello "}}'
printf '%s\n' 'not json'
printf '%s\n' '{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}'
printf '%s\n' '{"type":"result","result":"ignored because text streamed"}'
"###,
        );
        let cwd = TempDir::new().unwrap();
        let mut messages = Vec::new();

        run_btw_chat_message("pane-1", "why?", cwd.path(), &resolver, |message| {
            messages.push(message)
        })
        .await;

        assert_eq!(
            messages,
            vec![
                json!({"type":"chat:btw:start","paneId":"pane-1","question":"why?"}),
                json!({"type":"chat:btw:delta","paneId":"pane-1","text":"Hello "}),
                json!({"type":"chat:btw:delta","paneId":"pane-1","text":"world"}),
                json!({"type":"chat:btw:done","paneId":"pane-1","answer":"Hello world"}),
            ]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn falls_back_to_result_then_stderr_then_no_response() {
        for (script, expected) in [
            (
                "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"result\",\"result\":\"final result\"}'\n",
                "final result",
            ),
            (
                "#!/bin/sh\nprintf '  stderr answer  \\n' >&2\n",
                "stderr answer",
            ),
            ("#!/bin/sh\nexit 0\n", "(no response)"),
        ] {
            let (_home, resolver) = fake_resolver(script);
            let cwd = TempDir::new().unwrap();
            let mut messages = Vec::new();
            run_btw_chat_message("p", "q", cwd.path(), &resolver, |message| {
                messages.push(message)
            })
            .await;
            assert_eq!(messages.last().unwrap()["answer"], expected);
        }
    }
}
