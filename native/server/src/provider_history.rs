use std::path::{Path, PathBuf};

use inferay_core::chat_protocol::{ChatTranscriptMessage, trim_messages};
use serde_json::{Map, Value};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
};

const HISTORY_PAGE_SIZE: usize = 100;
const HISTORY_TAIL_BYTES: u64 = 4 * 1024 * 1024;

/// Loads a disposable conversation projection from the provider's own session
/// store. Inferay never writes to these paths.
pub async fn load_provider_history(
    provider: &str,
    session_id: &str,
    cwd: Option<&Path>,
) -> Option<Vec<ChatTranscriptMessage>> {
    if session_id.is_empty() || session_id.contains(['/', '\\']) {
        return None;
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let path = match provider {
        "codex" => find_session_file(&home.join(".codex/sessions"), session_id).await?,
        "claude" => find_claude_session(&home, cwd, session_id).await?,
        _ => return None,
    };
    let text = read_tail_page(&path).await?;
    let mut messages = parse_history(&text, provider);
    trim_messages(&mut messages);
    (!messages.is_empty()).then_some(messages)
}

async fn find_claude_session(home: &Path, cwd: Option<&Path>, session_id: &str) -> Option<PathBuf> {
    if let Some(cwd) = cwd {
        let project = cwd
            .to_string_lossy()
            .chars()
            .map(|character| if character == '/' { '-' } else { character })
            .collect::<String>();
        let direct = home
            .join(".claude/projects")
            .join(project)
            .join(format!("{session_id}.jsonl"));
        if fs::try_exists(&direct).await.ok()? {
            return Some(direct);
        }
    }
    find_session_file(&home.join(".claude/projects"), session_id).await
}

async fn read_tail_page(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).await.ok()?;
    let size = file.metadata().await.ok()?.len();
    let start = size.saturating_sub(HISTORY_TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).await.ok()?;
    let mut bytes = Vec::with_capacity((size - start) as usize);
    file.read_to_end(&mut bytes).await.ok()?;
    let offset = if start > 0 {
        bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |index| index + 1)
    } else {
        0
    };
    Some(String::from_utf8_lossy(&bytes[offset..]).into_owned())
}

async fn find_session_file(root: &Path, session_id: &str) -> Option<PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(directory).await.ok()?;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let kind = entry.file_type().await.ok()?;
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension == "jsonl")
                && path
                    .file_stem()
                    .is_some_and(|name| name.to_string_lossy().contains(session_id))
            {
                return Some(path);
            }
        }
    }
    None
}

fn parse_history(text: &str, provider: &str) -> Vec<ChatTranscriptMessage> {
    let mut messages = text
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|row| {
            if provider == "codex" {
                if row.get("type").and_then(Value::as_str) != Some("event_msg") {
                    return None;
                }
                let payload = row.get("payload")?;
                let role = match payload.get("type").and_then(Value::as_str)? {
                    "user_message" => "user",
                    "agent_message" => "assistant",
                    _ => return None,
                };
                return message(
                    payload.get("message").and_then(Value::as_str)?,
                    role,
                    row.get("timestamp"),
                );
            }
            if row.get("isMeta").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let role = match row.get("type").and_then(Value::as_str)? {
                "user" => "user",
                "assistant" => "assistant",
                _ => return None,
            };
            let content = row.pointer("/message/content")?;
            let text = match content {
                Value::String(text) => text.clone(),
                Value::Array(blocks) => blocks
                    .iter()
                    .filter_map(|block| block.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => return None,
            };
            message(
                &text,
                role,
                row.get("uuid").or_else(|| row.get("timestamp")),
            )
        })
        .take(HISTORY_PAGE_SIZE)
        .collect::<Vec<_>>();
    messages.reverse();
    messages
}

fn message(content: &str, role: &str, source_id: Option<&Value>) -> Option<ChatTranscriptMessage> {
    if content.trim().is_empty() {
        return None;
    }
    let id = source_id
        .and_then(Value::as_str)
        .unwrap_or(content)
        .chars()
        .take(80)
        .collect::<String>();
    Some(ChatTranscriptMessage {
        id: format!("provider:{role}:{id}"),
        role: role.to_string(),
        content: content.to_string(),
        images: None,
        tool_name: None,
        is_streaming: Some(false),
        extra: Map::new(),
    })
}
