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
        serde_json::to_value(self.load()?).map_err(|e| e.to_string())
    }

    pub fn pane(&self, id: &str) -> Result<Option<Pane>, String> {
        Ok(self
            .load()?
            .into_iter()
            .flat_map(|state| state.groups)
            .flat_map(|group| group.panes)
            .find(|pane| pane.id == id))
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
        Ok(value)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    groups: Vec<Group>,
    selected_group_id: String,
    theme_id: String,
    font_size: f64,
    font_family: String,
    opacity: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Group {
    id: String,
    name: String,
    panes: Vec<Pane>,
    selected_pane_id: Option<String>,
    columns: u64,
    rows: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pane {
    id: String,
    title: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pending_cwd: bool,
    #[serde(default)]
    pub reference_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_session_id: Option<String>,
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
    fn new(kind: &str) -> Self {
        let group = Group::new(
            "Default".into(),
            if kind == "claude" { "claude" } else { "codex" },
            1,
            1,
        );
        Self {
            selected_group_id: group.id.clone(),
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
                let group = self.group(string(action, "groupId")?)?;
                let id = string(action, "paneId")?;
                group.panes.retain(|p| p.id != id);
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
            | "setPaneProviderSession" => {
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
                        pane.update_title();
                    }
                    "setPaneProviderSession" => {
                        if action.get("providerSessionId").is_none() {
                            return Err("Missing providerSessionId".into());
                        }
                        pane.provider_session_id =
                            serde_json::from_value(action["providerSessionId"].clone())
                                .map_err(|e| e.to_string())?;
                    }
                    _ => {
                        pane.agent_kind = kind(string(action, "agentKind")?)?.into();
                        pane.provider_session_id = None;
                        pane.update_title();
                    }
                }
            }
            "ensureChatPane" => {
                let group = self.group(&self.selected_group_id.clone())?;
                let selected = group
                    .panes
                    .iter()
                    .find(|p| {
                        Some(&p.id) == group.selected_pane_id.as_ref() && p.agent_kind != "agent"
                    })
                    .or_else(|| group.panes.iter().find(|p| p.agent_kind != "agent"));
                if let Some(pane) = selected {
                    group.selected_pane_id = Some(pane.id.clone());
                } else {
                    group.add(Pane::new(default_kind(action)));
                }
            }
            _ => return Err("Unknown workspace action".into()),
        }
        Ok(())
    }
}
