import type {
	ComparisonPlan,
	DiffSource,
	GitCommitDetails,
	GitComparisonDetails,
	GitGraphItemKind,
	GraphData,
	GraphSemanticPreferences,
} from "@contracts";
import {
	loadGitCommitDetails,
	loadGitComparisonDetails,
	loadGitGraph,
} from "@repository/services/gitApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { project } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createMemo,
	createSignal,
	merge,
	untrack,
} from "solid-js";

export const DEFAULT_GIT_GRAPH_HISTORY_LIMIT = project<number>(
	"nextHistoryLimit",
	0,
);
const EMPTY_GRAPH = project<GraphData>("emptyGitGraph", null);
export function useGitGraph(
	_cwd: Accessor<string | undefined>,
	_limit: Accessor<number> = () => DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	_preferences: Accessor<GraphSemanticPreferences> = () => ({
		hiddenRefs: [],
		soloRefs: [],
		pinnedRefs: [],
	}),
	_enabled: Accessor<boolean> = () => true,
) {
	const preferenceKey = createMemo(() => JSON.stringify(_preferences()));
	const [search, setSearch] = createSignal({
		cwd: untrack(_cwd),
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
	const readGraph = createGitGraphReader();
	const source = useQueryResource<GraphData>(() => {
		const cwd = _cwd(),
			limit = _limit(),
			search = searchQuery();
		const preferences = { ..._preferences() };
		return {
			queryKey: ["git", "graph", cwd ?? "", limit, search, preferenceKey()],
			queryFn: ({ signal }) =>
				readGraph(cwd, limit, search, preferences, signal),
			initialData: EMPTY_GRAPH,
			refetchInterval: 3000,
			staleTime: 3000,
			enabled: _enabled() && !!cwd,
		};
	});

	const visible = createMemo(
		(previous: { cwd: string | undefined; data: GraphData } | undefined) => {
			const cwd = _cwd();
			const data = source.data;
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
			setSearchQuery,
			get loading() {
				return source.loading;
			},
			get error() {
				return source.error;
			},
			get refresh() {
				return source.refresh;
			},
		},
	);
}
export type HistoricalQuery = {
	commitSource: Extract<
		DiffSource,
		{
			kind: "commit";
		}
	> | null;
	comparisonSource: Extract<
		DiffSource,
		{
			kind: "comparison";
		}
	> | null;
	commit: {
		cwd?: string;
		hash?: string;
		parent?: string;
	};
	comparison: {
		cwd?: string;
		from?: string;
		to?: string;
	};
	revision?: string;
};

const EMPTY_HISTORY: {
	commit: GitCommitDetails | null;
	comparison: GitComparisonDetails | null;
	plan: ComparisonPlan | null;
} = { commit: null, comparison: null, plan: null };

/** Commit and comparison are mutually exclusive views of the same selection. */
export function useHistoryDetails(
	query: Accessor<HistoricalQuery>,
	selection: Accessor<
		| Array<{
				id: string;
				hash: string;
				itemKind: GitGraphItemKind;
				historyOrder?: number;
				worktreePath?: string;
		  }>
		| undefined
	>,
) {
	const selectionKey = createMemo(() => JSON.stringify(selection()));
	const source = useQueryResource(() => {
		const input = query(),
			selected = selectionKey();
		const comparison = input.comparison;
		const comparing = Boolean(selected || (comparison.from && comparison.to));
		return {
			queryKey: [
				"git",
				"history",
				input.revision,
				comparing ? comparison : input.commit,
				selected,
			],
			queryFn: async ({ signal }) => {
				if (comparing) {
					const result = await loadGitComparisonDetails(
						comparison.cwd,
						comparison.from,
						comparison.to,
						selected,
						signal,
					);
					return {
						...EMPTY_HISTORY,
						comparison: result?.details ?? null,
						plan: result?.plan ?? null,
					};
				}
				return {
					...EMPTY_HISTORY,
					commit: await loadGitCommitDetails(
						input.commit.cwd,
						input.commit.hash,
						input.commit.parent,
						signal,
					),
				};
			},
			initialData: EMPTY_HISTORY,
			staleTime: 60_000,
			gcTime: 5 * 60_000,
		};
	});
	return merge(source, {
		get loading() {
			return source.loading && !source.data.commit && !source.data.comparison;
		},
	});
}

function createGitGraphReader() {
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
		const result = await loadGitGraph(
			{ cwd, limit, query: searchQuery, preferences, etag: cached?.etag },
			signal,
		);
		if (result.notModified && cached) return cached.data;
		const data = result.data ?? EMPTY_GRAPH;
		const etag = result.etag;
		if (etag && !signal?.aborted)
			response = {
				key,
				etag,
				data,
			};
		return data;
	};
}
