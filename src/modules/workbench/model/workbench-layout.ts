export type DockEdge = "center" | "left" | "right" | "top" | "bottom";
export type DockOuterEdge = Exclude<DockEdge, "center">;

export const MIN_RESPONSIVE_PANE_WIDTH = 300;

export function getResponsiveGridColumns(
	availableWidth: number,
	preferredColumns: number,
): number {
	const widthColumns = Math.max(
		1,
		Math.floor(Math.max(0, availableWidth) / MIN_RESPONSIVE_PANE_WIDTH),
	);
	return Math.max(1, Math.min(4, preferredColumns, widthColumns));
}

export function getGridCanvasWidthPercent(
	occupiedColumns: number,
	availableColumns: number,
): number {
	const safeAvailableColumns = Math.max(1, availableColumns);
	const safeOccupiedColumns = Math.max(
		1,
		Math.min(safeAvailableColumns, occupiedColumns),
	);
	return (safeOccupiedColumns / safeAvailableColumns) * 100;
}

export type DockTree =
	| { readonly type: "panel"; readonly id: string }
	| {
			readonly type: "split";
			readonly direction: "horizontal" | "vertical";
			readonly ratio: number;
			readonly first: DockTree;
			readonly second: DockTree;
	  };

function panel(id: string): DockTree {
	return { type: "panel", id };
}

function split(
	direction: "horizontal" | "vertical",
	first: DockTree,
	second: DockTree,
	ratio?: number,
): DockTree {
	const firstSpan = dockAxisSpan(first, direction);
	const secondSpan = dockAxisSpan(second, direction);
	return {
		type: "split",
		direction,
		ratio: clampRatio(ratio ?? firstSpan / (firstSpan + secondSpan)),
		first,
		second,
	};
}

function clampRatio(ratio: number) {
	return Math.max(0.14, Math.min(0.86, ratio));
}

export function dockAxisSpan(
	tree: DockTree,
	direction: "horizontal" | "vertical",
): number {
	if (tree.type === "panel") return 1;
	const first = dockAxisSpan(tree.first, direction);
	const second = dockAxisSpan(tree.second, direction);
	return tree.direction === direction
		? first + second
		: Math.max(first, second);
}

export function dockPanelIds(tree: DockTree | null): string[] {
	if (!tree) return [];
	if (tree.type === "panel") return [tree.id];
	return [...dockPanelIds(tree.first), ...dockPanelIds(tree.second)];
}

/** Transform leaves in one traversal. Reconciliation preserves split ratios;
 * moving a panel recomputes them to match the remaining panel spans. */
function transformPanels(
	tree: DockTree,
	visit: (leaf: Extract<DockTree, { type: "panel" }>) => DockTree | null,
	preserveRatio: boolean | "clamp" = false,
): DockTree | null {
	if (tree.type === "panel") return visit(tree);
	const first = transformPanels(tree.first, visit, preserveRatio);
	const second = transformPanels(tree.second, visit, preserveRatio);
	if (!first) return second;
	if (!second) return first;
	return preserveRatio === true
		? { ...tree, first, second }
		: split(
				tree.direction,
				first,
				second,
				preserveRatio ? tree.ratio : undefined,
			);
}

function beside(tree: DockTree, id: string, edge: DockEdge): DockTree {
	const direction =
		edge === "top" || edge === "bottom" ? "vertical" : "horizontal";
	return edge === "left" || edge === "top"
		? split(direction, panel(id), tree)
		: split(direction, tree, panel(id));
}

function buildRow(ids: readonly string[]): DockTree {
	return ids
		.slice(1)
		.reduce<DockTree>(
			(tree, id) => split("horizontal", tree, panel(id)),
			panel(ids[0]!),
		);
}

export function createDockTree(
	ids: readonly string[],
	columns: number,
): DockTree | null {
	if (ids.length === 0) return null;
	const safeColumns = Math.max(1, Math.min(columns, ids.length));
	const rows: DockTree[] = [];
	for (let index = 0; index < ids.length; index += safeColumns) {
		rows.push(buildRow(ids.slice(index, index + safeColumns)));
	}
	return rows
		.slice(1)
		.reduce<DockTree>((tree, row) => split("vertical", tree, row), rows[0]!);
}

export function constrainDockTreeColumns(
	tree: DockTree,
	columns: number,
): DockTree {
	const safeColumns = Math.max(1, columns);
	if (dockAxisSpan(tree, "horizontal") <= safeColumns) return tree;
	return createDockTree(dockPanelIds(tree), safeColumns) ?? tree;
}

function appendDockPanelWithinColumns(
	tree: DockTree,
	id: string,
	columns: number,
): DockTree {
	const safeColumns = Math.max(1, columns);
	const appendToLastRow = (
		node: DockTree,
	): { readonly tree: DockTree; readonly appended: boolean } => {
		if (node.type === "split" && node.direction === "vertical") {
			const result = appendToLastRow(node.second);
			return result.appended
				? { tree: { ...node, second: result.tree }, appended: true }
				: { tree: node, appended: false };
		}
		if (dockAxisSpan(node, "horizontal") >= safeColumns) {
			return { tree: node, appended: false };
		}
		return {
			tree: split("horizontal", node, panel(id)),
			appended: true,
		};
	};

	const constrained = constrainDockTreeColumns(tree, safeColumns);
	const result = appendToLastRow(constrained);
	return result.appended
		? result.tree
		: split("vertical", constrained, panel(id));
}

export function reconcileDockTree(
	tree: DockTree | null,
	ids: readonly string[],
	columns: number,
): DockTree | null {
	const allowed = new Set(ids);
	let next = tree
		? transformPanels(
				tree,
				(leaf) => (allowed.has(leaf.id) ? leaf : null),
				"clamp",
			)
		: null;
	if (next) next = constrainDockTreeColumns(next, columns);
	const present = new Set(dockPanelIds(next));
	for (const id of ids) {
		if (present.has(id)) continue;
		next = next ? appendDockPanelWithinColumns(next, id, columns) : panel(id);
		present.add(id);
	}
	return next ?? createDockTree(ids, columns);
}

export type DockTreePath = readonly ("first" | "second")[];

export function resizeDockSplit(
	tree: DockTree,
	path: DockTreePath,
	ratio: number,
): DockTree {
	if (path.length === 0) {
		return tree.type === "split" ? { ...tree, ratio: clampRatio(ratio) } : tree;
	}
	if (tree.type === "panel") return tree;
	const [branch, ...rest] = path;
	return branch === "first"
		? { ...tree, first: resizeDockSplit(tree.first, rest, ratio) }
		: { ...tree, second: resizeDockSplit(tree.second, rest, ratio) };
}

export function moveDockPanel(
	tree: DockTree,
	sourceId: string,
	targetId: string,
	edge: DockEdge,
): DockTree {
	if (sourceId === targetId) return tree;
	const ids = dockPanelIds(tree);
	if (!ids.includes(sourceId) || !ids.includes(targetId)) return tree;
	if (edge === "center")
		return transformPanels(
			tree,
			(leaf) =>
				leaf.id === sourceId
					? panel(targetId)
					: leaf.id === targetId
						? panel(sourceId)
						: leaf,
			true,
		)!;
	const withoutSource = transformPanels(tree, (leaf) =>
		leaf.id === sourceId ? null : leaf,
	);
	if (!withoutSource) return tree;
	return transformPanels(withoutSource, (leaf) =>
		leaf.id === targetId ? beside(leaf, sourceId, edge) : leaf,
	)!;
}

export function moveDockPanelToOuterEdge(
	tree: DockTree,
	sourceId: string,
	edge: DockOuterEdge,
): DockTree {
	const ids = dockPanelIds(tree);
	if (ids.length < 2 || !ids.includes(sourceId)) return tree;
	const withoutSource = transformPanels(tree, (leaf) =>
		leaf.id === sourceId ? null : leaf,
	);
	if (!withoutSource) return tree;
	return beside(withoutSource, sourceId, edge);
}

export function insertDockPanel(
	tree: DockTree,
	panelId: string,
	targetId: string,
	edge: DockEdge,
): DockTree {
	const ids = dockPanelIds(tree);
	if (ids.includes(panelId) || !ids.includes(targetId)) return tree;
	return transformPanels(tree, (leaf) =>
		leaf.id === targetId ? beside(leaf, panelId, edge) : leaf,
	)!;
}

export function insertDockPanelAtOuterEdge(
	tree: DockTree,
	panelId: string,
	edge: DockOuterEdge,
): DockTree {
	if (dockPanelIds(tree).includes(panelId)) return tree;
	return beside(tree, panelId, edge);
}

export function parseDockTree(value: string | null): DockTree | null {
	if (!value) return null;
	try {
		return parseDockNode(JSON.parse(value));
	} catch {
		return null;
	}
}

/** Validate and normalize persisted nodes together, with the same depth bound. */
function parseDockNode(value: unknown, depth = 0): DockTree | null {
	if (!value || typeof value !== "object" || depth > 32) return null;
	const node = value as Record<string, unknown>;
	if (node.type === "panel")
		return typeof node.id === "string" ? panel(node.id) : null;
	if (
		node.type !== "split" ||
		(node.direction !== "horizontal" && node.direction !== "vertical") ||
		(node.ratio !== undefined &&
			(typeof node.ratio !== "number" || !Number.isFinite(node.ratio)))
	)
		return null;
	const first = parseDockNode(node.first, depth + 1);
	const second = parseDockNode(node.second, depth + 1);
	return first && second
		? split(node.direction, first, second, node.ratio as number | undefined)
		: null;
}
