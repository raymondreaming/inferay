import type { GitChangeSummary, GitStatusResult, GraphData } from "@contracts";
import {
	commitGitChanges,
	discardGitChanges,
	loadGitStatuses,
	loadGitSummaries,
	runGitChangeAction,
	stashGitFile,
} from "@repository/services/gitApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { createExternalSignal, queryClient } from "@shared/lib/dom.tsx";
import { type Accessor, createMemo, createSignal } from "solid-js";
import type { useGitGraph } from "./useGitGraph.tsx";

const EMPTY_GIT_PROJECTS: GitStatusResult[] = [];
export function useGitStatus(
	_cwds: Accessor<string[]>,
	_options: Accessor<{
		enabled: boolean;
		graph?: ReturnType<typeof useGitGraph>;
	}>,
) {
	const graph = createMemo(() => _options().graph);
	const graphProjects = createMemo(() => {
		const _graphValue = graph();
		return _graphValue?.revision &&
			!_graphValue.error &&
			_graphValue.state !== "commandFailed"
			? _graphValue.worktrees.flatMap((worktree) =>
					worktree.status ? [worktree.status] : [],
				)
			: EMPTY_GIT_PROJECTS;
	});
	// The graph owns the first status read too. Keep the changes panel loading
	// until that request settles; failures then use the independent status query.
	const pendingGraphCwd = createMemo(() => {
		const current = graph();
		return current && !current.loaded && _cwds().includes(current.cwd ?? "")
			? current.cwd
			: undefined;
	});
	const cwdKey = createMemo(() =>
		_cwds()
			.filter(
				(cwd) =>
					cwd !== pendingGraphCwd() &&
					!graphProjects().some((project) => project.cwd === cwd),
			)
			.join("\u0000"),
	);
	const requestedCwds = createMemo(() => {
		const _cwdKeyValue = cwdKey();
		return _cwdKeyValue ? _cwdKeyValue.split("\u0000") : [];
	});
	const _source = useQueryResource(() => {
		const cwds = requestedCwds();
		return {
			queryKey: ["git", "status", cwdKey()],
			queryFn: ({ signal }) => loadGitStatuses(cwds, signal),
			initialData: EMPTY_GIT_PROJECTS,
			refetchInterval: 5000,
			staleTime: 5000,
			enabled: _options().enabled && cwds.length > 0,
		};
	});

	const projects = createMemo(() =>
		[..._source.data, ...graphProjects()].filter((project) =>
			_cwds().includes(project.cwd),
		),
	);
	const projectMap = createMemo(
		() => new Map(projects().map((project) => [project.cwd, project])),
	);
	const refetch = async () => {
		await Promise.all([
			requestedCwds().length > 0 ? _source.refresh() : undefined,
			graph()?.refresh(),
		]);
	};
	return {
		get projects() {
			return projects();
		},
		get projectMap() {
			return projectMap();
		},
		refetch,
		get loaded() {
			return (
				!_options().enabled ||
				(!pendingGraphCwd() && (requestedCwds().length === 0 || _source.loaded))
			);
		},
	};
}
export function useGitSummaries(
	cwds: Accessor<string[]>,
	enabled: Accessor<boolean>,
) {
	// Active graphs already refresh native line totals every three seconds.
	// Observe that existing query cache; closing or failing a graph immediately
	// returns its repositories to the independent sidebar query.
	const cache = queryClient.getQueryCache();
	const graphSummaries = createExternalSignal<Record<string, GitChangeSummary>>(
		(notify) =>
			cache.subscribe(({ query }) => {
				if (query.queryKey[0] === "git" && query.queryKey[1] === "graph")
					notify();
			}),
		() =>
			Object.fromEntries(
				cache
					.findAll({ queryKey: ["git", "graph"], type: "active" })
					.filter(
						(query) =>
							query.state.status === "success" && !query.state.isInvalidated,
					)
					.sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)
					.flatMap((query) => {
						const graph = queryClient.getQueryData<GraphData>(query.queryKey);
						return graph?.revision && graph.state !== "commandFailed"
							? graph.worktrees.flatMap((tree) =>
									tree.changeSummary ? [[tree.path, tree.changeSummary]] : [],
								)
							: [];
					}),
			),
	);
	const source = useQueryResource<Record<string, GitChangeSummary>>(() => {
		const paths = cwds().filter((cwd) => !graphSummaries()[cwd]);
		return {
			queryKey: ["git", "summaries", paths.join("\u0000")],
			queryFn: ({ signal }) => loadGitSummaries(paths, signal),
			initialData: {},
			refetchInterval: 5000,
			staleTime: 5000,
			enabled: enabled() && paths.length > 0,
		};
	});
	return createMemo(() => ({ ...source.data, ...graphSummaries() }));
}
export function useGitChangeActions(
	_options2: Accessor<{
		cwd?: string;
		refetchStatus: () => undefined | Promise<unknown>;
	}>,
) {
	const [commitMessage, setCommitMessage] = createSignal("");
	const [isCommitting, setIsCommitting] = createSignal(false);
	const gitAction = (action: "stage" | "unstage", file?: string) => {
		const cwd = _options2().cwd;
		if (!cwd) return;
		void runGitChangeAction(cwd, action, file)
			.catch(() => {
				/* swallow; refetch below restores truth */
			})
			.finally(() => {
				void _options2().refetchStatus();
			});
	};
	const runReported = (work: (cwd: string) => Promise<void>) => {
		const cwd = _options2().cwd;
		if (!cwd) return;
		void work(cwd)
			.catch((error: unknown) => {
				alert(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				void _options2().refetchStatus();
			});
	};
	const commit = async () => {
		const _options2Value2 = _options2(),
			_commitMessageValue = commitMessage();
		if (!_options2Value2.cwd || !_commitMessageValue.trim() || isCommitting())
			return;
		setIsCommitting(true);
		try {
			if (await commitGitChanges(_options2Value2.cwd, _commitMessageValue)) {
				setCommitMessage("");
				void _options2Value2.refetchStatus();
			}
		} finally {
			setIsCommitting(false);
		}
	};
	return {
		commit,
		get commitMessage() {
			return commitMessage();
		},
		setCommitMessage,
		get isCommitting() {
			return isCommitting();
		},
		stageFile: (file: string) => gitAction("stage", file || undefined),
		unstageFile: (file: string) => gitAction("unstage", file || undefined),
		stageAll: () => gitAction("stage"),
		unstageAll: () => gitAction("unstage"),
		stashFile: (file: string) => runReported((cwd) => stashGitFile(cwd, file)),
		discard: (staged: boolean, file?: string) => {
			const scope = staged ? "staged" : "unstaged";
			const prompt = file
				? `Discard ${scope} changes to ${file}?`
				: `Discard all ${scope} changes?${staged ? "" : " Staged changes are kept. New untracked files are deleted."}`;
			if (!confirm(`${prompt} This cannot be undone.`)) return;
			runReported((cwd) => discardGitChanges(cwd, staged, file));
		},
	};
}
