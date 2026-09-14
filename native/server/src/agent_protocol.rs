//! Captures platform file facts before the core translates protocol notifications.
use crate::path_resolution::{is_within_directory, resolve_lexically};
use inferay_core::agent_protocol::{AgentProtocolContext, CodexProtocolState, ProtocolFiles};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(super) fn handle_codex_notification(
    state: &mut CodexProtocolState,
    context: &mut AgentProtocolContext,
    method: &str,
    params: &Value,
) {
    let files = if params["item"]["type"] == "fileChange"
        && matches!(method, "item/started" | "item/completed")
    {
        context.cwd = resolve_lexically(&context.cwd).unwrap_or_else(|_| context.cwd.clone());
        let roots = workspace_roots(&context.cwd, &context.reference_paths);
        let snapshots = state
            .snapshot_paths_for_notification(context, method, params, &roots)
            .into_iter()
            .map(|path| {
                let snapshot = read_snapshot(&path);
                (path, snapshot)
            })
            .collect();
        ProtocolFiles { roots, snapshots }
    } else {
        ProtocolFiles::default()
    };
    state.handle_notification(context, method, params, &files);
}

fn read_snapshot(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 80_000 {
        return None;
    }
    std::fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn workspace_roots(cwd: &Path, reference_paths: &[PathBuf]) -> Vec<PathBuf> {
    let cwd_root = resolve_lexically(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let mut roots = vec![cwd_root.clone()];
    for path in reference_paths {
        let Ok(path) = resolve_lexically(path) else {
            continue;
        };
        let root = if path.is_dir() {
            path
        } else if path.is_file() {
            path.parent().map(Path::to_path_buf).unwrap_or(path)
        } else {
            continue;
        };
        if is_within_directory(&root, &cwd_root)
            || roots
                .iter()
                .any(|existing_root| is_within_directory(&root, existing_root))
        {
            continue;
        }
        roots.push(root);
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;
    use inferay_core::agent_protocol::ProtocolEmission;
    use serde_json::json;

    #[test]
    fn relative_protocol_roots_are_resolved_before_requesting_snapshots() {
        let cwd = std::env::current_dir().unwrap();
        let filename = format!(".inferay-missing-{}", uuid::Uuid::new_v4());
        let mut context = AgentProtocolContext::new(".");
        let mut state = CodexProtocolState::default();
        let event = json!({"item":{"type":"fileChange","path":filename}});
        handle_codex_notification(&mut state, &mut context, "item/completed", &event);
        assert_eq!(context.cwd, cwd);
        assert!(
            context
                .take_emissions()
                .contains(&ProtocolEmission::FileChange(vec![cwd.join(filename)]))
        );
    }

    #[test]
    fn file_change_notifications_capture_bounded_snapshots_at_the_adapter() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file.rs");
        std::fs::write(&path, "before").unwrap();
        let mut context = AgentProtocolContext::new(root.path());
        let mut state = CodexProtocolState::default();
        let event = json!({"item":{"type":"fileChange","path":"file.rs"}});
        handle_codex_notification(&mut state, &mut context, "item/started", &event);
        context.take_emissions();
        std::fs::write(&path, "after").unwrap();
        handle_codex_notification(&mut state, &mut context, "item/completed", &event);
        assert!(context.take_emissions().iter().any(
            |emission| matches!(emission, ProtocolEmission::Chat(value)
            if value["content_block"]["input"]["old_string"] == "before"
            && value["content_block"]["input"]["new_string"] == "after")
        ));
        assert!(read_snapshot(root.path()).is_none());
        std::fs::write(&path, vec![b'x'; 80_001]).unwrap();
        assert!(read_snapshot(&path).is_none());
    }
}
