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

import { readStoredJson } from "../../../../adapters/storage/stored-values.ts";
import type {
	GitGraphRef,
	GitWorktree,
	GraphNode,
	GraphRow,
} from "../../../repository/model/git-graph.ts";
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
const ROW_OVERSCAN = 12;
const DEFAULT_COLUMN_ORDER: ColumnKey[] = [
	"date",
	"refs",
	"graph",
	"message",
	"author",
	"sha",
];
export const EMPTY_SELECTED_IDS: readonly string[] = [];
const DEFAULT_COLUMNS: ColumnVisibility = {
	author: true,
	sha: true,
	date: true,
};
const DEFAULT_WIDTHS: ColumnWidths = {
	date: 132,
	refs: 192,
	graph: 96,
	message: 340,
	author: 136,
	sha: 76,
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
function normalizedColumnWidths(
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
	return `commit-graph-columns-v12:${repositoryKey ?? "default"}`;
}
export function scrollPreferencesKey(repositoryKey?: string) {
	return `commit-graph-scroll-v1:${repositoryKey ?? "default"}`;
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
export interface RowTransition {
	row: number;
	fromCol: number;
	toCol: number;
	color: string;
}
export const DEFAULT_GIT_GRAPH_HISTORY_LIMIT = 1_000;
const MAX_GIT_GRAPH_HISTORY_LIMIT = 100_000;
export function nextGitGraphHistoryLimit(current: number): number {
	return Math.min(
		MAX_GIT_GRAPH_HISTORY_LIMIT,
		Math.max(current + 1_000, current * 2),
	);
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
	const sourceIndex = order.indexOf(source);
	const targetIndex = order.indexOf(target);
	if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
		return [...order];
	const next = [...order];
	next.splice(sourceIndex, 1);
	next.splice(targetIndex, 0, source);
	return next;
}
function pinnedGraphColumnOrder(
	maxColumn: number,
	pinnedColumns: readonly number[],
): number[] {
	const validPinned = [...new Set(pinnedColumns)].filter(
		(column) => column >= 0 && column <= maxColumn,
	);
	const pinned = new Set(validPinned);
	return [
		...validPinned,
		...Array.from({ length: maxColumn + 1 }, (_, column) => column).filter(
			(column) => !pinned.has(column),
		),
	];
}
const {
	rowHeight,
	columnWidth,
	graphPadding,
	curveRadius: requestedCurveRadius,
} = GIT_GRAPH_GEOMETRY;

function buildGraphConnectionPath(connection: RowTransition): string {
	const rowY = (row: number) => row * rowHeight + rowHeight / 2;
	const x1 = graphPadding + connection.fromCol * columnWidth + columnWidth / 2;
	const y1 = rowY(connection.row);
	const x2 = graphPadding + connection.toCol * columnWidth + columnWidth / 2;
	const endY = rowY(connection.row + 1);
	const directionToCommit = x1 > x2 ? 1 : -1;
	const curveRadius = Math.min(
		requestedCurveRadius,
		rowHeight / 2,
		Math.abs(x2 - x1) / 2,
	);
	const curveEndX = x2 + directionToCommit * curveRadius;
	const sweep = directionToCommit > 0 ? 1 : 0;
	return [
		`M ${x2} ${endY}`,
		`L ${x2} ${y1 + curveRadius}`,
		`A ${curveRadius} ${curveRadius} 0 0 ${sweep} ${curveEndX} ${y1}`,
		`L ${x1} ${y1}`,
	].join(" ");
}

function buildGraphConvergencePath(connection: RowTransition): string {
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
	const sweep = direction < 0 ? 1 : 0;
	return [
		`M ${fromX} ${topY}`,
		`L ${fromX} ${centerY - curveRadius}`,
		`A ${curveRadius} ${curveRadius} 0 0 ${sweep} ${curveEndX} ${centerY}`,
		`L ${toX} ${centerY}`,
	].join(" ");
}

export function buildCommitGraphViewModel({
	ancestry,
	commits,
	hiddenRefs,
	order,
	pinnedRefs,
	soloRefs,
	widths,
	columns,
	worktrees,
}: Pick<CommitGraphProps, "ancestry" | "commits" | "worktrees"> &
	Pick<
		GraphPreferences,
		"columns" | "hiddenRefs" | "order" | "pinnedRefs" | "soloRefs" | "widths"
	>) {
	const repositoryRefs = new Map<string, GitGraphRef>();
	for (const commit of commits)
		for (const ref of commit.refs) repositoryRefs.set(ref.fullName, ref);
	const containingBranches = new Map(
		commits.flatMap((commit) => {
			const ref = repositoryRefs.get(commit.navigation?.containingBranch ?? "");
			return ref ? [[commit.id, ref] as const] : [];
		}),
	);
	const hiddenRefDetails = hiddenRefs.flatMap((name) => {
		const ref = repositoryRefs.get(name);
		return ref ? [ref] : [];
	});
	const defaultRemoteName = Array.from(repositoryRefs.values()).find(
		(ref) => ref.kind === "remoteBranch" && ref.remoteName,
	)?.remoteName;
	const reachableHistory = new Set<string>();
	for (const ref of soloRefs)
		for (const [start, end] of ancestry?.[ref] ?? [])
			for (let row = start; row <= end && row < commits.length; row++)
				reachableHistory.add(commits[row]!.id);
	const maxColumn = commits.reduce(
		(max, commit) => Math.max(max, commit.column),
		0,
	);
	const pinnedColumns = pinnedRefs.flatMap((name) => {
		const target = repositoryRefs.get(name)?.target;
		const column = target
			? commits.find((commit) => commit.hash === target || commit.id === target)
					?.column
			: undefined;
		return column === undefined ? [] : [column];
	});
	const positions = new Map(
		pinnedGraphColumnOrder(maxColumn, pinnedColumns).map((column, index) => [
			column,
			index,
		]),
	);
	const displayGraphColumn = (column: number) =>
		positions.get(column) ?? column;
	const graphWidth = Math.max(
		widths.graph,
		(maxColumn + 1) * COLUMN_WIDTH + GRAPH_PADDING * 2,
	);
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
	const visibleColumns = order.filter(
		(column) =>
			(column !== "date" || columns.date) &&
			(column !== "author" || columns.author) &&
			(column !== "sha" || columns.sha),
	);
	const renderedWidth = (column: ColumnKey) =>
		column === "graph" ? graphWidth : widths[column];
	const graphLeft = visibleColumns
		.slice(0, visibleColumns.indexOf("graph"))
		.reduce((total, column) => total + renderedWidth(column), 0);
	const selectableItems = commits.map((commit) => commit.id);
	return {
		columnX,
		connectionPath,
		containingBranches,
		convergencePath,
		defaultRemoteName,
		displayGraphColumn,
		graphHeight: commits.length * ROW_HEIGHT,
		graphLeft,
		graphWidth,
		hiddenRefDetails,
		hiddenRefNames: new Set(hiddenRefs),
		itemIndexes: new Map(selectableItems.map((id, index) => [id, index])),
		matchingHashes: new Set(selectableItems),
		pinnedRefNames: new Set(pinnedRefs),
		reachableHistory,
		selectableItems,
		tableWidth:
			visibleColumns.reduce(
				(total, column) => total + renderedWidth(column),
				0,
			) + TOOLS_WIDTH,
		totalHeight: TOP_PADDING + commits.length * ROW_HEIGHT,
		worktreesByPath: new Map(worktrees?.map((tree) => [tree.path, tree]) ?? []),
	};
}

export function projectCommitGraphViewport(
	rows: readonly GraphRow[],
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
