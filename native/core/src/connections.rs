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
