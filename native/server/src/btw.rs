use std::path::Path;

use inferay_core::agent_command::{AgentCommandResolver, AgentKind};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

const MAX_STDERR_UTF16_UNITS: usize = 64_000;

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
        BtwOutputEvent::Delta(delta) => {
            full_text.push_str(delta);
            emit(json!({
                "type": "chat:btw:delta",
                "paneId": pane_id,
                "text": delta,
            }));
        }
        BtwOutputEvent::Result(result) if full_text.is_empty() => {
            full_text.push_str(result);
        }
        BtwOutputEvent::Result(_) => {}
    })
    .await;

    match run_result {
        Ok(output) => {
            if full_text.is_empty() && !output.stderr.trim().is_empty() {
                full_text = output.stderr.trim().to_string();
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

struct ClaudeOutput {
    stderr: String,
}

enum BtwOutputEvent<'a> {
    Delta(&'a str),
    Result(&'a str),
}

async fn run_claude<F>(
    cwd: &Path,
    text: &str,
    resolver: &AgentCommandResolver,
    mut emit_delta: F,
) -> std::io::Result<ClaudeOutput>
where
    F: for<'a> FnMut(BtwOutputEvent<'a>),
{
    let mut child = Command::new(resolver.resolve_agent_binary(AgentKind::Claude))
        .args([
            "-p",
            text,
            "--dangerously-skip-permissions",
            "--output-format",
            "stream-json",
            "--verbose",
        ])
        .current_dir(cwd)
        .env_clear()
        .envs(resolver.create_agent_env(AgentKind::Claude))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().expect("piped Claude stdout");
    let mut stderr = child.stderr.take().expect("piped Claude stderr");
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).await?;
        Ok::<_, std::io::Error>(truncate_utf16_tail(&String::from_utf8_lossy(&bytes)))
    });

    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line).await?;
        if read == 0 {
            break;
        }
        if line.last() == Some(&b'\n') {
            line.pop();
        }
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        handle_event_line(&line, &mut emit_delta);
    }

    child.wait().await?;
    let stderr = stderr_task.await.map_err(std::io::Error::other)??;
    Ok(ClaudeOutput { stderr })
}

fn handle_event_line<F>(line: &[u8], emit_event: &mut F)
where
    F: for<'a> FnMut(BtwOutputEvent<'a>),
{
    let Ok(event) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    let Some(event_type) = event.get("type").and_then(Value::as_str) else {
        return;
    };
    if event_type == "content_block_delta"
        && event.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta")
    {
        if let Some(text) = event.pointer("/delta/text").and_then(Value::as_str) {
            emit_event(BtwOutputEvent::Delta(text));
        }
    } else if event_type == "content_block_start"
        && event.pointer("/content_block/type").and_then(Value::as_str) == Some("text")
    {
        if let Some(text) = event
            .pointer("/content_block/text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            emit_event(BtwOutputEvent::Delta(text));
        }
    } else if event_type == "result"
        && let Some(text) = event
            .get("result")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
    {
        emit_event(BtwOutputEvent::Result(text));
    }
}

fn truncate_utf16_tail(value: &str) -> String {
    let units = value.encode_utf16().collect::<Vec<_>>();
    if units.len() <= MAX_STDERR_UTF16_UNITS {
        return value.to_string();
    }
    String::from_utf16_lossy(&units[units.len() - MAX_STDERR_UTF16_UNITS..])
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use tempfile::TempDir;

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
