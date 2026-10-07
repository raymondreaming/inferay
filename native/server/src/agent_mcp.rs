//! Explicit provider MCP selection. An unavailable selection never widens to
//! ambient servers; an omitted selection keeps the provider's normal inventory.
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    ffi::{OsStr, OsString},
    path::Path,
};

pub(crate) fn overrides(env: &HashMap<OsString, OsString>) -> HashMap<String, bool> {
    env.get(OsStr::new("INFERAY_MCP_OVERRIDES"))
        .and_then(|value| serde_json::from_str(&value.to_string_lossy()).ok())
        .unwrap_or_default()
}

pub(crate) fn claude_policy(env: &HashMap<OsString, OsString>) -> String {
    let mut denied = vec![
        json!({"serverName":"GitKraken"}),
        json!({"serverName":"gitkraken"}),
    ];
    denied.extend(
        overrides(env)
            .into_iter()
            .filter(|(_, enabled)| !enabled)
            .map(|(name, _)| json!({"serverName":name})),
    );
    json!({"deniedMcpServers": denied}).to_string()
}

pub(crate) fn codex(
    params: &mut Value,
    config: &Value,
    overrides: &HashMap<String, bool>,
    wanted: Option<&[String]>,
) -> Result<(), String> {
    let available = config["mcp_servers"].as_object();
    if let Some(wanted) = wanted {
        for name in wanted {
            let entry = available
                .and_then(|servers| servers.get(name))
                .ok_or_else(|| {
                    format!("Requested MCP server '{name}' is not configured for Codex")
                })?;
            if name.eq_ignore_ascii_case("gitkraken")
                || !overrides
                    .get(name)
                    .copied()
                    .unwrap_or(entry["enabled"] != false)
            {
                return Err(format!("Requested MCP server '{name}' is disabled"));
            }
        }
    }
    let mut scoped = serde_json::Map::new();
    if let Some(available) = available {
        for name in available.keys() {
            let enabled = if name.eq_ignore_ascii_case("gitkraken") {
                Some(false)
            } else if let Some(wanted) = wanted {
                Some(wanted.contains(name))
            } else {
                overrides.get(name).copied()
            };
            if let Some(enabled) = enabled {
                // A nested object preserves literal server names, including dots.
                // Codex merges it into the effective configuration for this thread.
                scoped.insert(name.clone(), json!({"enabled": enabled}));
            }
        }
    }
    if wanted.is_some() || !scoped.is_empty() {
        params["config"]["mcp_servers"] = Value::Object(scoped);
    }
    Ok(())
}

pub(crate) fn claude(
    wanted: &[String],
    env: &HashMap<OsString, OsString>,
    cwd: &Path,
) -> Result<tempfile::NamedTempFile, String> {
    let mut scoped = serde_json::Map::new();
    // An explicitly empty selection must work without any personal config.
    if !wanted.is_empty() {
        let home = env
            .get(OsStr::new("CLAUDE_CONFIG_DIR"))
            .filter(|path| !path.is_empty())
            .or_else(|| env.get(OsStr::new("HOME")).filter(|path| !path.is_empty()))
            .ok_or("Cannot resolve Claude configuration for the requested MCP servers")?;
        let file = std::fs::File::open(cwd.join(home).join(".claude.json"))
            .map_err(|_| "Cannot read Claude configuration for the requested MCP servers")?;
        // Do not include file contents or parser diagnostics: config can contain credentials.
        let config: Value =
            serde_json::from_reader(file).map_err(|_| "Claude configuration is not valid JSON")?;
        let overrides = overrides(env);
        for name in wanted {
            if name == "inferay"
                || name.eq_ignore_ascii_case("gitkraken")
                || overrides.get(name) == Some(&false)
            {
                return Err(format!(
                    "Requested MCP server '{name}' is unavailable under Inferay policy"
                ));
            }
            let entry = config["mcpServers"]
                .get(name)
                .filter(|entry| entry.is_object())
                .ok_or_else(|| {
                    format!("Requested MCP server '{name}' is not configured at Claude user scope")
                })?;
            scoped.insert(name.clone(), entry.clone());
        }
    }
    let file = tempfile::Builder::new()
        .prefix("inferay-mcp-")
        .suffix(".json")
        .tempfile()
        .map_err(|_| "Cannot create scoped Claude MCP configuration")?;
    serde_json::to_writer(&file, &json!({"mcpServers": scoped}))
        .map_err(|_| "Cannot write scoped Claude MCP configuration")?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_selection_is_exact_and_preserves_disabled_policy() {
        let config = json!({"mcp_servers": {
            "selected.server": {"command":"selected"},
            "other": {"command":"unrelated"},
            "disabled": {"enabled":false},
            "GitKraken": {"enabled":true}
        }});
        let original = config.clone();
        let mut params = json!({"config":{}});
        codex(
            &mut params,
            &config,
            &HashMap::new(),
            Some(&["selected.server".into()]),
        )
        .unwrap();
        assert_eq!(
            params["config"]["mcp_servers"],
            json!({
                "selected.server":{"enabled":true}, "other":{"enabled":false},
                "disabled":{"enabled":false}, "GitKraken":{"enabled":false}
            })
        );
        assert_eq!(config, original);
        for name in ["missing", "disabled", "GitKraken"] {
            assert!(codex(&mut params, &config, &HashMap::new(), Some(&[name.into()])).is_err());
        }
        codex(&mut params, &config, &HashMap::new(), Some(&[])).unwrap();
        assert!(
            params["config"]["mcp_servers"]
                .as_object()
                .unwrap()
                .values()
                .all(|server| server["enabled"] == false)
        );
        params = json!({"config":{}});
        codex(&mut params, &config, &HashMap::new(), None).unwrap();
        assert_eq!(
            params["config"]["mcp_servers"],
            json!({"GitKraken":{"enabled":false}})
        );
    }

    #[test]
    fn claude_empty_selection_never_reads_or_inherits_personal_configuration() {
        let file = claude(&[], &HashMap::new(), Path::new("/")).unwrap();
        let config: Value = serde_json::from_reader(file.reopen().unwrap()).unwrap();
        assert_eq!(config, json!({"mcpServers":{}}));
        assert!(claude(&["missing".into()], &HashMap::new(), Path::new("/")).is_err());
    }

    #[test]
    fn claude_uses_the_run_home_and_never_falls_back_on_missing_or_invalid_config() {
        let home = tempfile::tempdir().unwrap();
        let custom = tempfile::tempdir().unwrap();
        let env = HashMap::from([
            ("HOME".into(), home.path().as_os_str().to_owned()),
            (
                "CLAUDE_CONFIG_DIR".into(),
                custom.path().as_os_str().to_owned(),
            ),
        ]);
        std::fs::write(
            home.path().join(".claude.json"),
            r#"{"mcpServers":{"chosen":{"command":"wrong-home"}}}"#,
        )
        .unwrap();
        let wanted = ["chosen".into()];
        assert!(claude(&wanted, &env, Path::new("/")).is_err());
        let path = custom.path().join(".claude.json");
        let content = json!({"mcpServers": {
            "chosen":{"type":"http","url":"https://example.test/mcp","headers":{"Authorization":"test-private-value"}},
            "unrelated":{"command":"never-start"}
        }}).to_string();
        std::fs::write(&path, &content).unwrap();
        let file = claude(&wanted, &env, Path::new("/")).unwrap();
        let config: Value = serde_json::from_reader(file.reopen().unwrap()).unwrap();
        assert_eq!(config["mcpServers"].as_object().unwrap().len(), 1);
        assert_eq!(
            config["mcpServers"]["chosen"]["headers"]["Authorization"],
            "test-private-value"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        assert!(
            claude(&["absent".into()], &env, Path::new("/"))
                .unwrap_err()
                .contains("absent")
        );
        std::fs::write(&path, "test-private-value invalid JSON").unwrap();
        let error = claude(&wanted, &env, Path::new("/")).unwrap_err();
        assert!(!error.contains("test-private-value"));
    }
}
