use chrono::{Local, TimeZone};
use inferay_core::path_security::{is_safe_relative_path, AllowedPaths};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

const BRANCH_COLORS: [&str; 8] = [
    "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#eab308", "#14b8a6", "#f97316", "#ef4444",
];

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
pub struct GitCheckoutResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
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
pub struct GitCommitFile {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GitCommitDetails {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
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
    author: String,
    author_email: String,
    date: String,
    parents: Vec<String>,
    refs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub author_avatar_url: String,
    pub date: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub column: usize,
    pub color: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRail {
    pub column: usize,
    pub color: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTransition {
    pub from_column: usize,
    pub to_column: usize,
    pub color: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    pub row: usize,
    pub rails: Vec<GraphRail>,
    pub transitions: Vec<GraphTransition>,
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

pub fn checkout_git_branch(cwd: &str, branch_name: &str) -> GitCheckoutResult {
    if !get_git_branches(cwd)
        .iter()
        .any(|branch| branch.name == branch_name)
    {
        return GitCheckoutResult {
            ok: false,
            branch: None,
            error: Some("Branch not found".to_string()),
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
                error: Some(format!("Unable to checkout {branch_name}")),
            };
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return GitCheckoutResult {
            ok: false,
            branch: None,
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
        error: None,
    }
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

pub fn get_git_commit_details(cwd: &str, hash: &str) -> Option<GitCommitDetails> {
    let info = run_git(&["log", "-1", "--format=%H|%s|%an|%ar", hash], cwd)?;
    if info.is_empty() {
        return None;
    }
    let mut info_parts = info.trim().split('|');
    let full_hash = info_parts.next().unwrap_or("").to_string();
    let message = info_parts.next().unwrap_or("").to_string();
    let author = info_parts.next().unwrap_or("").to_string();
    let date = info_parts.next().unwrap_or("").to_string();

    let mut stats = HashMap::<String, (usize, usize)>::new();
    if let Some(result) = run_git(
        &["diff-tree", "--no-commit-id", "-r", "--numstat", hash],
        cwd,
    ) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                stats.insert(
                    parts[2].to_string(),
                    (parse_numstat_count(parts[0]), parse_numstat_count(parts[1])),
                );
            }
        }
    }

    let mut files = Vec::new();
    if let Some(result) = run_git(
        &["diff-tree", "--no-commit-id", "-r", "--name-status", hash],
        cwd,
    ) {
        for line in result.lines().filter(|line| !line.is_empty()) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                let path = parts[parts.len() - 1].to_string();
                let status = parts[0].chars().next().unwrap_or('\0').to_string();
                let (additions, deletions) = stats.get(&path).copied().unwrap_or_default();
                files.push(GitCommitFile {
                    path,
                    status,
                    additions,
                    deletions,
                });
            }
        }
    }

    Some(GitCommitDetails {
        hash: full_hash,
        message,
        author,
        date,
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

fn get_graph_log(cwd: &str, limit: usize) -> Vec<GitCommit> {
    let limit_arg = format!("--max-count={}", limit);
    let raw = match run_git(
        &[
            "log",
            &limit_arg,
            "--topo-order",
            "--format=%h\x1f%p\x1f%D\x1f%s\x1f%an\x1f%ae\x1f%ar",
            "--exclude=refs/stash",
            "--all",
        ],
        cwd,
    ) {
        Some(raw) => raw,
        None => return Vec::new(),
    };

    raw.lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut parts = line.split('\x1f');
            GitCommit {
                hash: parts.next().unwrap_or("").to_string(),
                parents: parts
                    .next()
                    .unwrap_or("")
                    .split(' ')
                    .filter(|part| !part.is_empty())
                    .map(|part| part.to_string())
                    .collect(),
                refs: parts
                    .next()
                    .unwrap_or("")
                    .split(',')
                    .map(|part| part.trim())
                    .filter(|part| !part.is_empty())
                    .map(|part| part.to_string())
                    .collect(),
                message: parts.next().unwrap_or("").to_string(),
                author: parts.next().unwrap_or("").to_string(),
                author_email: parts.next().unwrap_or("").to_string(),
                date: parts.next().unwrap_or("").to_string(),
            }
        })
        .collect()
}

pub fn get_git_graph(cwd: &str, limit: usize) -> (Vec<GraphCommit>, Vec<GraphRow>) {
    layout_graph(&get_graph_log(cwd, limit))
}

fn gravatar_url(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    let digest = md5::compute(normalized.as_bytes());
    format!(
        "https://www.gravatar.com/avatar/{:x}?d=identicon&s=32",
        digest
    )
}

#[derive(Clone)]
struct ActiveLane {
    hash: String,
    color: String,
}

fn color_for_hash(
    hash: &str,
    preferred: Option<&str>,
    hash_colors: &mut HashMap<String, String>,
    next_color_index: &mut usize,
) -> String {
    if let Some(existing) = hash_colors.get(hash) {
        return existing.clone();
    }

    let color = preferred.map(ToOwned::to_owned).unwrap_or_else(|| {
        let color = BRANCH_COLORS[*next_color_index % BRANCH_COLORS.len()].to_string();
        *next_color_index += 1;
        color
    });

    hash_colors.insert(hash.to_string(), color.clone());
    color
}

fn layout_graph(commits: &[GitCommit]) -> (Vec<GraphCommit>, Vec<GraphRow>) {
    let mut active_lanes: Vec<ActiveLane> = Vec::new();
    let mut hash_colors = HashMap::<String, String>::new();
    let mut next_color_index = 0usize;
    let mut graph_commits = Vec::with_capacity(commits.len());
    let mut graph_rows = Vec::with_capacity(commits.len());

    for (row_index, commit) in commits.iter().enumerate() {
        let commit_color =
            color_for_hash(&commit.hash, None, &mut hash_colors, &mut next_color_index);

        let commit_column = active_lanes
            .iter()
            .position(|lane| lane.hash == commit.hash)
            .unwrap_or_else(|| {
                active_lanes.push(ActiveLane {
                    hash: commit.hash.clone(),
                    color: commit_color.clone(),
                });
                active_lanes.len() - 1
            });

        if active_lanes[commit_column].color != commit_color {
            active_lanes[commit_column].color = commit_color.clone();
        }

        let rails = active_lanes
            .iter()
            .enumerate()
            .map(|(column, lane)| GraphRail {
                column,
                color: lane.color.clone(),
            })
            .collect::<Vec<_>>();

        graph_commits.push(GraphCommit {
            hash: commit.hash.clone(),
            message: commit.message.clone(),
            author: commit.author.clone(),
            author_email: commit.author_email.clone(),
            author_avatar_url: gravatar_url(&commit.author_email),
            date: commit.date.clone(),
            parents: commit.parents.clone(),
            refs: commit.refs.clone(),
            column: commit_column,
            color: commit_color.clone(),
        });

        let mut next_lanes = active_lanes
            .iter()
            .cloned()
            .map(Some)
            .collect::<Vec<Option<ActiveLane>>>();
        next_lanes[commit_column] = None;
        let mut explicit_transitions: Vec<(String, usize)> = Vec::new();

        if let Some(first_parent) = commit.parents.first() {
            let first_parent_color = color_for_hash(
                first_parent,
                Some(&commit_color),
                &mut hash_colors,
                &mut next_color_index,
            );
            let existing_first_parent_column = next_lanes
                .iter()
                .position(|lane| lane.as_ref().is_some_and(|lane| lane.hash == *first_parent));

            if let Some(existing_column) = existing_first_parent_column {
                if existing_column != commit_column {
                    explicit_transitions.push((first_parent.clone(), commit_column));
                }
            } else {
                next_lanes[commit_column] = Some(ActiveLane {
                    hash: first_parent.clone(),
                    color: first_parent_color,
                });
            }
        }

        for parent in commit.parents.iter().skip(1) {
            if next_lanes
                .iter()
                .any(|lane| lane.as_ref().is_some_and(|lane| lane.hash == *parent))
            {
                continue;
            }

            let parent_color =
                color_for_hash(parent, None, &mut hash_colors, &mut next_color_index);
            let insert_at = (commit_column + 1).min(next_lanes.len());
            next_lanes.insert(
                insert_at,
                Some(ActiveLane {
                    hash: parent.clone(),
                    color: parent_color,
                }),
            );
            explicit_transitions.push((parent.clone(), commit_column));
        }

        let mut next_active_lanes = Vec::with_capacity(next_lanes.len());
        let mut next_positions = HashMap::<String, usize>::new();
        for lane in next_lanes.into_iter().flatten() {
            let next_column = next_active_lanes.len();
            next_positions.insert(lane.hash.clone(), next_column);
            next_active_lanes.push(lane);
        }

        let mut transitions = Vec::new();

        for (column, lane) in active_lanes.iter().enumerate() {
            if let Some(next_column) = next_positions.get(&lane.hash).copied() {
                if next_column != column {
                    transitions.push(GraphTransition {
                        from_column: column,
                        to_column: next_column,
                        color: lane.color.clone(),
                    });
                }
            }
        }

        for (target_hash, from_column) in explicit_transitions {
            if let Some(next_column) = next_positions.get(&target_hash).copied() {
                transitions.push(GraphTransition {
                    from_column,
                    to_column: next_column,
                    color: hash_colors
                        .get(&target_hash)
                        .cloned()
                        .unwrap_or_else(|| commit_color.clone()),
                });
            }
        }

        transitions.sort_by_key(|transition| (transition.from_column, transition.to_column));
        transitions.dedup_by(|a, b| {
            a.from_column == b.from_column && a.to_column == b.to_column && a.color == b.color
        });

        graph_rows.push(GraphRow {
            row: row_index,
            rails,
            transitions,
        });

        active_lanes = next_active_lanes;
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
        let response = execute_request(NativeRequest::GitStatuses {
            cwds: vec![std::env::temp_dir().to_string_lossy().into_owned()],
        });

        match response {
            NativeResponse::GitStatuses { projects } => assert!(projects.is_empty()),
            _ => panic!("expected git statuses response"),
        }
    }

    #[test]
    fn graph_layout_is_deterministic_for_a_branch_and_merge() {
        let commits = vec![
            GitCommit {
                hash: "merge".into(),
                message: "merge branch".into(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                date: "now".into(),
                parents: vec!["main".into(), "branch".into()],
                refs: vec!["HEAD -> main".into()],
            },
            GitCommit {
                hash: "branch".into(),
                message: "branch work".into(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                date: "earlier".into(),
                parents: vec!["base".into()],
                refs: vec![],
            },
            GitCommit {
                hash: "main".into(),
                message: "main work".into(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                date: "earlier".into(),
                parents: vec!["base".into()],
                refs: vec![],
            },
            GitCommit {
                hash: "base".into(),
                message: "base".into(),
                author: "Ray".into(),
                author_email: "ray@example.com".into(),
                date: "old".into(),
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
