import type { ComparisonPlan } from "../../../../build/presentation/contracts/ComparisonPlan.ts";
import type { GitCommitDetails } from "../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitComparisonDetails } from "../../../../build/presentation/contracts/GitComparisonDetails.ts";
import type { GitGraphRef } from "../../../../build/presentation/contracts/GitGraphRef.ts";
import type { GitRepositoryOperationState } from "../../../../build/presentation/contracts/GitRepositoryOperationState.ts";
import type { GitRepositorySnapshotState } from "../../../../build/presentation/contracts/GitRepositorySnapshotState.ts";
import type { GitStash } from "../../../../build/presentation/contracts/GitStash.ts";
import type { GitWorktree } from "../../../../build/presentation/contracts/GitWorktree.ts";
import type { GraphCommit } from "../../../../build/presentation/contracts/GraphCommit.ts";
import type { GraphRail } from "../../../../build/presentation/contracts/GraphRail.ts";
import type { GraphRow } from "../../../../build/presentation/contracts/GraphRow.ts";
import type { GraphTransition } from "../../../../build/presentation/contracts/GraphTransition.ts";
import type { HunkDiff } from "../../../../build/presentation/contracts/HunkDiff.ts";
import { runtimeGitGraphLaneColors } from "../../../design-system/styles.stylex.ts";
import type { GraphActionPresentation } from "../../workbench/model/workbench-model.ts";
import type { DiffRequest } from "./types.ts";

export async function fetchGitDiff(
	request: DiffRequest,
	signal: AbortSignal,
): Promise<HunkDiff> {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(request))
		if (value !== undefined) query.set(key, String(value));
	const response = await fetch(`/api/git/diff?${query}`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
	});
	if (!response.ok)
		throw new Error(`Diff request failed (HTTP ${response.status})`);
	return (await response.json()) as HunkDiff;
}
export type GraphNode = Omit<GraphCommit, "colorIndex"> & { color: string };

export type RenderGraphRail = Omit<GraphRail, "colorIndex"> & { color: string };
type RenderGraphTransition = Omit<GraphTransition, "colorIndex"> & {
	color: string;
};
export type RenderGraphRow = Omit<
	GraphRow,
	"rails" | "transitions" | "convergences" | "truncatedEdges"
> & {
	rails: RenderGraphRail[];
	transitions: RenderGraphTransition[];
	convergences: RenderGraphTransition[];
	truncatedEdges: RenderGraphRail[];
};

export interface GraphData {
	actions: Record<string, GraphActionPresentation>;
	commits: GraphNode[];
	rows: RenderGraphRow[];
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
type WireColor<T> = Omit<T, "color"> & { colorIndex: number };
type WireGraphData = Omit<GraphData, "commits" | "rows"> & {
	commits: WireColor<GraphNode>[];
	rows: Array<{
		row: number;
		rails: WireColor<RenderGraphRail>[];
		transitions: WireColor<RenderGraphTransition>[];
		convergences: WireColor<RenderGraphTransition>[];
		truncatedEdges: WireColor<RenderGraphRail>[];
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
