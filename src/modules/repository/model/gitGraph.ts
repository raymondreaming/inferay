import type {
	GitGraphRef,
	GitGraphSnapshot,
	GraphActionPresentation,
} from "@contracts";

export const DEFAULT_GIT_GRAPH_HISTORY_LIMIT = 1_000;

export type GraphData = Omit<GitGraphSnapshot, "ancestry"> & {
	actions: Record<string, GraphActionPresentation>;
	presentation: GraphPresentation;
};

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
