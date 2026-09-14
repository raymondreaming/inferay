//! Action presentation belongs with native Git behavior; the renderer consumes this catalog.
use serde_json::{Value, json};
use std::sync::LazyLock;

#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphActionRequest {
    #[serde(default)]
    #[ts(
        type = "'createBranch' | 'createTag' | 'cherryPick' | 'revert' | 'stashPush' | 'stashApply' | 'stashPop' | 'stashDrop' | 'stashRename' | 'renameBranch' | 'deleteBranch' | 'deleteTag' | 'setUpstream' | 'pushSetUpstream' | 'deleteRemoteBranch' | 'pushTag' | 'deleteRemoteTag' | 'forcePushWithLease' | 'resetSoft' | 'resetMixed' | 'resetHard' | 'fetch' | 'pull' | 'push'"
    )]
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub targets: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct GitRefOperationRequest {
    #[serde(default)]
    pub operation: String,
    #[serde(default = "start_operation")]
    #[ts(type = "'start' | 'continue' | 'skip' | 'abort'")]
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target: Option<String>,
}
fn start_operation() -> String {
    "start".into()
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphActionPresentation {
    title: String,
    copy: String,
    confirm: String,
    needs_name: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    name_label: Option<String>,
    message_label: Option<String>,
    danger: bool,
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct GitActionSelection {
    commit: Option<String>,
}
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GitActionResponse {
    #[serde(flatten)]
    result: inferay_core::repository::GitOperationResult,
    error_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    selection: Option<GitActionSelection>,
}

pub static CATALOG: LazyLock<Value> = LazyLock::new(|| {
    let entries = [
        (
            "createBranch",
            "Create branch",
            "Create a new local branch at the selected commit.",
            json!({"needsName":true}),
        ),
        (
            "createTag",
            "Create tag",
            "Create a lightweight tag, or enter a message for an annotated tag.",
            json!({"needsName":true,"messageLabel":"Annotation (optional)"}),
        ),
        (
            "cherryPick",
            "Cherry-pick commit",
            "Apply this commit on top of the currently checked-out branch.",
            json!({"confirm":"Cherry-pick"}),
        ),
        (
            "revert",
            "Revert commit",
            "Create a new commit that reverses the selected commit.",
            json!({}),
        ),
        (
            "stashPush",
            "Stash worktree changes",
            "Store tracked and untracked changes from the current worktree.",
            json!({"confirm":"Create stash","messageLabel":"Stash message (optional)"}),
        ),
        (
            "stashApply",
            "Apply stash",
            "Apply this stash while keeping it in the stash list.",
            json!({}),
        ),
        (
            "stashPop",
            "Pop stash",
            "Apply this stash and remove it if the apply succeeds.",
            json!({"danger":true}),
        ),
        (
            "stashDrop",
            "Delete stash",
            "Permanently remove this stash from the repository.",
            json!({"danger":true}),
        ),
        (
            "stashRename",
            "Rename stash",
            "Replace this stash's displayed message while preserving its saved tree.",
            json!({"needsName":true,"nameLabel":"New stash message"}),
        ),
        (
            "renameBranch",
            "Rename branch",
            "Rename this local branch. Its commits and working tree are preserved.",
            json!({"needsName":true,"nameLabel":"New branch name"}),
        ),
        (
            "deleteBranch",
            "Delete local branch",
            "Delete this local branch only if Git confirms it is merged and not checked out in a worktree.",
            json!({"confirm":"Delete branch","danger":true}),
        ),
        (
            "deleteTag",
            "Delete local tag",
            "Remove this tag from the local repository. Remote tags are unchanged.",
            json!({"confirm":"Delete tag","danger":true}),
        ),
        (
            "setUpstream",
            "Set branch upstream",
            "Set the tracking branch without pushing or changing either branch.",
            json!({"confirm":"Set upstream","needsName":true,"nameLabel":"Upstream (for example origin/main)"}),
        ),
        (
            "pushSetUpstream",
            "Push and set upstream",
            "Push this local branch to the named remote and configure it as the tracking upstream.",
            json!({"confirm":"Push branch","needsName":true,"nameLabel":"Remote name"}),
        ),
        (
            "deleteRemoteBranch",
            "Delete remote branch",
            "Ask the configured remote to permanently delete this branch, then prune its tracking ref.",
            json!({"danger":true}),
        ),
        (
            "pushTag",
            "Push tag",
            "Publish this tag to the named remote.",
            json!({"needsName":true,"nameLabel":"Remote name"}),
        ),
        (
            "deleteRemoteTag",
            "Delete remote tag",
            "Permanently remove this tag from the named remote. The local tag is kept.",
            json!({"needsName":true,"nameLabel":"Remote name","danger":true}),
        ),
        (
            "forcePushWithLease",
            "Force push with lease",
            "Rewrite the configured upstream only if it still points to the commit last fetched locally. This can replace remote history.",
            json!({"danger":true}),
        ),
        (
            "resetSoft",
            "Soft reset branch",
            "Move the current branch to this commit while keeping all resulting changes staged.",
            json!({"confirm":"Reset --soft","danger":true}),
        ),
        (
            "resetMixed",
            "Mixed reset branch",
            "Move the current branch to this commit and keep resulting changes unstaged in the worktree.",
            json!({"confirm":"Reset --mixed","danger":true}),
        ),
        (
            "resetHard",
            "Hard reset branch",
            "Move the current branch to this commit and permanently discard tracked index and worktree changes.",
            json!({"confirm":"Reset --hard","danger":true}),
        ),
        (
            "fetch",
            "Fetch all remotes",
            "Update remote-tracking refs and prune deleted remote refs without changing the worktree.",
            json!({"confirm":"Fetch"}),
        ),
        (
            "pull",
            "Pull current branch",
            "Fetch and integrate the configured upstream using this repository's pull policy.",
            json!({"confirm":"Pull"}),
        ),
        (
            "push",
            "Push current branch",
            "Push the current branch to its configured upstream. Force push is never used.",
            json!({"confirm":"Push"}),
        ),
    ];
    Value::Object(
        entries
            .into_iter()
            .map(|(key, title, copy, options)| {
                let action = GraphActionPresentation {
                    title: title.into(),
                    copy: copy.into(),
                    confirm: options["confirm"].as_str().unwrap_or(title).into(),
                    needs_name: options["needsName"] == true,
                    name_label: options["nameLabel"].as_str().map(str::to_owned),
                    message_label: options["messageLabel"].as_str().map(str::to_owned),
                    danger: options["danger"] == true,
                };
                (key.into(), json!(action))
            })
            .collect(),
    )
});

pub fn operation_payload(
    result: inferay_core::repository::GitOperationResult,
    ref_operation: bool,
) -> Value {
    use inferay_core::repository::GitOperationErrorKind::*;
    let label = match result.error_kind {
        Some(Conflict) => "Merge conflict",
        Some(DirtyWorktree) => "Working tree has changes",
        Some(Authentication) => "Authentication failed",
        Some(NonFastForward) => "Remote contains newer commits",
        Some(Network) => "Network unavailable",
        Some(WorktreeInUse) => "Branch is open in another worktree",
        Some(InvalidInput) => "Invalid Git action",
        Some(Io) => "Git could not be started",
        _ => "Git command failed",
    };
    let select_head = ref_operation
        || matches!(
            result.operation.as_str(),
            "cherryPick" | "revert" | "resetSoft" | "resetMixed" | "resetHard"
        );
    let selection =
        (result.ok && select_head && (ref_operation || result.head.is_some())).then(|| {
            GitActionSelection {
                commit: result.head.clone(),
            }
        });
    json!(GitActionResponse {
        result,
        error_label: label.into(),
        selection
    })
}

pub fn failed_operation(input: &Value) -> Value {
    use inferay_core::repository::{GitOperationOutcome, GitOperationResult};
    operation_payload(
        GitOperationResult {
            ok: false,
            operation: crate::string(&input["operation"]).into(),
            outcome: GitOperationOutcome::Failed,
            head: None,
            conflicts: Vec::new(),
            error_kind: serde_json::from_value(input["errorKind"].clone()).ok(),
            error: Some(crate::string(&input["error"]).into()),
        },
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use inferay_core::repository::{
        GitOperationErrorKind, GitOperationOutcome, GitOperationResult,
    };

    fn result(operation: &str, head: Option<&str>) -> GitOperationResult {
        GitOperationResult {
            ok: true,
            operation: operation.into(),
            outcome: GitOperationOutcome::Completed,
            head: head.map(str::to_owned),
            conflicts: Vec::new(),
            error_kind: None,
            error: None,
        }
    }

    #[test]
    fn ref_actions_can_clear_selection_but_failed_actions_preserve_it() {
        assert_eq!(
            operation_payload(result("merge", None), true)["selection"],
            json!({"commit": null})
        );
        assert_eq!(
            operation_payload(result("merge", Some("merged")), true)["selection"],
            json!({"commit": "merged"})
        );
        for ref_operation in [false, true] {
            let mut failed = result("revert", Some("unchanged"));
            failed.ok = false;
            failed.outcome = GitOperationOutcome::Conflicted;
            failed.error_kind = Some(GitOperationErrorKind::Conflict);
            failed.conflicts.push("conflict.txt".into());
            let payload = operation_payload(failed, ref_operation);
            assert!(payload.get("selection").is_none());
            assert_eq!(payload["errorLabel"], "Merge conflict");
            assert_eq!(payload["conflicts"], json!(["conflict.txt"]));
        }
    }
}
