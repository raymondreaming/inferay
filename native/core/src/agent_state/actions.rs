//! Workspace transitions have no HTTP, filesystem, or renderer dependencies.
use super::{Group, Pane, Workspace, repository_path};
use crate::workspace_action::AgentWorkspaceAction;

impl Workspace {
    /// Stages picker results for first-send consumption without changing the current directory.
    pub fn set_pending_workspace(&mut self, id: &str, paths: Vec<String>) -> Result<(), String> {
        self.pane_mut(id)?.pending_workspace_paths =
            paths.into_iter().filter(|path| !path.is_empty()).collect();
        Ok(())
    }

    pub fn consume_pending_workspace(
        &mut self,
        id: &str,
    ) -> Result<Option<(String, Vec<String>)>, String> {
        let pane = self.pane_mut(id)?;
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
        Ok(Some((cwd, references)))
    }

    pub fn set_pane_summary(&mut self, id: &str, summary: Option<String>) -> Result<(), String> {
        self.pane_mut(id)?.summary = summary;
        Ok(())
    }

    pub fn set_pane_provider_session(
        &mut self,
        id: &str,
        session: Option<String>,
    ) -> Result<(), String> {
        self.pane_mut(id)?.provider_session_id = session;
        Ok(())
    }

    pub fn apply_action(
        &mut self,
        action: &AgentWorkspaceAction,
        default_kind: &str,
    ) -> Result<(), String> {
        use AgentWorkspaceAction::*;
        match action {
            ReorderRepository { cwd, before_cwd } => {
                let cwd = repository_path(cwd);
                let mut order = self.repository_paths();
                let from = order
                    .iter()
                    .position(|path| path == cwd)
                    .ok_or("Repository not found")?;
                let before = before_cwd.as_deref().map(repository_path);
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
            SelectRepository { cwd } => {
                let target = self
                    .groups
                    .iter()
                    .flat_map(|group| {
                        group
                            .panes
                            .iter()
                            .filter(move |pane| {
                                pane.cwd
                                    .as_deref()
                                    .is_some_and(|path| repository_path(path) == cwd)
                            })
                            .map(move |pane| (group, pane))
                    })
                    .min_by_key(|(group, pane)| {
                        if group.id == self.selected_group_id {
                            0
                        } else if group.selected_pane_id.as_deref() == Some(&pane.id) {
                            1
                        } else {
                            2
                        }
                    })
                    .map(|(group, pane)| SelectPane {
                        group_id: group.id.clone(),
                        pane_id: pane.id.clone(),
                    });
                if let Some(target) = target {
                    self.apply_action(&target, default_kind)?;
                }
            }
            SelectWorkspace { group_id } | SelectPane { group_id, .. } => {
                let group = self.group(group_id)?;
                if let SelectPane { pane_id, .. } = action {
                    if !group.panes.iter().any(|pane| &pane.id == pane_id) {
                        return Err("Pane not found".into());
                    }
                    group.selected_pane_id = Some(pane_id.clone());
                }
                self.selected_group_id = group_id.clone();
                self.compact();
            }
            AddWorkspace => {
                self.compact();
                let selected = self.group(&self.selected_group_id.clone())?;
                let (columns, rows) = (selected.columns, selected.rows);
                let group = Group::new(
                    format!("Workspace {}", self.groups.len() + 1),
                    default_kind,
                    columns,
                    rows,
                );
                self.selected_group_id = group.id.clone();
                self.groups.push(group);
            }
            RemoveWorkspace { group_id } => {
                if self.groups.len() > 1 {
                    self.groups.retain(|group| &group.id != group_id);
                }
            }
            RenameWorkspace { group_id, name } => {
                let name = name.trim();
                if !name.is_empty() {
                    self.group(group_id)?.name = name.into();
                }
            }
            AddPane {
                group_id,
                agent_kind,
                cwd,
                reference_paths,
            } => {
                let id = group_id.as_ref().unwrap_or(&self.selected_group_id).clone();
                let mut pane = Pane::new(
                    agent_kind
                        .as_ref()
                        .map_or(default_kind, |kind| kind.as_str()),
                );
                if let Some(cwd) = cwd {
                    pane.cwd = Some(cwd.clone());
                    pane.pending_cwd = false;
                    pane.update_title();
                }
                pane.reference_paths = reference_paths.clone().unwrap_or_default();
                self.group(&id)?.add(pane);
                self.selected_group_id = id;
            }
            RemovePane { group_id, pane_id } => {
                self.remove_pane(group_id, pane_id, default_kind)?
            }
            ReorderPanes {
                group_id,
                from_index,
                to_index,
            } => {
                let group = self.group(group_id)?;
                if *from_index < group.panes.len() && *to_index < group.panes.len() {
                    let pane = group.panes.remove(*from_index);
                    group.panes.insert(*to_index, pane);
                }
            }
            SetGridDimensions {
                group_id,
                columns,
                rows,
            } => {
                let group = self.group(group_id)?;
                for (key, value, target) in [
                    ("columns", columns, &mut group.columns),
                    ("rows", rows, &mut group.rows),
                ] {
                    if let Some(value) = value {
                        if *value == 0 {
                            return Err(format!("Invalid {key}"));
                        }
                        *target = *value;
                    }
                }
            }
            SetTheme { theme_id } => {
                if !matches!(theme_id.as_str(), "default" | "midnight") {
                    return Err("Unknown themeId".into());
                }
                self.theme_id = theme_id.clone();
            }
            DirectorySelected {
                group_id,
                pane_id,
                path,
                reference_paths,
            } => {
                let pane = self.group_pane_mut(group_id, pane_id)?;
                pane.cwd = path.clone();
                pane.pending_cwd = false;
                pane.reference_paths = reference_paths.clone().unwrap_or_default();
                pane.pending_workspace_paths.clear();
                pane.update_title();
            }
            SetPaneAgentKind {
                group_id,
                pane_id,
                agent_kind,
            } => {
                let pane = self.group_pane_mut(group_id, pane_id)?;
                pane.set_agent_kind(agent_kind.as_str());
            }
            ChangePaneAgentKind {
                pane_id,
                agent_kind,
            } => {
                self.pane_mut(pane_id)?.set_agent_kind(agent_kind.as_str());
            }
        }
        Ok(())
    }

    fn group_pane_mut(&mut self, group_id: &str, pane_id: &str) -> Result<&mut Pane, String> {
        self.group(group_id)?
            .panes
            .iter_mut()
            .find(|pane| pane.id == pane_id)
            .ok_or_else(|| "Pane not found".into())
    }
}

impl Pane {
    fn set_agent_kind(&mut self, kind: &str) {
        self.agent_kind = kind.into();
        self.provider_session_id = None;
        self.update_title();
    }
}
