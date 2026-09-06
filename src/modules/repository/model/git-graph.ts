import { runtimeGitGraphLaneColors } from "../../../design-system/styles.stylex.ts";
import type { GraphActionPresentation } from "../../workbench/model/workbench-model.ts";
import type {
	DiffRequest,
	GitFilePresentation,
	GitGraphAncestry,
	GitGraphNavigation,
	GitProjectStatus,
	HunkDiff,
} from "./types.ts";

export function gitDiffQuery(request: DiffRequest): {
	key: string;
	url: string;
} {
	const view = request.view ?? "full";
	const endpoint =
		request.comparisonFrom && request.comparisonTo
			? `/api/git/comparison-diff?cwd=${encodeURIComponent(request.cwd)}&from=${encodeURIComponent(request.comparisonFrom)}&to=${encodeURIComponent(request.comparisonTo)}&file=${encodeURIComponent(request.file)}&view=${view}`
			: request.commitHash
				? `/api/git/commit-diff?cwd=${encodeURIComponent(request.cwd)}&hash=${encodeURIComponent(request.commitHash)}&file=${encodeURIComponent(request.file)}&view=${view}${request.commitParent ? `&parent=${encodeURIComponent(request.commitParent)}` : ""}`
				: `/api/git/full-diff?cwd=${encodeURIComponent(request.cwd)}&file=${encodeURIComponent(request.file)}&staged=${request.staged}&view=${view}`;
	return {
		key: JSON.stringify(request),
		url: `${endpoint}&revision=${encodeURIComponent(request.repositoryRevision ?? "")}`,
	};
}

export async function fetchGitDiff(
	request: DiffRequest,
	signal: AbortSignal,
): Promise<HunkDiff> {
	const response = await fetch(gitDiffQuery(request).url, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
	});
	if (!response.ok)
		throw new Error(`Diff request failed (HTTP ${response.status})`);
	return (await response.json()) as HunkDiff;
}
export interface GraphNode {
	navigation?: GitGraphNavigation;
	column: number;
	color: string;
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
export interface GraphRail {
	column: number;
	color: string;
	startsAtNode?: boolean;
	endsAtNode?: boolean;
}
interface GraphTransition {
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
interface GitStash {
	name: string;
	hash: string;
	message: string;
	date: string;
}
interface GitRepositoryOperationState {
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
type GitRepositorySnapshotState =
	| "ready"
	| "unborn"
	| "empty"
	| "nonRepository"
	| "commandFailed";
export const EMPTY_GRAPH: GraphData = {
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

export interface ComparisonPlan {
	cwd: string;
	from: string;
	to: string;
}

export function createGitGraphReader() {
	let response: { key: string; etag: string; data: GraphData } | null = null;
	return async (
		cwd: string | undefined,
		limit: number,
		searchQuery: string,
		signal?: AbortSignal,
	): Promise<GraphData> => {
		if (!cwd) return EMPTY_GRAPH;
		const key = `${cwd}\0${limit}\0${searchQuery}`;
		const cached = response?.key === key ? response : null;
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
): Promise<CommitDetails | null> {
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
	return (json.details ?? null) as CommitDetails | null;
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
		details: ComparisonDetails | null;
		plan: ComparisonPlan | null;
	};
}
