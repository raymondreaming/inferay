use super::{git_exec, run_git, GitFileEntry};
use std::time::Duration;

/// Intent-to-add entries expose untracked destinations to Git's own rename
/// detector. Only this disposable index is changed, never the user's index.
pub(super) struct WorktreeRenames {
    directory: tempfile::TempDir,
    pub pairs: Vec<(String, String)>,
}

impl WorktreeRenames {
    pub fn read(cwd: &str, files: &[GitFileEntry]) -> Option<Self> {
        if !files.iter().any(|file| !file.staged && file.status == "D")
            || !files.iter().any(|file| file.status == "?")
        {
            return None;
        }
        let mut result = Self::prepare(
            cwd,
            &files
                .iter()
                .filter(|file| file.status == "?")
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
        )?;
        let output = result.git(
            cwd,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--find-renames",
                "--name-status",
                "-z",
            ],
        )?;
        let mut fields = output.split('\0');
        while let Some(status) = fields.next().filter(|status| !status.is_empty()) {
            let old = fields.next()?;
            if status.starts_with('R') || status.starts_with('C') {
                let new = fields.next()?;
                if status.starts_with('R')
                    && files
                        .iter()
                        .any(|file| !file.staged && file.status == "D" && file.path == old)
                    && files
                        .iter()
                        .any(|file| file.status == "?" && file.path == new)
                {
                    result.pairs.push((old.to_owned(), new.to_owned()));
                }
            }
        }
        Some(result)
    }

    pub fn prepare(cwd: &str, paths: &[&str]) -> Option<Self> {
        let directory = tempfile::tempdir().ok()?;
        let index = run_git(&["rev-parse", "--git-path", "index"], cwd)?;
        std::fs::copy(
            std::path::Path::new(cwd).join(index.trim()),
            directory.path().join("index"),
        )
        .ok()?;
        let result = Self {
            directory,
            pairs: Vec::new(),
        };
        for paths in paths.chunks(100) {
            let mut args = vec!["--literal-pathspecs", "add", "--intent-to-add", "--"];
            args.extend_from_slice(paths);
            result.git(cwd, &args)?;
        }
        Some(result)
    }

    pub fn git(&self, cwd: &str, args: &[&str]) -> Option<String> {
        git_exec::run_git_bytes_with_index(
            args,
            cwd,
            Duration::from_secs(10),
            Some(&self.directory.path().join("index")),
        )
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use crate::{get_git_hunk_diff, get_git_status, stage_git, unstage_git};
    use inferay_core::path_security::AllowedPaths;
    use std::path::Path;

    fn git(root: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn unstaged_renames_keep_counts_diffs_and_staging_consistent() {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().to_str().unwrap();
        git(root.path(), &["init", "-q"]);
        git(root.path(), &["config", "user.name", "Fixture"]);
        git(
            root.path(),
            &["config", "user.email", "fixture@example.invalid"],
        );
        let content = (0..40)
            .map(|line| format!("original line {line}\n"))
            .collect::<String>();
        for index in 0..19 {
            std::fs::write(
                root.path().join(format!("file{index}.txt")),
                format!("{index}\n{content}"),
            )
            .unwrap();
        }
        git(root.path(), &["add", "."]);
        git(
            root.path(),
            &["-c", "commit.gpgsign=false", "commit", "-qm", "base"],
        );
        let destinations = [
            "renamed.txt",
            "with -> arrow.txt",
            "unicode é\n[brackets].txt",
        ];
        for (index, destination) in destinations.iter().enumerate() {
            std::fs::rename(
                root.path().join(format!("file{index}.txt")),
                root.path().join(destination),
            )
            .unwrap();
        }
        for index in 3..19 {
            std::fs::write(
                root.path().join(format!("file{index}.txt")),
                format!("{index}\n{content}changed\n"),
            )
            .unwrap();
        }
        std::fs::write(
            root.path().join(destinations[0]),
            format!("0\n{content}edited after move\n"),
        )
        .unwrap();
        // A separately staged edit must survive every read and per-file operation.
        git(root.path(), &["add", "file18.txt"]);
        let index_before = std::fs::read(root.path().join(".git/index")).unwrap();
        let status = get_git_status(cwd).unwrap();
        assert_eq!(status.files.len(), 19);
        assert_eq!(
            std::fs::read(root.path().join(".git/index")).unwrap(),
            index_before
        );
        for (index, destination) in destinations.iter().enumerate() {
            let file = status
                .files
                .iter()
                .find(|file| file.path == *destination)
                .unwrap();
            assert_eq!(file.status, "R");
            assert!(!file.staged);
            assert_eq!(file.additions, Some(usize::from(index == 0)));
            assert_eq!(file.deletions, Some(0));
            assert_eq!(
                file.original_path.as_deref(),
                Some(format!("file{index}.txt").as_str())
            );
        }
        let canonical = root.path().canonicalize().unwrap();
        let allowed = AllowedPaths::new(&canonical, &canonical, &canonical).unwrap();
        let cwd = canonical.to_str().unwrap();
        let diff = get_git_hunk_diff(&allowed, cwd, destinations[0], false);
        assert!(!diff.is_new);
        assert!(diff.raw_patch.unwrap().contains("rename from file0.txt"));
        assert!(!diff.old_lines.is_empty());
        assert_eq!(
            std::fs::read(root.path().join(".git/index")).unwrap(),
            index_before
        );
        assert!(stage_git(cwd, Some(destinations[0])));
        let status = get_git_status(cwd).unwrap();
        assert_eq!(status.files.len(), 19);
        assert!(status
            .files
            .iter()
            .any(|file| file.path == destinations[0] && file.staged && file.status == "R"));
        let diff = get_git_hunk_diff(&allowed, cwd, destinations[0], true);
        assert!(!diff.is_new);
        assert!(!diff.old_lines.is_empty());
        assert!(unstage_git(cwd, Some(destinations[0])));
        assert_eq!(get_git_status(cwd).unwrap().files.len(), 19);
        assert!(get_git_status(cwd)
            .unwrap()
            .files
            .iter()
            .any(|file| file.path == "file18.txt" && file.staged));
        for destination in &destinations[1..] {
            assert!(stage_git(cwd, Some(destination)));
            assert_eq!(get_git_status(cwd).unwrap().files.len(), 19);
            assert!(unstage_git(cwd, Some(destination)));
            assert_eq!(get_git_status(cwd).unwrap().files.len(), 19);
        }
        assert!(stage_git(cwd, None));
        let staged = get_git_status(cwd).unwrap();
        assert_eq!(staged.files.len(), 19);
        assert!(staged.files.iter().all(|file| file.staged));
        assert_eq!(
            staged
                .files
                .iter()
                .filter(|file| file.status == "R")
                .count(),
            3
        );
        assert!(unstage_git(cwd, None));
        assert_eq!(get_git_status(cwd).unwrap().files.len(), 19);
        std::fs::remove_file(root.path().join("file17.txt")).unwrap();
        std::fs::write(root.path().join("unrelated.txt"), "entirely different\n").unwrap();
        let status = get_git_status(cwd).unwrap();
        assert_eq!(status.files.len(), 20);
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "unrelated.txt" && file.status == "?"));
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "file17.txt" && file.status == "D"));
    }
}
