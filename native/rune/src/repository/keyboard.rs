use super::*;
use rune::{Key, KeyEvent};

fn key_name(event: &KeyEvent) -> Option<String> {
    Some(match &event.key {
        Key::Up => "ArrowUp".into(),
        Key::Down => "ArrowDown".into(),
        Key::Left => "ArrowLeft".into(),
        Key::Right => "ArrowRight".into(),
        Key::Home => "Home".into(),
        Key::End => "End".into(),
        Key::Enter => "Enter".into(),
        Key::Escape => "escape".into(),
        Key::Tab => "tab".into(),
        Key::Backspace => "backspace".into(),
        Key::Delete => "delete".into(),
        Key::PageUp => "pageup".into(),
        Key::PageDown => "pagedown".into(),
        Key::Text(text) if text == " " => " ".into(),
        Key::Text(text) => text.to_lowercase(),
        Key::Command(c) => c.to_string(),
        _ => return None,
    })
}

impl RepositoryView {
    /// Shows the graph with the arrow keys on it.
    pub(crate) fn focus_graph(&mut self) {
        self.show_diff = false;
        self.history = true;
        self.keyboard_scope = "graph";
        self.keyboard_active = true;
    }

    pub(super) fn navigate_file(&mut self, direction: i32, tx: &mut Tx) {
        let files = self.file_entries();
        let current = files.iter().position(|file| {
            self.file.as_deref() == Some(&file.0) && file.4 == self.selected_staged
        });
        let next = inferay_presentation::workbench::adjacent_file(&json!({
            "count": files.len(), "current": current.map(|i| i as i64).unwrap_or(-1), "direction": direction, "repeatBoundary": direction == 0,
        }));
        if let Some(index) = next.as_u64() {
            let file = &files[index as usize];
            let group_index = files[..index as usize]
                .iter()
                .filter(|f| f.4 == file.4)
                .count();
            tx.scroll_into_view(format!("changed-file-{}-{group_index}", file.4));
            self.open_file(file.0.clone(), file.4, tx);
        }
    }

    fn commit_drafts_focused(&self) -> bool {
        self.commit_drafts
            .borrow()
            .values()
            .any(|draft| draft.input.is_focused())
    }

    /// Returns `None` when the key is not the repository's, otherwise whether
    /// the graph should close back to the chats.
    pub(super) fn navigate(&mut self, event: &KeyEvent, tx: &mut Tx) -> Option<bool> {
        if matches!(event.key, Key::Escape)
            && (self.branch_menu.is_some()
                || self.git_menu.is_some()
                || self.git_prompt.is_some()
                || self.branch_menu_task.is_some())
        {
            self.close_menus();
            tx.focus("repository", false);
            return Some(false);
        }
        if self.git_prompt.is_some() || self.commit_drafts_focused() {
            return None;
        }
        let key = key_name(event)?;
        let modifiers = event.mods;
        let mut input = json!({"key":key,"meta":modifiers.logo,"ctrl":modifiers.ctrl,"alt":modifiers.alt,"shift":modifiers.shift,"repeat":tx.key_repeat(),
            "graphFocused":self.keyboard_scope == "graph", "sidebarFocused":self.keyboard_scope == "sidebar",
            "focusedPanelId":"workspace-diff-viewer", "mainViewMode":if self.show_diff {"diff"} else {"graph"},
            "graphVisible":self.history, "sidebarVisible":self.changes, "hasFile":self.file.is_some(), "historical":self.selected.is_some(), "workingTree":self.selected.is_none()});
        let action = inferay_presentation::workbench::keyboard_action(&input);
        match action["type"].as_str() {
            Some("close" | "focusGraph") => {
                self.show_diff = false;
                self.history = true;
                self.keyboard_scope = "graph";
                self.open_after_selection = false;
            }
            Some("closeGraph") => return Some(true),
            Some("toggle") => {
                if let Some(path) = self.file.clone() {
                    self.stage(Some(path), self.selected_staged);
                }
            }
            Some("cycle") => self.navigate_file(action["direction"].as_i64().unwrap() as i32, tx),
            Some("enterSidebar" | "open") => {
                self.keyboard_scope = "sidebar";
                self.changes = true;
                self.navigate_file(0, tx);
            }
            Some("navigateGraph") => {
                let current = self
                    .graph
                    .commits
                    .iter()
                    .find(|commit| Some(&commit.id) == self.selected_item.as_ref());
                input["branchTarget"] = json!(current.and_then(|commit| if key == "ArrowUp" {
                    commit.navigation.branch_newer.as_ref()
                } else {
                    commit.navigation.branch_older.as_ref()
                }));
                input["items"] = self.presentation["selectableItems"].clone();
                input["current"] = json!(self.selected_item);
                input["canOpen"] = json!(true);
                let next =
                    serde_json::to_value(inferay_presentation::graph::navigation(&input)).unwrap();
                if next["handled"] != true {
                    return None;
                }
                if let Some(id) = next["selectItem"].as_str()
                    && let Some(index) =
                        self.graph.commits.iter().position(|commit| commit.id == id)
                {
                    self.select_commit(index);
                    tx.scroll_into_view(format!("commit-{id}"));
                }
                if next["openItem"].is_string() || (key == "ArrowRight" && self.file.is_some()) {
                    self.changes = true;
                    self.keyboard_scope = "sidebar";
                    if self.selected.is_some() && self.details.is_none() {
                        self.open_after_selection = true;
                    } else {
                        self.navigate_file(0, tx);
                    }
                }
            }
            Some("stepDiffChange") => {
                self.step_diff_change(action["direction"].as_i64().unwrap() as i32, tx)
            }
            _ => return None,
        }
        self.keyboard_active = true;
        tx.focus("repository", false);
        Some(false)
    }
}

pub fn on_key(s: &mut Workspace, event: &KeyEvent, tx: &mut Tx) -> bool {
    if s.settings || s.project_pages.page.is_some() {
        return false;
    }
    if !s.repository {
        // → with nothing focused opens the graph; the composer handles its own.
        return matches!(event.key, Key::Right)
            && event.mods == rune::Mods::default()
            && tx.focused().is_none()
            && s.show_graph(tx);
    }
    let Some(path) = s.repository_view.clone() else {
        return false;
    };
    let Some(view) = s.repository_views.get_mut(&path) else {
        return false;
    };
    if tx.focused().is_some() {
        view.keyboard_active = false;
        return false;
    }
    if !view.keyboard_active {
        return false;
    }
    handle_key(s, &path, event, tx)
}

/// The focused panel and window-level keys share one path: ← on the graph
/// closes it back to the chats.
pub(super) fn handle_key(s: &mut Workspace, path: &str, event: &KeyEvent, tx: &mut Tx) -> bool {
    let Some(view) = s.repository_views.get_mut(path) else {
        return false;
    };
    match view.navigate(event, tx) {
        None => false,
        Some(close) => {
            if close {
                s.close_graph();
            }
            true
        }
    }
}
