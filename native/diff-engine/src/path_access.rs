//! Filesystem access for repository reads, separate from pure containment policy.
use inferay_core::path_security::AllowedPaths;
use std::path::{Path, PathBuf};

pub(crate) fn resolve_real_allowed_local_path(
    allowed: &AllowedPaths,
    path: impl AsRef<Path>,
) -> Option<PathBuf> {
    let resolved = allowed.resolve_allowed_local_path(path)?;
    let real = resolved.canonicalize().ok()?;
    allowed.is_allowed_local_path(&real).then_some(real)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_paths_must_exist_and_stay_inside_the_allowed_roots() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("repo")).unwrap();
        std::fs::write(root.join("repo/file"), "inside").unwrap();
        std::fs::write(root.join("outside"), "outside").unwrap();
        let allowed = AllowedPaths::new("repo", "home", &root).unwrap();
        assert_eq!(
            resolve_real_allowed_local_path(&allowed, "repo/file"),
            Some(root.join("repo/file"))
        );
        assert!(resolve_real_allowed_local_path(&allowed, "repo/missing").is_none());
        assert!(resolve_real_allowed_local_path(&allowed, "outside").is_none());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("outside"), root.join("repo/escape")).unwrap();
            std::os::unix::fs::symlink(root.join("repo/file"), root.join("repo/inside")).unwrap();
            assert!(resolve_real_allowed_local_path(&allowed, "repo/escape").is_none());
            assert_eq!(
                resolve_real_allowed_local_path(&allowed, "repo/inside"),
                Some(root.join("repo/file"))
            );
        }
    }
}
