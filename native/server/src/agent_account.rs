use super::{ApiResult, ServerState};
use inferay_core::agent_command::{AgentCommandResolver, AgentKind};
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, PartialEq, Eq, Serialize)]
struct AgentAccountProviderStatus {
    kind: &'static str,
    health: &'static str,
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
    AgentAccountProviderStatus {
        kind: kind.as_str(),
        health: provider_health(resolver.has_agent_cli(kind), home, kind),
    }
}

fn provider_health(installed: bool, home: &Path, kind: AgentKind) -> &'static str {
    if !installed {
        "missing-cli"
    } else if auth_config_candidates(home, kind)
        .iter()
        .any(|path| path.exists())
    {
        "ready"
    } else {
        "needs-login"
    }
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
