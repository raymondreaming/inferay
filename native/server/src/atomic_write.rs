use std::{io::Write, path::Path};

/// Publish beside the destination so replacement is atomic on every platform.
pub fn overwrite_sync(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let write = || -> std::io::Result<()> {
        let parent = path
            .parent()
            .ok_or_else(|| std::io::Error::other("Invalid file path"))?;
        std::fs::create_dir_all(parent)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        temporary.write_all(bytes)?;
        temporary.persist(path).map_err(|error| error.error)?;
        Ok(())
    };
    write().map_err(|error| error.to_string())
}

pub async fn overwrite(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let path = path.to_owned();
    let bytes = bytes.to_owned();
    tokio::task::spawn_blocking(move || overwrite_sync(&path, &bytes))
        .await
        .map_err(|error| error.to_string())?
}
