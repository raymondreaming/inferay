import { readStoredJson } from "../../../../../adapters/storage/stored-values.ts";

import type {
	GitWorktree,
	GraphNode,
	GraphRow,
} from "../../../../repository/hooks/useGitGraph";

import type { GraphPresentationTransition } from "../../model/graph-model.ts";
import {
	type ColumnKey,
	type ColumnVisibility,
	type ColumnWidths,
	type GraphSelectionIntent,
	ROW_HEIGHT,
} from "./shared.ts";

export interface CommitGraphProps {
	searchQuery?: string;
	searchActive?: boolean;
	emptyLabel?: string;
	ancestry?: Record<string, Array<[number, number]>>;
	onSearchChange?: (query: string) => void;
	commits: GraphNode[];
	rows: GraphRow[];
	selectedHash?: string;
	selectedIds?: readonly string[];
	onSelect?: (itemId: string, intent?: GraphSelectionIntent) => void;
	className?: string;
	worktrees?: GitWorktree[];
	branch?: string;
	embedded?: boolean;
	onCheckoutRef?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	hasMore?: boolean;
	onLoadMore?: () => void;
	loadingMore?: boolean;
	repositoryKey?: string;
	onGraphAction?: (request: GitGraphActionRequest) => void;
	onCompareWithWip?: (itemId: string) => void;
	onOpenSelection?: (itemId: string) => void;
}

export interface GitGraphActionRequest {
	action:
		| "createBranch"
		| "createTag"
		| "cherryPick"
		| "revert"
		| "stashPush"
		| "stashApply"
		| "stashPop"
		| "stashDrop"
		| "stashRename"
		| "renameBranch"
		| "deleteBranch"
		| "deleteTag"
		| "setUpstream"
		| "pushSetUpstream"
		| "deleteRemoteBranch"
		| "pushTag"
		| "deleteRemoteTag"
		| "forcePushWithLease"
		| "resetSoft"
		| "resetMixed"
		| "resetHard"
		| "fetch"
		| "pull"
		| "push";
	target?: string;
	targets?: string[];
	itemId: string;
	suggestedName?: string;
}

export interface GraphPreferences {
	columns: ColumnVisibility;
	widths: ColumnWidths;
	order: ColumnKey[];
	hiddenRefs: string[];
	soloRefs: string[];
	pinnedRefs: string[];
}

export const TOP_PADDING = ROW_HEIGHT;

export const ROW_OVERSCAN = 12;

export const AUTHOR_WIDTH = 136;

export const SHA_WIDTH = 76;

export const DATE_WIDTH = 132;

export const REF_WIDTH = 192;

export const GRAPH_WIDTH = 96;

export const MESSAGE_WIDTH = 340;

export const COLUMN_PREFS_KEY = "commit-graph-columns-v12";

export const SCROLL_PREFS_KEY = "commit-graph-scroll-v1";

export const DEFAULT_COLUMN_ORDER: ColumnKey[] = [
	"date",
	"refs",
	"graph",
	"message",
	"author",
	"sha",
];

export const EMPTY_SELECTED_IDS: readonly string[] = [];

export const DEFAULT_COLUMNS: ColumnVisibility = {
	author: true,
	sha: true,
	date: true,
};

export const DEFAULT_WIDTHS: ColumnWidths = {
	date: DATE_WIDTH,
	refs: REF_WIDTH,
	graph: GRAPH_WIDTH,
	message: MESSAGE_WIDTH,
	author: AUTHOR_WIDTH,
	sha: SHA_WIDTH,
};

export const MIN_COLUMN_WIDTHS: ColumnWidths = {
	date: 84,
	refs: 96,
	graph: 48,
	message: 160,
	author: 88,
	sha: 56,
};

export const MAX_COLUMN_WIDTH = 480;

export function normalizedColumnWidths(
	stored: Partial<ColumnWidths> | undefined,
): ColumnWidths {
	return Object.fromEntries(
		(Object.keys(DEFAULT_WIDTHS) as Array<keyof ColumnWidths>).map((column) => {
			const candidate = stored?.[column];
			const value =
				typeof candidate === "number" && Number.isFinite(candidate)
					? candidate
					: DEFAULT_WIDTHS[column];
			return [
				column,
				Math.max(MIN_COLUMN_WIDTHS[column], Math.min(MAX_COLUMN_WIDTH, value)),
			];
		}),
	) as unknown as ColumnWidths;
}

export function preferencesKey(repositoryKey?: string) {
	return `${COLUMN_PREFS_KEY}:${repositoryKey ?? "default"}`;
}

export function scrollPreferencesKey(repositoryKey?: string) {
	return `${SCROLL_PREFS_KEY}:${repositoryKey ?? "default"}`;
}

export function loadPreferences(repositoryKey?: string): GraphPreferences {
	const stored = readStoredJson<Partial<GraphPreferences>>(
		preferencesKey(repositoryKey),
		{},
	);
	const storedOrder = Array.isArray(stored.order)
		? stored.order.filter((value): value is ColumnKey =>
				DEFAULT_COLUMN_ORDER.includes(value),
			)
		: [];
	return {
		columns: { ...DEFAULT_COLUMNS, ...stored.columns },
		widths: normalizedColumnWidths(stored.widths),
		hiddenRefs: Array.isArray(stored.hiddenRefs) ? stored.hiddenRefs : [],
		soloRefs: Array.isArray(stored.soloRefs) ? stored.soloRefs : [],
		pinnedRefs: Array.isArray(stored.pinnedRefs) ? stored.pinnedRefs : [],
		order:
			storedOrder.length === DEFAULT_COLUMN_ORDER.length
				? storedOrder
				: DEFAULT_COLUMN_ORDER,
	};
}

export type RowTransition = GraphPresentationTransition;
