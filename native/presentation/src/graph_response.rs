//! Pure graph presentation shared by native responses and renderer fallbacks.
use crate::git_actions;
use inferay_core::repository::{GitGraphRef, GitGraphSnapshot};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub fn annotate_pull_requests(
    snapshot: &mut GitGraphSnapshot,
    pull_requests: &[inferay_core::repository::MergedPullRequest],
) {
    use inferay_core::repository::{GitGraphItemKind, GitGraphRefKind, GraphPullRequest};
    // Results are newest first. Hash matches take precedence over branch-name
    // matches: reusing a branch must not relabel a known integrated commit.
    for commit in &mut snapshot.commits {
        commit.pull_request = None;
        if commit.item_kind != GitGraphItemKind::Commit {
            continue;
        }
        let exact = pull_requests
            .iter()
            .find(|pr| commit.hash == pr.merge_hash || commit.hash == pr.head_hash);
        let local = exact.or_else(|| {
            pull_requests.iter().find(|pr| {
                !pr.from_fork
                    && commit.refs.iter().any(|reference| {
                        reference.kind == GitGraphRefKind::LocalBranch
                            && reference.full_name.strip_prefix("refs/heads/")
                                == Some(pr.head_branch.as_str())
                    })
            })
        });
        if let Some(pr) = local {
            commit.pull_request = Some(GraphPullRequest {
                merged: pr.clone(),
                local_branch_differs: commit.hash != pr.head_hash && commit.hash != pr.merge_hash,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use inferay_core::repository::{GitGraphItemKind, GraphCommit, MergedPullRequest};

    #[test]
    fn merged_pr_badges_distinguish_local_rework_without_changing_topology() {
        let mut pr = MergedPullRequest {
            number: 206,
            url: "https://github.com/example/sketch/pull/206".into(),
            base_branch: "develop".into(),
            head_branch: "measurement-labels".into(),
            head_hash: "original".into(),
            merge_hash: "squashed".into(),
            from_fork: false,
        };
        let mut snapshot = GitGraphSnapshot {
            commits: ["squashed", "original", "amended", "same-title", "wip"]
                .into_iter().enumerate().map(|(column, hash)| GraphCommit {
                    id: hash.into(), hash: hash.into(),
                    message: "Measurement labels (#206)".into(),
                    parents: vec!["base".into()], column,
                    item_kind: if hash == "wip" { GitGraphItemKind::WorktreeWip } else { GitGraphItemKind::Commit },
                    refs: if hash == "amended" || hash == "wip" {
                        vec![serde_json::from_value(json!({
                            "fullName":"refs/heads/measurement-labels", "displayName":"measurement-labels",
                            "label":"measurement-labels", "kind":"localBranch", "target":hash, "isHead":false
                        })).unwrap()]
                    } else { vec![] },
                    ..Default::default()
                }).collect(),
            ..Default::default()
        };
        let before = snapshot.clone();
        annotate_pull_requests(&mut snapshot, std::slice::from_ref(&pr));
        for (index, differs) in [(0, false), (1, false), (2, true)] {
            let badge = snapshot.commits[index].pull_request.as_ref().unwrap();
            assert_eq!(badge.merged.number, 206);
            assert_eq!(badge.local_branch_differs, differs);
        }
        assert!(
            snapshot.commits[3..]
                .iter()
                .all(|commit| commit.pull_request.is_none())
        );
        // A matching branch name from someone else's fork proves nothing about
        // our local branch; exact commit matches remain valid.
        pr.from_fork = true;
        annotate_pull_requests(&mut snapshot, &[pr]);
        assert!(snapshot.commits[0].pull_request.is_some());
        assert!(snapshot.commits[2].pull_request.is_none());
        annotate_pull_requests(&mut snapshot, &[]);
        assert_eq!(snapshot, before);
    }
}

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
