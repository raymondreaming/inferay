use std::ffi::OsStr;
use std::io;
use std::path::{Component, Path, PathBuf};

/// The local roots that Inferay is permitted to expose to application services.
///
/// Keeping the roots explicit makes the security boundary deterministic and
/// testable. The desktop/server adapter is responsible for supplying the project
/// root and the current user's home directory.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AllowedPaths {
    project_root: PathBuf,
    home_directory: PathBuf,
}

impl AllowedPaths {
    pub fn new(
        project_root: impl AsRef<Path>,
        home_directory: impl AsRef<Path>,
    ) -> io::Result<Self> {
        Ok(Self {
            project_root: resolve_lexically(project_root.as_ref())?,
            home_directory: resolve_lexically(home_directory.as_ref())?,
        })
    }

    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn home_directory(&self) -> &Path {
        &self.home_directory
    }

    /// Mirrors the existing TypeScript boundary: a path is allowed when its
    /// lexical resolution is inside either the application root or user home.
    pub fn is_allowed_local_path(&self, pathname: impl AsRef<Path>) -> bool {
        let Ok(pathname) = resolve_lexically(pathname.as_ref()) else {
            return false;
        };

        is_resolved_within_directory(&pathname, &self.project_root)
            || is_resolved_within_directory(&pathname, &self.home_directory)
    }

    pub fn resolve_allowed_local_path(&self, pathname: impl AsRef<Path>) -> Option<PathBuf> {
        let resolved = resolve_lexically(pathname.as_ref()).ok()?;
        self.is_allowed_local_path(&resolved).then_some(resolved)
    }

    /// Resolves symlinks and requires the resulting filesystem path to remain
    /// inside an allowed root. Missing or inaccessible paths are rejected.
    pub fn resolve_real_allowed_local_path(&self, pathname: impl AsRef<Path>) -> Option<PathBuf> {
        let resolved = self.resolve_allowed_local_path(pathname)?;
        let real = resolved.canonicalize().ok()?;
        self.is_allowed_local_path(&real).then_some(real)
    }

    pub fn resolve_allowed_child_path(
        &self,
        directory: impl AsRef<Path>,
        pathname: &str,
    ) -> Option<PathBuf> {
        if !is_safe_relative_path(pathname) {
            return None;
        }

        let directory = self.resolve_allowed_local_path(directory)?;
        let resolved = resolve_lexically(&directory.join(pathname)).ok()?;
        is_resolved_within_directory(&resolved, &directory).then_some(resolved)
    }
}

/// Lexically checks containment after resolving relative paths against the
/// process working directory. Files do not need to exist.
pub fn is_within_directory(pathname: impl AsRef<Path>, directory: impl AsRef<Path>) -> bool {
    let (Ok(pathname), Ok(directory)) = (
        resolve_lexically(pathname.as_ref()),
        resolve_lexically(directory.as_ref()),
    ) else {
        return false;
    };

    is_resolved_within_directory(&pathname, &directory)
}

/// Preserves the existing route contract: reject empty, NUL-containing,
/// absolute, or parent-traversing child paths, while accepting both slash styles.
pub fn is_safe_relative_path(pathname: &str) -> bool {
    !pathname.is_empty()
        && !pathname.contains('\0')
        && !Path::new(pathname).is_absolute()
        && !pathname
            .split(['/', '\\'])
            .any(|component| component == "..")
}

fn is_resolved_within_directory(pathname: &Path, directory: &Path) -> bool {
    pathname == directory || pathname.strip_prefix(directory).is_ok()
}

pub fn resolve_lexically(pathname: &Path) -> io::Result<PathBuf> {
    let absolute = if pathname.is_absolute() {
        pathname.to_path_buf()
    } else {
        std::env::current_dir()?.join(pathname)
    };

    Ok(normalize_absolute_path(&absolute))
}

fn normalize_absolute_path(pathname: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in pathname.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(OsStr::new(std::path::MAIN_SEPARATOR_STR)),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_existing_safe_relative_path_contract() {
        assert!(is_safe_relative_path("src/native/routes/git.rs"));
        assert!(is_safe_relative_path("src\\server\\routes\\git.ts"));
        assert!(!is_safe_relative_path("../secrets.yaml"));
        assert!(!is_safe_relative_path("src/../../secrets.yaml"));
        assert!(!is_safe_relative_path("/tmp/secrets.yaml"));
        assert!(!is_safe_relative_path("src/\0/secrets.yaml"));
        assert!(!is_safe_relative_path(""));
    }

    #[test]
    fn contains_children_but_not_similarly_prefixed_siblings() {
        let cwd = std::env::current_dir().expect("current directory should resolve");
        let root = cwd.join("tests");

        assert!(is_within_directory(root.join("nested/file.ts"), &root));
        assert!(is_within_directory(&root, &root));
        assert!(!is_within_directory(cwd.join("tests-other/file.ts"), &root));
    }

    #[test]
    fn resolves_allowed_children_without_requiring_them_to_exist() {
        let cwd = std::env::current_dir().expect("current directory should resolve");
        let home = cwd.join("test-home");
        let allowed = AllowedPaths::new(&cwd, home).expect("allowed roots should resolve");
        let tests = cwd.join("tests");

        assert_eq!(
            allowed.resolve_allowed_child_path(&tests, "nested/file.ts"),
            Some(tests.join("nested/file.ts"))
        );
        assert_eq!(
            allowed.resolve_allowed_child_path(&tests, "../package.json"),
            None
        );
    }

    #[test]
    fn rejects_paths_outside_both_allowed_roots() {
        let cwd = std::env::current_dir().expect("current directory should resolve");
        let allowed = AllowedPaths::new(cwd.join("project"), cwd.join("home"))
            .expect("allowed roots should resolve");

        assert!(allowed.is_allowed_local_path(cwd.join("project/src/main.rs")));
        assert!(allowed.is_allowed_local_path(cwd.join("home/Documents/file.txt")));
        assert!(!allowed.is_allowed_local_path(cwd.join("project-other/secret.txt")));
        assert!(!allowed.is_allowed_local_path(cwd.join("outside/secret.txt")));
    }

    #[test]
    fn canonical_resolution_accepts_existing_allowed_paths() {
        let cwd = std::env::current_dir().expect("current directory should resolve");
        let allowed = AllowedPaths::new(&cwd, &cwd).expect("allowed roots should resolve");

        assert_eq!(
            allowed.resolve_real_allowed_local_path(&cwd),
            cwd.canonicalize().ok()
        );
        assert_eq!(
            allowed.resolve_real_allowed_local_path(cwd.join("definitely-missing")),
            None
        );
    }
}
