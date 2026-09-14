import type { DockTree } from "@contracts";
import { project } from "@shared/lib/native.tsx";

export type DockEdge = "center" | "left" | "right" | "top" | "bottom";
export type DockOuterEdge = Exclude<DockEdge, "center">;
export const MIN_RESPONSIVE_PANE_WIDTH = 300;
export const ROOT_DOCK_TARGET_ID = "__workspace-root__";
export const MIN_GRID_ROW_HEIGHT = 340;

export function resizeDockSplit(
	tree: DockTree,
	path: readonly ("first" | "second")[],
	ratio: number,
): DockTree {
	return project("resizeDockSplit", { tree, path, ratio });
}

export const canScrollInDirection = (element: HTMLElement, delta: number) =>
	delta < 0
		? element.scrollTop > 0
		: delta > 0 &&
			element.scrollTop + element.clientHeight < element.scrollHeight - 1;
export const canScrollHorizontally = (element: HTMLElement, delta: number) =>
	delta < 0
		? element.scrollLeft > 0
		: delta > 0 &&
			element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
export const isWorkspaceDockDragSource = (target: EventTarget | null) =>
	target instanceof Element &&
	!!target.closest('[data-workspace-dock-drag-source="true"]');
export const shouldFocusPaneComposer = (target: EventTarget | null) =>
	!(target instanceof Element) ||
	(!target.closest("button,input,textarea,select,a,[contenteditable='true']") &&
		window.getSelection()?.isCollapsed !== false);

const isScroller = (element: HTMLElement) =>
	["auto", "scroll"].includes(getComputedStyle(element).overflowY) &&
	element.scrollHeight > element.clientHeight;

export function findVerticalScroller(
	target: EventTarget | null,
	boundary: HTMLElement,
) {
	let element = target instanceof HTMLElement ? target : null;
	while (element && element !== boundary) {
		if (isScroller(element)) return element;
		element = element.parentElement;
	}
	return (
		[...boundary.querySelectorAll<HTMLElement>("*")].find(isScroller) ?? null
	);
}

export function scrollElementBy(element: HTMLElement, delta: number) {
	element.scrollTop = Math.max(
		0,
		Math.min(
			element.scrollHeight > element.clientHeight
				? element.scrollHeight - element.clientHeight
				: Infinity,
			element.scrollTop + delta,
		),
	);
}

export function dockEdgeForPoint(
	clientX: number,
	clientY: number,
	element: HTMLElement,
): DockEdge {
	const rect = element.getBoundingClientRect();
	const x = (clientX - rect.left) / Math.max(1, rect.width);
	const y = (clientY - rect.top) / Math.max(1, rect.height);
	const distance = Math.min(x, 1 - x, y, 1 - y);
	return distance > 0.28
		? "center"
		: distance === x
			? "left"
			: distance === 1 - x
				? "right"
				: distance === y
					? "top"
					: "bottom";
}

export function outerDockEdgeForPointer(
	event: { readonly clientX: number; readonly clientY: number },
	root: HTMLElement,
): DockOuterEdge | null {
	const rect = root.getBoundingClientRect();
	const band = Math.min(
		72,
		Math.max(28, Math.min(rect.width, rect.height) * 0.1),
	);
	const closest = (
		[
			["left", event.clientX - rect.left],
			["right", rect.right - event.clientX],
			["top", event.clientY - rect.top],
			["bottom", rect.bottom - event.clientY],
		] as const
	).reduce((first, second) => (second[1] < first[1] ? second : first));
	return closest[1] >= 0 && closest[1] <= band ? closest[0] : null;
}
