mod prepared_diff;
pub use prepared_diff::{
    prepare_conflict_lines, prepare_edit_diff, PreparedEditDiff, SequentialEdit,
};
mod graph_semantics;
pub use graph_semantics::{GraphAncestry, GraphNavigation};
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
pub struct GitOperationResult {
    pub ok: bool,
    pub operation: String,
    pub outcome: GitOperationOutcome,
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
    pub can_merge: bool,
    pub can_fast_forward: bool,
    pub can_rebase: bool,
    pub can_interactive_rebase: bool,
    pub interactive_rebase_commits: Vec<GitCommitSummary>,
    pub interactive_rebase_plan: Vec<GitInteractiveRebaseStep>,
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
pub struct GitCommitSummary {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Default)]
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
    pub label: String,
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

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
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
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stash_name: Option<String>,
    pub column: usize,
    pub color_index: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitGraphItemKind {
    #[default]
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

#[derive(Clone, Copy)]
enum DiffOperation {
    Removed,
    Unchanged,
    Added,
}

fn diff_operations<T: PartialEq>(
    old_lines: &[T],
    new_lines: &[T],
) -> Vec<(DiffOperation, Option<usize>, Option<usize>)> {
    // Trim unchanged boundaries before allocating a bounded comparison table.
    let mut prefix = 0;
    while prefix < old_lines.len()
        && prefix < new_lines.len()
        && old_lines[prefix] == new_lines[prefix]
    {
        prefix += 1;
    }
    let (mut old_end, mut new_end) = (old_lines.len(), new_lines.len());
    while old_end > prefix && new_end > prefix && old_lines[old_end - 1] == new_lines[new_end - 1] {
        old_end -= 1;
        new_end -= 1;
    }
    let (m, n) = (old_end - prefix, new_end - prefix);
    let mut diff_ops = Vec::with_capacity(old_lines.len() + new_lines.len());
    for i in 0..prefix {
        diff_ops.push((DiffOperation::Unchanged, Some(i), Some(i)));
    }
    if m == 0 || n == 0 || (m + 1).saturating_mul(n + 1) > 1_000_000 {
        for i in prefix..old_end {
            diff_ops.push((DiffOperation::Removed, Some(i), None));
        }
        for j in prefix..new_end {
            diff_ops.push((DiffOperation::Added, None, Some(j)));
        }
    } else {
        let width = n + 1;
        let mut dp = vec![0u32; (m + 1) * width];
        for i in 1..=m {
            for j in 1..=n {
                dp[i * width + j] = if old_lines[prefix + i - 1] == new_lines[prefix + j - 1] {
                    dp[(i - 1) * width + j - 1] + 1
                } else {
                    dp[(i - 1) * width + j].max(dp[i * width + j - 1])
                };
            }
        }
        let mut middle = Vec::new();
        let (mut i, mut j) = (m, n);
        while i > 0 || j > 0 {
            if i > 0 && j > 0 && old_lines[prefix + i - 1] == new_lines[prefix + j - 1] {
                middle.push((
                    DiffOperation::Unchanged,
                    Some(prefix + i - 1),
                    Some(prefix + j - 1),
                ));
                i -= 1;
                j -= 1;
            } else if j > 0 && (i == 0 || dp[i * width + j - 1] >= dp[(i - 1) * width + j]) {
                middle.push((DiffOperation::Added, None, Some(prefix + j - 1)));
                j -= 1;
            } else {
                middle.push((DiffOperation::Removed, Some(prefix + i - 1), None));
                i -= 1;
            }
        }
        diff_ops.extend(middle.into_iter().rev());
    }
    for (i, j) in (old_end..old_lines.len()).zip(new_end..new_lines.len()) {
        diff_ops.push((DiffOperation::Unchanged, Some(i), Some(j)));
    }

    diff_ops
}

thread_local! {
    static GIT_DEADLINE: std::cell::Cell<Option<std::time::Instant>> = const { std::cell::Cell::new(None) };
}

pub fn with_git_deadline<T>(duration: Duration, work: impl FnOnce() -> T) -> T {
    struct Restore(Option<std::time::Instant>);
    impl Drop for Restore {
        fn drop(&mut self) {
            GIT_DEADLINE.with(|deadline| deadline.set(self.0));
        }
    }
    let previous =
        GIT_DEADLINE.with(|deadline| deadline.replace(Some(std::time::Instant::now() + duration)));
    let _restore = Restore(previous);
    work()
}

fn remaining_git_time(timeout: Duration) -> Duration {
    GIT_DEADLINE.with(|deadline| {
        deadline
            .get()
            .map(|end| timeout.min(end.saturating_duration_since(std::time::Instant::now())))
            .unwrap_or(timeout)
    })
}

fn run_git(args: &[&str], cwd: &str) -> Option<String> {
    run_git_timed(args, cwd, Duration::from_secs(10))
}

fn git_failure(command: &str, kind: &str, detail: &str) -> String {
    if detail.is_empty() {
        format!("{command} {kind}")
    } else {
        format!("{command} {kind}: {detail}")
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

fn run_git_timed(args: &[&str], cwd: &str, timeout: Duration) -> Option<String> {
    run_git_bytes(args, cwd, timeout)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn run_git_bytes(args: &[&str], cwd: &str, timeout: Duration) -> Result<Vec<u8>, String> {
    let timeout = remaining_git_time(timeout);
    let command = format!("git {}", args.first().copied().unwrap_or("command"));
    let failure = |kind, detail: &str| git_failure(&command, kind, detail);
    if timeout.is_zero() {
        return Err(failure("timed out", "request deadline exceeded"));
    }
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| failure("could not start", &error.to_string()))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("could not start", "stdout was unavailable"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| failure("could not start", "stderr was unavailable"))?;
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
            return Err(failure(
                "timed out",
                &format!("after {} ms", timeout.as_millis()),
            ));
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            drop(stdout_reader);
            drop(stderr_reader);
            return Err(failure("failed", &error.to_string()));
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| failure("returned invalid output", "stdout reader failed"))?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(failure("failed", &sanitized_git_error(&stderr)));
    }
    Ok(stdout)
}

const MAX_UNTRACKED_FILE_BYTES: u64 = 500_000;
// Bound retained source rows/bytes; the UI mounts only its visible window.
const MAX_RENDERED_DIFF_LINES: usize = 100_000;
const MAX_DIFF_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_RENDERED_LINE_CHARS: usize = 8_000;

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

fn get_raw_git_patch(cwd: &str, file_path: &str, staged: bool) -> String {
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--binary", "--find-renames", "--", file_path]);
    let patch = run_git_timed(&args, cwd, Duration::from_secs(5)).unwrap_or_default();
    if !patch.lines().any(|line| line.starts_with("new file mode ")) {
        return patch;
    }
    let Some(original_path) = renamed_from_path(cwd, file_path, staged) else {
        return patch;
    };
    args.pop();
    args.extend([&original_path, file_path]);
    let rename_patch = run_git_timed(&args, cwd, Duration::from_secs(5)).unwrap_or_default();
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
        new_lines: vec![GitDiffLine {
            number: Some(1),
            content: message.to_string(),
            line_type: GitDiffLineType::Context,
        }],
        is_new,
        ..Default::default()
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
            is_binary: true,
            is_new,
            raw_patch: Some(raw_patch),
            ..Default::default()
        };
    }

    if old_content.len().saturating_add(new_content.len()) > MAX_DIFF_TEXT_BYTES {
        let mut result = too_large_diff(
            "Diff too large: text exceeds the 8 MiB preview limit",
            is_new,
        );
        result.raw_patch = Some(raw_patch);
        return result;
    }
    if old_content
        .split('\n')
        .take(MAX_RENDERED_DIFF_LINES + 1)
        .count()
        + new_content
            .split('\n')
            .take(MAX_RENDERED_DIFF_LINES + 1)
            .count()
        > MAX_RENDERED_DIFF_LINES
    {
        let mut result = too_large_diff(
            "Diff too large: preview exceeds 100,000 source lines",
            is_new,
        );
        result.raw_patch = Some(raw_patch);
        return result;
    }

    let old_file_lines = content_lines(old_content);
    let new_file_lines = content_lines(new_content);
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

    if is_deleted {
        let lines = content_lines(old_content);
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
            raw_patch: Some(raw_patch),
            ..Default::default()
        };
    }

    if is_new {
        return GitHunkDiff {
            new_lines: content_lines(new_content)
                .iter()
                .enumerate()
                .map(|(index, content)| GitDiffLine {
                    number: Some(index + 1),
                    content: (*content).to_string(),
                    line_type: GitDiffLineType::Add,
                })
                .collect(),
            is_new: true,
            raw_patch: Some(raw_patch),
            merge_conflict_content,
            ..Default::default()
        };
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
        let removed = old_removed || new_index == new_file_lines.len();
        let added = new_added || old_index == old_file_lines.len();
        let take_old = old_index < old_file_lines.len() && (removed || !added);
        let take_new = new_index < new_file_lines.len() && (added || !removed);
        let line = |source: &[&str], index: usize, take: bool, changed, change_type| GitDiffLine {
            number: take.then_some(index + 1),
            content: if take {
                source[index].to_owned()
            } else {
                String::new()
            },
            line_type: if !take {
                GitDiffLineType::Spacer
            } else if changed {
                change_type
            } else {
                GitDiffLineType::Context
            },
        };
        old_lines.push(line(
            &old_file_lines,
            old_index,
            take_old,
            removed,
            GitDiffLineType::Remove,
        ));
        new_lines.push(line(
            &new_file_lines,
            new_index,
            take_new,
            added,
            GitDiffLineType::Add,
        ));
        old_index += usize::from(take_old);
        new_index += usize::from(take_new);
    }

    GitHunkDiff {
        old_lines,
        new_lines,
        raw_patch: Some(raw_patch),
        merge_conflict_content,
        ..Default::default()
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

fn git_file_content(cwd: &str, revision: &str, path: &str) -> Option<String> {
    run_git_timed(
        &["show", &format!("{revision}:{path}")],
        cwd,
        Duration::from_secs(5),
    )
}

fn get_git_revision_hunk_diff(
    cwd: &str,
    old_revision: Option<&str>,
    new_revision: &str,
    file_path: &str,
    review: bool,
) -> Option<GitHunkDiff> {
    let mut args = match old_revision {
        Some(_) => vec!["diff"],
        None => vec!["show", "--format=", "--root"],
    };
    args.extend([
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        "--find-renames",
    ]);
    args.extend(old_revision);
    args.extend([new_revision, "--", file_path]);
    let raw_patch = run_git_timed(&args, cwd, Duration::from_secs(5))?;
    if raw_patch.trim().is_empty() {
        return None;
    }
    let old_path = patch_header_path(&raw_patch, "--- ").unwrap_or_else(|| file_path.to_string());
    let new_path = patch_header_path(&raw_patch, "+++ ").unwrap_or_else(|| file_path.to_string());
    let is_new = raw_patch.lines().any(|line| line == "--- /dev/null");
    let is_deleted = raw_patch.lines().any(|line| line == "+++ /dev/null");
    let old_content = old_revision
        .filter(|_| !is_new)
        .and_then(|revision| git_file_content(cwd, revision, &old_path))
        .unwrap_or_default();
    let new_content = if is_deleted {
        String::new()
    } else {
        git_file_content(cwd, new_revision, &new_path).unwrap_or_default()
    };
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
            is_binary: true,
            is_new: untracked,
            is_image: Some(is_image_file(file_path)),
            image_path: (!deleted).then(|| full_path.to_string_lossy().into_owned()),
            raw_patch: Some(raw_patch),
            ..Default::default()
        });
    }
    let new_content = String::from_utf8_lossy(&new_bytes).into_owned();
    let old_content = if untracked {
        String::new()
    } else {
        git_file_content(cwd, from_hash, file_path).unwrap_or_default()
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

pub fn get_git_commit_hunk_diff_for_parent(
    cwd: &str,
    hash: &str,
    requested_parent: Option<&str>,
    file_path: &str,
    review: bool,
) -> Option<GitHunkDiff> {
    if !is_safe_relative_path(file_path) {
        return None;
    }
    let lineage = run_git(&["rev-list", "--parents", "-n", "1", hash], cwd)?;
    let mut parents = lineage.split_whitespace().skip(1);
    let first = parents.next();
    let parent = requested_parent
        .filter(|candidate| Some(*candidate) == first || parents.any(|parent| parent == *candidate))
        .or(first);
    get_git_revision_hunk_diff(cwd, parent, hash, file_path, review)
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
            is_binary: true,
            is_new: true,
            is_image: Some(true),
            image_path: Some(full_path_text),
            raw_patch: Some(raw_patch),
            ..Default::default()
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
                            is_binary: true,
                            raw_patch: Some(raw_patch),
                            ..Default::default()
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

    let old_result = git_file_content(cwd, if staged { "HEAD" } else { "" }, file_path);
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
        git_file_content(cwd, "", file_path).unwrap_or_default()
    } else {
        current_content
    };

    let raw_patch = if is_new && raw_patch.is_empty() {
        create_untracked_patch(file_path, &new_content)
    } else {
        raw_patch
    };
    build_hunk_diff_from_versions(
        raw_patch,
        &old_content,
        &new_content,
        is_new,
        deleted_patch,
        merge_conflict_content,
    )
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

fn is_changed(line: &GitDiffLine) -> bool {
    matches!(
        line.line_type,
        GitDiffLineType::Add | GitDiffLineType::Remove
    )
}

fn append_review_rows(result: &mut Vec<GitDiffLine>, rows: &[GitDiffLine]) {
    for run in rows.chunk_by(|a, b| is_changed(a) == is_changed(b)) {
        if is_changed(&run[0]) {
            for kind in [GitDiffLineType::Remove, GitDiffLineType::Add] {
                result.extend(run.iter().filter(|line| line.line_type == kind).cloned());
            }
        } else {
            result.extend_from_slice(run);
        }
    }
}

enum ReviewSection {
    Hidden(usize),
    Visible(std::ops::Range<usize>),
}

fn review_sections(
    line_count: usize,
    changed_rows: impl Iterator<Item = usize>,
) -> Option<Vec<ReviewSection>> {
    let mut ranges = Vec::<std::ops::Range<usize>>::new();
    for row in changed_rows {
        let start = row.saturating_sub(REVIEW_CONTEXT_LINES);
        let end = (row + REVIEW_CONTEXT_LINES + 1).min(line_count);
        if let Some(previous) = ranges
            .last_mut()
            .filter(|previous| start <= previous.end + REVIEW_CONTEXT_LINES)
        {
            previous.end = previous.end.max(end);
        } else {
            ranges.push(start..end);
        }
    }
    if ranges.is_empty() {
        return None;
    }
    let mut sections = Vec::new();
    let mut cursor = 0;
    for range in ranges {
        if range.start > cursor {
            sections.push(ReviewSection::Hidden(range.start - cursor));
        }
        cursor = range.end;
        sections.push(ReviewSection::Visible(range));
    }
    if cursor < line_count {
        sections.push(ReviewSection::Hidden(line_count - cursor));
    }
    Some(sections)
}

pub fn prepare_inline_lines(
    old_lines: &[GitDiffLine],
    new_lines: &[GitDiffLine],
) -> Vec<GitDiffLine> {
    let mut stacked = Vec::new();
    let line_count = old_lines.len().max(new_lines.len());
    for index in 0..line_count {
        let old_line = old_lines.get(index);
        let new_line = new_lines.get(index);
        if old_line.is_some_and(|line| line.line_type == GitDiffLineType::Hunk)
            || new_line.is_some_and(|line| line.line_type == GitDiffLineType::Hunk)
        {
            stacked.push(GitDiffLine {
                number: None,
                content: String::new(),
                line_type: GitDiffLineType::Hunk,
            });
            continue;
        }
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
        .filter_map(|(index, line)| is_changed(line).then_some(index));
    let Some(sections) = review_sections(stacked.len(), changed_rows) else {
        return stacked;
    };
    let mut result = Vec::new();
    for section in sections {
        match section {
            ReviewSection::Hidden(count) => result.push(compact_context_line(count)),
            ReviewSection::Visible(range) => append_review_rows(&mut result, &stacked[range]),
        }
    }
    result
}

fn build_review_split_lines(
    old_lines: &[GitDiffLine],
    new_lines: &[GitDiffLine],
) -> (Vec<GitDiffLine>, Vec<GitDiffLine>) {
    let line_count = old_lines.len().max(new_lines.len());
    let changed_rows = (0..line_count).filter(|&index| {
        old_lines.get(index).is_some_and(is_changed) || new_lines.get(index).is_some_and(is_changed)
    });
    let Some(sections) = review_sections(line_count, changed_rows) else {
        return (old_lines.to_vec(), new_lines.to_vec());
    };

    let spacer = || GitDiffLine {
        number: None,
        content: String::new(),
        line_type: GitDiffLineType::Spacer,
    };
    let mut compact_old = Vec::new();
    let mut compact_new = Vec::new();
    for section in sections {
        match section {
            ReviewSection::Hidden(count) => {
                let marker = compact_context_line(count);
                compact_old.push(marker.clone());
                compact_new.push(marker);
            }
            ReviewSection::Visible(range) => {
                for row in range {
                    compact_old.push(old_lines.get(row).cloned().unwrap_or_else(&spacer));
                    compact_new.push(new_lines.get(row).cloned().unwrap_or_else(&spacer));
                }
            }
        }
    }
    (compact_old, compact_new)
}

pub fn compact_git_hunk_diff(mut diff: GitHunkDiff) -> GitHunkDiff {
    if !diff.is_binary && diff.merge_conflict_content.is_none() {
        diff.compact_lines = Some(prepare_inline_lines(&diff.old_lines, &diff.new_lines));
        (diff.old_lines, diff.new_lines) =
            build_review_split_lines(&diff.old_lines, &diff.new_lines);
        diff.raw_patch = None;
    }
    diff
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
    let git_dir = run_git(&["rev-parse", "--absolute-git-dir"], cwd);
    let exists = |name: &str| {
        git_dir
            .as_ref()
            .is_some_and(|dir| Path::new(dir.trim()).join(name).exists())
    };
    let kind = if exists("rebase-merge") || exists("rebase-apply") {
        GitRepositoryOperationKind::Rebase
    } else if exists("MERGE_HEAD") {
        GitRepositoryOperationKind::Merge
    } else if exists("CHERRY_PICK_HEAD") {
        GitRepositoryOperationKind::CherryPick
    } else if exists("REVERT_HEAD") {
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

pub fn preflight_git_checkout(cwd: &str, branch_name: &str) -> GitCheckoutPreflight {
    let branch_exists = get_git_branches(cwd)
        .iter()
        .any(|branch| branch.name == branch_name);
    let already_current = current_git_branch(cwd).as_deref() == Some(branch_name);
    let status = git_status(cwd, false);
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
) -> GitOperationResult {
    match output {
        Ok(output) if output.status.success() => {
            let repository_operation = get_git_repository_operation_state(cwd);
            GitOperationResult {
                ok: true,
                operation: operation.to_string(),
                outcome: if repository_operation.kind == GitRepositoryOperationKind::Idle {
                    GitOperationOutcome::Completed
                } else {
                    GitOperationOutcome::AwaitingContinuation
                },

                head: current_git_head(cwd),
                conflicts: repository_operation.conflicts,
                error_kind: None,
                error: None,
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let error = if stderr.is_empty() {
                format!("Git {operation} failed")
            } else {
                stderr
            };
            git_operation_error(cwd, operation, error)
        }
        Err(error) => {
            ref_operation_failure(cwd, operation, GitOperationErrorKind::Io, error.to_string())
        }
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
        can_merge,
        can_fast_forward,
        can_rebase,
        can_interactive_rebase,
        interactive_rebase_plan: interactive_rebase_commits
            .iter()
            .map(|commit| GitInteractiveRebaseStep {
                hash: commit.hash.clone(),
                action: "pick".into(),
                message: Some(commit.message.clone()),
            })
            .collect(),
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

fn ref_operation_failure(
    cwd: &str,
    operation: &str,
    kind: GitOperationErrorKind,
    error: String,
) -> GitOperationResult {
    GitOperationResult {
        ok: false,
        operation: operation.into(),
        outcome: GitOperationOutcome::Failed,

        head: current_git_head(cwd),
        conflicts: Vec::new(),
        error_kind: Some(kind),
        error: Some(error),
    }
}

fn invalid_ref_operation(cwd: &str, operation: &str, error: String) -> GitOperationResult {
    GitOperationResult {
        conflicts: git_conflicts(cwd),
        ..ref_operation_failure(cwd, operation, GitOperationErrorKind::InvalidInput, error)
    }
}

pub fn perform_git_interactive_rebase(
    cwd: &str,
    source: &str,
    target: &str,
    steps: &[GitInteractiveRebaseStep],
) -> GitOperationResult {
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
                    .is_none_or(|message| message.trim().is_empty())
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
    let prepare = || -> Result<Command, String> {
        fs::create_dir_all(&state_dir).map_err(|error| error.to_string())?;
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
                    fs::write(
                        &message_path,
                        format!("{}\n", step.message.as_deref().unwrap_or_default().trim()),
                    )
                    .map_err(|error| error.to_string())?;
                    todo.push_str(&format!("pick {} {}\n", step.hash, subject));
                    todo.push_str(&format!(
                        "exec git -c commit.gpgSign=false commit --amend --no-verify -F {}\n",
                        shell_single_quote(&message_path.to_string_lossy())
                    ));
                }
                action => todo.push_str(&format!("{action} {} {}\n", step.hash, subject)),
            }
        }
        fs::write(&todo_path, todo)
            .and_then(|_| {
                fs::write(
                    &editor_path,
                    "#!/bin/sh\ncp \"$INFERAY_REBASE_TODO\" \"$1\"\n",
                )
            })
            .map_err(|error| error.to_string())?;
        let checkout = checkout_git_branch(cwd, source);
        if !checkout.ok {
            return Err(checkout
                .error
                .unwrap_or_else(|| format!("Unable to check out {source}")));
        }
        let merge_base = run_git(&["merge-base", source, target], cwd)
            .ok_or("The branches do not share a common ancestor")?;
        let mut command = Command::new("git");
        command
            .args([
                "rebase",
                "--interactive",
                "--onto",
                target,
                merge_base.trim(),
                source,
            ])
            .current_dir(cwd)
            .env(
                "GIT_SEQUENCE_EDITOR",
                format!("sh {}", shell_single_quote(&editor_path.to_string_lossy())),
            )
            .env("INFERAY_REBASE_TODO", &todo_path)
            .env("GIT_EDITOR", "true");
        Ok(command)
    };
    let result = match prepare() {
        Ok(mut command) => ref_operation_result(cwd, OPERATION, command.output()),
        Err(error) => {
            cleanup_interactive_rebase_state(cwd);
            return invalid_ref_operation(cwd, OPERATION, error);
        }
    };
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
) -> GitOperationResult {
    let branches = get_git_branches(cwd);
    if source == target
        || !branches.iter().any(|branch| branch.name == source)
        || !branches.iter().any(|branch| branch.name == target)
    {
        return ref_operation_failure(
            cwd,
            operation,
            GitOperationErrorKind::InvalidInput,
            "Source and target must be different local branches".to_string(),
        );
    }
    if !run_git(&["status", "--porcelain"], cwd).is_some_and(|value| value.trim().is_empty()) {
        return ref_operation_failure(
            cwd,
            operation,
            GitOperationErrorKind::DirtyWorktree,
            "Commit or stash working changes before changing branch history".to_string(),
        );
    }

    let checkout = match operation {
        "merge" | "fastForward" => checkout_git_branch(cwd, target),
        "rebase" => checkout_git_branch(cwd, source),
        _ => {
            return ref_operation_failure(
                cwd,
                operation,
                GitOperationErrorKind::InvalidInput,
                "Unsupported ref operation".to_string(),
            );
        }
    };
    if !checkout.ok {
        let error = checkout
            .error
            .unwrap_or_else(|| "Unable to check out the requested branch".to_string());
        return GitOperationResult {
            ok: false,
            operation: operation.to_string(),
            outcome: GitOperationOutcome::Failed,

            head: current_git_head(cwd),
            conflicts: Vec::new(),
            error_kind: Some(classify_git_operation_error(&error, &[])),
            error: Some(error),
        };
    }

    let mut command = Command::new("git");
    command.current_dir(cwd);
    match operation {
        "merge" => {
            command.args(["merge", "--no-edit", source]);
        }
        "fastForward" => {
            command.args(["merge", "--ff-only", source]);
        }
        _ => {
            command.args(["rebase", target]).env("GIT_EDITOR", "true");
        }
    }
    let output = command.output();
    ref_operation_result(cwd, operation, output)
}

pub fn finish_git_ref_operation(cwd: &str, operation: &str, action: &str) -> GitOperationResult {
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
            return GitOperationResult {
                conflicts: git_conflicts(cwd),
                ..ref_operation_failure(
                    cwd,
                    operation,
                    GitOperationErrorKind::InvalidInput,
                    "Unsupported conflict action".to_string(),
                )
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

fn git_operation_error(cwd: &str, action: &str, error: impl Into<String>) -> GitOperationResult {
    let error = error.into();
    let conflicts = git_conflicts(cwd);
    GitOperationResult {
        ok: false,
        operation: action.to_string(),
        outcome: if conflicts.is_empty() {
            GitOperationOutcome::Failed
        } else {
            GitOperationOutcome::Conflicted
        },

        head: current_git_head(cwd),
        error_kind: Some(classify_git_operation_error(&error, &conflicts)),
        conflicts,
        error: Some(error),
    }
}

fn resolve_commit(cwd: &str, target: &str) -> Option<String> {
    if target.is_empty() {
        return None;
    }
    run_git(
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{target}^{{commit}}"),
        ],
        cwd,
    )
    .map(|hash| hash.trim().to_owned())
}

fn valid_commit_target(cwd: &str, target: &str) -> bool {
    resolve_commit(cwd, target).is_some()
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

pub fn perform_git_graph_action_with_targets(
    cwd: &str,
    action: &str,
    target: Option<&str>,
    targets: &[String],
    name: Option<&str>,
    message: Option<&str>,
) -> GitOperationResult {
    let target = target.unwrap_or_default();
    let name = name.unwrap_or_default().trim();
    let operation = get_git_repository_operation_state(cwd);
    if operation.kind != GitRepositoryOperationKind::Idle {
        return git_operation_error(
            cwd,
            action,
            "Finish or abort the current Git operation before starting another",
        );
    }

    let mut command = Command::new("git");
    command.current_dir(cwd);
    match action {
        "createBranch" => {
            if !valid_commit_target(cwd, target) || !valid_ref_name(cwd, "branch", name) {
                return git_operation_error(cwd, action, "Invalid branch name or commit");
            }
            command.args(["branch", name, target]);
        }
        "createTag" => {
            if !valid_commit_target(cwd, target) || !valid_ref_name(cwd, "tag", name) {
                return git_operation_error(cwd, action, "Invalid tag name or commit");
            }
            command.arg("tag");
            if let Some(annotation) = message.filter(|value| !value.trim().is_empty()) {
                command.args(["-a", name, "-m", annotation, target]);
            } else {
                command.args([name, target]);
            }
        }
        "renameBranch" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
                || !valid_ref_name(cwd, "branch", name)
            {
                return git_operation_error(cwd, action, "Invalid local branch or new name");
            }
            command.args(["branch", "-m", target, name]);
        }
        "deleteBranch" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
            {
                return git_operation_error(cwd, action, "Local branch not found");
            }
            if current_git_branch(cwd).as_deref() == Some(target) {
                return git_operation_error(
                    cwd,
                    action,
                    "The checked-out branch cannot be deleted",
                );
            }
            command.args(["branch", "-d", target]);
        }
        "deleteTag" => {
            let full_name = format!("refs/tags/{target}");
            if target.is_empty()
                || run_git(&["show-ref", "--verify", "--quiet", &full_name], cwd).is_none()
            {
                return git_operation_error(cwd, action, "Local tag not found");
            }
            command.args(["tag", "-d", target]);
        }
        "setUpstream" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
                || name.is_empty()
                || name.starts_with('-')
                || !valid_commit_target(cwd, name)
            {
                return git_operation_error(cwd, action, "Invalid local branch or upstream");
            }
            command.args(["branch", &format!("--set-upstream-to={name}"), target]);
        }
        "pushSetUpstream" => {
            if !get_git_branches(cwd)
                .iter()
                .any(|branch| branch.name == target)
                || !valid_remote(cwd, name)
            {
                return git_operation_error(cwd, action, "Invalid local branch or remote");
            }
            command.args(["push", "--set-upstream", name, target]);
        }
        "deleteRemoteBranch" => {
            let Some((remote, branch)) = split_remote_tracking_ref(cwd, target) else {
                return git_operation_error(cwd, action, "Remote-tracking branch not found");
            };
            command.args(["push", &remote, "--delete", &branch]);
        }
        "pushTag" | "deleteRemoteTag" => {
            let full_name = format!("refs/tags/{target}");
            if target.is_empty()
                || target.starts_with('-')
                || !valid_remote(cwd, name)
                || run_git(&["show-ref", "--verify", "--quiet", &full_name], cwd).is_none()
            {
                return git_operation_error(cwd, action, "Invalid local tag or remote");
            }
            let refspec = if action == "deleteRemoteTag" {
                format!(":refs/tags/{target}")
            } else {
                format!("refs/tags/{target}:refs/tags/{target}")
            };
            command.args(["push", name, &refspec]);
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
                return git_operation_error(cwd, action, "Commit not found");
            }
            if !run_git(&["status", "--porcelain"], cwd)
                .is_some_and(|value| value.trim().is_empty())
            {
                return git_operation_error(
                    cwd,
                    action,
                    "Commit or stash working changes before changing history",
                );
            }
            command.env("GIT_EDITOR", "true");
            if action == "cherryPick" {
                command.args(["cherry-pick", "--no-edit"]);
                command.args(&ordered_targets);
            } else {
                command.args(["revert", "--no-edit", target]);
            }
        }
        "stashPush" => {
            let stash_message = message
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("WIP from Inferay");
            command.args(["stash", "push", "--include-untracked", "-m", stash_message]);
        }
        "stashApply" | "stashPop" | "stashDrop" => {
            if !get_git_stashes(cwd)
                .iter()
                .any(|stash| stash.name == target)
            {
                return git_operation_error(cwd, action, "Stash not found");
            }
            let subcommand = match action {
                "stashApply" => "apply",
                "stashPop" => "pop",
                _ => "drop",
            };
            command.args(["stash", subcommand, target]);
        }
        "stashRename" => {
            if name.is_empty() {
                return git_operation_error(cwd, action, "A new stash message is required");
            }
            if !get_git_stashes(cwd)
                .iter()
                .any(|stash| stash.name == target)
            {
                return git_operation_error(cwd, action, "Stash not found");
            }
            let Some(hash) = run_git(&["rev-parse", target], cwd)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            else {
                return git_operation_error(cwd, action, "Unable to resolve stash");
            };
            let drop = Command::new("git")
                .args(["stash", "drop", target])
                .current_dir(cwd)
                .output();
            if !drop.as_ref().is_ok_and(|output| output.status.success()) {
                return ref_operation_result(cwd, action, drop);
            }
            command.args(["stash", "store", "-m", name, &hash]);
        }
        "resetSoft" | "resetMixed" | "resetHard" => {
            if !valid_commit_target(cwd, target) || current_git_branch(cwd).is_none() {
                return git_operation_error(
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
            command.args(["reset", mode, target]);
        }
        "fetch" => {
            command.args(["fetch", "--all", "--prune"]);
        }
        "pull" | "push" | "forcePushWithLease" => {
            if action == "pull"
                && !run_git(&["status", "--porcelain"], cwd)
                    .is_some_and(|value| value.trim().is_empty())
            {
                return git_operation_error(
                    cwd,
                    action,
                    "Commit or stash working changes before pulling",
                );
            }
            let Some(status) = git_status(cwd, false) else {
                return git_operation_error(cwd, action, "Repository status is unavailable");
            };
            let force = action == "forcePushWithLease";
            if status.upstream.is_none() || (force && status.branch != target) {
                return git_operation_error(
                    cwd,
                    action,
                    if force {
                        "The checked-out branch and a configured upstream are required"
                    } else {
                        "The current branch has no configured upstream"
                    },
                );
            }
            if action == "pull" {
                command
                    .args(["pull", "--no-edit"])
                    .env("GIT_EDITOR", "true");
            } else {
                command.arg("push");
                if force {
                    command.arg("--force-with-lease");
                }
            }
        }
        _ => return git_operation_error(cwd, action, "Unsupported graph action"),
    };
    ref_operation_result(cwd, action, command.output())
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
        pull_request_number,
        pull_request_url,
    })
}

/// Read one change-list format for root commits, revision pairs, and worktrees.
fn git_change_files(cwd: &str, from: Option<&str>, to: Option<&str>) -> Vec<GitCommitFile> {
    let read = |format| {
        let mut args = if from.is_some() {
            vec!["diff"]
        } else {
            vec!["diff-tree", "--root", "--no-commit-id", "-r"]
        };
        args.extend(["--find-renames", format]);
        args.extend(from);
        args.extend(to);
        run_git(&args, cwd).unwrap_or_default()
    };
    let stats = parse_numstat(&read("--numstat"));
    read("--name-status")
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split('\t').collect();
            if fields.len() < 2 {
                return None;
            }
            let path = fields.last()?.to_string();
            let status = fields[0].chars().next()?.to_string();
            let original_path = matches!(status.as_str(), "R" | "C").then(|| fields[1].to_owned());
            let (additions, deletions) = stats.get(&path).copied().unwrap_or_default();
            Some(GitCommitFile {
                path,
                original_path,
                status,
                additions,
                deletions,
            })
        })
        .collect()
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

    let files = git_change_files(cwd, diff_parent.as_deref(), Some(hash));

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
    if from_hash == to_hash {
        return None;
    }
    let from_hash = resolve_commit(cwd, from_hash)?;
    let to_hash = resolve_commit(cwd, to_hash)?;
    let merge_base = run_git(&["merge-base", &from_hash, &to_hash], cwd)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let files = git_change_files(cwd, Some(&from_hash), Some(&to_hash));
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
    let from_hash = resolve_commit(cwd, from_hash)?;
    let mut files = git_change_files(cwd, Some(&from_hash), None);
    let mut seen: HashSet<String> = files.iter().map(|file| file.path.clone()).collect();
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
    git_status(cwd, true)
}

fn git_status(cwd: &str, include_stats: bool) -> Option<GitStatusResult> {
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

        for (status, staged) in [(x, true), (y, false)] {
            if status == ' ' || (status == '?' && (staged || x != '?')) {
                continue;
            }
            files.push(GitFileEntry {
                status: status.to_string(),
                staged,
                path: actual_path.clone(),
                original_path: if status == '?' {
                    None
                } else {
                    original_path.clone()
                },
                additions: None,
                deletions: None,
            });
        }
    }

    let name = cwd.rsplit('/').next().unwrap_or(cwd).to_string();
    let diff_stats = get_working_tree_numstat(
        cwd,
        include_stats && files.iter().any(|file| !file.staged && file.status != "?"),
        include_stats && files.iter().any(|file| file.staged),
    );
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
        files,
    })
}

fn get_working_tree_numstat(
    cwd: &str,
    unstaged: bool,
    staged: bool,
) -> HashMap<String, (usize, usize)> {
    match (unstaged, staged) {
        (false, false) => return HashMap::new(),
        (true, false) => return get_numstat_entries(cwd, false),
        (false, true) => return get_numstat_entries(cwd, true),
        (true, true) => {}
    }
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
    let args = if staged {
        ["diff", "--cached", "--numstat"].as_slice()
    } else {
        ["diff", "--numstat"].as_slice()
    };
    let prefix = if staged { "staged" } else { "unstaged" };
    parse_numstat(&run_git(args, cwd).unwrap_or_default())
        .into_iter()
        .map(|(path, counts)| (format!("{prefix}:{path}"), counts))
        .collect()
}

fn parse_numstat(output: &str) -> HashMap<String, (usize, usize)> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let added = fields.next()?.parse().unwrap_or(0);
            let removed = fields.next()?.parse().unwrap_or(0);
            Some((
                normalize_numstat_path(fields.next_back()?),
                (added, removed),
            ))
        })
        .collect()
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
    get_graph_refs_with_worktrees(cwd, &get_git_worktrees(cwd))
}

fn get_graph_refs_with_worktrees(
    cwd: &str,
    worktrees: &[GitWorktree],
) -> HashMap<String, Vec<GitGraphRef>> {
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
                label: remote_name
                    .as_ref()
                    .and_then(|remote| display_name.strip_prefix(&format!("{remote}/")))
                    .unwrap_or(&display_name)
                    .to_owned(),
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
            let label = format!("HEAD detached at {}", &target[..target.len().min(7)]);
            refs_by_target
                .entry(target.clone())
                .or_default()
                .push(GitGraphRef {
                    full_name: "HEAD".to_string(),
                    display_name: label.clone(),
                    label,
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

fn parse_graph_record(
    record: &str,
    refs_by_target: &HashMap<String, Vec<GitGraphRef>>,
) -> GraphCommit {
    let mut parts = record.splitn(11, '\x1f');
    let hash = parts.next().unwrap_or("").to_string();
    GraphCommit {
        refs: refs_by_target.get(&hash).cloned().unwrap_or_default(),
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
        ..Default::default()
    }
}

/// A stash commit is a presentation item; its second and optional third
/// parents are implementation commits for the index and untracked files.
/// Keep the base parent so the stash remains attached to history, but do not
/// expose those plumbing commits as ordinary rows.
fn collapse_stash_internal_commits(commits: &mut Vec<GraphCommit>, stashes: &[GitStash]) {
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

pub struct GitGraphInput {
    pub worktrees: Vec<GitWorktree>,
    pub revision: String,
    pub operation: GitRepositoryOperationState,
    refs_by_target: HashMap<String, Vec<GitGraphRef>>,
}

pub fn prepare_git_graph(cwd: &str) -> GitGraphInput {
    let mut worktrees = get_git_worktrees(cwd);
    let operation = get_git_repository_operation_state(cwd);
    let refs_by_target = get_graph_refs_with_worktrees(cwd, &worktrees);
    let ordered_refs = refs_by_target
        .iter()
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut parts = vec![
        serde_json::to_string(&ordered_refs).unwrap_or_default(),
        format!("{operation:?}"),
    ];
    for worktree in &mut worktrees {
        if !worktree.bare && (!worktree.locked || worktree.is_current) {
            worktree.status = get_git_status(&worktree.path);
            if let Some(status) = &worktree.status {
                for file in &status.files {
                    // Status letters/counts alone do not identify edits to an
                    // already-modified file. Include its filesystem generation.
                    let path = std::path::Path::new(&worktree.path).join(&file.path);
                    parts.push(format!(
                        "{}:{:?}",
                        path.display(),
                        std::fs::metadata(path.clone())
                            .ok()
                            .map(|m| (m.len(), m.modified().ok()))
                    ));
                }
            }
        }
    }
    parts.push(serde_json::to_string(&worktrees).unwrap_or_default());
    GitGraphInput {
        worktrees,
        revision: stable_revision_token(&parts),
        operation,
        refs_by_target,
    }
}

pub fn get_git_graph_snapshot_with_query(
    cwd: &str,
    limit: usize,
    input: GitGraphInput,
    query: &str,
) -> GitGraphSnapshot {
    let (state, state_error) = repository_snapshot_state(cwd);
    if matches!(
        state,
        GitRepositorySnapshotState::NonRepository | GitRepositorySnapshotState::CommandFailed
    ) {
        return GitGraphSnapshot {
            ancestry: GraphAncestry::default(),
            commits: Vec::new(),
            rows: Vec::new(),
            has_more: false,
            worktrees: Vec::new(),
            stashes: Vec::new(),
            revision: stable_revision_token(&[cwd.to_string()]),
            operation: input.operation,
            state,
            state_error,
        };
    }
    let worktrees = input.worktrees;
    let stashes = get_git_stashes(cwd);
    let requested_history = limit
        .saturating_add(1)
        .saturating_add(stashes.len().saturating_mul(2));
    let history_matches =
        match graph_semantics::read_history(cwd, requested_history, query, input.refs_by_target) {
            Ok(commits) => commits,
            Err(error) => {
                eprintln!("[git-graph] {error}");
                return GitGraphSnapshot {
                    ancestry: GraphAncestry::default(),
                    commits: Vec::new(),
                    rows: Vec::new(),
                    has_more: false,
                    worktrees,
                    stashes,
                    revision: stable_revision_token(&[cwd.to_string(), error.clone()]),
                    operation: input.operation,
                    state: GitRepositorySnapshotState::CommandFailed,
                    state_error: Some(error),
                };
            }
        };
    let history_order: HashMap<_, _> = history_matches
        .iter()
        .map(|(commit, order)| (commit.hash.clone(), *order))
        .collect();
    let mut semantic_commits: Vec<_> = history_matches
        .into_iter()
        .map(|(commit, _)| commit)
        .collect();
    collapse_stash_internal_commits(&mut semantic_commits, &stashes);
    let has_more = semantic_commits.len() > limit;
    semantic_commits.truncate(limit);

    // A worktree's index and working directory are not commits. Insert a
    // synthetic child immediately before its real HEAD so it participates in
    // the same deterministic lane layout without ever masquerading as an OID.
    for worktree in worktrees.iter().rev().filter(|_| query.trim().is_empty()) {
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
            GraphCommit {
                hash: identity,
                message: "Uncommitted changes".to_string(),

                author: "Workspace".to_string(),

                committer: "Workspace".to_string(),

                date: "Now".to_string(),

                parents: (!worktree.head.is_empty()
                    && !worktree.head.bytes().all(|byte| byte == b'0'))
                .then(|| worktree.head.clone())
                .into_iter()
                .collect(),

                ..Default::default()
            },
        );
    }

    let (mut commits, rows) = layout_graph(semantic_commits);
    let stash_names = stashes
        .iter()
        .map(|stash| (stash.hash.as_str(), stash.name.as_str()))
        .collect::<HashMap<_, _>>();
    for commit in &mut commits {
        commit.navigation.history_order = history_order.get(&commit.hash).copied();
        if let Some(stash_name) = stash_names.get(commit.hash.as_str()) {
            commit.id = format!("stash:{stash_name}");
            commit.item_kind = GitGraphItemKind::Stash;
            commit.stash_name = Some((*stash_name).to_string());
        }
    }
    let ancestry = graph_semantics::prepare(&mut commits);
    GitGraphSnapshot {
        ancestry,
        commits,
        rows,
        has_more,
        worktrees,
        stashes,
        revision: input.revision,
        operation: input.operation,
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

    fn assign_column(&mut self, commit: &GraphCommit) -> usize {
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

fn layout_graph(mut commits: Vec<GraphCommit>) -> (Vec<GraphCommit>, Vec<GraphRow>) {
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
    let mut graph_rows = Vec::with_capacity(commits.len());

    for (row_index, commit) in commits.iter_mut().enumerate() {
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

        commit.navigation = GraphNavigation::default();
        commit.id = id;
        commit.item_kind = item_kind;
        commit.hash = hash;
        commit.worktree_path = worktree_path;
        commit.stash_name = None;
        commit.column = commit_column;
        commit.color_index = commit_color;
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

    (commits, graph_rows)
}
