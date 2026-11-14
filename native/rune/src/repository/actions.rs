use super::*;
use crate::input::{self, TextInput};
use crate::ui::{Ink, button, menu_surface};
use crate::zoom::ui;
use rune::{El, row};

pub(super) struct GitPrompt {
    pub(super) action: &'static str,
    pub(super) target: String,
    pub(super) remote: Option<String>,
    pub(super) input: TextInput,
}

type MenuEntry = (&'static str, String, String, Option<String>, bool);

impl RepositoryView {
    fn mutate_git(
        &mut self,
        reset_selection: bool,
        work: impl FnOnce(&str) -> Option<String> + Send + 'static,
    ) {
        if self.mutating {
            return;
        }
        self.git_menu = None;
        self.git_prompt = None;
        self.branch_menu = None;
        self.branch_menu_task = None;
        self.mutating = true;
        self.error = None;
        let cwd = self.path.clone();
        self.mutation_task = Some(self.spawn(
            move || work(&cwd),
            move |s, error, _| {
                s.mutating = false;
                s.task = None;
                s.loading = false;
                if reset_selection {
                    s.selection_task = None;
                    s.clear_diff();
                    s.file = None;
                    s.show_diff = false;
                    s.selected = None;
                    s.selected_item = None;
                    s.selected_worktree = None;
                    s.details = None;
                }
                s.refresh();
                s.error = error;
            },
        ));
    }

    pub(super) fn run_branch_action(
        &mut self,
        operation: &'static str,
        source: String,
        target: String,
    ) {
        self.mutate_git(true, move |cwd| {
            if operation == "checkout" {
                inferay_native_diff::checkout_git_branch(cwd, &source).error
            } else {
                inferay_native_diff::perform_git_ref_operation(cwd, operation, &source, &target)
                    .error
            }
        });
    }

    pub(super) fn run_graph_action(
        &mut self,
        action: &'static str,
        target: String,
        name: String,
        remote: Option<String>,
    ) {
        self.mutate_git(
            matches!(
                action,
                "pull"
                    | "cherryPick"
                    | "revert"
                    | "resetSoft"
                    | "resetMixed"
                    | "resetHard"
                    | "continue"
                    | "skip"
                    | "abort"
            ),
            move |cwd| {
                if matches!(action, "continue" | "skip" | "abort") {
                    return inferay_native_diff::finish_git_ref_operation(cwd, &target, action)
                        .error;
                }
                let result = inferay_native_diff::perform_git_graph_action_with_targets(
                    cwd,
                    action,
                    Some(&target),
                    &[],
                    Some(&name),
                    None,
                );
                if !result.ok {
                    return result.error.or_else(|| Some("Git operation failed".into()));
                }
                if let Some(remote) = remote {
                    let result = inferay_native_diff::perform_git_graph_action_with_targets(
                        cwd,
                        "deleteRemoteBranch",
                        Some(&remote),
                        &[],
                        None,
                        None,
                    );
                    if !result.ok {
                        return Some(format!(
                            "Deleted local branch {target}, but could not delete {remote}: {}",
                            result.error.unwrap_or_default()
                        ));
                    }
                }
                None
            },
        );
    }

    pub(super) fn request_git_action(
        &mut self,
        action: &'static str,
        target: String,
        remote: Option<String>,
    ) {
        if self.mutating {
            return;
        }
        let catalog = action_presentation(action);
        if catalog["needsConfirm"] == false {
            self.run_graph_action(action, target, String::new(), remote);
            return;
        }
        let mut input = TextInput::field(catalog["nameLabel"].as_str().unwrap_or("Name"));
        input.height_limits = (30., 30.);
        input.typography = (12., 20.);
        if catalog["needsName"] == true {
            input.focus();
        }
        self.branch_menu = None;
        self.branch_menu_task = None;
        self.git_prompt = Some(GitPrompt {
            action,
            target,
            remote,
            input,
        });
        self.git_menu = None;
    }

    fn confirm_git_prompt(&mut self, tx: &mut Tx) {
        let Some(prompt) = self.git_prompt.as_ref() else {
            return;
        };
        let name = prompt.input.content().to_string();
        if inferay_presentation::git_actions::CATALOG[prompt.action]["needsName"] == true
            && name.trim().is_empty()
        {
            return;
        }
        let (action, target, remote) =
            (prompt.action, prompt.target.clone(), prompt.remote.clone());
        tx.focus("repository", false);
        self.run_graph_action(action, target, name, remote);
    }

    pub(super) fn git_prompt(&self) -> El {
        let prompt = self.git_prompt.as_ref().unwrap();
        let mut catalog = action_presentation(prompt.action);
        if prompt.remote.is_some() {
            catalog["title"] = json!("Delete local and remote branches");
            catalog["copy"] = json!(
                "Delete the merged local branch, then delete its upstream branch from the remote. If the remote deletion fails, the local deletion remains complete."
            );
            catalog["confirm"] = json!("Delete both");
        }
        let mut surface = menu_surface()
            .key("git-action-prompt")
            .pin(None, Some(ui(40.)), Some(ui(12.)), None)
            .w(ui(360.))
            .padding(ui(12.))
            .gap(ui(10.))
            .child(Ink::new(14.).text(catalog["title"].as_str().unwrap_or("Git action").to_owned()))
            .child(Ink::new(12.).text(catalog["copy"].as_str().unwrap_or_default().to_owned()))
            .child(Ink::new(12.).text(if let Some(remote) = &prompt.remote {
                format!("{} and {remote}", prompt.target)
            } else {
                prompt.target.clone()
            }));
        if catalog["needsName"] == true {
            let field = input::newline_on_enter(
                input::field(
                    &prompt.input,
                    "git-action-name",
                    prompt_input(self.path.clone()),
                ),
                prompt_input(self.path.clone()),
            );
            surface = surface.child(input::frame(&prompt.input, field));
        }
        surface.child(
            row()
                .justify_end()
                .gap(ui(8.))
                .child(button("Cancel").key("cancel-git-action").on_press_tx(act(
                    &self.path,
                    |view, tx| {
                        view.git_prompt = None;
                        tx.focus("repository", false);
                    },
                )))
                .child(
                    button(catalog["confirm"].as_str().unwrap_or("Confirm"))
                        .key("confirm-git-action")
                        .on_press_tx(act(&self.path, |view, tx| view.confirm_git_prompt(tx))),
                ),
        )
    }

    fn git_menu_entries(&self, hash: &str, refs: &[GitGraphRef]) -> Vec<MenuEntry> {
        let current = self
            .status
            .as_ref()
            .map(|status| status.branch.clone())
            .unwrap_or_default();
        let mut entries: Vec<MenuEntry> = vec![];
        if hash.is_empty() {
            let operation = match self.graph.operation.kind {
                GitRepositoryOperationKind::Merge => Some("merge"),
                GitRepositoryOperationKind::Rebase => Some("rebase"),
                GitRepositoryOperationKind::CherryPick => Some("cherryPick"),
                GitRepositoryOperationKind::Revert => Some("revert"),
                GitRepositoryOperationKind::Idle => None,
            };
            if let Some(operation) = operation {
                entries.push((
                    "continue",
                    format!("Continue {operation}…"),
                    operation.into(),
                    None,
                    true,
                ));
                entries.push((
                    "abort",
                    format!("Abort {operation}…"),
                    operation.into(),
                    None,
                    true,
                ));
                if operation != "merge" {
                    entries.push((
                        "skip",
                        format!("Skip current {operation} commit…"),
                        operation.into(),
                        None,
                        true,
                    ));
                }
            }
            entries.extend([
                (
                    "fetch",
                    "Fetch all remotes".into(),
                    String::new(),
                    None,
                    true,
                ),
                ("pull", format!("Pull {current}"), String::new(), None, true),
                ("push", format!("Push {current}"), String::new(), None, true),
                (
                    "pushSetUpstream",
                    format!("Publish {current}…"),
                    current.clone(),
                    None,
                    true,
                ),
                (
                    "createBranch",
                    "Create branch at HEAD…".into(),
                    "HEAD".into(),
                    None,
                    true,
                ),
                (
                    "stashPush",
                    "Stash working changes…".into(),
                    String::new(),
                    None,
                    true,
                ),
            ]);
        } else {
            let hash = hash.to_owned();
            entries.extend([
                (
                    "createBranch",
                    "Create branch here…".into(),
                    hash.clone(),
                    None,
                    true,
                ),
                (
                    "createTag",
                    "Create tag here…".into(),
                    hash.clone(),
                    None,
                    true,
                ),
                (
                    "cherryPick",
                    "Cherry-pick commit…".into(),
                    hash.clone(),
                    None,
                    true,
                ),
                ("revert", "Revert commit…".into(), hash.clone(), None, true),
                ("copy", "Copy commit SHA".into(), hash.clone(), None, true),
            ]);
            for reference in refs {
                let name = reference
                    .full_name
                    .strip_prefix("refs/heads/")
                    .unwrap_or(&reference.full_name)
                    .to_owned();
                match reference.kind {
                    GitGraphRefKind::Head
                    | GitGraphRefKind::LocalBranch
                    | GitGraphRefKind::RemoteBranch
                        if reference.full_name.starts_with("refs/heads/")
                            || reference.kind == GitGraphRefKind::RemoteBranch =>
                    {
                        entries.push((
                            "checkout",
                            format!("Checkout {}", reference.display_name),
                            name.clone(),
                            None,
                            true,
                        ));
                        entries.push((
                            "copy",
                            format!("Copy branch name: {}", reference.display_name),
                            reference.display_name.clone(),
                            None,
                            true,
                        ));
                        if reference.full_name.starts_with("refs/heads/") {
                            if name == current {
                                entries.push((
                                    "pull",
                                    format!("Pull {name}"),
                                    String::new(),
                                    None,
                                    true,
                                ));
                                entries.push((
                                    "push",
                                    format!("Push {name}"),
                                    String::new(),
                                    None,
                                    true,
                                ));
                            }
                            entries.push((
                                "renameBranch",
                                format!("Rename {name}…"),
                                name.clone(),
                                None,
                                true,
                            ));
                            entries.push((
                                "setUpstream",
                                format!("Set upstream for {name}…"),
                                name.clone(),
                                None,
                                true,
                            ));
                            entries.push((
                                "pushSetUpstream",
                                format!("Push {name} and set upstream…"),
                                name.clone(),
                                None,
                                true,
                            ));
                            entries.push((
                                "deleteBranch",
                                format!("Delete {name}…"),
                                name.clone(),
                                None,
                                name != current && reference.worktree_path.is_none(),
                            ));
                            if let Some(upstream) = &reference.upstream {
                                entries.push((
                                    "deleteRemoteBranch",
                                    format!("Delete {upstream}…"),
                                    format!("refs/remotes/{upstream}"),
                                    None,
                                    true,
                                ));
                                entries.push((
                                    "deleteBranch",
                                    format!("Delete {name} and {upstream}…"),
                                    name.clone(),
                                    Some(format!("refs/remotes/{upstream}")),
                                    name != current && reference.worktree_path.is_none(),
                                ));
                            }
                        } else {
                            entries.push((
                                "deleteRemoteBranch",
                                format!("Delete {}…", reference.display_name),
                                name,
                                None,
                                true,
                            ));
                        }
                    }
                    GitGraphRefKind::Tag => {
                        let name = reference
                            .full_name
                            .strip_prefix("refs/tags/")
                            .unwrap_or(&reference.full_name)
                            .to_owned();
                        entries.push((
                            "deleteTag",
                            format!("Delete tag {name}…"),
                            name,
                            None,
                            true,
                        ));
                    }
                    _ => {}
                }
            }
        }
        let mut seen = HashSet::new();
        entries.retain(|(action, _, target, remote, _)| {
            seen.insert((*action, target.clone(), remote.clone()))
        });
        entries
    }

    pub(super) fn git_menu(&self) -> El {
        let (_, hash, refs) = self.git_menu.as_ref().unwrap();
        let mut menu = menu_surface()
            .key("git-context-menu")
            .min_w(ui(240.))
            .max_w(ui(460.))
            .max_h(ui(560.))
            .modal(true, |s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut() {
                    view.git_menu = None;
                }
            });
        if self
            .branch_drag
            .as_ref()
            .is_some_and(|drag| drag.from_menu && drag.active)
        {
            menu = menu.opacity(0.);
        }
        for (index, (action, text, target, remote, enabled)) in
            self.git_menu_entries(hash, refs).into_iter().enumerate()
        {
            let enabled = enabled && !self.mutating;
            let mut entry = button(&text).key(format!("git-menu-{action}-{index}"));
            if !enabled {
                entry = entry.opacity(0.4);
            }
            if enabled && action == "checkout" {
                let reference = refs.iter().find(|r| {
                    r.full_name == target || r.full_name == format!("refs/heads/{target}")
                });
                let color = self
                    .graph
                    .commits
                    .iter()
                    .find(|commit| commit.hash == *hash)
                    .map_or(0, |commit| commit.color_index);
                let badge = graph::BranchBadge {
                    label: reference.map_or_else(|| target.clone(), |r| r.label.clone()),
                    tint: self.commit_tint(color),
                    is_head: reference.is_some_and(|r| r.is_head),
                    companion: reference.is_some_and(|r| {
                        r.kind != GitGraphRefKind::RemoteBranch
                            && refs.iter().any(|other| {
                                other.kind == GitGraphRefKind::RemoteBranch
                                    && other.label == r.label
                            })
                    }),
                    ghost: false,
                };
                entry = entry.on_drag(super::branches::branch_drag(
                    &self.path,
                    target.clone(),
                    badge,
                    true,
                ));
            }
            entry = entry.on_press_tx(act(&self.path, move |view, tx| {
                if !enabled {
                    return;
                }
                match action {
                    "copy" => {
                        tx.copy(target.clone());
                        view.git_menu = None;
                    }
                    "checkout" => view.run_branch_action("checkout", target.clone(), String::new()),
                    _ => view.request_git_action(action, target.clone(), remote.clone()),
                }
            }));
            menu = menu.child(entry);
        }
        menu
    }
}

fn prompt_input(
    path: String,
) -> impl for<'a> Fn(&'a mut Workspace) -> &'a mut TextInput + Clone + 'static {
    move |s: &mut Workspace| {
        &mut s
            .repository_views
            .get_mut(&path)
            .and_then(|view| view.git_prompt.as_mut())
            .expect("git prompt")
            .input
    }
}

pub(super) fn action_presentation(action: &str) -> Value {
    match action {
        "continue" => {
            json!({"title":"Continue Git operation", "copy":"Continue after resolving and staging conflicts.", "confirm":"Continue"})
        }
        "abort" => {
            json!({"title":"Abort Git operation", "copy":"Abort the in-progress operation and return to its starting state.", "confirm":"Abort"})
        }
        "skip" => {
            json!({"title":"Skip current commit", "copy":"Skip the current commit and continue the in-progress operation.", "confirm":"Skip"})
        }
        _ => inferay_presentation::git_actions::CATALOG[action].clone(),
    }
}

#[cfg(test)]
#[path = "actions_tests.rs"]
mod tests;
