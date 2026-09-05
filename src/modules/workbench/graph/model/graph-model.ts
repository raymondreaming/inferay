import type { GitGraphRef } from "../../../repository/hooks/useGitGraph.tsx";
export interface GraphSelectionIntent {
	additive: boolean;
	range: boolean;
}
export interface ColumnVisibility {
	author: boolean;
	sha: boolean;
	date: boolean;
}
export type ColumnKey = GraphColumnKey;
export interface ColumnWidths {
	date: number;
	refs: number;
	graph: number;
	message: number;
	author: number;
	sha: number;
}
export const ROW_HEIGHT = 23;
export const COLUMN_WIDTH = 18;
export const GRAPH_PADDING = 18;
export const TOOLS_WIDTH = 32;
export function hexToRgba(hex: string, alpha: number) {
	const c = hex.replace("#", "");
	const n =
		c.length === 3
			? c
					.split("")
					.map((ch) => `${ch}${ch}`)
					.join("")
			: c;
	return `rgba(${Number.parseInt(n.slice(0, 2), 16)}, ${Number.parseInt(n.slice(2, 4), 16)}, ${Number.parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
export function refPresentationLabel(ref: GitGraphRef): string {
	if (ref.kind !== "remoteBranch" || !ref.remoteName) return ref.displayName;
	const remotePrefix = `${ref.remoteName}/`;
	return ref.displayName.startsWith(remotePrefix)
		? ref.displayName.slice(remotePrefix.length)
		: ref.displayName;
}
export { AVATAR_SIZE } from "../components/CommitGraph/styles.ts";

import { readStoredJson } from "../../../../adapters/storage/stored-values.ts";
import type {
	GitWorktree,
	GraphNode,
	GraphRow,
} from "../../../repository/hooks/useGitGraph.tsx";
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
		columns: {
			...DEFAULT_COLUMNS,
			...stored.columns,
		},
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
export type GraphColumnKey =
	| "date"
	| "refs"
	| "graph"
	| "message"
	| "author"
	| "sha";
export interface GraphPresentationTransition {
	row: number;
	fromCol: number;
	toCol: number;
	color: string;
}
export interface GraphVirtualRange {
	start: number;
	end: number;
}

/**
 * One geometry scale shared by virtualization, lanes, nodes, and SVG routing.
 * These values are measured from the AIVRE-Core GitKraken reference captures.
 */
export const GIT_GRAPH_GEOMETRY = {
	rowHeight: 23,
	columnWidth: 18,
	avatarSize: 18,
	graphPadding: 18,
	graphWidth: 360,
	lineWidth: 2,
	curveRadius: 9,
} as const;

/**
 * The 1,000-row first page keeps typical repositories complete in one request
 * while the viewport-bounded renderer stays below 60 mounted rows. Larger
 * histories grow geometrically to avoid many full-snapshot round trips.
 */
export const DEFAULT_GIT_GRAPH_HISTORY_LIMIT = 1_000;
export const MAX_GIT_GRAPH_HISTORY_LIMIT = 100_000;
export function nextGitGraphHistoryLimit(current: number): number {
	return Math.min(
		MAX_GIT_GRAPH_HISTORY_LIMIT,
		Math.max(current + 1_000, current * 2),
	);
}

/**
 * Return the half-open item range that should be mounted for a scroll viewport.
 * Keeping this calculation outside the renderer makes large-history behavior
 * deterministic and independently measurable.
 */
export function graphVirtualRange(
	itemCount: number,
	scrollTop: number,
	viewportHeight: number,
	rowHeight = GIT_GRAPH_GEOMETRY.rowHeight,
	overscan = 12,
): GraphVirtualRange {
	const count = Math.max(0, Math.floor(itemCount));
	const height = Math.max(1, rowHeight);
	const viewport = Math.max(0, viewportHeight);
	const scroll = Math.max(0, scrollTop);
	const padding = Math.max(0, Math.floor(overscan));
	return {
		start: Math.max(0, Math.floor(scroll / height) - padding),
		end: Math.min(count, Math.ceil((scroll + viewport) / height) + padding),
	};
}
export function moveGraphColumn(
	order: readonly GraphColumnKey[],
	source: GraphColumnKey,
	target: GraphColumnKey,
): GraphColumnKey[] {
	const sourceIndex = order.indexOf(source);
	const targetIndex = order.indexOf(target);
	if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
		return [...order];
	}
	const next = [...order];
	next.splice(sourceIndex, 1);
	next.splice(targetIndex, 0, source);
	return next;
}
export function pinnedGraphColumnOrder(
	maxColumn: number,
	pinnedColumns: readonly number[],
): number[] {
	const validPinned = [...new Set(pinnedColumns)].filter(
		(column) => column >= 0 && column <= maxColumn,
	);
	const pinned = new Set(validPinned);
	return [
		...validPinned,
		...Array.from(
			{
				length: maxColumn + 1,
			},
			(_, column) => column,
		).filter((column) => !pinned.has(column)),
	];
}
export function buildGraphConnectionPath(
	connection: GraphPresentationTransition,
	{
		refWidth = 0,
		rowHeight = GIT_GRAPH_GEOMETRY.rowHeight,
		columnWidth = GIT_GRAPH_GEOMETRY.columnWidth,
		graphPadding = GIT_GRAPH_GEOMETRY.graphPadding,
		curveRadius: requestedCurveRadius = GIT_GRAPH_GEOMETRY.curveRadius,
	}: {
		refWidth?: number;
		rowHeight?: number;
		columnWidth?: number;
		graphPadding?: number;
		curveRadius?: number;
	} = {},
): string {
	const rowY = (row: number) => row * rowHeight + rowHeight / 2;
	const x1 =
		refWidth +
		graphPadding +
		connection.fromCol * columnWidth +
		columnWidth / 2;
	const y1 = rowY(connection.row);
	const x2 =
		refWidth + graphPadding + connection.toCol * columnWidth + columnWidth / 2;
	const endY = rowY(connection.row + 1);
	const directionToCommit = x1 > x2 ? 1 : -1;
	const curveRadius = Math.min(
		requestedCurveRadius,
		rowHeight / 2,
		Math.abs(x2 - x1) / 2,
	);
	const curveEndX = x2 + directionToCommit * curveRadius;
	// Terminate beneath the opaque node instead of at its mathematical edge.
	// This avoids antialiasing gaps when a row uses a smaller merge dot while
	// keeping the visible line clipped cleanly by avatar-sized nodes.
	const nodeEdgeX = x1;
	const sweep = directionToCommit > 0 ? 1 : 0;
	return [
		`M ${x2} ${endY}`,
		`L ${x2} ${y1 + curveRadius}`,
		`A ${curveRadius} ${curveRadius} 0 0 ${sweep} ${curveEndX} ${y1}`,
		`L ${nodeEdgeX} ${y1}`,
	].join(" ");
}

/** Route an incoming duplicate edge from the row above into its parent node. */
export function buildGraphConvergencePath(
	connection: GraphPresentationTransition,
	{
		rowHeight = GIT_GRAPH_GEOMETRY.rowHeight,
		columnWidth = GIT_GRAPH_GEOMETRY.columnWidth,
		graphPadding = GIT_GRAPH_GEOMETRY.graphPadding,
		curveRadius: requestedCurveRadius = GIT_GRAPH_GEOMETRY.curveRadius,
	}: {
		rowHeight?: number;
		columnWidth?: number;
		graphPadding?: number;
		curveRadius?: number;
	} = {},
): string {
	const centerY = connection.row * rowHeight + rowHeight / 2;
	const topY = connection.row * rowHeight;
	const fromX =
		graphPadding + connection.fromCol * columnWidth + columnWidth / 2;
	const toX = graphPadding + connection.toCol * columnWidth + columnWidth / 2;
	const direction = toX < fromX ? -1 : 1;
	const curveRadius = Math.min(
		requestedCurveRadius,
		rowHeight / 2,
		Math.abs(toX - fromX) / 2,
	);
	const curveEndX = fromX + direction * curveRadius;
	const nodeEdgeX = toX;
	const sweep = direction < 0 ? 1 : 0;
	return [
		`M ${fromX} ${topY}`,
		`L ${fromX} ${centerY - curveRadius}`,
		`A ${curveRadius} ${curveRadius} 0 0 ${sweep} ${curveEndX} ${centerY}`,
		`L ${nodeEdgeX} ${centerY}`,
	].join(" ");
}
