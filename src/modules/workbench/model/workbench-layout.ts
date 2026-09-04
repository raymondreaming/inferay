export type DockEdge = "center" | "left" | "right" | "top" | "bottom";
export type DockOuterEdge = Exclude<DockEdge, "center">;

export const MIN_RESPONSIVE_PANE_WIDTH = 250;

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

function pruneDockTree(
	tree: DockTree,
	allowed: ReadonlySet<string>,
): DockTree | null {
	if (tree.type === "panel") return allowed.has(tree.id) ? tree : null;
	const first = pruneDockTree(tree.first, allowed);
	const second = pruneDockTree(tree.second, allowed);
	if (!first) return second;
	if (!second) return first;
	return split(tree.direction, first, second, tree.ratio);
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
	let next = tree ? pruneDockTree(tree, allowed) : null;
	if (next) next = constrainDockTreeColumns(next, columns);
	const present = new Set(dockPanelIds(next));
	for (const id of ids) {
		if (present.has(id)) continue;
		next = next ? appendDockPanelWithinColumns(next, id, columns) : panel(id);
		present.add(id);
	}
	return next ?? createDockTree(ids, columns);
}

function removePanel(tree: DockTree, id: string): DockTree | null {
	if (tree.type === "panel") return tree.id === id ? null : tree;
	const first = removePanel(tree.first, id);
	const second = removePanel(tree.second, id);
	if (!first) return second;
	if (!second) return first;
	return split(tree.direction, first, second);
}

function replacePanel(
	tree: DockTree,
	targetId: string,
	replacement: (target: DockTree) => DockTree,
): DockTree {
	if (tree.type === "panel") {
		return tree.id === targetId ? replacement(tree) : tree;
	}
	return split(
		tree.direction,
		replacePanel(tree.first, targetId, replacement),
		replacePanel(tree.second, targetId, replacement),
	);
}

function swapPanels(
	tree: DockTree,
	firstId: string,
	secondId: string,
): DockTree {
	if (tree.type === "panel") {
		if (tree.id === firstId) return panel(secondId);
		if (tree.id === secondId) return panel(firstId);
		return tree;
	}
	return {
		...tree,
		first: swapPanels(tree.first, firstId, secondId),
		second: swapPanels(tree.second, firstId, secondId),
	};
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
	if (edge === "center") return swapPanels(tree, sourceId, targetId);
	const withoutSource = removePanel(tree, sourceId);
	if (!withoutSource) return tree;
	const direction =
		edge === "left" || edge === "right" ? "horizontal" : "vertical";
	return replacePanel(withoutSource, targetId, (target) =>
		edge === "left" || edge === "top"
			? split(direction, panel(sourceId), target)
			: split(direction, target, panel(sourceId)),
	);
}

export function moveDockPanelToOuterEdge(
	tree: DockTree,
	sourceId: string,
	edge: DockOuterEdge,
): DockTree {
	const ids = dockPanelIds(tree);
	if (ids.length < 2 || !ids.includes(sourceId)) return tree;
	const withoutSource = removePanel(tree, sourceId);
	if (!withoutSource) return tree;
	const direction =
		edge === "left" || edge === "right" ? "horizontal" : "vertical";
	return edge === "left" || edge === "top"
		? split(direction, panel(sourceId), withoutSource)
		: split(direction, withoutSource, panel(sourceId));
}

export function insertDockPanel(
	tree: DockTree,
	panelId: string,
	targetId: string,
	edge: DockEdge,
): DockTree {
	const ids = dockPanelIds(tree);
	if (ids.includes(panelId) || !ids.includes(targetId)) return tree;
	const placement = edge === "center" ? "right" : edge;
	const direction =
		placement === "left" || placement === "right" ? "horizontal" : "vertical";
	return replacePanel(tree, targetId, (target) =>
		placement === "left" || placement === "top"
			? split(direction, panel(panelId), target)
			: split(direction, target, panel(panelId)),
	);
}

export function insertDockPanelAtOuterEdge(
	tree: DockTree,
	panelId: string,
	edge: DockOuterEdge,
): DockTree {
	if (dockPanelIds(tree).includes(panelId)) return tree;
	const direction =
		edge === "left" || edge === "right" ? "horizontal" : "vertical";
	return edge === "left" || edge === "top"
		? split(direction, panel(panelId), tree)
		: split(direction, tree, panel(panelId));
}

export function parseDockTree(value: string | null): DockTree | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!isDockTreeShape(parsed)) return null;
		const normalized = normalizeDockTree(parsed);
		return dockPanelIds(normalized).length > 0 ? normalized : null;
	} catch {
		return null;
	}
}

type PersistedDockTree =
	| { readonly type: "panel"; readonly id: string }
	| {
			readonly type: "split";
			readonly direction: "horizontal" | "vertical";
			readonly ratio?: number;
			readonly first: PersistedDockTree;
			readonly second: PersistedDockTree;
	  };

function normalizeDockTree(tree: PersistedDockTree): DockTree {
	if (tree.type === "panel") return panel(tree.id);
	return split(
		tree.direction,
		normalizeDockTree(tree.first),
		normalizeDockTree(tree.second),
		typeof tree.ratio === "number" && Number.isFinite(tree.ratio)
			? tree.ratio
			: undefined,
	);
}

function isDockTreeShape(
	value: unknown,
	depth = 0,
): value is PersistedDockTree {
	if (!value || typeof value !== "object" || depth > 32) return false;
	const candidate = value as Record<string, unknown>;
	if (candidate.type === "panel") return typeof candidate.id === "string";
	return (
		candidate.type === "split" &&
		(candidate.direction === "horizontal" ||
			candidate.direction === "vertical") &&
		(candidate.ratio === undefined ||
			(typeof candidate.ratio === "number" &&
				Number.isFinite(candidate.ratio))) &&
		isDockTreeShape(candidate.first, depth + 1) &&
		isDockTreeShape(candidate.second, depth + 1)
	);
}
