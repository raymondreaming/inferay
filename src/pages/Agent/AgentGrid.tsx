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
	createDockTree,
	type DockEdge,
	type DockOuterEdge,
	type DockTree,
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
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import { color, controlSize, motion } from "../../tokens.stylex.ts";
import { AgentPaneView } from "./AgentPaneView.tsx";

const EMPTY_CWD_LIST: string[] = [];
const EMPTY_AUXILIARY_PANELS: readonly AuxiliaryPanel[] = [];
const ROOT_DOCK_TARGET_ID = "__workspace-root__";

type AuxiliaryPanel = {
	readonly id: string;
	readonly onSelect?: () => void;
	readonly render: (drag: {
		readonly draggable: boolean;
		readonly onDragStart: (event: DragEvent) => void;
		readonly onCreatePanelDragStart: (
			event: DragEvent,
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
	onDragStart: (e: DragEvent, i: number) => void,
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

function dockEdgeForPointer(
	event: DragEvent & { currentTarget: HTMLDivElement },
): DockEdge {
	const rect = event.currentTarget.getBoundingClientRect();
	const x = (event.clientX - rect.left) / Math.max(1, rect.width);
	const y = (event.clientY - rect.top) / Math.max(1, rect.height);
	const distance = Math.min(x, 1 - x, y, 1 - y);
	if (distance > 0.28) return "center";
	if (distance === x) return "left";
	if (distance === 1 - x) return "right";
	if (distance === y) return "top";
	return "bottom";
}

function outerDockEdgeForPointer(
	event: Pick<DragEvent, "clientX" | "clientY">,
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

	const handleHeaderDragStart = useCallback(
		(e: DragEvent, index: number) => {
			pendingPanelDropRef.current = null;
			dragIndexRef.current = index;
			setDragIndex(index);
			const paneId = panes[index]?.id ?? null;
			setDragPanelId(paneId);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		},
		[panes],
	);
	const handleAuxiliaryDragStart = useCallback((event: DragEvent) => {
		const panelId = (
			event.currentTarget as HTMLElement | null
		)?.closest<HTMLElement>("[data-agent-grid-pane-id]")?.dataset
			.agentGridPaneId;
		if (!panelId) return;
		pendingPanelDropRef.current = null;
		setDragPanelId(panelId);
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", panelId);
			const image = new Image();
			image.src =
				"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
			event.dataTransfer.setDragImage(image, 0, 0);
		}
	}, []);
	const handleCreatePanelDragStart = useCallback(
		(event: DragEvent, panelId: string, completeDrop: () => void) => {
			pendingPanelDropRef.current = { id: panelId, complete: completeDrop };
			setDragPanelId(panelId);
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", panelId);
				const image = new Image();
				image.src =
					"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
				event.dataTransfer.setDragImage(image, 0, 0);
			}
		},
		[],
	);

	const handleHeaderDragEnd = useCallback(() => {
		clearDragState();
	}, [clearDragState]);

	const handleDragOver = useCallback((e: DragEvent, index: number) => {
		if (dragIndexRef.current === null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		setDragOverIndex((current) => (current === index ? current : index));
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent, toIndex: number) => {
			const fromIndex = dragIndexRef.current;
			if (fromIndex === null) return;
			e.preventDefault();
			if (fromIndex !== toIndex && onReorderPanes)
				onReorderPanes(fromIndex, toIndex);
			clearDragState();
		},
		[clearDragState, onReorderPanes],
	);
	const handleDockDrop = useCallback(
		(event: DragEvent, targetId: string) => {
			if (!dragPanelId || !renderedDockTree) return;
			event.preventDefault();
			event.stopPropagation();
			const pendingPanel = pendingPanelDropRef.current;
			let nextTree: DockTree;
			if (
				dockTarget?.id === ROOT_DOCK_TARGET_ID &&
				dockTarget.edge !== "center"
			) {
				nextTree = pendingPanel
					? insertDockPanelAtOuterEdge(
							renderedDockTree,
							pendingPanel.id,
							dockTarget.edge,
						)
					: moveDockPanelToOuterEdge(
							renderedDockTree,
							dragPanelId,
							dockTarget.edge,
						);
			} else {
				const edge = dockTarget?.id === targetId ? dockTarget.edge : "center";
				nextTree = pendingPanel
					? insertDockPanel(renderedDockTree, pendingPanel.id, targetId, edge)
					: moveDockPanel(renderedDockTree, dragPanelId, targetId, edge);
			}
			writeStoredValue(dockStorageKey, JSON.stringify(nextTree));
			setDockTree(nextTree);
			pendingPanel?.complete();
			if (!pendingPanel && panes.some((pane) => pane.id === dragPanelId)) {
				props.onSelectPane(dragPanelId);
			}
			clearDragState();
		},
		[
			clearDragState,
			dockStorageKey,
			dockTarget,
			dragPanelId,
			panes,
			props.onSelectPane,
			renderedDockTree,
		],
	);
	const handleDividerPointerDown = useCallback(
		(
			event: PointerEvent & { currentTarget: HTMLButtonElement },
			path: readonly ("first" | "second")[],
			direction: "horizontal" | "vertical",
		) => {
			const splitElement = event.currentTarget.parentElement;
			if (!splitElement) return;
			event.preventDefault();
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
						onDragOver={(e) => handleDragOver(e, idx)}
						onDrop={(e) => handleDrop(e, idx)}
						onDragLeave={() => setDragOverIndex(null)}
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
					auxiliaryPanel?.onSelect?.();
				}}
				onClickCapture={(event) => {
					if (!isWorkspaceDockDragSource(event.target)) return;
					if (pane) props.onSelectPane(pane.id);
					else auxiliaryPanel?.onSelect?.();
				}}
				onDragOver={(event) => {
					if (!dragPanelId) return;
					const root = containerRef.current;
					const outerEdge = root ? outerDockEdgeForPointer(event, root) : null;
					if (outerEdge && panelIds.length > 1) {
						event.preventDefault();
						event.stopPropagation();
						setDockTarget((current) =>
							current?.id === ROOT_DOCK_TARGET_ID && current.edge === outerEdge
								? current
								: { id: ROOT_DOCK_TARGET_ID, edge: outerEdge },
						);
						return;
					}
					if (dragPanelId === node.id) return;
					event.preventDefault();
					event.stopPropagation();
					const edge = dockEdgeForPointer(event);
					setDockTarget((current) =>
						current?.id === node.id && current.edge === edge
							? current
							: { id: node.id, edge },
					);
				}}
				onDrop={(event) => handleDockDrop(event, node.id)}
				onDragLeave={(event) => {
					if (
						!event.currentTarget.contains(event.relatedTarget as Node | null)
					) {
						setDockTarget((current) =>
							current?.id === node.id ? null : current,
						);
					}
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
			onDragOver={(event) => {
				if (!dragPanelId || panelIds.length < 2) return;
				const outerEdge = outerDockEdgeForPointer(event, event.currentTarget);
				if (!outerEdge) return;
				event.preventDefault();
				setDockTarget((current) =>
					current?.id === ROOT_DOCK_TARGET_ID && current.edge === outerEdge
						? current
						: { id: ROOT_DOCK_TARGET_ID, edge: outerEdge },
				);
			}}
			onDrop={(event) => {
				if (dockTarget?.id !== ROOT_DOCK_TARGET_ID) return;
				handleDockDrop(event, ROOT_DOCK_TARGET_ID);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
					return;
				}
				setDockTarget(null);
			}}
		>
			{renderedDockTree ? renderDockNode(renderedDockTree) : null}
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
		backgroundColor: "transparent",
		display: "flex",
		height: "100%",
		overflowX: "auto",
		overscrollBehavior: "none",
	},
	rowCell: {
		backgroundColor: "transparent",
		borderRightStyle: "solid",
		borderRightWidth: 1,
		flexShrink: 0,
		height: "100%",
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, opacity",
	},
	gridScroller: {
		backgroundColor: "transparent",
		display: "grid",
		height: "100%",
		overflowX: "hidden",
		overflowY: "auto",
		overscrollBehavior: "contain",
	},
	gridCell: {
		backgroundColor: "transparent",
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, opacity",
	},
	dockRoot: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
	},
	dockSplit: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
	},
	dockHorizontal: { flexDirection: "row" },
	dockVertical: { flexDirection: "column" },
	dockBranch: {
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
	},
	dockDivider: {
		position: "relative",
		zIndex: 20,
		flexShrink: 0,
		borderWidth: 0,
		padding: 0,
		backgroundColor: {
			default: "transparent",
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
	},
	dockDividerHorizontal: {
		width: 5,
		height: "100%",
		marginInline: -2,
		cursor: "col-resize",
		"::before": {
			content: "",
			position: "absolute",
			insetBlock: 0,
			left: 2,
			width: 1,
			backgroundColor: "var(--color-inferay-gray-border)",
		},
	},
	dockDividerVertical: {
		width: "100%",
		height: 5,
		marginBlock: -2,
		cursor: "row-resize",
		"::before": {
			content: "",
			position: "absolute",
			insetInline: 0,
			top: 2,
			height: 1,
			backgroundColor: "var(--color-inferay-gray-border)",
		},
	},
	dockCell: {
		position: "relative",
		display: "flex",
		minWidth: 0,
		minHeight: 0,
		flex: 1,
		overflow: "hidden",
	},
	dropIndicator: {
		position: "absolute",
		zIndex: 100,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--color-inferay-gray-border-bold)",
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-white) 10%, transparent)",
		pointerEvents: "none",
	},
	rootDropIndicator: {
		zIndex: 110,
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
