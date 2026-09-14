use inferay_core::path_security::{
    AllowedPaths, is_safe_relative_path, is_within_directory, resolve_lexically,
};
use std::path::{Path, PathBuf};

fn base() -> PathBuf {
    PathBuf::from(if cfg!(windows) {
        r"C:\path-policy-fixture"
    } else {
        "/path-policy-fixture"
    })
}

#[test]
fn relative_paths_use_only_the_supplied_working_directory() {
    let base = base();
    assert_eq!(
        resolve_lexically(Path::new("repo/../home/file"), &base).unwrap(),
        base.join("home/file")
    );
    assert!(resolve_lexically(Path::new("file"), Path::new("relative-base")).is_err());
    assert_eq!(
        resolve_lexically(&base.join("file"), Path::new("")).unwrap(),
        base.join("file")
    );
    let allowed = AllowedPaths::new("repo", "home", &base).unwrap();
    assert_eq!(allowed.project_root(), base.join("repo"));
    assert!(allowed.is_allowed_local_path("repo/missing/file"));
    assert!(allowed.is_allowed_local_path("home/file"));
    assert!(!allowed.is_allowed_local_path("repo-other/file"));
    assert!(!allowed.is_allowed_local_path("repo/../../outside"));
}

#[test]
fn child_paths_cannot_escape_their_parent_or_use_ambient_resolution() {
    let base = base();
    let allowed = AllowedPaths::new("repo", "home", &base).unwrap();
    assert_eq!(
        allowed.resolve_allowed_child_path("repo", "src/file.rs"),
        Some(base.join("repo/src/file.rs"))
    );
    for path in [
        "",
        "..",
        "../file",
        "src/../../file",
        r"src\..\file",
        "file\0name",
    ] {
        assert!(!is_safe_relative_path(path));
        assert!(allowed.resolve_allowed_child_path("repo", path).is_none());
    }
    assert!(!is_within_directory("relative", &base));
    assert!(!is_within_directory(
        base.join("repo-other"),
        base.join("repo")
    ));
    assert!(is_within_directory(
        base.join("repo/./src/../file"),
        base.join("repo")
    ));
}
