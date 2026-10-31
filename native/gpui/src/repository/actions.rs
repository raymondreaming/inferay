use super::*;
use crate::input::TextInput;

pub(super) struct GitPrompt {
    action: &'static str,
    target: String,
    remote: Option<String>,
    input: Entity<TextInput>,
}

impl RepositoryView {
    fn mutate_git(
        &mut self,
        reset_selection: bool,
        work: impl FnOnce(&str) -> Option<String> + Send + 'static,
        cx: &mut Context<Self>,
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
        let cwd = self.cwd.clone();
        let work = cx.background_executor().spawn(async move { work(&cwd) });
        self.mutation_task = Some(cx.spawn(async move |this, cx| {
            let error = work.await;
            let _ = this.update(cx, |s, cx| {
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
                s.refresh(cx);
                s.error = error;
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn run_branch_action(
        &mut self,
        operation: &'static str,
        source: String,
        target: String,
        cx: &mut Context<Self>,
    ) {
        self.mutate_git(
            true,
            move |cwd| {
                if operation == "checkout" {
                    inferay_native_diff::checkout_git_branch(cwd, &source).error
                } else {
                    inferay_native_diff::perform_git_ref_operation(cwd, operation, &source, &target)
                        .error
                }
            },
            cx,
        );
    }

    fn run_graph_action(
        &mut self,
        action: &'static str,
        target: String,
        name: String,
        remote: Option<String>,
        cx: &mut Context<Self>,
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
            cx,
        );
    }

    fn request_git_action(
        &mut self,
        action: &'static str,
        target: String,
        remote: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.mutating {
            return;
        }
        let catalog = action_presentation(action);
        if catalog["needsConfirm"] == false {
            self.run_graph_action(action, target, String::new(), remote, cx);
            return;
        }
        let input = cx.new(|cx| {
            let mut input = TextInput::field(catalog["nameLabel"].as_str().unwrap_or("Name"), cx);
            input.height_limits = (30., 30.);
            input.typography = (12., 20.);
            input
        });
        if catalog["needsName"] == true {
            window.focus(&input.focus_handle(cx), cx);
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
        cx.notify();
    }

    pub(super) fn git_prompt(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let prompt = self.git_prompt.as_ref().unwrap();
        let mut catalog = action_presentation(prompt.action);
        if prompt.remote.is_some() {
            catalog["title"] = json!("Delete local and remote branches");
            catalog["copy"] = json!(
                "Delete the merged local branch, then delete its upstream branch from the remote. If the remote deletion fails, the local deletion remains complete."
            );
            catalog["confirm"] = json!("Delete both");
        }
        crate::menu_surface("git-action-prompt").debug_selector(|| "git-action-prompt".into()).top(ui(40.)).right(ui(12.)).w(ui(360.)).p(ui(12.)).gap(ui(10.))
            .child(div().text_size(ui(14.)).child(catalog["title"].as_str().unwrap_or("Git action").to_owned()))
            .child(div().text_size(ui(12.)).child(catalog["copy"].as_str().unwrap_or_default().to_owned()))
            .child(div().text_size(ui(12.)).child(if let Some(remote) = &prompt.remote {format!("{} and {remote}", prompt.target)} else {prompt.target.clone()}))
            .when(catalog["needsName"] == true, |d| d.child(prompt.input.clone()))
            .child(div().flex().justify_end().gap(ui(8.))
                .child(button("cancel-git-action", "Cancel").on_click(cx.listener(|s, _, window, cx| { s.git_prompt = None; window.focus(&s.focus, cx); cx.notify(); })))
                .child(button("confirm-git-action", catalog["confirm"].as_str().unwrap_or("Confirm").to_owned()).debug_selector(|| "confirm-git-action".into())
                    .on_click(cx.listener(|s, _, window, cx| {
                        let Some(prompt) = s.git_prompt.as_ref() else { return; };
                        let name = prompt.input.read(cx).content.to_string();
                        if inferay_presentation::git_actions::CATALOG[prompt.action]["needsName"] == true && name.trim().is_empty() { return; }
                        let (action, target, remote) = (prompt.action, prompt.target.clone(), prompt.remote.clone());
                        window.focus(&s.focus, cx);
                        s.run_graph_action(action, target, name, remote, cx);
                    }))))
    }

    pub(super) fn git_menu(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let (position, hash, refs) = self.git_menu.as_ref().unwrap();
        let current = self
            .status
            .as_ref()
            .map(|status| status.branch.clone())
            .unwrap_or_default();
        let mut entries: Vec<(&'static str, String, String, Option<String>, bool)> = vec![];
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
        let mut seen = std::collections::HashSet::new();
        entries.retain(|(action, _, target, remote, _)| {
            seen.insert((*action, target.clone(), remote.clone()))
        });
        let menu = crate::menu_surface("git-context-menu")
            .relative()
            .debug_selector(|| "git-context-menu".into())
            .min_w(ui(240.))
            .max_w(ui(460.))
            .max_h(ui(560.))
            .on_mouse_down_out(cx.listener(|s, _, _, cx| {
                s.git_menu = None;
                cx.notify();
            }))
            .children(entries.into_iter().enumerate().map(
                |(index, (action, label, target, remote, enabled))| {
                    let enabled = enabled && !self.mutating;
                    let local = refs
                        .iter()
                        .any(|r| r.full_name == format!("refs/heads/{target}"));
                    button(SharedString::from(format!("git-menu-{index}")), label)
                        .debug_selector(move || format!("git-menu-{action}-{index}"))
                        .when(!enabled, |d| d.opacity(0.4))
                        .when(enabled && action == "checkout" && local, |d| {
                            let view = cx.entity();
                            d.on_drag(
                                graph::BranchDrag {
                                    cwd: self.cwd.clone(),
                                    name: target.clone(),
                                },
                                move |drag, _, _, cx| {
                                    view.update(cx, |s, cx| {
                                        s.git_menu = None;
                                        cx.notify();
                                    });
                                    cx.new(|_| drag.clone())
                                },
                            )
                        })
                        .on_click(cx.listener(move |s, _, window, cx| {
                            if !enabled {
                                return;
                            }
                            match action {
                                "copy" => {
                                    cx.write_to_clipboard(ClipboardItem::new_string(
                                        target.clone(),
                                    ));
                                    s.git_menu = None;
                                    cx.notify();
                                }
                                "checkout" => s.run_branch_action(
                                    "checkout",
                                    target.clone(),
                                    String::new(),
                                    cx,
                                ),
                                _ => s.request_git_action(
                                    action,
                                    target.clone(),
                                    remote.clone(),
                                    window,
                                    cx,
                                ),
                            }
                        }))
                },
            ));
        deferred(anchored().position(*position).snap_to_window().child(menu)).with_priority(2)
    }
}

fn action_presentation(action: &str) -> Value {
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
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn branch_prompt_and_remote_deletion_use_named_targets(cx: &mut TestAppContext) {
        let directory = tempfile::tempdir().unwrap();
        let remote = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let git = |args: &[&str]| {
            let output = inferay_native_diff::git_command()
                .current_dir(&root)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "UI test"]);
        git(&["config", "user.email", "test@example.invalid"]);
        git(&[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Base",
        ]);
        git(&["init", "--bare", remote.path().to_str().unwrap()]);
        git(&["remote", "add", "origin", remote.path().to_str().unwrap()]);
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = RepositoryView::new(
                root.to_string_lossy().into_owned(),
                Value::Null,
                "vscode-black".into(),
                0,
                cx,
            );
            view.avatars.insert(
                "test@example.invalid".into(),
                Arc::new(Image::from_bytes(ImageFormat::Png, vec![])),
            );
            view
        });
        cx.run_until_parked();
        cx.update(|window, cx| {
            view.update(cx, |s, cx| {
                s.request_git_action("createBranch", "HEAD".into(), None, window, cx)
            })
        });
        view.update(cx, |s, cx| {
            s.git_prompt
                .as_ref()
                .unwrap()
                .input
                .update(cx, |input, cx| input.set_content("topic", cx))
        });
        assert!(
            !git(&["branch", "--list"]).contains("topic"),
            "prompt does not execute before confirmation"
        );
        cx.simulate_resize(size(px(1000.), px(600.)));
        cx.draw(point(px(0.), px(0.)), size(px(1000.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        let confirm = cx.debug_bounds("confirm-git-action").unwrap().center();
        cx.simulate_click(confirm, Modifiers::default());
        cx.run_until_parked();
        assert!(git(&["branch", "--list"]).contains("topic"));
        assert_eq!(git(&["branch", "--show-current"]), "main");
        view.update(cx, |s, cx| {
            s.run_graph_action("pushSetUpstream", "topic".into(), "origin".into(), None, cx)
        });
        cx.run_until_parked();
        assert!(git(&["ls-remote", "origin", "refs/heads/topic"]).contains("refs/heads/topic"));
        view.update(cx, |s, cx| {
            s.run_graph_action(
                "deleteBranch",
                "topic".into(),
                String::new(),
                Some("refs/remotes/origin/topic".into()),
                cx,
            )
        });
        cx.run_until_parked();
        assert!(!git(&["branch", "--list"]).contains("topic"));
        assert!(git(&["ls-remote", "origin", "refs/heads/topic"]).is_empty());
        view.update(cx, |s, cx| {
            s.run_graph_action("deleteBranch", "main".into(), String::new(), None, cx)
        });
        cx.run_until_parked();
        view.read_with(cx, |s, _| {
            assert!(s.error.as_deref().unwrap().contains("checked-out branch"))
        });
        assert_eq!(git(&["branch", "--show-current"]), "main");
    }
}
