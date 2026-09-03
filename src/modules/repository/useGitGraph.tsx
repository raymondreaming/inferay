import { useCallback } from "octane";
import { runtimeGitGraphLaneColors } from "../../design-system.ts";
import { DEFAULT_GIT_GRAPH_HISTORY_LIMIT } from "../../modules/workbench/graph/model.ts";
import {
	usePollingQuery,
	useQueryResource,
} from "../../shared/hooks/useQueryResource.tsx";
import type { GitProjectStatus } from "./types.ts";

export interface GitCommit {
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
	commits: [],
	rows: [],
	hasMore: false,
	worktrees: [],
	stashes: [],
	revision: "",
	operation: { kind: "idle", phase: "idle", conflicts: [] },
	state: "empty",
};

type WireGraphNode = Omit<GraphNode, "color" | "id" | "itemKind"> & {
	id?: string;
	itemKind?: GitGraphItemKind;
	colorIndex: number;
};
type WireGraphRow = {
	row: number;
	rails: Array<{
		column: number;
		colorIndex: number;
		startsAtNode?: boolean;
		endsAtNode?: boolean;
	}>;
	transitions: Array<{
		fromColumn: number;
		toColumn: number;
		colorIndex: number;
	}>;
	convergences?: Array<{
		fromColumn: number;
		toColumn: number;
		colorIndex: number;
	}>;
	truncatedEdges?: Array<{
		column: number;
		colorIndex: number;
		startsAtNode?: boolean;
		endsAtNode?: boolean;
	}>;
};

function laneColor(index: number): string {
	return runtimeGitGraphLaneColors[
		Math.abs(index) % runtimeGitGraphLaneColors.length
	]!;
}

function wireString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function graphRefFromWire(value: unknown): GitGraphRef | null {
	if (!value || typeof value !== "object") return null;
	const ref = value as Partial<GitGraphRef>;
	const fullName = wireString(ref.fullName);
	const target = wireString(ref.target);
	if (!fullName || !target) return null;
	const kind: GitGraphRefKind = [
		"head",
		"localBranch",
		"remoteBranch",
		"tag",
		"stash",
	].includes(ref.kind ?? "")
		? (ref.kind as GitGraphRefKind)
		: "localBranch";
	return {
		fullName,
		displayName: wireString(
			ref.displayName,
			fullName.replace(/^refs\/[^/]+\//, ""),
		),
		kind,
		target,
		remoteName: wireString(ref.remoteName) || undefined,
		isHead: ref.isHead === true,
		worktreePath: wireString(ref.worktreePath) || undefined,
		upstream: wireString(ref.upstream) || undefined,
		ahead: typeof ref.ahead === "number" ? ref.ahead : undefined,
		behind: typeof ref.behind === "number" ? ref.behind : undefined,
	};
}

function graphNodeFromWire(node: WireGraphNode): GraphNode {
	const hash = wireString(node.hash);
	const author = wireString(node.author, "Unknown author");
	const date = wireString(node.date);
	return {
		id: wireString(node.id, hash),
		itemKind: node.itemKind || "commit",
		hash,
		message: wireString(node.message),
		body: wireString(node.body),
		author,
		authorEmail: wireString(node.authorEmail),
		committer: wireString(node.committer, author),
		committerEmail: wireString(
			node.committerEmail,
			wireString(node.authorEmail),
		),
		date,
		authoredAt: wireString(node.authoredAt, date),
		committedAt: wireString(node.committedAt, date),
		parents: Array.isArray(node.parents)
			? node.parents.filter(
					(parent): parent is string => typeof parent === "string",
				)
			: [],
		refs: Array.isArray(node.refs)
			? node.refs
					.map(graphRefFromWire)
					.filter((ref): ref is GitGraphRef => ref !== null)
			: [],
		column: typeof node.column === "number" ? node.column : 0,
		color: laneColor(typeof node.colorIndex === "number" ? node.colorIndex : 0),
		worktreePath: wireString(node.worktreePath) || undefined,
		stashName: wireString(node.stashName) || undefined,
	};
}

function graphRowFromWire(row: WireGraphRow): GraphRow {
	return {
		row: row.row,
		rails: row.rails.map((rail) => ({
			column: rail.column,
			color: laneColor(rail.colorIndex),
			startsAtNode: rail.startsAtNode === true,
			endsAtNode: rail.endsAtNode === true,
		})),
		transitions: row.transitions.map((transition) => ({
			fromColumn: transition.fromColumn,
			toColumn: transition.toColumn,
			color: laneColor(transition.colorIndex),
		})),
		convergences: (row.convergences || []).map((transition) => ({
			fromColumn: transition.fromColumn,
			toColumn: transition.toColumn,
			color: laneColor(transition.colorIndex),
		})),
		truncatedEdges: (row.truncatedEdges || []).map((edge) => ({
			column: edge.column,
			color: laneColor(edge.colorIndex),
			startsAtNode: edge.startsAtNode === true,
			endsAtNode: edge.endsAtNode === true,
		})),
	};
}

function areStringArraysEqual(prev: string[], next: string[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		if (prev[i] !== next[i]) return false;
	}
	return true;
}

function areGraphRefsEqual(prev: GitGraphRef[], next: GitGraphRef[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.fullName !== b.fullName ||
			a.displayName !== b.displayName ||
			a.kind !== b.kind ||
			a.target !== b.target ||
			a.remoteName !== b.remoteName ||
			a.isHead !== b.isHead ||
			a.worktreePath !== b.worktreePath ||
			a.upstream !== b.upstream ||
			a.ahead !== b.ahead ||
			a.behind !== b.behind
		) {
			return false;
		}
	}
	return true;
}

function areGraphDataEqual(prev: GraphData, next: GraphData) {
	if (prev.revision !== next.revision) return false;
	if (prev.state !== next.state || prev.stateError !== next.stateError)
		return false;
	if (!prev.operation || !next.operation) return false;
	if (
		prev.operation.kind !== next.operation.kind ||
		prev.operation.phase !== next.operation.phase ||
		!areStringArraysEqual(prev.operation.conflicts, next.operation.conflicts)
	)
		return false;
	if (prev.hasMore !== next.hasMore) return false;
	if (JSON.stringify(prev.worktrees) !== JSON.stringify(next.worktrees))
		return false;
	if (JSON.stringify(prev.stashes) !== JSON.stringify(next.stashes))
		return false;
	if (prev.commits.length !== next.commits.length) return false;
	for (let i = 0; i < prev.commits.length; i++) {
		const a = prev.commits[i]!;
		const b = next.commits[i]!;
		if (
			a.id !== b.id ||
			a.itemKind !== b.itemKind ||
			a.hash !== b.hash ||
			a.message !== b.message ||
			a.body !== b.body ||
			a.author !== b.author ||
			a.authorEmail !== b.authorEmail ||
			a.committer !== b.committer ||
			a.committerEmail !== b.committerEmail ||
			a.date !== b.date ||
			a.authoredAt !== b.authoredAt ||
			a.committedAt !== b.committedAt ||
			a.column !== b.column ||
			a.color !== b.color ||
			!areStringArraysEqual(a.parents, b.parents) ||
			!areGraphRefsEqual(a.refs, b.refs) ||
			a.worktreePath !== b.worktreePath ||
			a.stashName !== b.stashName
		) {
			return false;
		}
	}
	if (prev.rows.length !== next.rows.length) return false;
	for (let i = 0; i < prev.rows.length; i++) {
		const a = prev.rows[i]!;
		const b = next.rows[i]!;
		if (a.row !== b.row || a.rails.length !== b.rails.length) return false;
		for (let j = 0; j < a.rails.length; j++) {
			const railA = a.rails[j]!;
			const railB = b.rails[j]!;
			if (
				railA.column !== railB.column ||
				railA.color !== railB.color ||
				railA.startsAtNode !== railB.startsAtNode ||
				railA.endsAtNode !== railB.endsAtNode
			)
				return false;
		}
		for (const [left, right] of [
			[a.transitions, b.transitions],
			[a.convergences, b.convergences],
		] as const) {
			if (left.length !== right.length) return false;
			for (let j = 0; j < left.length; j++) {
				const transitionA = left[j]!;
				const transitionB = right[j]!;
				if (
					transitionA.fromColumn !== transitionB.fromColumn ||
					transitionA.toColumn !== transitionB.toColumn ||
					transitionA.color !== transitionB.color
				) {
					return false;
				}
			}
		}
		if (a.truncatedEdges.length !== b.truncatedEdges.length) return false;
		for (let j = 0; j < a.truncatedEdges.length; j++) {
			const edgeA = a.truncatedEdges[j]!;
			const edgeB = b.truncatedEdges[j]!;
			if (edgeA.column !== edgeB.column || edgeA.color !== edgeB.color)
				return false;
		}
	}
	return true;
}

export function useGitGraph(
	cwd: string | undefined,
	limit = DEFAULT_GIT_GRAPH_HISTORY_LIMIT,
) {
	const fetchGraph = useCallback(
		async (signal?: AbortSignal) => {
			if (!cwd) return EMPTY_GRAPH;
			return (async () => {
				const res = await fetch(
					`/api/git/graph?cwd=${encodeURIComponent(cwd)}&limit=${limit}`,
					{ signal },
				);
				if (!res.ok) {
					const error = await res.json().catch(() => null);
					throw new Error(error?.error || "Failed to fetch Git history");
				}
				const json = await res.json();
				return {
					commits: ((json.commits || []) as WireGraphNode[]).map(
						graphNodeFromWire,
					),
					rows: ((json.rows || []) as WireGraphRow[]).map(graphRowFromWire),
					hasMore: json.hasMore === true,
					worktrees: (json.worktrees || []) as GitWorktree[],
					stashes: (json.stashes || []) as GitStash[],
					revision: typeof json.revision === "string" ? json.revision : "",
					operation: (json.operation ||
						EMPTY_GRAPH.operation) as GitRepositoryOperationState,
					state: (json.state || "empty") as GitRepositorySnapshotState,
					stateError:
						typeof json.stateError === "string" ? json.stateError : undefined,
				};
			})();
		},
		[cwd, limit],
	);
	const {
		data,
		loading,
		error,
		refetch: refresh,
	} = usePollingQuery<GraphData>(fetchGraph, 3000, EMPTY_GRAPH, {
		queryKey: ["git", "graph", cwd ?? "", limit],
		enabled: !!cwd,
		isEqual: areGraphDataEqual,
	});
	return {
		commits: data.commits,
		rows: data.rows,
		hasMore: data.hasMore,
		worktrees: data.worktrees,
		stashes: data.stashes,
		revision: data.revision,
		operation: data.operation,
		state: data.state,
		stateError: data.stateError,
		loading,
		error,
		refresh,
	};
}

export interface CommitFile {
	path: string;
	originalPath?: string;
	status: string;
	additions: number;
	deletions: number;
	binary: boolean;
}

export interface CommitDetails {
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
		repositoryUrl: string;
		pullRequestNumber?: number;
		pullRequestUrl?: string;
	};
	files: CommitFile[];
}

export interface ComparisonDetails {
	fromHash: string;
	toHash: string;
	mergeBase?: string;
	files: CommitFile[];
}

function commitFileFromWire(value: unknown): CommitFile | null {
	if (!value || typeof value !== "object") return null;
	const file = value as Partial<CommitFile> & { original_path?: unknown };
	const path = wireString(file.path);
	if (!path) return null;
	return {
		path,
		originalPath:
			wireString(file.originalPath, wireString(file.original_path)) ||
			undefined,
		status: wireString(file.status, "M"),
		additions: typeof file.additions === "number" ? file.additions : 0,
		deletions: typeof file.deletions === "number" ? file.deletions : 0,
		binary: file.binary === true,
	};
}

function commitDetailsFromWire(value: unknown): CommitDetails | null {
	if (!value || typeof value !== "object") return null;
	const details = value as Partial<CommitDetails> & {
		diff_parent?: unknown;
		author_email?: unknown;
		authored_at?: unknown;
		committer_email?: unknown;
		committed_at?: unknown;
	};
	const hash = wireString(details.hash);
	if (!hash) return null;
	const author = wireString(details.author, "Unknown author");
	const authorEmail = wireString(
		details.authorEmail,
		wireString(details.author_email),
	);
	const authoredAt = wireString(
		details.authoredAt,
		wireString(details.authored_at),
	);
	return {
		hash,
		parents: Array.isArray(details.parents)
			? details.parents.filter(
					(parent): parent is string => typeof parent === "string",
				)
			: [],
		diffParent:
			wireString(details.diffParent, wireString(details.diff_parent)) ||
			undefined,
		message: wireString(details.message),
		body: wireString(details.body),
		author,
		authorEmail,
		authoredAt,
		committer: wireString(details.committer, author),
		committerEmail: wireString(
			details.committerEmail,
			wireString(details.committer_email, authorEmail),
		),
		committedAt: wireString(
			details.committedAt,
			wireString(details.committed_at, authoredAt),
		),
		refs: Array.isArray(details.refs)
			? details.refs
					.map(graphRefFromWire)
					.filter((ref): ref is GitGraphRef => ref !== null)
			: [],
		provider:
			details.provider?.provider === "github" &&
			typeof details.provider.repository === "string" &&
			typeof details.provider.repositoryUrl === "string"
				? details.provider
				: undefined,
		files: Array.isArray(details.files)
			? details.files
					.map(commitFileFromWire)
					.filter((file): file is CommitFile => file !== null)
			: [],
	};
}

function areCommitDetailsEqual(
	prev: CommitDetails | null,
	next: CommitDetails | null,
) {
	if (prev === next) return true;
	if (!prev || !next) return false;
	if (
		prev.hash !== next.hash ||
		prev.message !== next.message ||
		prev.author !== next.author ||
		prev.authorEmail !== next.authorEmail ||
		prev.authoredAt !== next.authoredAt ||
		prev.committer !== next.committer ||
		prev.committerEmail !== next.committerEmail ||
		prev.committedAt !== next.committedAt ||
		prev.body !== next.body ||
		!areStringArraysEqual(prev.parents, next.parents) ||
		prev.diffParent !== next.diffParent ||
		!areGraphRefsEqual(prev.refs, next.refs) ||
		JSON.stringify(prev.provider) !== JSON.stringify(next.provider) ||
		prev.files.length !== next.files.length
	) {
		return false;
	}
	for (let i = 0; i < prev.files.length; i++) {
		const a = prev.files[i]!;
		const b = next.files[i]!;
		if (
			a.path !== b.path ||
			a.originalPath !== b.originalPath ||
			a.status !== b.status ||
			a.additions !== b.additions ||
			a.deletions !== b.deletions ||
			a.binary !== b.binary
		) {
			return false;
		}
	}
	return true;
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
					{ signal },
				);
				if (!res.ok) throw new Error("Failed to fetch commit details");
				const json = await res.json();
				return commitDetailsFromWire(json.details);
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
			isEqual: areCommitDetailsEqual,
			staleTime: 60_000,
			gcTime: 5 * 60_000,
		});
	return { details: data, loading, error, refresh };
}

export function useComparisonDetails(
	cwd: string | undefined,
	fromHash: string | undefined,
	toHash: string | undefined,
	repositoryRevision?: string,
) {
	const fetchComparison = useCallback(
		(signal?: AbortSignal) => {
			if (!cwd || !fromHash || !toHash || fromHash === toHash) return null;
			return (async () => {
				const res = await fetch(
					`/api/git/comparison-details?cwd=${encodeURIComponent(cwd)}&from=${encodeURIComponent(fromHash)}&to=${encodeURIComponent(toHash)}`,
					{ signal },
				);
				if (!res.ok) throw new Error("Failed to compare commits");
				const json = await res.json();
				return (json.details || null) as ComparisonDetails | null;
			})();
		},
		[cwd, fromHash, toHash],
	);
	const { data, loading, error, refresh } =
		useQueryResource<ComparisonDetails | null>(fetchComparison, null, {
			queryKey: [
				"git",
				"comparison",
				cwd ?? "",
				repositoryRevision ?? "",
				fromHash ?? "",
				toHash ?? "",
			],
			staleTime: 60_000,
			gcTime: 5 * 60_000,
		});
	return { details: data, loading, error, refresh };
}
