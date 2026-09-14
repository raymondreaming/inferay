//! Settings persistence; defaults and file vocabulary belong to the core.
use inferay_core::config::{DEFAULT_SEARCH_FOLDERS, SearchFolderSettings};
use std::path::PathBuf;

#[derive(Debug)]
pub(crate) struct ConfigManager {
    path: PathBuf,
}

impl ConfigManager {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn search_folders(&self) -> Result<Vec<String>, String> {
        Ok(crate::json_file::read::<SearchFolderSettings>(&self.path)?
            .map(|settings| settings.search_folders)
            .unwrap_or_else(|| {
                DEFAULT_SEARCH_FOLDERS
                    .iter()
                    .map(|folder| (*folder).into())
                    .collect()
            }))
    }

    pub fn set_search_folders(&self, search_folders: Vec<String>) -> Result<(), String> {
        crate::json_file::write(&self.path, &SearchFolderSettings { search_folders })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_distinguish_missing_saved_and_invalid_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("settings.json");
        let store = ConfigManager::new(path.clone());
        assert_eq!(store.search_folders().unwrap(), DEFAULT_SEARCH_FOLDERS);
        store.set_search_folders(vec!["/repo".into()]).unwrap();
        assert_eq!(
            ConfigManager::new(path.clone()).search_folders().unwrap(),
            ["/repo"]
        );
        std::fs::write(path, b"invalid").unwrap();
        assert!(store.search_folders().is_err());
    }
}
