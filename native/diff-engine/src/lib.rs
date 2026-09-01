use chrono::{Local, TimeZone};
use inferay_core::path_security::{is_safe_relative_path, AllowedPaths};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

// Keep color identities distinct through GitKraken's full ten-lane palette
// before cycling. The renderer owns the actual color values.
const GRAPH_LANE_COUNT: usize = 10;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineType {
    Unchanged,
    Added,
    Removed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub line_type: DiffLineType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line_num: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line_num: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct DiffStats {
    pub added: usize,
    pub removed: usize,
    pub unchanged: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDiff {
    pub hunks: Vec<DiffHunk>,
    pub old_lines: Vec<DiffLine>,
    pub new_lines: Vec<DiffLine>,
    pub stats: DiffStats,
    pub computed_at: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub status: String,
    pub staged: bool,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub cwd: String,
    pub name: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub files: Vec<GitFileEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_current: bool,
    pub bare: bool,
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<GitStatusResult>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GitStash {
    pub name: String,
    pub hash: String,
    pub message: String,
    pub date: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositoryOperationKind {
    Idle,
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositoryOperationPhase {
    Idle,
    AwaitingContinuation,
    Conflicted,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryOperationState {
    pub kind: GitRepositoryOperationKind,
    pub phase: GitRepositoryOperationPhase,
    pub conflicts: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitOperationOutcome {
    Completed,
    AwaitingContinuation,
    Conflicted,
    Failed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GitCheckoutResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<GitOperationErrorKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutPreflight {
    pub branch: String,
    pub branch_exists: bool,
    pub already_current: bool,
    pub clean_worktree: bool,
    pub conflicts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_out_worktree: Option<String>,
    pub can_checkout: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<GitOperationErrorKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefOperationResult {
    pub ok: bool,
    pub operation: String,
    pub outcome: GitOperationOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub conflicts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<GitOperationErrorKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefOperationPreflight {
    pub source: String,
    pub target: String,
    pub valid_refs: bool,
    pub clean_worktree: bool,
    pub source_in_other_worktree: bool,
    pub target_in_other_worktree: bool,
    pub can_merge: bool,
    pub can_fast_forward: bool,
    pub can_rebase: bool,
    pub can_interactive_rebase: bool,
    pub interactive_rebase_commits: Vec<GitCommitSummary>,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInteractiveRebaseStep {
    pub hash: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphActionResult {
    pub ok: bool,
    pub action: String,
    pub outcome: GitOperationOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub conflicts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<GitOperationErrorKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GitCommitSummary {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub line_num: usize,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
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
    pub provider: Option<GitCommitProviderMetadata>,
    pub files: Vec<GitCommitFile>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitProviderMetadata {
    pub provider: String,
    pub repository: String,
    pub repository_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request_number: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonDetails {
    pub from_hash: String,
    pub to_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_base: Option<String>,
    pub files: Vec<GitCommitFile>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GitCommitResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitDiffLineType {
    Add,
    Remove,
    Context,
    Spacer,
    Hunk,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GitDiffLine {
    pub number: Option<usize>,
    pub content: String,
    #[serde(rename = "type")]
    pub line_type: GitDiffLineType,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunkDiff {
    pub old_lines: Vec<GitDiffLine>,
    pub new_lines: Vec<GitDiffLine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compact_lines: Option<Vec<GitDiffLine>>,
    pub is_binary: bool,
    pub is_new: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_image: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_patch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_conflict_content: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GitFileWithDiff {
    Image { image_path: String },
    Text { lines: Vec<GitDiffLine> },
    Error { error: &'static str },
    AccessDenied,
}

#[derive(Clone)]
struct GitCommit {
    hash: String,
    message: String,
    body: String,
    author: String,
    author_email: String,
    committer: String,
    committer_email: String,
    date: String,
    authored_at: String,
    committed_at: String,
    parents: Vec<String>,
    refs: Vec<GitGraphRef>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitGraphRefKind {
    Head,
    LocalBranch,
    RemoteBranch,
    Tag,
    Stash,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphRef {
    pub full_name: String,
    pub display_name: String,
    pub kind: GitGraphRefKind,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_name: Option<String>,
    pub is_head: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
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
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stash_name: Option<String>,
    pub column: usize,
    pub color_index: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitGraphItemKind {
    Commit,
    WorktreeWip,
    Stash,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTransition {
    pub from_column: usize,
    pub to_column: usize,
    pub color_index: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphSnapshot {
    pub commits: Vec<GraphCommit>,
    pub rows: Vec<GraphRow>,
    pub has_more: bool,
    pub worktrees: Vec<GitWorktree>,
    pub stashes: Vec<GitStash>,
    pub revision: String,
    pub operation: GitRepositoryOperationState,
    pub state: GitRepositorySnapshotState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositorySnapshotState {
    Ready,
    Unborn,
    Empty,
    NonRepository,
    CommandFailed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum NativeRequest {
    Diff { before: String, after: String },
    GitStatuses { cwds: Vec<String> },
    GitGraph { cwd: String, limit: usize },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum NativeResponse {
    Diff {
        diff: ParsedDiff,
    },
    GitStatuses {
        projects: Vec<GitStatusResult>,
    },
    GitGraph {
        commits: Vec<GraphCommit>,
        rows: Vec<GraphRow>,
    },
}

#[derive(Clone, Copy)]
enum DiffOperation {
    Removed,
    Unchanged,
    Added,
}

fn compute_line_diff(old_text: &str, new_text: &str) -> ParsedDiff {
    let old_lines: Vec<&str> = old_text.split('\n').collect();
    let new_lines: Vec<&str> = new_text.split('\n').collect();
    let m = old_lines.len();
    let n = new_lines.len();
    let mut dp = vec![vec![0u16; n + 1]; m + 1];

    for i in 1..=m {
        for j in 1..=n {
            dp[i][j] = if old_lines[i - 1] == new_lines[j - 1] {
                dp[i - 1][j - 1].saturating_add(1)
            } else {
                dp[i - 1][j].max(dp[i][j - 1])
            };
        }
    }

    let mut diff_ops: Vec<(DiffOperation, Option<usize>, Option<usize>)> = Vec::new();
    let mut i = m;
    let mut j = n;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old_lines[i - 1] == new_lines[j - 1] {
            diff_ops.push((DiffOperation::Unchanged, Some(i - 1), Some(j - 1)));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            diff_ops.push((DiffOperation::Added, None, Some(j - 1)));
            j -= 1;
        } else {
            diff_ops.push((DiffOperation::Removed, Some(i - 1), None));
            i -= 1;
        }
    }

    diff_ops.reverse();

    let mut left_lines = Vec::with_capacity(diff_ops.len());
    let mut right_lines = Vec::with_capacity(diff_ops.len());
    let mut hunks = Vec::new();
    let mut stats = DiffStats {
        added: 0,
        removed: 0,
        unchanged: 0,
    };
    let mut old_line_num = 1usize;
    let mut new_line_num = 1usize;
    let mut current_hunk: Option<DiffHunk> = None;
    let mut unchanged_count = 0usize;
    let context_lines = 3usize;

    for (op, old_idx, new_idx) in diff_ops {
        match op {
            DiffOperation::Unchanged => {
                let line = DiffLine {
                    line_type: DiffLineType::Unchanged,
                    content: old_lines[old_idx.expect("missing old index")].to_string(),
                    old_line_num: Some(old_line_num),
                    new_line_num: Some(new_line_num),
                };
                old_line_num += 1;
                new_line_num += 1;

                left_lines.push(line.clone());
                right_lines.push(line.clone());
                stats.unchanged += 1;

                if let Some(hunk) = current_hunk.as_mut() {
                    unchanged_count += 1;
                    hunk.lines.push(line);
                    if unchanged_count > context_lines * 2 {
                        if let Some(mut complete_hunk) = current_hunk.take() {
                            complete_hunk.old_count = complete_hunk
                                .lines
                                .iter()
                                .filter(|line| !matches!(line.line_type, DiffLineType::Added))
                                .count();
                            complete_hunk.new_count = complete_hunk
                                .lines
                                .iter()
                                .filter(|line| !matches!(line.line_type, DiffLineType::Removed))
                                .count();
                            hunks.push(complete_hunk);
                        }
                        unchanged_count = 0;
                    }
                }
            }
            DiffOperation::Removed => {
                let left_line = DiffLine {
                    line_type: DiffLineType::Removed,
                    content: old_lines[old_idx.expect("missing old index")].to_string(),
                    old_line_num: Some(old_line_num),
                    new_line_num: None,
                };
                old_line_num += 1;

                left_lines.push(left_line.clone());
                right_lines.push(DiffLine {
                    line_type: DiffLineType::Removed,
                    content: String::new(),
                    old_line_num: None,
                    new_line_num: None,
                });
                stats.removed += 1;
                unchanged_count = 0;

                if current_hunk.is_none() {
                    let context_start = left_lines.len().saturating_sub(1 + context_lines);
                    let mut lines = Vec::new();
                    for line in left_lines[context_start..left_lines.len().saturating_sub(1)]
                        .iter()
                        .filter(|line| matches!(line.line_type, DiffLineType::Unchanged))
                    {
                        lines.push(line.clone());
                    }
                    current_hunk = Some(DiffHunk {
                        old_start: left_line.old_line_num.unwrap_or(old_line_num),
                        old_count: 0,
                        new_start: new_line_num,
                        new_count: 0,
                        lines,
                    });
                }

                if let Some(hunk) = current_hunk.as_mut() {
                    hunk.lines.push(left_line);
                }
            }
            DiffOperation::Added => {
                let right_line = DiffLine {
                    line_type: DiffLineType::Added,
                    content: new_lines[new_idx.expect("missing new index")].to_string(),
                    old_line_num: None,
                    new_line_num: Some(new_line_num),
                };
                new_line_num += 1;

                left_lines.push(DiffLine {
                    line_type: DiffLineType::Added,
                    content: String::new(),
                    old_line_num: None,
                    new_line_num: None,
                });
                right_lines.push(right_line.clone());
                stats.added += 1;
                unchanged_count = 0;

                if current_hunk.is_none() {
                    current_hunk = Some(DiffHunk {
                        old_start: old_line_num,
                        old_count: 0,
                        new_start: right_line.new_line_num.unwrap_or(new_line_num),
                        new_count: 0,
                        lines: Vec::new(),
                    });
                }

                if let Some(hunk) = current_hunk.as_mut() {
                    hunk.lines.push(right_line);
                }
            }
        }
    }

    if let Some(mut hunk) = current_hunk {
        if !hunk.lines.is_empty() {
            hunk.old_count = hunk
                .lines
                .iter()
                .filter(|line| !matches!(line.line_type, DiffLineType::Added))
                .count();
            hunk.new_count = hunk
                .lines
                .iter()
                .filter(|line| !matches!(line.line_type, DiffLineType::Removed))
                .count();
            hunks.push(hunk);
        }
    }

    ParsedDiff {
        hunks,
        old_lines: left_lines,
        new_lines: right_lines,
        stats,
        computed_at: 0,
    }
}

fn run_git(args: &[&str], cwd: &str) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

fn run_git_timed(args: &[&str], cwd: &str, timeout: Duration) -> Option<String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let mut stderr = child.stderr.take()?;
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
    let status = match child.wait_timeout(timeout).ok()? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            // A configured external diff/textconv process can inherit these pipes.
            // Never turn a Git timeout into an unbounded wait for that descendant.
            drop(stdout_reader);
            drop(stderr_reader);
            return None;
        }
    };
    let stdout = stdout_reader.join().ok()?;
    let _ = stderr_reader.join();
    status
        .success()
        .then(|| String::from_utf8_lossy(&stdout).into_owned())
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum GitCommandFailureKind {
    SpawnFailed,
    TimedOut,
    Failed,
    InvalidOutput,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct GitCommandFailure {
    command: String,
    kind: GitCommandFailureKind,
    detail: String,
}

impl GitCommandFailure {
    fn summary(&self) -> String {
        let kind = match self.kind {
            GitCommandFailureKind::SpawnFailed => "could not start",
            GitCommandFailureKind::TimedOut => "timed out",
            GitCommandFailureKind::Failed => "failed",
            GitCommandFailureKind::InvalidOutput => "returned invalid output",
        };
        if self.detail.is_empty() {
            format!("{} {kind}", self.command)
        } else {
            format!("{} {kind}: {}", self.command, self.detail)
        }
    }
}

fn sanitized_git_error(stderr: &[u8]) -> String {
    let first_line = String::from_utf8_lossy(stderr)
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect::<String>();
    let Some(scheme) = first_line.find("://") else {
        return first_line;
    };
    let credentials_start = scheme + 3;
    let Some(at_offset) = first_line[credentials_start..].find('@') else {
        return first_line;
    };
    let at = credentials_start + at_offset;
    let credential = &first_line[credentials_start..at];
    if credential.contains(':') || credential.len() > 20 {
        format!(
            "{}***{}",
            &first_line[..credentials_start],
            &first_line[at..]
        )
    } else {
        first_line
    }
}

fn run_git_checked_timed(
    args: &[&str],
    cwd: &str,
    timeout: Duration,
) -> Result<String, GitCommandFailure> {
    let command = format!("git {}", args.first().copied().unwrap_or("command"));
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| GitCommandFailure {
            command: command.clone(),
            kind: GitCommandFailureKind::SpawnFailed,
            detail: error.to_string(),
        })?;
    let mut stdout = child.stdout.take().ok_or_else(|| GitCommandFailure {
        command: command.clone(),
        kind: GitCommandFailureKind::SpawnFailed,
        detail: "stdout was unavailable".to_string(),
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| GitCommandFailure {
        command: command.clone(),
        kind: GitCommandFailureKind::SpawnFailed,
        detail: "stderr was unavailable".to_string(),
    })?;
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
    let status = match child.wait_timeout(timeout) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            drop(stdout_reader);
            drop(stderr_reader);
            return Err(GitCommandFailure {
                command,
                kind: GitCommandFailureKind::TimedOut,
                detail: format!("after {} ms", timeout.as_millis()),
            });
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            drop(stdout_reader);
            drop(stderr_reader);
            return Err(GitCommandFailure {
                command,
                kind: GitCommandFailureKind::Failed,
                detail: error.to_string(),
            });
        }
    };
    let stdout = stdout_reader.join().map_err(|_| GitCommandFailure {
        command: command.clone(),
        kind: GitCommandFailureKind::InvalidOutput,
        detail: "stdout reader failed".to_string(),
    })?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(GitCommandFailure {
            command,
            kind: GitCommandFailureKind::Failed,
            detail: sanitized_git_error(&stderr),
        });
    }
    String::from_utf8(stdout).map_err(|error| GitCommandFailure {
        command,
        kind: GitCommandFailureKind::InvalidOutput,
        detail: error.to_string(),
    })
}

const MAX_UNTRACKED_FILE_BYTES: u64 = 500_000;
const MAX_SIMPLE_UNTRACKED_FILE_BYTES: u64 = 120_000;
const MAX_RENDERED_DIFF_LINES: usize = 12_000;
const MAX_RENDERED_LINE_CHARS: usize = 8_000;

pub fn is_changed_git_file(cwd: &str, file_path: &str) -> bool {
    if !is_safe_relative_path(file_path) {
        return false;
    }
    run_git_timed(
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            file_path,
        ],
        cwd,
        Duration::from_secs(2),
    )
    .is_some_and(|status| status.lines().any(|line| !line.trim().is_empty()))
}

fn is_untracked_git_file(cwd: &str, file_path: &str) -> bool {
    run_git_timed(
        &[
            "--literal-pathspecs",
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            file_path,
        ],
        cwd,
        Duration::from_secs(2),
    )
    .is_some_and(|status| status.lines().any(|line| line.starts_with("?? ")))
}

pub fn get_git_diff(
    allowed_paths: &AllowedPaths,
    cwd: &str,
    file_path: &str,
    staged: bool,
) -> String {
    if !is_safe_relative_path(file_path) || run_git(&["rev-parse", "--git-dir"], cwd).is_none() {
        return String::new();
    }
    let result = if staged {
        run_git_timed(
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--cached",
                "--",
                file_path,
            ],
            cwd,
            Duration::from_secs(5),
        )
    } else {
        run_git_timed(
            &["diff", "--no-ext-diff", "--no-textconv", "--", file_path],
            cwd,
            Duration::from_secs(5),
        )
    };
    if result
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return result.unwrap_or_default();
    }

    let status = run_git_timed(
        &["status", "--porcelain", "--", file_path],
        cwd,
        Duration::from_secs(5),
    );
    if !status
        .as_deref()
        .is_some_and(|status| status.lines().any(|line| line.starts_with("?? ")))
    {
        return String::new();
    }
    let Some(path) = allowed_paths.resolve_allowed_child_path(cwd, file_path) else {
        return String::new();
    };
    let Some(path) = allowed_paths.resolve_real_allowed_local_path(path) else {
        return String::new();
    };
    let Ok(metadata) = std::fs::metadata(&path) else {
        return String::new();
    };
    if metadata.len() > MAX_SIMPLE_UNTRACKED_FILE_BYTES {
        return String::new();
    }
    let Ok(bytes) = std::fs::read(path) else {
        return String::new();
    };
    if bytes.contains(&0) {
        return String::new();
    }
    let content = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = content.split('\n').collect();
    let mut output = vec![
        "--- /dev/null".to_string(),
        format!("+++ b/{file_path}"),
        format!("@@ -0,0 +1,{} @@", lines.len()),
    ];
    output.extend(lines.into_iter().map(|line| format!("+{line}")));
    output.join("\n")
}

fn get_raw_git_patch(cwd: &str, file_path: &str, staged: bool) -> String {
    let patch = if staged {
        run_git_timed(
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--cached",
                "--binary",
                "--find-renames",
                "--",
                file_path,
            ],
            cwd,
            Duration::from_secs(5),
        )
    } else {
        run_git_timed(
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--binary",
                "--find-renames",
                "--",
                file_path,
            ],
            cwd,
            Duration::from_secs(5),
        )
    }
    .unwrap_or_default();
    if !patch
        .lines()
        .any(|line| line == "new file mode 100644" || line.starts_with("new file mode "))
    {
        return patch;
    }
    let Some(original_path) = renamed_from_path(cwd, file_path, staged) else {
        return patch;
    };
    let rename_patch = if staged {
        run_git_timed(
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--cached",
                "--binary",
                "--find-renames",
                "--",
                &original_path,
                file_path,
            ],
            cwd,
            Duration::from_secs(5),
        )
    } else {
        run_git_timed(
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--binary",
                "--find-renames",
                "--",
                &original_path,
                file_path,
            ],
            cwd,
            Duration::from_secs(5),
        )
    }
    .unwrap_or_default();
    if rename_patch.trim().is_empty() {
        patch
    } else {
        rename_patch
    }
}

fn renamed_from_path(cwd: &str, file_path: &str, staged: bool) -> Option<String> {
    let status = run_git_timed(
        &["status", "--porcelain=v1", "--untracked-files=no"],
        cwd,
        Duration::from_secs(2),
    )?;
    status.lines().find_map(|line| {
        let status = line.as_bytes().get(usize::from(!staged)).copied()?;
        if status != b'R' && status != b'C' {
            return None;
        }
        let (original, actual) = line.get(3..)?.split_once(" -> ")?;
        (actual == file_path).then(|| original.to_string())
    })
}

fn create_untracked_patch(file_path: &str, content: &str) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut output = vec![
        format!("diff --git a/{file_path} b/{file_path}"),
        "new file mode 100644".to_string(),
        "index 0000000..0000000".to_string(),
        "--- /dev/null".to_string(),
        format!("+++ b/{file_path}"),
        format!("@@ -0,0 +1,{} @@", lines.len()),
    ];
    output.extend(lines.into_iter().map(|line| format!("+{line}")));
    output.join("\n")
}

fn has_merge_conflict_markers(content: &str) -> bool {
    content.contains("<<<<<<< ") && content.contains("\n=======") && content.contains("\n>>>>>>> ")
}

fn is_image_file(file_path: &str) -> bool {
    Path::new(file_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico" | "bmp"
            )
        })
}

fn too_large_diff(message: &str, is_new: bool) -> GitHunkDiff {
    GitHunkDiff {
        old_lines: Vec::new(),
        new_lines: vec![GitDiffLine {
            number: Some(1),
            content: message.to_string(),
            line_type: GitDiffLineType::Context,
        }],
        compact_lines: None,
        is_binary: false,
        is_new,
        is_image: None,
        image_path: None,
        raw_patch: None,
        merge_conflict_content: None,
    }
}

fn content_lines(content: &str) -> Vec<&str> {
    content.split('\n').collect()
}

#[derive(Clone, Copy)]
struct DiffRange {
    start: usize,
    end: usize,
}

fn parse_hunk_range(value: &str) -> Option<(usize, usize)> {
    let value = value.trim_start_matches(['-', '+']);
    let (start, count) = value.split_once(',').unwrap_or((value, "1"));
    Some((start.parse().ok()?, count.parse().ok()?))
}

fn ordered_range_contains(ranges: &[DiffRange], cursor: &mut usize, line: usize) -> bool {
    while ranges.get(*cursor).is_some_and(|range| range.end < line) {
        *cursor += 1;
    }
    ranges
        .get(*cursor)
        .is_some_and(|range| line >= range.start && line <= range.end)
}

fn push_changed_line(ranges: &mut Vec<DiffRange>, line: usize) {
    if let Some(last) = ranges.last_mut() {
        if line == last.end.saturating_add(1) {
            last.end = line;
            return;
        }
    }
    ranges.push(DiffRange {
        start: line,
        end: line,
    });
}

fn parse_changed_ranges(diff_text: &str) -> (Vec<DiffRange>, Vec<DiffRange>) {
    let mut removed = Vec::new();
    let mut added = Vec::new();
    let mut old_line = 0usize;
    let mut new_line = 0usize;
    let mut in_hunk = false;

    for line in diff_text.lines() {
        if line.starts_with("@@") {
            let Some(rest) = line.strip_prefix("@@ ") else {
                in_hunk = false;
                continue;
            };
            let mut parts = rest.split_whitespace();
            let (Some(old), Some(new)) = (parts.next(), parts.next()) else {
                in_hunk = false;
                continue;
            };
            let (Some((old_start, _)), Some((new_start, _))) =
                (parse_hunk_range(old), parse_hunk_range(new))
            else {
                in_hunk = false;
                continue;
            };
            old_line = old_start;
            new_line = new_start;
            in_hunk = true;
            continue;
        }
        if !in_hunk {
            continue;
        }
        if line.starts_with('-') {
            push_changed_line(&mut removed, old_line);
            old_line += 1;
        } else if line.starts_with('+') {
            push_changed_line(&mut added, new_line);
            new_line += 1;
        } else if line.starts_with(' ') {
            old_line += 1;
            new_line += 1;
        }
    }

    (removed, added)
}

fn build_hunk_diff_from_versions(
    raw_patch: String,
    old_content: &str,
    new_content: &str,
    is_new: bool,
    is_deleted: bool,
    merge_conflict_content: Option<String>,
) -> GitHunkDiff {
    if raw_patch.contains("GIT binary patch") || raw_patch.contains("Binary files ") {
        return GitHunkDiff {
            old_lines: Vec::new(),
            new_lines: Vec::new(),
            compact_lines: None,
            is_binary: true,
            is_new,
            is_image: None,
            image_path: None,
            raw_patch: Some(raw_patch),
            merge_conflict_content: None,
        };
    }

    if is_deleted {
        let lines = content_lines(old_content);
        if lines.len() > MAX_RENDERED_DIFF_LINES {
            let mut result = too_large_diff("Diff too large to render safely", false);
            result.raw_patch = Some(raw_patch);
            return result;
        }
        return GitHunkDiff {
            old_lines: lines
                .iter()
                .enumerate()
                .map(|(index, content)| GitDiffLine {
                    number: Some(index + 1),
                    content: (*content).to_string(),
                    line_type: GitDiffLineType::Remove,
                })
                .collect(),
            new_lines: lines
                .iter()
                .map(|_| GitDiffLine {
                    number: None,
                    content: String::new(),
                    line_type: GitDiffLineType::Spacer,
                })
                .collect(),
            compact_lines: None,
            is_binary: false,
            is_new: false,
            is_image: None,
            image_path: None,
            raw_patch: Some(raw_patch),
            merge_conflict_content: None,
        };
    }

    if is_new {
        return GitHunkDiff {
            old_lines: Vec::new(),
            new_lines: content_lines(new_content)
                .iter()
                .enumerate()
                .map(|(index, content)| GitDiffLine {
                    number: Some(index + 1),
                    content: (*content).to_string(),
                    line_type: GitDiffLineType::Add,
                })
                .collect(),
            compact_lines: None,
            is_binary: false,
            is_new: true,
            is_image: None,
            image_path: None,
            raw_patch: Some(raw_patch),
            merge_conflict_content,
        };
    }

    let old_file_lines = content_lines(old_content);
    let new_file_lines = content_lines(new_content);
    if old_file_lines.len() + new_file_lines.len() > MAX_RENDERED_DIFF_LINES {
        let mut result = too_large_diff("Diff too large to render safely", false);
        result.raw_patch = Some(raw_patch);
        return result;
    }
    if old_file_lines
        .iter()
        .chain(new_file_lines.iter())
        .any(|line| line.encode_utf16().count() > MAX_RENDERED_LINE_CHARS)
    {
        let mut result = too_large_diff(
            "Diff contains a very long line and cannot render safely",
            false,
        );
        result.raw_patch = Some(raw_patch);
        return result;
    }

    let (removed_ranges, added_ranges) = parse_changed_ranges(&raw_patch);
    let mut old_lines = Vec::new();
    let mut new_lines = Vec::new();
    let mut old_index = 0usize;
    let mut new_index = 0usize;
    let mut removed_range_cursor = 0usize;
    let mut added_range_cursor = 0usize;

    while old_index < old_file_lines.len() || new_index < new_file_lines.len() {
        let old_number = old_index + 1;
        let new_number = new_index + 1;
        let old_removed = old_index < old_file_lines.len()
            && ordered_range_contains(&removed_ranges, &mut removed_range_cursor, old_number);
        let new_added = new_index < new_file_lines.len()
            && ordered_range_contains(&added_ranges, &mut added_range_cursor, new_number);
        if old_removed && new_added {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Remove,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Add,
            });
            old_index += 1;
            new_index += 1;
        } else if old_removed {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Remove,
            });
            new_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            old_index += 1;
        } else if new_added {
            old_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Add,
            });
            new_index += 1;
        } else if old_index < old_file_lines.len() && new_index < new_file_lines.len() {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Context,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Context,
            });
            old_index += 1;
            new_index += 1;
        } else if old_index < old_file_lines.len() {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Remove,
            });
            new_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            old_index += 1;
        } else {
            old_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Add,
            });
            new_index += 1;
        }
    }

    GitHunkDiff {
        old_lines,
        new_lines,
        compact_lines: None,
        is_binary: false,
        is_new: false,
        is_image: None,
        image_path: None,
        raw_patch: Some(raw_patch),
        merge_conflict_content,
    }
}

fn patch_header_path(raw_patch: &str, prefix: &str) -> Option<String> {
    raw_patch.lines().find_map(|line| {
        let value = line.strip_prefix(prefix)?.trim();
        (value != "/dev/null").then(|| {
            value
                .strip_prefix("a/")
                .or_else(|| value.strip_prefix("b/"))
                .unwrap_or(value)
                .to_string()
        })
    })
}

fn get_git_revision_hunk_diff(
    cwd: &str,
    old_revision: Option<&str>,
    new_revision: &str,
    file_path: &str,
    review: bool,
) -> Option<GitHunkDiff> {
    let raw_patch = if let Some(old_revision) = old_revision {
        run_git_timed(
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--binary",
                "--find-renames",
                old_revision,
                new_revision,
                "--",
                file_path,
            ],
            cwd,
            Duration::from_secs(5),
        )?
    } else {
        run_git_timed(
            &[
                "show",
                "--format=",
                "--root",
                "--no-ext-diff",
                "--no-textconv",
                "--binary",
                "--find-renames",
                new_revision,
                "--",
                file_path,
            ],
            cwd,
            Duration::from_secs(5),
        )?
    };
    if raw_patch.trim().is_empty() {
        return None;
    }
    let old_path = patch_header_path(&raw_patch, "--- ").unwrap_or_else(|| file_path.to_string());
    let new_path = patch_header_path(&raw_patch, "+++ ").unwrap_or_else(|| file_path.to_string());
    let is_new = raw_patch.lines().any(|line| line == "--- /dev/null");
    let is_deleted = raw_patch.lines().any(|line| line == "+++ /dev/null");
    let old_content = old_revision
        .filter(|_| !is_new)
        .and_then(|revision| {
            run_git_timed(
                &["show", &format!("{revision}:{old_path}")],
                cwd,
                Duration::from_secs(5),
            )
        })
        .unwrap_or_default();
    let new_content = (!is_deleted)
        .then(|| {
            run_git_timed(
                &["show", &format!("{new_revision}:{new_path}")],
                cwd,
                Duration::from_secs(5),
            )
        })
        .flatten()
        .unwrap_or_default();
    let diff = build_hunk_diff_from_versions(
        raw_patch,
        &old_content,
        &new_content,
        is_new,
        is_deleted,
        None,
    );
    Some(if review {
        compact_git_hunk_diff(diff)
    } else {
        diff
    })
}

pub fn get_git_comparison_hunk_diff(
    cwd: &str,
    from_hash: &str,
    to_hash: &str,
    file_path: &str,
    review: bool,
) -> Option<GitHunkDiff> {
    if from_hash == to_hash
        || !is_safe_relative_path(file_path)
        || !valid_commit_target(cwd, from_hash)
        || !valid_commit_target(cwd, to_hash)
    {
        return None;
    }
    get_git_revision_hunk_diff(cwd, Some(from_hash), to_hash, file_path, review)
}

pub fn get_git_worktree_comparison_hunk_diff(
    allowed_paths: &AllowedPaths,
    cwd: &str,
    from_hash: &str,
    file_path: &str,
    review: bool,
) -> Option<GitHunkDiff> {
    if !is_safe_relative_path(file_path) || !valid_commit_target(cwd, from_hash) {
        return None;
    }
    let requested_path = allowed_paths.resolve_allowed_child_path(cwd, file_path)?;
    let raw_patch = run_git_timed(
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--find-renames",
            from_hash,
            "--",
            file_path,
        ],
        cwd,
        Duration::from_secs(5),
    )
    .unwrap_or_default();
    let untracked = raw_patch.trim().is_empty() && is_untracked_git_file(cwd, file_path);
    if raw_patch.trim().is_empty() && !untracked {
        return None;
    }
    let deleted = raw_patch.lines().any(|line| line == "+++ /dev/null");
    let full_path = if deleted {
        requested_path
    } else {
        allowed_paths.resolve_real_allowed_local_path(requested_path)?
    };
    let new_bytes = if deleted {
        Vec::new()
    } else {
        let metadata = std::fs::metadata(&full_path).ok()?;
        if metadata.len() > MAX_UNTRACKED_FILE_BYTES {
            return Some(too_large_diff("File too large to render safely", untracked));
        }
        std::fs::read(&full_path).ok()?
    };
    if new_bytes.contains(&0) || is_image_file(file_path) {
        return Some(GitHunkDiff {
            old_lines: Vec::new(),
            new_lines: Vec::new(),
            compact_lines: None,
            is_binary: true,
            is_new: untracked,
            is_image: Some(is_image_file(file_path)),
            image_path: (!deleted).then(|| full_path.to_string_lossy().into_owned()),
            raw_patch: Some(raw_patch),
            merge_conflict_content: None,
        });
    }
    let new_content = String::from_utf8_lossy(&new_bytes).into_owned();
    let old_content = if untracked {
        String::new()
    } else {
        run_git_timed(
            &["show", &format!("{from_hash}:{file_path}")],
            cwd,
            Duration::from_secs(5),
        )
        .unwrap_or_default()
    };
    let raw_patch = if untracked {
        create_untracked_patch(file_path, &new_content)
    } else {
        raw_patch
    };
    let merge_conflict_content =
        has_merge_conflict_markers(&new_content).then(|| new_content.clone());
    let diff = build_hunk_diff_from_versions(
        raw_patch,
        &old_content,
        &new_content,
        untracked,
        deleted,
        merge_conflict_content,
    );
    Some(if review {
        compact_git_hunk_diff(diff)
    } else {
        diff
    })
}

pub fn get_git_commit_hunk_diff(
    cwd: &str,
    hash: &str,
    file_path: &str,
    review: bool,
) -> Option<GitHunkDiff> {
    get_git_commit_hunk_diff_for_parent(cwd, hash, None, file_path, review)
}

pub fn get_git_commit_hunk_diff_for_parent(
    cwd: &str,
    hash: &str,
    requested_parent: Option<&str>,
    file_path: &str,
    review: bool,
) -> Option<GitHunkDiff> {
    if !is_safe_relative_path(file_path) || run_git(&["cat-file", "-e", hash], cwd).is_none() {
        return None;
    }
    let lineage = run_git(&["rev-list", "--parents", "-n", "1", hash], cwd)?;
    let parents = lineage
        .split_whitespace()
        .skip(1)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let parent = requested_parent
        .filter(|candidate| parents.iter().any(|parent| parent == candidate))
        .map(ToOwned::to_owned)
        .or_else(|| parents.first().cloned());
    get_git_revision_hunk_diff(cwd, parent.as_deref(), hash, file_path, review)
}

pub fn get_git_hunk_diff(
    allowed_paths: &AllowedPaths,
    cwd: &str,
    file_path: &str,
    staged: bool,
) -> GitHunkDiff {
    let Some(requested_path) = allowed_paths.resolve_allowed_child_path(cwd, file_path) else {
        return too_large_diff("Access denied", false);
    };
    let raw_patch = get_raw_git_patch(cwd, file_path, staged);
    let deleted_patch = raw_patch
        .lines()
        .any(|line| line.starts_with("deleted file mode") || line == "+++ /dev/null");
    let full_path = if deleted_patch {
        Some(requested_path)
    } else {
        allowed_paths.resolve_real_allowed_local_path(requested_path)
    };
    let Some(full_path) = full_path else {
        return too_large_diff("Access denied", false);
    };
    let full_path_text = full_path.to_string_lossy().into_owned();

    if is_image_file(file_path) {
        return GitHunkDiff {
            old_lines: Vec::new(),
            new_lines: Vec::new(),
            compact_lines: None,
            is_binary: true,
            is_new: true,
            is_image: Some(true),
            image_path: Some(full_path_text),
            raw_patch: Some(raw_patch),
            merge_conflict_content: None,
        };
    }

    let mut current_content = String::new();
    if !deleted_patch {
        let mut read_attempts = 0;
        loop {
            let read = std::fs::metadata(&full_path).and_then(|metadata| {
                if metadata.len() > MAX_UNTRACKED_FILE_BYTES {
                    return Err(std::io::Error::other("file too large"));
                }
                std::fs::read(&full_path)
            });
            match read {
                Ok(bytes) => {
                    if bytes.contains(&0) {
                        return GitHunkDiff {
                            old_lines: Vec::new(),
                            new_lines: Vec::new(),
                            compact_lines: None,
                            is_binary: true,
                            is_new: false,
                            is_image: None,
                            image_path: None,
                            raw_patch: Some(raw_patch),
                            merge_conflict_content: None,
                        };
                    }
                    current_content = String::from_utf8_lossy(&bytes).into_owned();
                    break;
                }
                Err(error) if error.to_string() == "file too large" => {
                    let mut result = too_large_diff("File too large to render safely", true);
                    result.raw_patch = Some(raw_patch);
                    return result;
                }
                Err(_) => {
                    read_attempts += 1;
                    if read_attempts >= 3 {
                        let mut result = too_large_diff("Cannot read file", true);
                        result.raw_patch = Some(raw_patch);
                        return result;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
    }
    let merge_conflict_content =
        has_merge_conflict_markers(&current_content).then(|| current_content.clone());

    let reference = if staged {
        format!("HEAD:{file_path}")
    } else {
        format!(":{file_path}")
    };
    let old_result = run_git_timed(&["show", &reference], cwd, Duration::from_secs(5));
    // `git show :path` can return success with an empty result when an untracked
    // path contains pathspec metacharacters such as `[...path]`. Confirm the
    // ambiguous empty case with a literal status lookup instead of treating the
    // file as an unchanged empty index entry.
    let is_new = old_result.is_none()
        || (old_result.as_deref().is_some_and(str::is_empty)
            && raw_patch.is_empty()
            && is_untracked_git_file(cwd, file_path));
    let old_content = old_result.unwrap_or_default();
    let new_content = if staged {
        run_git_timed(
            &["show", &format!(":{file_path}")],
            cwd,
            Duration::from_secs(5),
        )
        .unwrap_or_default()
    } else {
        current_content
    };

    if deleted_patch {
        let lines = content_lines(&old_content);
        if lines.len() > MAX_RENDERED_DIFF_LINES {
            let mut result = too_large_diff("Diff too large to render safely", false);
            result.raw_patch = Some(raw_patch);
            return result;
        }
        if lines
            .iter()
            .any(|line| line.encode_utf16().count() > MAX_RENDERED_LINE_CHARS)
        {
            let mut result = too_large_diff(
                "Diff contains a very long line and cannot render safely",
                false,
            );
            result.raw_patch = Some(raw_patch);
            return result;
        }
        return GitHunkDiff {
            old_lines: lines
                .iter()
                .enumerate()
                .map(|(index, content)| GitDiffLine {
                    number: Some(index + 1),
                    content: (*content).to_string(),
                    line_type: GitDiffLineType::Remove,
                })
                .collect(),
            new_lines: lines
                .iter()
                .map(|_| GitDiffLine {
                    number: None,
                    content: String::new(),
                    line_type: GitDiffLineType::Spacer,
                })
                .collect(),
            compact_lines: None,
            is_binary: false,
            is_new: false,
            is_image: None,
            image_path: None,
            raw_patch: Some(raw_patch),
            merge_conflict_content: None,
        };
    }

    if is_new {
        let raw_patch = if raw_patch.is_empty() {
            create_untracked_patch(file_path, &new_content)
        } else {
            raw_patch
        };
        return GitHunkDiff {
            old_lines: Vec::new(),
            new_lines: content_lines(&new_content)
                .iter()
                .enumerate()
                .map(|(index, content)| GitDiffLine {
                    number: Some(index + 1),
                    content: (*content).to_string(),
                    line_type: GitDiffLineType::Add,
                })
                .collect(),
            compact_lines: None,
            is_binary: false,
            is_new: true,
            is_image: None,
            image_path: None,
            raw_patch: Some(raw_patch),
            merge_conflict_content,
        };
    }

    let old_file_lines = content_lines(&old_content);
    let new_file_lines = content_lines(&new_content);
    if old_file_lines.len() + new_file_lines.len() > MAX_RENDERED_DIFF_LINES {
        let mut result = too_large_diff("Diff too large to render safely", false);
        result.raw_patch = Some(raw_patch);
        return result;
    }
    if old_file_lines
        .iter()
        .chain(new_file_lines.iter())
        .any(|line| line.encode_utf16().count() > MAX_RENDERED_LINE_CHARS)
    {
        let mut result = too_large_diff(
            "Diff contains a very long line and cannot render safely",
            false,
        );
        result.raw_patch = Some(raw_patch);
        return result;
    }

    let (removed_ranges, added_ranges) = parse_changed_ranges(&raw_patch);
    let mut old_lines = Vec::new();
    let mut new_lines = Vec::new();
    let mut old_index = 0usize;
    let mut new_index = 0usize;
    let mut removed_range_cursor = 0usize;
    let mut added_range_cursor = 0usize;

    while old_index < old_file_lines.len() || new_index < new_file_lines.len() {
        let old_number = old_index + 1;
        let new_number = new_index + 1;
        let old_removed = old_index < old_file_lines.len()
            && ordered_range_contains(&removed_ranges, &mut removed_range_cursor, old_number);
        let new_added = new_index < new_file_lines.len()
            && ordered_range_contains(&added_ranges, &mut added_range_cursor, new_number);
        if old_removed && new_added {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Remove,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Add,
            });
            old_index += 1;
            new_index += 1;
        } else if old_removed {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Remove,
            });
            new_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            old_index += 1;
        } else if new_added {
            old_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Add,
            });
            new_index += 1;
        } else if old_index < old_file_lines.len() && new_index < new_file_lines.len() {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Context,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Context,
            });
            old_index += 1;
            new_index += 1;
        } else if old_index < old_file_lines.len() {
            old_lines.push(GitDiffLine {
                number: Some(old_number),
                content: old_file_lines[old_index].to_string(),
                line_type: GitDiffLineType::Remove,
            });
            new_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            old_index += 1;
        } else {
            old_lines.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Spacer,
            });
            new_lines.push(GitDiffLine {
                number: Some(new_number),
                content: new_file_lines[new_index].to_string(),
                line_type: GitDiffLineType::Add,
            });
            new_index += 1;
        }
    }

    GitHunkDiff {
        old_lines,
        new_lines,
        compact_lines: None,
        is_binary: false,
        is_new: false,
        is_image: None,
        image_path: None,
        raw_patch: Some(raw_patch),
        merge_conflict_content,
    }
}

const REVIEW_CONTEXT_LINES: usize = 4;

fn compact_context_line(hidden_count: usize) -> GitDiffLine {
    GitDiffLine {
        number: None,
        content: format!(
            "... {hidden_count} unchanged {} hidden ...",
            if hidden_count == 1 { "line" } else { "lines" }
        ),
        line_type: GitDiffLineType::Hunk,
    }
}

fn append_review_rows(result: &mut Vec<GitDiffLine>, rows: &[GitDiffLine]) {
    let mut changed_run = Vec::new();
    let flush_changed_run = |result: &mut Vec<GitDiffLine>, changed_run: &mut Vec<GitDiffLine>| {
        if changed_run.is_empty() {
            return;
        }
        result.extend(
            changed_run
                .iter()
                .filter(|line| line.line_type == GitDiffLineType::Remove)
                .cloned(),
        );
        result.extend(
            changed_run
                .iter()
                .filter(|line| line.line_type == GitDiffLineType::Add)
                .cloned(),
        );
        changed_run.clear();
    };

    for row in rows {
        if matches!(
            row.line_type,
            GitDiffLineType::Add | GitDiffLineType::Remove
        ) {
            changed_run.push(row.clone());
        } else {
            flush_changed_run(result, &mut changed_run);
            result.push(row.clone());
        }
    }
    flush_changed_run(result, &mut changed_run);
}

fn build_review_lines(old_lines: &[GitDiffLine], new_lines: &[GitDiffLine]) -> Vec<GitDiffLine> {
    let mut stacked = Vec::new();
    let line_count = old_lines.len().max(new_lines.len());
    for index in 0..line_count {
        let old_line = old_lines.get(index);
        let new_line = new_lines.get(index);
        if old_line.is_some_and(|line| line.line_type == GitDiffLineType::Context)
            && new_line.is_some_and(|line| line.line_type == GitDiffLineType::Context)
        {
            if let Some(line) = new_line {
                stacked.push(line.clone());
            }
            continue;
        }
        if let Some(line) = old_line.filter(|line| line.line_type != GitDiffLineType::Spacer) {
            stacked.push(line.clone());
        }
        if let Some(line) = new_line.filter(|line| line.line_type != GitDiffLineType::Spacer) {
            stacked.push(line.clone());
        }
    }

    let changed_rows = stacked
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            matches!(
                line.line_type,
                GitDiffLineType::Add | GitDiffLineType::Remove
            )
            .then_some(index)
        })
        .collect::<Vec<_>>();
    if changed_rows.is_empty() {
        return stacked;
    }

    let mut ranges = Vec::<DiffRange>::new();
    for row in changed_rows {
        let start = row.saturating_sub(REVIEW_CONTEXT_LINES);
        let end = (row + REVIEW_CONTEXT_LINES).min(stacked.len().saturating_sub(1));
        let merged = if let Some(previous) = ranges.last_mut() {
            if start <= previous.end + REVIEW_CONTEXT_LINES + 1 {
                previous.end = previous.end.max(end);
                true
            } else {
                false
            }
        } else {
            false
        };
        if !merged {
            ranges.push(DiffRange { start, end });
        }
    }

    let mut result = Vec::new();
    for (index, range) in ranges.iter().enumerate() {
        let previous_end = if index == 0 {
            None
        } else {
            Some(ranges[index - 1].end)
        };
        let hidden_count = range
            .start
            .saturating_sub(previous_end.map_or(0, |end| end + 1));
        if hidden_count > 0 {
            result.push(compact_context_line(hidden_count));
        }
        append_review_rows(&mut result, &stacked[range.start..=range.end]);
    }
    if let Some(final_range) = ranges.last() {
        let hidden_count = stacked.len().saturating_sub(final_range.end + 1);
        if hidden_count > 0 {
            result.push(compact_context_line(hidden_count));
        }
    }
    result
}

fn build_review_split_lines(
    old_lines: &[GitDiffLine],
    new_lines: &[GitDiffLine],
) -> (Vec<GitDiffLine>, Vec<GitDiffLine>) {
    let line_count = old_lines.len().max(new_lines.len());
    let changed_rows = (0..line_count)
        .filter(|&index| {
            old_lines.get(index).is_some_and(|line| {
                matches!(
                    line.line_type,
                    GitDiffLineType::Add | GitDiffLineType::Remove
                )
            }) || new_lines.get(index).is_some_and(|line| {
                matches!(
                    line.line_type,
                    GitDiffLineType::Add | GitDiffLineType::Remove
                )
            })
        })
        .collect::<Vec<_>>();
    if changed_rows.is_empty() {
        return (old_lines.to_vec(), new_lines.to_vec());
    }

    let mut ranges = Vec::<DiffRange>::new();
    for row in changed_rows {
        let start = row.saturating_sub(REVIEW_CONTEXT_LINES);
        let end = (row + REVIEW_CONTEXT_LINES).min(line_count.saturating_sub(1));
        let merged = if let Some(previous) = ranges.last_mut() {
            if start <= previous.end + REVIEW_CONTEXT_LINES + 1 {
                previous.end = previous.end.max(end);
                true
            } else {
                false
            }
        } else {
            false
        };
        if !merged {
            ranges.push(DiffRange { start, end });
        }
    }

    let spacer = || GitDiffLine {
        number: None,
        content: String::new(),
        line_type: GitDiffLineType::Spacer,
    };
    let mut compact_old = Vec::new();
    let mut compact_new = Vec::new();
    for (index, range) in ranges.iter().enumerate() {
        let previous_end = if index == 0 {
            None
        } else {
            Some(ranges[index - 1].end)
        };
        let hidden_count = range
            .start
            .saturating_sub(previous_end.map_or(0, |end| end + 1));
        if hidden_count > 0 {
            let marker = compact_context_line(hidden_count);
            compact_old.push(marker.clone());
            compact_new.push(marker);
        }
        for row in range.start..=range.end {
            compact_old.push(old_lines.get(row).cloned().unwrap_or_else(&spacer));
            compact_new.push(new_lines.get(row).cloned().unwrap_or_else(&spacer));
        }
    }
    if let Some(final_range) = ranges.last() {
        let hidden_count = line_count.saturating_sub(final_range.end + 1);
        if hidden_count > 0 {
            let marker = compact_context_line(hidden_count);
            compact_old.push(marker.clone());
            compact_new.push(marker);
        }
    }
    (compact_old, compact_new)
}

pub fn compact_git_hunk_diff(mut diff: GitHunkDiff) -> GitHunkDiff {
    if !diff.is_binary && diff.merge_conflict_content.is_none() {
        diff.compact_lines = Some(build_review_lines(&diff.old_lines, &diff.new_lines));
        (diff.old_lines, diff.new_lines) =
            build_review_split_lines(&diff.old_lines, &diff.new_lines);
        diff.raw_patch = None;
    }
    diff
}

pub fn get_git_file_with_diff(
    allowed_paths: &AllowedPaths,
    cwd: &str,
    file_path: &str,
    staged: bool,
) -> GitFileWithDiff {
    let Some(path) = allowed_paths.resolve_allowed_child_path(cwd, file_path) else {
        return GitFileWithDiff::AccessDenied;
    };
    let Some(path) = allowed_paths.resolve_real_allowed_local_path(path) else {
        return GitFileWithDiff::AccessDenied;
    };
    if is_image_file(file_path) {
        return GitFileWithDiff::Image {
            image_path: path.to_string_lossy().into_owned(),
        };
    }
    let Ok(metadata) = std::fs::metadata(&path) else {
        return GitFileWithDiff::Error {
            error: "Cannot read file",
        };
    };
    if metadata.len() > MAX_UNTRACKED_FILE_BYTES {
        return GitFileWithDiff::Error {
            error: "File too large",
        };
    }
    let Ok(bytes) = std::fs::read(path) else {
        return GitFileWithDiff::Error {
            error: "Cannot read file",
        };
    };
    if bytes.contains(&0) {
        return GitFileWithDiff::Error {
            error: "Binary file",
        };
    }
    let content = String::from_utf8_lossy(&bytes);
    let raw_patch = get_raw_git_patch(cwd, file_path, staged);
    let (_, added_ranges) = parse_changed_ranges(&raw_patch);
    let mut added_range_cursor = 0usize;
    let lines = content
        .split('\n')
        .enumerate()
        .map(|(index, content)| {
            let number = index + 1;
            GitDiffLine {
                number: Some(number),
                content: content.to_string(),
                line_type: if ordered_range_contains(&added_ranges, &mut added_range_cursor, number)
                {
                    GitDiffLineType::Add
                } else {
                    GitDiffLineType::Context
                },
            }
        })
        .collect();
    GitFileWithDiff::Text { lines }
}

pub fn get_git_branches(cwd: &str) -> Vec<GitBranch> {
    let Some(result) = run_git(&["branch", "--format=%(HEAD) %(refname:short)"], cwd) else {
        return Vec::new();
    };
    result
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| GitBranch {
            current: line.starts_with('*'),
            name: line.get(2..).unwrap_or("").trim().to_string(),
        })
        .collect()
}

pub fn get_git_worktrees(cwd: &str) -> Vec<GitWorktree> {
    let Some(result) = run_git(&["worktree", "list", "--porcelain"], cwd) else {
        return Vec::new();
    };
    let current_root = run_git(&["rev-parse", "--show-toplevel"], cwd)
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    result
        .split("\n\n")
        .filter_map(|block| {
            let mut path = String::new();
            let mut head = String::new();
            let mut branch = None;
            let mut bare = false;
            let mut locked = false;
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("worktree ") {
                    path = value.to_string();
                } else if let Some(value) = line.strip_prefix("HEAD ") {
                    head = value.to_string();
                } else if let Some(value) = line.strip_prefix("branch refs/heads/") {
                    branch = Some(value.to_string());
                } else if line == "bare" {
                    bare = true;
                } else if line.starts_with("locked") {
                    locked = true;
                }
            }
            (!path.is_empty()).then(|| GitWorktree {
                is_current: path == current_root,
                path,
                head,
                branch,
                bare,
                locked,
                status: None,
            })
        })
        .collect()
}

pub fn get_git_stashes(cwd: &str) -> Vec<GitStash> {
    run_git(&["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%ar"], cwd)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\x1f');
            let name = parts.next()?.to_string();
            Some(GitStash {
                name,
                hash: parts.next().unwrap_or_default().to_string(),
                message: parts.next().unwrap_or_default().to_string(),
                date: parts.next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

fn repository_git_path_exists(cwd: &str, name: &str) -> bool {
    repository_git_path(cwd, name).is_some_and(|path| path.exists())
}

fn repository_git_path(cwd: &str, name: &str) -> Option<PathBuf> {
    run_git(&["rev-parse", "--git-path", name], cwd).and_then(|value| {
        let path = Path::new(value.trim());
        if path.as_os_str().is_empty() {
            None
        } else if path.is_absolute() {
            Some(path.to_path_buf())
        } else {
            Some(Path::new(cwd).join(path))
        }
    })
}

pub fn get_git_repository_operation_state(cwd: &str) -> GitRepositoryOperationState {
    let kind = if repository_git_path_exists(cwd, "rebase-merge")
        || repository_git_path_exists(cwd, "rebase-apply")
    {
        GitRepositoryOperationKind::Rebase
    } else if repository_git_path_exists(cwd, "MERGE_HEAD") {
        GitRepositoryOperationKind::Merge
    } else if repository_git_path_exists(cwd, "CHERRY_PICK_HEAD") {
        GitRepositoryOperationKind::CherryPick
    } else if repository_git_path_exists(cwd, "REVERT_HEAD") {
        GitRepositoryOperationKind::Revert
    } else {
        GitRepositoryOperationKind::Idle
    };
    let conflicts = git_conflicts(cwd);
    let phase = if kind == GitRepositoryOperationKind::Idle {
        GitRepositoryOperationPhase::Idle
    } else if conflicts.is_empty() {
        GitRepositoryOperationPhase::AwaitingContinuation
    } else {
        GitRepositoryOperationPhase::Conflicted
    };
    GitRepositoryOperationState {
        kind,
        phase,
        conflicts,
    }
}

fn stable_revision_token(parts: &[String]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for part in parts {
        for byte in part.as_bytes().iter().chain(std::iter::once(&0)) {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{hash:016x}")
}

pub fn get_git_repository_revision(cwd: &str) -> String {
    let parts = [
        run_git(&["rev-parse", "--verify", "HEAD"], cwd).unwrap_or_default(),
        run_git(
            &[
                "for-each-ref",
                "--format=%(refname)%09%(objectname)%09%(*objectname)",
            ],
            cwd,
        )
        .unwrap_or_default(),
        run_git(&["status", "--porcelain=v2", "--branch", "-z"], cwd).unwrap_or_default(),
        run_git(&["worktree", "list", "--porcelain"], cwd).unwrap_or_default(),
        format!("{:?}", get_git_repository_operation_state(cwd)),
    ];
    stable_revision_token(&parts)
}

pub fn preflight_git_checkout(cwd: &str, branch_name: &str) -> GitCheckoutPreflight {
    let branch_exists = get_git_branches(cwd)
        .iter()
        .any(|branch| branch.name == branch_name);
    let already_current = current_git_branch(cwd).as_deref() == Some(branch_name);
    let status = get_git_status(cwd);
    let clean_worktree = status
        .as_ref()
        .is_some_and(|status| status.files.is_empty());
    let operation = get_git_repository_operation_state(cwd);
    let conflicts = operation.conflicts.clone();
    let checked_out_worktree = get_git_worktrees(cwd)
        .into_iter()
        .find(|worktree| !worktree.is_current && worktree.branch.as_deref() == Some(branch_name))
        .map(|worktree| worktree.path);

    let (error_kind, reason) = if !branch_exists {
        (
            Some(GitOperationErrorKind::InvalidInput),
            Some("Branch not found".to_string()),
        )
    } else if already_current {
        (None, None)
    } else if let Some(path) = checked_out_worktree.as_deref() {
        (
            Some(GitOperationErrorKind::WorktreeInUse),
            Some(format!("Branch is already checked out at {path}")),
        )
    } else if operation.kind != GitRepositoryOperationKind::Idle {
        (
            Some(GitOperationErrorKind::Conflict),
            Some("Continue or abort the current Git operation before checkout".to_string()),
        )
    } else if !clean_worktree {
        (
            Some(GitOperationErrorKind::DirtyWorktree),
            Some("Commit or stash working changes before checkout".to_string()),
        )
    } else {
        (None, None)
    };
    GitCheckoutPreflight {
        branch: branch_name.to_string(),
        branch_exists,
        already_current,
        clean_worktree,
        conflicts,
        checked_out_worktree,
        can_checkout: error_kind.is_none(),
        error_kind,
        reason,
    }
}

pub fn checkout_git_branch(cwd: &str, branch_name: &str) -> GitCheckoutResult {
    let preflight = preflight_git_checkout(cwd, branch_name);
    if !preflight.can_checkout {
        return GitCheckoutResult {
            ok: false,
            branch: None,
            error_kind: preflight.error_kind,
            error: preflight.reason,
        };
    }
    if preflight.already_current {
        return GitCheckoutResult {
            ok: true,
            branch: Some(branch_name.to_string()),
            error_kind: None,
            error: None,
        };
    }

    let output = match Command::new("git")
        .args(["checkout", branch_name])
        .current_dir(cwd)
        .output()
    {
        Ok(output) => output,
        Err(_) => {
            return GitCheckoutResult {
                ok: false,
                branch: None,
                error_kind: Some(GitOperationErrorKind::Io),
                error: Some(format!("Unable to checkout {branch_name}")),
            };
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return GitCheckoutResult {
            ok: false,
            branch: None,
            error_kind: Some(classify_git_operation_error(&stderr, &git_conflicts(cwd))),
            error: Some(if stderr.is_empty() {
                format!("Unable to checkout {branch_name}")
            } else {
                stderr
            }),
        };
    }
    let current = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], cwd)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| branch_name.to_string());
    GitCheckoutResult {
        ok: true,
        branch: Some(current),
        error_kind: None,
        error: None,
    }
}

fn current_git_branch(cwd: &str) -> Option<String> {
    run_git(&["rev-parse", "--abbrev-ref", "HEAD"], cwd)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "HEAD")
}

fn current_git_head(cwd: &str) -> Option<String> {
    run_git(&["rev-parse", "--verify", "HEAD"], cwd)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn git_conflicts(cwd: &str) -> Vec<String> {
    run_git(&["diff", "--name-only", "--diff-filter=U"], cwd)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn classify_git_operation_error(message: &str, conflicts: &[String]) -> GitOperationErrorKind {
    if !conflicts.is_empty() {
        return GitOperationErrorKind::Conflict;
    }
    let message = message.to_ascii_lowercase();
    if message.contains("authentication failed")
        || message.contains("permission denied (publickey)")
        || message.contains("could not read username")
        || message.contains("terminal prompts disabled")
    {
        GitOperationErrorKind::Authentication
    } else if message.contains("non-fast-forward")
        || message.contains("fetch first")
        || message.contains("failed to push some refs")
    {
        GitOperationErrorKind::NonFastForward
    } else if message.contains("could not resolve host")
        || message.contains("connection timed out")
        || message.contains("connection refused")
        || message.contains("network is unreachable")
        || message.contains("unable to access")
    {
        GitOperationErrorKind::Network
    } else if message.contains("would be overwritten")
        || message.contains("local changes")
        || message.contains("commit or stash")
        || message.contains("working tree")
    {
        GitOperationErrorKind::DirtyWorktree
    } else if message.contains("already checked out at")
        || message.contains("is already checked out")
    {
        GitOperationErrorKind::WorktreeInUse
    } else if message.contains("invalid")
        || message.contains("not found")
        || message.contains("unsupported")
        || message.contains("must be")
    {
        GitOperationErrorKind::InvalidInput
    } else {
        GitOperationErrorKind::CommandFailed
    }
}

fn ref_operation_result(
    cwd: &str,
    operation: &str,
    output: std::io::Result<std::process::Output>,
) -> GitRefOperationResult {
    let current_branch = current_git_branch(cwd);
    match output {
        Ok(output) if output.status.success() => {
            let repository_operation = get_git_repository_operation_state(cwd);
            GitRefOperationResult {
                ok: true,
                operation: operation.to_string(),
                outcome: if repository_operation.kind == GitRepositoryOperationKind::Idle {
                    GitOperationOutcome::Completed
                } else {
                    GitOperationOutcome::AwaitingContinuation
                },
                current_branch,
                head: current_git_head(cwd),
                conflicts: repository_operation.conflicts,
                error_kind: None,
                error: None,
            }
        }
        Ok(output) => {
            let conflicts = git_conflicts(cwd);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let error = if stderr.is_empty() {
                format!("Git {operation} failed")
            } else {
                stderr
            };
            GitRefOperationResult {
                ok: false,
                operation: operation.to_string(),
                outcome: if conflicts.is_empty() {
                    GitOperationOutcome::Failed
                } else {
                    GitOperationOutcome::Conflicted
                },
                current_branch,
                head: current_git_head(cwd),
                error_kind: Some(classify_git_operation_error(&error, &conflicts)),
                conflicts,
                error: Some(error),
            }
        }
        Err(error) => GitRefOperationResult {
            ok: false,
            operation: operation.to_string(),
            outcome: GitOperationOutcome::Failed,
            current_branch,
            head: current_git_head(cwd),
            conflicts: Vec::new(),
            error_kind: Some(GitOperationErrorKind::Io),
            error: Some(error.to_string()),
        },
    }
}

fn interactive_rebase_commits(cwd: &str, source: &str, target: &str) -> Vec<GitCommitSummary> {
    let range = format!("{target}..{source}");
    run_git(
        &[
            "log",
            "--reverse",
            "--topo-order",
            "--no-merges",
            "--format=%H%x1f%s%x1f%an%x1f%aI",
            &range,
        ],
        cwd,
    )
    .unwrap_or_default()
    .lines()
    .filter_map(|line| {
        let mut fields = line.splitn(4, '\x1f');
        let hash = fields.next()?.trim();
        if hash.is_empty() {
            return None;
        }
        Some(GitCommitSummary {
            hash: hash.to_string(),
            message: fields.next().unwrap_or_default().to_string(),
            author: fields.next().unwrap_or_default().to_string(),
            date: fields.next().unwrap_or_default().to_string(),
        })
    })
    .collect()
}

fn interactive_rebase_has_merge(cwd: &str, source: &str, target: &str) -> bool {
    let range = format!("{target}..{source}");
    run_git(&["rev-list", "--merges", "--max-count=1", &range], cwd)
        .is_some_and(|value| !value.trim().is_empty())
}

pub fn preflight_git_ref_operation(
    cwd: &str,
    source: &str,
    target: &str,
) -> GitRefOperationPreflight {
    let branches = get_git_branches(cwd);
    let valid_refs = source != target
        && branches.iter().any(|branch| branch.name == source)
        && branches.iter().any(|branch| branch.name == target);
    let clean_worktree =
        run_git(&["status", "--porcelain"], cwd).is_some_and(|value| value.trim().is_empty());
    let worktrees = get_git_worktrees(cwd);
    let source_in_other_worktree = worktrees
        .iter()
        .any(|worktree| !worktree.is_current && worktree.branch.as_deref() == Some(source));
    let target_in_other_worktree = worktrees
        .iter()
        .any(|worktree| !worktree.is_current && worktree.branch.as_deref() == Some(target));
    let operation_idle =
        get_git_repository_operation_state(cwd).kind == GitRepositoryOperationKind::Idle;
    let common = valid_refs && clean_worktree && operation_idle;
    let can_merge = common && !target_in_other_worktree;
    let shared_ancestor =
        run_git(&["merge-base", source, target], cwd).is_some_and(|value| !value.trim().is_empty());
    let can_rebase = common && !source_in_other_worktree && shared_ancestor;
    let interactive_rebase_commits = if can_rebase {
        interactive_rebase_commits(cwd, source, target)
    } else {
        Vec::new()
    };
    let interactive_rebase_has_merge =
        can_rebase && interactive_rebase_has_merge(cwd, source, target);
    let can_interactive_rebase =
        can_rebase && !interactive_rebase_commits.is_empty() && !interactive_rebase_has_merge;
    let can_fast_forward = can_merge
        && Command::new("git")
            .args(["merge-base", "--is-ancestor", target, source])
            .current_dir(cwd)
            .output()
            .is_ok_and(|output| output.status.success());
    let mut reasons = Vec::new();
    if !valid_refs {
        reasons.push("Choose two different local branches".to_string());
    }
    if !clean_worktree {
        reasons.push("Commit or stash working changes first".to_string());
    }
    if !operation_idle {
        reasons.push("Finish or abort the current Git operation first".to_string());
    }
    if source_in_other_worktree {
        reasons.push(format!("{source} is checked out in another worktree"));
    }
    if target_in_other_worktree {
        reasons.push(format!("{target} is checked out in another worktree"));
    }
    if common && !can_fast_forward {
        reasons.push(format!("{target} is not an ancestor of {source}"));
    }
    if common && !shared_ancestor {
        reasons.push("The branches do not share a common ancestor".to_string());
    } else if can_rebase && interactive_rebase_commits.is_empty() {
        reasons.push(format!("{source} has no commits to replay onto {target}"));
    } else if interactive_rebase_has_merge {
        reasons.push(
            "Interactive rebase is unavailable while the source range contains merge commits"
                .to_string(),
        );
    }
    GitRefOperationPreflight {
        source: source.to_string(),
        target: target.to_string(),
        valid_refs,
        clean_worktree,
        source_in_other_worktree,
        target_in_other_worktree,
        can_merge,
        can_fast_forward,
        can_rebase,
        can_interactive_rebase,
        interactive_rebase_commits,
        reasons,
    }
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn interactive_rebase_state_dir(cwd: &str) -> Option<PathBuf> {
    repository_git_path(cwd, "inferay-interactive-rebase")
}

fn cleanup_interactive_rebase_state(cwd: &str) {
    if let Some(path) = interactive_rebase_state_dir(cwd) {
        let _ = fs::remove_dir_all(path);
    }
}

fn invalid_ref_operation(cwd: &str, operation: &str, error: String) -> GitRefOperationResult {
    GitRefOperationResult {
        ok: false,
        operation: operation.to_string(),
        outcome: GitOperationOutcome::Failed,
        current_branch: current_git_branch(cwd),
        head: current_git_head(cwd),
        conflicts: git_conflicts(cwd),
        error_kind: Some(GitOperationErrorKind::InvalidInput),
        error: Some(error),
    }
}

pub fn perform_git_interactive_rebase(
    cwd: &str,
    source: &str,
    target: &str,
    steps: &[GitInteractiveRebaseStep],
) -> GitRefOperationResult {
    const OPERATION: &str = "interactiveRebase";
    let preflight = preflight_git_ref_operation(cwd, source, target);
    if !preflight.can_interactive_rebase {
        let reason = if preflight.reasons.is_empty() {
            "Interactive rebase is not valid for these branches".to_string()
        } else {
            preflight.reasons.join(". ")
        };
        return invalid_ref_operation(cwd, OPERATION, reason);
    }

    let expected = preflight
        .interactive_rebase_commits
        .iter()
        .map(|commit| commit.hash.as_str())
        .collect::<HashSet<_>>();
    let supplied = steps
        .iter()
        .map(|step| step.hash.as_str())
        .collect::<HashSet<_>>();
    if steps.len() != expected.len() || supplied != expected {
        return invalid_ref_operation(
            cwd,
            OPERATION,
            "The interactive rebase plan must contain every source commit exactly once".to_string(),
        );
    }

    let messages = preflight
        .interactive_rebase_commits
        .iter()
        .map(|commit| (commit.hash.as_str(), commit.message.as_str()))
        .collect::<HashMap<_, _>>();
    let mut has_kept_commit = false;
    for step in steps {
        match step.action.as_str() {
            "pick" => has_kept_commit = true,
            "reword" => {
                if step
                    .message
                    .as_deref()
                    .map_or(true, |message| message.trim().is_empty())
                {
                    return invalid_ref_operation(
                        cwd,
                        OPERATION,
                        format!("A replacement message is required for {}", step.hash),
                    );
                }
                has_kept_commit = true;
            }
            "squash" if !has_kept_commit => {
                return invalid_ref_operation(
                    cwd,
                    OPERATION,
                    "The first retained commit cannot be squashed".to_string(),
                );
            }
            "squash" | "drop" => {}
            _ => {
                return invalid_ref_operation(
                    cwd,
                    OPERATION,
                    format!("Unsupported interactive rebase action: {}", step.action),
                );
            }
        }
    }

    let Some(state_dir) = interactive_rebase_state_dir(cwd) else {
        return invalid_ref_operation(
            cwd,
            OPERATION,
            "Unable to resolve repository metadata directory".to_string(),
        );
    };
    cleanup_interactive_rebase_state(cwd);
    if let Err(error) = fs::create_dir_all(&state_dir) {
        return invalid_ref_operation(cwd, OPERATION, error.to_string());
    }

    let todo_path = state_dir.join("todo");
    let editor_path = state_dir.join("sequence-editor.sh");
    let mut todo = String::new();
    for (index, step) in steps.iter().enumerate() {
        let subject = messages
            .get(step.hash.as_str())
            .copied()
            .unwrap_or_default()
            .replace(['\r', '\n'], " ");
        match step.action.as_str() {
            "reword" => {
                let message_path = state_dir.join(format!("message-{index}"));
                if let Err(error) = fs::write(
                    &message_path,
                    format!("{}\n", step.message.as_deref().unwrap_or_default().trim()),
                ) {
                    cleanup_interactive_rebase_state(cwd);
                    return invalid_ref_operation(cwd, OPERATION, error.to_string());
                }
                todo.push_str(&format!("pick {} {}\n", step.hash, subject));
                todo.push_str(&format!(
                    "exec git -c commit.gpgSign=false commit --amend --no-verify -F {}\n",
                    shell_single_quote(&message_path.to_string_lossy())
                ));
            }
            action => todo.push_str(&format!("{action} {} {}\n", step.hash, subject)),
        }
    }
    if let Err(error) = fs::write(&todo_path, todo).and_then(|_| {
        fs::write(
            &editor_path,
            "#!/bin/sh\ncp \"$INFERAY_REBASE_TODO\" \"$1\"\n",
        )
    }) {
        cleanup_interactive_rebase_state(cwd);
        return invalid_ref_operation(cwd, OPERATION, error.to_string());
    }

    let checkout = checkout_git_branch(cwd, source);
    if !checkout.ok {
        cleanup_interactive_rebase_state(cwd);
        return invalid_ref_operation(
            cwd,
            OPERATION,
            checkout
                .error
                .unwrap_or_else(|| format!("Unable to check out {source}")),
        );
    }
    let Some(merge_base) = run_git(&["merge-base", source, target], cwd) else {
        cleanup_interactive_rebase_state(cwd);
        return invalid_ref_operation(
            cwd,
            OPERATION,
            "The branches do not share a common ancestor".to_string(),
        );
    };
    let sequence_editor = format!("sh {}", shell_single_quote(&editor_path.to_string_lossy()));
    let output = Command::new("git")
        .args([
            "rebase",
            "--interactive",
            "--onto",
            target,
            merge_base.trim(),
            source,
        ])
        .current_dir(cwd)
        .env("GIT_SEQUENCE_EDITOR", sequence_editor)
        .env("INFERAY_REBASE_TODO", &todo_path)
        .env("GIT_EDITOR", "true")
        .output();
    let result = ref_operation_result(cwd, OPERATION, output);
    if get_git_repository_operation_state(cwd).kind == GitRepositoryOperationKind::Idle {
        cleanup_interactive_rebase_state(cwd);
    }
    result
}

pub fn perform_git_ref_operation(
    cwd: &str,
    operation: &str,
    source: &str,
    target: &str,
) -> GitRefOperationResult {
    let branches = get_git_branches(cwd);
    if source == target
        || !branches.iter().any(|branch| branch.name == source)
        || !branches.iter().any(|branch| branch.name == target)
    {
        return GitRefOperationResult {
            ok: false,
            operation: operation.to_string(),
            outcome: GitOperationOutcome::Failed,
            current_branch: current_git_branch(cwd),
            head: current_git_head(cwd),
            conflicts: Vec::new(),
            error_kind: Some(GitOperationErrorKind::InvalidInput),
            error: Some("Source and target must be different local branches".to_string()),
        };
    }
    if !run_git(&["status", "--porcelain"], cwd).is_some_and(|value| value.trim().is_empty()) {
        return GitRefOperationResult {
            ok: false,
            operation: operation.to_string(),
            outcome: GitOperationOutcome::Failed,
            current_branch: current_git_branch(cwd),
            head: current_git_head(cwd),
            conflicts: Vec::new(),
            error_kind: Some(GitOperationErrorKind::DirtyWorktree),
            error: Some(
                "Commit or stash working changes before changing branch history".to_string(),
            ),
        };
    }

    let checkout = match operation {
        "merge" | "fastForward" => checkout_git_branch(cwd, target),
        "rebase" => checkout_git_branch(cwd, source),
        _ => {
            return GitRefOperationResult {
                ok: false,
                operation: operation.to_string(),
                outcome: GitOperationOutcome::Failed,
                current_branch: current_git_branch(cwd),
                head: current_git_head(cwd),
                conflicts: Vec::new(),
                error_kind: Some(GitOperationErrorKind::InvalidInput),
                error: Some("Unsupported ref operation".to_string()),
            };
        }
    };
    if !checkout.ok {
        let error = checkout
            .error
            .unwrap_or_else(|| "Unable to check out the requested branch".to_string());
        return GitRefOperationResult {
            ok: false,
            operation: operation.to_string(),
            outcome: GitOperationOutcome::Failed,
            current_branch: checkout.branch,
            head: current_git_head(cwd),
            conflicts: Vec::new(),
            error_kind: Some(classify_git_operation_error(&error, &[])),
            error: Some(error),
        };
    }

    let output = if operation == "merge" {
        Command::new("git")
            .args(["merge", "--no-edit", source])
            .current_dir(cwd)
            .output()
    } else if operation == "fastForward" {
        Command::new("git")
            .args(["merge", "--ff-only", source])
            .current_dir(cwd)
            .output()
    } else {
        Command::new("git")
            .args(["rebase", target])
            .current_dir(cwd)
            .env("GIT_EDITOR", "true")
            .output()
    };
    ref_operation_result(cwd, operation, output)
}

pub fn finish_git_ref_operation(cwd: &str, operation: &str, action: &str) -> GitRefOperationResult {
    let args: &[&str] = match (operation, action) {
        ("merge", "continue") => &["merge", "--continue"],
        ("merge", "abort") => &["merge", "--abort"],
        ("rebase", "continue") => &["rebase", "--continue"],
        ("rebase", "skip") => &["rebase", "--skip"],
        ("rebase", "abort") => &["rebase", "--abort"],
        ("interactiveRebase", "continue") => &["rebase", "--continue"],
        ("interactiveRebase", "skip") => &["rebase", "--skip"],
        ("interactiveRebase", "abort") => &["rebase", "--abort"],
        ("cherryPick", "continue") => &["cherry-pick", "--continue"],
        ("cherryPick", "skip") => &["cherry-pick", "--skip"],
        ("cherryPick", "abort") => &["cherry-pick", "--abort"],
        ("revert", "continue") => &["revert", "--continue"],
        ("revert", "skip") => &["revert", "--skip"],
        ("revert", "abort") => &["revert", "--abort"],
        _ => {
            return GitRefOperationResult {
                ok: false,
                operation: operation.to_string(),
                outcome: GitOperationOutcome::Failed,
                current_branch: current_git_branch(cwd),
                head: current_git_head(cwd),
                conflicts: git_conflicts(cwd),
                error_kind: Some(GitOperationErrorKind::InvalidInput),
                error: Some("Unsupported conflict action".to_string()),
            };
        }
    };
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_EDITOR", "true")
        .output();
    let result = ref_operation_result(cwd, operation, output);
    if get_git_repository_operation_state(cwd).kind == GitRepositoryOperationKind::Idle
        && (operation == "interactiveRebase"
            || interactive_rebase_state_dir(cwd).is_some_and(|path| path.exists()))
    {
        cleanup_interactive_rebase_state(cwd);
    }
    result
}

fn graph_action_result(
    cwd: &str,
    action: &str,
    output: std::io::Result<std::process::Output>,
) -> GitGraphActionResult {
    match ref_operation_result(cwd, action, output) {
        GitRefOperationResult {
            ok,
            outcome,
            current_branch,
            head,
            conflicts,
            error_kind,
            error,
            ..
        } => GitGraphActionResult {
            ok,
            action: action.to_string(),
            outcome,
            current_branch,
            head,
            conflicts,
            error_kind,
            error,
        },
    }
}

fn graph_action_error(cwd: &str, action: &str, error: impl Into<String>) -> GitGraphActionResult {
    let error = error.into();
    let conflicts = git_conflicts(cwd);
    GitGraphActionResult {
        ok: false,
        action: action.to_string(),
        outcome: if conflicts.is_empty() {
            GitOperationOutcome::Failed
        } else {
            GitOperationOutcome::Conflicted
        },
        current_branch: current_git_branch(cwd),
        head: current_git_head(cwd),
        error_kind: Some(classify_git_operation_error(&error, &conflicts)),
        conflicts,
        error: Some(error),
    }
}

fn valid_commit_target(cwd: &str, target: &str) -> bool {
    if target.is_empty() {
        return false;
    }
    let revision = format!("{target}^{{commit}}");
    Command::new("git")
        .args(["rev-parse", "--verify", "--quiet", &revision])
        .current_dir(cwd)
        .output()
        .is_ok_and(|output| output.status.success())
}

fn valid_ref_name(cwd: &str, kind: &str, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let candidate = if kind == "branch" {
        name.to_string()
    } else {
        format!("refs/tags/{name}")
    };
    let mut command = Command::new("git");
    command.arg("check-ref-format");
    if kind == "branch" {
        command.arg("--branch");
    }
    command
        .arg(candidate)
        .current_dir(cwd)
        .output()
        .is_ok_and(|output| output.status.success())
}

fn git_remote_names(cwd: &str) -> Vec<String> {
    let mut remotes = run_git(&["remote"], cwd)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    remotes.sort_by_key(|remote| std::cmp::Reverse(remote.len()));
    remotes
}

fn valid_remote(cwd: &str, remote: &str) -> bool {
    !remote.starts_with('-') && git_remote_names(cwd).iter().any(|name| name == remote)
}

fn split_remote_tracking_ref(cwd: &str, full_name: &str) -> Option<(String, String)> {
    let tracking_name = full_name.strip_prefix("refs/remotes/")?;
    git_remote_names(cwd).into_iter().find_map(|remote| {
        tracking_name
            .strip_prefix(&format!("{remote}/"))
            .filter(|branch| !branch.is_empty() && !branch.starts_with('-'))
            .map(|branch| (remote, branch.to_string()))
    })
}

pub fn perform_git_graph_action(
    cwd: &str,
    action: &str,
    target: Option<&str>,
    name: Option<&str>,
    message: Option<&str>,
) -> GitGraphActionResult {
    perform_git_graph_action_with_targets(cwd, action, target, &[], name, message)
}

pub fn perform_git_graph_action_with_targets(
    cwd: &str,
    action: &str,
    target: Option<&str>,
    targets: &[String],
    name: Option<&str>,
    message: Option<&str>,
) -> GitGraphActionResult {
    let target = target.unwrap_or_default();
    let name = name.unwrap_or_default().trim();
    let operation = get_git_repository_operation_state(cwd);
    if operation.kind != GitRepositoryOperationKind::Idle {
        return graph_action_error(
            cwd,
            action,
            "Finish or abort the current Git operation before starting another",
        );
    }

    let output = match action {
        "createBranch" => {
            if !valid_commit_target(cwd, target) || !valid_ref_name(cwd, "branch", name) {
                return graph_action_error(cwd, action, "Invalid branch name or commit");
            }
            Command::new("git")
                .args(["branch", name, target])
                .current_dir(cwd)
                .output()
        }
        "createTag" => {
            if !valid_commit_target(cwd, target) || !valid_ref_name(cwd, "tag", name) {
                return graph_action_error(cwd, action, "Invalid tag name or commit");
            }
            let mut command = Command::new("git");
            command.current_dir(cwd).arg("tag");
            if let Some(annotation) = message.filter(|value| !value.trim().is_empty()) {
                command.args(["-a", name, "-m", annotation, target]);
            } else {
                command.args([name, target]);
            }
            command.output()
        }
        "renameBranch" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
                || !valid_ref_name(cwd, "branch", name)
            {
                return graph_action_error(cwd, action, "Invalid local branch or new name");
            }
            Command::new("git")
                .args(["branch", "-m", target, name])
                .current_dir(cwd)
                .output()
        }
        "deleteBranch" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
            {
                return graph_action_error(cwd, action, "Local branch not found");
            }
            if current_git_branch(cwd).as_deref() == Some(target) {
                return graph_action_error(cwd, action, "The checked-out branch cannot be deleted");
            }
            Command::new("git")
                .args(["branch", "-d", target])
                .current_dir(cwd)
                .output()
        }
        "deleteTag" => {
            let full_name = format!("refs/tags/{target}");
            if target.is_empty()
                || run_git(&["show-ref", "--verify", "--quiet", &full_name], cwd).is_none()
            {
                return graph_action_error(cwd, action, "Local tag not found");
            }
            Command::new("git")
                .args(["tag", "-d", target])
                .current_dir(cwd)
                .output()
        }
        "setUpstream" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
                || name.is_empty()
                || name.starts_with('-')
                || !valid_commit_target(cwd, name)
            {
                return graph_action_error(cwd, action, "Invalid local branch or upstream");
            }
            Command::new("git")
                .args(["branch", &format!("--set-upstream-to={name}"), target])
                .current_dir(cwd)
                .output()
        }
        "pushSetUpstream" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
                || !valid_remote(cwd, name)
            {
                return graph_action_error(cwd, action, "Invalid local branch or remote");
            }
            Command::new("git")
                .args(["push", "--set-upstream", name, target])
                .current_dir(cwd)
                .output()
        }
        "deleteRemoteBranch" => {
            let Some((remote, branch)) = split_remote_tracking_ref(cwd, target) else {
                return graph_action_error(cwd, action, "Remote-tracking branch not found");
            };
            Command::new("git")
                .args(["push", &remote, "--delete", &branch])
                .current_dir(cwd)
                .output()
        }
        "pushTag" | "deleteRemoteTag" => {
            let full_name = format!("refs/tags/{target}");
            if target.is_empty()
                || target.starts_with('-')
                || !valid_remote(cwd, name)
                || run_git(&["show-ref", "--verify", "--quiet", &full_name], cwd).is_none()
            {
                return graph_action_error(cwd, action, "Invalid local tag or remote");
            }
            let refspec = if action == "deleteRemoteTag" {
                format!(":refs/tags/{target}")
            } else {
                format!("refs/tags/{target}:refs/tags/{target}")
            };
            Command::new("git")
                .args(["push", name, &refspec])
                .current_dir(cwd)
                .output()
        }
        "cherryPick" | "revert" => {
            let ordered_targets = if action == "cherryPick" && !targets.is_empty() {
                targets.iter().map(String::as_str).collect::<Vec<_>>()
            } else {
                vec![target]
            };
            if ordered_targets.is_empty()
                || ordered_targets
                    .iter()
                    .any(|candidate| !valid_commit_target(cwd, candidate))
            {
                return graph_action_error(cwd, action, "Commit not found");
            }
            if !run_git(&["status", "--porcelain"], cwd)
                .is_some_and(|value| value.trim().is_empty())
            {
                return graph_action_error(
                    cwd,
                    action,
                    "Commit or stash working changes before changing history",
                );
            }
            let mut command = Command::new("git");
            command.current_dir(cwd).env("GIT_EDITOR", "true");
            if action == "cherryPick" {
                command.args(["cherry-pick", "--no-edit"]);
                command.args(&ordered_targets);
            } else {
                command.args(["revert", "--no-edit", target]);
            }
            command.output()
        }
        "stashPush" => {
            let stash_message = message
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("WIP from Inferay");
            Command::new("git")
                .args(["stash", "push", "--include-untracked", "-m", stash_message])
                .current_dir(cwd)
                .output()
        }
        "stashApply" | "stashPop" | "stashDrop" => {
            if !get_git_stashes(cwd)
                .iter()
                .any(|stash| stash.name == target)
            {
                return graph_action_error(cwd, action, "Stash not found");
            }
            let subcommand = match action {
                "stashApply" => "apply",
                "stashPop" => "pop",
                _ => "drop",
            };
            Command::new("git")
                .args(["stash", subcommand, target])
                .current_dir(cwd)
                .output()
        }
        "stashRename" => {
            if name.is_empty() {
                return graph_action_error(cwd, action, "A new stash message is required");
            }
            if !get_git_stashes(cwd)
                .iter()
                .any(|stash| stash.name == target)
            {
                return graph_action_error(cwd, action, "Stash not found");
            }
            let Some(hash) = run_git(&["rev-parse", target], cwd)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            else {
                return graph_action_error(cwd, action, "Unable to resolve stash");
            };
            let drop = Command::new("git")
                .args(["stash", "drop", target])
                .current_dir(cwd)
                .output();
            if !drop.as_ref().is_ok_and(|output| output.status.success()) {
                return graph_action_result(cwd, action, drop);
            }
            Command::new("git")
                .args(["stash", "store", "-m", name, &hash])
                .current_dir(cwd)
                .output()
        }
        "resetSoft" | "resetMixed" | "resetHard" => {
            if !valid_commit_target(cwd, target) || current_git_branch(cwd).is_none() {
                return graph_action_error(
                    cwd,
                    action,
                    "A commit and checked-out branch are required",
                );
            }
            let mode = match action {
                "resetSoft" => "--soft",
                "resetMixed" => "--mixed",
                _ => "--hard",
            };
            Command::new("git")
                .args(["reset", mode, target])
                .current_dir(cwd)
                .output()
        }
        "fetch" => Command::new("git")
            .args(["fetch", "--all", "--prune"])
            .current_dir(cwd)
            .output(),
        "pull" => {
            if !run_git(&["status", "--porcelain"], cwd)
                .is_some_and(|value| value.trim().is_empty())
            {
                return graph_action_error(
                    cwd,
                    action,
                    "Commit or stash working changes before pulling",
                );
            }
            let Some(status) = get_git_status(cwd) else {
                return graph_action_error(cwd, action, "Repository status is unavailable");
            };
            if status.upstream.is_none() {
                return graph_action_error(
                    cwd,
                    action,
                    "The current branch has no configured upstream",
                );
            }
            Command::new("git")
                .args(["pull", "--no-edit"])
                .current_dir(cwd)
                .env("GIT_EDITOR", "true")
                .output()
        }
        "push" => {
            let Some(status) = get_git_status(cwd) else {
                return graph_action_error(cwd, action, "Repository status is unavailable");
            };
            if status.upstream.is_none() {
                return graph_action_error(
                    cwd,
                    action,
                    "The current branch has no configured upstream",
                );
            }
            Command::new("git").arg("push").current_dir(cwd).output()
        }
        "forcePushWithLease" => {
            let Some(status) = get_git_status(cwd) else {
                return graph_action_error(cwd, action, "Repository status is unavailable");
            };
            if status.branch != target || status.upstream.is_none() {
                return graph_action_error(
                    cwd,
                    action,
                    "The checked-out branch and a configured upstream are required",
                );
            }
            Command::new("git")
                .args(["push", "--force-with-lease"])
                .current_dir(cwd)
                .output()
        }
        _ => return graph_action_error(cwd, action, "Unsupported graph action"),
    };
    graph_action_result(cwd, action, output)
}

fn parse_commit_summary_log(result: Option<String>) -> Vec<GitCommitSummary> {
    let Some(result) = result else {
        return Vec::new();
    };
    result
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut parts = line.split('|');
            GitCommitSummary {
                hash: parts.next().unwrap_or("").to_string(),
                message: parts.next().unwrap_or("").to_string(),
                author: parts.next().unwrap_or("").to_string(),
                date: parts.next().unwrap_or("").to_string(),
            }
        })
        .collect()
}

pub fn get_git_log(cwd: &str, limit: usize) -> Vec<GitCommitSummary> {
    let limit = format!("--max-count={limit}");
    parse_commit_summary_log(run_git(&["log", &limit, "--format=%h|%s|%an|%ar"], cwd))
}

pub fn get_git_blame(cwd: &str, file_path: &str) -> Vec<GitBlameLine> {
    let Some(result) = run_git(&["blame", "--porcelain", "--", file_path], cwd) else {
        return Vec::new();
    };
    let raw_lines: Vec<&str> = result.split('\n').collect();
    let mut lines = Vec::new();
    let mut commits = HashMap::<String, (String, String)>::new();
    let mut index = 0usize;

    while index < raw_lines.len() {
        let header_parts: Vec<&str> = raw_lines[index].split_whitespace().collect();
        let valid_header = header_parts.len() >= 3
            && header_parts[0].len() == 40
            && header_parts[0].bytes().all(|byte| byte.is_ascii_hexdigit())
            && header_parts[1].parse::<usize>().is_ok()
            && header_parts[2].parse::<usize>().is_ok();
        if !valid_header {
            index += 1;
            continue;
        }

        let hash = header_parts[0].to_string();
        let line_num = header_parts[2].parse::<usize>().unwrap_or(0);
        index += 1;
        if !commits.contains_key(&hash) {
            let mut author = String::new();
            let mut date = String::new();
            while index < raw_lines.len() && !raw_lines[index].starts_with('\t') {
                let line = raw_lines[index];
                if let Some(value) = line.strip_prefix("author ") {
                    author = value.to_string();
                } else if let Some(value) = line.strip_prefix("author-time ") {
                    if let Ok(timestamp) = value.parse::<i64>() {
                        if let Some(local) = Local.timestamp_opt(timestamp, 0).single() {
                            date = local.format("%b %-d, %Y").to_string();
                        }
                    }
                }
                index += 1;
            }
            commits.insert(hash.clone(), (author, date));
        } else {
            while index < raw_lines.len() && !raw_lines[index].starts_with('\t') {
                index += 1;
            }
        }
        let content = raw_lines
            .get(index)
            .and_then(|line| line.strip_prefix('\t'))
            .unwrap_or("")
            .to_string();
        index += 1;
        let (author, date) = commits.get(&hash).cloned().unwrap_or_default();
        lines.push(GitBlameLine {
            hash: hash.chars().take(7).collect(),
            author,
            date,
            line_num,
            content,
        });
    }
    lines
}

pub fn get_git_file_history(cwd: &str, file_path: &str, limit: usize) -> Vec<GitCommitSummary> {
    let limit = format!("--max-count={limit}");
    parse_commit_summary_log(run_git(
        &[
            "log",
            &limit,
            "--format=%h|%s|%an|%ar",
            "--follow",
            "--",
            file_path,
        ],
        cwd,
    ))
}

fn github_repository_from_remote(remote_url: &str) -> Option<(String, String)> {
    let remote_url = remote_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git");
    let path = remote_url
        .split_once("github.com:")
        .map(|(_, path)| path)
        .or_else(|| remote_url.split_once("github.com/").map(|(_, path)| path))?;
    let mut parts = path.trim_matches('/').split('/');
    let owner = parts.next()?.trim();
    let repository = parts.next()?.trim();
    if owner.is_empty() || repository.is_empty() || parts.next().is_some() {
        return None;
    }
    let name = format!("{owner}/{repository}");
    Some((name.clone(), format!("https://github.com/{name}")))
}

fn github_pull_request_number(subject: &str) -> Option<u64> {
    if let Some(number) = subject.strip_prefix("Merge pull request #") {
        return number
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse()
            .ok();
    }
    let marker = subject.rfind("(#")?;
    if !subject.ends_with(')') {
        return None;
    }
    subject[marker + 2..subject.len() - 1].parse().ok()
}

fn get_commit_provider_metadata(cwd: &str, subject: &str) -> Option<GitCommitProviderMetadata> {
    let remotes = git_remote_names(cwd);
    let remote = remotes
        .iter()
        .find(|remote| remote.as_str() == "origin")
        .or_else(|| remotes.first())?;
    let remote_url = run_git(&["remote", "get-url", remote], cwd)?;
    let (repository, repository_url) = github_repository_from_remote(&remote_url)?;
    let pull_request_number = github_pull_request_number(subject);
    let pull_request_url =
        pull_request_number.map(|number| format!("{repository_url}/pull/{number}"));
    Some(GitCommitProviderMetadata {
        provider: "github".to_string(),
        repository,
        repository_url,
        pull_request_number,
        pull_request_url,
    })
}

pub fn get_git_commit_details(cwd: &str, hash: &str) -> Option<GitCommitDetails> {
    get_git_commit_details_for_parent(cwd, hash, None)
}

pub fn get_git_commit_details_for_parent(
    cwd: &str,
    hash: &str,
    requested_parent: Option<&str>,
) -> Option<GitCommitDetails> {
    let info = run_git(
        &[
            "show",
            "-s",
            "--decorate=full",
            "--format=%H%x1f%P%x1f%aN%x1f%aE%x1f%aI%x1f%cN%x1f%cE%x1f%cI%x1f%D%x1f%s%x1f%b",
            hash,
        ],
        cwd,
    )?;
    if info.is_empty() {
        return None;
    }
    let mut info_parts = info.trim_end().splitn(11, '\x1f');
    let full_hash = info_parts.next().unwrap_or("").to_string();
    let parents: Vec<String> = info_parts
        .next()
        .unwrap_or("")
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect();
    let diff_parent = requested_parent
        .filter(|candidate| parents.iter().any(|parent| parent == candidate))
        .map(ToOwned::to_owned)
        .or_else(|| parents.first().cloned());
    let author = info_parts.next().unwrap_or("").to_string();
    let author_email = info_parts.next().unwrap_or("").to_string();
    let authored_at = info_parts.next().unwrap_or("").to_string();
    let committer = info_parts.next().unwrap_or("").to_string();
    let committer_email = info_parts.next().unwrap_or("").to_string();
    let committed_at = info_parts.next().unwrap_or("").to_string();
    let _decorations = info_parts.next();
    let refs = get_graph_refs(cwd).remove(&full_hash).unwrap_or_default();
    let message = info_parts.next().unwrap_or("").to_string();
    let body = info_parts.next().unwrap_or("").trim().to_string();

    let mut stats = HashMap::<String, (usize, usize, bool)>::new();
    let numstat_args = if let Some(parent) = diff_parent.as_deref() {
        vec!["diff", "--find-renames", "--numstat", parent, hash]
    } else {
        vec![
            "diff-tree",
            "--root",
            "--no-commit-id",
            "-r",
            "--find-renames",
            "--numstat",
            hash,
        ]
    };
    if let Some(result) = run_git(&numstat_args, cwd) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                stats.insert(
                    normalize_numstat_path(parts[2]),
                    (
                        parse_numstat_count(parts[0]),
                        parse_numstat_count(parts[1]),
                        parts[0] == "-" || parts[1] == "-",
                    ),
                );
            }
        }
    }

    let mut files = Vec::new();
    let name_status_args = if let Some(parent) = diff_parent.as_deref() {
        vec!["diff", "--find-renames", "--name-status", parent, hash]
    } else {
        vec![
            "diff-tree",
            "--root",
            "--no-commit-id",
            "-r",
            "--find-renames",
            "--name-status",
            hash,
        ]
    };
    if let Some(result) = run_git(&name_status_args, cwd) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                let path = parts[parts.len() - 1].to_string();
                let status = parts[0].chars().next().unwrap_or('\0').to_string();
                let original_path = (status == "R" || status == "C")
                    .then(|| parts.get(1).copied().unwrap_or_default().to_string());
                let (additions, deletions, binary) = stats.get(&path).copied().unwrap_or_default();
                files.push(GitCommitFile {
                    path,
                    original_path,
                    status,
                    additions,
                    deletions,
                    binary,
                });
            }
        }
    }

    let provider = get_commit_provider_metadata(cwd, &message);
    Some(GitCommitDetails {
        hash: full_hash,
        parents,
        diff_parent,
        message,
        body,
        author,
        author_email,
        authored_at,
        committer,
        committer_email,
        committed_at,
        refs,
        provider,
        files,
    })
}

pub fn get_git_comparison_details(
    cwd: &str,
    from_hash: &str,
    to_hash: &str,
) -> Option<GitComparisonDetails> {
    if from_hash == to_hash
        || !valid_commit_target(cwd, from_hash)
        || !valid_commit_target(cwd, to_hash)
    {
        return None;
    }
    let from_hash = run_git(&["rev-parse", &format!("{from_hash}^{{commit}}")], cwd)?
        .trim()
        .to_string();
    let to_hash = run_git(&["rev-parse", &format!("{to_hash}^{{commit}}")], cwd)?
        .trim()
        .to_string();
    let merge_base = run_git(&["merge-base", &from_hash, &to_hash], cwd)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut stats = HashMap::<String, (usize, usize, bool)>::new();
    if let Some(result) = run_git(
        &["diff", "--find-renames", "--numstat", &from_hash, &to_hash],
        cwd,
    ) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts = line.split('\t').collect::<Vec<_>>();
            if parts.len() < 3 {
                continue;
            }
            stats.insert(
                normalize_numstat_path(parts[2]),
                (
                    parse_numstat_count(parts[0]),
                    parse_numstat_count(parts[1]),
                    parts[0] == "-" || parts[1] == "-",
                ),
            );
        }
    }
    let mut files = Vec::new();
    if let Some(result) = run_git(
        &[
            "diff",
            "--find-renames",
            "--name-status",
            &from_hash,
            &to_hash,
        ],
        cwd,
    ) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts = line.split('\t').collect::<Vec<_>>();
            if parts.len() < 2 {
                continue;
            }
            let path = parts[parts.len() - 1].to_string();
            let status = parts[0].chars().next().unwrap_or('\0').to_string();
            let original_path = (status == "R" || status == "C")
                .then(|| parts.get(1).copied().unwrap_or_default().to_string());
            let (additions, deletions, binary) = stats.get(&path).copied().unwrap_or_default();
            files.push(GitCommitFile {
                path,
                original_path,
                status,
                additions,
                deletions,
                binary,
            });
        }
    }
    Some(GitComparisonDetails {
        from_hash,
        to_hash,
        merge_base,
        files,
    })
}

pub fn get_git_worktree_comparison_details(
    allowed_paths: &AllowedPaths,
    cwd: &str,
    from_hash: &str,
) -> Option<GitComparisonDetails> {
    if !valid_commit_target(cwd, from_hash) {
        return None;
    }
    let from_hash = run_git(&["rev-parse", &format!("{from_hash}^{{commit}}")], cwd)?
        .trim()
        .to_string();
    let mut stats = HashMap::<String, (usize, usize, bool)>::new();
    if let Some(result) = run_git(&["diff", "--find-renames", "--numstat", &from_hash], cwd) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts = line.split('\t').collect::<Vec<_>>();
            if parts.len() < 3 {
                continue;
            }
            stats.insert(
                normalize_numstat_path(parts[2]),
                (
                    parse_numstat_count(parts[0]),
                    parse_numstat_count(parts[1]),
                    parts[0] == "-" || parts[1] == "-",
                ),
            );
        }
    }
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    if let Some(result) = run_git(
        &["diff", "--find-renames", "--name-status", &from_hash],
        cwd,
    ) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts = line.split('\t').collect::<Vec<_>>();
            if parts.len() < 2 {
                continue;
            }
            let path = parts[parts.len() - 1].to_string();
            let status = parts[0].chars().next().unwrap_or('\0').to_string();
            let original_path = (status == "R" || status == "C")
                .then(|| parts.get(1).copied().unwrap_or_default().to_string());
            let (additions, deletions, binary) = stats.get(&path).copied().unwrap_or_default();
            seen.insert(path.clone());
            files.push(GitCommitFile {
                path,
                original_path,
                status,
                additions,
                deletions,
                binary,
            });
        }
    }
    if let Some(status) = get_git_status(cwd) {
        for entry in status
            .files
            .into_iter()
            .filter(|entry| entry.status == "?" && seen.insert(entry.path.clone()))
        {
            let bytes = allowed_paths
                .resolve_allowed_child_path(cwd, &entry.path)
                .and_then(|path| allowed_paths.resolve_real_allowed_local_path(path))
                .and_then(|path| std::fs::read(path).ok())
                .unwrap_or_default();
            let binary = bytes.contains(&0);
            let additions = if binary {
                0
            } else {
                content_lines(&String::from_utf8_lossy(&bytes)).len()
            };
            files.push(GitCommitFile {
                path: entry.path,
                original_path: None,
                status: "A".to_string(),
                additions,
                deletions: 0,
                binary,
            });
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Some(GitComparisonDetails {
        from_hash: from_hash.clone(),
        to_hash: "WORKTREE".to_string(),
        merge_base: Some(from_hash),
        files,
    })
}

pub fn stage_git(cwd: &str, file_path: Option<&str>) -> bool {
    match file_path {
        Some(file_path) => run_git(&["add", "--", file_path], cwd).is_some(),
        None => run_git(&["add", "-A"], cwd).is_some(),
    }
}

pub fn unstage_git(cwd: &str, file_path: Option<&str>) -> bool {
    match file_path {
        Some(file_path) => run_git(&["reset", "HEAD", "--", file_path], cwd).is_some(),
        None => run_git(&["reset", "HEAD"], cwd).is_some(),
    }
}

pub fn commit_git(cwd: &str, message: &str) -> GitCommitResult {
    commit_git_mode(cwd, message, false)
}

pub fn amend_git(cwd: &str, message: &str) -> GitCommitResult {
    commit_git_mode(cwd, message, true)
}

fn commit_git_mode(cwd: &str, message: &str, amend: bool) -> GitCommitResult {
    if message.trim().is_empty() {
        return GitCommitResult {
            success: false,
            hash: None,
            error: Some("Commit message is required".to_string()),
        };
    }
    let arguments = if amend {
        vec!["commit", "--amend", "-m", message]
    } else {
        vec!["commit", "-m", message]
    };
    let Some(result) = run_git(&arguments, cwd) else {
        return GitCommitResult {
            success: false,
            hash: None,
            error: Some("Commit failed".to_string()),
        };
    };
    let hash = result.lines().find_map(|line| {
        let inside = line.strip_prefix('[')?.split_once(']')?.0;
        let (branch, hash) = inside.split_once(' ')?;
        (branch
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && !hash.is_empty()
            && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| hash.to_string())
    });
    GitCommitResult {
        success: true,
        hash,
        error: None,
    }
}

pub fn get_git_status(cwd: &str) -> Option<GitStatusResult> {
    let raw = run_git(
        &["status", "--porcelain=v1", "-b", "--untracked-files=all"],
        cwd,
    )?;

    let mut branch = String::from("HEAD");
    let mut upstream: Option<String> = None;
    let mut ahead = 0usize;
    let mut behind = 0usize;
    let mut files: Vec<GitFileEntry> = Vec::new();

    for line in raw.lines().filter(|line| !line.is_empty()) {
        if let Some(branch_line) = line.strip_prefix("## ") {
            if let Some(dotdot) = branch_line.find("...") {
                branch = branch_line[..dotdot].to_string();
                let rest = &branch_line[dotdot + 3..];
                if let Some(bracket_start) = rest.find('[') {
                    upstream = Some(rest[..bracket_start].trim().to_string());
                    if let Some(bracket_end) = rest.find(']') {
                        let info = &rest[bracket_start + 1..bracket_end];
                        if let Some(value) = info
                            .split(',')
                            .find_map(|part| part.trim().strip_prefix("ahead "))
                        {
                            ahead = value.parse::<usize>().unwrap_or(0);
                        }
                        if let Some(value) = info
                            .split(',')
                            .find_map(|part| part.trim().strip_prefix("behind "))
                        {
                            behind = value.parse::<usize>().unwrap_or(0);
                        }
                    }
                } else if !rest.trim().is_empty() {
                    upstream = Some(rest.trim().to_string());
                }
            } else {
                branch = branch_line
                    .split_whitespace()
                    .next()
                    .unwrap_or("HEAD")
                    .to_string();
            }
            continue;
        }

        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let file_path = line.get(3..).unwrap_or("").to_string();
        let arrow_idx = file_path.find(" -> ");
        let actual_path = arrow_idx
            .map(|idx| file_path[idx + 4..].to_string())
            .unwrap_or_else(|| file_path.clone());
        let original_path = arrow_idx.map(|idx| file_path[..idx].to_string());

        if x != ' ' && x != '?' {
            files.push(GitFileEntry {
                status: x.to_string(),
                staged: true,
                path: actual_path.clone(),
                original_path: original_path.clone(),
                additions: None,
                deletions: None,
            });
        }

        if y != ' ' && y != '?' {
            files.push(GitFileEntry {
                status: y.to_string(),
                staged: false,
                path: actual_path.clone(),
                original_path: original_path.clone(),
                additions: None,
                deletions: None,
            });
        }

        if x == '?' && y == '?' {
            files.push(GitFileEntry {
                status: String::from("?"),
                staged: false,
                path: actual_path,
                original_path: None,
                additions: None,
                deletions: None,
            });
        }
    }

    let staged_count = files.iter().filter(|file| file.staged).count();
    let unstaged_count = files
        .iter()
        .filter(|file| !file.staged && file.status != "?")
        .count();
    let untracked_count = files.iter().filter(|file| file.status == "?").count();
    let name = cwd.rsplit('/').next().unwrap_or(cwd).to_string();
    let diff_stats = get_working_tree_numstat(cwd);
    for file in &mut files {
        let prefix = if file.staged { "staged" } else { "unstaged" };
        if let Some((additions, deletions)) = diff_stats.get(&format!("{prefix}:{}", file.path)) {
            file.additions = Some(*additions);
            file.deletions = Some(*deletions);
        }
    }

    Some(GitStatusResult {
        cwd: cwd.to_string(),
        name,
        branch,
        upstream,
        ahead,
        behind,
        staged_count,
        unstaged_count,
        untracked_count,
        files,
    })
}

fn get_working_tree_numstat(cwd: &str) -> HashMap<String, (usize, usize)> {
    let (mut unstaged, staged) = std::thread::scope(|scope| {
        let unstaged = scope.spawn(|| get_numstat_entries(cwd, false));
        let staged = scope.spawn(|| get_numstat_entries(cwd, true));
        (
            unstaged.join().unwrap_or_default(),
            staged.join().unwrap_or_default(),
        )
    });
    unstaged.extend(staged);
    unstaged
}

fn get_numstat_entries(cwd: &str, staged: bool) -> HashMap<String, (usize, usize)> {
    let mut stats = HashMap::new();
    let args = if staged {
        ["diff", "--cached", "--numstat"].as_slice()
    } else {
        ["diff", "--numstat"].as_slice()
    };
    let Some(result) = run_git(args, cwd) else {
        return stats;
    };
    let prefix = if staged { "staged" } else { "unstaged" };
    for line in result.lines().filter(|line| !line.is_empty()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let additions = parse_numstat_count(parts[0]);
        let deletions = parse_numstat_count(parts[1]);
        let raw_path = parts[parts.len() - 1];
        stats.insert(
            format!("{prefix}:{}", normalize_numstat_path(raw_path)),
            (additions, deletions),
        );
    }
    stats
}

fn parse_numstat_count(value: &str) -> usize {
    if value == "-" {
        0
    } else {
        value.parse().unwrap_or(0)
    }
}

fn normalize_numstat_path(path: &str) -> String {
    let Some(arrow_index) = path.find(" => ") else {
        return path.to_string();
    };
    let brace_start = path[..arrow_index].rfind('{');
    let brace_end = path[arrow_index..]
        .find('}')
        .map(|offset| arrow_index + offset);
    if let (Some(brace_start), Some(brace_end)) = (brace_start, brace_end) {
        return format!(
            "{}{}{}",
            &path[..brace_start],
            &path[arrow_index + 4..brace_end],
            &path[brace_end + 1..]
        )
        .trim_start_matches('/')
        .to_string();
    }
    path[arrow_index + 4..].trim_start_matches('/').to_string()
}

fn graph_ref_kind_order(kind: &GitGraphRefKind) -> usize {
    match kind {
        GitGraphRefKind::Head => 0,
        GitGraphRefKind::LocalBranch => 1,
        GitGraphRefKind::RemoteBranch => 2,
        GitGraphRefKind::Tag => 3,
        GitGraphRefKind::Stash => 4,
    }
}

fn get_graph_refs(cwd: &str) -> HashMap<String, Vec<GitGraphRef>> {
    let worktrees = get_git_worktrees(cwd);
    let current_head =
        run_git(&["symbolic-ref", "-q", "HEAD"], cwd).map(|value| value.trim().to_string());
    let current_oid =
        run_git(&["rev-parse", "--verify", "HEAD"], cwd).map(|value| value.trim().to_string());
    let worktree_paths = worktrees
        .iter()
        .filter_map(|worktree| {
            worktree
                .branch
                .as_ref()
                .map(|branch| (format!("refs/heads/{branch}"), worktree.path.clone()))
        })
        .collect::<HashMap<_, _>>();
    let raw = run_git(
        &[
            "for-each-ref",
            "--format=%(refname)%09%(objectname)%09%(*objectname)%09%(symref)%09%(upstream:short)%09%(upstream:track)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
            "refs/stash",
        ],
        cwd,
    )
    .unwrap_or_default();
    let mut refs_by_target = HashMap::<String, Vec<GitGraphRef>>::new();

    for line in raw.lines().filter(|line| !line.is_empty()) {
        let mut fields = line.splitn(6, '\t');
        let full_name = fields.next().unwrap_or("").to_string();
        let object_name = fields.next().unwrap_or("");
        let peeled_object_name = fields.next().unwrap_or("");
        let symbolic_target = fields.next().unwrap_or("");
        let upstream = fields.next().filter(|value| !value.is_empty());
        let tracking = fields.next().unwrap_or_default();
        let tracking_value = |label: &str| {
            tracking
                .trim_matches(['[', ']'])
                .split(',')
                .map(str::trim)
                .find_map(|part| part.strip_prefix(label)?.parse::<usize>().ok())
        };
        if full_name.is_empty() || object_name.is_empty() || !symbolic_target.is_empty() {
            continue;
        }
        let target = if peeled_object_name.is_empty() {
            object_name
        } else {
            peeled_object_name
        }
        .to_string();
        let is_head = current_head.as_deref() == Some(full_name.as_str());
        let (kind, display_name, remote_name) = if full_name == "refs/stash" {
            (GitGraphRefKind::Stash, "stash".to_string(), None)
        } else if let Some(name) = full_name.strip_prefix("refs/heads/") {
            (
                if is_head {
                    GitGraphRefKind::Head
                } else {
                    GitGraphRefKind::LocalBranch
                },
                name.to_string(),
                None,
            )
        } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
            (
                GitGraphRefKind::RemoteBranch,
                name.to_string(),
                name.split('/').next().map(ToOwned::to_owned),
            )
        } else if let Some(name) = full_name.strip_prefix("refs/tags/") {
            (GitGraphRefKind::Tag, name.to_string(), None)
        } else {
            continue;
        };
        refs_by_target
            .entry(target.clone())
            .or_default()
            .push(GitGraphRef {
                full_name: full_name.clone(),
                display_name,
                kind,
                target,
                remote_name,
                is_head,
                worktree_path: worktree_paths.get(&full_name).cloned(),
                upstream: upstream.map(ToOwned::to_owned),
                ahead: tracking_value("ahead "),
                behind: tracking_value("behind "),
            });
    }

    if current_head.is_none() {
        if let Some(target) = current_oid {
            refs_by_target
                .entry(target.clone())
                .or_default()
                .push(GitGraphRef {
                    full_name: "HEAD".to_string(),
                    display_name: format!("HEAD detached at {}", &target[..target.len().min(7)]),
                    kind: GitGraphRefKind::Head,
                    target,
                    remote_name: None,
                    is_head: true,
                    worktree_path: worktrees
                        .iter()
                        .find(|worktree| worktree.is_current)
                        .map(|worktree| worktree.path.clone()),
                    upstream: None,
                    ahead: None,
                    behind: None,
                });
        }
    }

    for refs in refs_by_target.values_mut() {
        refs.sort_by(|a, b| {
            graph_ref_kind_order(&a.kind)
                .cmp(&graph_ref_kind_order(&b.kind))
                .then_with(|| a.display_name.cmp(&b.display_name))
        });
    }
    refs_by_target
}

fn get_graph_log_result(cwd: &str, limit: usize) -> Result<Vec<GitCommit>, GitCommandFailure> {
    let limit_arg = format!("--max-count={}", limit);
    let raw = run_git_checked_timed(
        &[
            "log",
            &limit_arg,
            // GitKraken's Commit Date / Time column uses the committer clock.
            // Date order keeps that clock aligned with the visible rows while
            // retaining Git's parent-after-child topological constraint.
            "--date-order",
            "--format=%H%x1f%P%x1f%s%x1f%b%x1f%aN%x1f%aE%x1f%cN%x1f%cE%x1f%cr%x1f%aI%x1f%cI%x1e",
            "--all",
        ],
        cwd,
        Duration::from_secs(10),
    )?;

    let mut refs_by_target = get_graph_refs(cwd);
    Ok(raw
        .split('\x1e')
        .map(str::trim)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let mut parts = record.splitn(11, '\x1f');
            let hash = parts.next().unwrap_or("").to_string();
            GitCommit {
                refs: refs_by_target.remove(&hash).unwrap_or_default(),
                hash,
                parents: parts
                    .next()
                    .unwrap_or("")
                    .split(' ')
                    .filter(|part| !part.is_empty())
                    .map(|part| part.to_string())
                    .collect(),
                message: parts.next().unwrap_or("").to_string(),
                body: parts.next().unwrap_or("").trim().to_string(),
                author: parts.next().unwrap_or("").to_string(),
                author_email: parts.next().unwrap_or("").to_string(),
                committer: parts.next().unwrap_or("").to_string(),
                committer_email: parts.next().unwrap_or("").to_string(),
                date: parts.next().unwrap_or("").to_string(),
                authored_at: parts.next().unwrap_or("").to_string(),
                committed_at: parts.next().unwrap_or("").to_string(),
            }
        })
        .collect())
}

fn get_graph_log(cwd: &str, limit: usize) -> Vec<GitCommit> {
    get_graph_log_result(cwd, limit).unwrap_or_default()
}

/// A stash commit is a presentation item; its second and optional third
/// parents are implementation commits for the index and untracked files.
/// Keep the base parent so the stash remains attached to history, but do not
/// expose those plumbing commits as ordinary rows.
fn collapse_stash_internal_commits(commits: &mut Vec<GitCommit>, stashes: &[GitStash]) {
    let stash_hashes = stashes
        .iter()
        .map(|stash| stash.hash.as_str())
        .collect::<HashSet<_>>();
    let mut internal_hashes = HashSet::new();
    for commit in commits.iter_mut() {
        if !stash_hashes.contains(commit.hash.as_str()) {
            continue;
        }
        internal_hashes.extend(commit.parents.iter().skip(1).cloned());
        commit.parents.truncate(1);
    }
    commits.retain(|commit| !internal_hashes.contains(&commit.hash));
}

pub fn get_git_graph(cwd: &str, limit: usize) -> (Vec<GraphCommit>, Vec<GraphRow>) {
    layout_graph(&get_graph_log(cwd, limit))
}

fn repository_snapshot_state(cwd: &str) -> (GitRepositorySnapshotState, Option<String>) {
    let git_dir = Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(cwd)
        .output();
    match git_dir {
        Err(error) => {
            return (
                GitRepositorySnapshotState::CommandFailed,
                Some(error.to_string()),
            );
        }
        Ok(output) if !output.status.success() => {
            return (GitRepositorySnapshotState::NonRepository, None);
        }
        Ok(_) => {}
    }

    let has_head = Command::new("git")
        .args(["rev-parse", "--verify", "--quiet", "HEAD"])
        .current_dir(cwd)
        .output()
        .is_ok_and(|output| output.status.success());
    if has_head {
        return (GitRepositorySnapshotState::Ready, None);
    }
    let has_symbolic_head = Command::new("git")
        .args(["symbolic-ref", "-q", "HEAD"])
        .current_dir(cwd)
        .output()
        .is_ok_and(|output| output.status.success());
    if has_symbolic_head {
        (GitRepositorySnapshotState::Unborn, None)
    } else {
        (GitRepositorySnapshotState::Empty, None)
    }
}

pub fn get_git_graph_snapshot(cwd: &str, limit: usize) -> GitGraphSnapshot {
    let (state, state_error) = repository_snapshot_state(cwd);
    if matches!(
        state,
        GitRepositorySnapshotState::NonRepository | GitRepositorySnapshotState::CommandFailed
    ) {
        return GitGraphSnapshot {
            commits: Vec::new(),
            rows: Vec::new(),
            has_more: false,
            worktrees: Vec::new(),
            stashes: Vec::new(),
            revision: stable_revision_token(&[cwd.to_string()]),
            operation: get_git_repository_operation_state(cwd),
            state,
            state_error,
        };
    }
    let mut worktrees = get_git_worktrees(cwd);
    for worktree in &mut worktrees {
        if !worktree.bare && !worktree.locked {
            worktree.status = get_git_status(&worktree.path);
        }
    }
    let stashes = get_git_stashes(cwd);
    let requested_history = limit
        .saturating_add(1)
        .saturating_add(stashes.len().saturating_mul(2));
    let mut semantic_commits = match get_graph_log_result(cwd, requested_history) {
        Ok(commits) => commits,
        Err(error) => {
            let error = error.summary();
            eprintln!("[git-graph] {error}");
            return GitGraphSnapshot {
                commits: Vec::new(),
                rows: Vec::new(),
                has_more: false,
                worktrees,
                stashes,
                revision: stable_revision_token(&[cwd.to_string(), error.clone()]),
                operation: get_git_repository_operation_state(cwd),
                state: GitRepositorySnapshotState::CommandFailed,
                state_error: Some(error),
            };
        }
    };
    collapse_stash_internal_commits(&mut semantic_commits, &stashes);
    let has_more = semantic_commits.len() > limit;
    semantic_commits.truncate(limit);

    // A worktree's index and working directory are not commits. Insert a
    // synthetic child immediately before its real HEAD so it participates in
    // the same deterministic lane layout without ever masquerading as an OID.
    for worktree in worktrees.iter().rev() {
        let has_changes = worktree
            .status
            .as_ref()
            .is_some_and(|status| !status.files.is_empty());
        if !has_changes {
            continue;
        }
        let head_index = semantic_commits
            .iter()
            .position(|commit| commit.hash == worktree.head)
            .unwrap_or(0);
        let identity = if worktree.is_current {
            format!("inferay-wip-current:{}", worktree.path)
        } else {
            format!("inferay-wip-linked:{}", worktree.path)
        };
        semantic_commits.insert(
            head_index,
            GitCommit {
                hash: identity,
                message: "Uncommitted changes".to_string(),
                body: String::new(),
                author: "Workspace".to_string(),
                author_email: String::new(),
                committer: "Workspace".to_string(),
                committer_email: String::new(),
                date: "Now".to_string(),
                authored_at: String::new(),
                committed_at: String::new(),
                parents: (!worktree.head.is_empty()
                    && !worktree.head.bytes().all(|byte| byte == b'0'))
                .then(|| worktree.head.clone())
                .into_iter()
                .collect(),
                refs: Vec::new(),
            },
        );
    }

    let (mut commits, rows) = layout_graph(&semantic_commits);
    let stash_names = stashes
        .iter()
        .map(|stash| (stash.hash.as_str(), stash.name.as_str()))
        .collect::<HashMap<_, _>>();
    for commit in &mut commits {
        if let Some(stash_name) = stash_names.get(commit.hash.as_str()) {
            commit.id = format!("stash:{stash_name}");
            commit.item_kind = GitGraphItemKind::Stash;
            commit.stash_name = Some((*stash_name).to_string());
        }
    }
    GitGraphSnapshot {
        commits,
        rows,
        has_more,
        worktrees,
        stashes,
        revision: get_git_repository_revision(cwd),
        operation: get_git_repository_operation_state(cwd),
        state,
        state_error,
    }
}

#[derive(Clone)]
struct ActiveLane {
    hash: String,
}

#[derive(Clone, Copy)]
struct LaneReservation {
    column: usize,
}

#[derive(Default)]
struct GraphLaneAllocator {
    reservations: HashMap<String, LaneReservation>,
    columns_to_free_when_found: HashMap<String, Vec<usize>>,
    columns_used: Vec<bool>,
    has_merge_node_child: HashSet<String>,
}

impl GraphLaneAllocator {
    fn first_free_column(&mut self) -> usize {
        if let Some(column) = self.columns_used.iter().position(|used| !*used) {
            self.columns_used[column] = true;
            return column;
        }
        self.columns_used.push(true);
        self.columns_used.len() - 1
    }

    fn schedule_column_release(&mut self, hash: &str, column: usize) {
        self.columns_to_free_when_found
            .entry(hash.to_string())
            .or_default()
            .push(column);
    }

    fn reservation_column(&self, hash: &str) -> Option<usize> {
        self.reservations
            .get(hash)
            .map(|reservation| reservation.column)
    }

    fn assign_column(&mut self, commit: &GitCommit) -> usize {
        // GitKraken reserves one preferred column per future commit. Other
        // children may still carry duplicate edges to the same hash, but only
        // the reservation decides where that commit's node will eventually be
        // drawn. Displaced duplicate columns are released at the parent row,
        // never early, so long rails remain stable across the intervening rows.
        self.has_merge_node_child.remove(&commit.hash);
        if let Some(columns) = self.columns_to_free_when_found.remove(&commit.hash) {
            for column in columns {
                if let Some(used) = self.columns_used.get_mut(column) {
                    *used = false;
                }
            }
        }

        let current_reservation = self.reservations.remove(&commit.hash);
        let commit_column = current_reservation
            .map(|reservation| reservation.column)
            .unwrap_or_else(|| self.first_free_column());

        for (parent_index, parent) in commit.parents.iter().enumerate() {
            if commit.parents.len() > 1 {
                self.has_merge_node_child.insert(parent.clone());
            }

            let existing_parent = self.reservations.get(parent).copied();
            if parent_index == 0
                && existing_parent.is_some_and(|reservation| reservation.column != commit_column)
            {
                let existing_parent = existing_parent.expect("checked above");
                if existing_parent.column > commit_column
                    && !self.has_merge_node_child.contains(parent)
                {
                    self.reservations.insert(
                        parent.clone(),
                        LaneReservation {
                            column: commit_column,
                        },
                    );
                    self.schedule_column_release(parent, existing_parent.column);
                } else {
                    self.schedule_column_release(parent, commit_column);
                }
            } else if existing_parent.is_none() {
                let parent_column = if parent_index == 0 {
                    commit_column
                } else {
                    self.first_free_column()
                };
                self.reservations.insert(
                    parent.clone(),
                    LaneReservation {
                        column: parent_column,
                    },
                );
            }
        }

        commit_column
    }
}

fn graph_lane_color(column: usize) -> usize {
    column % GRAPH_LANE_COUNT
}

fn layout_graph(commits: &[GitCommit]) -> (Vec<GraphCommit>, Vec<GraphRow>) {
    // A lane is one pending child -> parent edge, not one target commit. Two
    // children can therefore carry separate lanes to the same parent. Keeping
    // those edges distinct until the parent's row is the key behavior behind
    // GitKraken's long rails and its characteristic convergence geometry.
    //
    // Empty slots are intentionally retained. Compressing the vector whenever
    // a lane ends makes every lane to its right jump sideways on that row;
    // stable holes can be reused by later tips without moving unresolved rails.
    let mut active_lanes: Vec<Option<ActiveLane>> = Vec::new();
    let mut lane_allocator = GraphLaneAllocator::default();
    let mut graph_commits = Vec::with_capacity(commits.len());
    let mut graph_rows = Vec::with_capacity(commits.len());

    for (row_index, commit) in commits.iter().enumerate() {
        let incoming_columns = active_lanes
            .iter()
            .enumerate()
            .filter_map(|(column, lane)| {
                lane.as_ref()
                    .is_some_and(|lane| lane.hash == commit.hash)
                    .then_some(column)
            })
            .collect::<Vec<_>>();
        let commit_column = lane_allocator.assign_column(commit);
        let existing_commit_column = incoming_columns
            .contains(&commit_column)
            .then_some(commit_column);
        if active_lanes.len() <= commit_column {
            active_lanes.resize(commit_column + 1, None);
        }
        let commit_color = graph_lane_color(commit_column);
        if existing_commit_column.is_none() {
            active_lanes[commit_column] = Some(ActiveLane {
                hash: commit.hash.clone(),
            });
        }

        let (id, item_kind, hash, worktree_path) =
            if let Some(path) = commit.hash.strip_prefix("inferay-wip-current:") {
                (
                    "wip".to_string(),
                    GitGraphItemKind::WorktreeWip,
                    commit.parents.first().cloned().unwrap_or_default(),
                    Some(path.to_string()),
                )
            } else if let Some(path) = commit.hash.strip_prefix("inferay-wip-linked:") {
                (
                    format!("wip:{path}"),
                    GitGraphItemKind::WorktreeWip,
                    commit.parents.first().cloned().unwrap_or_default(),
                    Some(path.to_string()),
                )
            } else {
                (
                    commit.hash.clone(),
                    GitGraphItemKind::Commit,
                    commit.hash.clone(),
                    None,
                )
            };
        graph_commits.push(GraphCommit {
            id,
            item_kind,
            hash,
            message: commit.message.clone(),
            body: commit.body.clone(),
            author: commit.author.clone(),
            author_email: commit.author_email.clone(),
            committer: commit.committer.clone(),
            committer_email: commit.committer_email.clone(),
            date: commit.date.clone(),
            authored_at: commit.authored_at.clone(),
            committed_at: commit.committed_at.clone(),
            parents: commit.parents.clone(),
            refs: commit.refs.clone(),
            worktree_path,
            stash_name: None,
            column: commit_column,
            color_index: commit_color,
        });

        let mut next_lanes = active_lanes.clone();
        for column in &incoming_columns {
            next_lanes[*column] = None;
        }
        if incoming_columns.is_empty() {
            next_lanes[commit_column] = None;
        }
        let mut transitions = Vec::new();
        let mut convergences = incoming_columns
            .iter()
            .copied()
            .filter(|column| *column != commit_column)
            .filter_map(|column| {
                active_lanes[column].as_ref().map(|_| GraphTransition {
                    from_column: column,
                    to_column: commit_column,
                    color_index: graph_lane_color(column),
                })
            })
            .collect::<Vec<_>>();

        if let Some(first_parent) = commit.parents.first() {
            // First-parent continuity belongs to the child lane even when
            // another child already targets the same parent. The duplicate is
            // resolved only when that parent row is reached.
            next_lanes[commit_column] = Some(ActiveLane {
                hash: first_parent.clone(),
            });
        }

        for parent in commit.parents.iter().skip(1) {
            let parent_column = lane_allocator
                .reservation_column(parent)
                .expect("every additional parent receives a lane reservation");
            if next_lanes.len() <= parent_column {
                next_lanes.resize(parent_column + 1, None);
            }
            if next_lanes[parent_column].is_none() {
                next_lanes[parent_column] = Some(ActiveLane {
                    hash: parent.clone(),
                });
            }
            if parent_column != commit_column {
                transitions.push(GraphTransition {
                    from_column: commit_column,
                    to_column: parent_column,
                    color_index: graph_lane_color(parent_column),
                });
            }
        }

        while next_lanes.last().is_some_and(Option::is_none) {
            next_lanes.pop();
        }

        transitions.sort_by_key(|transition| (transition.from_column, transition.to_column));
        transitions.dedup_by(|a, b| {
            a.from_column == b.from_column
                && a.to_column == b.to_column
                && a.color_index == b.color_index
        });
        convergences.sort_by_key(|transition| (transition.from_column, transition.to_column));

        let incoming_set = incoming_columns.iter().copied().collect::<HashSet<_>>();
        let has_first_parent = !commit.parents.is_empty();
        let mut rails = active_lanes
            .iter()
            .enumerate()
            .filter_map(|(column, lane)| {
                lane.as_ref()?;
                if column == commit_column || incoming_set.contains(&column) {
                    return None;
                }
                Some(GraphRail {
                    column,
                    color_index: graph_lane_color(column),
                    starts_at_node: false,
                    ends_at_node: false,
                })
            })
            .collect::<Vec<_>>();
        if existing_commit_column.is_some() || has_first_parent {
            rails.push(GraphRail {
                column: commit_column,
                color_index: graph_lane_color(commit_column),
                starts_at_node: existing_commit_column.is_none(),
                ends_at_node: !has_first_parent,
            });
        }
        rails.sort_by_key(|rail| rail.column);

        graph_rows.push(GraphRow {
            row: row_index,
            rails,
            transitions,
            convergences,
            truncated_edges: Vec::new(),
        });

        active_lanes = next_lanes;
    }

    if let Some(last_row) = graph_rows.last_mut() {
        last_row.truncated_edges = active_lanes
            .iter()
            .enumerate()
            .filter_map(|(column, lane)| {
                lane.as_ref().map(|_| GraphRail {
                    column,
                    color_index: graph_lane_color(column),
                    starts_at_node: false,
                    ends_at_node: false,
                })
            })
            .collect();
    }

    (graph_commits, graph_rows)
}

pub fn execute_request(request: NativeRequest) -> NativeResponse {
    match request {
        NativeRequest::Diff { before, after } => NativeResponse::Diff {
            diff: compute_line_diff(&before, &after),
        },
        NativeRequest::GitStatuses { cwds } => NativeResponse::GitStatuses {
            projects: cwds.iter().filter_map(|cwd| get_git_status(cwd)).collect(),
        },
        NativeRequest::GitGraph { cwd, limit } => {
            let (commits, rows) = get_git_graph(&cwd, limit);
            NativeResponse::GitGraph { commits, rows }
        }
    }
}

pub fn handle_json_request(input: &str) -> Result<String, String> {
    let request =
        serde_json::from_str(input).map_err(|error| format!("invalid request: {error}"))?;
    let response = execute_request(request);

    serde_json::to_string(&response)
        .map_err(|error| format!("failed to serialize response: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use tempfile::TempDir;

    fn git(repository: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_at(repository: &Path, args: &[&str], date: &str) {
        let output = Command::new("git")
            .args(args)
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_at_clocks(repository: &Path, args: &[&str], author_date: &str, commit_date: &str) {
        let output = Command::new("git")
            .args(args)
            .env("GIT_AUTHOR_DATE", author_date)
            .env("GIT_COMMITTER_DATE", commit_date)
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn make_repository() -> TempDir {
        let root = TempDir::new().unwrap();
        git(root.path(), &["init", "-q"]);
        git(root.path(), &["config", "user.email", "test@example.com"]);
        git(root.path(), &["config", "user.name", "Test User"]);
        root
    }

    fn allowed(repository: &Path) -> AllowedPaths {
        AllowedPaths::new(repository, repository.canonicalize().unwrap()).unwrap()
    }

    fn graph_fixture_commit(hash: &str, parents: &[&str]) -> GitCommit {
        GitCommit {
            hash: hash.to_string(),
            message: hash.to_string(),
            body: String::new(),
            author: "Test User".to_string(),
            author_email: "test@example.com".to_string(),
            committer: "Test User".to_string(),
            committer_email: "test@example.com".to_string(),
            date: "now".to_string(),
            authored_at: "2026-01-01T00:00:00Z".to_string(),
            committed_at: "2026-01-01T00:00:00Z".to_string(),
            parents: parents.iter().map(|parent| (*parent).to_string()).collect(),
            refs: Vec::new(),
        }
    }

    #[test]
    fn commit_details_and_historical_diffs_use_repository_truth() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        let file = repository.path().join("history.txt");
        std::fs::write(&file, "one\ntwo\n").unwrap();
        git(repository.path(), &["add", "history.txt"]);
        git(
            repository.path(),
            &["commit", "-m", "initial subject", "-m", "initial body"],
        );
        let root_hash = run_git(&["rev-parse", "HEAD"], repository.path().to_str().unwrap())
            .unwrap()
            .trim()
            .to_string();

        let root_diff = get_git_commit_hunk_diff(
            repository.path().to_str().unwrap(),
            &root_hash,
            "history.txt",
            false,
        )
        .unwrap();
        assert!(root_diff.is_new);
        assert!(root_diff.new_lines.len() >= 2);

        std::fs::write(&file, "one\nchanged\nthree\n").unwrap();
        git(repository.path(), &["add", "history.txt"]);
        git(repository.path(), &["commit", "-m", "change history"]);
        let changed_hash = run_git(&["rev-parse", "HEAD"], repository.path().to_str().unwrap())
            .unwrap()
            .trim()
            .to_string();

        let details =
            get_git_commit_details(repository.path().to_str().unwrap(), &changed_hash).unwrap();
        assert_eq!(details.hash, changed_hash);
        assert_eq!(details.parents, vec![root_hash.clone()]);
        assert_eq!(details.author, "Test User");
        assert_eq!(details.author_email, "test@example.com");
        assert_eq!(details.files.len(), 1);
        assert_eq!(details.files[0].path, "history.txt");
        assert!(details.files[0].additions > 0);
        assert!(details.files[0].deletions > 0);

        let changed_diff = get_git_commit_hunk_diff(
            repository.path().to_str().unwrap(),
            &changed_hash,
            "history.txt",
            false,
        )
        .unwrap();
        assert!(changed_diff
            .old_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Remove));
        assert!(changed_diff
            .new_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Add));

        let comparison = get_git_comparison_details(cwd, &root_hash, &changed_hash).unwrap();
        assert_eq!(comparison.from_hash, root_hash);
        assert_eq!(comparison.to_hash, changed_hash);
        assert_eq!(comparison.files.len(), 1);
        assert_eq!(comparison.files[0].path, "history.txt");
        let comparison_diff = get_git_comparison_hunk_diff(
            cwd,
            &comparison.from_hash,
            &comparison.to_hash,
            "history.txt",
            false,
        )
        .unwrap();
        assert!(comparison_diff
            .old_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Remove));
        assert!(comparison_diff
            .new_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Add));

        std::fs::write(&file, "one\nworktree\n").unwrap();
        let untracked = repository.path().join("untracked.txt");
        std::fs::write(&untracked, "new worktree file\n").unwrap();
        let worktree_comparison =
            get_git_worktree_comparison_details(&allowed(repository.path()), cwd, &changed_hash)
                .unwrap();
        assert_eq!(worktree_comparison.from_hash, changed_hash);
        assert_eq!(worktree_comparison.to_hash, "WORKTREE");
        assert!(worktree_comparison
            .files
            .iter()
            .any(|entry| entry.path == "history.txt"));
        assert!(worktree_comparison
            .files
            .iter()
            .any(|entry| entry.path == "untracked.txt" && entry.status == "A"));
        let worktree_diff = get_git_worktree_comparison_hunk_diff(
            &allowed(repository.path()),
            cwd,
            &changed_hash,
            "history.txt",
            false,
        )
        .unwrap();
        assert!(worktree_diff
            .new_lines
            .iter()
            .any(|line| line.content == "worktree"));
        let untracked_diff = get_git_worktree_comparison_hunk_diff(
            &allowed(repository.path()),
            cwd,
            &changed_hash,
            "untracked.txt",
            false,
        )
        .unwrap();
        assert!(untracked_diff.is_new);
        assert!(untracked_diff
            .new_lines
            .iter()
            .any(|line| line.content == "new worktree file"));
        git(repository.path(), &["checkout", "--", "history.txt"]);
        std::fs::remove_file(untracked).unwrap();

        let graph = get_graph_log(repository.path().to_str().unwrap(), 10);
        assert!(graph.iter().all(|commit| commit.hash.len() >= 40));
        assert!(graph.iter().all(|commit| !commit.authored_at.is_empty()));
        assert!(graph.iter().all(|commit| !commit.committer.is_empty()));
        assert!(graph
            .iter()
            .all(|commit| !commit.committer_email.is_empty()));
        assert!(graph.iter().all(|commit| !commit.committed_at.is_empty()));
        assert!(graph.iter().any(|commit| commit.body == "initial body"));
        assert!(graph.iter().any(|commit| commit.refs.iter().any(|git_ref| {
            git_ref.kind == GitGraphRefKind::Head
                && git_ref.full_name.starts_with("refs/heads/")
                && git_ref.is_head
                && git_ref.target == changed_hash
                && git_ref.worktree_path.is_some()
        })));

        std::fs::write(&file, "stashed change\n").unwrap();
        std::fs::write(repository.path().join("stash-untracked.txt"), "new\n").unwrap();
        git(
            repository.path(),
            &["stash", "push", "--include-untracked", "-m", "test stash"],
        );
        let stashes = get_git_stashes(cwd);
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].name, "stash@{0}");
        assert!(stashes[0].message.contains("test stash"));
        let worktrees = get_git_worktrees(cwd);
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_current);
        let graph_with_stash = get_graph_log(cwd, 20);
        assert!(graph_with_stash
            .iter()
            .any(|commit| commit.refs.iter().any(|git_ref| {
                git_ref.kind == GitGraphRefKind::Stash && git_ref.full_name == "refs/stash"
            })));
        let stash_snapshot = get_git_graph_snapshot(cwd, 20);
        let stash_item = stash_snapshot
            .commits
            .iter()
            .find(|commit| commit.item_kind == GitGraphItemKind::Stash)
            .expect("stash should be a first-class graph item");
        assert_eq!(stash_item.id, "stash:stash@{0}");
        assert_eq!(stash_item.stash_name.as_deref(), Some("stash@{0}"));
        assert_eq!(stash_item.hash, stash_snapshot.stashes[0].hash);
        assert!(!stash_snapshot
            .commits
            .iter()
            .any(|commit| commit.message.starts_with("index on ")));
        assert!(!stash_snapshot
            .commits
            .iter()
            .any(|commit| commit.message.starts_with("untracked files on ")));
        assert_eq!(stash_item.parents.len(), 1);
    }

    #[test]
    fn merge_commit_details_and_diffs_follow_the_selected_parent() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);
        let main_branch = current_git_branch(cwd).unwrap();

        git(repository.path(), &["checkout", "-b", "feature"]);
        std::fs::write(repository.path().join("feature.txt"), "feature\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "feature"]);
        let feature_hash = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();

        git(repository.path(), &["checkout", &main_branch]);
        std::fs::write(repository.path().join("main.txt"), "main\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "main"]);
        let main_hash = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();
        git(
            repository.path(),
            &["merge", "--no-ff", "feature", "-m", "merge feature"],
        );
        let merge_hash = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();

        let default_details = get_git_commit_details(cwd, &merge_hash).unwrap();
        assert_eq!(
            default_details.parents,
            vec![main_hash.clone(), feature_hash.clone()]
        );
        assert_eq!(
            default_details.diff_parent.as_deref(),
            Some(main_hash.as_str())
        );
        assert_eq!(default_details.files.len(), 1);
        assert_eq!(default_details.files[0].path, "feature.txt");

        let feature_parent_details =
            get_git_commit_details_for_parent(cwd, &merge_hash, Some(&feature_hash)).unwrap();
        assert_eq!(
            feature_parent_details.diff_parent.as_deref(),
            Some(feature_hash.as_str())
        );
        assert_eq!(feature_parent_details.files.len(), 1);
        assert_eq!(feature_parent_details.files[0].path, "main.txt");

        let feature_diff = get_git_commit_hunk_diff_for_parent(
            cwd,
            &merge_hash,
            Some(&main_hash),
            "feature.txt",
            false,
        )
        .unwrap();
        assert!(feature_diff.is_new);
        assert!(feature_diff
            .new_lines
            .iter()
            .any(|line| line.content == "feature"));

        let main_diff = get_git_commit_hunk_diff_for_parent(
            cwd,
            &merge_hash,
            Some(&feature_hash),
            "main.txt",
            false,
        )
        .unwrap();
        assert!(main_diff.is_new);
        assert!(main_diff
            .new_lines
            .iter()
            .any(|line| line.content == "main"));
    }

    #[test]
    fn graph_refs_are_typed_for_tags_arbitrary_remotes_and_detached_head() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("tracked.txt"), "tracked\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "initial"]);
        let hash = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();
        let branch = current_git_branch(cwd).unwrap();
        git(repository.path(), &["tag", "-a", "v1.0", "-m", "release"]);

        let remote = TempDir::new().unwrap();
        git(remote.path(), &["init", "--bare", "-q"]);
        git(
            repository.path(),
            &["remote", "add", "team", remote.path().to_str().unwrap()],
        );
        git(
            repository.path(),
            &["push", "-u", "team", &format!("{branch}:{branch}")],
        );

        let graph = get_graph_log(cwd, 10);
        let refs = &graph
            .iter()
            .find(|commit| commit.hash == hash)
            .unwrap()
            .refs;
        assert!(refs.iter().any(|git_ref| {
            git_ref.kind == GitGraphRefKind::Tag
                && git_ref.full_name == "refs/tags/v1.0"
                && git_ref.target == hash
        }));
        assert!(refs.iter().any(|git_ref| {
            git_ref.kind == GitGraphRefKind::RemoteBranch
                && git_ref.remote_name.as_deref() == Some("team")
                && git_ref.full_name == format!("refs/remotes/team/{branch}")
        }));
        assert!(refs.iter().any(|git_ref| {
            git_ref.kind == GitGraphRefKind::Head
                && git_ref.upstream.as_deref() == Some(format!("team/{branch}").as_str())
        }));

        std::fs::write(repository.path().join("ahead.txt"), "ahead\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "local ahead"]);
        let ahead_graph = get_graph_log(cwd, 10);
        assert!(ahead_graph
            .iter()
            .flat_map(|commit| &commit.refs)
            .any(|git_ref| {
                git_ref.kind == GitGraphRefKind::Head
                    && git_ref.ahead == Some(1)
                    && git_ref.behind.is_none()
            }));

        git(repository.path(), &["checkout", "--detach", &hash]);
        let detached = get_graph_log(cwd, 10);
        let detached_refs = &detached
            .iter()
            .find(|commit| commit.hash == hash)
            .unwrap()
            .refs;
        assert!(detached_refs.iter().any(|git_ref| {
            git_ref.kind == GitGraphRefKind::Head && git_ref.full_name == "HEAD" && git_ref.is_head
        }));
    }

    #[test]
    fn graph_snapshot_distinguishes_empty_non_repository_and_truncated_history() {
        let non_repository = TempDir::new().unwrap();
        let missing = get_git_graph_snapshot(non_repository.path().to_str().unwrap(), 10);
        assert_eq!(missing.state, GitRepositorySnapshotState::NonRepository);
        assert!(missing.commits.is_empty());

        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        let unborn = get_git_graph_snapshot(cwd, 10);
        assert_eq!(unborn.state, GitRepositorySnapshotState::Unborn);
        assert!(unborn.commits.is_empty());

        for index in 0..3 {
            std::fs::write(
                repository.path().join("tracked.txt"),
                format!("revision {index}\n"),
            )
            .unwrap();
            git(repository.path(), &["add", "tracked.txt"]);
            git(
                repository.path(),
                &["commit", "-m", &format!("revision {index}")],
            );
        }
        git(repository.path(), &["branch", "review"]);
        git(repository.path(), &["tag", "v1"]);
        let snapshot = get_git_graph_snapshot(cwd, 2);
        assert_eq!(snapshot.state, GitRepositorySnapshotState::Ready);
        assert!(snapshot.has_more);
        assert_eq!(snapshot.commits.len(), 2);
        assert_eq!(snapshot.rows.len(), 2);
        assert_eq!(snapshot.rows.last().unwrap().truncated_edges.len(), 1);
        assert!(snapshot.commits[0]
            .refs
            .iter()
            .any(|git_ref| git_ref.kind == GitGraphRefKind::Tag));
        assert!(snapshot.commits[0]
            .refs
            .iter()
            .any(|git_ref| git_ref.kind == GitGraphRefKind::LocalBranch));
    }

    #[test]
    fn graph_snapshot_recovers_from_shallow_replace_and_corrupt_object_states() {
        let source = make_repository();
        let cwd = source.path().to_str().unwrap();
        for index in 0..3 {
            std::fs::write(
                source.path().join("tracked.txt"),
                format!("revision {index}\n"),
            )
            .unwrap();
            git(source.path(), &["add", "tracked.txt"]);
            git(
                source.path(),
                &["commit", "-m", &format!("revision {index}")],
            );
        }

        let shallow_root = TempDir::new().unwrap();
        let shallow = shallow_root.path().join("shallow");
        let source_url = format!("file://{}", source.path().display());
        git(
            source.path(),
            &[
                "clone",
                "--quiet",
                "--depth",
                "1",
                &source_url,
                shallow.to_str().unwrap(),
            ],
        );
        let shallow_snapshot = get_git_graph_snapshot(shallow.to_str().unwrap(), 10);
        assert_eq!(shallow_snapshot.state, GitRepositorySnapshotState::Ready);
        assert_eq!(shallow_snapshot.commits.len(), 1);

        let head = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();
        let parent = run_git(&["rev-parse", "HEAD~1"], cwd)
            .unwrap()
            .trim()
            .to_string();
        git(source.path(), &["replace", &head, &parent]);
        let replaced_snapshot = get_git_graph_snapshot(cwd, 10);
        assert_eq!(replaced_snapshot.state, GitRepositorySnapshotState::Ready);
        assert!(!replaced_snapshot.commits.is_empty());
        git(source.path(), &["replace", "-d", &head]);

        let object = source
            .path()
            .join(".git")
            .join("objects")
            .join(&head[..2])
            .join(&head[2..]);
        std::fs::remove_file(object).unwrap();
        let corrupt_snapshot = get_git_graph_snapshot(cwd, 10);
        assert_eq!(
            corrupt_snapshot.state,
            GitRepositorySnapshotState::CommandFailed
        );
        assert!(corrupt_snapshot.commits.is_empty());
        assert!(corrupt_snapshot
            .state_error
            .as_deref()
            .is_some_and(|error| error.starts_with("git log failed")));
    }

    #[test]
    fn checked_git_commands_classify_timeouts_and_redact_url_credentials() {
        let repository = make_repository();
        let failure = run_git_checked_timed(
            &["-c", "alias.inferay-wait=!sleep 1", "inferay-wait"],
            repository.path().to_str().unwrap(),
            Duration::from_millis(10),
        )
        .unwrap_err();
        assert_eq!(failure.kind, GitCommandFailureKind::TimedOut);
        assert!(failure.summary().contains("timed out"));
        assert_eq!(
            sanitized_git_error(b"fatal: https://user:secret@example.com/repository failed\nbody"),
            "fatal: https://***@example.com/repository failed"
        );
    }

    #[test]
    fn graph_snapshot_reads_each_linked_worktree_status() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("tracked.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);

        let linked_root = TempDir::new().unwrap();
        let linked_path = linked_root.path().join("feature-worktree");
        git(
            repository.path(),
            &[
                "worktree",
                "add",
                "-b",
                "feature-worktree",
                linked_path.to_str().unwrap(),
            ],
        );
        std::fs::write(linked_path.join("tracked.txt"), "linked change\n").unwrap();

        let snapshot = get_git_graph_snapshot(cwd, 20);
        assert_eq!(snapshot.worktrees.len(), 2);
        let linked = snapshot
            .worktrees
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some("feature-worktree"))
            .unwrap();
        assert!(!linked.is_current);
        assert_eq!(linked.status.as_ref().unwrap().files.len(), 1);
        assert_eq!(linked.status.as_ref().unwrap().files[0].path, "tracked.txt");
        assert!(snapshot.commits.iter().any(|commit| {
            commit
                .refs
                .iter()
                .any(|git_ref| git_ref.worktree_path.as_deref() == Some(linked.path.as_str()))
        }));
        let linked_wip = snapshot
            .commits
            .iter()
            .find(|commit| {
                commit.item_kind == GitGraphItemKind::WorktreeWip
                    && commit.worktree_path.as_deref() == Some(linked.path.as_str())
            })
            .expect("changed linked worktree should produce a WIP graph item");
        assert!(linked_wip.id.starts_with("wip:"));
        assert_eq!(linked_wip.hash, linked.head);
        assert_eq!(linked_wip.parents, vec![linked.head.clone()]);

        git(
            repository.path(),
            &[
                "worktree",
                "remove",
                "--force",
                linked_path.to_str().unwrap(),
            ],
        );
    }

    #[test]
    fn checkout_preflight_blocks_dirty_conflicted_and_linked_worktree_branches() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("tracked.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);
        let main = current_git_branch(cwd).unwrap();
        git(repository.path(), &["branch", "feature"]);

        std::fs::write(repository.path().join("tracked.txt"), "dirty\n").unwrap();
        let dirty = preflight_git_checkout(cwd, "feature");
        assert!(!dirty.can_checkout);
        assert_eq!(dirty.error_kind, Some(GitOperationErrorKind::DirtyWorktree));
        let dirty_checkout = checkout_git_branch(cwd, "feature");
        assert!(!dirty_checkout.ok);
        assert_eq!(
            dirty_checkout.error_kind,
            Some(GitOperationErrorKind::DirtyWorktree)
        );
        assert_eq!(current_git_branch(cwd).as_deref(), Some(main.as_str()));

        git(repository.path(), &["reset", "--hard", "HEAD"]);
        let clean = preflight_git_checkout(cwd, "feature");
        assert!(clean.can_checkout);
        assert!(checkout_git_branch(cwd, "feature").ok);
        assert_eq!(current_git_branch(cwd).as_deref(), Some("feature"));
        assert!(checkout_git_branch(cwd, "feature").ok);

        git(repository.path(), &["checkout", &main]);
        let linked_root = TempDir::new().unwrap();
        let linked_path = linked_root.path().join("feature-worktree");
        git(
            repository.path(),
            &["worktree", "add", linked_path.to_str().unwrap(), "feature"],
        );
        let linked = preflight_git_checkout(cwd, "feature");
        assert!(!linked.can_checkout);
        assert_eq!(
            linked.error_kind,
            Some(GitOperationErrorKind::WorktreeInUse)
        );
        assert_eq!(
            std::fs::canonicalize(linked.checked_out_worktree.as_deref().unwrap()).unwrap(),
            std::fs::canonicalize(&linked_path).unwrap()
        );

        let missing = preflight_git_checkout(cwd, "missing");
        assert!(!missing.can_checkout);
        assert_eq!(
            missing.error_kind,
            Some(GitOperationErrorKind::InvalidInput)
        );
        git(
            repository.path(),
            &[
                "worktree",
                "remove",
                "--force",
                linked_path.to_str().unwrap(),
            ],
        );
    }

    #[test]
    fn ref_operations_preserve_explicit_source_target_and_can_abort_conflicts() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("conflict.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "conflict.txt"]);
        git(repository.path(), &["commit", "-m", "base"]);
        let target = current_git_branch(cwd).unwrap();

        git(repository.path(), &["checkout", "-b", "feature"]);
        std::fs::write(repository.path().join("conflict.txt"), "feature\n").unwrap();
        git(repository.path(), &["add", "conflict.txt"]);
        git(repository.path(), &["commit", "-m", "feature change"]);
        git(repository.path(), &["checkout", &target]);
        std::fs::write(repository.path().join("conflict.txt"), "target\n").unwrap();
        git(repository.path(), &["add", "conflict.txt"]);
        git(repository.path(), &["commit", "-m", "target change"]);
        let revision_before = get_git_repository_revision(cwd);

        let result = perform_git_ref_operation(cwd, "merge", "feature", &target);
        assert!(!result.ok);
        assert_eq!(result.current_branch.as_deref(), Some(target.as_str()));
        assert_eq!(result.conflicts, vec!["conflict.txt"]);
        let operation = get_git_repository_operation_state(cwd);
        assert_eq!(operation.kind, GitRepositoryOperationKind::Merge);
        assert_eq!(operation.phase, GitRepositoryOperationPhase::Conflicted);
        assert_eq!(operation.conflicts, vec!["conflict.txt"]);
        assert_ne!(get_git_repository_revision(cwd), revision_before);

        let aborted = finish_git_ref_operation(cwd, "merge", "abort");
        assert!(aborted.ok, "{:?}", aborted.error);
        assert!(git_conflicts(cwd).is_empty());
        assert_eq!(current_git_branch(cwd).as_deref(), Some(target.as_str()));
        assert_eq!(
            get_git_repository_operation_state(cwd).kind,
            GitRepositoryOperationKind::Idle
        );
    }

    #[test]
    fn ref_operation_fast_forward_moves_only_the_explicit_target() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);
        let target = current_git_branch(cwd).unwrap();
        git(repository.path(), &["checkout", "-b", "feature"]);
        std::fs::write(repository.path().join("feature.txt"), "feature\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "feature"]);
        let feature_head = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        let preflight = preflight_git_ref_operation(cwd, "feature", &target);
        assert!(preflight.valid_refs);
        assert!(preflight.can_merge);
        assert!(preflight.can_rebase);
        assert!(preflight.can_fast_forward);

        let result = perform_git_ref_operation(cwd, "fastForward", "feature", &target);
        assert!(result.ok, "{:?}", result.error);
        assert_eq!(result.head.as_deref(), Some(feature_head.trim()));
        assert_eq!(current_git_branch(cwd).as_deref(), Some(target.as_str()));
        assert_eq!(
            run_git(&["rev-parse", &target], cwd).unwrap().trim(),
            feature_head.trim()
        );

        std::fs::write(repository.path().join("base.txt"), "dirty\n").unwrap();
        let dirty = preflight_git_ref_operation(cwd, &target, "feature");
        assert!(!dirty.clean_worktree);
        assert!(!dirty.can_merge);
        assert!(!dirty.can_rebase);
    }

    #[test]
    fn interactive_rebase_reorders_rewords_squashes_and_drops_commits() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);
        let target = current_git_branch(cwd).unwrap();

        git(repository.path(), &["checkout", "-b", "feature"]);
        let mut commits = Vec::new();
        for name in ["a", "b", "c", "d"] {
            std::fs::write(repository.path().join(format!("{name}.txt")), name).unwrap();
            git(repository.path(), &["add", "."]);
            git(
                repository.path(),
                &["commit", "-m", &format!("feature {name}")],
            );
            commits.push(
                run_git(&["rev-parse", "HEAD"], cwd)
                    .unwrap()
                    .trim()
                    .to_string(),
            );
        }
        let original_target = run_git(&["rev-parse", &target], cwd).unwrap();
        git(repository.path(), &["checkout", &target]);
        std::fs::write(repository.path().join("target.txt"), "target\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "target advance"]);
        let advanced_target = run_git(&["rev-parse", &target], cwd).unwrap();
        assert_ne!(original_target.trim(), advanced_target.trim());

        let preflight = preflight_git_ref_operation(cwd, "feature", &target);
        assert!(preflight.can_interactive_rebase, "{:?}", preflight.reasons);
        assert_eq!(
            preflight
                .interactive_rebase_commits
                .iter()
                .map(|commit| commit.hash.as_str())
                .collect::<Vec<_>>(),
            commits.iter().map(String::as_str).collect::<Vec<_>>()
        );

        let plan = vec![
            GitInteractiveRebaseStep {
                hash: commits[1].clone(),
                action: "pick".to_string(),
                message: None,
            },
            GitInteractiveRebaseStep {
                hash: commits[0].clone(),
                action: "reword".to_string(),
                message: Some("renamed feature a".to_string()),
            },
            GitInteractiveRebaseStep {
                hash: commits[3].clone(),
                action: "squash".to_string(),
                message: None,
            },
            GitInteractiveRebaseStep {
                hash: commits[2].clone(),
                action: "drop".to_string(),
                message: None,
            },
        ];
        let result = perform_git_interactive_rebase(cwd, "feature", &target, &plan);
        assert!(result.ok, "{:?}", result.error);
        assert_eq!(current_git_branch(cwd).as_deref(), Some("feature"));
        let range = format!("{target}..feature");
        let messages = run_git(&["log", "--reverse", "--format=%s", &range], cwd).unwrap();
        assert_eq!(
            messages.lines().collect::<Vec<_>>(),
            vec!["feature b", "renamed feature a"]
        );
        assert!(repository.path().join("a.txt").exists());
        assert!(repository.path().join("b.txt").exists());
        assert!(!repository.path().join("c.txt").exists());
        assert!(repository.path().join("d.txt").exists());
        assert_eq!(
            run_git(&["rev-parse", &target], cwd).unwrap(),
            advanced_target
        );
        assert!(!interactive_rebase_state_dir(cwd).unwrap().exists());
    }

    #[test]
    fn graph_actions_validate_and_apply_commit_ref_and_stash_operations() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);
        let main = current_git_branch(cwd).unwrap();
        let base_hash = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();

        git(repository.path(), &["checkout", "-b", "feature"]);
        std::fs::write(repository.path().join("feature.txt"), "feature\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "feature"]);
        let feature_hash = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();
        std::fs::write(repository.path().join("feature-2.txt"), "feature 2\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "feature two"]);
        let feature_two_hash = run_git(&["rev-parse", "HEAD"], cwd)
            .unwrap()
            .trim()
            .to_string();
        git(repository.path(), &["checkout", &main]);

        let branch = perform_git_graph_action(
            cwd,
            "createBranch",
            Some(&feature_hash),
            Some("review/feature"),
            None,
        );
        assert!(branch.ok, "{:?}", branch.error);
        assert!(get_git_branches(cwd)
            .iter()
            .any(|candidate| candidate.name == "review/feature"));
        let rename = perform_git_graph_action(
            cwd,
            "renameBranch",
            Some("review/feature"),
            Some("review/renamed"),
            None,
        );
        assert!(rename.ok, "{:?}", rename.error);

        let tag = perform_git_graph_action(
            cwd,
            "createTag",
            Some(&feature_hash),
            Some("review-v1"),
            Some("review release"),
        );
        assert!(tag.ok, "{:?}", tag.error);
        assert_eq!(
            run_git(&["rev-list", "-n", "1", "review-v1"], cwd)
                .unwrap()
                .trim(),
            feature_hash
        );
        let delete_tag = perform_git_graph_action(cwd, "deleteTag", Some("review-v1"), None, None);
        assert!(delete_tag.ok, "{:?}", delete_tag.error);

        let cherry_pick = perform_git_graph_action_with_targets(
            cwd,
            "cherryPick",
            Some(&feature_hash),
            &[feature_hash.clone(), feature_two_hash],
            None,
            None,
        );
        assert!(cherry_pick.ok, "{:?}", cherry_pick.error);
        assert_eq!(
            cherry_pick.head.as_deref(),
            run_git(&["rev-parse", "HEAD"], cwd)
                .as_deref()
                .map(str::trim)
        );
        assert!(repository.path().join("feature.txt").exists());
        assert!(repository.path().join("feature-2.txt").exists());
        assert_eq!(
            run_git(&["log", "-2", "--format=%s"], cwd)
                .unwrap()
                .lines()
                .collect::<Vec<_>>(),
            vec!["feature two", "feature"]
        );

        std::fs::write(repository.path().join("feature.txt"), "stashed\n").unwrap();
        let stash =
            perform_git_graph_action(cwd, "stashPush", None, None, Some("graph action stash"));
        assert!(stash.ok, "{:?}", stash.error);
        let stash_name = get_git_stashes(cwd)[0].name.clone();
        let rename_stash = perform_git_graph_action(
            cwd,
            "stashRename",
            Some(&stash_name),
            Some("renamed graph stash"),
            None,
        );
        assert!(rename_stash.ok, "{:?}", rename_stash.error);
        let stash_name = get_git_stashes(cwd)[0].name.clone();
        assert!(get_git_stashes(cwd)[0]
            .message
            .contains("renamed graph stash"));
        let apply = perform_git_graph_action(cwd, "stashApply", Some(&stash_name), None, None);
        assert!(apply.ok, "{:?}", apply.error);
        git(repository.path(), &["reset", "--hard", "HEAD"]);
        let drop = perform_git_graph_action(cwd, "stashDrop", Some(&stash_name), None, None);
        assert!(drop.ok, "{:?}", drop.error);
        assert!(get_git_stashes(cwd).is_empty());

        let soft_reset = perform_git_graph_action(cwd, "resetSoft", Some(&base_hash), None, None);
        assert!(soft_reset.ok, "{:?}", soft_reset.error);
        assert_eq!(
            run_git(&["rev-parse", "HEAD"], cwd).unwrap().trim(),
            base_hash
        );
        let hard_reset =
            perform_git_graph_action(cwd, "resetHard", Some(&feature_hash), None, None);
        assert!(hard_reset.ok, "{:?}", hard_reset.error);
        let delete_branch =
            perform_git_graph_action(cwd, "deleteBranch", Some("review/renamed"), None, None);
        assert!(delete_branch.ok, "{:?}", delete_branch.error);

        let invalid = perform_git_graph_action(
            cwd,
            "createBranch",
            Some(&feature_hash),
            Some("invalid branch"),
            None,
        );
        assert!(!invalid.ok);
        assert_eq!(invalid.outcome, GitOperationOutcome::Failed);
        assert_eq!(
            invalid.error_kind,
            Some(GitOperationErrorKind::InvalidInput)
        );
    }

    #[test]
    fn classifies_git_operation_failures_for_actionable_presentation() {
        assert_eq!(
            classify_git_operation_error("Authentication failed", &[]),
            GitOperationErrorKind::Authentication
        );
        assert_eq!(
            classify_git_operation_error("rejected (non-fast-forward)", &[]),
            GitOperationErrorKind::NonFastForward
        );
        assert_eq!(
            classify_git_operation_error("Could not resolve host: example.test", &[]),
            GitOperationErrorKind::Network
        );
        assert_eq!(
            classify_git_operation_error("local changes would be overwritten", &[]),
            GitOperationErrorKind::DirtyWorktree
        );
        assert_eq!(
            classify_git_operation_error("automatic merge failed", &["src/app.ts".to_string()]),
            GitOperationErrorKind::Conflict
        );
    }

    #[test]
    fn derives_github_commit_links_from_common_remote_and_merge_formats() {
        assert_eq!(
            github_repository_from_remote("git@github.com:inferay/app.git"),
            Some((
                "inferay/app".to_string(),
                "https://github.com/inferay/app".to_string()
            ))
        );
        assert_eq!(
            github_repository_from_remote("https://github.com/inferay/app.git"),
            Some((
                "inferay/app".to_string(),
                "https://github.com/inferay/app".to_string()
            ))
        );
        assert_eq!(
            github_pull_request_number("Merge pull request #1597 from feature/auth"),
            Some(1597)
        );
        assert_eq!(
            github_pull_request_number("Ship graph polish (#412)"),
            Some(412)
        );
    }

    #[test]
    fn graph_remote_actions_require_explicit_remote_and_use_force_with_lease() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);
        let branch = current_git_branch(cwd).unwrap();
        let remote = TempDir::new().unwrap();
        git(remote.path(), &["init", "--bare", "-q"]);
        git(
            remote.path(),
            &["config", "receive.denyDeleteCurrent", "ignore"],
        );
        git(
            repository.path(),
            &["remote", "add", "team", remote.path().to_str().unwrap()],
        );

        let initial_push =
            perform_git_graph_action(cwd, "pushSetUpstream", Some(&branch), Some("team"), None);
        assert!(initial_push.ok, "{:?}", initial_push.error);
        let expected_upstream = format!("team/{branch}");
        assert_eq!(
            get_git_status(cwd).unwrap().upstream.as_deref(),
            Some(expected_upstream.as_str())
        );

        std::fs::write(repository.path().join("next.txt"), "next\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "next"]);
        let force = perform_git_graph_action(cwd, "forcePushWithLease", Some(&branch), None, None);
        assert!(force.ok, "{:?}", force.error);

        git(repository.path(), &["tag", "v-remote"]);
        let push_tag =
            perform_git_graph_action(cwd, "pushTag", Some("v-remote"), Some("team"), None);
        assert!(push_tag.ok, "{:?}", push_tag.error);
        let delete_tag =
            perform_git_graph_action(cwd, "deleteRemoteTag", Some("v-remote"), Some("team"), None);
        assert!(delete_tag.ok, "{:?}", delete_tag.error);

        let remote_ref = format!("refs/remotes/team/{branch}");
        let delete_branch =
            perform_git_graph_action(cwd, "deleteRemoteBranch", Some(&remote_ref), None, None);
        assert!(delete_branch.ok, "{:?}", delete_branch.error);
    }

    #[test]
    fn graph_fetch_pull_push_refresh_revision_and_ahead_behind_state() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();
        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "base"]);
        let branch = current_git_branch(cwd).unwrap();

        let remote = TempDir::new().unwrap();
        git(remote.path(), &["init", "--bare", "-q"]);
        git(
            repository.path(),
            &["remote", "add", "team", remote.path().to_str().unwrap()],
        );
        let initial_push =
            perform_git_graph_action(cwd, "pushSetUpstream", Some(&branch), Some("team"), None);
        assert!(initial_push.ok, "{:?}", initial_push.error);

        let collaborator_root = TempDir::new().unwrap();
        let collaborator = collaborator_root.path().join("collaborator");
        git(
            collaborator_root.path(),
            &[
                "clone",
                "--quiet",
                remote.path().to_str().unwrap(),
                collaborator.to_str().unwrap(),
            ],
        );
        git(
            &collaborator,
            &["config", "user.email", "collaborator@example.com"],
        );
        git(&collaborator, &["config", "user.name", "Collaborator"]);
        std::fs::write(collaborator.join("remote.txt"), "remote change\n").unwrap();
        git(&collaborator, &["add", "."]);
        git(&collaborator, &["commit", "-m", "remote change"]);
        git(&collaborator, &["push"]);
        let remote_head = run_git(&["rev-parse", "HEAD"], collaborator.to_str().unwrap())
            .unwrap()
            .trim()
            .to_string();

        let before_fetch = get_git_repository_revision(cwd);
        let fetch = perform_git_graph_action(cwd, "fetch", None, None, None);
        assert!(fetch.ok, "{:?}", fetch.error);
        assert_ne!(get_git_repository_revision(cwd), before_fetch);
        let fetched_status = get_git_status(cwd).unwrap();
        assert_eq!(fetched_status.ahead, 0);
        assert_eq!(fetched_status.behind, 1);
        let remote_ref_name = format!("refs/remotes/team/{branch}");
        let fetched_snapshot = get_git_graph_snapshot(cwd, 20);
        assert!(fetched_snapshot.commits.iter().any(|commit| {
            commit.hash == remote_head
                && commit
                    .refs
                    .iter()
                    .any(|git_ref| git_ref.full_name == remote_ref_name)
        }));

        let pull = perform_git_graph_action(cwd, "pull", None, None, None);
        assert!(pull.ok, "{:?}", pull.error);
        assert_eq!(current_git_head(cwd).as_deref(), Some(remote_head.as_str()));
        let pulled_status = get_git_status(cwd).unwrap();
        assert_eq!((pulled_status.ahead, pulled_status.behind), (0, 0));

        std::fs::write(repository.path().join("local.txt"), "local change\n").unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "local change"]);
        assert_eq!(get_git_status(cwd).unwrap().ahead, 1);
        let local_head = current_git_head(cwd).unwrap();
        let push = perform_git_graph_action(cwd, "push", None, None, None);
        assert!(push.ok, "{:?}", push.error);
        assert_eq!(get_git_status(cwd).unwrap().ahead, 0);
        assert_eq!(
            run_git(
                &["rev-parse", &format!("refs/heads/{branch}")],
                remote.path().to_str().unwrap(),
            )
            .unwrap()
            .trim(),
            local_head
        );
    }

    #[test]
    fn derives_exact_changed_ranges_from_a_context_patch() {
        let patch = [
            "diff --git a/app.css b/app.css",
            "--- a/app.css",
            "+++ b/app.css",
            "@@ -10,5 +10,6 @@",
            " .before {}",
            "-.old {}",
            "+.new {}",
            "+.extra {}",
            " .after {}",
        ]
        .join("\n");
        let (removed, added) = parse_changed_ranges(&patch);

        assert_eq!(removed.len(), 1);
        assert_eq!((removed[0].start, removed[0].end), (11, 11));
        assert_eq!(added.len(), 1);
        assert_eq!((added[0].start, added[0].end), (11, 12));
    }

    #[test]
    fn compact_review_diff_keeps_changes_and_bounds_context() {
        let mut old_lines = Vec::new();
        let mut new_lines = Vec::new();
        for number in 1..=24 {
            let changed = number == 12;
            old_lines.push(GitDiffLine {
                number: Some(number),
                content: if changed {
                    "old value".to_string()
                } else {
                    format!("line {number}")
                },
                line_type: if changed {
                    GitDiffLineType::Remove
                } else {
                    GitDiffLineType::Context
                },
            });
            new_lines.push(GitDiffLine {
                number: Some(number),
                content: if changed {
                    "new value".to_string()
                } else {
                    format!("line {number}")
                },
                line_type: if changed {
                    GitDiffLineType::Add
                } else {
                    GitDiffLineType::Context
                },
            });
        }
        let compact = compact_git_hunk_diff(GitHunkDiff {
            old_lines,
            new_lines,
            compact_lines: None,
            is_binary: false,
            is_new: false,
            is_image: None,
            image_path: None,
            raw_patch: Some("large patch that the review response does not need".to_string()),
            merge_conflict_content: None,
        });

        assert!(compact.old_lines.len() < 12);
        assert_eq!(compact.old_lines.len(), compact.new_lines.len());
        assert!(compact
            .old_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Remove));
        assert!(compact
            .new_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Add));
        assert!(compact.raw_patch.is_none());
        let lines = compact.compact_lines.unwrap();
        assert!(lines.len() < 16);
        assert_eq!(lines.first().unwrap().line_type, GitDiffLineType::Hunk);
        let removed = lines
            .iter()
            .position(|line| line.line_type == GitDiffLineType::Remove)
            .unwrap();
        let added = lines
            .iter()
            .position(|line| line.line_type == GitDiffLineType::Add)
            .unwrap();
        assert_eq!(added, removed + 1);
        assert_eq!(lines.last().unwrap().line_type, GitDiffLineType::Hunk);
    }

    #[test]
    fn full_diff_ignores_repository_external_diff_drivers() {
        let repository = make_repository();
        std::fs::write(
            repository.path().join(".gitattributes"),
            "*.css diff=slow\n",
        )
        .unwrap();
        std::fs::write(repository.path().join("app.css"), ".old { color: red; }\n").unwrap();
        git(repository.path(), &["config", "diff.slow.command", "false"]);
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "initial"]);
        std::fs::write(repository.path().join("app.css"), ".new { color: blue; }\n").unwrap();
        let cwd = repository.path().to_string_lossy();

        let diff = get_git_hunk_diff(&allowed(repository.path()), &cwd, "app.css", false);

        assert!(diff
            .new_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Add));
        assert!(diff.raw_patch.unwrap().contains("+.new { color: blue; }"));
    }

    #[test]
    fn preserves_diff_wire_contract() {
        let response = handle_json_request(
            &json!({
                "op": "diff",
                "before": "alpha\nbeta",
                "after": "alpha\ngamma"
            })
            .to_string(),
        )
        .expect("diff request should succeed");

        let value: Value = serde_json::from_str(&response).expect("response should be JSON");
        assert_eq!(value["op"], "diff");
        assert_eq!(
            value["diff"]["stats"],
            json!({
                "added": 1,
                "removed": 1,
                "unchanged": 1
            })
        );
        assert_eq!(value["diff"]["computedAt"], 0);
        assert_eq!(value["diff"]["oldLines"][1]["type"], "removed");
        assert_eq!(value["diff"]["oldLines"][1]["content"], "beta");
        assert_eq!(value["diff"]["newLines"][1]["type"], "removed");
        assert_eq!(value["diff"]["newLines"][1]["content"], "");
        assert_eq!(value["diff"]["newLines"][2]["type"], "added");
        assert_eq!(value["diff"]["newLines"][2]["content"], "gamma");
    }

    #[test]
    fn rejects_unknown_operations_with_the_existing_error_prefix() {
        let error =
            handle_json_request(r#"{"op":"unknown"}"#).expect_err("unknown operation should fail");
        assert!(error.starts_with("invalid request:"));
    }

    #[test]
    fn skips_directories_that_are_not_git_repositories() {
        let directory = TempDir::new().unwrap();
        let cwd = directory.path().to_string_lossy().into_owned();
        let response = execute_request(NativeRequest::GitStatuses {
            cwds: vec![cwd.clone()],
        });

        match response {
            NativeResponse::GitStatuses { projects } => assert!(projects.is_empty()),
            _ => panic!("expected git statuses response"),
        }
        assert_eq!(
            get_git_graph_snapshot(&cwd, 10).state,
            GitRepositorySnapshotState::NonRepository
        );

        let repository = make_repository();
        assert_eq!(
            get_git_graph_snapshot(repository.path().to_str().unwrap(), 10).state,
            GitRepositorySnapshotState::Unborn
        );
    }

    #[test]
    fn graph_uses_committer_time_for_row_order_and_display_date() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();

        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git_at(
            repository.path(),
            &["commit", "-m", "base"],
            "2026-08-27T08:00:00-05:00",
        );
        git(repository.path(), &["branch", "-M", "main"]);
        let base = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        git(repository.path(), &["checkout", "-q", "-b", "slow-author"]);
        std::fs::write(repository.path().join("slow.txt"), "slow\n").unwrap();
        git(repository.path(), &["add", "."]);
        git_at_clocks(
            repository.path(),
            &["commit", "-m", "committed later"],
            "2026-08-27T08:22:00-05:00",
            "2026-08-27T08:36:00-05:00",
        );
        let committed_later = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        git(repository.path(), &["checkout", "-q", "main"]);
        std::fs::write(repository.path().join("main.txt"), "main\n").unwrap();
        git(repository.path(), &["add", "."]);
        git_at_clocks(
            repository.path(),
            &["commit", "-m", "authored later"],
            "2026-08-27T08:34:00-05:00",
            "2026-08-27T08:34:00-05:00",
        );
        let authored_later = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        let commits = get_graph_log_result(cwd, 10).unwrap();
        assert_eq!(commits[0].hash, committed_later.trim());
        assert_eq!(commits[1].hash, authored_later.trim());
        assert_eq!(commits[2].hash, base.trim());
        assert_eq!(commits[0].authored_at, "2026-08-27T08:22:00-05:00");
        assert_eq!(commits[0].committed_at, "2026-08-27T08:36:00-05:00");
        assert_eq!(
            commits[0].date,
            run_git(&["show", "-s", "--format=%cr", committed_later.trim()], cwd)
                .unwrap()
                .trim()
        );
    }

    #[test]
    fn graph_keeps_old_merged_branch_commits_on_their_chronological_rows() {
        let repository = make_repository();
        let cwd = repository.path().to_str().unwrap();

        std::fs::write(repository.path().join("base.txt"), "base\n").unwrap();
        git(repository.path(), &["add", "."]);
        git_at(
            repository.path(),
            &["commit", "-m", "base"],
            "2026-08-24T09:00:00-05:00",
        );
        git(repository.path(), &["branch", "-M", "develop"]);
        let base = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        git(repository.path(), &["checkout", "-q", "-b", "feature"]);
        std::fs::write(repository.path().join("feature.txt"), "feature\n").unwrap();
        git(repository.path(), &["add", "."]);
        git_at(
            repository.path(),
            &["commit", "-m", "old feature work"],
            "2026-08-25T11:14:00-05:00",
        );
        let feature = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        git(repository.path(), &["checkout", "-q", "develop"]);
        std::fs::write(repository.path().join("develop.txt"), "develop\n").unwrap();
        git(repository.path(), &["add", "."]);
        git_at(
            repository.path(),
            &["commit", "-m", "develop work"],
            "2026-08-28T09:00:00-05:00",
        );
        let develop = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        git(
            repository.path(),
            &["checkout", "-q", "-b", "newer-independent-tip", base.trim()],
        );
        std::fs::write(repository.path().join("independent.txt"), "newer\n").unwrap();
        git(repository.path(), &["add", "."]);
        git_at(
            repository.path(),
            &["commit", "-m", "newer independent work"],
            "2026-08-31T12:00:00-05:00",
        );
        let independent = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        git(repository.path(), &["checkout", "-q", "develop"]);
        git_at(
            repository.path(),
            &["merge", "--no-ff", "feature", "-m", "merge old feature"],
            "2026-08-31T13:00:00-05:00",
        );
        let merge = run_git(&["rev-parse", "HEAD"], cwd).unwrap();

        let commits = get_graph_log_result(cwd, 20).unwrap();
        let position = |hash: &str| {
            commits
                .iter()
                .position(|commit| commit.hash == hash.trim())
                .unwrap()
        };
        let merge_row = position(&merge);
        let independent_row = position(&independent);
        let develop_row = position(&develop);
        let feature_row = position(&feature);

        assert_eq!(merge_row, 0);
        assert!(independent_row < develop_row);
        assert!(develop_row < feature_row);

        let (graph_commits, rows) = layout_graph(&commits);
        let feature_column = graph_commits[feature_row].column;
        assert_eq!(
            graph_commits
                .iter()
                .filter(|commit| commit.hash == merge.trim())
                .count(),
            1
        );
        assert!(rows[merge_row]
            .transitions
            .iter()
            .any(|transition| transition.to_column == feature_column));
        for row in &rows[merge_row + 1..feature_row] {
            assert!(
                row.rails.iter().any(|rail| rail.column == feature_column),
                "the merged feature lane must remain vertical through row {}",
                row.row
            );
        }
    }

    #[test]
    fn graph_layout_is_deterministic_for_a_branch_and_merge() {
        let commits = vec![
            GitCommit {
                hash: "merge".into(),
                message: "merge branch".into(),
                body: String::new(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                committer: "Ray".into(),
                committer_email: "ray@example.com".into(),
                date: "now".into(),
                authored_at: "2026-01-01T00:00:00Z".into(),
                committed_at: "2026-01-01T00:00:00Z".into(),
                parents: vec!["main".into(), "branch".into()],
                refs: vec![],
            },
            GitCommit {
                hash: "branch".into(),
                message: "branch work".into(),
                body: String::new(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                committer: "Ray".into(),
                committer_email: "ray@example.com".into(),
                date: "earlier".into(),
                authored_at: "2026-01-01T00:00:00Z".into(),
                committed_at: "2026-01-01T00:00:00Z".into(),
                parents: vec!["base".into()],
                refs: vec![],
            },
            GitCommit {
                hash: "main".into(),
                message: "main work".into(),
                body: String::new(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                committer: "Ray".into(),
                committer_email: "ray@example.com".into(),
                date: "earlier".into(),
                authored_at: "2026-01-01T00:00:00Z".into(),
                committed_at: "2026-01-01T00:00:00Z".into(),
                parents: vec!["base".into()],
                refs: vec![],
            },
            GitCommit {
                hash: "base".into(),
                message: "base".into(),
                body: String::new(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                committer: "Ray".into(),
                committer_email: "ray@example.com".into(),
                date: "old".into(),
                authored_at: "2026-01-01T00:00:00Z".into(),
                committed_at: "2026-01-01T00:00:00Z".into(),
                parents: vec![],
                refs: vec![],
            },
        ];

        let (graph_commits, rows) = layout_graph(&commits);
        assert_eq!(graph_commits.len(), commits.len());
        assert_eq!(rows.len(), commits.len());
        assert_eq!(graph_commits[0].column, 0);
        assert_eq!(graph_commits[1].column, 1);
        assert_eq!(graph_commits[2].column, 0);
        assert!(rows[0]
            .transitions
            .iter()
            .any(|transition| transition.from_column == 0 && transition.to_column == 1));
    }

    #[test]
    fn aivre_core_reference_keeps_duplicate_first_parent_edges_until_convergence() {
        // The first eleven rows from the saved AIVRE-Core GitKraken capture.
        // Both 8f6b3e and 8b26a1 target 8f3bc0. GitKraken keeps those as two
        // distinct rails, which leaves lane 2 available for the merge's second
        // parent and puts the next independent tips in lanes 3 and 4.
        let commits = vec![
            graph_fixture_commit("8f6b3e", &["8f3bc0"]),
            graph_fixture_commit("8b26a1", &["8f3bc0", "3d9de8"]),
            graph_fixture_commit("319a47", &["762020"]),
            graph_fixture_commit("06e4dd", &["cc9cd5", "8f3bc0"]),
            graph_fixture_commit("8f3bc0", &["47e238", "49c246"]),
            graph_fixture_commit("762020", &["74a3dc"]),
            graph_fixture_commit("49c246", &["5ea8bc"]),
            graph_fixture_commit("5ea8bc", &["5ee35b"]),
            graph_fixture_commit("74a3dc", &["47e238"]),
            graph_fixture_commit("5ee35b", &["4500c5"]),
            graph_fixture_commit("4500c5", &["47e238"]),
        ];

        let (graph, rows) = layout_graph(&commits);
        assert_eq!(
            graph.iter().map(|commit| commit.column).collect::<Vec<_>>(),
            vec![0, 1, 3, 4, 0, 3, 1, 1, 3, 1, 1]
        );
        assert!(graph
            .iter()
            .all(|commit| commit.color_index == graph_lane_color(commit.column)));
        assert!(rows.iter().all(|row| row
            .rails
            .iter()
            .all(|rail| rail.color_index == graph_lane_color(rail.column))));
        assert!(rows.iter().all(|row| row
            .transitions
            .iter()
            .all(|edge| { edge.color_index == graph_lane_color(edge.to_column) })));
        assert!(rows.iter().all(|row| row
            .convergences
            .iter()
            .all(|edge| { edge.color_index == graph_lane_color(edge.from_column) })));
        assert!(rows[4]
            .convergences
            .iter()
            .any(|edge| { edge.from_column == 1 && edge.to_column == 0 && edge.color_index == 1 }));
        assert!(rows[2].rails.iter().any(|rail| rail.column == 2));
        assert!(rows[2]
            .rails
            .iter()
            .find(|rail| rail.column == 3)
            .is_some_and(|rail| rail.starts_at_node));
    }

    #[test]
    fn aivre_core_long_history_matches_measured_gitkraken_columns() {
        let commits = include_str!("../tests/fixtures/aivre-core-rows.tsv")
            .lines()
            .skip(1)
            .map(|line| {
                let (hash, parents) = line.split_once('\t').unwrap_or((line, ""));
                let parents = parents
                    .split(',')
                    .filter(|parent| !parent.is_empty())
                    .collect::<Vec<_>>();
                graph_fixture_commit(hash, &parents)
            })
            .collect::<Vec<_>>();
        let (graph, _) = layout_graph(&commits);

        let expected = [
            (0, "8f6b3e", 0),
            (1, "8b26a1", 1),
            (2, "319a47", 3),
            (3, "06e4dd", 4),
            (4, "8f3bc0", 0),
            (5, "762020", 3),
            (6, "49c246", 1),
            (7, "5ea8bc", 1),
            (8, "74a3dc", 3),
            (9, "5ee35b", 1),
            (10, "4500c5", 1),
            (34, "73946e", 4),
            (51, "ffe16d", 0),
            (57, "128425", 0),
            (75, "7f3b05", 10),
            (80, "64617d", 1),
            (126, "967906", 3),
        ];
        for (row, hash_prefix, column) in expected {
            assert!(graph[row].hash.starts_with(hash_prefix));
            assert_eq!(
                graph[row].column, column,
                "AIVRE-Core row {row} ({hash_prefix}) diverged from GitKraken"
            );
        }
    }

    #[test]
    fn graph_layout_handles_octopus_unrelated_roots_and_truncated_history() {
        let commit = |hash: &str, parents: &[&str]| GitCommit {
            hash: hash.to_string(),
            message: hash.to_string(),
            body: String::new(),
            author: "Test User".to_string(),
            author_email: "test@example.com".to_string(),
            committer: "Test User".to_string(),
            committer_email: "test@example.com".to_string(),
            date: "now".to_string(),
            authored_at: "2026-01-01T00:00:00Z".to_string(),
            committed_at: "2026-01-01T00:00:00Z".to_string(),
            parents: parents.iter().map(|parent| (*parent).to_string()).collect(),
            refs: Vec::new(),
        };
        let commits = vec![
            commit("octopus", &["main", "feature-a", "feature-b"]),
            commit("feature-b", &["base"]),
            commit("feature-a", &["base"]),
            commit("main", &["base"]),
            commit("base", &[]),
            commit("unrelated", &[]),
        ];
        let first = layout_graph(&commits);
        let second = layout_graph(&commits);
        assert_eq!(first, second);
        assert_eq!(first.0[0].column, 0);
        assert!(first.1[0]
            .transitions
            .iter()
            .any(|transition| transition.to_column == 1));
        assert!(first.1[0]
            .transitions
            .iter()
            .any(|transition| transition.to_column == 2));
        assert!(first.1.last().unwrap().truncated_edges.is_empty());

        let (_, truncated_rows) = layout_graph(&[
            commit("tip", &["middle"]),
            commit("middle", &["outside-page"]),
        ]);
        assert_eq!(truncated_rows.last().unwrap().truncated_edges.len(), 1);
        assert_eq!(truncated_rows.last().unwrap().truncated_edges[0].column, 0);
    }

    #[test]
    fn graph_layout_is_byte_stable_for_nested_and_criss_cross_merges() {
        let commit = |hash: &str, parents: &[&str]| GitCommit {
            hash: hash.to_string(),
            message: hash.to_string(),
            body: String::new(),
            author: "Test User".to_string(),
            author_email: "test@example.com".to_string(),
            committer: "Test User".to_string(),
            committer_email: "test@example.com".to_string(),
            date: "now".to_string(),
            authored_at: "2026-01-01T00:00:00Z".to_string(),
            committed_at: "2026-01-01T00:00:00Z".to_string(),
            parents: parents.iter().map(|parent| (*parent).to_string()).collect(),
            refs: Vec::new(),
        };
        let commits = vec![
            commit("tip", &["left-merge", "right-merge"]),
            commit("left-merge", &["left", "right-base"]),
            commit("right-merge", &["right", "left-base"]),
            commit("left", &["left-base"]),
            commit("right", &["right-base"]),
            commit("left-base", &["root"]),
            commit("right-base", &["root"]),
            commit("root", &[]),
        ];
        let first = serde_json::to_vec(&layout_graph(&commits)).unwrap();
        let second = serde_json::to_vec(&layout_graph(&commits)).unwrap();
        assert_eq!(first, second);
        let (_, rows) = layout_graph(&commits);
        assert_eq!(rows[0].transitions.len(), 1);
        assert!(rows.iter().any(|row| !row.transitions.is_empty()));
    }

    #[test]
    fn appending_an_older_page_preserves_existing_lane_geometry() {
        let partial = vec![
            graph_fixture_commit("tip", &["middle"]),
            graph_fixture_commit("middle", &["root"]),
        ];
        let full = vec![
            graph_fixture_commit("tip", &["middle"]),
            graph_fixture_commit("middle", &["root"]),
            graph_fixture_commit("root", &["older"]),
            graph_fixture_commit("older", &[]),
        ];
        let (partial_commits, partial_rows) = layout_graph(&partial);
        let (full_commits, full_rows) = layout_graph(&full);
        assert_eq!(partial_commits, full_commits[..partial_commits.len()]);
        for (partial_row, full_row) in partial_rows.iter().zip(&full_rows) {
            assert_eq!(partial_row.row, full_row.row);
            assert_eq!(partial_row.rails, full_row.rails);
            assert_eq!(partial_row.transitions, full_row.transitions);
        }
        assert_eq!(partial_rows.last().unwrap().truncated_edges.len(), 1);
        assert!(full_rows[1].truncated_edges.is_empty());
    }

    #[test]
    fn graph_layout_handles_ten_thousand_linear_commits_with_bounded_lanes() {
        let commits = (0..10_000)
            .map(|index| GitCommit {
                hash: format!("commit-{index}"),
                message: format!("commit {index}"),
                body: String::new(),
                author: "Test User".to_string(),
                author_email: "test@example.com".to_string(),
                committer: "Test User".to_string(),
                committer_email: "test@example.com".to_string(),
                date: "now".to_string(),
                authored_at: "2026-01-01T00:00:00Z".to_string(),
                committed_at: "2026-01-01T00:00:00Z".to_string(),
                parents: (index + 1 < 10_000)
                    .then(|| format!("commit-{}", index + 1))
                    .into_iter()
                    .collect(),
                refs: Vec::new(),
            })
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let (graph_commits, rows) = layout_graph(&commits);
        assert_eq!(graph_commits.len(), 10_000);
        assert_eq!(rows.len(), 10_000);
        assert!(graph_commits.iter().all(|commit| commit.column == 0));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn graph_layout_fixture_matrix_matches_golden_geometry() {
        let fixtures = [
            (
                "linear",
                vec![
                    graph_fixture_commit("tip", &["middle"]),
                    graph_fixture_commit("middle", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "fork",
                vec![
                    graph_fixture_commit("feature", &["feature-base"]),
                    graph_fixture_commit("main", &["root"]),
                    graph_fixture_commit("feature-base", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "merge",
                vec![
                    graph_fixture_commit("merge", &["main", "feature"]),
                    graph_fixture_commit("feature", &["root"]),
                    graph_fixture_commit("main", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "nested-merge",
                vec![
                    graph_fixture_commit("outer", &["main", "inner"]),
                    graph_fixture_commit("inner", &["side-a", "side-b"]),
                    graph_fixture_commit("side-b", &["root"]),
                    graph_fixture_commit("side-a", &["root"]),
                    graph_fixture_commit("main", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "criss-cross",
                vec![
                    graph_fixture_commit("tip", &["left-merge", "right-merge"]),
                    graph_fixture_commit("left-merge", &["left", "right-base"]),
                    graph_fixture_commit("right-merge", &["right", "left-base"]),
                    graph_fixture_commit("left", &["left-base"]),
                    graph_fixture_commit("right", &["right-base"]),
                    graph_fixture_commit("left-base", &["root"]),
                    graph_fixture_commit("right-base", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "octopus",
                vec![
                    graph_fixture_commit("merge", &["main", "one", "two"]),
                    graph_fixture_commit("two", &["root"]),
                    graph_fixture_commit("one", &["root"]),
                    graph_fixture_commit("main", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "multiple-roots",
                vec![
                    graph_fixture_commit("tip-a", &["root-a"]),
                    graph_fixture_commit("tip-b", &["root-b"]),
                    graph_fixture_commit("root-a", &[]),
                    graph_fixture_commit("root-b", &[]),
                ],
            ),
            (
                "wip",
                vec![
                    graph_fixture_commit("inferay-wip-current:/repo", &["head"]),
                    graph_fixture_commit("head", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "multi-worktree-wip",
                vec![
                    graph_fixture_commit("inferay-wip-current:/repo", &["main"]),
                    graph_fixture_commit("main", &["root"]),
                    graph_fixture_commit("inferay-wip-linked:/linked", &["feature"]),
                    graph_fixture_commit("feature", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "stash",
                vec![
                    graph_fixture_commit("stash", &["head", "index"]),
                    graph_fixture_commit("index", &["head"]),
                    graph_fixture_commit("head", &["root"]),
                    graph_fixture_commit("root", &[]),
                ],
            ),
            (
                "missing-parent",
                vec![
                    graph_fixture_commit("tip", &["middle"]),
                    graph_fixture_commit("middle", &["outside"]),
                ],
            ),
        ];
        let golden = HashMap::from([
            (
                "linear",
                json!({"columns":[0,0,0],"transitions":[[],[],[]],"convergences":[[],[],[]],"truncated":[]}),
            ),
            (
                "fork",
                json!({"columns":[0,1,0,0],"transitions":[[],[],[],[]],"convergences":[[],[],[],[[1,0]]],"truncated":[]}),
            ),
            (
                "merge",
                json!({"columns":[0,1,0,0],"transitions":[[[0,1]],[],[],[]],"convergences":[[],[],[],[[1,0]]],"truncated":[]}),
            ),
            (
                "nested-merge",
                json!({"columns":[0,1,2,1,0,0],"transitions":[[[0,1]],[[1,2]],[],[],[],[]],"convergences":[[],[],[],[],[],[[1,0],[2,0]]],"truncated":[]}),
            ),
            (
                "criss-cross",
                json!({"columns":[0,0,1,0,1,3,2,2],"transitions":[[[0,1]],[[0,2]],[[1,3]],[],[],[],[],[]],"convergences":[[],[],[],[],[],[[0,3]],[[1,2]],[[3,2]]],"truncated":[]}),
            ),
            (
                "octopus",
                json!({"columns":[0,2,1,0,0],"transitions":[[[0,1],[0,2]],[],[],[],[]],"convergences":[[],[],[],[],[[1,0],[2,0]]],"truncated":[]}),
            ),
            (
                "multiple-roots",
                json!({"columns":[0,1,0,1],"transitions":[[],[],[],[]],"convergences":[[],[],[],[]],"truncated":[]}),
            ),
            (
                "wip",
                json!({"columns":[0,0,0],"transitions":[[],[],[]],"convergences":[[],[],[]],"truncated":[]}),
            ),
            (
                "multi-worktree-wip",
                json!({"columns":[0,0,1,1,0],"transitions":[[],[],[],[],[]],"convergences":[[],[],[],[],[[1,0]]],"truncated":[]}),
            ),
            (
                "stash",
                json!({"columns":[0,1,0,0],"transitions":[[[0,1]],[],[],[]],"convergences":[[],[],[[1,0]],[]],"truncated":[]}),
            ),
            (
                "missing-parent",
                json!({"columns":[0,0],"transitions":[[],[]],"convergences":[[],[]],"truncated":[0]}),
            ),
        ]);
        for (name, commits) in fixtures {
            let (graph, rows) = layout_graph(&commits);
            let signature = json!({
                "columns": graph.iter().map(|commit| commit.column).collect::<Vec<_>>(),
                "transitions": rows.iter().map(|row| row.transitions.iter().map(|edge| (edge.from_column, edge.to_column)).collect::<Vec<_>>()).collect::<Vec<_>>(),
                "convergences": rows.iter().map(|row| row.convergences.iter().map(|edge| (edge.from_column, edge.to_column)).collect::<Vec<_>>()).collect::<Vec<_>>(),
                "truncated": rows.last().map(|row| row.truncated_edges.iter().map(|edge| edge.column).collect::<Vec<_>>()).unwrap_or_default(),
            });
            assert_eq!(signature, golden[name], "geometry changed for {name}");
        }
    }

    #[test]
    fn full_diff_preserves_raw_patch_for_unstaged_edits() {
        let repository = make_repository();
        std::fs::write(
            repository.path().join("tracked.ts"),
            "export const value = 1;\n",
        )
        .unwrap();
        git(repository.path(), &["add", "tracked.ts"]);
        git(repository.path(), &["commit", "-m", "initial"]);
        std::fs::write(
            repository.path().join("tracked.ts"),
            "export const value = 2;\n",
        )
        .unwrap();
        let cwd = repository.path().to_string_lossy();

        let diff = get_git_hunk_diff(&allowed(repository.path()), &cwd, "tracked.ts", false);
        let patch = diff.raw_patch.unwrap();
        assert!(patch.contains("diff --git a/tracked.ts b/tracked.ts"));
        assert!(patch.contains("--- a/tracked.ts"));
        assert!(patch.contains("+++ b/tracked.ts"));
        assert!(diff
            .new_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Add));
    }

    #[test]
    fn full_diff_treats_untracked_bracket_paths_as_literal_new_files() {
        let repository = make_repository();
        let directory = repository.path().join("app/api/[...path]");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("route.ts"), "export const route = true;\n").unwrap();
        let cwd = repository.path().to_string_lossy();

        let diff = get_git_hunk_diff(
            &allowed(repository.path()),
            &cwd,
            "app/api/[...path]/route.ts",
            false,
        );

        assert!(diff.is_new);
        assert!(diff.raw_patch.unwrap().contains("new file mode"));
        assert!(diff
            .new_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Add));
    }

    #[test]
    fn full_diff_separates_staged_and_unstaged_added_file_changes() {
        let repository = make_repository();
        std::fs::write(
            repository.path().join("added.ts"),
            "export const value = 1;\n",
        )
        .unwrap();
        git(repository.path(), &["add", "added.ts"]);
        std::fs::write(
            repository.path().join("added.ts"),
            "export const value = 2;\n",
        )
        .unwrap();
        let cwd = repository.path().to_string_lossy();
        let roots = allowed(repository.path());

        let staged = get_git_hunk_diff(&roots, &cwd, "added.ts", true);
        let unstaged = get_git_hunk_diff(&roots, &cwd, "added.ts", false);
        let staged_patch = staged.raw_patch.unwrap();
        let unstaged_patch = unstaged.raw_patch.unwrap();
        assert!(staged_patch.contains("new file mode"));
        assert!(staged_patch.contains("+export const value = 1;"));
        assert!(staged.new_lines.iter().any(|line| {
            line.line_type == GitDiffLineType::Add && line.content == "export const value = 1;"
        }));
        assert!(!staged
            .new_lines
            .iter()
            .any(|line| line.content == "export const value = 2;"));
        assert!(unstaged_patch.contains("--- a/added.ts"));
        assert!(unstaged_patch.contains("+++ b/added.ts"));
        assert!(unstaged_patch.contains("-export const value = 1;"));
        assert!(unstaged_patch.contains("+export const value = 2;"));
        assert!(unstaged.old_lines.iter().any(|line| {
            line.line_type == GitDiffLineType::Remove && line.content == "export const value = 1;"
        }));
        assert!(unstaged.new_lines.iter().any(|line| {
            line.line_type == GitDiffLineType::Add && line.content == "export const value = 2;"
        }));
    }

    #[test]
    fn full_diff_renders_deleted_and_renamed_files() {
        let repository = make_repository();
        std::fs::write(
            repository.path().join("deleted.ts"),
            "export const gone = true;\n",
        )
        .unwrap();
        std::fs::write(
            repository.path().join("old-name.ts"),
            "export const renamed = true;\n",
        )
        .unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "initial"]);
        std::fs::remove_file(repository.path().join("deleted.ts")).unwrap();
        git(repository.path(), &["mv", "old-name.ts", "new-name.ts"]);
        let cwd = repository.path().to_string_lossy();
        let roots = allowed(repository.path());

        let deleted = get_git_hunk_diff(&roots, &cwd, "deleted.ts", false);
        assert!(deleted.raw_patch.unwrap().contains("deleted file mode"));
        assert!(deleted
            .old_lines
            .iter()
            .any(|line| line.line_type == GitDiffLineType::Remove));
        assert!(deleted
            .new_lines
            .iter()
            .all(|line| line.line_type == GitDiffLineType::Spacer));

        let renamed = get_git_hunk_diff(&roots, &cwd, "new-name.ts", true);
        let patch = renamed.raw_patch.unwrap();
        assert!(patch.contains("rename from old-name.ts"));
        assert!(patch.contains("rename to new-name.ts"));
    }

    #[test]
    fn full_diff_handles_images_long_lines_and_conflicts() {
        let repository = make_repository();
        std::fs::write(repository.path().join("image.png"), [137, 80, 78, 71]).unwrap();
        std::fs::write(
            repository.path().join("long.ts"),
            format!("{}\n", "a".repeat(9_001)),
        )
        .unwrap();
        git(repository.path(), &["add", "."]);
        git(repository.path(), &["commit", "-m", "initial"]);
        std::fs::write(repository.path().join("image.png"), [137, 80, 78, 71, 1]).unwrap();
        std::fs::write(
            repository.path().join("long.ts"),
            format!("{}\n", "b".repeat(9_001)),
        )
        .unwrap();
        let conflict = [
            "export const value = 1;",
            "<<<<<<< HEAD",
            "export const side = 'current';",
            "=======",
            "export const side = 'incoming';",
            ">>>>>>> feature",
            "",
        ]
        .join("\n");
        std::fs::write(repository.path().join("conflict.ts"), &conflict).unwrap();
        let cwd = repository.path().to_string_lossy();
        let roots = allowed(repository.path());

        let image = get_git_hunk_diff(&roots, &cwd, "image.png", false);
        assert!(image.is_binary);
        assert_eq!(image.is_image, Some(true));
        assert!(image
            .raw_patch
            .unwrap()
            .contains("diff --git a/image.png b/image.png"));

        let long = get_git_hunk_diff(&roots, &cwd, "long.ts", false);
        assert!(long.new_lines[0].content.contains("very long line"));
        assert!(long
            .raw_patch
            .unwrap()
            .contains("diff --git a/long.ts b/long.ts"));

        let conflict_diff = get_git_hunk_diff(&roots, &cwd, "conflict.ts", false);
        assert_eq!(
            conflict_diff.merge_conflict_content.as_deref(),
            Some(conflict.as_str())
        );
        assert!(conflict_diff
            .raw_patch
            .unwrap()
            .contains("diff --git a/conflict.ts b/conflict.ts"));
    }

    #[test]
    fn simple_and_file_with_diff_preserve_existing_contracts() {
        let repository = make_repository();
        std::fs::write(repository.path().join("tracked.ts"), "one\ntwo\n").unwrap();
        git(repository.path(), &["add", "tracked.ts"]);
        git(repository.path(), &["commit", "-m", "initial"]);
        std::fs::write(repository.path().join("tracked.ts"), "one\nchanged\n").unwrap();
        let cwd = repository.path().to_string_lossy();
        let roots = allowed(repository.path());

        let diff = get_git_diff(&roots, &cwd, "tracked.ts", false);
        assert!(diff.contains("-two"));
        assert!(diff.contains("+changed"));
        let GitFileWithDiff::Text { lines } =
            get_git_file_with_diff(&roots, &cwd, "tracked.ts", false)
        else {
            panic!("expected text file response");
        };
        assert_eq!(lines[1].line_type, GitDiffLineType::Add);
        assert_eq!(lines[1].content, "changed");
    }
}
