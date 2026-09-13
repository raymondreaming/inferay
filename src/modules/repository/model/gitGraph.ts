import type {
	GitGraphRef,
	GitRepositoryOperationState,
	GitRepositorySnapshotState,
	GitStash,
	GitWorktree,
	GraphActionPresentation,
	GraphCommit,
	GraphRow,
} from "@contracts";

export const DEFAULT_GIT_GRAPH_HISTORY_LIMIT = 1_000;

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
	operation: { kind: "idle", phase: "idle", conflicts: [] },
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
