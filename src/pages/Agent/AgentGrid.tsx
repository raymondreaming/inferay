import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import type React from "react";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import {
	constrainDockTreeColumns,
	createDockTree,
	type DockEdge,
	type DockOuterEdge,
	type DockTree,
	dockAxisSpan,
	insertDockPanel,
	insertDockPanelAtOuterEdge,
	moveDockPanel,
	moveDockPanelToOuterEdge,
	parseDockTree,
	reconcileDockTree,
	resizeDockSplit,
} from "../../components/workspace/workspace-dock-model.ts";
import type {
	AgentKind,
	AgentPaneModel,
	AgentTheme,
} from "../../features/agent/agent-utils.ts";
import { useGitStatus } from "../../features/git/useGitStatus.tsx";
import { lockPointerSelection } from "../../lib/pointer-selection-lock.ts";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import { color, controlSize, layer, motion } from "../../tokens.stylex.ts";
import { AgentPaneView } from "./AgentPaneView.tsx";

const EMPTY_CWD_LIST: string[] = [];
const EMPTY_AUXILIARY_PANELS: readonly AuxiliaryPanel[] = [];
const ROOT_DOCK_TARGET_ID = "__workspace-root__";
const MIN_GRID_ROW_HEIGHT = 340;

type AuxiliaryPanel = {
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

interface AgentGridProps {
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

const paneViewProps = (
	p: AgentGridProps,
	pane: AgentPaneModel,
	idx: number,
	onDragStart: (e: PointerEvent, i: number) => void,
	onDragEnd: () => void,
	gitBranch: string | null,
) => ({
	pane,
	isSelected: p.active !== false && pane.id === p.selectedPaneId,
	isVisible: p.active !== false,
	theme: p.theme,
	fontSize: p.fontSize,
	fontFamily: p.fontFamily,
	gitBranch,
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

function canScrollInDirection(element: HTMLElement, deltaY: number) {
	if (deltaY < 0) return element.scrollTop > 0;
	if (deltaY > 0) {
		return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
	}
	return false;
}

function isWorkspaceDockDragSource(target: EventTarget | null) {
	return (
		target instanceof Element &&
		!!target.closest('[data-workspace-dock-drag-source="true"]')
	);
}

function isVerticalScroller(element: HTMLElement) {
	const style = window.getComputedStyle(element);
	return (
		(style.overflowY === "auto" || style.overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight
	);
}

function findVerticalScroller(
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

function scrollElementBy(element: HTMLElement, deltaY: number) {
	const maxScrollTop =
		element.scrollHeight > element.clientHeight
			? element.scrollHeight - element.clientHeight
			: Number.POSITIVE_INFINITY;
	element.scrollTop = Math.max(
		0,
		Math.min(maxScrollTop, element.scrollTop + deltaY),
	);
}

function canScrollHorizontally(element: HTMLElement, deltaX: number) {
	if (deltaX < 0) return element.scrollLeft > 0;
	if (deltaX > 0) {
		return element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
	}
	return false;
}

function dockEdgeForPoint(
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

function outerDockEdgeForPointer(
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

function dropEdgeStyle(edge: DockEdge | null) {
	if (edge === "left") return styles.dropLeft;
	if (edge === "right") return styles.dropRight;
	if (edge === "top") return styles.dropTop;
	if (edge === "bottom") return styles.dropBottom;
	return styles.dropCenter;
}

export const AgentGrid = memo(function AgentGrid(props: AgentGridProps) {
	const {
		active = true,
		panes,
		columns,
		rows,
		layoutMode,
		theme,
		onReorderPanes,
		workspaceId = "default",
		auxiliaryPanels = EMPTY_AUXILIARY_PANELS,
	} = props;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const dragIndexRef = useRef<number | null>(null);
	const clearDragStateRef = useRef<() => void>(() => {});
	const interactionPaneIdRef = useRef<string | null>(null);
	const pendingPanelDropRef = useRef<{
		readonly id: string;
		readonly complete: () => void;
	} | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [dragPanelId, setDragPanelId] = useState<string | null>(null);
	const [dockTarget, setDockTarget] = useState<{
		readonly id: string;
		readonly edge: DockEdge;
	} | null>(null);
	const dockStorageKey = `agent-workspace-dock:${workspaceId}`;
	const auxiliaryPanelIdKey = auxiliaryPanels
		.map((panel) => panel.id)
		.join("\u0000");
	const panelIds = useMemo(
		() => [
			...panes.map((pane) => pane.id),
			...auxiliaryPanelIdKey.split("\u0000").filter(Boolean),
		],
		[auxiliaryPanelIdKey, panes],
	);
	const [dockTree, setDockTree] = useState<DockTree | null>(() =>
		parseDockTree(readStoredValue(dockStorageKey)),
	);
	const layoutPresetRef = useRef(`${layoutMode}:${columns}`);
	const renderedDockTree = useMemo(
		() => reconcileDockTree(dockTree, panelIds, columns),
		[columns, dockTree, panelIds],
	);
	const dockVerticalSpan = renderedDockTree
		? Math.max(1, dockAxisSpan(renderedDockTree, "vertical"))
		: 1;
	const dockCanvasMinHeight = `max(${Math.max(
		100,
		(dockVerticalSpan / Math.max(1, rows)) * 100,
	)}%, ${dockVerticalSpan * MIN_GRID_ROW_HEIGHT}px)`;
	const chatStatusCwds = useMemo(() => {
		if (!active) return EMPTY_CWD_LIST;
		const seen = new Set<string>();
		const cwds: string[] = [];
		for (const pane of panes) {
			if (!pane.cwd || seen.has(pane.cwd)) continue;
			seen.add(pane.cwd);
			cwds.push(pane.cwd);
		}
		return cwds;
	}, [active, panes]);
	const { projectMap: chatProjectMap } = useGitStatus(chatStatusCwds, {
		enabled: active && chatStatusCwds.length > 0,
	});
	const clearDragState = useCallback(() => {
		dragIndexRef.current = null;
		pendingPanelDropRef.current = null;
		setDragIndex(null);
		setDragOverIndex(null);
		setDragPanelId(null);
		setDockTarget(null);
	}, []);
	useEffect(() => {
		const layoutPreset = `${layoutMode}:${columns}`;
		const presetChanged = layoutPresetRef.current !== layoutPreset;
		layoutPresetRef.current = layoutPreset;
		const stored = parseDockTree(readStoredValue(dockStorageKey));
		setDockTree(
			presetChanged && layoutMode === "grid"
				? createDockTree(panelIds, columns)
				: reconcileDockTree(stored, panelIds, columns),
		);
	}, [columns, dockStorageKey, layoutMode, panelIds]);
	useEffect(() => {
		if (!renderedDockTree) return;
		writeStoredValue(dockStorageKey, JSON.stringify(renderedDockTree));
	}, [dockStorageKey, renderedDockTree]);
	useEffect(() => {
		clearDragStateRef.current = clearDragState;
	}, [clearDragState]);

	const commitDockPlacement = useCallback(
		(
			sourceId: string,
			target: { readonly id: string; readonly edge: DockEdge },
			pendingPanel: {
				readonly id: string;
				readonly complete: () => void;
			} | null,
		) => {
			if (!renderedDockTree) return;
			let nextTree: DockTree;
			if (target.id === ROOT_DOCK_TARGET_ID && target.edge !== "center") {
				nextTree = pendingPanel
					? insertDockPanelAtOuterEdge(
							renderedDockTree,
							pendingPanel.id,
							target.edge,
						)
					: moveDockPanelToOuterEdge(renderedDockTree, sourceId, target.edge);
			} else {
				nextTree = pendingPanel
					? insertDockPanel(
							renderedDockTree,
							pendingPanel.id,
							target.id,
							target.edge,
						)
					: moveDockPanel(renderedDockTree, sourceId, target.id, target.edge);
			}
			if (layoutMode === "grid") {
				nextTree = constrainDockTreeColumns(nextTree, columns);
			}
			writeStoredValue(dockStorageKey, JSON.stringify(nextTree));
			setDockTree(nextTree);
			pendingPanel?.complete();
			if (!pendingPanel && panes.some((pane) => pane.id === sourceId)) {
				props.onSelectPane(sourceId);
			}
		},
		[
			columns,
			dockStorageKey,
			layoutMode,
			panes,
			props.onSelectPane,
			renderedDockTree,
		],
	);

	const beginPointerDock = useCallback(
		(
			event: PointerEvent,
			sourceId: string,
			sourceIndex: number | null,
			pendingPanel: {
				readonly id: string;
				readonly complete: () => void;
			} | null = null,
		) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			const releaseSelection = lockPointerSelection();
			const source = event.currentTarget as HTMLElement | null;
			const pointerId = event.pointerId;
			const startX = event.clientX;
			const startY = event.clientY;
			let activated = false;
			let finished = false;
			let target: {
				readonly id: string;
				readonly edge: DockEdge;
				readonly rowIndex?: number;
			} | null = null;
			pendingPanelDropRef.current = pendingPanel;
			try {
				source?.setPointerCapture(pointerId);
			} catch {}

			const updateTarget = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== pointerId) return;
				if (!activated) {
					const distance = Math.hypot(
						moveEvent.clientX - startX,
						moveEvent.clientY - startY,
					);
					if (distance < 3) return;
					activated = true;
					dragIndexRef.current = sourceIndex;
					setDragIndex(sourceIndex);
					setDragPanelId(sourceId);
				}
				moveEvent.preventDefault();
				const root = containerRef.current;
				if (!root) return;
				if (layoutMode !== "rows") {
					const outerEdge = outerDockEdgeForPointer(moveEvent, root);
					const canUseOuterEdge = pendingPanel
						? panelIds.length > 0
						: panelIds.length > 1;
					if (outerEdge && canUseOuterEdge) {
						target = { id: ROOT_DOCK_TARGET_ID, edge: outerEdge };
						setDockTarget(target);
						setDragOverIndex(null);
						return;
					}
				}
				const hit = document.elementFromPoint(
					moveEvent.clientX,
					moveEvent.clientY,
				);
				const row = hit?.closest<HTMLElement>("[data-agent-row-pane-id]");
				if (row) {
					const rowId = row.dataset.agentRowPaneId;
					const rowIndex = panes.findIndex((pane) => pane.id === rowId);
					target =
						rowId && rowIndex >= 0
							? { id: rowId, edge: "center", rowIndex }
							: null;
					setDragOverIndex(target?.rowIndex ?? null);
					setDockTarget(null);
					return;
				}
				const cell = hit?.closest<HTMLElement>("[data-agent-grid-pane-id]");
				const targetId = cell?.dataset.agentGridPaneId;
				if (!cell || !targetId || (!pendingPanel && targetId === sourceId)) {
					target = null;
					setDockTarget(null);
					return;
				}
				target = {
					id: targetId,
					edge: dockEdgeForPoint(moveEvent.clientX, moveEvent.clientY, cell),
				};
				setDockTarget(target);
			};

			const finish = (finishEvent: PointerEvent | null, commit: boolean) => {
				if (finishEvent && finishEvent.pointerId !== pointerId) return;
				if (finished) return;
				finished = true;
				window.removeEventListener("pointermove", updateTarget);
				window.removeEventListener("pointerup", finishDrop);
				window.removeEventListener("pointercancel", cancelDrop);
				window.removeEventListener("blur", cancelAbandonedDrag);
				source?.removeEventListener("lostpointercapture", cancelAbandonedDrag);
				try {
					source?.releasePointerCapture(pointerId);
				} catch {}
				releaseSelection();
				if (commit && activated && target) {
					if (
						layoutMode === "rows" &&
						sourceIndex !== null &&
						target.rowIndex !== undefined
					) {
						if (sourceIndex !== target.rowIndex) {
							onReorderPanes?.(sourceIndex, target.rowIndex);
						}
					} else {
						commitDockPlacement(sourceId, target, pendingPanel);
					}
				} else if (!activated && sourceIndex !== null) {
					props.onSelectPane(sourceId);
				}
				clearDragState();
			};
			const finishDrop = (finishEvent: PointerEvent) =>
				finish(finishEvent, true);
			const cancelDrop = (finishEvent: PointerEvent) =>
				finish(finishEvent, false);
			const cancelAbandonedDrag = () => finish(null, false);
			window.addEventListener("pointermove", updateTarget);
			window.addEventListener("pointerup", finishDrop);
			window.addEventListener("pointercancel", cancelDrop);
			window.addEventListener("blur", cancelAbandonedDrag);
			source?.addEventListener("lostpointercapture", cancelAbandonedDrag);
		},
		[
			clearDragState,
			commitDockPlacement,
			layoutMode,
			onReorderPanes,
			panelIds.length,
			panes,
			props.onSelectPane,
		],
	);

	const handleHeaderDragStart = useCallback(
		(event: PointerEvent, index: number) => {
			const paneId = panes[index]?.id;
			if (paneId) beginPointerDock(event, paneId, index);
		},
		[beginPointerDock, panes],
	);
	const handleAuxiliaryDragStart = useCallback(
		(event: PointerEvent) => {
			const panelId = (
				event.currentTarget as HTMLElement | null
			)?.closest<HTMLElement>("[data-agent-grid-pane-id]")?.dataset
				.agentGridPaneId;
			if (panelId) beginPointerDock(event, panelId, null);
		},
		[beginPointerDock],
	);
	const handleCreatePanelDragStart = useCallback(
		(event: PointerEvent, panelId: string, completeDrop: () => void) =>
			beginPointerDock(event, panelId, null, {
				id: panelId,
				complete: completeDrop,
			}),
		[beginPointerDock],
	);

	const handleHeaderDragEnd = useCallback(() => {
		clearDragState();
	}, [clearDragState]);

	const handleDividerPointerDown = useCallback(
		(
			event: PointerEvent & { currentTarget: HTMLButtonElement },
			path: readonly ("first" | "second")[],
			direction: "horizontal" | "vertical",
		) => {
			const splitElement = event.currentTarget.parentElement;
			if (!splitElement) return;
			event.preventDefault();
			const releaseSelection = lockPointerSelection();
			const pointerId = event.pointerId;
			event.currentTarget.setPointerCapture?.(pointerId);
			const resize = (moveEvent: PointerEvent) => {
				const rect = splitElement.getBoundingClientRect();
				const ratio =
					direction === "horizontal"
						? (moveEvent.clientX - rect.left) / Math.max(1, rect.width)
						: (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
				setDockTree((current) =>
					current ? resizeDockSplit(current, path, ratio) : current,
				);
			};
			const finish = () => {
				releaseSelection();
				window.removeEventListener("pointermove", resize);
				window.removeEventListener("pointerup", finish);
				window.removeEventListener("pointercancel", finish);
			};
			window.addEventListener("pointermove", resize);
			window.addEventListener("pointerup", finish);
			window.addEventListener("pointercancel", finish);
		},
		[],
	);

	const handleRowWheelCapture = useCallback(
		(event: WheelEvent & { currentTarget: HTMLDivElement }) => {
			if (layoutMode !== "rows") return;
			const rowScroller = containerRef.current;
			if (!rowScroller) return;
			const target =
				event.target instanceof Element
					? event.target.closest<HTMLElement>("[data-agent-row-pane-id]")
					: null;
			const targetPaneId = target?.dataset.agentRowPaneId ?? null;
			if (!targetPaneId) return;
			const isHorizontalGesture =
				event.shiftKey ||
				(Math.abs(event.deltaX) > 0 &&
					Math.abs(event.deltaX) >= Math.abs(event.deltaY));
			if (!isHorizontalGesture) return;
			event.preventDefault();
			event.stopPropagation();
			if (targetPaneId === props.selectedPaneId) return;
			const delta = event.shiftKey ? event.deltaY : event.deltaX;
			if (canScrollHorizontally(rowScroller, delta)) {
				rowScroller.scrollLeft += delta;
			}
		},
		[layoutMode, props.selectedPaneId],
	);
	const handleGridWheelCapture = useCallback(
		(event: WheelEvent & { currentTarget: HTMLDivElement }) => {
			if (layoutMode !== "grid" || event.deltaY === 0) return;
			const grid = containerRef.current;
			if (!grid) return;
			const target =
				event.target instanceof Element
					? event.target.closest<HTMLElement>("[data-agent-grid-pane-id]")
					: null;
			if (!target) return;
			const targetPaneId = target.dataset.agentGridPaneId ?? null;
			const innerScroller = findVerticalScroller(event.target, target);
			if (
				targetPaneId === interactionPaneIdRef.current &&
				innerScroller &&
				canScrollInDirection(innerScroller, event.deltaY)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			scrollElementBy(grid, event.deltaY);
		},
		[layoutMode],
	);

	useEffect(() => {
		if (!active) {
			clearDragState();
			return;
		}
		const handleGlobalDragEnd = () => clearDragStateRef.current();
		window.addEventListener("dragend", handleGlobalDragEnd);
		window.addEventListener("drop", handleGlobalDragEnd);
		return () => {
			window.removeEventListener("dragend", handleGlobalDragEnd);
			window.removeEventListener("drop", handleGlobalDragEnd);
		};
	}, [active, clearDragState]);

	const cellStyle = (idx: number): React.CSSProperties =>
		({
			borderColor:
				dragOverIndex === idx && dragIndex !== idx
					? (theme.cursor ?? "#d6ff00")
					: theme.separator,
			opacity: dragIndex === idx ? 0.4 : 1,
		}) as React.CSSProperties;

	if (layoutMode === "rows" && auxiliaryPanels.length === 0) {
		return (
			<div
				ref={containerRef}
				{...stylex.props(styles.rowScroller)}
				onWheelCapture={handleRowWheelCapture}
				data-agent-row-scroll-area
			>
				{panes.map((pane, idx) => (
					<div
						key={pane.id}
						data-agent-row-pane-id={pane.id}
						{...stylex.props(styles.rowCell)}
						style={{ ...cellStyle(idx), width: 400 }}
						onPointerDownCapture={(event) => {
							if (isWorkspaceDockDragSource(event.target)) return;
							if (pane.id !== props.selectedPaneId) {
								window.getSelection()?.removeAllRanges();
							}
							props.onSelectPane(pane.id);
						}}
					>
						<AgentPaneView
							{...paneViewProps(
								props,
								pane,
								idx,
								handleHeaderDragStart,
								handleHeaderDragEnd,
								pane.cwd
									? (chatProjectMap.get(pane.cwd)?.branch ?? null)
									: null,
							)}
						/>
					</div>
				))}
			</div>
		);
	}

	const renderDockNode = (
		node: DockTree,
		path: readonly ("first" | "second")[] = [],
	): unknown => {
		if (node.type === "split") {
			return (
				<div
					key={`${node.direction}:${node.first.type === "panel" ? node.first.id : "split"}:${node.second.type === "panel" ? node.second.id : "split"}`}
					{...stylex.props(
						styles.dockSplit,
						node.direction === "horizontal"
							? styles.dockHorizontal
							: styles.dockVertical,
					)}
				>
					<div
						{...stylex.props(styles.dockBranch)}
						style={{ flexBasis: 0, flexGrow: node.ratio }}
					>
						{renderDockNode(node.first, [...path, "first"])}
					</div>
					<button
						type="button"
						aria-label={`Resize ${node.direction === "horizontal" ? "columns" : "rows"}`}
						onPointerDown={(event) =>
							handleDividerPointerDown(event, path, node.direction)
						}
						{...stylex.props(
							styles.dockDivider,
							node.direction === "horizontal"
								? styles.dockDividerHorizontal
								: styles.dockDividerVertical,
						)}
					/>
					<div
						{...stylex.props(styles.dockBranch)}
						style={{ flexBasis: 0, flexGrow: 1 - node.ratio }}
					>
						{renderDockNode(node.second, [...path, "second"])}
					</div>
				</div>
			);
		}
		const paneIndex = panes.findIndex((pane) => pane.id === node.id);
		const pane = paneIndex >= 0 ? panes[paneIndex] : null;
		const auxiliaryPanel = auxiliaryPanels.find(
			(panel) => panel.id === node.id,
		);
		const isDropTarget = dockTarget?.id === node.id && dragPanelId !== node.id;
		return (
			<div
				key={node.id}
				data-agent-grid-pane-id={node.id}
				{...stylex.props(styles.dockCell)}
				onPointerDownCapture={(event) => {
					if (isWorkspaceDockDragSource(event.target)) return;
					if (pane) {
						if (pane.id !== props.selectedPaneId) {
							window.getSelection()?.removeAllRanges();
						}
						interactionPaneIdRef.current = pane.id;
						props.onSelectPane(pane.id);
						return;
					}
					interactionPaneIdRef.current = node.id;
					auxiliaryPanel?.onSelect?.();
				}}
				onClickCapture={(event) => {
					if (!isWorkspaceDockDragSource(event.target)) return;
					interactionPaneIdRef.current = node.id;
					if (pane) props.onSelectPane(pane.id);
					else auxiliaryPanel?.onSelect?.();
				}}
			>
				{pane ? (
					<AgentPaneView
						{...paneViewProps(
							props,
							pane,
							paneIndex,
							handleHeaderDragStart,
							handleHeaderDragEnd,
							pane.cwd ? (chatProjectMap.get(pane.cwd)?.branch ?? null) : null,
						)}
					/>
				) : auxiliaryPanel ? (
					auxiliaryPanel.render({
						draggable: true,
						onDragStart: handleAuxiliaryDragStart,
						onCreatePanelDragStart: handleCreatePanelDragStart,
						onDragEnd: handleHeaderDragEnd,
					})
				) : null}
				{isDropTarget ? (
					<div
						aria-hidden="true"
						{...stylex.props(
							styles.dropIndicator,
							dropEdgeStyle(dockTarget.edge),
						)}
					/>
				) : null}
			</div>
		);
	};

	return (
		<div
			ref={containerRef}
			{...stylex.props(styles.dockRoot)}
			data-agent-grid-scroll-area
			onWheelCapture={handleGridWheelCapture}
		>
			<div
				{...stylex.props(styles.dockCanvas)}
				style={{ minHeight: dockCanvasMinHeight }}
			>
				{renderedDockTree ? renderDockNode(renderedDockTree) : null}
			</div>
			{dockTarget?.id === ROOT_DOCK_TARGET_ID ? (
				<div
					aria-hidden="true"
					{...stylex.props(
						styles.dropIndicator,
						styles.rootDropIndicator,
						dropEdgeStyle(dockTarget.edge),
					)}
				/>
			) : null}
		</div>
	);
});

const styles = stylex.create({
	rowScroller: {
		backgroundColor: color.transparent,
		display: "flex",
		height: "100%",
		overflowX: "auto",
		overscrollBehavior: "none",
	},
	rowCell: {
		backgroundColor: color.transparent,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		flexShrink: 0,
		height: "100%",
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, opacity",
	},
	gridScroller: {
		backgroundColor: color.transparent,
		display: "grid",
		height: "100%",
		overflowX: "hidden",
		overflowY: "auto",
		overscrollBehavior: "contain",
	},
	gridCell: {
		backgroundColor: color.transparent,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, opacity",
	},
	dockRoot: {
		position: "relative",
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflowX: "hidden",
		overflowY: "auto",
		overscrollBehavior: "contain",
	},
	dockCanvas: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		flexShrink: 0,
	},
	dockSplit: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	dockHorizontal: { flexDirection: "row" },
	dockVertical: { flexDirection: "column" },
	dockBranch: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	dockDivider: {
		position: "relative",
		zIndex: layer.dropdown,
		flexShrink: 0,
		borderWidth: 0,
		padding: controlSize._0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
	},
	dockDividerHorizontal: {
		width: controlSize._1_25,
		height: "100%",
		marginInline: -2,
		cursor: "col-resize",
		"::before": {
			content: "",
			position: "absolute",
			insetBlock: controlSize._0,
			left: controlSize._0_5,
			width: controlSize._0_25,
			backgroundColor: "var(--color-inferay-gray-border)",
		},
	},
	dockDividerVertical: {
		width: "100%",
		height: controlSize._1_25,
		marginBlock: -2,
		cursor: "row-resize",
		"::before": {
			content: "",
			position: "absolute",
			insetInline: controlSize._0,
			top: controlSize._0_5,
			height: controlSize._0_25,
			backgroundColor: "var(--color-inferay-gray-border)",
		},
	},
	dockCell: {
		position: "relative",
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	dropIndicator: {
		position: "absolute",
		zIndex: layer.workspaceOverlay,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--color-inferay-gray-border-bold)",
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-white) 10%, transparent)",
		pointerEvents: "none",
	},
	rootDropIndicator: {
		zIndex: layer.workspaceDrag,
	},
	dropLeft: { insetBlock: controlSize._2, left: controlSize._2, width: "42%" },
	dropRight: {
		insetBlock: controlSize._2,
		right: controlSize._2,
		width: "42%",
	},
	dropTop: { insetInline: controlSize._2, top: controlSize._2, height: "42%" },
	dropBottom: {
		insetInline: controlSize._2,
		bottom: controlSize._2,
		height: "42%",
	},
	dropCenter: { inset: controlSize._3 },
});
