import type {
	GitGraphSnapshot,
	GraphActionPresentation,
	GraphPresentation,
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
