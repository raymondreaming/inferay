use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionInfo {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub revision: String,
}

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

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionAccess {
    pub request: ToolConnection,
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
                    request: serde_json::from_value(
                        snapshot["connectionRequests"][&tool_id][&alias].clone(),
                    )?,
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

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolConnection {
    pub id: String,
    pub base_url: String,
    pub header: String,
    pub prefix: String,
}
impl ToolConnection {
    pub fn validate(&self) -> Result<(), String> {
        uuid::Uuid::parse_str(&self.id).map_err(|_| "Connection IDs must be UUIDs")?;
        let url = url::Url::parse(&self.base_url)
            .map_err(|_| "Connection baseUrl must be an absolute HTTPS URL")?;
        if self.base_url.len() > 2048
            || url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.path().ends_with('/')
        {
            return Err("Connection baseUrl must use HTTPS, end in /, and contain no credentials, query or fragment".into());
        }
        if self.header.is_empty()
            || self.header.len() > 64
            || !self
                .header
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err("Connection header must be a bounded HTTP header name".into());
        }
        if [
            "host",
            "content-length",
            "transfer-encoding",
            "connection",
            "proxy-authorization",
            "cookie",
        ]
        .contains(&self.header.to_ascii_lowercase().as_str())
        {
            return Err("This header cannot carry a connection credential".into());
        }
        if self.prefix.len() > 64 || !self.prefix.bytes().all(|c| (b' '..=b'~').contains(&c)) {
            return Err(
                "Connection prefix must contain at most 64 printable ASCII characters".into(),
            );
        }
        Ok(())
    }
}
