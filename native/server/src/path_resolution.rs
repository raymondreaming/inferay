//! Platform resolution for route inputs; containment policy remains in core.
use inferay_core::path_security;
use std::io;
use std::path::{Path, PathBuf};

pub(crate) fn resolve_lexically(path: &Path) -> io::Result<PathBuf> {
    let base = if path.is_absolute() {
        PathBuf::new()
    } else {
        std::env::current_dir()?
    };
    path_security::resolve_lexically(path, &base).map_err(io::Error::other)
}

pub(crate) fn is_within_directory(path: impl AsRef<Path>, directory: impl AsRef<Path>) -> bool {
    match (
        resolve_lexically(path.as_ref()),
        resolve_lexically(directory.as_ref()),
    ) {
        (Ok(path), Ok(directory)) => path_security::is_within_directory(path, directory),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_inputs_keep_their_process_relative_resolution() {
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(resolve_lexically(Path::new(".")).unwrap(), cwd);
        assert_eq!(
            resolve_lexically(Path::new("nested/../file")).unwrap(),
            cwd.join("file")
        );
        assert!(is_within_directory(".", &cwd));
        assert!(!is_within_directory("../other", &cwd));
    }
}
