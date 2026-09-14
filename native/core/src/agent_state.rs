//! Workspace schema and invariants, independent of persistence and HTTP.
mod actions;
pub use actions::reorder_repositories;
mod queries;

use crate::workspace_action::AgentWorkspaceAction;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::Value;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    groups: Vec<Group>,
    selected_group_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    repository_order: Vec<String>,
    #[ts(type = "'default' | 'midnight'")]
    theme_id: String,
    font_size: f64,
    font_family: String,
    opacity: f64,
}

#[derive(Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    id: String,
    name: String,
    panes: Vec<Pane>,
    selected_pane_id: Option<String>,
    columns: u64,
    rows: u64,
}

#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Pane {
    id: String,
    title: String,
    #[ts(type = "'agent' | 'claude' | 'codex'")]
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cwd: Option<String>,
    #[serde(default)]
    pending_cwd: bool,
    #[serde(default)]
    pub reference_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub pending_workspace_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub provider_session_id: Option<String>,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSavedState<'a> {
    #[serde(flatten)]
    workspace: &'a Workspace,
    repositories: RepositoryWorkspaceIndex<'a>,
}
#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryWorkspaceEntry<'a> {
    group_id: &'a str,
    pane: &'a Pane,
}
#[derive(Clone, Serialize, ts_rs::TS)]
pub struct RepositoryWorkspace<'a> {
    cwd: &'a str,
    name: &'a str,
    entries: Vec<RepositoryWorkspaceEntry<'a>>,
}
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryWorkspaceIndex<'a> {
    workspaces: Vec<RepositoryWorkspace<'a>>,
    unassigned_entries: Vec<RepositoryWorkspaceEntry<'a>>,
    active_path: Option<&'a str>,
    active_workspace: Option<RepositoryWorkspace<'a>>,
    visible_entries: Vec<RepositoryWorkspaceEntry<'a>>,
}

fn repository_path(path: &str) -> &str {
    let path = path.trim();
    if path == "/" {
        path
    } else {
        path.trim_end_matches(['/', '\\'])
    }
}

fn kind(value: &str) -> Result<&str, String> {
    if matches!(value, "claude" | "codex" | "agent") {
        Ok(value)
    } else {
        Err("Unknown agentKind".into())
    }
}
impl Pane {
    fn new(kind: &str) -> Self {
        let mut pane = Self {
            id: Uuid::new_v4().to_string(),
            title: String::new(),
            agent_kind: kind.into(),
            cwd: None,
            pending_cwd: true,
            reference_paths: Vec::new(),
            pending_workspace_paths: Vec::new(),
            summary: None,
            provider_session_id: None,
        };
        pane.update_title();
        pane
    }
    fn update_title(&mut self) {
        self.title = self
            .cwd
            .as_deref()
            .filter(|cwd| !cwd.is_empty())
            .map(|cwd| {
                cwd.rsplit('/')
                    .next()
                    .filter(|name| !name.is_empty())
                    .unwrap_or(cwd)
            })
            .unwrap_or(match self.agent_kind.as_str() {
                "claude" => "Claude",
                "agent" => "Agent",
                _ => "Codex",
            })
            .into();
    }
    fn empty_draft(&self) -> bool {
        self.pending_cwd
            && self.cwd.as_deref().is_none_or(str::is_empty)
            && self.reference_paths.is_empty()
    }
    fn durable(&self) -> bool {
        !self.pending_cwd || self.cwd.as_deref().is_some_and(|s| !s.is_empty())
    }
}
impl Group {
    fn new(name: String, kind: &str, columns: u64, rows: u64) -> Self {
        let pane = Pane::new(kind);
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            selected_pane_id: Some(pane.id.clone()),
            panes: vec![pane],
            columns,
            rows,
        }
    }
    fn add(&mut self, pane: Pane) {
        if self.panes.len() == 1 && self.panes[0].empty_draft() && !pane.empty_draft() {
            self.panes.clear();
        }
        self.selected_pane_id = Some(pane.id.clone());
        self.panes.push(pane);
    }
    fn repair_selection(&mut self) {
        if !self
            .panes
            .iter()
            .any(|p| Some(&p.id) == self.selected_pane_id.as_ref())
        {
            self.selected_pane_id = self.panes.first().map(|p| p.id.clone());
        }
    }
}
impl Workspace {
    fn pane_mut(&mut self, id: &str) -> Result<&mut Pane, String> {
        self.groups
            .iter_mut()
            .flat_map(|group| &mut group.panes)
            .find(|pane| pane.id == id)
            .ok_or_else(|| "Pane not found".into())
    }
    pub fn new(kind: &str) -> Self {
        let group = Group::new(
            "Default".into(),
            if kind == "claude" { "claude" } else { "codex" },
            3,
            1,
        );
        Self {
            selected_group_id: group.id.clone(),
            repository_order: Vec::new(),
            groups: vec![group],
            theme_id: "default".into(),
            font_size: 13.,
            font_family: "SF Mono".into(),
            opacity: 1.,
        }
    }
    pub fn validate(&mut self) -> Result<(), String> {
        if self.groups.is_empty() {
            return Err("Workspace must contain a group".into());
        }
        let mut ids = HashSet::new();
        for group in &mut self.groups {
            if group.id.is_empty()
                || !ids.insert(group.id.clone())
                || group.columns == 0
                || group.rows == 0
            {
                return Err("Invalid workspace group".into());
            }
            for pane in &group.panes {
                kind(&pane.agent_kind)?;
                if pane.id.is_empty() || !ids.insert(pane.id.clone()) {
                    return Err("Invalid pane identity".into());
                }
            }
            group.repair_selection();
        }
        if !self.groups.iter().any(|g| g.id == self.selected_group_id) {
            self.selected_group_id = self.groups[0].id.clone();
        }
        if !self.repository_order.is_empty() {
            self.repository_order = self.repository_paths();
        }
        Ok(())
    }
    fn compact(&mut self) {
        let durable = self
            .groups
            .iter()
            .any(|g| g.panes.iter().any(Pane::durable));
        self.groups.retain(|g| {
            g.id == self.selected_group_id || (durable && g.panes.iter().any(Pane::durable))
        });
        for g in &mut self.groups {
            if g.id != self.selected_group_id {
                g.panes
                    .retain(|p| Some(&p.id) == g.selected_pane_id.as_ref() || !p.empty_draft());
                g.repair_selection();
            }
        }
    }
    fn group(&mut self, id: &str) -> Result<&mut Group, String> {
        self.groups
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| "Workspace not found".into())
    }
    #[cfg(test)]
    fn apply(&mut self, action: &Value) -> Result<(), String> {
        let default_kind = if action["defaultAgentKind"] == "claude" {
            "claude"
        } else {
            "codex"
        };
        self.apply_action(
            &serde_json::from_value(action.clone()).map_err(|error| error.to_string())?,
            default_kind,
        )
    }

    fn remove_pane(&mut self, group_id: &str, id: &str, default_kind: &str) -> Result<(), String> {
        // Capture the visible tab order before removing its last entry.
        let paths = self.repository_paths();
        let selected_group = self.selected_group_id == group_id;
        let group = self.group(group_id)?;
        let Some(pane) = group.panes.iter().find(|pane| pane.id == id) else {
            return Ok(());
        };
        let removed_path = repository_path(pane.cwd.as_deref().unwrap_or("")).to_owned();
        let selected = selected_group && group.selected_pane_id.as_deref() == Some(id);
        group.panes.retain(|pane| pane.id != id);
        group.repair_selection();
        if !selected {
            return Ok(());
        }

        // Prefer another chat in the same repository, then the nearest tab to
        // its left. Removing the first tab falls forward to the next repository.
        let index = paths
            .iter()
            .position(|path| path == &removed_path)
            .unwrap_or(paths.len());
        let preferred = std::iter::once(&removed_path)
            .chain(paths[..index].iter().rev())
            .chain(paths[index..].iter())
            .find(|path| {
                self.groups
                    .iter()
                    .flat_map(|group| &group.panes)
                    .any(|pane| {
                        !path.is_empty()
                            && repository_path(pane.cwd.as_deref().unwrap_or("")) == path.as_str()
                    })
            })
            .cloned();
        if let Some(cwd) = preferred {
            self.apply_action(
                &AgentWorkspaceAction::SelectRepository { cwd },
                default_kind,
            )?;
        } else if let Some(group) = self.groups.iter_mut().find(|group| !group.panes.is_empty()) {
            group.repair_selection();
            self.selected_group_id = group.id.clone();
        } else {
            self.group(group_id)?.add(Pane::new(default_kind));
        }
        self.compact();
        Ok(())
    }
}

#[cfg(test)]
mod presentation_tests {
    use super::*;
    use serde_json::json;

    fn deletion_workspace(groups: Value, selected: &str) -> Workspace {
        serde_json::from_value(json!({
            "groups": groups, "selectedGroupId": selected,
            "themeId":"default", "fontSize":13, "fontFamily":"SF Mono", "opacity":1
        }))
        .unwrap()
    }

    fn repository_group(id: &str, cwd: &str) -> Value {
        json!({"id":id,"name":id,"selectedPaneId":format!("{id}-chat"),"columns":1,"rows":1,
            "panes":[{"id":format!("{id}-chat"),"title":id,"agentKind":"codex","cwd":cwd}]})
    }

    #[test]
    fn repository_reordering_handles_end_noop_and_stale_targets() {
        let mut workspace = deletion_workspace(
            json!([
                repository_group("a", "/a"),
                repository_group("b", "/b"),
                repository_group("c", "/c")
            ]),
            "b",
        );
        workspace
            .apply(&json!({"type":"reorderRepository","cwd":"/a","beforeCwd":null}))
            .unwrap();
        assert_eq!(workspace.repository_paths(), ["/b", "/c", "/a"]);
        workspace
            .apply(&json!({"type":"reorderRepository","cwd":"/b","beforeCwd":"/b"}))
            .unwrap();
        assert!(
            workspace
                .apply(&json!({"type":"reorderRepository","cwd":"/c","beforeCwd":"/missing"}))
                .is_err()
        );
        assert!(
            workspace
                .apply(&json!({"type":"reorderRepository","cwd":"/missing","beforeCwd":null}))
                .is_err()
        );
        assert_eq!(workspace.repository_paths(), ["/b", "/c", "/a"]);
        workspace
            .apply(&json!({"type":"addPane","groupId":"c","cwd":"/new"}))
            .unwrap();
        workspace.validate().unwrap();
        assert_eq!(workspace.repository_paths(), ["/b", "/c", "/a", "/new"]);
    }

    #[test]
    fn closing_a_reordered_repository_selects_its_visible_left_neighbor() {
        let mut workspace = deletion_workspace(
            json!([
                repository_group("a", "/a"),
                repository_group("b", "/b"),
                repository_group("c", "/c")
            ]),
            "b",
        );
        workspace
            .apply(&json!({"type":"reorderRepository","cwd":"/c","beforeCwd":"/b"}))
            .unwrap();
        workspace
            .apply(&json!({"type":"removePane","groupId":"b","paneId":"b-chat"}))
            .unwrap();
        workspace.validate().unwrap();
        let result = workspace.presentation().unwrap();
        assert_eq!(result["repositories"]["activePath"], "/c");
        assert_eq!(workspace.repository_order, ["/a", "/c"]);
    }

    #[test]
    fn deleting_last_repository_chat_selects_previous_tab_or_next_for_first_tab() {
        for (selected, expected) in [("b", "/a"), ("a", "/b"), ("c", "/b")] {
            let mut workspace = deletion_workspace(
                json!([
                    repository_group("a", "/a"),
                    repository_group("b", "/b"),
                    repository_group("c", "/c")
                ]),
                selected,
            );
            workspace.apply(&json!({"type":"removePane","groupId":selected,"paneId":format!("{selected}-chat")})).unwrap();
            workspace.validate().unwrap();
            let saved: Workspace =
                serde_json::from_value(serde_json::to_value(&workspace).unwrap()).unwrap();
            let result = saved.presentation().unwrap();
            assert_eq!(result["repositories"]["activePath"], expected);
            assert_eq!(
                result["repositories"]["workspaces"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
        }
    }

    #[test]
    fn deleting_selected_chat_keeps_same_repository_across_groups() {
        let mut workspace = deletion_workspace(
            json!([
                repository_group("a", "/a"),
                repository_group("b", "/b/"),
                repository_group("other", "/b")
            ]),
            "b",
        );
        workspace
            .apply(&json!({"type":"removePane","groupId":"b","paneId":"b-chat"}))
            .unwrap();
        workspace.validate().unwrap();
        assert_eq!(workspace.selected_group_id, "other");
        assert_eq!(
            workspace.presentation().unwrap()["repositories"]["activePath"],
            "/b"
        );
    }

    #[test]
    fn deleting_background_chat_preserves_active_repository() {
        let mut workspace = deletion_workspace(
            json!([
                repository_group("a", "/a"),
                repository_group("b", "/b"),
                repository_group("c", "/c")
            ]),
            "c",
        );
        workspace
            .apply(&json!({"type":"removePane","groupId":"b","paneId":"b-chat"}))
            .unwrap();
        workspace.validate().unwrap();
        assert_eq!(
            workspace.presentation().unwrap()["repositories"]["activePath"],
            "/c"
        );
    }

    #[test]
    fn deleting_final_chat_leaves_a_usable_new_chat() {
        let mut workspace = deletion_workspace(json!([repository_group("a", "/a")]), "a");
        workspace.apply(&json!({"type":"removePane","groupId":"a","paneId":"a-chat","defaultAgentKind":"claude"})).unwrap();
        workspace.validate().unwrap();
        let result = workspace.presentation().unwrap();
        assert_eq!(result["repositories"]["workspaces"], json!([]));
        assert_eq!(
            result["repositories"]["visibleEntries"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            result["repositories"]["visibleEntries"][0]["pane"]["agentKind"],
            "claude"
        );
    }

    #[test]
    fn repository_projection_preserves_panes_and_normalizes_paths() {
        let workspace: Workspace = serde_json::from_value(json!({
            "groups": [{
                "id": "group", "name": "Work", "selectedPaneId": "second",
                "columns": 2, "rows": 1,
                "panes": [
                    {"id": "first", "title": "First", "agentKind": "claude", "cwd": " /repo/ "},
                    {"id": "second", "title": "Second", "agentKind": "codex", "cwd": "/repo"},
                    {"id": "draft", "title": "Draft", "agentKind": "agent"}
                ]
            }],
            "selectedGroupId": "group", "themeId": "default",
            "fontSize": 13, "fontFamily": "SF Mono", "opacity": 1
        }))
        .unwrap();
        let response = workspace.presentation().unwrap();
        let repositories = &response["repositories"];
        assert_eq!(repositories["workspaces"].as_array().unwrap().len(), 1);
        assert_eq!(repositories["activePath"], "/repo");
        assert_eq!(repositories["activeWorkspace"]["name"], "repo");
        assert_eq!(repositories["visibleEntries"].as_array().unwrap().len(), 2);
        assert_eq!(repositories["unassignedEntries"][0]["pane"]["id"], "draft");
        assert_eq!(
            repositories["visibleEntries"][0]["pane"],
            response["groups"][0]["panes"][0]
        );
        assert!(
            response["groups"][0]["panes"][0]
                .get("pendingWorkspacePaths")
                .is_none()
        );
        assert_eq!(
            response["groups"][0]["panes"][0]["referencePaths"],
            json!([])
        );
    }

    #[test]
    fn unassigned_selection_exposes_drafts_without_an_active_repository() {
        let workspace = Workspace::new("codex");
        let response = workspace.presentation().unwrap();
        let repositories = &response["repositories"];
        assert_eq!(repositories["activePath"], Value::Null);
        assert_eq!(repositories["activeWorkspace"], Value::Null);
        assert_eq!(repositories["workspaces"], json!([]));
        assert_eq!(
            repositories["visibleEntries"],
            repositories["unassignedEntries"]
        );
        assert_eq!(repositories["visibleEntries"].as_array().unwrap().len(), 1);
    }
}
