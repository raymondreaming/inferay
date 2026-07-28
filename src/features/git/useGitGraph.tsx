import { useCallback } from "octane";
import { useAsyncResource } from "../../hooks/useAsyncResource";

export interface GitCommit {
	hash: string;
	message: string;
	author: string;
	authorEmail: string;
	authorAvatarUrl: string;
	date: string;
	parents: string[];
	refs: string[];
}

export interface GraphNode extends GitCommit {
	column: number;
	color: string;
}

export interface GraphRail {
	column: number;
	color: string;
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
}

interface GraphData {
	commits: GraphNode[];
	rows: GraphRow[];
}

const EMPTY_GRAPH: GraphData = { commits: [], rows: [] };

function areStringArraysEqual(prev: string[], next: string[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		if (prev[i] !== next[i]) return false;
	}
	return true;
}

function areGraphDataEqual(prev: GraphData, next: GraphData) {
	if (prev.commits.length !== next.commits.length) return false;
	for (let i = 0; i < prev.commits.length; i++) {
		const a = prev.commits[i]!;
		const b = next.commits[i]!;
		if (
			a.hash !== b.hash ||
			a.message !== b.message ||
			a.author !== b.author ||
			a.authorEmail !== b.authorEmail ||
			a.authorAvatarUrl !== b.authorAvatarUrl ||
			a.date !== b.date ||
			a.column !== b.column ||
			a.color !== b.color ||
			!areStringArraysEqual(a.parents, b.parents) ||
			!areStringArraysEqual(a.refs, b.refs)
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
			if (railA.column !== railB.column || railA.color !== railB.color)
				return false;
		}
		if (a.transitions.length !== b.transitions.length) return false;
		for (let j = 0; j < a.transitions.length; j++) {
			const transitionA = a.transitions[j]!;
			const transitionB = b.transitions[j]!;
			if (
				transitionA.fromColumn !== transitionB.fromColumn ||
				transitionA.toColumn !== transitionB.toColumn ||
				transitionA.color !== transitionB.color
			) {
				return false;
			}
		}
	}
	return true;
}

export function useGitGraph(cwd: string | undefined, limit = 50) {
	const fetchGraph = useCallback(() => {
		if (!cwd) return null;
		return (async () => {
			const res = await fetch(
				`/api/git/graph?cwd=${encodeURIComponent(cwd)}&limit=${limit}`
			);
			if (!res.ok) throw new Error("Failed to fetch git graph");
			const json = await res.json();
			return {
				commits: (json.commits || []) as GraphNode[],
				rows: (json.rows || []) as GraphRow[],
			};
		})();
	}, [cwd, limit]);
	const { data, loading, error, refresh } = useAsyncResource<GraphData>(
		fetchGraph,
		EMPTY_GRAPH,
		{ isEqual: areGraphDataEqual }
	);
	return { commits: data.commits, rows: data.rows, loading, error, refresh };
}

interface CommitFile {
	path: string;
	status: string;
	additions: number;
	deletions: number;
}

interface CommitDetails {
	hash: string;
	message: string;
	author: string;
	date: string;
	files: CommitFile[];
}

function areCommitDetailsEqual(
	prev: CommitDetails | null,
	next: CommitDetails | null
) {
	if (prev === next) return true;
	if (!prev || !next) return false;
	if (
		prev.hash !== next.hash ||
		prev.message !== next.message ||
		prev.author !== next.author ||
		prev.date !== next.date ||
		prev.files.length !== next.files.length
	) {
		return false;
	}
	for (let i = 0; i < prev.files.length; i++) {
		const a = prev.files[i]!;
		const b = next.files[i]!;
		if (
			a.path !== b.path ||
			a.status !== b.status ||
			a.additions !== b.additions ||
			a.deletions !== b.deletions
		) {
			return false;
		}
	}
	return true;
}

export function useCommitDetails(
	cwd: string | undefined,
	hash: string | undefined
) {
	const fetchCommitDetails = useCallback(() => {
		if (!cwd || !hash) return null;
		return (async () => {
			const res = await fetch(
				`/api/git/commit-details?cwd=${encodeURIComponent(cwd)}&hash=${encodeURIComponent(hash)}`
			);
			if (!res.ok) throw new Error("Failed to fetch commit details");
			const json = await res.json();
			return (json.details || null) as CommitDetails | null;
		})();
	}, [cwd, hash]);
	const { data, loading, error, refresh } =
		useAsyncResource<CommitDetails | null>(fetchCommitDetails, null, {
			isEqual: areCommitDetailsEqual,
		});
	return { details: data, loading, error, refresh };
}
