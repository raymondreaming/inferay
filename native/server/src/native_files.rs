use crate::unix_millis as now_millis;
use std::path::{Path, PathBuf};

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(thiserror::Error, Debug)]
pub enum NativeFilesError {
    #[error("Unsupported file type")]
    UnsupportedFileType,
    #[error("File too large")]
    FileTooLarge,
    #[error("{0}")]
    Io(#[from] std::io::Error),
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

    pub async fn store_image(&self, name: &str, bytes: &[u8]) -> Result<PathBuf, NativeFilesError> {
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
        Ok(path)
    }
}

pub(crate) fn safe_upload_name(name: &str) -> String {
    name.encode_utf16()
        .map(|unit| match u8::try_from(unit) {
            Ok(byte) if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-') => {
                char::from(byte)
            }
            _ => '_',
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

pub(crate) fn image_content_type(path: &Path) -> &'static str {
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
