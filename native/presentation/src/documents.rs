//! Document selection and admission; the browser retains file bodies by path.
use crate::wasm_json;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use ts_rs::TS;
use wasm_bindgen::prelude::*;

#[derive(Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentView {
    pub paths: Vec<String>,
    pub active_path: Option<String>,
    pub restoring: bool,
    pub error: Option<String>,
}
#[wasm_bindgen]
pub struct DocumentReplica {
    view: DocumentView,
    closed: HashSet<String>,
    pending: HashMap<String, u32>,
    selection: u32,
}
#[wasm_bindgen]
impl DocumentReplica {
    #[wasm_bindgen(constructor)]
    pub fn new(
        paths: &str,
        active_path: Option<String>,
        restoring: bool,
    ) -> Result<DocumentReplica, JsValue> {
        Ok(Self {
            view: DocumentView {
                paths: wasm_json::parse(paths)?,
                active_path,
                restoring,
                error: None,
            },
            closed: HashSet::new(),
            pending: HashMap::new(),
            selection: 0,
        })
    }
    pub fn snapshot(&self) -> String {
        wasm_json::stringify(&self.view, "document view")
    }
    pub fn select(&mut self, path: &str) {
        self.selection += 1;
        self.view.active_path = Some(path.into());
    }
    pub fn open(&mut self, path: &str) -> u32 {
        self.selection += 1;
        self.closed.remove(path);
        self.pending.insert(path.into(), self.selection);
        self.selection
    }
    pub fn close(&mut self, path: &str) -> usize {
        self.closed.insert(path.into());
        self.pending.remove(path);
        let index = self.view.paths.iter().position(|p| p == path);
        self.view.paths.retain(|p| p != path);
        if self.view.active_path.as_deref() == Some(path) {
            self.selection += 1;
            self.view.active_path = index
                .and_then(|i| {
                    self.view
                        .paths
                        .get(i.min(self.view.paths.len().saturating_sub(1)))
                })
                .cloned();
        }
        self.view.paths.len()
    }
    pub fn receive(&mut self, version: u32, requested: &str, path: &str) -> bool {
        if self.pending.get(requested) != Some(&version) {
            return false;
        }
        self.pending.remove(requested);
        if !self.view.paths.iter().any(|p| p == path) {
            self.view.paths.push(path.into());
        }
        if version == self.selection {
            self.view.active_path = Some(path.into());
            self.view.error = None;
        }
        true
    }
    pub fn restore(&mut self, paths: &str, active: Option<String>) -> Result<(), JsValue> {
        let mut paths: Vec<String> = wasm_json::parse(paths)?;
        paths.retain(|p| !self.closed.contains(p));
        if self.selection == 0 && self.view.active_path.is_none() {
            self.view.active_path = if active.as_ref().is_some_and(|p| self.closed.contains(p)) {
                paths.first().cloned()
            } else {
                active
            };
        }
        for path in &self.view.paths {
            if !paths.contains(path) {
                paths.push(path.clone());
            }
        }
        self.view.paths = paths;
        self.view.restoring = false;
        Ok(())
    }
    pub fn fail(&mut self, version: Option<u32>, message: String) {
        if let Some(version) = version {
            if !self.pending.values().any(|pending| *pending == version) {
                return;
            }
            self.pending.retain(|_, pending| *pending != version);
        } else {
            self.view.restoring = false;
        }
        if version.is_none_or(|v| v == self.selection) {
            self.view.error = Some(message);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn replica(paths: &[&str], active: Option<&str>) -> DocumentReplica {
        DocumentReplica::new(
            &serde_json::to_string(paths).unwrap(),
            active.map(String::from),
            true,
        )
        .unwrap()
    }

    #[test]
    fn loading_other_files_retains_user_selection_and_rejects_superseded_reloads() {
        let mut model = replica(&["a"], Some("a"));
        let first = model.open("b");
        let newest = model.open("b");
        assert!(model.receive(newest, "b", "b"));
        assert!(!model.receive(first, "b", "b"));
        let pending = model.open("c");
        model.select("a");
        assert!(model.receive(pending, "c", "c"));
        assert_eq!(model.view.active_path.as_deref(), Some("a"));
        assert_eq!(model.view.paths, ["a", "b", "c"]);
    }

    #[test]
    fn closing_pending_files_prevents_late_admission_even_after_reopening() {
        let mut model = replica(&["a", "b"], Some("b"));
        let old = model.open("b");
        model.close("b");
        assert_eq!(model.view.active_path.as_deref(), Some("a"));
        let current = model.open("b");
        assert!(!model.receive(old, "b", "b"));
        assert!(model.receive(current, "b", "b"));
        model.close("b");
        model.close("a");
        assert!(model.view.active_path.is_none());
    }
}
