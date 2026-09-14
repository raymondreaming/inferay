import type {
	ComparisonPlan,
	GitCommitDetails,
	GitComparisonDetails,
	GitGraphItemKind,
} from "@contracts";
import {
	DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
	type GraphData,
	type GraphSemanticPreferences,
} from "@repository/model/gitGraph.ts";
import {
	loadGitCommitDetails,
	loadGitComparisonDetails,
	loadGitGraph,
} from "@repository/services/gitApi.ts";
import {
	usePollingQuery,
	useQueryResource,
} from "@shared/hooks/useQueryResource.tsx";
import { project } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createMemo,
	createSignal,
	merge,
	untrack,
} from "solid-js";

export type {
	GraphData,
	GraphSemanticPreferences,
} from "@repository/model/gitGraph.ts";

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
	const readGraph = createMemo(createGitGraphReader);
	const _source3 = usePollingQuery<GraphData>(
		() => {
			const read = readGraph();
			const cwd = _cwd(),
				limit = _limit(),
				search = searchQuery();
			const preferences = { ..._preferences() };
			return (signal) => read(cwd, limit, search, preferences, signal);
		},
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
				enabled: _enabled() && !!_cwdValue,
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
			setSearchQuery,
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
	const request = () => {
		const cwd = _cwd2(),
			hash = _hash(),
			parent = _parent();
		return (signal?: AbortSignal) =>
			loadGitCommitDetails(cwd, hash, parent, signal);
	};
	const _source2 = useQueryResource<GitCommitDetails | null>(
		request,
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
	const fetchComparison = () => {
		const cwd = _cwd3(),
			fromHash = _fromHash(),
			toHash = _toHash(),
			selection = selectionKey();
		return (signal?: AbortSignal) =>
			loadGitComparisonDetails(cwd, fromHash, toHash, selection, signal);
	};
	const _source = useQueryResource<{
		details: GitComparisonDetails | null;
		plan: ComparisonPlan | null;
	} | null>(
		fetchComparison,
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
