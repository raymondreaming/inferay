export type GraphColumnKey =
	| "date"
	| "refs"
	| "graph"
	| "message"
	| "author"
	| "sha";

export interface GraphPresentationNode {
	id: string;
	hash: string;
	parents: string[];
}

export interface GraphPresentationRef {
	fullName: string;
	displayName: string;
	kind: "head" | "localBranch" | "remoteBranch" | "tag" | "stash";
	target: string;
}

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
		...Array.from({ length: maxColumn + 1 }, (_, column) => column).filter(
			(column) => !pinned.has(column),
		),
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
