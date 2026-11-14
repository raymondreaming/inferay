use super::*;
use crate::icons;
use crate::input::{self, TextInput};
use crate::ui::{Ink, button_ink, composer_surface, icon_sized};
use crate::zoom::ui;
use rune::{El, col, el, row};

pub(super) struct Draft {
    pub(super) input: TextInput,
    pub(super) amend: bool,
}

impl Draft {
    fn new() -> Self {
        let mut input = TextInput::field("Commit message…");
        input.submit_on_enter = false;
        input.height_limits = (18., 110.);
        input.typography = (12., 18.);
        Self {
            input,
            amend: false,
        }
    }
}

impl RepositoryView {
    pub(super) fn commit_panel(&self) -> El {
        let cwd = self.work_cwd();
        let mut drafts = self.commit_drafts.borrow_mut();
        let draft = drafts.entry(cwd.clone()).or_insert_with(Draft::new);
        let amend = draft.amend;
        let focused = draft.input.is_focused();
        let path = self.path.clone();
        let access_cwd = cwd.clone();
        let field = input::field(&draft.input, "commit-message", move |s: &mut Workspace| {
            &mut s
                .repository_views
                .get_mut(&path)
                .expect("repository view")
                .commit_drafts
                .get_mut()
                .get_mut(&access_cwd)
                .expect("commit draft")
                .input
        });
        let path = self.path.clone();
        let newline_cwd = cwd.clone();
        let field = input::newline_on_enter(field, move |s: &mut Workspace| {
            &mut s
                .repository_views
                .get_mut(&path)
                .expect("repository view")
                .commit_drafts
                .get_mut()
                .get_mut(&newline_cwd)
                .expect("commit draft")
                .input
        });
        let field = input::frame(&draft.input, field);
        let small = Ink::new(11.);
        let focus_cwd = cwd.clone();
        let shell = composer_surface("commit-input-shell", self.commit_generating || focused)
            .px(ui(8.))
            .gap(ui(4.))
            .on_background_press(move |s: &mut Workspace| {
                if let Some(view) = s.current_repository_mut()
                    && let Some(draft) = view.commit_drafts.get_mut().get_mut(&focus_cwd)
                {
                    draft.input.focus();
                }
            })
            .child(
                col()
                    .key("commit-message-input")
                    .px(ui(4.))
                    .py(ui(6.))
                    .child(field),
            )
            .child(
                row()
                    .key("commit-input-options")
                    .flex_wrap()
                    .gap(ui(4.))
                    .items_center()
                    .child(
                        button_ink(if amend { "✓ Amend" } else { "Amend" }, small)
                            .key("amend-commit")
                            .h(ui(24.))
                            .px(ui(4.))
                            .role("checkbox")
                            .checked(amend)
                            .label("Amend last commit")
                            .on_press_tx(act(&self.path, |view, _| view.toggle_amend())),
                    )
                    .child(el().grow(1.))
                    .child(
                        button_ink(
                            if self.commit_generating {
                                "Generating…"
                            } else {
                                "Generate"
                            },
                            small,
                        )
                        .key("generate-commit-message")
                        .child(icon_sized(&icons::SPARKLES, 13.))
                        .h(ui(24.))
                        .px(ui(4.))
                        .label("Generate commit message with Codex Luna, low reasoning")
                        .on_press_tx(act(&self.path, |view, _| view.generate_commit_message())),
                    )
                    .child(
                        button_ink(
                            if self.mutating {
                                "Working…"
                            } else if amend {
                                "Amend commit"
                            } else {
                                "Commit"
                            },
                            small,
                        )
                        .key("commit-staged")
                        .child(icon_sized(&icons::CHECK, 13.))
                        .h(ui(24.))
                        .px(ui(4.))
                        .on_press_tx(act(&self.path, |view, _| view.submit_commit())),
                    ),
            );
        col().key("commit-composer").padding(ui(8.)).child(shell)
    }

    pub(super) fn draft_content(&self, cwd: &str) -> Option<String> {
        self.commit_drafts
            .borrow()
            .get(cwd)
            .map(|draft| draft.input.content().to_owned())
    }

    pub(super) fn toggle_amend(&mut self) {
        if self.mutating || self.commit_generating {
            return;
        }
        let cwd = self.work_cwd();
        let Some(draft) = self.commit_drafts.get_mut().get_mut(&cwd) else {
            return;
        };
        draft.amend = !draft.amend;
        if draft.amend && draft.input.content().trim().is_empty() {
            let work_cwd = cwd.clone();
            self.commit_prepare_task = Some(self.spawn(
                move || {
                    inferay_native_diff::get_git_commit_details_for_parent(&work_cwd, "HEAD", None)
                },
                move |view, details, _| {
                    if let Some(draft) = view.commit_drafts.get_mut().get_mut(&cwd)
                        && draft.amend
                        && draft.input.content().trim().is_empty()
                        && let Some(details) = details
                    {
                        let message = if details.body.is_empty() {
                            details.message
                        } else {
                            format!("{}\n\n{}", details.message, details.body)
                        };
                        draft.input.set_content(&message);
                    }
                },
            ));
        }
    }

    pub(super) fn generate_commit_message(&mut self) {
        if self.mutating || self.commit_generating {
            return;
        }
        let Some(backend) = self.backend.get().cloned() else {
            self.error = Some("Inferay services are not connected yet.".into());
            return;
        };
        let cwd = self.work_cwd();
        let Some(original) = self.draft_content(&cwd) else {
            return;
        };
        self.commit_generating = true;
        self.error = None;
        let work_cwd = cwd.clone();
        self.commit_prepare_task = Some(self.spawn(
            move || {
                crate::backend::RUNTIME.block_on(backend.request(
                    reqwest::Method::POST,
                    "/api/git/generate-commit-message",
                    Some(json!({"cwd":work_cwd})),
                ))
            },
            move |view, result, _| {
                view.commit_generating = false;
                match result {
                    Ok(value) => {
                        if let Some(draft) = view.commit_drafts.get_mut().get_mut(&cwd)
                            && draft.input.content() == original
                            && let Some(message) = value["message"].as_str()
                        {
                            draft.input.set_content(message);
                        }
                    }
                    Err(error) => view.error = Some(error.to_string()),
                }
            },
        ));
    }

    pub(super) fn submit_commit(&mut self) {
        if self.mutating || self.commit_generating {
            return;
        }
        let cwd = self.work_cwd();
        let Some((message, amend)) = self
            .commit_drafts
            .get_mut()
            .get(&cwd)
            .map(|draft| (draft.input.content().to_owned(), draft.amend))
        else {
            return;
        };
        if message.trim().is_empty() {
            self.error = Some("Enter a commit message first.".into());
            return;
        }
        self.mutating = true;
        self.error = None;
        let work_cwd = cwd.clone();
        let work_message = message.clone();
        self.mutation_task = Some(self.spawn(
            move || inferay_native_diff::commit_git(&work_cwd, &work_message, amend),
            move |view, result, _| {
                view.mutating = false;
                if result.success {
                    if let Some(draft) = view.commit_drafts.get_mut().get_mut(&cwd)
                        && draft.input.content() == message
                    {
                        draft.input.set_content("");
                        draft.amend = false;
                    }
                    view.clear_diff();
                    view.file = None;
                    view.show_diff = false;
                }
                view.task = None;
                view.loading = false;
                view.refresh();
                view.error = result.error;
            },
        ));
    }
}

#[cfg(test)]
#[path = "commit_tests.rs"]
mod tests;
