//! The workspace file has one schema and one writer: validated workspace actions.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, path::PathBuf};
use uuid::Uuid;

#[derive(Debug)]
pub struct AgentStateStore {
    path: PathBuf,
}

impl AgentStateStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> Result<Option<Workspace>, String> {
        match std::fs::read(&self.path) {
            Ok(bytes) => {
                let mut state: Workspace =
                    serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                state.validate()?;
                Ok(Some(state))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn read(&self) -> Result<Value, String> {
        self.load()?
            .map(|state| state.presentation())
            .transpose()
            .map(|state| state.unwrap_or(Value::Null))
    }

    pub fn pane(&self, id: &str) -> Result<Option<Pane>, String> {
        Ok(self
            .load()?
            .into_iter()
            .flat_map(|state| state.groups)
            .flat_map(|group| group.panes)
            .find(|pane| pane.id == id))
    }

    /// Stages a repository picker result without committing it to the pane.
    /// Chat messages use these methods on the websocket thread so staging and
    /// first-send consumption have one ordering boundary.
    pub fn set_pending_workspace(&self, id: &str, paths: Vec<String>) -> Result<Value, String> {
        let mut state = self.load()?.ok_or("Workspace not initialized")?;
        let pane = state.pane_mut(id)?;
        pane.pending_workspace_paths = paths.into_iter().filter(|path| !path.is_empty()).collect();
        self.save(&state)
    }

    pub fn consume_pending_workspace(
        &self,
        id: &str,
    ) -> Result<Option<(String, Vec<String>)>, String> {
        let mut state = self.load()?.ok_or("Workspace not initialized")?;
        let pane = state.pane_mut(id)?;
        if pane.cwd.as_deref().is_some_and(|cwd| !cwd.is_empty())
            || pane.pending_workspace_paths.is_empty()
        {
            return Ok(None);
        }
        let paths = std::mem::take(&mut pane.pending_workspace_paths);
        let cwd = paths[0].clone();
        let references = paths[1..].to_vec();
        pane.cwd = Some(cwd.clone());
        pane.pending_cwd = false;
        pane.reference_paths = references.clone();
        pane.update_title();
        self.save(&state)?;
        Ok(Some((cwd, references)))
    }

    /// Selected pane first, then the other panes in the selected group.
    pub fn active_cwds(&self) -> Result<Vec<String>, String> {
        let Some(state) = self.load()? else {
            return Ok(Vec::new());
        };
        let Some(mut group) = state
            .groups
            .into_iter()
            .find(|group| group.id == state.selected_group_id)
        else {
            return Ok(Vec::new());
        };
        group
            .panes
            .sort_by_key(|pane| group.selected_pane_id.as_deref() != Some(pane.id.as_str()));
        Ok(group
            .panes
            .into_iter()
            .filter_map(|pane| pane.cwd)
            .filter(|cwd| !cwd.is_empty())
            .collect())
    }

    pub fn initialize(&self, default_kind: &str) -> Result<Value, String> {
        self.save(&self.load()?.unwrap_or_else(|| Workspace::new(default_kind)))
    }

    pub fn apply_workspace_action(&self, action: &Value) -> Result<Value, String> {
        let mut state = self
            .load()?
            .unwrap_or_else(|| Workspace::new(default_kind(action)));
        state.apply(action)?;
        state.validate()?;
        self.save(&state)
    }

    fn save(&self, state: &Workspace) -> Result<Value, String> {
        let value = serde_json::to_value(state).map_err(|e| e.to_string())?;
        crate::atomic_write::overwrite(
            &self.path,
            &serde_json::to_vec(&value).map_err(|e| e.to_string())?,
        )?;
        state.presentation()
    }
}

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

#[derive(Serialize, Deserialize, ts_rs::TS)]
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

fn default_kind(action: &Value) -> &str {
    if action["defaultAgentKind"] == "claude" {
        "claude"
    } else {
        "codex"
    }
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("{key} must be a string"))
}
fn kind(value: &str) -> Result<&str, String> {
    if matches!(value, "claude" | "codex" | "agent") {
        Ok(value)
    } else {
        Err("Unknown agentKind".into())
    }
}
fn paths(value: &Value) -> Result<Vec<String>, String> {
    if value.is_null() {
        Ok(Vec::new())
    } else {
        serde_json::from_value(value.clone()).map_err(|e| e.to_string())
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
    fn repository_paths(&self) -> Vec<String> {
        let mut paths = Vec::new();
        for pane in self.groups.iter().flat_map(|group| &group.panes) {
            let path = repository_path(pane.cwd.as_deref().unwrap_or(""));
            if !path.is_empty() && !paths.iter().any(|existing| existing == path) {
                paths.push(path.to_owned());
            }
        }
        paths.sort_by_key(|path| {
            self.repository_order
                .iter()
                .position(|saved| saved == path)
                .unwrap_or(usize::MAX)
        });
        paths
    }

    fn pane_mut(&mut self, id: &str) -> Result<&mut Pane, String> {
        self.groups
            .iter_mut()
            .flat_map(|group| &mut group.panes)
            .find(|pane| pane.id == id)
            .ok_or_else(|| "Pane not found".into())
    }
    fn presentation(&self) -> Result<Value, String> {
        let mut workspaces: Vec<RepositoryWorkspace<'_>> = Vec::new();
        let mut unassigned_entries = Vec::new();
        for group in &self.groups {
            for pane in &group.panes {
                let cwd = repository_path(pane.cwd.as_deref().unwrap_or(""));
                let entry = RepositoryWorkspaceEntry {
                    group_id: &group.id,
                    pane,
                };
                if cwd.is_empty() {
                    unassigned_entries.push(entry);
                } else if let Some(workspace) =
                    workspaces.iter_mut().find(|workspace| workspace.cwd == cwd)
                {
                    workspace.entries.push(entry);
                } else {
                    let name = cwd
                        .rsplit(['/', '\\'])
                        .find(|part| !part.is_empty())
                        .unwrap_or(cwd);
                    workspaces.push(RepositoryWorkspace {
                        cwd,
                        name,
                        entries: vec![entry],
                    });
                }
            }
        }
        workspaces.sort_by_key(|workspace| {
            self.repository_order
                .iter()
                .position(|path| path == workspace.cwd)
                .unwrap_or(usize::MAX)
        });
        let active_path = self
            .groups
            .iter()
            .find(|group| group.id == self.selected_group_id)
            .and_then(|group| {
                group
                    .panes
                    .iter()
                    .find(|pane| Some(&pane.id) == group.selected_pane_id.as_ref())
                    .or_else(|| group.panes.first())
            })
            .and_then(|pane| pane.cwd.as_deref())
            .map(repository_path)
            .filter(|path| !path.is_empty());
        let active_workspace = active_path
            .and_then(|path| workspaces.iter().find(|workspace| workspace.cwd == path))
            .cloned();
        let visible_entries = active_workspace
            .as_ref()
            .map(|workspace| workspace.entries.clone())
            .unwrap_or_else(|| unassigned_entries.clone());
        serde_json::to_value(AgentSavedState {
            workspace: self,
            repositories: RepositoryWorkspaceIndex {
                workspaces,
                unassigned_entries,
                active_path,
                active_workspace,
                visible_entries,
            },
        })
        .map_err(|error| error.to_string())
    }

    fn new(kind: &str) -> Self {
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
    fn validate(&mut self) -> Result<(), String> {
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
    fn apply(&mut self, action: &Value) -> Result<(), String> {
        let action_type = string(action, "type")?;
        match action_type {
            "reorderRepository" => {
                let cwd = repository_path(string(action, "cwd")?);
                let mut order = self.repository_paths();
                let from = order
                    .iter()
                    .position(|path| path == cwd)
                    .ok_or("Repository not found")?;
                let before = if action["beforeCwd"].is_null() {
                    None
                } else {
                    Some(repository_path(string(action, "beforeCwd")?))
                };
                if before == Some(cwd) {
                    return Ok(());
                }
                let path = order.remove(from);
                let to = match before {
                    Some(before) => order
                        .iter()
                        .position(|path| path == before)
                        .ok_or("Target repository not found")?,
                    None => order.len(),
                };
                order.insert(to, path);
                self.repository_order = order;
            }
            "selectRepository" => {
                let cwd = string(action, "cwd")?;
                let target = self.groups.iter().flat_map(|group| {
                    group.panes.iter().filter(move |pane| pane.cwd.as_deref().is_some_and(|path| repository_path(path) == cwd))
                        .map(move |pane| (group, pane))
                }).min_by_key(|(group, pane)| {
                    if group.id == self.selected_group_id { 0 }
                    else if group.selected_pane_id.as_deref() == Some(&pane.id) { 1 }
                    else { 2 }
                }).map(|(group, pane)| serde_json::json!({"type":"selectPane","groupId":group.id,"paneId":pane.id}));
                if let Some(target) = target {
                    self.apply(&target)?;
                }
            }
            "selectWorkspace" | "selectPane" => {
                let id = string(action, "groupId")?;
                let group = self.group(id)?;
                if action_type == "selectPane" {
                    let pane = string(action, "paneId")?;
                    if !group.panes.iter().any(|p| p.id == pane) {
                        return Err("Pane not found".into());
                    }
                    group.selected_pane_id = Some(pane.into());
                }
                self.selected_group_id = id.into();
                self.compact();
            }
            "addWorkspace" => {
                self.compact();
                let selected = self.group(&self.selected_group_id.clone())?;
                let (columns, rows) = (selected.columns, selected.rows);
                let group = Group::new(
                    format!("Workspace {}", self.groups.len() + 1),
                    default_kind(action),
                    columns,
                    rows,
                );
                self.selected_group_id = group.id.clone();
                self.groups.push(group);
            }
            "removeWorkspace" => {
                let id = string(action, "groupId")?;
                if self.groups.len() > 1 {
                    self.groups.retain(|g| g.id != id);
                }
            }
            "renameWorkspace" => {
                let name = string(action, "name")?.trim();
                if !name.is_empty() {
                    self.group(string(action, "groupId")?)?.name = name.into();
                }
            }
            "addPane" => {
                let id = action["groupId"]
                    .as_str()
                    .unwrap_or(&self.selected_group_id)
                    .to_owned();
                let mut pane = Pane::new(kind(
                    action["agentKind"].as_str().unwrap_or(default_kind(action)),
                )?);
                if let Some(cwd) = action["cwd"].as_str() {
                    pane.cwd = Some(cwd.into());
                    pane.pending_cwd = false;
                    pane.update_title();
                }
                pane.reference_paths = paths(&action["referencePaths"])?;
                self.group(&id)?.add(pane);
                self.selected_group_id = id;
            }
            "removePane" => {
                let group_id = string(action, "groupId")?;
                let id = string(action, "paneId")?;
                self.remove_pane(group_id, id, default_kind(action))?;
            }
            "reorderPanes" => {
                let group = self.group(string(action, "groupId")?)?;
                let index = |key| {
                    action[key]
                        .as_u64()
                        .and_then(|n| usize::try_from(n).ok())
                        .ok_or_else(|| format!("Invalid {key}"))
                };
                let (from, to) = (index("fromIndex")?, index("toIndex")?);
                if from < group.panes.len() && to < group.panes.len() {
                    let pane = group.panes.remove(from);
                    group.panes.insert(to, pane);
                }
            }
            "setGridDimensions" => {
                let group = self.group(string(action, "groupId")?)?;
                for (key, target) in [("columns", &mut group.columns), ("rows", &mut group.rows)] {
                    if !action[key].is_null() {
                        *target = action[key]
                            .as_u64()
                            .filter(|n| *n > 0)
                            .ok_or_else(|| format!("Invalid {key}"))?;
                    }
                }
            }
            "setTheme" => {
                let theme = string(action, "themeId")?;
                if !matches!(theme, "default" | "midnight") {
                    return Err("Unknown themeId".into());
                }
                self.theme_id = theme.into();
            }
            "directorySelected"
            | "setPaneAgentKind"
            | "changePaneAgentKind"
            | "setPaneProviderSession"
            | "setPaneSummary" => {
                let id = string(action, "paneId")?;
                let pane = self
                    .groups
                    .iter_mut()
                    .filter(|g| action["groupId"].as_str().is_none_or(|id| g.id == id))
                    .flat_map(|g| &mut g.panes)
                    .find(|p| p.id == id)
                    .ok_or("Pane not found")?;
                match action_type {
                    "directorySelected" => {
                        pane.cwd = serde_json::from_value(action["path"].clone())
                            .map_err(|e| e.to_string())?;
                        pane.pending_cwd = false;
                        pane.reference_paths = paths(&action["referencePaths"])?;
                        pane.pending_workspace_paths.clear();
                        pane.update_title();
                    }
                    "setPaneSummary" => {
                        pane.summary = serde_json::from_value(action["summary"].clone())
                            .map_err(|e| e.to_string())?;
                    }
                    "setPaneProviderSession" => {
                        if action.get("providerSessionId").is_none() {
                            return Err("Missing providerSessionId".into());
                        }
                        pane.provider_session_id =
                            serde_json::from_value(action["providerSessionId"].clone())
                                .map_err(|e| e.to_string())?;
                        if pane.provider_session_id.is_none() {
                            pane.summary = None;
                        }
                    }
                    _ => {
                        pane.agent_kind = kind(string(action, "agentKind")?)?.into();
                        pane.provider_session_id = None;
                        pane.update_title();
                    }
                }
            }
            _ => return Err("Unknown workspace action".into()),
        }
        Ok(())
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
            self.apply(&serde_json::json!({"type":"selectRepository", "cwd":cwd}))?;
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
    fn repository_order_persists_without_reordering_chats_or_selection() {
        let workspace = deletion_workspace(
            json!([
                repository_group("a", "/a"),
                repository_group("b", "/b"),
                repository_group("c", "/c/"),
                repository_group("other", "/a")
            ]),
            "b",
        );
        let path = std::env::temp_dir().join(format!("repository-order-{}.json", Uuid::new_v4()));
        let store = AgentStateStore::new(path.clone());
        let initial = store.save(&workspace).unwrap();
        store
            .apply_workspace_action(&json!({
                "type":"reorderRepository", "cwd":"/c/", "beforeCwd":"/a"
            }))
            .unwrap();
        let result = AgentStateStore::new(path.clone()).read().unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(result["repositoryOrder"], json!(["/c", "/a", "/b"]));
        assert_eq!(result["groups"], initial["groups"]);
        assert_eq!(result["repositories"]["activePath"], "/b");
        assert_eq!(result["repositories"]["workspaces"][0]["cwd"], "/c");
        assert_eq!(
            result["repositories"]["workspaces"][1]["entries"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
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
