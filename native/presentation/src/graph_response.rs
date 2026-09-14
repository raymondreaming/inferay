//! Pure graph presentation shared by native responses and renderer fallbacks.
use crate::git_actions;
use inferay_core::repository::{GitGraphRef, GitGraphSnapshot};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(serde::Serialize, ts_rs::TS)]
pub struct GraphData<'a> {
    #[serde(flatten)]
    snapshot: &'a GitGraphSnapshot,
    presentation: GraphPresentation<'a>,
    #[ts(as = "BTreeMap<String, git_actions::GraphActionPresentation>")]
    actions: &'a Value,
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphSemanticPreferences<'a> {
    pub hidden_refs: &'a [String],
    pub solo_refs: &'a [String],
    pub pinned_refs: &'a [String],
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphPresentation<'a> {
    pub containing_branches: BTreeMap<&'a str, &'a GitGraphRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default_remote_name: Option<&'a str>,
    pub hidden_ref_details: Vec<&'a GitGraphRef>,
    pub hidden_ref_names: &'a [String],
    pub pinned_columns: Vec<usize>,
    pub pinned_ref_names: &'a [String],
    pub reachable_history: BTreeSet<&'a String>,
    pub selectable_items: Vec<&'a String>,
}

pub fn response(
    snapshot: GitGraphSnapshot,
    hidden: &[String],
    solo: &[String],
    pinned: &[String],
) -> Value {
    let preferences = GraphSemanticPreferences {
        hidden_refs: hidden,
        solo_refs: solo,
        pinned_refs: pinned,
    };
    use inferay_core::repository::GitGraphRefKind;
    let commits = &snapshot.commits;
    let refs = commits
        .iter()
        .flat_map(|commit| &commit.refs)
        .map(|reference| (reference.full_name.as_str(), reference))
        .collect::<BTreeMap<_, _>>();
    let containing = commits
        .iter()
        .filter_map(|commit| {
            Some((
                commit.id.as_str(),
                *refs.get(commit.navigation.containing_branch.as_deref()?)?,
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let mut reachable = BTreeSet::new();
    for name in preferences.solo_refs {
        for [start, end] in snapshot.ancestry.get(name).into_iter().flatten() {
            reachable.extend(
                commits
                    .iter()
                    .take(end.saturating_add(1))
                    .skip(*start)
                    .map(|commit| &commit.id),
            );
        }
    }
    let pinned_columns = preferences
        .pinned_refs
        .iter()
        .filter_map(|name| {
            let target = &refs.get(name.as_str())?.target;
            commits
                .iter()
                .find(|commit| &commit.hash == target || &commit.id == target)
                .map(|commit| commit.column)
        })
        .collect::<Vec<_>>();
    let presentation = GraphPresentation {
        containing_branches: containing,
        default_remote_name: refs
            .values()
            .find(|reference| reference.kind == GitGraphRefKind::RemoteBranch)
            .and_then(|reference| reference.remote_name.as_deref()),
        hidden_ref_details: preferences
            .hidden_refs
            .iter()
            .filter_map(|name| refs.get(name.as_str()).copied())
            .collect::<Vec<_>>(),
        hidden_ref_names: preferences.hidden_refs,
        pinned_columns,
        pinned_ref_names: preferences.pinned_refs,
        reachable_history: reachable,
        selectable_items: commits.iter().map(|commit| &commit.id).collect::<Vec<_>>(),
    };
    json!(GraphData {
        snapshot: &snapshot,
        presentation,
        actions: &git_actions::CATALOG
    })
}

#[cfg(test)]
mod graph_response_tests {
    use super::*;
    use inferay_core::repository::*;
    use serde_json::json;

    #[test]
    fn graph_preferences_preserve_branch_identity_reachability_and_pinned_columns() {
        let reference: GitGraphRef =
            serde_json::from_value(json!({"fullName":"refs/remotes/origin/main",
            "displayName":"origin/main", "label":"main", "kind":"remoteBranch", "target":"tip",
            "remoteName":"origin", "isHead":false}))
            .unwrap();
        let snapshot = GitGraphSnapshot {
            commits: vec![
                GraphCommit {
                    id: "tip".into(),
                    hash: "tip".into(),
                    column: 2,
                    refs: vec![reference.clone()],
                    navigation: GraphNavigation {
                        containing_branch: Some(reference.full_name.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                GraphCommit {
                    id: "base".into(),
                    hash: "base".into(),
                    ..Default::default()
                },
            ],
            rows: vec![],
            has_more: false,
            worktrees: vec![],
            stashes: vec![],
            revision: "fixture".into(),
            ancestry: [(reference.full_name.clone(), vec![[0, 1]])].into(),
            operation: GitRepositoryOperationState {
                kind: GitRepositoryOperationKind::Idle,
                phase: GitRepositoryOperationPhase::Idle,
                conflicts: vec![],
            },
            state: GitRepositorySnapshotState::Ready,
            state_error: None,
        };
        let refs = vec![reference.full_name.clone(), "missing".into()];
        let response = response(snapshot.clone(), &refs, &refs, &refs);
        assert_eq!(
            response["presentation"],
            json!({
                "containingBranches":{"tip":reference}, "defaultRemoteName":"origin",
                "hiddenRefDetails":[reference], "hiddenRefNames":refs,
                "pinnedColumns":[2], "pinnedRefNames":refs, "reachableHistory":["base","tip"],
                "selectableItems":["tip","base"],
            })
        );
        assert_eq!(response["commits"], json!(snapshot.commits));
        assert_eq!(response["actions"], git_actions::CATALOG.clone());
    }
}
