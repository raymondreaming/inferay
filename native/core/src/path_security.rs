use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

/// The local roots that Inferay is permitted to expose to application services.
///
/// Keeping the roots explicit makes the security boundary deterministic and
/// testable. The desktop/server adapter is responsible for supplying the project
/// root, home directory, and working directory. No filesystem access occurs here.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AllowedPaths {
    project_root: PathBuf,
    home_directory: PathBuf,
    working_directory: PathBuf,
}

impl AllowedPaths {
    pub fn new(
        project_root: impl AsRef<Path>,
        home_directory: impl AsRef<Path>,
        working_directory: impl AsRef<Path>,
    ) -> Result<Self, &'static str> {
        let working_directory = working_directory.as_ref();
        Ok(Self {
            project_root: resolve_lexically(project_root.as_ref(), working_directory)?,
            home_directory: resolve_lexically(home_directory.as_ref(), working_directory)?,
            working_directory: working_directory.to_path_buf(),
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
        let Ok(pathname) = resolve_lexically(pathname.as_ref(), &self.working_directory) else {
            return false;
        };

        is_resolved_within_directory(&pathname, &self.project_root)
            || is_resolved_within_directory(&pathname, &self.home_directory)
    }

    pub fn resolve_allowed_local_path(&self, pathname: impl AsRef<Path>) -> Option<PathBuf> {
        let resolved = resolve_lexically(pathname.as_ref(), &self.working_directory).ok()?;
        self.is_allowed_local_path(&resolved).then_some(resolved)
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
        let resolved =
            resolve_lexically(&directory.join(pathname), &self.working_directory).ok()?;
        is_resolved_within_directory(&resolved, &directory).then_some(resolved)
    }
}

/// Lexically checks absolute paths. Relative inputs require an explicit base
/// through `resolve_lexically` first; files do not need to exist.
pub fn is_within_directory(pathname: impl AsRef<Path>, directory: impl AsRef<Path>) -> bool {
    let (Ok(pathname), Ok(directory)) = (
        resolve_lexically(pathname.as_ref(), Path::new("")),
        resolve_lexically(directory.as_ref(), Path::new("")),
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

pub fn resolve_lexically(
    pathname: &Path,
    working_directory: &Path,
) -> Result<PathBuf, &'static str> {
    let absolute = if pathname.is_absolute() {
        pathname.to_path_buf()
    } else {
        working_directory.join(pathname)
    };
    if !absolute.is_absolute() {
        return Err("Path resolution requires an absolute working directory");
    }
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
