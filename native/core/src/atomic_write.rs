use std::path::Path;

use uuid::Uuid;

/// Atomically publishes a complete file on Unix and provides the same
/// replace-existing behavior on Windows, where `rename` otherwise fails when
/// the destination already exists.
pub fn overwrite(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let temporary = parent.join(format!("{filename}.{}.tmp", Uuid::new_v4()));
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    replace(&temporary, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })
}

#[cfg(not(windows))]
pub fn replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
pub fn replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    // SAFETY: both pointers reference NUL-terminated UTF-16 buffers for the
    // duration of the call. The temporary file lives beside the destination,
    // so this remains a same-volume atomic replacement.
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overwrites_an_existing_destination_repeatedly() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state.json");
        overwrite(&path, b"first").unwrap();
        overwrite(&path, b"second").unwrap();
        overwrite(&path, b"third").unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"third");
    }
}
