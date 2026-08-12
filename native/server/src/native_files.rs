use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use inferay_core::path_security::{is_within_directory, resolve_lexically};
use serde::Serialize;

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileEntry {
    pub name: String,
    pub path: String,
    pub timestamp: Option<f64>,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeImage {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

#[derive(Debug)]
pub enum NativeFilesError {
    AccessDenied,
    UnsupportedFileType,
    FileTooLarge,
    Io(std::io::Error),
}

impl std::fmt::Display for NativeFilesError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AccessDenied => formatter.write_str("Access denied"),
            Self::UnsupportedFileType => formatter.write_str("Unsupported file type"),
            Self::FileTooLarge => formatter.write_str("File too large"),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for NativeFilesError {}

impl From<std::io::Error> for NativeFilesError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Clone, Debug)]
pub struct NativeFiles {
    temp_dir: PathBuf,
}

impl NativeFiles {
    pub fn new(temp_dir: PathBuf) -> Self {
        Self { temp_dir }
    }

    pub fn from_app_root(app_root: &Path) -> Self {
        Self::new(app_root.join("data/.tmp"))
    }

    pub async fn list(&self) -> Result<Vec<NativeFileEntry>, NativeFilesError> {
        tokio::fs::create_dir_all(&self.temp_dir).await?;
        let mut directory = tokio::fs::read_dir(&self.temp_dir).await?;
        let mut files = Vec::new();
        while let Some(entry) = directory.next_entry().await? {
            let entry_name = entry.file_name().to_string_lossy().into_owned();
            if !is_image_extension(&entry_name) {
                continue;
            }
            let metadata = entry.metadata().await?;
            let timestamped = entry_name
                .split_once('-')
                .filter(|(timestamp, name)| !timestamp.is_empty() && !name.is_empty());
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            let timestamp = timestamped
                .and_then(|(timestamp, _)| timestamp.parse::<f64>().ok())
                .or_else(|| timestamped.is_none().then_some(modified));
            files.push(NativeFileEntry {
                name: timestamped
                    .map(|(_, name)| name.to_string())
                    .unwrap_or_else(|| entry_name.clone()),
                path: entry.path().to_string_lossy().into_owned(),
                timestamp,
                size: metadata.len(),
            });
        }
        files.sort_by(|left, right| {
            right
                .timestamp
                .zip(left.timestamp)
                .and_then(|(right, left)| right.partial_cmp(&left))
                .unwrap_or(Ordering::Equal)
        });
        Ok(files)
    }

    pub async fn delete(&self, path: &Path) -> Result<(), NativeFilesError> {
        let path = self.allowed_path(path)?;
        tokio::fs::remove_file(path).await?;
        Ok(())
    }

    pub async fn read_image(&self, path: &Path) -> Result<NativeImage, NativeFilesError> {
        let path = self.allowed_path(path)?;
        if !is_image_extension(&path.to_string_lossy()) {
            return Err(NativeFilesError::UnsupportedFileType);
        }
        if tokio::fs::metadata(&path).await?.len() > MAX_IMAGE_BYTES {
            return Err(NativeFilesError::FileTooLarge);
        }
        Ok(NativeImage {
            bytes: tokio::fs::read(&path).await?,
            content_type: image_content_type(&path),
        })
    }

    pub async fn store_image(
        &self,
        name: &str,
        bytes: &[u8],
    ) -> Result<NativeFileEntry, NativeFilesError> {
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err(NativeFilesError::FileTooLarge);
        }
        if !is_image_extension(name) {
            return Err(NativeFilesError::UnsupportedFileType);
        }
        tokio::fs::create_dir_all(&self.temp_dir).await?;
        let timestamp = now_millis();
        let safe_name = safe_upload_name(name);
        let path = self.temp_dir.join(format!("{timestamp}-{safe_name}"));
        tokio::fs::write(&path, bytes).await?;
        Ok(NativeFileEntry {
            name: safe_name,
            path: path.to_string_lossy().into_owned(),
            timestamp: Some(timestamp as f64),
            size: bytes.len() as u64,
        })
    }

    fn allowed_path(&self, path: &Path) -> Result<PathBuf, NativeFilesError> {
        let path = resolve_lexically(path).map_err(|_| NativeFilesError::AccessDenied)?;
        if !is_within_directory(&path, &self.temp_dir) {
            return Err(NativeFilesError::AccessDenied);
        }
        Ok(path)
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn safe_upload_name(name: &str) -> String {
    name.encode_utf16()
        .map(|unit| {
            let byte = u8::try_from(unit).ok();
            if byte.is_some_and(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
            }) {
                char::from(byte.unwrap_or_default())
            } else {
                '_'
            }
        })
        .collect()
}

pub(crate) fn is_image_extension(path: &str) -> bool {
    let extension = path
        .rfind('.')
        .map(|index| path[index..].to_lowercase())
        .unwrap_or_else(|| path.to_lowercase());
    matches!(
        extension.as_str(),
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".bmp" | ".ico"
    )
}

fn image_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn lists_images_with_existing_name_timestamp_size_and_order_contract() {
        let root = tempdir().unwrap();
        let service = NativeFiles::new(root.path().join("data/.tmp"));
        fs::create_dir_all(&service.temp_dir).unwrap();
        fs::write(service.temp_dir.join("100-first.png"), b"one").unwrap();
        fs::write(service.temp_dir.join("200-second.JPG"), b"second").unwrap();
        fs::write(service.temp_dir.join("300-ignore.txt"), b"ignored").unwrap();

        let files = service.list().await.unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "second.JPG");
        assert_eq!(files[0].timestamp, Some(200.0));
        assert_eq!(files[0].size, 6);
        assert_eq!(files[1].name, "first.png");
    }

    #[tokio::test]
    async fn reads_and_deletes_only_images_inside_the_temp_directory() {
        let root = tempdir().unwrap();
        let service = NativeFiles::new(root.path().join("data/.tmp"));
        fs::create_dir_all(&service.temp_dir).unwrap();
        let image = service.temp_dir.join("1-photo.webp");
        fs::write(&image, b"image").unwrap();
        let outside = root.path().join("outside.png");
        fs::write(&outside, b"outside").unwrap();

        let loaded = service.read_image(&image).await.unwrap();
        assert_eq!(loaded.bytes, b"image");
        assert_eq!(loaded.content_type, "image/webp");
        assert!(matches!(
            service.read_image(&outside).await,
            Err(NativeFilesError::AccessDenied)
        ));
        assert!(matches!(
            service.delete(&outside).await,
            Err(NativeFilesError::AccessDenied)
        ));
        service.delete(&image).await.unwrap();
        assert!(!image.exists());
    }
}
