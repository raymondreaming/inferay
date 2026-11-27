//! Per-chat working directory: the composer's folder control and its picker.
//! Choosing a folder updates only that chat's saved directory; project
//! repositories are unchanged.
use super::*;
use crate::colors::rgba;
use crate::icons;
use crate::ui::{Ink, button, icon_sized, menu_surface, plain_button};
use crate::zoom::ui;
use inferay_core::workspace_action::AgentWorkspaceAction;
use reqwest::Method;
use rune::{El, col};
use serde_json::json;

/// Discovered folders, shared by every chat's picker and refreshed on each open.
#[derive(Default)]
pub(crate) struct Picks {
    entries: Vec<(String, String)>,
    task: Option<Task>,
    selecting: Option<Task>,
    error: Option<String>,
}

fn folder_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
}

impl Workspace {
    pub(crate) fn directory_button(&self, index: usize) -> El {
        let cwd = self.conversations[index].cwd.as_deref();
        button("")
            .key(format!("directory-{index}"))
            .label(format!("Working directory: {}", cwd.unwrap_or("not set")))
            .h(ui(24.))
            .px(ui(4.))
            .gap(ui(4.))
            .child(icon_sized(&icons::FOLDER, 10.))
            .child(Ink::new(10.).line_text(cwd.map_or("Folder", folder_name).to_owned()))
            .child(icon_sized(&icons::CHEVRON_DOWN, 9.))
            .on_press(move |s: &mut Workspace| {
                s.selected = index;
                if s.menu == Some((index, "directory")) {
                    s.menu = None;
                } else {
                    s.menu = Some((index, "directory"));
                    s.load_directories();
                }
            })
    }

    fn load_directories(&mut self) {
        let backend = self.backend.clone();
        let profile = self.profile.clone();
        self.directory_picks.error = None;
        self.directory_picks.task = Some(crate::task::spawn(
            async move {
                let response = backend
                    .get_or_try_init(|| Backend::connect(profile))
                    .await?
                    .request(Method::GET, "/api/agent/directories?quickPicks=true", None)
                    .await?;
                Ok::<_, anyhow::Error>(
                    response["quickPicks"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|pick| {
                            Some((
                                pick["name"].as_str()?.to_owned(),
                                pick["path"].as_str()?.to_owned(),
                            ))
                        })
                        .collect::<Vec<_>>(),
                )
            },
            |s: &mut Workspace, result, _| {
                let picks = &mut s.directory_picks;
                picks.task = None;
                match result {
                    Ok(entries) => picks.entries = entries,
                    Err(error) => picks.error = Some(format!("Could not find folders: {error:#}")),
                }
            },
        ));
    }

    pub(crate) fn select_directory(&mut self, index: usize, path: String) {
        self.menu = None;
        if self.directory_picks.selecting.is_some() {
            return;
        }
        let (Some(pane), Some(backend)) = (
            self.conversations[index].pane.clone(),
            self.backend.get().cloned(),
        ) else {
            self.conversations[index].error =
                Some("Chat is connecting. Choose its folder again when connected.".into());
            return;
        };
        let action = AgentWorkspaceAction::DirectorySelected {
            pane_id: pane.clone(),
            path: Some(path),
            reference_paths: None,
        };
        self.directory_picks.selecting = Some(crate::task::spawn(
            async move {
                let response = backend
                    .request(
                        Method::POST,
                        "/api/agent/state/workspace-action",
                        Some(json!({"action":action})),
                    )
                    .await?;
                let state: inferay_core::agent_state::Workspace =
                    serde_json::from_value(response["state"].clone())?;
                Ok::<_, anyhow::Error>(state.pane(&pane).and_then(|pane| pane.cwd.clone()))
            },
            move |s: &mut Workspace, result, _| {
                s.directory_picks.selecting = None;
                let chat = &mut s.conversations[index];
                match result {
                    Ok(cwd) => chat.cwd = cwd,
                    Err(error) => chat.error = Some(format!("Could not change folder: {error:#}")),
                }
            },
        ));
    }

    fn open_directory(index: usize) {
        crate::platform::prompt_for_paths(
            crate::platform::PathPrompt {
                files: false,
                directories: true,
                multiple: false,
                prompt: Some("Use folder"),
            },
            move |s: &mut Workspace, paths, _| {
                if let Some(path) = paths.and_then(|paths| paths.into_iter().next()) {
                    s.select_directory(index, path.to_string_lossy().into_owned());
                }
            },
        );
    }

    pub(crate) fn directory_menu(&self, index: usize) -> El {
        let current = self.conversations[index].cwd.as_deref();
        let picks = &self.directory_picks;
        let mut rows = col().w_full();
        if let Some(path) = current {
            rows = rows.child(directory_row(index, "current", path, true));
        }
        for (i, (name, path)) in picks.entries.iter().enumerate() {
            if Some(path.as_str()) != current {
                rows = rows.child(
                    directory_row(index, &i.to_string(), path, false)
                        .label(format!("{name}: {path}")),
                );
            }
        }
        let status = if let Some(error) = &picks.error {
            Some(error.clone())
        } else if picks.task.is_some() && picks.entries.is_empty() {
            Some("Finding folders…".into())
        } else {
            None
        };
        menu_surface()
            .key(format!("directory-menu-{index}"))
            .pin(Some(ui(12.)), None, None, Some(ui(46.)))
            .w(ui(320.))
            .modal(true, |s: &mut Workspace| s.menu = None)
            .child(rows)
            .children(status.map(|status| {
                col()
                    .px(ui(9.))
                    .py(ui(6.))
                    .child(Ink::small().hex(0xebebeb80).text(status))
            }))
            .child(
                button("Open folder…")
                    .key(format!("directory-open-{index}"))
                    .w_full()
                    .on_press(move |s: &mut Workspace| {
                        s.menu = None;
                        Self::open_directory(index);
                    }),
            )
    }
}

fn directory_row(index: usize, id: &str, path: &str, selected: bool) -> El {
    let key = format!("directory-option-{index}-{id}");
    let mut option = plain_button("")
        .key(key.clone())
        .label(path.to_owned())
        .w_full()
        .h(ui(40.))
        .child(
            col()
                .grow(1.)
                .shrink()
                .min_w(0.)
                .child(
                    Ink::small()
                        .line_text(folder_name(path).to_owned())
                        .shrink(),
                )
                .child(
                    Ink::new(10.)
                        .hex(0xebebeb80)
                        .line_text(path.to_owned())
                        .shrink(),
                ),
        );
    option = if selected {
        crate::ui::swap_fill(option, &key, Some(rgba(0xebebeb17)), rgba(0xffffff0d))
    } else {
        option.hover(rgba(0xffffff0d))
    };
    let path = path.to_owned();
    option.on_press(move |s: &mut Workspace| s.select_directory(index, path.clone()))
}

#[cfg(test)]
#[path = "directory_tests.rs"]
mod tests;
