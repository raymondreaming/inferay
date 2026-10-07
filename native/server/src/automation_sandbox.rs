//! Provider request policy for approved automation inputs. Interactive chats do not use it.
use inferay_core::project_files::Permission;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::Path};

#[derive(Clone)]
pub(crate) struct AutomationSandbox {
    roots: Vec<String>,
    network: bool,
}
impl AutomationSandbox {
    pub(crate) fn new(may: &BTreeSet<Permission>, repositories: &Value, project: &Path) -> Self {
        let mut roots = BTreeSet::new();
        if may.contains(&Permission::WriteRepositories) {
            if let Some(paths) = repositories.as_object() {
                roots.extend(paths.values().filter_map(Value::as_str).map(str::to_owned));
            }
        }
        if may.contains(&Permission::WriteProjectFiles) {
            roots.insert(project.to_string_lossy().into_owned());
        }
        Self {
            roots: roots.into_iter().collect(),
            network: may.contains(&Permission::Network),
        }
    }
    pub(crate) fn mode(&self) -> &'static str {
        if self.roots.is_empty() {
            "read-only"
        } else {
            "workspace-write"
        }
    }
    pub(crate) fn turn(&self) -> Value {
        if self.roots.is_empty() {
            json!({"type":"readOnly","networkAccess":self.network})
        } else {
            json!({"type":"workspaceWrite","writableRoots":self.roots,"networkAccess":self.network,"excludeSlashTmp":true,"excludeTmpdirEnvVar":true})
        }
    }
    /// Applied after user configuration translation so ambient permissions cannot widen this run.
    pub(crate) fn thread(&self, params: &mut Value, config: &Value) {
        params["sandbox"] = json!(self.mode());
        params["approvalPolicy"] = json!("never");
        params["config"]["sandbox_mode"] = json!(self.mode());
        if let Some(overrides) = params["config"].as_object_mut() {
            overrides.retain(|key, _| !key.starts_with("mcp_servers."));
        }
        params["config"]["sandbox_workspace_write"] = json!({"writable_roots":self.roots,"network_access":self.network,"exclude_slash_tmp":true,"exclude_tmpdir_env_var":true});
        if !self.network {
            params["config"]["web_search"] = json!("disabled");
        }
        // Automation MCP capabilities are supplied through the run's explicit dynamic tools.
        if let Some(servers) = config["mcp_servers"].as_object() {
            let disabled: serde_json::Map<String, Value> = servers
                .iter()
                .map(|(name, value)| {
                    let mut value = value.clone();
                    value["enabled"] = json!(false);
                    (name.clone(), value)
                })
                .collect();
            params["config"]["mcp_servers"] = json!(disabled);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_automation_limits_override_ambient_access() {
        let policy = AutomationSandbox::new(
            &BTreeSet::new(),
            &json!({"repo":"/work/repo"}),
            Path::new("/work/project"),
        );
        assert_eq!(
            policy.turn(),
            json!({"type":"readOnly","networkAccess":false})
        );
        let mut thread = json!({"sandbox":"danger-full-access","config":{"mcp_servers.ambient.enabled":true},"approvalPolicy":"on-request"});
        policy.thread(
            &mut thread,
            &json!({"mcp_servers":{"ambient":{"command":"unsafe","enabled":true}}}),
        );
        assert_eq!(thread["sandbox"], "read-only");
        assert!(
            thread["config"]
                .get("mcp_servers.ambient.enabled")
                .is_none()
        );
        assert_eq!(thread["config"]["mcp_servers"]["ambient"]["enabled"], false);
        assert_eq!(thread["config"]["web_search"], "disabled");
        let policy = AutomationSandbox::new(
            &BTreeSet::from([Permission::WriteRepositories]),
            &json!({"repo":"/work/repo"}),
            Path::new("/work/project"),
        );
        assert_eq!(policy.turn()["writableRoots"], json!(["/work/repo"]));
        assert_eq!(policy.turn()["networkAccess"], false);
        assert_eq!(policy.turn()["excludeSlashTmp"], true);
    }
}
