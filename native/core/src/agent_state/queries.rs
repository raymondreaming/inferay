//! Read-only workspace projections used by the server and renderer contracts.
use super::{
    AgentSavedState, Pane, RepositoryWorkspace, RepositoryWorkspaceEntry, RepositoryWorkspaceIndex,
    Workspace, repository_path,
};
use serde_json::Value;

impl Workspace {
    pub(super) fn repository_paths(&self) -> Vec<String> {
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

    pub fn presentation(&self) -> Result<Value, String> {
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

    pub fn pane(&self, id: &str) -> Option<&Pane> {
        self.groups
            .iter()
            .flat_map(|group| &group.panes)
            .find(|pane| pane.id == id)
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
