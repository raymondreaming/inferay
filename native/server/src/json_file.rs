//! Typed JSON file persistence shared by server-owned stores.
use serde::{Serialize, de::DeserializeOwned};
use std::path::Path;

pub fn read<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn read_existing<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    read(path)
}

pub fn read_lossy<T: DeserializeOwned + Default>(path: &Path) -> T {
    read(path).ok().flatten().unwrap_or_default()
}

pub fn write<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    crate::atomic_write::overwrite_sync(path, &bytes)
}

pub fn write_pretty<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    crate::atomic_write::overwrite_sync(path, &bytes)
}
