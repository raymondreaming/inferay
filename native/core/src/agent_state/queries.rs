//! Read-only workspace queries.
use super::{AgentWorkspaceAction, Pane, Workspace, WorkspaceSelection, repository_path};

impl Workspace {
    pub(super) fn repository_paths(&self) -> Vec<String> {
        let mut paths = Vec::new();
        for pane in self.panes() {
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

    pub fn panes(&self) -> impl Iterator<Item = &Pane> {
        self.groups.iter().flat_map(|group| &group.panes)
    }

    pub fn pane(&self, id: &str) -> Option<&Pane> {
        self.panes().find(|pane| pane.id == id)
    }

    pub fn selected_pane_id(&self) -> Option<&str> {
        self.groups
            .iter()
            .find(|group| group.id == self.selected_group_id)?
            .selected_pane_id
            .as_deref()
    }

    pub fn selection_for(&self, action: &AgentWorkspaceAction) -> Option<WorkspaceSelection> {
        use AgentWorkspaceAction::*;
        let (group, pane) = match action {
            SelectWorkspace { group_id } => (
                self.groups.iter().find(|group| &group.id == group_id)?,
                None,
            ),
            SelectPane { pane_id } => self.groups.iter().find_map(|group| {
                group
                    .panes
                    .iter()
                    .find(|pane| &pane.id == pane_id)
                    .map(|pane| (group, Some(pane)))
            })?,
            SelectRepository { cwd } => self
                .groups
                .iter()
                .flat_map(|group| {
                    group
                        .panes
                        .iter()
                        .filter(|pane| {
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
                .map(|(group, pane)| (group, Some(pane)))?,
            _ => return None,
        };
        Some(WorkspaceSelection {
            group_id: group.id.clone(),
            pane_id: pane.map(|pane| pane.id.clone()),
        })
    }

    /// Selected pane first, then the other panes in the selected group.
    pub fn active_cwds(&self) -> Vec<String> {
        let Some(group) = self
            .groups
            .iter()
            .find(|group| group.id == self.selected_group_id)
        else {
            return Vec::new();
        };
        let mut panes = group.panes.iter().collect::<Vec<_>>();
        panes.sort_by_key(|pane| group.selected_pane_id.as_deref() != Some(pane.id.as_str()));
        panes
            .into_iter()
            .filter_map(|pane| pane.cwd.as_ref())
            .filter(|cwd| !cwd.is_empty())
            .cloned()
            .collect()
    }
}
