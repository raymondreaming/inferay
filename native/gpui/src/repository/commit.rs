use super::*;
use crate::input::TextInput;

pub(super) struct Draft {
    pub(super) input: Entity<TextInput>,
    amend: bool,
}

impl RepositoryView {
    pub(super) fn commit_panel(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let cwd = self.selected_worktree.as_ref().unwrap_or(&self.cwd).clone();
        let draft = self
            .commit_drafts
            .entry(cwd.clone())
            .or_insert_with(|| Draft {
                input: cx.new(|cx| {
                    let mut input = TextInput::field("Commit message…", cx);
                    input.submit_on_enter = false;
                    input.height_limits = (18., 110.);
                    input.typography = (12., 18.);
                    input
                }),
                amend: false,
            });
        let input = draft.input.clone();
        let amend = draft.amend;
        let focus = input.focus_handle(cx);
        div()
            .id("commit-composer")
            .debug_selector(|| "commit-composer".into())
            .flex_shrink_0()
            .p(ui(8.))
            .child(
                crate::composer_surface(
                    "commit-border-beam",
                    self.commit_generating || focus.is_focused(window),
                )
                .id("commit-input-shell")
                .debug_selector(|| "commit-input-shell".into())
                .px(ui(8.))
                .gap(ui(4.))
                .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                    window.focus(&focus, cx);
                    cx.stop_propagation();
                })
                .child(
                    div()
                        .debug_selector(|| "commit-message-input".into())
                        .px(ui(4.))
                        .py(ui(6.))
                        .child(input),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .debug_selector(|| "commit-input-options".into())
                        .gap(ui(4.))
                        .items_center()
                        .child(
                            button("amend-commit", if amend { "✓ Amend" } else { "Amend" })
                                .h(ui(24.))
                                .px(ui(4.))
                                .text_size(ui(11.))
                                .role(Role::CheckBox)
                                .aria_selected(amend)
                                .aria_label("Amend last commit")
                                .on_click(cx.listener(|s, _, _, cx| s.toggle_amend(cx))),
                        )
                        .child(div().flex_1())
                        .child(
                            button(
                                "generate-commit-message",
                                if self.commit_generating {
                                    "Generating…"
                                } else {
                                    "Generate"
                                },
                            )
                            .child(icon("Sparkles").size(ui(13.)))
                            .h(ui(24.))
                            .px(ui(4.))
                            .text_size(ui(11.))
                            .aria_label("Generate commit message with Codex Luna, low reasoning")
                            .on_click(cx.listener(|s, _, _, cx| s.generate_commit_message(cx))),
                        )
                        .child(
                            button(
                                "commit-staged",
                                if self.mutating {
                                    "Working…"
                                } else if amend {
                                    "Amend commit"
                                } else {
                                    "Commit"
                                },
                            )
                            .debug_selector(|| "commit-staged".into())
                            .child(icon("Check").size(ui(13.)))
                            .h(ui(24.))
                            .px(ui(4.))
                            .text_size(ui(11.))
                            .on_click(cx.listener(|s, _, _, cx| s.submit_commit(cx))),
                        ),
                ),
            )
            .into_any_element()
    }

    fn toggle_amend(&mut self, cx: &mut Context<Self>) {
        if self.mutating || self.commit_generating {
            return;
        }
        let cwd = self.selected_worktree.as_ref().unwrap_or(&self.cwd).clone();
        let Some(draft) = self.commit_drafts.get_mut(&cwd) else {
            return;
        };
        draft.amend = !draft.amend;
        if draft.amend && draft.input.read(cx).content.trim().is_empty() {
            let work_cwd = cwd.clone();
            let work = cx.background_executor().spawn(async move {
                inferay_native_diff::get_git_commit_details_for_parent(&work_cwd, "HEAD", None)
            });
            self.commit_prepare_task = Some(cx.spawn(async move |this, cx| {
                let details = work.await;
                let _ = this.update(cx, |s, cx| {
                    if let Some(draft) = s.commit_drafts.get(&cwd)
                        && draft.amend
                        && draft.input.read(cx).content.trim().is_empty()
                        && let Some(details) = details
                    {
                        let message = if details.body.is_empty() {
                            details.message
                        } else {
                            format!("{}\n\n{}", details.message, details.body)
                        };
                        draft
                            .input
                            .update(cx, |input, cx| input.set_content(&message, cx));
                    }
                    cx.notify();
                });
            }));
        }
        cx.notify();
    }

    fn generate_commit_message(&mut self, cx: &mut Context<Self>) {
        if self.mutating || self.commit_generating {
            return;
        }
        let Some(backend) = self.backend.get().cloned() else {
            self.error = Some("Inferay services are not connected yet.".into());
            cx.notify();
            return;
        };
        let cwd = self.selected_worktree.as_ref().unwrap_or(&self.cwd).clone();
        let Some(draft) = self.commit_drafts.get(&cwd) else {
            return;
        };
        let original = draft.input.read(cx).content.clone();
        self.commit_generating = true;
        self.error = None;
        let work_cwd = cwd.clone();
        let work = cx.background_executor().spawn(async move {
            crate::backend::RUNTIME.block_on(backend.request(
                reqwest::Method::POST,
                "/api/git/generate-commit-message",
                Some(json!({"cwd":work_cwd})),
            ))
        });
        self.commit_prepare_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                s.commit_generating = false;
                match result {
                    Ok(value) => {
                        if let Some(draft) = s.commit_drafts.get(&cwd)
                            && draft.input.read(cx).content == original
                            && let Some(message) = value["message"].as_str()
                        {
                            draft
                                .input
                                .update(cx, |input, cx| input.set_content(message, cx));
                        }
                    }
                    Err(error) => s.error = Some(error.to_string()),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn submit_commit(&mut self, cx: &mut Context<Self>) {
        if self.mutating || self.commit_generating {
            return;
        }
        let cwd = self.selected_worktree.as_ref().unwrap_or(&self.cwd).clone();
        let Some(draft) = self.commit_drafts.get(&cwd) else {
            return;
        };
        let message = draft.input.read(cx).content.to_string();
        if message.trim().is_empty() {
            self.error = Some("Enter a commit message first.".into());
            cx.notify();
            return;
        }
        let amend = draft.amend;
        self.mutating = true;
        self.error = None;
        let work_cwd = cwd.clone();
        let work_message = message.clone();
        let work = cx
            .background_executor()
            .spawn(async move { inferay_native_diff::commit_git(&work_cwd, &work_message, amend) });
        self.mutation_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                s.mutating = false;
                if result.success {
                    if let Some(draft) = s.commit_drafts.get_mut(&cwd)
                        && draft.input.read(cx).content.as_ref() == message
                    {
                        draft
                            .input
                            .update(cx, |input, cx| input.set_content("", cx));
                        draft.amend = false;
                    }
                    s.clear_diff();
                    s.file = None;
                    s.show_diff = false;
                }
                s.task = None;
                s.loading = false;
                s.refresh(cx);
                s.error = result.error;
                cx.notify();
            });
        }));
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn composer_commits_staged_files_and_preloads_amend(cx: &mut TestAppContext) {
        cx.update(crate::input::bind);
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .args(args)
                .current_dir(&root)
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
        git(&["config", "commit.gpgsign", "false"]);
        std::fs::write(root.join("file.txt"), "staged").unwrap();
        git(&["add", "file.txt"]);
        let cwd = root.to_string_lossy().into_owned();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view =
                RepositoryView::new(cwd.clone(), Value::Null, "vscode-black".into(), 0, cx);
            view.changes = true;
            view
        });
        cx.run_until_parked();
        cx.simulate_resize(size(px(900.), px(600.)));
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("commit-composer").is_some());
        let empty_height = cx.debug_bounds("commit-input-shell").unwrap().size.height;
        assert_eq!(
            cx.debug_bounds("commit-message-input").unwrap().size.height,
            px(30.)
        );
        assert!(cx.debug_bounds("composer-border-beam").is_none());
        let composer = cx.debug_bounds("commit-composer").unwrap();
        cx.simulate_click(
            composer.origin + point(px(30.), px(18.)),
            Modifiers::default(),
        );
        cx.simulate_input("Commit through composer");
        view.read_with(cx, |s, cx| {
            assert_eq!(
                s.commit_drafts[&cwd].input.read(cx).content.as_ref(),
                "Commit through composer"
            )
        });
        cx.simulate_keystrokes("enter enter");
        cx.simulate_input("Details");
        cx.simulate_keystrokes("cmd-a cmd-c");
        assert_eq!(
            cx.read_from_clipboard()
                .and_then(|item| item.text())
                .as_deref(),
            Some("Commit through composer\n\nDetails")
        );
        view.read_with(cx, |s, _| {
            assert!(!s.mutating, "Enter edits the draft instead of committing");
            assert!(
                !s.show_diff,
                "Editor keys must not activate repository navigation"
            );
        });
        for width in [320., 900.] {
            cx.simulate_resize(size(px(width), px(600.)));
            cx.draw(point(px(0.), px(0.)), size(px(width), px(600.)), |_, _| {
                view.clone().into_any_element()
            });
            assert!(cx.debug_bounds("composer-border-beam").is_some());
            let shell = cx.debug_bounds("commit-input-shell").unwrap();
            assert!(
                shell.size.height > empty_height,
                "Multiline messages grow beyond the one-line composer"
            );
            let options = cx.debug_bounds("commit-input-options").unwrap();
            let submit = cx.debug_bounds("commit-staged").unwrap();
            assert!(options.top() >= shell.top() && options.bottom() <= shell.bottom());
            assert!(submit.left() >= shell.left() && submit.right() <= shell.right());
        }
        cx.update(|window, cx| {
            view.update(cx, |s, cx| {
                window.focus(&s.focus, cx);
                s.commit_generating = true;
                cx.notify();
            })
        });
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(
            cx.debug_bounds("composer-border-beam").is_some(),
            "Generation lights the border even without editor focus"
        );
        view.update(cx, |s, cx| {
            s.commit_generating = false;
            cx.notify();
        });
        cx.draw(point(px(0.), px(0.)), size(px(900.), px(600.)), |_, _| {
            view.clone().into_any_element()
        });
        assert!(cx.debug_bounds("composer-border-beam").is_none());
        let commit = cx.debug_bounds("commit-staged").unwrap().center();
        cx.simulate_click(commit, Modifiers::default());
        cx.run_until_parked();
        assert_eq!(
            git(&["log", "-1", "--format=%s"]),
            "Commit through composer"
        );
        view.update(cx, |s, cx| {
            assert!(s.commit_drafts[&cwd].input.read(cx).content.is_empty());
            s.toggle_amend(cx);
        });
        cx.run_until_parked();
        view.update(cx, |s, cx| {
            assert_eq!(
                s.commit_drafts[&cwd].input.read(cx).content.as_ref(),
                "Commit through composer\n\nDetails"
            );
            s.commit_drafts[&cwd].input.update(cx, |input, cx| {
                input.set_content("Amend through composer", cx)
            });
            s.submit_commit(cx);
        });
        cx.run_until_parked();
        assert_eq!(git(&["rev-list", "--count", "HEAD"]), "1");
        assert_eq!(git(&["log", "-1", "--format=%s"]), "Amend through composer");
    }
}
