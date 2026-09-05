use crate::unix_millis as epoch_millis;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use inferay_core::agent_command::{AgentCommandResolver, AgentKind};
use serde::Serialize;
use serde_json::json;

use super::{ApiResult, ServerState};

const CLAUDE_USAGE_SIGNALS: [&str; 2] = [
    "Claude Code exposes interactive /cost usage details.",
    "Machine-readable rate-limit reset data is not exposed locally.",
];
const CODEX_USAGE_SIGNALS: [&str; 2] = [
    "Codex CLI account usage is handled by the local CLI.",
    "Machine-readable usage and rate-limit reset data is not exposed locally.",
];

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAccountProviderStatus {
    kind: &'static str,
    label: &'static str,
    installed: bool,
    binary_path: String,
    version: Option<String>,
    auth_config_paths: Vec<String>,
    usage_signals: Vec<&'static str>,
    checked_at: u64,
    health: &'static str,
    summary: String,
}

pub(super) async fn account_status(state: &ServerState) -> ApiResult {
    let [claude, codex] = [AgentKind::Claude, AgentKind::Codex].map(|kind| {
        let resolver = Arc::clone(&state.agent_command_resolver);
        let home = state.allowed_paths.home_directory().to_path_buf();
        tokio::task::spawn_blocking(move || provider_status(&resolver, &home, kind))
    });
    let (claude, codex) = tokio::join!(claude, codex);
    Ok(json!({"providers": [claude?, codex?]}))
}

fn provider_status(
    resolver: &AgentCommandResolver,
    home: &Path,
    kind: AgentKind,
) -> AgentAccountProviderStatus {
    let installed = resolver.has_agent_cli(kind);
    let binary_path = resolver
        .resolve_agent_binary(kind)
        .to_string_lossy()
        .into_owned();
    let auth_config_paths = if installed {
        existing_auth_paths(home, kind)
    } else {
        Vec::new()
    };
    build_agent_account_status(
        kind,
        installed,
        binary_path,
        installed.then(|| resolver.read_cli_version(kind)).flatten(),
        auth_config_paths,
        epoch_millis(),
    )
}

fn build_agent_account_status(
    kind: AgentKind,
    installed: bool,
    binary_path: String,
    version: Option<String>,
    mut auth_config_paths: Vec<String>,
    checked_at: u64,
) -> AgentAccountProviderStatus {
    let (label, usage_signals) = match kind {
        AgentKind::Claude => ("Claude", CLAUDE_USAGE_SIGNALS.to_vec()),
        AgentKind::Codex => ("Codex", CODEX_USAGE_SIGNALS.to_vec()),
    };
    let (health, summary) = if !installed {
        auth_config_paths.clear();
        (
            "missing-cli",
            format!("{label} CLI was not found on this machine."),
        )
    } else if auth_config_paths.is_empty() {
        (
            "needs-login",
            format!("{label} CLI is installed, but Inferay did not find local auth config."),
        )
    } else {
        (
            "ready",
            format!("{label} CLI and local auth config detected."),
        )
    };
    AgentAccountProviderStatus {
        kind: kind.as_str(),
        label,
        installed,
        binary_path,
        version,
        auth_config_paths,
        usage_signals,
        checked_at,
        health,
        summary,
    }
}

fn existing_auth_paths(home: &Path, kind: AgentKind) -> Vec<String> {
    auth_config_candidates(home, kind)
        .into_iter()
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

fn auth_config_candidates(home: &Path, kind: AgentKind) -> Vec<PathBuf> {
    match kind {
        AgentKind::Claude => vec![
            home.join(".claude.json"),
            home.join(".claude"),
            home.join(".config/claude"),
        ],
        AgentKind::Codex => vec![
            home.join(".codex/auth.json"),
            home.join(".codex/config.toml"),
            home.join(".config/codex"),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_three_existing_account_health_states() {
        let missing = build_agent_account_status(
            AgentKind::Claude,
            false,
            "claude".into(),
            None,
            vec!["should-be-cleared".into()],
            1,
        );
        assert_eq!(missing.health, "missing-cli");
        assert!(missing.auth_config_paths.is_empty());
        assert_eq!(missing.summary, "Claude CLI was not found on this machine.");

        let needs_login = build_agent_account_status(
            AgentKind::Codex,
            true,
            "codex".into(),
            Some("codex 1.0".into()),
            Vec::new(),
            2,
        );
        assert_eq!(needs_login.health, "needs-login");
        assert_eq!(
            needs_login.summary,
            "Codex CLI is installed, but Inferay did not find local auth config."
        );

        let ready = build_agent_account_status(
            AgentKind::Claude,
            true,
            "claude".into(),
            Some("claude 1.0".into()),
            vec!["/tmp/.claude.json".into()],
            3,
        );
        assert_eq!(ready.health, "ready");
        assert_eq!(ready.summary, "Claude CLI and local auth config detected.");
    }
}
