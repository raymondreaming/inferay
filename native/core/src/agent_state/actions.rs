//! Workspace transitions have no HTTP, filesystem, or renderer dependencies.
use super::{Group, Pane, Workspace, WorkspaceSelection, repository_path};
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

    /// Returns whether the visible selection changed. Stale targets leave it intact.
    pub fn select(&mut self, selection: &WorkspaceSelection) -> bool {
        let Some(group) = self
            .groups
            .iter_mut()
            .find(|group| group.id == selection.group_id)
        else {
            return false;
        };
        if selection
            .pane_id
            .as_ref()
            .is_some_and(|id| !group.panes.iter().any(|pane| &pane.id == id))
        {
            return false;
        }
        let changed = self.selected_group_id != selection.group_id
            || selection
                .pane_id
                .as_ref()
                .is_some_and(|id| group.selected_pane_id.as_ref() != Some(id));
        if let Some(pane) = &selection.pane_id {
            group.selected_pane_id = Some(pane.clone());
        }
        self.selected_group_id.clone_from(&selection.group_id);
        changed
    }

    pub fn apply_action(
        &mut self,
        action: &AgentWorkspaceAction,
        default_kind: &str,
    ) -> Result<(), String> {
        use AgentWorkspaceAction::*;
        match action {
            ReorderRepository { cwd, before_cwd } => {
                self.repository_order = reorder_repositories(
                    self.repository_paths(),
                    repository_path(cwd),
                    before_cwd.as_deref().map(repository_path),
                )?;
            }

            SelectRepository { .. } | SelectWorkspace { .. } | SelectPane { .. } => {
                if let Some(selection) = self.selection_for(action) {
                    self.select(&selection);
                    self.compact();
                } else {
                    match action {
                        SelectWorkspace { .. } => return Err("Workspace not found".into()),
                        SelectPane { .. } => return Err("Pane not found".into()),
                        _ => {}
                    }
                }
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
            RemovePane { pane_id } => self.remove_pane(pane_id, default_kind)?,
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
            DirectorySelected {
                pane_id,
                path,
                reference_paths,
            } => {
                let pane = self.pane_mut(pane_id)?;
                pane.cwd = path.clone();
                pane.pending_cwd = false;
                pane.reference_paths = reference_paths.clone().unwrap_or_default();
                pane.pending_workspace_paths.clear();
                pane.update_title();
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
}

impl Pane {
    fn set_agent_kind(&mut self, kind: &str) {
        self.agent_kind = kind.into();
        self.provider_session_id = None;
        self.update_title();
    }
}

/// Shared by persisted actions and optimistic tab ordering.
fn reorder_repositories(
    mut paths: Vec<String>,
    cwd: &str,
    before: Option<&str>,
) -> Result<Vec<String>, String> {
    let from = paths
        .iter()
        .position(|p| p == cwd)
        .ok_or("Repository not found")?;
    if before == Some(cwd) {
        return Ok(paths);
    }
    let path = paths.remove(from);
    let to = match before {
        Some(before) => paths
            .iter()
            .position(|p| p == before)
            .ok_or("Target repository not found")?,
        None => paths.len(),
    };
    paths.insert(to, path);
    Ok(paths)
}
