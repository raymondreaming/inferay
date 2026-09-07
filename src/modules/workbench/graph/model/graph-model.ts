import { project as rustProject } from "../../../../adapters/presentation/model.ts";
export interface GraphSelectionIntent {
	additive: boolean;
	range: boolean;
}
export interface ColumnVisibility {
	author: boolean;
	sha: boolean;
	date: boolean;
}
export type ColumnKey =
	| "date"
	| "refs"
	| "graph"
	| "message"
	| "author"
	| "sha";
export interface ColumnWidths {
	date: number;
	refs: number;
	graph: number;
	message: number;
	author: number;
	sha: number;
}
export const TOOLS_WIDTH = 32;
const GIT_GRAPH_GEOMETRY = {
	rowHeight: 23,
	columnWidth: 18,
	avatarSize: 18,
	graphPadding: 18,
	graphWidth: 360,
	lineWidth: 2,
	curveRadius: 9,
} as const;
export const {
	rowHeight: ROW_HEIGHT,
	columnWidth: COLUMN_WIDTH,
	graphPadding: GRAPH_PADDING,
} = GIT_GRAPH_GEOMETRY;
export function hexToRgba(hex: string, alpha: number) {
	const c = hex.replace("#", "");
	const n = c.length === 3 ? c.replace(/[\s\S]/g, "$&$&") : c;
	return `rgba(${Number.parseInt(n.slice(0, 2), 16)}, ${Number.parseInt(n.slice(2, 4), 16)}, ${Number.parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
export { AVATAR_SIZE } from "../components/CommitGraph/styles.ts";

import type { GitWorktree } from "../../../../../build/presentation/contracts/GitWorktree.ts";
import { readStoredJson } from "../../../../adapters/storage/stored-values.ts";
import type {
	GraphNode,
	GraphPresentation,
	RenderGraphRow,
} from "../../../repository/model/git-graph.ts";
export interface CommitGraphProps {
	searchQuery?: string;
	searchActive?: boolean;
	emptyLabel?: string;
	onSearchChange?: (query: string) => void;
	commits: GraphNode[];
	rows: RenderGraphRow[];
	presentation: GraphPresentation;
	preferences: GraphPreferences;
	onPreferencesChange: (
		update:
			| GraphPreferences
			| ((current: GraphPreferences) => GraphPreferences),
	) => void;
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
const ROW_OVERSCAN = 12;
export const EMPTY_SELECTED_IDS: readonly string[] = [];
export const MIN_COLUMN_WIDTHS: ColumnWidths = {
	date: 84,
	refs: 96,
	graph: 48,
	message: 160,
	author: 88,
	sha: 56,
};
export const MAX_COLUMN_WIDTH = 480;
export function preferencesKey(repositoryKey?: string) {
	return `commit-graph-columns-v12:${repositoryKey ?? "default"}`;
}
export function scrollPreferencesKey(repositoryKey?: string) {
	return `commit-graph-scroll-v1:${repositoryKey ?? "default"}`;
}
export function loadPreferences(repositoryKey?: string): GraphPreferences {
	return rustProject(
		"graphPreferences",
		readStoredJson(preferencesKey(repositoryKey), {}),
	);
}
export interface RowTransition {
	row: number;
	fromCol: number;
	toCol: number;
	color: string;
}
export const DEFAULT_GIT_GRAPH_HISTORY_LIMIT = 1_000;
export function nextGitGraphHistoryLimit(current: number): number {
	return rustProject("nextHistoryLimit", current);
}

function graphVirtualRange(
	itemCount: number,
	scrollTop: number,
	viewportHeight: number,
) {
	const count = Math.max(0, Math.floor(itemCount));
	const viewport = Math.max(0, viewportHeight);
	const scroll = Math.max(0, scrollTop);
	return {
		start: Math.max(0, Math.floor(scroll / ROW_HEIGHT) - ROW_OVERSCAN),
		end: Math.min(
			count,
			Math.ceil((scroll + viewport) / ROW_HEIGHT) + ROW_OVERSCAN,
		),
	};
}
export function moveGraphColumn(
	order: readonly ColumnKey[],
	source: ColumnKey,
	target: ColumnKey,
): ColumnKey[] {
	return rustProject("moveColumn", { order, source, target });
}
function buildGraphConnectionPath(connection: RowTransition): string {
	return rustProject("graphPath", connection);
}

function buildGraphConvergencePath(connection: RowTransition): string {
	return rustProject("graphPath", { ...connection, convergence: true });
}

export function buildCommitGraphViewModel({
	commits,
	presentation,
	order,
	widths,
	columns,
	worktrees,
}: Pick<CommitGraphProps, "commits" | "presentation" | "worktrees"> &
	Pick<GraphPreferences, "columns" | "order" | "widths">) {
	const geometry = rustProject<{
		displayColumns: number[];
		graphWidth: number;
		graphLeft: number;
		graphHeight: number;
		tableWidth: number;
		totalHeight: number;
	}>("graphLayout", {
		commitColumns: commits.map((commit) => commit.column),
		pinnedColumns: presentation.pinnedColumns,
		order,
		widths,
		columns,
	});
	const displayGraphColumn = (column: number) =>
		geometry.displayColumns[column] ?? column;
	const columnX = (column: number) =>
		GRAPH_PADDING +
		displayGraphColumn(column) * COLUMN_WIDTH +
		COLUMN_WIDTH / 2;
	const remap = (transition: RowTransition) => ({
		...transition,
		fromCol: displayGraphColumn(transition.fromCol),
		toCol: displayGraphColumn(transition.toCol),
	});
	const connectionPath = (transition: RowTransition) =>
		buildGraphConnectionPath(remap(transition));
	const convergencePath = (transition: RowTransition) =>
		buildGraphConvergencePath(remap(transition));
	const selectableItems = presentation.selectableItems;
	return {
		columnX,
		connectionPath,
		containingBranches: new Map(
			Object.entries(presentation.containingBranches),
		),
		convergencePath,
		defaultRemoteName: presentation.defaultRemoteName,
		displayGraphColumn,
		...geometry,
		hiddenRefDetails: presentation.hiddenRefDetails,
		hiddenRefNames: new Set(presentation.hiddenRefNames),
		itemIndexes: new Map(selectableItems.map((id, index) => [id, index])),
		matchingHashes: new Set(selectableItems),
		pinnedRefNames: new Set(presentation.pinnedRefNames),
		reachableHistory: new Set(presentation.reachableHistory),
		selectableItems,
		worktreesByPath: new Map(worktrees?.map((tree) => [tree.path, tree]) ?? []),
	};
}

export function projectCommitGraphViewport(
	rows: readonly RenderGraphRow[],
	itemCount: number,
	scrollTop: number,
	viewportHeight: number,
) {
	const { start: visibleStart, end: visibleEnd } = graphVirtualRange(
		itemCount,
		Math.max(0, scrollTop - TOP_PADDING),
		viewportHeight,
	);
	const visibleRows = rows.slice(visibleStart, visibleEnd);
	const connections = (key: "convergences" | "transitions") =>
		visibleRows.flatMap((row) =>
			row[key].map((transition) => ({
				row: row.row,
				fromCol: transition.fromColumn,
				toCol: transition.toColumn,
				color: transition.color,
			})),
		);
	const segments = (key: "rails" | "truncatedEdges", prefix: string) =>
		visibleRows.flatMap((row) =>
			row[key].map((segment) => ({
				...segment,
				key: `${prefix}-${row.row}-${segment.column}`,
				row: row.row,
			})),
		);
	return {
		convergences: connections("convergences"),
		railSegments: segments("rails", "rail"),
		transitions: connections("transitions"),
		truncatedSegments: segments("truncatedEdges", "truncated"),
		visibleEnd,
		visibleStart,
	};
}
