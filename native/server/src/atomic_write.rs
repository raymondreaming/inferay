use std::path::Path;

pub async fn overwrite(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let path = path.to_owned();
    let bytes = bytes.to_owned();
    tokio::task::spawn_blocking(move || inferay_core::atomic_write::overwrite(&path, &bytes))
        .await
        .map_err(|error| error.to_string())?
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
