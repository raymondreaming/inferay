import type {
	AgentTheme,
	DockPointerTarget,
	DockTree,
	DockWheel,
	Pane,
	WorkspaceAgentKind,
} from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import type { AgentLayoutMode } from "@shared/contracts/workspace.ts";
import {
	captureEvent,
	createPointerResize,
	domStyle,
	lockPointerSelection,
} from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { PaneView } from "../PaneView/index.tsx";
import { DockSplit } from "./DockSplit.tsx";

type DockSplitNode = Extract<DockTree, { readonly type: "split" }>;

import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import { useContainedChatSelection } from "./useContainedChatSelection.ts";
import { useDockLayout } from "./useDockLayout.ts";
import { useResponsiveGridColumns } from "./useResponsiveGridColumns.ts";

export const MIN_RESPONSIVE_PANE_WIDTH = 300;
const ROOT_DOCK_TARGET_ID = "__workspace-root__";
type DockEdge = DockPointerTarget["edge"];
const isWorkspaceDockDragSource = (target: EventTarget | null) =>
	target instanceof Element &&
	!!target.closest('[data-workspace-dock-drag-source="true"]');
const shouldFocusPaneComposer = (target: EventTarget | null) =>
	!(target instanceof Element) ||
	(!target.closest("button,input,textarea,select,a,[contenteditable='true']") &&
		window.getSelection()?.isCollapsed !== false);

export type { DockSplitNode, DockTree };

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

export type AuxiliaryPanel = {
	readonly id: string;
	readonly onSelect?: () => void;
	readonly render: (drag: DragProps) => import("solid-js").Element;
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
	legacyWorkspaceId?: string;
	auxiliaryPanels?: readonly AuxiliaryPanel[];
}

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
	useContainedChatSelection(
		() => props.active !== false,
		() => containerRef.current,
	);
	const [dragOverIndex, setDragOverIndex] = createSignal<number | null>(null);
	const [dragPanelId, setDragPanelId] = createSignal<string | null>(null);
	const [availableGridColumns, setAvailableGridColumns] = createSignal(
		() => props.columns,
	);
	const [dockTarget, setDockTarget] = createSignal<{
		readonly id: string;
		readonly edge: DockEdge;
	} | null>(null);
	const auxiliaryPanels = () => props.auxiliaryPanels ?? EMPTY_AUXILIARY_PANELS;
	const auxiliaryPanelIdKey = createMemo(() => {
		return auxiliaryPanels()
			.map((panel) => panel.id)
			.join("\u0000");
	});
	const panelIds = createMemo(() => [
		...props.panes.map((pane) => pane.id),
		...auxiliaryPanelIdKey().split("\u0000").filter(Boolean),
	]);
	const panelKey = createMemo(() => JSON.stringify(panelIds()));
	const dockInput = createMemo(() => ({
		workspaceId: props.workspaceId ?? "default",
		legacyWorkspaceId: props.legacyWorkspaceId,
		ids: JSON.parse(panelKey()) as string[],
		columns: props.columns,
		mode: props.layoutMode,
		visibleColumns: availableGridColumns(),
		rows: props.rows,
	}));
	const dock = useDockLayout(dockInput, () => props.active !== false);
	const renderedDockTree = dock.tree;
	const renderedDockTreeRef = dock.treeRef;
	const setLayout = dock.setLayout;
	const updateDock = dock.update;
	const dockError = dock.error;
	const layout = dock.layout;
	const clearDragState = () => {
		setDragIndex(null);
		setDragOverIndex(null);
		setDragPanelId(null);
		setDockTarget(null);
	};
	useResponsiveGridColumns(
		() => containerRef.current,
		() => props.columns,
		() => props.layoutMode === "grid",
		setAvailableGridColumns,
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
	let cancelDockDrag: (() => void) | undefined;
	onCleanup(() => cancelDockDrag?.());
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
		cancelDockDrag?.();
		event.preventDefault();
		event.stopPropagation();
		const releaseSelection = lockPointerSelection();
		const source = event.currentTarget as HTMLElement | null;
		const pointerId = event.pointerId;
		const startX = event.clientX;
		const startY = event.clientY;
		let activated = false;
		let finished = false;
		let target: DockPointerTarget | null = null;
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
				setDragIndex(sourceIndex);
				setDragPanelId(sourceId);
			}
			moveEvent.preventDefault();
			const root = containerRef.current;
			if (!root) return;
			const hit = document.elementFromPoint(
				moveEvent.clientX,
				moveEvent.clientY,
			);
			const row = hit?.closest<HTMLElement>("[data-agent-row-pane-id]");
			const cell = hit?.closest<HTMLElement>("[data-agent-grid-pane-id]");
			target = project<DockPointerTarget | null>("dockPointerTarget", {
				x: moveEvent.clientX,
				y: moveEvent.clientY,
				root: root.getBoundingClientRect(),
				mode: props.layoutMode,
				panelCount: panelIds().length,
				source: sourceId,
				insert: !!pendingPanel,
				rowId: row?.dataset.agentRowPaneId,
				rowIndex: props.panes.findIndex(
					(pane) => pane.id === row?.dataset.agentRowPaneId,
				),
				cellId: cell?.dataset.agentGridPaneId,
				cell: cell?.getBoundingClientRect(),
			});
			setDragOverIndex(target?.rowIndex ?? null);
			setDockTarget(target?.rowIndex === undefined ? target : null);
		};
		const finish = (finishEvent: PointerEvent | null, commit: boolean) => {
			if (finishEvent && finishEvent.pointerId !== pointerId) return;
			if (finished) return;
			finished = true;
			cancelDockDrag = undefined;
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
					props.layoutMode === "rows" &&
					sourceIndex !== null &&
					target.rowIndex !== undefined
				) {
					if (sourceIndex !== target.rowIndex) {
						props.onReorderPanes?.(sourceIndex, target.rowIndex);
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
		cancelDockDrag = cancelAbandonedDrag;
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
					tree: rendered
						? project<DockTree>("resizeDockSplit", {
								tree: rendered,
								path,
								ratio,
							})
						: rendered,
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
	const handleWheelCapture = (event: WheelEvent) => {
		const grid = props.layoutMode === "grid",
			canvas = containerRef.current;
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						grid ? "[data-agent-grid-pane-id]" : "[data-agent-row-pane-id]",
					)
				: null;
		if (!canvas || !target) return;
		const selected =
			(grid
				? target.dataset.agentGridPaneId
				: target.dataset.agentRowPaneId) === props.selectedPaneId;
		let inner: HTMLElement | null = null;
		if (grid && selected) {
			const isScroller = (element: HTMLElement) =>
				["auto", "scroll"].includes(getComputedStyle(element).overflowY) &&
				element.scrollHeight > element.clientHeight;
			let element = event.target instanceof HTMLElement ? event.target : null;
			while (element && element !== target) {
				if (isScroller(element)) {
					inner = element;
					break;
				}
				element = element.parentElement;
			}
			inner ??=
				[...target.querySelectorAll<HTMLElement>("*")].find(isScroller) ?? null;
		}
		const wheel = project<DockWheel>("dockWheel", {
			mode: props.layoutMode,
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			shift: event.shiftKey,
			selected,
			inner: inner && {
				offset: inner.scrollTop,
				size: inner.clientHeight,
				extent: inner.scrollHeight,
			},
		});
		if (!wheel.capture) return;
		event.preventDefault();
		event.stopPropagation();
		if (wheel.horizontal) canvas.scrollLeft += wheel.delta;
		else canvas.scrollTop += wheel.delta;
	};
	createEffect(
		() => props.active !== false,
		(active) => {
			if (!active) {
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
		const activeDragIndex = dragIndex();
		return inlineStyles.getCanvasCellStyle(
			dragOverIndex() === idx && activeDragIndex !== idx
				? (props.theme.cursor ?? "#d6ff00")
				: props.theme.separator,
			activeDragIndex === idx ? 0.4 : 1,
		);
	};
	const paneViewProps = (pane: Pane, paneIndex: number) => ({
		pane,
		isSelected: props.active !== false && pane.id === props.selectedPaneId,
		isVisible: props.active !== false,
		onClose: props.onClosePane,
		onDirectorySelect: props.onDirectorySelect,
		onDirectoryCancel: props.onDirectoryCancel,
		chatRef: props.onChatRef,
		paneIndex,
		onHeaderDragStart: handleHeaderDragStart,
		onHeaderDragEnd: clearDragState,
		onSetPaneAgentKind: props.onSetPaneAgentKind,
	});
	return (
		<>
			{(() => {
				if (props.layoutMode === "rows" && auxiliaryPanels().length === 0) {
					return (
						<div
							ref={[
								(element) => (containerRef.current = element),
								captureEvent("wheel", (event) => handleWheelCapture(event)),
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
												captureEvent("pointerdown", (event) => {
													if (isWorkspaceDockDragSource(event.target)) return;
													if (pane().id !== props.selectedPaneId) {
														window.getSelection()?.removeAllRanges();
													}
													props.onSelectPane(pane().id);
												}),
												captureEvent("click", (event) => {
													if (shouldFocusPaneComposer(event.target)) {
														props.onFocusPane?.(pane().id);
													}
												}),
											]}
										>
											<PaneView {...paneViewProps(pane(), idx())} />
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
					const branch = createMemo<DockSplitNode | undefined>(
						(previous) => split() ?? previous,
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
							{(_branch) => (
								<DockSplit
									direction={branch()?.direction ?? "horizontal"}
									ratio={branch()?.ratio ?? 0.5}
									resizable={
										branch()?.first.type !== "empty" &&
										branch()?.second.type !== "empty"
									}
									first={
										<DockNode
											node={branch()?.first ?? nodeProps.node}
											path={[...nodeProps.path, "first"]}
										/>
									}
									second={
										<DockNode
											node={branch()?.second ?? nodeProps.node}
											path={[...nodeProps.path, "second"]}
										/>
									}
									onResize={(event) =>
										handleDividerPointerDown(
											event,
											nodeProps.path,
											branch()?.direction ?? "horizontal",
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
						const index = paneIndex();
						return index >= 0 ? props.panes[index] : null;
					});
					const auxiliaryPanel = createMemo(() => {
						return auxiliaryPanels().find(
							(panel) => panel.id === panelProps.id,
						);
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
								captureEvent("pointerdown", (event) => {
									const currentPane = pane();
									if (isWorkspaceDockDragSource(event.target)) return;
									if (currentPane) {
										if (currentPane.id !== props.selectedPaneId) {
											window.getSelection()?.removeAllRanges();
										}
										props.onSelectPane(currentPane.id);
										return;
									}
									auxiliaryPanel()?.onSelect?.();
								}),
								captureEvent("click", (event) => {
									const currentPane = pane();
									if (isWorkspaceDockDragSource(event.target)) {
										if (currentPane) props.onSelectPane(currentPane.id);
										else auxiliaryPanel()?.onSelect?.();
									}
									if (currentPane && shouldFocusPaneComposer(event.target)) {
										props.onFocusPane?.(currentPane.id);
									}
								}),
							]}
						>
							{hasPane() ? (
								<For each={pane() ? [pane()!] : []} keyed={(item) => item.id}>
									{(item) => (
										<PaneView {...paneViewProps(item(), paneIndex())} />
									)}
								</For>
							) : (
								<For
									each={auxiliaryPanel() ? [auxiliaryPanel()!] : []}
									keyed={(panel) => panel.id}
								>
									{(panel) => (
										<>
											{" "}
											{panel().render({
												draggable: true,
												onDragStart: handleAuxiliaryDragStart,
												onCreatePanelDragStart: handleCreatePanelDragStart,
												onDragEnd: clearDragState,
											})}{" "}
										</>
									)}
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
							captureEvent("wheel", (event) => handleWheelCapture(event)),
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
								layout().canvas.sparse && styles.dockCanvasSparse,
							)}
							style={domStyle(
								inlineStyles.getWorkspaceCanvasDockCanvasStyle(
									layout().canvas.minHeight,
									layout().canvas.width,
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
export const DEFAULT_ROWS = 1 as const;
export const EMPTY_AUXILIARY_PANELS: readonly AuxiliaryPanel[] = [];
