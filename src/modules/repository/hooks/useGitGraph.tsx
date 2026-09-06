import { useCallback, useRef, useState } from "octane";
import { runtimeGitGraphLaneColors } from "../../../design-system/styles.stylex.ts";
import {
	usePollingQuery,
	useQueryResource,
} from "../../../shared/hooks/useQueryResource.tsx";
import { DEFAULT_GIT_GRAPH_HISTORY_LIMIT } from "../../workbench/graph/model/graph-model.ts";
import type { GraphActionPresentation } from "../../workbench/model/workbench-model.ts";
import type {
	GitFilePresentation,
	GitGraphAncestry,
	GitGraphNavigation,
	GitProjectStatus,
} from "../model/types.ts";
export interface GitCommit {
	navigation?: GitGraphNavigation;
	id: string;
	itemKind: GitGraphItemKind;
	hash: string;
	message: string;
	body: string;
	author: string;
	authorEmail: string;
	committer: string;
	committerEmail: string;
	date: string;
	authoredAt: string;
	committedAt: string;
	parents: string[];
	refs: GitGraphRef[];
	worktreePath?: string;
	stashName?: string;
}
export type GitGraphItemKind = "commit" | "worktreeWip" | "stash";
export type GitGraphRefKind =
	| "head"
	| "localBranch"
	| "remoteBranch"
	| "tag"
	| "stash";
export interface GitGraphRef {
	fullName: string;
	displayName: string;
	label: string;
	kind: GitGraphRefKind;
	target: string;
	remoteName?: string;
	isHead: boolean;
	worktreePath?: string;
	upstream?: string;
	ahead?: number;
	behind?: number;
}
export interface GraphNode extends GitCommit {
	column: number;
	color: string;
}
export interface GraphRail {
	column: number;
	color: string;
	startsAtNode?: boolean;
	endsAtNode?: boolean;
}
export interface GraphTransition {
	fromColumn: number;
	toColumn: number;
	color: string;
}
export interface GraphRow {
	row: number;
	rails: GraphRail[];
	transitions: GraphTransition[];
	convergences: GraphTransition[];
	truncatedEdges: GraphRail[];
}
export interface GitWorktree {
	path: string;
	head: string;
	branch?: string;
	isCurrent: boolean;
	bare: boolean;
	locked: boolean;
	status?: GitProjectStatus;
}
export interface GitStash {
	name: string;
	hash: string;
	message: string;
	date: string;
}
export interface GitRepositoryOperationState {
	kind: "idle" | "merge" | "rebase" | "cherryPick" | "revert";
	phase: "idle" | "awaitingContinuation" | "conflicted";
	conflicts: string[];
}
export interface GraphData {
	actions: Record<string, GraphActionPresentation>;
	ancestry: GitGraphAncestry;
	commits: GraphNode[];
	rows: GraphRow[];
	hasMore: boolean;
	worktrees: GitWorktree[];
	stashes: GitStash[];
	revision: string;
	operation: GitRepositoryOperationState;
	state: GitRepositorySnapshotState;
	stateError?: string;
}
export type GitRepositorySnapshotState =
	| "ready"
	| "unborn"
	| "empty"
	| "nonRepository"
	| "commandFailed";
const EMPTY_GRAPH: GraphData = {
	actions: {},
	ancestry: {},
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
	state: "empty",
};
type WireColor<T> = Omit<T, "color"> & { colorIndex: number };
type WireGraphData = Omit<GraphData, "commits" | "rows"> & {
	commits: WireColor<GraphNode>[];
	rows: Array<{
		row: number;
		rails: WireColor<GraphRail>[];
		transitions: WireColor<GraphTransition>[];
		convergences: WireColor<GraphTransition>[];
		truncatedEdges: WireColor<GraphRail>[];
	}>;
};
// Rust owns the graph schema; only theme colors are resolved in the renderer.
function withLaneColor<T extends { colorIndex: number }>({
	colorIndex,
	...value
}: T) {
	return {
		...value,
		color:
			runtimeGitGraphLaneColors[
				Math.abs(colorIndex) % runtimeGitGraphLaneColors.length
			]!,
	};
}
export function useGitGraph(
	cwd: string | undefined,
	limit = DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
) {
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
	const responseRef = useRef<{
		key: string;
		etag: string;
		data: GraphData;
	} | null>(null);
	const fetchGraph = useCallback(
		async (signal?: AbortSignal) => {
			if (!cwd) return EMPTY_GRAPH;
			return (async () => {
				const key = `${cwd}\0${limit}\0${searchQuery}`;
				const cached =
					responseRef.current?.key === key ? responseRef.current : null;
				const res = await fetch(
					`/api/git/graph?cwd=${encodeURIComponent(cwd)}&limit=${limit}&query=${encodeURIComponent(searchQuery)}`,
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
				const json = (await res.json()) as WireGraphData;
				const data: GraphData = {
					...json,
					commits: json.commits.map(withLaneColor),
					rows: json.rows.map((row) => ({
						...row,
						rails: row.rails.map(withLaneColor),
						transitions: row.transitions.map(withLaneColor),
						convergences: row.convergences.map(withLaneColor),
						truncatedEdges: row.truncatedEdges.map(withLaneColor),
					})),
				};
				const etag = res.headers?.get("etag");
				if (etag && !signal?.aborted)
					responseRef.current = {
						key,
						etag,
						data,
					};
				return data;
			})();
		},
		[cwd, limit, searchQuery],
	);
	const {
		data,
		setData,
		loading,
		error,
		refetch: refresh,
	} = usePollingQuery<GraphData>(fetchGraph, 3000, EMPTY_GRAPH, {
		queryKey: ["git", "graph", cwd ?? "", limit, searchQuery],
		enabled: !!cwd,
	});
	const updateWorktreeStatus = useCallback(
		(cwd: string, update: (status: GitProjectStatus) => GitProjectStatus) => {
			setData((current) => ({
				...current,
				worktrees: current.worktrees.map((worktree) =>
					worktree.status?.cwd === cwd
						? {
								...worktree,
								status: update(worktree.status),
							}
						: worktree,
				),
			}));
		},
		[setData],
	);
	return {
		...data,
		searchQuery,
		setSearchQuery,
		loading,
		error,
		refresh,
		updateWorktreeStatus,
	};
}
export interface CommitFile {
	path: string;
	originalPath?: string;
	status: string;
	additions: number;
	deletions: number;
}
export interface CommitDetails {
	filePresentation?: GitFilePresentation;
	hash: string;
	parents: string[];
	diffParent?: string;
	message: string;
	body: string;
	author: string;
	authorEmail: string;
	authoredAt: string;
	committer: string;
	committerEmail: string;
	committedAt: string;
	refs: GitGraphRef[];
	provider?: {
		provider: "github";
		repository: string;
		pullRequestNumber?: number;
		pullRequestUrl?: string;
	};
	files: CommitFile[];
}
export interface ComparisonDetails {
	filePresentation?: GitFilePresentation;
	fromHash: string;
	toHash: string;
	mergeBase?: string;
	files: CommitFile[];
}
export function useCommitDetails(
	cwd: string | undefined,
	hash: string | undefined,
	parent?: string,
	repositoryRevision?: string,
) {
	const fetchCommitDetails = useCallback(
		(signal?: AbortSignal) => {
			if (!cwd || !hash) return null;
			return (async () => {
				const parentQuery = parent
					? `&parent=${encodeURIComponent(parent)}`
					: "";
				const res = await fetch(
					`/api/git/commit-details?cwd=${encodeURIComponent(cwd)}&hash=${encodeURIComponent(hash)}${parentQuery}`,
					{
						signal,
					},
				);
				if (!res.ok) throw new Error("Failed to fetch commit details");
				const json = await res.json();
				// The bundled Rust server owns the canonical commit-details schema.
				return (json.details ?? null) as CommitDetails | null;
			})();
		},
		[cwd, hash, parent],
	);
	const { data, loading, error, refresh } =
		useQueryResource<CommitDetails | null>(fetchCommitDetails, null, {
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
		});
	return {
		details: data,
		loading,
		error,
		refresh,
	};
}
export interface ComparisonPlan {
	cwd: string;
	from: string;
	to: string;
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
		async (signal?: AbortSignal) => {
			if (
				!cwd ||
				(!selectionKey && (!fromHash || !toHash || fromHash === toHash))
			)
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
				details: ComparisonDetails | null;
				plan: ComparisonPlan | null;
			};
		},
		[cwd, fromHash, toHash, selectionKey],
	);
	const { data, loading, error, refresh } = useQueryResource<{
		details: ComparisonDetails | null;
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
		error,
		refresh,
	};
}
