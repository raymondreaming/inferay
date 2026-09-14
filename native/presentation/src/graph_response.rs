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
