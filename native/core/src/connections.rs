//! Public connection metadata. Credential values are never part of project definitions.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionInfo {
    pub id: String,
    pub project_id: String,
    pub name: String,
    /// Changes whenever a credential is replaced; approvals can bind to this value.
    pub revision: String,
}

// Deliberately no Debug/Serialize: request bodies must not enter diagnostics or snapshots.
#[derive(Deserialize, TS)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum ConnectionCommand {
    #[serde(rename_all = "camelCase")]
    Save {
        project_id: String,
        id: Option<String>,
        expected_revision: Option<String>,
        name: String,
        secret: String,
    },
    #[serde(rename_all = "camelCase")]
    Delete {
        project_id: String,
        id: String,
        expected_revision: String,
    },
}
impl ConnectionCommand {
    pub fn project(&self) -> &str {
        match self {
            Self::Save { project_id, .. } | Self::Delete { project_id, .. } => project_id,
        }
    }
}

/// Metadata shown when reviewing the exact credential inputs of an automation.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionAccess {
    pub tool_id: String,
    pub tool_name: String,
    pub alias: String,
    pub connection: ConnectionInfo,
}
impl ConnectionAccess {
    pub fn from_snapshot(snapshot: &serde_json::Value) -> Result<Vec<Self>, serde_json::Error> {
        let Some(value) = snapshot.get("connections") else {
            return Ok(vec![]);
        };
        let captured: std::collections::BTreeMap<
            String,
            std::collections::BTreeMap<String, ConnectionInfo>,
        > = serde_json::from_value(value.clone())?;
        let mut access = Vec::new();
        for (tool_id, aliases) in captured {
            let tool_name = snapshot["connectionToolNames"][&tool_id]
                .as_str()
                .unwrap_or(&tool_id)
                .to_owned();
            for (alias, connection) in aliases {
                access.push(Self {
                    tool_id: tool_id.clone(),
                    tool_name: tool_name.clone(),
                    alias,
                    connection,
                });
            }
        }
        Ok(access)
    }
}
