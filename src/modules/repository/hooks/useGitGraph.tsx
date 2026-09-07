import { useCallback, useMemo, useRef, useState } from "octane";
import type { ComparisonPlan } from "../../../../build/presentation/contracts/ComparisonPlan.ts";
import type { GitCommitDetails } from "../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitComparisonDetails } from "../../../../build/presentation/contracts/GitComparisonDetails.ts";
import type { GitGraphItemKind } from "../../../../build/presentation/contracts/GitGraphItemKind.ts";
import {
	usePollingQuery,
	useQueryResource,
} from "../../../shared/hooks/useQueryResource.tsx";
import { DEFAULT_GIT_GRAPH_HISTORY_LIMIT } from "../../workbench/graph/model/graph-model.ts";
import {
	createGitGraphReader,
	EMPTY_GRAPH,
	fetchCommitDetails,
	fetchComparisonDetails,
	type GraphData,
	type GraphSemanticPreferences,
} from "../model/git-graph.ts";
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
