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

#[derive(Serialize, Deserialize)]
pub struct SearchFolderSettings {
    pub search_folders: Vec<String>,
}
