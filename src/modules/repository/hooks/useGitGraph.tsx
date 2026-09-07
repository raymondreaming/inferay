import { type Accessor, createMemo, createSignal, merge } from "solid-js";
import type { ComparisonPlan } from "../../../../build/presentation/contracts/ComparisonPlan.ts";
import type { GitCommitDetails } from "../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitComparisonDetails } from "../../../../build/presentation/contracts/GitComparisonDetails.ts";
import type { GitGraphItemKind } from "../../../../build/presentation/contracts/GitGraphItemKind.ts";
import type { GitGraphRef } from "../../../../build/presentation/contracts/GitGraphRef.ts";
import type { GitRepositoryOperationState } from "../../../../build/presentation/contracts/GitRepositoryOperationState.ts";
import type { GitRepositorySnapshotState } from "../../../../build/presentation/contracts/GitRepositorySnapshotState.ts";
import type { GitStash } from "../../../../build/presentation/contracts/GitStash.ts";
import type { GitWorktree } from "../../../../build/presentation/contracts/GitWorktree.ts";
import type { GraphActionPresentation } from "../../../../build/presentation/contracts/GraphActionPresentation.ts";
import type { GraphCommit } from "../../../../build/presentation/contracts/GraphCommit.ts";
import type { GraphRow } from "../../../../build/presentation/contracts/GraphRow.ts";
import {
	usePollingQuery,
	useQueryResource,
} from "../../../shared/hooks/useQueryResource.tsx";
import { DEFAULT_GIT_GRAPH_HISTORY_LIMIT } from "../../workbench/graph/components/CommitGraph/useCommitGraphState.tsx";
export function useGitGraph(
	_cwd: Accessor<string | undefined>,
	_limit: Accessor<number> = () => DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	_preferences: Accessor<GraphSemanticPreferences> = () => ({
		hiddenRefs: [],
		soloRefs: [],
		pinnedRefs: [],
	}),
) {
	const preferenceKey = createMemo(() => JSON.stringify(_preferences()));
	const [search, setSearch] = createSignal({
		cwd: _cwd(),
		query: "",
	});
	const searchQuery = createMemo(() => {
		const _searchValue = search();
		return _searchValue.cwd === _cwd() ? _searchValue.query : "";
	});
	const setSearchQuery = (query: string) =>
		setSearch({
			cwd: _cwd(),
			query,
		});
	const readGraph = createMemo(createGitGraphReader);
	const fetchGraph = (signal?: AbortSignal) =>
		readGraph()(_cwd(), _limit(), searchQuery(), _preferences(), signal);
	const _source3 = usePollingQuery<GraphData>(
		() => fetchGraph,
		() => 3000,
		() => EMPTY_GRAPH,
		() => {
			const _cwdValue = _cwd();
			return {
				queryKey: [
					"git",
					"graph",
					_cwdValue ?? "",
					_limit(),
					searchQuery(),
					preferenceKey(),
				],
				enabled: !!_cwdValue,
			};
		},
	);
	const visible = createMemo(
		(previous: { cwd: string | undefined; data: GraphData } | undefined) => {
			const cwd = _cwd();
			const data = _source3.data;
			return {
				cwd,
				data:
					data !== EMPTY_GRAPH
						? data
						: previous && previous.cwd === cwd
							? previous.data
							: EMPTY_GRAPH,
			};
		},
	);
	return merge(
		() => {
			return visible().data;
		},
		{
			get searchQuery() {
				return searchQuery();
			},
			get setSearchQuery() {
				return setSearchQuery;
			},
			get loading() {
				return _source3.loading;
			},
			get error() {
				return _source3.error;
			},
			get refresh() {
				return _source3.refresh;
			},
		},
	);
}
export function useCommitDetails(
	_cwd2: Accessor<string | undefined>,
	_hash: Accessor<string | undefined>,
	_parent: Accessor<string | undefined> = () => undefined,
	_repositoryRevision: Accessor<string | undefined> = () => undefined,
) {
	const request = (signal?: AbortSignal) =>
		fetchCommitDetails(_cwd2(), _hash(), _parent(), signal);
	const _source2 = useQueryResource<GitCommitDetails | null>(
		() => request,
		() => null,
		() => ({
			queryKey: [
				"git",
				"commit",
				_cwd2() ?? "",
				_repositoryRevision() ?? "",
				_hash() ?? "",
				_parent() ?? "",
			],
			staleTime: 60_000,
			gcTime: 5 * 60_000,
		}),
	);
	return {
		get details() {
			return _source2.data;
		},
		get loading() {
			return _source2.loading && !_source2.data;
		},
		get error() {
			return _source2.error;
		},
	};
}
export function useComparisonDetails(
	_cwd3: Accessor<string | undefined>,
	_fromHash: Accessor<string | undefined>,
	_toHash: Accessor<string | undefined>,
	_repositoryRevision2: Accessor<string | undefined> = () => undefined,
	_selection: Accessor<
		| Array<{
				id: string;
				hash: string;
				itemKind: GitGraphItemKind;
				historyOrder?: number;
				worktreePath?: string;
		  }>
		| undefined
	> = () => undefined,
) {
	const selectionKey = createMemo(() => {
		const _selectionValue = _selection();
		return _selectionValue ? JSON.stringify(_selectionValue) : undefined;
	});
	const fetchComparison = (signal?: AbortSignal) =>
		fetchComparisonDetails(
			_cwd3(),
			_fromHash(),
			_toHash(),
			selectionKey(),
			signal,
		);
	const _source = useQueryResource<{
		details: GitComparisonDetails | null;
		plan: ComparisonPlan | null;
	} | null>(
		() => fetchComparison,
		() => null,
		() => ({
			queryKey: [
				"git",
				"comparison",
				_cwd3() ?? "",
				_repositoryRevision2() ?? "",
				_fromHash() ?? "",
				_toHash() ?? "",
				selectionKey() ?? "",
			],
			staleTime: 60_000,
			gcTime: 5 * 60_000,
		}),
	);
	return {
		get details() {
			return _source.data?.details ?? null;
		},
		get plan() {
			return _source.data?.plan ?? null;
		},
		get loading() {
			return _source.loading && !_source.data?.details;
		},
	};
}
export interface GraphData {
	actions: Record<string, GraphActionPresentation>;
	commits: GraphCommit[];
	rows: GraphRow[];
	hasMore: boolean;
	worktrees: GitWorktree[];
	stashes: GitStash[];
	revision: string;
	operation: GitRepositoryOperationState;
	presentation: GraphPresentation;
	state: GitRepositorySnapshotState;
	stateError?: string;
}
export interface GraphSemanticPreferences {
	hiddenRefs: string[];
	soloRefs: string[];
	pinnedRefs: string[];
}
export interface GraphPresentation {
	containingBranches: Record<string, GitGraphRef>;
	defaultRemoteName?: string;
	hiddenRefDetails: GitGraphRef[];
	hiddenRefNames: string[];
	pinnedColumns: number[];
	pinnedRefNames: string[];
	reachableHistory: string[];
	selectableItems: string[];
}
export const EMPTY_GRAPH: GraphData = {
	actions: {},
	commits: [],
	rows: [],
	hasMore: false,
	worktrees: [],
	stashes: [],
	revision: "",
	operation: {
		kind: "idle",
		phase: "idle",
		conflicts: [],
	},
	presentation: {
		containingBranches: {},
		hiddenRefDetails: [],
		hiddenRefNames: [],
		pinnedColumns: [],
		pinnedRefNames: [],
		reachableHistory: [],
		selectableItems: [],
	},
	state: "empty",
};
export function createGitGraphReader() {
	let response: {
		key: string;
		etag: string;
		data: GraphData;
	} | null = null;
	return async (
		cwd: string | undefined,
		limit: number,
		searchQuery: string,
		preferences: GraphSemanticPreferences,
		signal?: AbortSignal,
	): Promise<GraphData> => {
		if (!cwd) return EMPTY_GRAPH;
		const preferenceKey = JSON.stringify(preferences);
		const key = `${cwd}\0${limit}\0${searchQuery}\0${preferenceKey}`;
		const cached = response?.key === key ? response : null;
		const res = await fetch(
			`/api/git/graph?cwd=${encodeURIComponent(cwd)}&limit=${limit}&query=${encodeURIComponent(searchQuery)}&hiddenRefs=${encodeURIComponent(JSON.stringify(preferences.hiddenRefs))}&soloRefs=${encodeURIComponent(JSON.stringify(preferences.soloRefs))}&pinnedRefs=${encodeURIComponent(JSON.stringify(preferences.pinnedRefs))}`,
			{
				signal,
				headers: cached
					? {
							"If-None-Match": cached.etag,
						}
					: undefined,
			},
		);
		if (res.status === 304 && cached) return cached.data;
		if (!res.ok) {
			const error = await res.json().catch(() => null);
			throw new Error(error?.error || "Failed to fetch Git history");
		}
		const data = (await res.json()) as GraphData;
		const etag = res.headers?.get("etag");
		if (etag && !signal?.aborted)
			response = {
				key,
				etag,
				data,
			};
		return data;
	};
}
export async function fetchCommitDetails(
	cwd: string | undefined,
	hash: string | undefined,
	parent?: string,
	signal?: AbortSignal,
): Promise<GitCommitDetails | null> {
	if (!cwd || !hash) return null;
	const parentQuery = parent ? `&parent=${encodeURIComponent(parent)}` : "";
	const res = await fetch(
		`/api/git/commit-details?cwd=${encodeURIComponent(cwd)}&hash=${encodeURIComponent(hash)}${parentQuery}`,
		{
			signal,
		},
	);
	if (!res.ok) throw new Error("Failed to fetch commit details");
	const json = await res.json();
	// The bundled Rust server owns the canonical commit-details schema.
	return (json.details ?? null) as GitCommitDetails | null;
}
export async function fetchComparisonDetails(
	cwd: string | undefined,
	fromHash: string | undefined,
	toHash: string | undefined,
	selectionKey?: string,
	signal?: AbortSignal,
) {
	if (!cwd || (!selectionKey && (!fromHash || !toHash || fromHash === toHash)))
		return null;
	const query = selectionKey
		? ""
		: `from=${encodeURIComponent(fromHash!)}&to=${encodeURIComponent(toHash!)}`;
	const res = await fetch(
		`/api/git/comparison-details?cwd=${encodeURIComponent(cwd)}&${query}`,
		selectionKey
			? {
					signal,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: `{"selection":${selectionKey}}`,
				}
			: {
					signal,
				},
	);
	if (!res.ok) throw new Error("Failed to compare commits");
	return (await res.json()) as {
		details: GitComparisonDetails | null;
		plan: ComparisonPlan | null;
	};
}
