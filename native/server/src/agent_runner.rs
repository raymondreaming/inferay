//! Direct Claude and Codex child-process runners.
//!
//! This is a faithful process-boundary port of the former Bun adapters. The
//! caller owns transport-specific broadcasting by draining `ProtocolEmission`s;
//! no JavaScript process or reverse IPC is involved.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use inferay_core::agent_protocol::{
    AgentEvent, AgentProtocolContext, ChatBlockRole, ClaudeProtocolState, CodexInvocationContext,
    CodexProtocolState, ProtocolEmission, build_claude_invocation_args,
    build_codex_invocation_args, should_emit_codex_output_fallback, truncate_agent_result,
};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;

const MAX_STREAM_CHARS: usize = 64_000;

pub trait PidTracker: Send + Sync {
    fn track_pid(&self, pid: u32);
    fn untrack_pid(&self, pid: u32);
    fn kill_pid_tree(&self, pid: u32);
}

/// Process control shared with the session owner while `run_*` is awaiting.
#[derive(Clone, Default)]
pub struct AgentProcessHandle {
    pid: Arc<AtomicU32>,
    cancelled: Arc<AtomicBool>,
}

impl AgentProcessHandle {
    pub fn pid(&self) -> Option<u32> {
        match self.pid.load(Ordering::Acquire) {
            0 => None,
            pid => Some(pid),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    /// Claude's graceful stop contract: SIGINT now and again after 150ms.
    pub fn stop_claude(&self) {
        self.cancelled.store(true, Ordering::Release);
        let Some(pid) = self.pid() else { return };
        signal_interrupt(pid);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            signal_interrupt(pid);
        });
    }

    pub fn kill(&self, tracker: &dyn PidTracker) {
        self.cancelled.store(true, Ordering::Release);
        if let Some(pid) = self.pid() {
            tracker.kill_pid_tree(pid);
        }
    }

    fn set_pid(&self, pid: Option<u32>) {
        self.pid.store(pid.unwrap_or(0), Ordering::Release);
    }
}

pub struct ClaudeRun<'a> {
    pub binary: &'a Path,
    pub prompt: &'a str,
    pub cwd: &'a Path,
    pub model: Option<&'a str>,
    pub session_id: Option<&'a str>,
    pub env: &'a HashMap<OsString, OsString>,
}

pub struct CodexRun<'a> {
    pub binary: &'a Path,
    pub prompt: &'a str,
    pub invocation: &'a CodexInvocationContext,
    pub pane_id: &'a str,
    pub env: &'a HashMap<OsString, OsString>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentRunResult {
    pub last_assistant_message: String,
}

pub async fn run_claude(
    run: ClaudeRun<'_>,
    handle: &AgentProcessHandle,
    context: &mut AgentProtocolContext,
    emissions: Option<&tokio::sync::mpsc::UnboundedSender<ProtocolEmission>>,
) -> AgentRunResult {
    let arguments = build_claude_invocation_args(run.binary, run.prompt, run.model, run.session_id);
    let spawn = spawn_direct(&arguments, run.cwd, run.env);
    let mut child = match spawn {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions);
            return AgentRunResult::default();
        }
    };
    handle.set_pid(child.id());
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut line = Vec::new();
    let mut protocol = ClaudeProtocolState::default();

    loop {
        line.clear();
        match stdout.read_until(b'\n', &mut line).await {
            Ok(0) => break,
            Ok(_) => {
                if let Some(event) = parse_ndjson(&line) {
                    protocol.handle_event(context, &event);
                    flush_emissions(context, emissions);
                }
            }
            Err(error) => {
                if !handle.is_cancelled() {
                    emit_error(context, error.to_string());
                }
                break;
            }
        }
    }
    let exit = child.wait().await;
    handle.set_pid(None);
    let stderr = stderr.await.unwrap_or_default().trim().to_string();
    let exit_code = exit.as_ref().ok().and_then(std::process::ExitStatus::code);
    if !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
    emit_finish(context, finish_reason(handle, exit_code, false));
    flush_emissions(context, emissions);
    AgentRunResult {
        last_assistant_message: protocol.last_assistant_message,
    }
}

pub async fn run_codex(
    run: CodexRun<'_>,
    handle: &AgentProcessHandle,
    tracker: &dyn PidTracker,
    context: &mut AgentProtocolContext,
    state: &mut CodexProtocolState,
    emissions: Option<&tokio::sync::mpsc::UnboundedSender<ProtocolEmission>>,
) -> AgentRunResult {
    let output_path = codex_output_path(run.pane_id);
    let arguments =
        build_codex_invocation_args(run.binary, run.prompt, run.invocation, &output_path);
    let mut child = match spawn_direct(&arguments, &run.invocation.cwd, run.env) {
        Ok(child) => child,
        Err(error) => {
            if !handle.is_cancelled() {
                emit_error(context, error.to_string());
            }
            flush_emissions(context, emissions);
            return AgentRunResult::default();
        }
    };
    let pid = child.id();
    handle.set_pid(pid);
    if let Some(pid) = pid {
        tracker.track_pid(pid);
    }
    let stderr = tokio::spawn(drain_bounded(child.stderr.take().expect("piped stderr")));
    let mut stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut line = Vec::new();
    let mut completion_stop_requested = false;
    loop {
        line.clear();
        match stdout.read_until(b'\n', &mut line).await {
            Ok(0) => break,
            Ok(_) => {
                if let Some(event) = parse_ndjson(&line) {
                    state.handle_event(context, &event);
                    flush_emissions(context, emissions);
                }
                if state.completed_from_event && !completion_stop_requested {
                    completion_stop_requested = true;
                    if let Some(pid) = pid {
                        tracker.kill_pid_tree(pid);
                    }
                }
            }
            Err(_) => break,
        }
    }
    let exit = child.wait().await;
    if let Some(pid) = pid {
        tracker.untrack_pid(pid);
    }
    handle.set_pid(None);
    let stderr = stderr.await.unwrap_or_default().trim().to_string();
    state.clear_live_diff_state();
    state.finalize_open_block(context);

    let assistant_text = tokio::fs::read_to_string(&output_path)
        .await
        .unwrap_or_default()
        .trim()
        .to_string();
    let _ = tokio::fs::remove_file(&output_path).await;
    let last_role = match state.last_chat_block_role {
        Some(ChatBlockRole::Assistant) => Some("assistant"),
        Some(ChatBlockRole::Tool) => Some("tool"),
        None => None,
    };
    let emit_fallback = should_emit_codex_output_fallback(
        &assistant_text,
        &state.last_assistant_message,
        state.has_final_assistant_message,
        last_role,
    );
    if !assistant_text.is_empty() {
        state.last_assistant_message = truncate_agent_result(&assistant_text);
    }
    if emit_fallback {
        context.emissions.push(ProtocolEmission::Chat(json!({
            "type": "result", "result": assistant_text
        })));
        context
            .emissions
            .push(ProtocolEmission::Agent(AgentEvent::Result {
                text: assistant_text,
            }));
        state.has_final_assistant_message = true;
        state.last_chat_block_role = Some(ChatBlockRole::Assistant);
    } else if !exit.as_ref().is_ok_and(std::process::ExitStatus::success)
        && !stderr.is_empty()
        && !state.completed_from_event
        && !handle.is_cancelled()
    {
        emit_error(context, stderr);
    }
    let exit_code = exit.as_ref().ok().and_then(std::process::ExitStatus::code);
    emit_finish(
        context,
        finish_reason(handle, exit_code, state.completed_from_event),
    );
    flush_emissions(context, emissions);
    AgentRunResult {
        last_assistant_message: state.last_assistant_message.clone(),
    }
}

fn spawn_direct(
    arguments: &[String],
    cwd: &Path,
    env: &HashMap<OsString, OsString>,
) -> std::io::Result<tokio::process::Child> {
    let (binary, arguments) = arguments.split_first().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing agent binary")
    })?;
    Command::new(binary)
        .args(arguments)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

async fn drain_bounded(mut stream: impl AsyncRead + Unpin) -> String {
    let mut text = String::new();
    let mut buffer = [0_u8; 8192];
    let mut pending = Vec::new();
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                pending.extend_from_slice(&buffer[..read]);
                decode_utf8_stream(&mut pending, &mut text, false);
                text = tail_javascript_chars(&text, MAX_STREAM_CHARS);
            }
        }
    }
    decode_utf8_stream(&mut pending, &mut text, true);
    text = tail_javascript_chars(&text, MAX_STREAM_CHARS);
    text
}

fn decode_utf8_stream(pending: &mut Vec<u8>, output: &mut String, end: bool) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                output.push_str(valid);
                pending.clear();
                return;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    output.push_str(
                        std::str::from_utf8(&pending[..valid]).expect("validated prefix"),
                    );
                    pending.drain(..valid);
                }
                match error.error_len() {
                    Some(length) => {
                        output.push('\u{fffd}');
                        pending.drain(..length);
                    }
                    None if end => {
                        output.push_str(&String::from_utf8_lossy(pending));
                        pending.clear();
                        return;
                    }
                    None => return,
                }
            }
        }
    }
}

fn tail_javascript_chars(value: &str, max_units: usize) -> String {
    let units = value.encode_utf16().collect::<Vec<_>>();
    if units.len() <= max_units {
        return value.into();
    }
    String::from_utf16_lossy(&units[units.len() - max_units..])
}

fn parse_ndjson(line: &[u8]) -> Option<Value> {
    let line = String::from_utf8_lossy(line);
    let line = line.trim();
    if line.is_empty() {
        None
    } else {
        serde_json::from_str(line).ok()
    }
}

fn emit_error(context: &mut AgentProtocolContext, message: String) {
    context
        .emissions
        .push(ProtocolEmission::Agent(AgentEvent::Error {
            message: message.clone(),
        }));
    context.emissions.push(ProtocolEmission::System(message));
}

fn emit_finish(context: &mut AgentProtocolContext, reason: String) {
    context
        .emissions
        .push(ProtocolEmission::Agent(AgentEvent::Finish {
            reason: Some(reason),
        }));
}

fn flush_emissions(
    context: &mut AgentProtocolContext,
    sender: Option<&tokio::sync::mpsc::UnboundedSender<ProtocolEmission>>,
) {
    let Some(sender) = sender else { return };
    for emission in context.take_emissions() {
        let _ = sender.send(emission);
    }
}

fn finish_reason(handle: &AgentProcessHandle, exit_code: Option<i32>, completed: bool) -> String {
    if handle.is_cancelled() {
        "cancelled".into()
    } else if exit_code == Some(0) || completed {
        "completed".into()
    } else {
        format!("exit:{}", exit_code.unwrap_or(-1))
    }
}

fn codex_output_path(pane_id: &str) -> PathBuf {
    let stem = pane_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || "._-".contains(character) {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect::<String>();
    let stem = if stem.is_empty() { "pane" } else { &stem };
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    std::env::temp_dir().join(format!("inferay-codex-{stem}-{millis}.txt"))
}

#[cfg(unix)]
fn signal_interrupt(pid: u32) {
    let _ = std::process::Command::new("kill")
        .arg(OsStr::new("-INT"))
        .arg(pid.to_string())
        .status();
}

#[cfg(windows)]
fn signal_interrupt(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct RecordingTracker {
        tracked: std::sync::Mutex<Vec<(char, u32)>>,
    }

    impl PidTracker for RecordingTracker {
        fn track_pid(&self, pid: u32) {
            self.tracked.lock().unwrap().push(('t', pid));
        }
        fn untrack_pid(&self, pid: u32) {
            self.tracked.lock().unwrap().push(('u', pid));
        }
        fn kill_pid_tree(&self, pid: u32) {
            self.tracked.lock().unwrap().push(('k', pid));
        }
    }

    #[test]
    fn ndjson_and_utf16_tail_match_javascript_boundaries() {
        assert_eq!(
            parse_ndjson(b" {\"type\":\"result\"} \n").unwrap()["type"],
            "result"
        );
        assert!(parse_ndjson(b"not json\n").is_none());
        assert_eq!(tail_javascript_chars("a😀b", 3), "😀b");
    }

    #[test]
    fn codex_output_names_are_sanitized_like_the_adapter() {
        let path = codex_output_path("../../pane id");
        let name = path.file_name().unwrap().to_string_lossy();
        assert!(name.starts_with("inferay-codex-.._.._pane_id-"));
        assert!(name.ends_with(".txt"));
    }

    #[test]
    fn claude_event_order_preserves_session_agent_activity_and_chat() {
        let mut context = AgentProtocolContext::new("/tmp");
        let mut state = ClaudeProtocolState::default();
        state.handle_event(
            &mut context,
            &json!({
                "type": "content_block_start", "session_id": "s1", "index": 2,
                "content_block": {"type": "tool_use", "name": "Read", "input": {"path": "/tmp/a"}}
            }),
        );
        assert!(matches!(&context.emissions[0], ProtocolEmission::Session(id) if id == "s1"));
        assert!(matches!(
            &context.emissions[1],
            ProtocolEmission::Agent(AgentEvent::Session { .. })
        ));
        assert!(matches!(
            &context.emissions[2],
            ProtocolEmission::Agent(AgentEvent::ToolCallStart { .. })
        ));
        assert!(matches!(
            &context.emissions[3],
            ProtocolEmission::Activity { tool_name, .. } if tool_name == "Read"
        ));
        assert!(matches!(&context.emissions[4], ProtocolEmission::Chat(_)));
    }

    #[cfg(unix)]
    fn executable_script(body: &str) -> (tempfile::TempDir, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fake-agent");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        (directory, path)
    }

    #[cfg(unix)]
    fn test_env() -> HashMap<OsString, OsString> {
        std::env::vars_os().collect()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_runner_launches_binary_directly_and_preserves_finish_order() {
        let (directory, binary) = executable_script(
            "printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"claude-session\",\"result\":\"finished\"}'",
        );
        let environment = test_env();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let result = run_claude(
            ClaudeRun {
                binary: &binary,
                prompt: "hello",
                cwd: directory.path(),
                model: Some("sonnet"),
                session_id: None,
                env: &environment,
            },
            &handle,
            &mut context,
            None,
        )
        .await;
        assert_eq!(result.last_assistant_message, "finished");
        assert!(
            matches!(context.emissions.last(), Some(ProtocolEmission::Agent(AgentEvent::Finish { reason: Some(reason) })) if reason == "completed")
        );
        assert_eq!(context.session_id.as_deref(), Some("claude-session"));
        assert_eq!(handle.pid(), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_runner_emits_delta_before_child_exit() {
        let (directory, binary) = executable_script(
            "printf '%s\n' '{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}' '{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"first\"}}'; sleep 3",
        );
        let environment = test_env();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let run = run_claude(
            ClaudeRun {
                binary: &binary,
                prompt: "hello",
                cwd: directory.path(),
                model: None,
                session_id: None,
                env: &environment,
            },
            &handle,
            &mut context,
            Some(&sender),
        );
        tokio::pin!(run);
        let delta = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                tokio::select! {
                    result = &mut run => panic!("child exited before first delta: {result:?}"),
                    emission = receiver.recv() => {
                        if let Some(ProtocolEmission::Chat(event)) = emission
                            && event.get("type").and_then(Value::as_str) == Some("content_block_delta")
                        {
                            break event;
                        }
                    }
                }
            }
        }).await.expect("first delta should stream while child is still running");
        assert_eq!(delta["delta"]["text"], "first");
        run.await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_runner_tracks_pid_reads_output_file_and_removes_it() {
        let (directory, binary) = executable_script(
            r#"
output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--output-last-message' ]; then output="$argument"; fi
  previous="$argument"
done
printf 'file summary' > "$output"
printf '%s\n' '{"type":"turn.started"}'
"#,
        );
        let environment = test_env();
        let invocation = CodexInvocationContext {
            cwd: directory.path().into(),
            reference_paths: vec![],
            images: vec![],
            model: None,
            reasoning_level: None,
            session_id: None,
        };
        let tracker = RecordingTracker::default();
        let handle = AgentProcessHandle::default();
        let mut context = AgentProtocolContext::new(directory.path());
        let mut state = CodexProtocolState::default();
        let result = run_codex(
            CodexRun {
                binary: &binary,
                prompt: "hello",
                invocation: &invocation,
                pane_id: "pane",
                env: &environment,
            },
            &handle,
            &tracker,
            &mut context,
            &mut state,
            None,
        )
        .await;
        assert_eq!(result.last_assistant_message, "file summary");
        let tracking = tracker.tracked.lock().unwrap();
        assert_eq!(tracking.len(), 2);
        assert_eq!(tracking[0].0, 't');
        assert_eq!(tracking[1], ('u', tracking[0].1));
        assert!(
            matches!(context.emissions.last(), Some(ProtocolEmission::Agent(AgentEvent::Finish { reason: Some(reason) })) if reason == "completed")
        );
    }
}
