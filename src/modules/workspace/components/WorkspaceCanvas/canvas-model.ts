import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import type {
	DockEdge,
	DockOuterEdge,
} from "../../../workbench/model/workbench-layout.ts";
import type {
	AgentKind,
	AgentPaneModel,
	AgentTheme,
} from "../../model/workspace-model.ts";

export const EMPTY_AUXILIARY_PANELS: readonly AuxiliaryPanel[] = [];

export const ROOT_DOCK_TARGET_ID = "__workspace-root__";

export const MIN_GRID_ROW_HEIGHT = 340;

export type AuxiliaryPanel = {
	readonly id: string;
	readonly onSelect?: () => void;
	readonly render: (drag: {
		readonly draggable: boolean;
		readonly onDragStart: (event: PointerEvent) => void;
		readonly onCreatePanelDragStart: (
			event: PointerEvent,
			panelId: string,
			completeDrop: () => void,
		) => void;
		readonly onDragEnd: () => void;
	}) => unknown;
};

export interface WorkspaceCanvasProps {
	active?: boolean;
	panes: AgentPaneModel[];
	selectedPaneId: string | null;
	columns: number;
	rows: number;
	layoutMode: "grid" | "rows";
	theme: AgentTheme;
	fontSize: number;
	fontFamily: string;
	onSelectPane: (paneId: string) => void;
	onFocusPane?: (paneId: string) => void;
	onClosePane: (paneId: string, force?: boolean) => void;
	onDirectorySelect: (
		paneId: string,
		path: string | null,
		referencePaths?: string[],
	) => void;
	onDirectoryCancel: (paneId: string) => void;
	onChatRef: (paneId: string, handle: AgentChatHandle | null) => void;
	onAgentStatusChange?: (paneId: string, status: string) => void;
	onReorderPanes?: (fromIndex: number, toIndex: number) => void;
	onAddPane?: (agentKind: AgentKind) => void;
	onSetPaneAgentKind?: (paneId: string, agentKind: AgentKind) => void;
	workspaceId?: string;
	auxiliaryPanels?: readonly AuxiliaryPanel[];
}

export const paneViewProps = (
	p: WorkspaceCanvasProps,
	pane: AgentPaneModel,
	idx: number,
	onDragStart: (e: PointerEvent, i: number) => void,
	onDragEnd: () => void,
) => ({
	pane,
	isSelected: p.active !== false && pane.id === p.selectedPaneId,
	isVisible: p.active !== false,
	theme: p.theme,
	fontSize: p.fontSize,
	fontFamily: p.fontFamily,
	onSelect: p.onSelectPane,
	onClose: p.onClosePane,
	onDirectorySelect: p.onDirectorySelect,
	onDirectoryCancel: p.onDirectoryCancel,
	chatRef: p.onChatRef,
	onAgentStatusChange: p.onAgentStatusChange,
	paneIndex: idx,
	onHeaderDragStart: onDragStart,
	onHeaderDragEnd: onDragEnd,
	onAddPane: p.onAddPane,
	onSetPaneAgentKind: p.onSetPaneAgentKind,
});

export function canScrollInDirection(element: HTMLElement, deltaY: number) {
	if (deltaY < 0) return element.scrollTop > 0;
	if (deltaY > 0) {
		return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
	}
	return false;
}

export function isWorkspaceDockDragSource(target: EventTarget | null) {
	return (
		target instanceof Element &&
		!!target.closest('[data-workspace-dock-drag-source="true"]')
	);
}

export function shouldFocusPaneComposer(target: EventTarget | null) {
	if (!(target instanceof Element)) return true;
	if (
		target.closest(
			"button, input, textarea, select, a, [contenteditable='true']",
		)
	) {
		return false;
	}
	return window.getSelection()?.isCollapsed !== false;
}

export function isVerticalScroller(element: HTMLElement) {
	const style = window.getComputedStyle(element);
	return (
		(style.overflowY === "auto" || style.overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight
	);
}

export function findVerticalScroller(
	target: EventTarget | null,
	boundary: HTMLElement,
) {
	let element = target instanceof HTMLElement ? target : null;
	while (element && element !== boundary) {
		if (isVerticalScroller(element)) return element;
		element = element.parentElement;
	}
	for (const descendant of boundary.querySelectorAll<HTMLElement>("*")) {
		if (isVerticalScroller(descendant)) return descendant;
	}
	return null;
}

export function scrollElementBy(element: HTMLElement, deltaY: number) {
	const maxScrollTop =
		element.scrollHeight > element.clientHeight
			? element.scrollHeight - element.clientHeight
			: Number.POSITIVE_INFINITY;
	element.scrollTop = Math.max(
		0,
		Math.min(maxScrollTop, element.scrollTop + deltaY),
	);
}

export function canScrollHorizontally(element: HTMLElement, deltaX: number) {
	if (deltaX < 0) return element.scrollLeft > 0;
	if (deltaX > 0) {
		return element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
	}
	return false;
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
	if (distance > 0.28) return "center";
	if (distance === x) return "left";
	if (distance === 1 - x) return "right";
	if (distance === y) return "top";
	return "bottom";
}

export function outerDockEdgeForPointer(
	event: { readonly clientX: number; readonly clientY: number },
	root: HTMLElement,
): DockOuterEdge | null {
	const rect = root.getBoundingClientRect();
	const edgeBand = Math.min(
		72,
		Math.max(28, Math.min(rect.width, rect.height) * 0.1),
	);
	const distances = [
		["left", event.clientX - rect.left],
		["right", rect.right - event.clientX],
		["top", event.clientY - rect.top],
		["bottom", rect.bottom - event.clientY],
	] as const;
	const closest = distances.reduce((best, candidate) =>
		candidate[1] < best[1] ? candidate : best,
	);
	return closest[1] >= 0 && closest[1] <= edgeBand ? closest[0] : null;
}
