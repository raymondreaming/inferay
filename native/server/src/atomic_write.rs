use std::path::Path;

pub async fn overwrite(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let path = path.to_owned();
    let bytes = bytes.to_owned();
    tokio::task::spawn_blocking(move || inferay_core::atomic_write::overwrite(&path, &bytes))
        .await
        .map_err(|error| error.to_string())?
}
