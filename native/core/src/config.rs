use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const DEFAULT_SEARCH_FOLDERS: &[&str] = &[
    "~/Desktop",
    "~/Documents",
    "~/Projects",
    "~/Developer",
    "~/Code",
    "~/Work",
    "~/Sites",
    "~/repos",
    "~/src",
    "~/dev",
];

#[derive(Debug)]
pub struct ConfigManager {
    path: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct Settings {
    search_folders: Vec<String>,
}

impl ConfigManager {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn search_folders(&self) -> Result<Vec<String>, String> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice::<Settings>(&bytes)
                .map(|settings| settings.search_folders)
                .map_err(|error| error.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(DEFAULT_SEARCH_FOLDERS
                    .iter()
                    .map(|folder| (*folder).into())
                    .collect())
            }
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn set_search_folders(&self, search_folders: Vec<String>) -> Result<(), String> {
        let bytes =
            serde_json::to_vec(&Settings { search_folders }).map_err(|error| error.to_string())?;
        crate::atomic_write::overwrite(&self.path, &bytes)
    }
}
