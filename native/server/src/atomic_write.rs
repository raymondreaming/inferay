use std::path::Path;

use uuid::Uuid;

pub async fn overwrite(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| error.to_string())?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let temporary = parent.join(format!("{filename}.{}.tmp", Uuid::new_v4()));
    tokio::fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    replace(&temporary, path).await.map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })
}

async fn replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    let source = source.to_path_buf();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || inferay_core::atomic_write::replace(&source, &destination))
        .await
        .map_err(std::io::Error::other)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn overwrites_an_existing_destination_repeatedly() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state.json");
        overwrite(&path, b"first").await.unwrap();
        overwrite(&path, b"second").await.unwrap();
        overwrite(&path, b"third").await.unwrap();
        assert_eq!(tokio::fs::read(path).await.unwrap(), b"third");
    }
}
