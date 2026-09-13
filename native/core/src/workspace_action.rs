//! Renderer workspace vocabulary. Server metadata updates use dedicated store methods.
use crate::provider_config::WorkspaceAgentKind;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentWorkspaceAction {
    ReorderRepository {
        cwd: String,
        before_cwd: Option<String>,
    },
    SelectWorkspace {
        group_id: String,
    },
    SelectRepository {
        cwd: String,
    },
    SelectPane {
        group_id: String,
        pane_id: String,
    },
    AddWorkspace,
    RemoveWorkspace {
        group_id: String,
    },
    RenameWorkspace {
        group_id: String,
        name: String,
    },
    AddPane {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        group_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        agent_kind: Option<WorkspaceAgentKind>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        reference_paths: Option<Vec<String>>,
    },
    RemovePane {
        group_id: String,
        pane_id: String,
    },
    DirectorySelected {
        group_id: String,
        pane_id: String,
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        reference_paths: Option<Vec<String>>,
    },
    SetPaneAgentKind {
        group_id: String,
        pane_id: String,
        agent_kind: WorkspaceAgentKind,
    },
    ReorderPanes {
        group_id: String,
        from_index: usize,
        to_index: usize,
    },
    SetGridDimensions {
        group_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        columns: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        rows: Option<u64>,
    },
    ChangePaneAgentKind {
        pane_id: String,
        agent_kind: WorkspaceAgentKind,
    },
    SetTheme {
        theme_id: String,
    },
}
