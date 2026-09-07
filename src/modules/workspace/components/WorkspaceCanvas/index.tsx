import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { AgentTheme } from "../../../../../build/presentation/contracts/AgentTheme.ts";
import type { Pane } from "../../../../../build/presentation/contracts/Pane.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import {
	captureEvent,
	createPointerResize,
	domStyle,
	lockPointerSelection,
} from "../../../../shared/lib/dom.tsx";
import { postJson } from "../../../../shared/lib/native.tsx";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import { PaneView } from "../PaneView/index.tsx";
import { DockSplit } from "./DockSplit.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function dropEdgeStyle(edge: DockEdge | null) {
	if (edge === "left") return styles.dropLeft;
	if (edge === "right") return styles.dropRight;
	if (edge === "top") return styles.dropTop;
	if (edge === "bottom") return styles.dropBottom;
	return styles.dropCenter;
}
export const WorkspaceCanvas = function WorkspaceCanvas(
	props: WorkspaceCanvasProps,
) {
	const trackResize = createPointerResize();
	const containerRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const [dragIndex, setDragIndex] = createSignal<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = createSignal<number | null>(null);
	const [dragPanelId, setDragPanelId] = createSignal<string | null>(null);
	const [availableGridColumns, setAvailableGridColumns] = createSignal(
		props.columns,
	);
	const [dockTarget, setDockTarget] = createSignal<{
		readonly id: string;
		readonly edge: DockEdge;
	} | null>(null);
	const auxiliaryPanelIdKey = createMemo(() => {
		const _sourceValue = props;
		return (
			_sourceValue.auxiliaryPanels === undefined
				? EMPTY_AUXILIARY_PANELS
				: _sourceValue.auxiliaryPanels
		)
			.map((panel) => panel.id)
			.join("\u0000");
	});
	const panelIds = createMemo(() => [
		...props.panes.map((pane) => pane.id),
		...auxiliaryPanelIdKey().split("\u0000").filter(Boolean),
	]);
	const [layout, setLayout] = createSignal<{
		tree: DockTree | null;
		horizontal: number;
		vertical: number;
	}>({
		tree: null,
		horizontal: 1,
		vertical: 1,
	});
	const renderedDockTree = createMemo(() => layout().tree);
	const [dockError, setDockError] = createSignal<string | null>(null);
	const effectiveColumns = createMemo(() => {
		const _sourceValue2 = props;
		return _sourceValue2.layoutMode === "grid"
			? Math.max(1, Math.min(_sourceValue2.columns, availableGridColumns()))
			: _sourceValue2.columns;
	});
	const requestRevision = {
		current: 0,
	};
	const requests = {
		current: Promise.resolve(),
	};
	const panelKey = createMemo(() => JSON.stringify(panelIds()));
	const updateDock = (action?: object) => {
		const revision = ++requestRevision.current;
		const result = requests.current.then(async () => {
			const _sourceValue3 = props;
			try {
				const result = await postJson<ReturnType<typeof layout>>(
					"/api/workspace/dock",
					{
						workspaceId:
							_sourceValue3.workspaceId === undefined
								? "default"
								: _sourceValue3.workspaceId,
						ids: JSON.parse(panelKey()),
						columns: _sourceValue3.columns,
						mode: _sourceValue3.layoutMode,
						visibleColumns: effectiveColumns(),
						action,
					},
				);
				if (revision === requestRevision.current) {
					setLayout(result);
					setDockError(null);
				}
				return true;
			} catch {
				if (revision === requestRevision.current)
					setDockError("Could not save pane layout. Please retry.");
				return false;
			}
		});
		requests.current = result.then(() => {});
		return result;
	};
	createEffect(
		() => [updateDock, props, panelKey(), effectiveColumns()],
		() => {
			void updateDock();
			return () => {
				requestRevision.current++;
			};
		},
	);
	const renderedDockTreeRef = {
		current: renderedDockTree(),
	};
	createEffect(
		() => [renderedDockTree()],
		() => {
			renderedDockTreeRef.current = renderedDockTree();
		},
	);
	const _source2 = createMemo(() => layout());
	const dockCanvasMinHeight = createMemo(
		() =>
			`max(${Math.max(100, (_source2().vertical / Math.max(1, props.rows)) * 100)}%, ${_source2().vertical * MIN_GRID_ROW_HEIGHT}px)`,
	);
	const dockCanvasWidth = createMemo(() =>
		props.layoutMode === "grid" && renderedDockTree()
			? `${(_source2().horizontal / effectiveColumns()) * 100}%`
			: "100%",
	);
	const sparseGrid = createMemo(
		() =>
			props.layoutMode === "grid" &&
			!!renderedDockTree() &&
			_source2().horizontal < effectiveColumns(),
	);
	const clearDragState = () => {
		setDragIndex(null);
		setDragOverIndex(null);
		setDragPanelId(null);
		setDockTarget(null);
	};
	createEffect(
		() => {
			const _sourceValue4 = props;
			return [_sourceValue4.columns, _sourceValue4.layoutMode];
		},
		() => {
			const container = containerRef.current;
			if (!container || props.layoutMode !== "grid") return;
			const updateAvailableColumns = (width: number) => {
				const next = Math.max(
					1,
					Math.min(
						4,
						props.columns,
						Math.floor(width / MIN_RESPONSIVE_PANE_WIDTH),
					),
				);
				setAvailableGridColumns((current) =>
					current === next ? current : next,
				);
			};
			updateAvailableColumns(container.getBoundingClientRect().width);
			if (typeof ResizeObserver === "undefined") return;
			const observer = new ResizeObserver((entries) => {
				const width = entries[0]?.contentRect.width;
				if (width !== undefined) updateAvailableColumns(width);
			});
			observer.observe(container);
			return () => observer.disconnect();
		},
	);
	const commitDockPlacement = (
		sourceId: string,
		target: {
			readonly id: string;
			readonly edge: DockEdge;
		},
		pendingPanel: {
			readonly id: string;
			readonly complete: () => void;
		} | null,
	) => {
		void updateDock({
			type: "place",
			source: pendingPanel?.id ?? sourceId,
			target: target.id,
			edge: target.edge,
			insert: !!pendingPanel,
			outer: target.id === ROOT_DOCK_TARGET_ID && target.edge !== "center",
		}).then((saved) => {
			if (!saved) return;
			pendingPanel?.complete();
			if (!pendingPanel && props.panes.some((pane) => pane.id === sourceId))
				props.onSelectPane(sourceId);
		});
	};
	const beginPointerDock = (
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
		try {
			source?.setPointerCapture(pointerId);
		} catch {}
		const updateTarget = (moveEvent: PointerEvent) => {
			const _sourceValue5 = props,
				_panelIdsValue = panelIds();
			if (moveEvent.pointerId !== pointerId) return;
			if (!activated) {
				const distance = Math.hypot(
					moveEvent.clientX - startX,
					moveEvent.clientY - startY,
				);
				if (distance < 3) return;
				activated = true;
				setDragIndex(sourceIndex);
				setDragPanelId(sourceId);
			}
			moveEvent.preventDefault();
			const root = containerRef.current;
			if (!root) return;
			if (_sourceValue5.layoutMode !== "rows") {
				const outerEdge = outerDockEdgeForPointer(moveEvent, root);
				const canUseOuterEdge = pendingPanel
					? _panelIdsValue.length > 0
					: _panelIdsValue.length > 1;
				if (outerEdge && canUseOuterEdge) {
					target = {
						id: ROOT_DOCK_TARGET_ID,
						edge: outerEdge,
					};
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
				const rowIndex = _sourceValue5.panes.findIndex(
					(pane) => pane.id === rowId,
				);
				target =
					rowId && rowIndex >= 0
						? {
								id: rowId,
								edge: "center",
								rowIndex,
							}
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
			const _sourceValue6 = props;
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
					_sourceValue6.layoutMode === "rows" &&
					sourceIndex !== null &&
					target.rowIndex !== undefined
				) {
					if (sourceIndex !== target.rowIndex) {
						_sourceValue6.onReorderPanes?.(sourceIndex, target.rowIndex);
					}
				} else {
					commitDockPlacement(sourceId, target, pendingPanel);
				}
			} else if (!activated && sourceIndex !== null) {
				props.onSelectPane(sourceId);
			}
			clearDragState();
		};
		const finishDrop = (finishEvent: PointerEvent) => finish(finishEvent, true);
		const cancelDrop = (finishEvent: PointerEvent) =>
			finish(finishEvent, false);
		const cancelAbandonedDrag = () => finish(null, false);
		window.addEventListener("pointermove", updateTarget);
		window.addEventListener("pointerup", finishDrop);
		window.addEventListener("pointercancel", cancelDrop);
		window.addEventListener("blur", cancelAbandonedDrag);
		source?.addEventListener("lostpointercapture", cancelAbandonedDrag);
	};
	const handleHeaderDragStart = (event: PointerEvent, index: number) => {
		const paneId = props.panes[index]?.id;
		if (paneId) beginPointerDock(event, paneId, index);
	};
	const handleAuxiliaryDragStart = (event: PointerEvent) => {
		const panelId = (
			event.currentTarget as HTMLElement | null
		)?.closest<HTMLElement>("[data-agent-grid-pane-id]")?.dataset
			.agentGridPaneId;
		if (panelId) beginPointerDock(event, panelId, null);
	};
	const handleCreatePanelDragStart = (
		event: PointerEvent,
		panelId: string,
		completeDrop: () => void,
	) =>
		beginPointerDock(event, panelId, null, {
			id: panelId,
			complete: completeDrop,
		});
	const handleDividerPointerDown = (
		event: PointerEvent & {
			currentTarget: HTMLButtonElement;
		},
		path: readonly ("first" | "second")[],
		direction: "horizontal" | "vertical",
	) => {
		const splitElement = event.currentTarget.parentElement;
		if (!splitElement) return;
		event.preventDefault();
		const pointerId = event.pointerId;
		event.currentTarget.setPointerCapture?.(pointerId);
		let finalRatio: number | undefined;
		const resize = (moveEvent: PointerEvent) => {
			const rect = splitElement.getBoundingClientRect();
			const ratio =
				direction === "horizontal"
					? (moveEvent.clientX - rect.left) / Math.max(1, rect.width)
					: (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
			finalRatio = ratio;
			setLayout((current) => {
				const rendered = renderedDockTreeRef.current;
				return {
					...current,
					tree: rendered ? resizeDockSplit(rendered, path, ratio) : rendered,
				};
			});
		};
		trackResize(pointerId, resize, () => {
			if (finalRatio !== undefined)
				void updateDock({
					type: "resize",
					path,
					ratio: finalRatio,
				});
		});
	};
	const handleRowWheelCapture = (
		event: WheelEvent & {
			currentTarget: HTMLDivElement;
		},
	) => {
		if (props.layoutMode !== "rows") return;
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
	};
	const handleGridWheelCapture = (
		event: WheelEvent & {
			currentTarget: HTMLDivElement;
		},
	) => {
		if (props.layoutMode !== "grid" || event.deltaY === 0) return;
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
	};
	createEffect(
		() => {
			const _sourceValue7 = props;
			return [
				_sourceValue7.active === undefined ? true : _sourceValue7.active,
				clearDragState,
			];
		},
		() => {
			const _sourceValue8 = props;
			if (!(_sourceValue8.active === undefined ? true : _sourceValue8.active)) {
				clearDragState();
				return;
			}
			window.addEventListener("dragend", clearDragState);
			window.addEventListener("drop", clearDragState);
			return () => {
				window.removeEventListener("dragend", clearDragState);
				window.removeEventListener("drop", clearDragState);
			};
		},
	);
	const cellStyle = (idx: number) => {
		const _dragIndexValue = dragIndex(),
			_sourceValue9 = props;
		return inlineStyles.getCanvasCellStyle(
			dragOverIndex() === idx && _dragIndexValue !== idx
				? (_sourceValue9.theme.cursor ?? "#d6ff00")
				: _sourceValue9.theme.separator,
			_dragIndexValue === idx ? 0.4 : 1,
		);
	};
	return (
		<>
			{(() => {
				const _sourceValue1 = props;
				if (
					_sourceValue1.layoutMode === "rows" &&
					(_sourceValue1.auxiliaryPanels === undefined
						? EMPTY_AUXILIARY_PANELS
						: _sourceValue1.auxiliaryPanels
					).length === 0
				) {
					return (
						<div
							ref={[
								(element) => (containerRef.current = element),
								captureEvent("wheel", (event) =>
									handleRowWheelCapture?.(event),
								),
							]}
							{...stylex.attrs(styles.rowScroller)}
							data-agent-row-scroll-area
						>
							{
								<For each={props.panes} keyed={(row) => row.id}>
									{(pane, idx) => (
										<div
											data-agent-row-pane-id={pane().id}
											{...stylex.attrs(styles.rowCell)}
											style={domStyle(
												inlineStyles.getWorkspaceCanvasRowCellStyle(
													cellStyle(idx()),
												),
											)}
											ref={[
												captureEvent("pointerdown", (event) =>
													((event) => {
														if (isWorkspaceDockDragSource(event.target)) return;
														if (pane().id !== props.selectedPaneId) {
															window.getSelection()?.removeAllRanges();
														}
														props.onSelectPane(pane().id);
													})?.(event),
												),
												captureEvent("click", (event) =>
													((event) => {
														if (shouldFocusPaneComposer(event.target)) {
															props.onFocusPane?.(pane().id);
														}
													})?.(event),
												),
											]}
										>
											<PaneView
												{...paneViewProps(
													props,
													pane(),
													idx(),
													handleHeaderDragStart,
													clearDragState,
												)}
											/>
										</div>
									)}
								</For>
							}
						</div>
					);
				}
				const DockNode = (nodeProps: {
					node: DockTree;
					path: readonly ("first" | "second")[];
				}): import("solid-js").Element => {
					const split = createMemo(() =>
						nodeProps.node.type === "split" ? nodeProps.node : undefined,
					);
					return (
						<Show
							when={split()}
							fallback={
								<DockPanel
									id={nodeProps.node.type === "panel" ? nodeProps.node.id : ""}
								/>
							}
						>
							{(branch) => (
								<DockSplit
									direction={branch().direction}
									ratio={branch().ratio}
									first={
										<DockNode
											node={branch().first}
											path={[...nodeProps.path, "first"]}
										/>
									}
									second={
										<DockNode
											node={branch().second}
											path={[...nodeProps.path, "second"]}
										/>
									}
									onResize={(event) =>
										handleDividerPointerDown(
											event,
											nodeProps.path,
											branch().direction,
										)
									}
								/>
							)}
						</Show>
					);
				};
				const DockPanel = (panelProps: {
					id: string;
				}): import("solid-js").Element => {
					const paneIndex = createMemo(() =>
						props.panes.findIndex((pane) => pane.id === panelProps.id),
					);
					const pane = createMemo(() => {
						const _paneIndexValue = paneIndex();
						return _paneIndexValue >= 0 ? props.panes[_paneIndexValue] : null;
					});
					const auxiliaryPanel = createMemo(() => {
						const _sourceValue0 = props;
						return (
							_sourceValue0.auxiliaryPanels === undefined
								? EMPTY_AUXILIARY_PANELS
								: _sourceValue0.auxiliaryPanels
						).find((panel) => panel.id === panelProps.id);
					});
					const hasPane = createMemo(() => !!pane());
					const isDropTarget = createMemo(
						() =>
							dockTarget()?.id === panelProps.id &&
							dragPanelId() !== panelProps.id,
					);
					return (
						<div
							data-agent-grid-pane-id={panelProps.id}
							{...stylex.attrs(styles.dockCell)}
							ref={[
								captureEvent("pointerdown", (event) =>
									((event) => {
										const _paneValue = pane();
										if (isWorkspaceDockDragSource(event.target)) return;
										if (_paneValue) {
											if (_paneValue.id !== props.selectedPaneId) {
												window.getSelection()?.removeAllRanges();
											}
											props.onSelectPane(_paneValue.id);
											return;
										}
										auxiliaryPanel()?.onSelect?.();
									})?.(event),
								),
								captureEvent("click", (event) =>
									((event) => {
										const _paneValue2 = pane();
										if (isWorkspaceDockDragSource(event.target)) {
											if (_paneValue2) props.onSelectPane(_paneValue2.id);
											else auxiliaryPanel()?.onSelect?.();
										}
										if (_paneValue2 && shouldFocusPaneComposer(event.target)) {
											props.onFocusPane?.(_paneValue2.id);
										}
									})?.(event),
								),
							]}
						>
							{hasPane() ? (
								<For each={pane() ? [pane()!] : []} keyed={(item) => item.id}>
									{(item) => (
										<PaneView
											{...paneViewProps(
												props,
												item(),
												paneIndex(),
												handleHeaderDragStart,
												clearDragState,
											)}
										/>
									)}
								</For>
							) : (
								<For
									each={auxiliaryPanel() ? [auxiliaryPanel()!] : []}
									keyed={(panel) => panel.id}
								>
									{(panel) =>
										panel().render({
											draggable: true,
											onDragStart: handleAuxiliaryDragStart,
											onCreatePanelDragStart: handleCreatePanelDragStart,
											onDragEnd: clearDragState,
										})
									}
								</For>
							)}
							{isDropTarget() ? (
								<div
									aria-hidden="true"
									{...stylex.attrs(
										styles.dropIndicator,
										dropEdgeStyle(dockTarget()?.edge ?? null),
									)}
								/>
							) : null}
						</div>
					);
				};
				return (
					<div
						ref={[
							(element) => (containerRef.current = element),
							captureEvent("wheel", (event) => handleGridWheelCapture?.(event)),
						]}
						{...stylex.attrs(styles.dockRoot)}
						data-agent-grid-scroll-area
					>
						{dockError() && (
							<div role="alert">
								{dockError()}{" "}
								<button type="button" onClick={() => void updateDock()}>
									Reload layout
								</button>
							</div>
						)}
						<div
							{...stylex.attrs(
								styles.dockCanvas,
								sparseGrid() && styles.dockCanvasSparse,
							)}
							style={domStyle(
								inlineStyles.getWorkspaceCanvasDockCanvasStyle(
									dockCanvasMinHeight(),
									dockCanvasWidth(),
								),
							)}
						>
							{
								<Show when={renderedDockTree()}>
									{(tree) => <DockNode node={tree()} path={[]} />}
								</Show>
							}
						</div>
						{dockTarget()?.id === ROOT_DOCK_TARGET_ID ? (
							<div
								aria-hidden="true"
								{...stylex.attrs(
									styles.dropIndicator,
									styles.rootDropIndicator,
									dropEdgeStyle(dockTarget()!.edge),
								)}
							/>
						) : null}
					</div>
				);
			})()}
		</>
	);
};
export type DragProps = {
	readonly draggable: boolean;
	readonly onDragStart: (event: PointerEvent) => void;
	readonly onCreatePanelDragStart: (
		event: PointerEvent,
		panelId: string,
		completeDrop: () => void,
	) => void;
	readonly onDragEnd: () => void;
};
export type DockEdge = "center" | "left" | "right" | "top" | "bottom";
export type DockOuterEdge = Exclude<DockEdge, "center">;
export const MIN_RESPONSIVE_PANE_WIDTH = 300;
export type DockTree =
	| {
			readonly type: "panel";
			readonly id: string;
	  }
	| {
			readonly type: "split";
			readonly direction: "horizontal" | "vertical";
			readonly ratio: number;
			readonly first: DockTree;
			readonly second: DockTree;
	  };
function clampRatio(ratio: number) {
	return Math.max(0.14, Math.min(0.86, ratio));
}
export function resizeDockSplit(
	tree: DockTree,
	path: readonly ("first" | "second")[],
	ratio: number,
): DockTree {
	if (path.length === 0) {
		return tree.type === "split"
			? {
					...tree,
					ratio: clampRatio(ratio),
				}
			: tree;
	}
	if (tree.type === "panel") return tree;
	const [branch, ...rest] = path;
	const key = branch === "first" ? "first" : "second";
	return {
		...tree,
		[key]: resizeDockSplit(tree[key], rest, ratio),
	};
}
export type AgentLayoutMode = "grid" | "rows";
export const DEFAULT_ROWS = 1 as const;
export const EMPTY_AUXILIARY_PANELS: readonly AuxiliaryPanel[] = [];
export const ROOT_DOCK_TARGET_ID = "__workspace-root__";
export const MIN_GRID_ROW_HEIGHT = 340;
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
	}) => import("solid-js").Element;
};
export interface WorkspaceCanvasProps {
	active?: boolean;
	panes: Pane[];
	selectedPaneId: string | null;
	columns: number;
	rows: number;
	layoutMode: AgentLayoutMode;
	theme: AgentTheme;
	onSelectPane: (id: string) => void;
	onFocusPane?: (id: string) => void;
	onClosePane: (id: string) => void;
	onDirectorySelect: (
		id: string,
		path: string | null,
		references?: string[],
	) => void;
	onDirectoryCancel: (id: string) => void;
	onChatRef: (id: string, handle: AgentChatHandle | null) => void;
	onReorderPanes?: (from: number, to: number) => void;
	onAddPane?: (kind: WorkspaceAgentKind) => void;
	onSetPaneAgentKind?: (id: string, kind: WorkspaceAgentKind) => void;
	workspaceId?: string;
	auxiliaryPanels?: readonly AuxiliaryPanel[];
}
export const paneViewProps = (
	p: WorkspaceCanvasProps,
	pane: Pane,
	paneIndex: number,
	onHeaderDragStart: (e: PointerEvent, i: number) => void,
	onHeaderDragEnd: () => void,
) => ({
	pane,
	isSelected: p.active !== false && pane.id === p.selectedPaneId,
	isVisible: p.active !== false,
	onClose: p.onClosePane,
	onDirectorySelect: p.onDirectorySelect,
	onDirectoryCancel: p.onDirectoryCancel,
	chatRef: p.onChatRef,
	paneIndex,
	onHeaderDragStart,
	onHeaderDragEnd,
	onSetPaneAgentKind: p.onSetPaneAgentKind,
});
export const canScrollInDirection = (e: HTMLElement, y: number) =>
	y < 0
		? e.scrollTop > 0
		: y > 0 && e.scrollTop + e.clientHeight < e.scrollHeight - 1;
export const canScrollHorizontally = (e: HTMLElement, x: number) =>
	x < 0
		? e.scrollLeft > 0
		: x > 0 && e.scrollLeft + e.clientWidth < e.scrollWidth - 1;
export const isWorkspaceDockDragSource = (t: EventTarget | null) =>
	t instanceof Element &&
	!!t.closest('[data-workspace-dock-drag-source="true"]');
export const shouldFocusPaneComposer = (t: EventTarget | null) =>
	!(t instanceof Element) ||
	(!t.closest("button,input,textarea,select,a,[contenteditable='true']") &&
		window.getSelection()?.isCollapsed !== false);
const isScroller = (e: HTMLElement) =>
	["auto", "scroll"].includes(getComputedStyle(e).overflowY) &&
	e.scrollHeight > e.clientHeight;
export function findVerticalScroller(t: EventTarget | null, b: HTMLElement) {
	let e = t instanceof HTMLElement ? t : null;
	while (e && e !== b) {
		if (isScroller(e)) return e;
		e = e.parentElement;
	}
	return [...b.querySelectorAll<HTMLElement>("*")].find(isScroller) ?? null;
}
export function scrollElementBy(e: HTMLElement, y: number) {
	e.scrollTop = Math.max(
		0,
		Math.min(
			e.scrollHeight > e.clientHeight
				? e.scrollHeight - e.clientHeight
				: Infinity,
			e.scrollTop + y,
		),
	);
}
export function dockEdgeForPoint(
	cx: number,
	cy: number,
	e: HTMLElement,
): DockEdge {
	const r = e.getBoundingClientRect(),
		x = (cx - r.left) / Math.max(1, r.width),
		y = (cy - r.top) / Math.max(1, r.height),
		d = Math.min(x, 1 - x, y, 1 - y);
	return d > 0.28
		? "center"
		: d === x
			? "left"
			: d === 1 - x
				? "right"
				: d === y
					? "top"
					: "bottom";
}
export function outerDockEdgeForPointer(
	e: {
		readonly clientX: number;
		readonly clientY: number;
	},
	root: HTMLElement,
): DockOuterEdge | null {
	const r = root.getBoundingClientRect(),
		band = Math.min(72, Math.max(28, Math.min(r.width, r.height) * 0.1)),
		closest = (
			[
				["left", e.clientX - r.left],
				["right", r.right - e.clientX],
				["top", e.clientY - r.top],
				["bottom", r.bottom - e.clientY],
			] as const
		).reduce((a, b) => (b[1] < a[1] ? b : a));
	return closest[1] >= 0 && closest[1] <= band ? closest[0] : null;
}
