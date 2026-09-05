import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../../adapters/storage/stored-values.ts";
import { lockPointerSelection } from "../../../../shared/lib/data.ts";

import {
	constrainDockTreeColumns,
	createDockTree,
	type DockEdge,
	type DockTree,
	dockAxisSpan,
	dockPanelIds,
	getGridCanvasWidthPercent,
	getResponsiveGridColumns,
	insertDockPanel,
	insertDockPanelAtOuterEdge,
	moveDockPanel,
	moveDockPanelToOuterEdge,
	parseDockTree,
	reconcileDockTree,
	resizeDockSplit,
} from "../../../workbench/model/workbench-model.ts";
import type { WorkspaceCanvasProps } from "../../model/workspace-model.ts";
import {
	canScrollHorizontally,
	canScrollInDirection,
	dockEdgeForPoint,
	EMPTY_AUXILIARY_PANELS,
	findVerticalScroller,
	isWorkspaceDockDragSource,
	MIN_GRID_ROW_HEIGHT,
	outerDockEdgeForPointer,
	paneViewProps,
	ROOT_DOCK_TARGET_ID,
	scrollElementBy,
	shouldFocusPaneComposer,
} from "../../model/workspace-model.ts";
import { PaneView } from "../PaneView/index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function dropEdgeStyle(edge: DockEdge | null) {
	if (edge === "left") return styles.dropLeft;
	if (edge === "right") return styles.dropRight;
	if (edge === "top") return styles.dropTop;
	if (edge === "bottom") return styles.dropBottom;
	return styles.dropCenter;
}

export const WorkspaceCanvas = memo(function WorkspaceCanvas(
	props: WorkspaceCanvasProps,
) {
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
	const pendingPanelDropRef = useRef<{
		readonly id: string;
		readonly complete: () => void;
	} | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [dragPanelId, setDragPanelId] = useState<string | null>(null);
	const [availableGridColumns, setAvailableGridColumns] = useState(columns);
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
	const canonicalDockTree = useMemo(
		() => reconcileDockTree(dockTree, panelIds, columns),
		[columns, dockTree, panelIds],
	);
	const effectiveColumns =
		layoutMode === "grid"
			? Math.max(1, Math.min(columns, availableGridColumns))
			: columns;
	const renderedDockTree = useMemo(() => {
		if (
			!canonicalDockTree ||
			layoutMode !== "grid" ||
			effectiveColumns >= columns ||
			dockAxisSpan(canonicalDockTree, "horizontal") <= effectiveColumns
		) {
			return canonicalDockTree;
		}
		return createDockTree(dockPanelIds(canonicalDockTree), effectiveColumns);
	}, [canonicalDockTree, columns, effectiveColumns, layoutMode]);
	const renderedDockTreeRef = useRef(renderedDockTree);
	renderedDockTreeRef.current = renderedDockTree;
	const dockHorizontalSpan = renderedDockTree
		? Math.max(1, dockAxisSpan(renderedDockTree, "horizontal"))
		: 1;
	const dockVerticalSpan = renderedDockTree
		? Math.max(1, dockAxisSpan(renderedDockTree, "vertical"))
		: 1;
	const dockCanvasMinHeight = `max(${Math.max(
		100,
		(dockVerticalSpan / Math.max(1, rows)) * 100,
	)}%, ${dockVerticalSpan * MIN_GRID_ROW_HEIGHT}px)`;
	const dockCanvasWidth =
		layoutMode === "grid" && renderedDockTree
			? `${getGridCanvasWidthPercent(dockHorizontalSpan, effectiveColumns)}%`
			: "100%";
	const sparseGrid =
		layoutMode === "grid" &&
		!!renderedDockTree &&
		dockHorizontalSpan < effectiveColumns;
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
		if (!canonicalDockTree) return;
		writeStoredValue(dockStorageKey, JSON.stringify(canonicalDockTree));
	}, [canonicalDockTree, dockStorageKey]);
	useEffect(() => {
		const container = containerRef.current;
		if (!container || layoutMode !== "grid") return;
		const updateAvailableColumns = (width: number) => {
			const next = getResponsiveGridColumns(width, columns);
			setAvailableGridColumns((current) => (current === next ? current : next));
		};
		updateAvailableColumns(container.getBoundingClientRect().width);
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width;
			if (width !== undefined) updateAvailableColumns(width);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, [columns, layoutMode]);
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
				nextTree = constrainDockTreeColumns(nextTree, effectiveColumns);
			}
			writeStoredValue(dockStorageKey, JSON.stringify(nextTree));
			setDockTree(nextTree);
			pendingPanel?.complete();
			if (!pendingPanel && panes.some((pane) => pane.id === sourceId)) {
				props.onSelectPane(sourceId);
			}
		},
		[
			dockStorageKey,
			effectiveColumns,
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
				setDockTree(() => {
					const rendered = renderedDockTreeRef.current;
					return rendered ? resizeDockSplit(rendered, path, ratio) : rendered;
				});
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
			const innerScroller = findVerticalScroller(event.target, target);
			if (innerScroller && canScrollInDirection(innerScroller, event.deltaY)) {
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

	const cellStyle = (idx: number) =>
		inlineStyles.getCanvasCellStyle(
			dragOverIndex === idx && dragIndex !== idx
				? (theme.cursor ?? "#d6ff00")
				: theme.separator,
			dragIndex === idx ? 0.4 : 1,
		);

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
						style={inlineStyles.getWorkspaceCanvasRowCellStyle(cellStyle(idx))}
						onPointerDownCapture={(event) => {
							if (isWorkspaceDockDragSource(event.target)) return;
							if (pane.id !== props.selectedPaneId) {
								window.getSelection()?.removeAllRanges();
							}
							props.onSelectPane(pane.id);
						}}
						onClickCapture={(event) => {
							if (shouldFocusPaneComposer(event.target)) {
								props.onFocusPane?.(pane.id);
							}
						}}
					>
						<PaneView
							{...paneViewProps(
								props,
								pane,
								idx,
								handleHeaderDragStart,
								handleHeaderDragEnd,
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
						style={inlineStyles.getWorkspaceCanvasDockBranchStyle(node.ratio)}
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
						style={inlineStyles.getWorkspaceCanvasDockBranchStyle1(
							1 - node.ratio,
						)}
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
						props.onSelectPane(pane.id);
						return;
					}
					auxiliaryPanel?.onSelect?.();
				}}
				onClickCapture={(event) => {
					if (isWorkspaceDockDragSource(event.target)) {
						if (pane) props.onSelectPane(pane.id);
						else auxiliaryPanel?.onSelect?.();
					}
					if (pane && shouldFocusPaneComposer(event.target)) {
						props.onFocusPane?.(pane.id);
					}
				}}
			>
				{pane ? (
					<PaneView
						{...paneViewProps(
							props,
							pane,
							paneIndex,
							handleHeaderDragStart,
							handleHeaderDragEnd,
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
				{...stylex.props(
					styles.dockCanvas,
					sparseGrid && styles.dockCanvasSparse,
				)}
				style={inlineStyles.getWorkspaceCanvasDockCanvasStyle(
					dockCanvasMinHeight,
					dockCanvasWidth,
				)}
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
