//! Repository wire contracts shared by native Git and the React renderer.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphNavigation {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub history_order: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub containing_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub child: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub branch_newer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub branch_older: Option<String>,
}

/// Inclusive row intervals, usually one interval per branch even in long
/// histories. Avoid copying an ID for every ancestor of every branch.
pub type GraphAncestry = BTreeMap<String, Vec<[usize; 2]>>;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub status: String,
    pub staged: bool,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub additions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub deletions: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub cwd: String,
    pub name: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub files: Vec<GitFileEntry>,
    #[serde(default)]
    pub file_groups: GitFileGroups,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_presentation: Option<GitFilePresentation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_current: bool,
    pub bare: bool,
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<GitStatusResult>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
pub struct GitStash {
    pub name: String,
    pub hash: String,
    pub message: String,
    pub date: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositoryOperationKind {
    Idle,
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositoryOperationPhase {
    Idle,
    AwaitingContinuation,
    Conflicted,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryOperationState {
    pub kind: GitRepositoryOperationKind,
    pub phase: GitRepositoryOperationPhase,
    pub conflicts: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GitOperationOutcome {
    Completed,
    AwaitingContinuation,
    Conflicted,
    Failed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GitOperationErrorKind {
    Conflict,
    DirtyWorktree,
    Authentication,
    NonFastForward,
    Network,
    WorktreeInUse,
    InvalidInput,
    CommandFailed,
    Io,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
pub struct GitCheckoutResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_kind: Option<GitOperationErrorKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    pub ok: bool,
    pub operation: String,
    pub outcome: GitOperationOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub head: Option<String>,
    pub conflicts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_kind: Option<GitOperationErrorKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitRefOperationPreflight {
    pub source: String,
    pub target: String,
    pub can_merge: bool,
    pub can_fast_forward: bool,
    pub can_rebase: bool,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub original_path: Option<String>,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetails {
    pub hash: String,
    pub parents: Vec<String>,
    pub diff_parent: Option<String>,
    pub message: String,
    pub body: String,
    pub author: String,
    pub author_email: String,
    pub authored_at: String,
    pub committer: String,
    pub committer_email: String,
    pub committed_at: String,
    pub refs: Vec<GitGraphRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub provider: Option<GitCommitProviderMetadata>,
    pub files: Vec<GitCommitFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_presentation: Option<GitFilePresentation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitProviderMetadata {
    pub provider: String,
    pub repository: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pull_request_number: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pull_request_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonDetails {
    pub from_hash: String,
    pub to_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub merge_base: Option<String>,
    pub files: Vec<GitCommitFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_presentation: Option<GitFilePresentation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
pub struct GitCommitResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum GitDiffLineType {
    Add,
    Remove,
    Context,
    Spacer,
    Hunk,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
pub struct GitDiffLine {
    pub number: Option<usize>,
    pub content: String,
    #[serde(rename = "type")]
    pub line_type: GitDiffLineType,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Default, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitHunkDiff {
    pub old_lines: Vec<GitDiffLine>,
    pub new_lines: Vec<GitDiffLine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub compact_lines: Option<Vec<GitDiffLine>>,
    pub is_binary: bool,
    pub is_new: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_image: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub raw_patch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub merge_conflict_content: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GitGraphRefKind {
    Head,
    LocalBranch,
    RemoteBranch,
    Tag,
    Stash,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphRef {
    pub full_name: String,
    pub display_name: String,
    pub label: String,
    pub kind: GitGraphRefKind,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub remote_name: Option<String>,
    pub is_head: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ahead: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub behind: Option<usize>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    #[serde(default)]
    pub navigation: GraphNavigation,
    /// Stable graph-item identity. Commit items use their object ID; synthetic
    /// worktree items use a repository-local `wip` identity.
    pub id: String,
    pub item_kind: GitGraphItemKind,
    pub hash: String,
    pub message: String,
    pub body: String,
    pub author: String,
    pub author_email: String,
    pub committer: String,
    pub committer_email: String,
    pub date: String,
    pub authored_at: String,
    pub committed_at: String,
    pub parents: Vec<String>,
    pub refs: Vec<GitGraphRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stash_name: Option<String>,
    pub column: usize,
    pub color_index: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GitGraphItemKind {
    #[default]
    Commit,
    WorktreeWip,
    Stash,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphRail {
    pub column: usize,
    pub color_index: usize,
    /// A tip created on this row starts at the node instead of implying an
    /// incoming edge from the row above.
    #[serde(default)]
    pub starts_at_node: bool,
    /// A root or consumed edge ends at the node instead of continuing below.
    #[serde(default)]
    pub ends_at_node: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphTransition {
    pub from_column: usize,
    pub to_column: usize,
    pub color_index: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    pub row: usize,
    pub rails: Vec<GraphRail>,
    pub transitions: Vec<GraphTransition>,
    /// Multiple child edges may target the same commit. Keep those edges in
    /// distinct lanes until this row, then converge them into the node lane.
    #[serde(default)]
    pub convergences: Vec<GraphTransition>,
    pub truncated_edges: Vec<GraphRail>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphSnapshot {
    #[serde(default)]
    pub ancestry: GraphAncestry,
    pub commits: Vec<GraphCommit>,
    pub rows: Vec<GraphRow>,
    pub has_more: bool,
    pub worktrees: Vec<GitWorktree>,
    pub stashes: Vec<GitStash>,
    pub revision: String,
    pub operation: GitRepositoryOperationState,
    pub state: GitRepositorySnapshotState,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub state_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositorySnapshotState {
    Ready,
    Unborn,
    Empty,
    NonRepository,
    CommandFailed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitFileTreeNode {
    pub name: String,
    pub path: String,
    pub children: Vec<GitFileTreeNode>,
    pub file_range: [usize; 2],
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitFilePresentation {
    pub path_order: Vec<String>,
    pub tree_order: Vec<String>,
    pub tree: Vec<GitFileTreeNode>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize, ts_rs::TS)]
pub struct GitFileGroups {
    pub staged: Vec<GitFileEntry>,
    pub modified: Vec<GitFileEntry>,
    pub untracked: Vec<GitFileEntry>,
}
impl GitFileGroups {
    pub fn from_files(files: &[GitFileEntry]) -> Self {
        let mut groups = Self::default();
        for file in files {
            let group = if file.staged {
                &mut groups.staged
            } else if file.status == "?" {
                &mut groups.untracked
            } else {
                &mut groups.modified
            };
            group.push(file.clone());
        }
        groups
    }
}

#[derive(Default)]
struct Node {
    children: BTreeMap<String, Node>,
    file: bool,
}

impl GitFilePresentation {
    pub fn from_paths(mut paths: Vec<String>) -> Self {
        paths.sort();
        paths.dedup();
        let mut root = Node::default();
        for path in &paths {
            let mut node = &mut root;
            // Bound wire/render depth while keeping deep tails as a single leaf.
            for part in path.splitn(32, '/') {
                node = node.children.entry(part.into()).or_default();
            }
            node.file = true;
        }
        let mut tree_order = Vec::new();
        let tree = children(&root, "", &mut tree_order);
        Self {
            path_order: paths,
            tree_order,
            tree,
        }
    }
}

fn children(node: &Node, parent: &str, order: &mut Vec<String>) -> Vec<GitFileTreeNode> {
    node.children
        .iter()
        .map(|(name, child)| {
            let path = if parent.is_empty() {
                name.clone()
            } else {
                format!("{parent}/{name}")
            };
            let start = order.len();
            let descendants = if child.file {
                order.push(path.clone());
                Vec::new()
            } else {
                children(child, &path, order)
            };
            GitFileTreeNode {
                name: name.clone(),
                path,
                children: descendants,
                file_range: [start, order.len()],
            }
        })
        .collect()
}

#[cfg(test)]
mod file_presentation_tests {
    use super::*;

    #[test]
    fn file_order_deduplicates_and_preserves_tree_ranges_and_depth_limit() {
        let paths = ["a.z", "a/file", "b", "a/file", "b/hidden-by-file", "z/last"];
        let presentation = GitFilePresentation::from_paths(paths.map(str::to_owned).to_vec());
        assert_eq!(
            presentation.path_order,
            ["a.z", "a/file", "b", "b/hidden-by-file", "z/last"]
        );
        assert_eq!(presentation.tree_order, ["a/file", "a.z", "b", "z/last"]);
        assert_eq!(presentation.tree[0].name, "a");
        assert_eq!(presentation.tree[0].file_range, [0, 1]);
        assert_eq!(presentation.tree[0].children[0].path, "a/file");
        assert!(presentation.tree[2].children.is_empty());
        let deep = (0..40).map(|i| i.to_string()).collect::<Vec<_>>().join("/");
        let presentation = GitFilePresentation::from_paths(vec![deep.clone()]);
        assert_eq!(presentation.tree_order, [deep]);
        let mut node = &presentation.tree[0];
        let mut depth = 1;
        while let Some(child) = node.children.first() {
            node = child;
            depth += 1;
        }
        assert_eq!(depth, 32);
        assert!(node.name.contains('/'));
    }
}
