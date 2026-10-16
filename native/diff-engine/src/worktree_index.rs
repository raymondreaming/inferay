// A disposable index lets Git count new files and detect unstaged renames
// without staging anything in the user's index. Git retains ownership of text,
// binary, symlink and attribute semantics.
use super::{git_exec, run_git, GitFileEntry};
use std::time::Duration;

pub(super) struct WorktreeIndex {
    directory: tempfile::TempDir,
    pub pairs: Vec<(String, String)>,
}

impl WorktreeIndex {
    pub fn for_status(cwd: &str, files: &[GitFileEntry], include_stats: bool) -> Option<Self> {
        let detect_renames = files.iter().any(|file| !file.staged && file.status == "D");
        if (!include_stats && !detect_renames) || !files.iter().any(|file| file.status == "?") {
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
        if !detect_renames {
            return Some(result);
        }
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
        match std::fs::copy(
            std::path::Path::new(cwd).join(index.trim()),
            directory.path().join("index"),
        ) {
            Ok(_) => {}
            // A new repository may not have an index yet. Git creates only our
            // disposable index when admitting the untracked paths below.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return None,
        }
        let result = Self {
            directory,
            pairs: Vec::new(),
        };
        let pathspec = result.directory.path().join("paths");
        std::fs::write(&pathspec, paths.join("\0")).ok()?;
        result.git(
            cwd,
            &[
                "--literal-pathspecs",
                "add",
                "--intent-to-add",
                "--pathspec-file-nul",
                "--pathspec-from-file",
                pathspec.to_str()?,
            ],
        )?;
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
    fn large_untracked_batches_preserve_literal_paths_and_the_real_index() {
        let root = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "-q"]);
        std::fs::write(root.path().join("tracked"), "staged\n").unwrap();
        git(root.path(), &["add", "tracked"]);
        let original_index = std::fs::read(root.path().join(".git/index")).unwrap();
        // Together these paths exceed typical command-line argument limits.
        let prefix = "x".repeat(230);
        let mut paths: Vec<_> = (0..1200).map(|i| format!("{prefix}-{i}")).collect();
        paths.extend(["-option", ":(glob)*", "line\nbreak", "quote\"'"].map(str::to_owned));
        for path in &paths {
            std::fs::write(root.path().join(path), "first\nsecond").unwrap();
        }
        let status = get_git_status(root.path().to_str().unwrap()).unwrap();
        let untracked: std::collections::HashSet<_> = status
            .files
            .iter()
            .filter(|file| file.status == "?")
            .map(|file| {
                assert!(!file.staged);
                assert_eq!((file.additions, file.deletions), (Some(2), Some(0)));
                file.path.clone()
            })
            .collect();
        assert_eq!(untracked, paths.into_iter().collect());
        assert_eq!(
            std::fs::read(root.path().join(".git/index")).unwrap(),
            original_index
        );
    }

    #[test]
    fn new_files_contribute_git_line_counts_without_changing_the_real_index() {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().to_str().unwrap();
        git(root.path(), &["init", "-q"]);
        std::fs::write(root.path().join("new file.txt"), "first\nsecond").unwrap();
        std::fs::write(root.path().join("empty.txt"), "").unwrap();
        std::fs::write(root.path().join("image.bin"), b"a\0b\n").unwrap();
        std::fs::write(root.path().join("opaque.dat"), "looks like text\n").unwrap();
        std::fs::write(root.path().join(".gitattributes"), "*.dat binary\n").unwrap();
        std::fs::write(root.path().join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(root.path().join("ignored.txt"), "not a change\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("new file.txt", root.path().join("link")).unwrap();
        let status = get_git_status(cwd).unwrap();
        assert!(!root.path().join(".git/index").exists());
        let counts = |path: &str| {
            let file = status.files.iter().find(|file| file.path == path).unwrap();
            assert_eq!(file.status, "?");
            assert!(!file.staged);
            (file.additions.unwrap_or(0), file.deletions.unwrap_or(0))
        };
        assert_eq!(counts("new file.txt"), (2, 0));
        assert_eq!(counts("empty.txt"), (0, 0));
        assert_eq!(counts("image.bin"), (0, 0));
        assert_eq!(counts("opaque.dat"), (0, 0));
        #[cfg(unix)]
        assert_eq!(counts("link"), (1, 0));
        assert!(!status.files.iter().any(|file| file.path == "ignored.txt"));

        git(root.path(), &["add", "."]);
        git(
            root.path(),
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "base",
            ],
        );
        std::fs::write(root.path().join("new file.txt"), "replacement\n").unwrap();
        git(root.path(), &["add", "new file.txt"]);
        std::fs::write(root.path().join("new file.txt"), "replacement\nunstaged\n").unwrap();
        std::fs::write(root.path().join("another.txt"), "one\ntwo\nthree\n").unwrap();
        let index_before = std::fs::read(root.path().join(".git/index")).unwrap();
        let status = get_git_status(cwd).unwrap();
        assert_eq!(
            std::fs::read(root.path().join(".git/index")).unwrap(),
            index_before
        );
        assert_eq!(
            status
                .files
                .iter()
                .map(|file| file.additions.unwrap_or(0))
                .sum::<usize>(),
            5
        );
        assert_eq!(
            status
                .files
                .iter()
                .map(|file| file.deletions.unwrap_or(0))
                .sum::<usize>(),
            2
        );
        let new_file = status
            .files
            .iter()
            .find(|file| file.path == "another.txt")
            .unwrap();
        assert_eq!((new_file.additions, new_file.deletions), (Some(3), Some(0)));
        assert!(status
            .file_groups
            .untracked
            .iter()
            .any(|file| file.path == "another.txt" && file.additions == Some(3)));
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
