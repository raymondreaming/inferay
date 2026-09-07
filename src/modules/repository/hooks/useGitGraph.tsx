import { useCallback, useMemo, useRef, useState } from "octane";
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
	cwd: string | undefined,
	limit = DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	preferences: GraphSemanticPreferences = {
		hiddenRefs: [],
		soloRefs: [],
		pinnedRefs: [],
	},
) {
	const preferenceKey = JSON.stringify(preferences);
	const [search, setSearch] = useState({
		cwd,
		query: "",
	});
	const searchQuery = search.cwd === cwd ? search.query : "";
	const setSearchQuery = useCallback(
		(query: string) =>
			setSearch({
				cwd,
				query,
			}),
		[cwd],
	);
	const readGraph = useMemo(createGitGraphReader, []);
	const fetchGraph = useCallback(
		(signal?: AbortSignal) =>
			readGraph(cwd, limit, searchQuery, preferences, signal),
		[readGraph, cwd, limit, searchQuery, preferenceKey],
	);
	const { data, loading, error, refresh } = usePollingQuery<GraphData>(
		fetchGraph,
		3000,
		EMPTY_GRAPH,
		{
			queryKey: ["git", "graph", cwd ?? "", limit, searchQuery, preferenceKey],
			enabled: !!cwd,
		},
	);
	const visible = useRef({ cwd, data: EMPTY_GRAPH });
	if (visible.current.cwd !== cwd) visible.current = { cwd, data: EMPTY_GRAPH };
	if (data !== EMPTY_GRAPH) visible.current.data = data;
	return {
		...visible.current.data,
		searchQuery,
		setSearchQuery,
		loading,
		error,
		refresh,
	};
}
export function useCommitDetails(
	cwd: string | undefined,
	hash: string | undefined,
	parent?: string,
	repositoryRevision?: string,
) {
	const request = useCallback(
		(signal?: AbortSignal) => fetchCommitDetails(cwd, hash, parent, signal),
		[cwd, hash, parent],
	);
	const { data, loading, error } = useQueryResource<GitCommitDetails | null>(
		request,
		null,
		{
			queryKey: [
				"git",
				"commit",
				cwd ?? "",
				repositoryRevision ?? "",
				hash ?? "",
				parent ?? "",
			],
			staleTime: 60_000,
			gcTime: 5 * 60_000,
		},
	);
	return {
		details: data,
		loading,
		error,
	};
}
export function useComparisonDetails(
	cwd: string | undefined,
	fromHash: string | undefined,
	toHash: string | undefined,
	repositoryRevision?: string,
	selection?: Array<{
		id: string;
		hash: string;
		itemKind: GitGraphItemKind;
		historyOrder?: number;
		worktreePath?: string;
	}>,
) {
	const selectionKey = selection ? JSON.stringify(selection) : undefined;
	const fetchComparison = useCallback(
		(signal?: AbortSignal) =>
			fetchComparisonDetails(cwd, fromHash, toHash, selectionKey, signal),
		[cwd, fromHash, toHash, selectionKey],
	);
	const { data, loading } = useQueryResource<{
		details: GitComparisonDetails | null;
		plan: ComparisonPlan | null;
	} | null>(fetchComparison, null, {
		queryKey: [
			"git",
			"comparison",
			cwd ?? "",
			repositoryRevision ?? "",
			fromHash ?? "",
			toHash ?? "",
			selectionKey ?? "",
		],
		staleTime: 60_000,
		gcTime: 5 * 60_000,
	});
	return {
		details: data?.details ?? null,
		plan: data?.plan ?? null,
		loading,
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
	let response: { key: string; etag: string; data: GraphData } | null = null;
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
