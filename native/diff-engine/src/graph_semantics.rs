//! Repository semantics prepared once alongside graph layout. The client keeps
//! row geometry and interaction, without repeating ancestry walks per keypress.
use crate::{GitGraphRefKind, GraphCommit};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNavigation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_order: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub containing_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_newer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_older: Option<String>,
}

/// Inclusive row intervals, usually one interval per branch even in long
/// histories. Avoid copying an ID for every ancestor of every branch.
pub type GraphAncestry = BTreeMap<String, Vec<[usize; 2]>>;

pub(crate) fn prepare(commits: &mut [GraphCommit]) -> GraphAncestry {
    let by_hash: HashMap<_, _> = commits
        .iter()
        .enumerate()
        .filter(|(_, c)| c.item_kind != crate::GitGraphItemKind::WorktreeWip)
        .map(|(i, c)| (c.hash.clone(), i))
        .collect();
    let mut branches: Vec<_> = commits
        .iter()
        .flat_map(|c| &c.refs)
        .filter(|r| {
            matches!(
                r.kind,
                GitGraphRefKind::Head
                    | GitGraphRefKind::LocalBranch
                    | GitGraphRefKind::RemoteBranch
            )
        })
        .cloned()
        .collect();
    branches.sort_by(|a, b| {
        crate::graph_ref_kind_order(&a.kind)
            .cmp(&crate::graph_ref_kind_order(&b.kind))
            .then_with(|| a.display_name.cmp(&b.display_name))
    });
    branches.dedup_by(|a, b| a.full_name == b.full_name);
    let mut owners = vec![None; commits.len()];
    let mut pending = VecDeque::new();
    for (branch, reference) in branches.iter().enumerate() {
        if let Some(&row) = by_hash.get(&reference.target) {
            if owners[row].is_none() {
                owners[row] = Some(branch);
                pending.push_back(row);
            }
        }
    }
    while let Some(row) = pending.pop_front() {
        for parent in &commits[row].parents {
            if let Some(&parent_row) = by_hash.get(parent) {
                if owners[parent_row].is_none() {
                    owners[parent_row] = owners[row];
                    pending.push_back(parent_row);
                }
            }
        }
    }
    for row in 0..commits.len() {
        commits[row].navigation.containing_branch =
            owners[row].map(|i| branches[i].full_name.clone());
        commits[row].navigation.parent = commits[row]
            .parents
            .first()
            .and_then(|p| by_hash.get(p))
            .map(|&i| commits[i].id.clone());
        let child_id = commits[row].id.clone();
        for parent_row in commits[row]
            .parents
            .iter()
            .filter_map(|p| by_hash.get(p))
            .copied()
            .collect::<Vec<_>>()
        {
            if commits[parent_row].navigation.child.is_none() {
                commits[parent_row].navigation.child = Some(child_id.clone());
            }
        }
    }
    // Propagate 64 branch memberships together through the topologically
    // ordered DAG. Reuse one u64 per row across batches: O(V) working memory,
    // O((V + E) * ceil(B / 64)) propagation, and emit only interval boundaries.
    let mut ancestry = BTreeMap::new();
    let mut membership = vec![0u64; commits.len()];
    for batch in branches.chunks(64) {
        membership.fill(0);
        for (bit, reference) in batch.iter().enumerate() {
            if let Some(&row) = by_hash.get(&reference.target) {
                membership[row] |= 1 << bit;
            }
        }
        let mut ranges = vec![Vec::<[usize; 2]>::new(); batch.len()];
        let mut previous = 0u64;
        for row in 0..commits.len() {
            let current = membership[row];
            for parent in &commits[row].parents {
                if let Some(&parent_row) = by_hash.get(parent) {
                    membership[parent_row] |= current;
                }
            }
            let mut changed = previous ^ current;
            while changed != 0 {
                let bit = changed.trailing_zeros() as usize;
                let mask = 1u64 << bit;
                if current & mask != 0 {
                    ranges[bit].push([row, row]);
                } else if let Some(last) = ranges[bit].last_mut() {
                    last[1] = row - 1;
                }
                changed &= !mask;
            }
            previous = current;
        }
        for (bit, reference) in batch.iter().enumerate() {
            if previous & (1u64 << bit) != 0 {
                if let Some(last) = ranges[bit].last_mut() {
                    last[1] = commits.len() - 1;
                }
            }
            ancestry.insert(
                reference.full_name.clone(),
                std::mem::take(&mut ranges[bit]),
            );
        }
    }
    for row in 0..commits.len() {
        let Some(branch) = owners[row] else {
            continue;
        };
        let ranges = &ancestry[&branches[branch].full_name];
        let interval = ranges.partition_point(|range| range[1] < row);
        let Some(&[start, end]) = ranges.get(interval) else {
            continue;
        };
        let newer = if row > start {
            Some(row - 1)
        } else {
            interval.checked_sub(1).map(|i| ranges[i][1])
        };
        let older = if row < end {
            Some(row + 1)
        } else {
            ranges.get(interval + 1).map(|r| r[0])
        };
        commits[row].navigation.branch_newer = newer.map(|i| commits[i].id.clone());
        commits[row].navigation.branch_older = older.map(|i| commits[i].id.clone());
    }
    ancestry
}

fn terms(query: &str) -> Vec<(String, String)> {
    let mut quoted = false;
    let mut token = String::new();
    let mut tokens = Vec::new();
    for ch in query.chars().chain(std::iter::once(' ')) {
        if ch == '"' {
            quoted = !quoted;
        } else if ch.is_whitespace() && !quoted {
            if !token.is_empty() {
                tokens.push(std::mem::take(&mut token));
            }
        } else {
            token.push(ch);
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    tokens
        .into_iter()
        .map(|token| {
            let (field, value) = token.split_once(':').unwrap_or(("", &token));
            if matches!(
                field.to_lowercase().as_str(),
                "author" | "committer" | "message" | "ref" | "sha"
            ) {
                (field.to_lowercase(), value.to_lowercase())
            } else {
                (String::new(), token.to_lowercase())
            }
        })
        .collect()
}

fn matches(commit: &crate::GitCommit, terms: &[(String, String)]) -> bool {
    terms.iter().all(|(field, value)| {
        let refs: Vec<_> = commit
            .refs
            .iter()
            .flat_map(|r| [r.display_name.as_str(), r.full_name.as_str()])
            .collect();
        let candidates: Vec<&str> = match field.as_str() {
            "author" => vec![&commit.author, &commit.author_email],
            "committer" => vec![&commit.committer, &commit.committer_email],
            "message" => vec![&commit.message, &commit.body],
            "ref" => refs,
            "sha" => vec![&commit.hash],
            _ => [
                &[
                    commit.hash.as_str(),
                    &commit.message,
                    &commit.body,
                    &commit.author,
                    &commit.author_email,
                    &commit.committer,
                    &commit.committer_email,
                    &commit.date,
                    &commit.authored_at,
                    &commit.committed_at,
                ][..],
                refs.as_slice(),
            ]
            .concat(),
        };
        candidates
            .iter()
            .any(|candidate| candidate.to_lowercase().contains(value))
    })
}

/// Stream the repository, not the currently loaded graph. Stop after enough
/// matches; retain only one bounded record plus the returned rows. The caller's
/// native deadline applies while reading, and the child is killed and reaped.
pub(crate) fn read_history(
    cwd: &str,
    limit: usize,
    query: &str,
    refs: HashMap<String, Vec<crate::GitGraphRef>>,
) -> Result<Vec<(crate::GitCommit, usize)>, crate::GitCommandFailure> {
    use std::io::{BufRead, BufReader, Read};
    use std::process::{Command, Stdio};
    use std::time::Duration;
    let failure = |kind, detail: String| crate::GitCommandFailure {
        command: "git log".into(),
        kind,
        detail,
    };
    let mut child = Command::new("git")
        .args([
            "--no-optional-locks",
            "--no-pager",
            "-c",
            "log.showSignature=false",
            "log",
            "--date-order",
            "--format=%H%x1f%P%x1f%s%x1f%b%x1f%aN%x1f%aE%x1f%cN%x1f%cE%x1f%cr%x1f%aI%x1f%cI%x1e",
            "--all",
        ])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| failure(crate::GitCommandFailureKind::SpawnFailed, e.to_string()))?;
    let stdout = child.stdout.take().unwrap();
    let terms = terms(query);
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut matches_found = Vec::new();
        let mut history_order = 0usize;
        let mut record = Vec::new();
        let result = loop {
            record.clear();
            match reader
                .by_ref()
                .take(8 * 1024 * 1024)
                .read_until(0x1e, &mut record)
            {
                Ok(0) => break Ok((matches_found, false)),
                Ok(_) if record.len() == 8 * 1024 * 1024 => {
                    break Err("A commit record exceeded the 8 MiB graph limit".to_string())
                }
                Err(e) => break Err(e.to_string()),
                _ => {}
            }
            let text = String::from_utf8_lossy(&record);
            let text = text.trim_matches(|ch: char| ch == '\x1e' || ch.is_whitespace());
            if text.is_empty() {
                continue;
            }
            let commit = crate::parse_graph_record(text, &refs);
            if matches(&commit, &terms) {
                matches_found.push((commit, history_order));
            }
            history_order += 1;
            if matches_found.len() >= limit {
                break Ok((matches_found, true));
            }
        };
        let _ = sender.send(result);
    });
    let result = receiver.recv_timeout(crate::remaining_git_time(Duration::from_secs(10)));
    let stopped_early = matches!(&result, Ok(Ok((_, true))));
    if stopped_early || result.is_err() {
        let _ = child.kill();
    }
    // A parsing error also stops the reader before Git finishes writing.
    if matches!(&result, Ok(Err(_))) {
        let _ = child.kill();
    }
    use wait_timeout::ChildExt;
    let status = child.wait_timeout(crate::remaining_git_time(Duration::from_secs(10)));
    let status = match status {
        Ok(Some(status)) => Some(status),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    };
    if result.is_ok() {
        let _ = reader.join();
    } else {
        // A configured descendant may have inherited stdout. A deadline must
        // not become an unbounded join waiting for that pipe to close.
        drop(reader);
    }
    match result {
        Ok(Ok((commits, _))) if stopped_early || status.is_some_and(|s| s.success()) => Ok(commits),
        Ok(Err(detail)) => Err(failure(crate::GitCommandFailureKind::InvalidOutput, detail)),
        Err(_) => Err(failure(
            crate::GitCommandFailureKind::TimedOut,
            "Search exceeded the repository deadline".into(),
        )),
        _ => Err(failure(
            crate::GitCommandFailureKind::Failed,
            "Repository history could not be read".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn commit(hash: &str, parents: &[&str]) -> crate::GitCommit {
        crate::parse_graph_record(&format!("{hash}\x1f{}\x1fA message\x1fMultiline body\x1fFeature Author\x1ffeature@example.com\x1fRelease Manager\x1frelease@example.com\x1ftoday\x1f2026-09-04\x1f2026-09-04", parents.join(" ")), &HashMap::new())
    }
    fn branch(name: &str, target: &str, head: bool) -> crate::GitGraphRef {
        crate::GitGraphRef {
            full_name: format!("refs/heads/{name}"),
            display_name: name.into(),
            target: target.into(),
            kind: if head {
                GitGraphRefKind::Head
            } else {
                GitGraphRefKind::LocalBranch
            },
            remote_name: None,
            is_head: head,
            worktree_path: None,
            upstream: None,
            ahead: None,
            behind: None,
        }
    }
    #[test]
    fn attribution_ancestry_and_navigation_preserve_merge_semantics() {
        let mut history = vec![
            commit("feature", &["shared"]),
            commit("main", &["shared"]),
            commit("shared", &["root"]),
            commit("root", &[]),
            commit("unrelated", &[]),
        ];
        history[0].refs.push(branch("feature", "feature", false));
        history[1].refs.push(branch("main", "main", true));
        let (mut graph, _) = crate::layout_graph(&history);
        let ancestry = prepare(&mut graph);
        assert_eq!(ancestry["refs/heads/feature"], vec![[0, 0], [2, 3]]);
        assert_eq!(ancestry["refs/heads/main"], vec![[1, 3]]);
        assert_eq!(
            graph[2].navigation.containing_branch.as_deref(),
            Some("refs/heads/main")
        );
        assert_eq!(graph[2].navigation.branch_newer.as_deref(), Some("main"));
        assert_eq!(graph[2].navigation.branch_older.as_deref(), Some("root"));
        assert_eq!(graph[2].navigation.child.as_deref(), Some("feature"));
        assert_eq!(graph[2].navigation.parent.as_deref(), Some("root"));
        assert_eq!(graph[4].navigation, GraphNavigation::default());
    }
    #[test]
    fn high_overlap_histories_stay_compressed_across_bitset_batches() {
        let history: Vec<_> = (0..10_000)
            .map(|i| {
                commit(
                    &i.to_string(),
                    &if i < 9_999 {
                        vec![(i + 1).to_string()]
                    } else {
                        vec![]
                    }
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                )
            })
            .collect();
        let (mut graph, _) = crate::layout_graph(&history);
        for (i, node) in graph.iter_mut().enumerate().take(128) {
            node.refs
                .push(branch(&format!("b{i:03}"), &i.to_string(), i == 0));
        }
        let ancestry = prepare(&mut graph);
        assert_eq!(ancestry.len(), 128);
        for i in 0..128 {
            assert_eq!(ancestry[&format!("refs/heads/b{i:03}")], vec![[i, 9_999]]);
        }
        assert_eq!(
            graph[9_998].navigation.branch_older.as_deref(),
            Some("9999")
        );
        assert!(serde_json::to_vec(&ancestry).unwrap().len() < 5_000);
    }
    #[test]
    fn synthetic_worktree_hash_never_becomes_its_own_parent() {
        let (mut graph, _) =
            crate::layout_graph(&[commit("inferay-wip-current:/repo", &["unloaded-head"])]);
        prepare(&mut graph);
        assert_eq!(graph[0].navigation.parent, None);
        assert_eq!(graph[0].navigation.child, None);
    }

    #[test]
    fn scoped_search_supports_phrases_and_committer_identity() {
        let mut item = commit("abc123", &[]);
        item.refs.push(branch("main", "abc123", true));
        assert!(matches(&item, &terms("release manager")));
        assert!(matches(&item, &terms("committer:\"release manager\"")));
        assert!(matches(&item, &terms("author:feature ref:main sha:abc")));
        assert!(!matches(&item, &terms("author:release")));
        assert!(!matches(&item, &terms("message:missing")));
    }
    #[test]
    fn search_reads_matches_beyond_the_loaded_page() {
        let repository = tempfile::tempdir().unwrap();
        let cwd = repository.path().to_str().unwrap();
        let git = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .args(args)
                .current_dir(cwd)
                .output()
                .unwrap()
                .status
                .success())
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Graph Tester"]);
        git(&["config", "user.email", "graph@example.com"]);
        git(&["commit", "--allow-empty", "-m", "needle oldest"]);
        for _ in 0..4 {
            git(&["commit", "--allow-empty", "-m", "recent unrelated"]);
        }
        let first = crate::get_git_graph_snapshot(cwd, 2);
        assert!(first.commits.iter().all(|c| !c.message.contains("needle")));
        let result = crate::get_git_graph_snapshot_with_query(
            cwd,
            2,
            crate::prepare_git_graph(cwd),
            "message:needle",
        );
        assert_eq!(result.commits.len(), 1);
        assert_eq!(result.commits[0].message, "needle oldest");
        assert_eq!(result.commits[0].navigation.history_order, Some(4));
        assert_eq!(first.commits[0].navigation.history_order, Some(0));
        assert!(!result.has_more);
        assert_eq!(result.rows[0].row, 0);
    }
}
