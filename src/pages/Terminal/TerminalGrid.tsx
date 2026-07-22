import * as stylex from "@stylexjs/stylex";
import type React from "react";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import { isChatAgentKind } from "../../features/agents/agents.ts";
import { useGitStatus } from "../../features/git/useGitStatus.ts";
import type {
	AgentKind,
	TerminalPaneModel,
	TerminalTheme,
} from "../../features/terminal/terminal-utils.ts";
import { color, motion } from "../../tokens.stylex.ts";
import { TerminalPaneView } from "./TerminalPaneView.tsx";

const EMPTY_CWD_LIST: string[] = [];

interface TerminalGridProps {
	active?: boolean;
	panes: TerminalPaneModel[];
	selectedPaneId: string | null;
	columns: number;
	rows: number;
	layoutMode: "grid" | "rows";
	theme: TerminalTheme;
	fontSize: number;
	fontFamily: string;
	onSelectPane: (paneId: string) => void;
	onClosePane: (paneId: string, force?: boolean) => void;
	onDirectorySelect: (
		paneId: string,
		path: string | null,
		referencePaths?: string[]
	) => void;
	onDirectoryCancel: (paneId: string) => void;
	onChatRef: (paneId: string, handle: AgentChatHandle | null) => void;
	onAgentStatusChange?: (paneId: string, status: string) => void;
	onReorderPanes?: (fromIndex: number, toIndex: number) => void;
	onAddPane?: (agentKind: AgentKind) => void;
	onSetPaneAgentKind?: (paneId: string, agentKind: AgentKind) => void;
}

const paneViewProps = (
	p: TerminalGridProps,
	pane: TerminalPaneModel,
	idx: number,
	onDragStart: (e: React.DragEvent, i: number) => void,
	onDragEnd: () => void,
	gitBranch: string | null
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

function isVerticalScroller(element: HTMLElement) {
	const style = window.getComputedStyle(element);
	return (
		(style.overflowY === "auto" || style.overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight
	);
}

function findVerticalScroller(
	target: EventTarget | null,
	boundary: HTMLElement
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
		Math.min(maxScrollTop, element.scrollTop + deltaY)
	);
}

function canScrollHorizontally(element: HTMLElement, deltaX: number) {
	if (deltaX < 0) return element.scrollLeft > 0;
	if (deltaX > 0) {
		return element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
	}
	return false;
}

export const TerminalGrid = memo(function TerminalGrid(
	props: TerminalGridProps
) {
	const {
		active = true,
		panes,
		columns,
		rows,
		layoutMode,
		theme,
		onReorderPanes,
	} = props;
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(0);
	const dragIndexRef = useRef<number | null>(null);
	const clearDragStateRef = useRef<() => void>(() => {});
	const interactionPaneIdRef = useRef<string | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [interactionPaneId, setInteractionPaneId] = useState<string | null>(
		null
	);
	const chatStatusCwds = useMemo(() => {
		if (!active) return EMPTY_CWD_LIST;
		const seen = new Set<string>();
		const cwds: string[] = [];
		for (const pane of panes) {
			if (
				!pane.cwd ||
				(!pane.pendingCwd && !isChatAgentKind(pane.agentKind)) ||
				seen.has(pane.cwd)
			)
				continue;
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
		setDragIndex(null);
		setDragOverIndex(null);
	}, []);
	useEffect(() => {
		clearDragStateRef.current = clearDragState;
	}, [clearDragState]);

	useLayoutEffect(() => {
		if (!active) return;
		const el = containerRef.current?.parentElement;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const nextHeight = entry.contentRect.height;
			setContainerHeight((current) =>
				current === nextHeight ? current : nextHeight
			);
		});
		ro.observe(el);
		return ro.disconnect.bind(ro);
	}, [active]);

	const handleHeaderDragStart = useCallback(
		(e: React.DragEvent, index: number) => {
			dragIndexRef.current = index;
			setDragIndex(index);
			e.dataTransfer.effectAllowed = "move";
		},
		[]
	);

	const handleHeaderDragEnd = useCallback(() => {
		clearDragState();
	}, [clearDragState]);

	const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		setDragOverIndex((current) => (current === index ? current : index));
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent, toIndex: number) => {
			e.preventDefault();
			const fromIndex = dragIndexRef.current;
			if (fromIndex !== null && fromIndex !== toIndex && onReorderPanes)
				onReorderPanes(fromIndex, toIndex);
			clearDragState();
		},
		[clearDragState, onReorderPanes]
	);

	const handleGridWheelCapture = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			if (layoutMode !== "grid" || event.deltaY === 0) return;
			const grid = containerRef.current;
			if (!grid) return;
			const target =
				event.target instanceof Element
					? event.target.closest<HTMLElement>("[data-terminal-grid-pane-id]")
					: null;
			if (!target) return;
			const targetPaneId = target.dataset.terminalGridPaneId ?? null;
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
		[layoutMode]
	);

	const handleRowWheelCapture = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			if (layoutMode !== "rows") return;
			const rowScroller = containerRef.current;
			if (!rowScroller) return;
			const target =
				event.target instanceof Element
					? event.target.closest<HTMLElement>("[data-terminal-row-pane-id]")
					: null;
			const targetPaneId = target?.dataset.terminalRowPaneId ?? null;
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
		[layoutMode, props.selectedPaneId]
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

	if (layoutMode === "rows") {
		return (
			<div
				ref={containerRef}
				{...stylex.props(styles.rowScroller)}
				onWheelCapture={handleRowWheelCapture}
				data-terminal-row-scroll-area
			>
				{panes.map((pane, idx) => (
					<div
						key={pane.id}
						data-terminal-row-pane-id={pane.id}
						{...stylex.props(styles.rowCell)}
						style={{ ...cellStyle(idx), width: 400 }}
						onPointerDownCapture={() => props.onSelectPane(pane.id)}
						onDragOver={(e) => handleDragOver(e, idx)}
						onDrop={(e) => handleDrop(e, idx)}
						onDragLeave={() => setDragOverIndex(null)}
					>
						<TerminalPaneView
							{...paneViewProps(
								props,
								pane,
								idx,
								handleHeaderDragStart,
								handleHeaderDragEnd,
								pane.cwd ? (chatProjectMap.get(pane.cwd)?.branch ?? null) : null
							)}
							interactionEnabled={pane.id === props.selectedPaneId}
						/>
					</div>
				))}
			</div>
		);
	}

	const totalGridRows = Math.ceil(panes.length / columns);
	const availableHeight = containerHeight;
	const rowHeight =
		availableHeight > 0 ? Math.floor(availableHeight / rows) : 400;

	return (
		<div
			ref={containerRef}
			{...stylex.props(styles.gridScroller)}
			data-terminal-grid-scroll-area
			onWheelCapture={handleGridWheelCapture}
			style={{
				gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
				gridTemplateRows: `repeat(${totalGridRows}, ${rowHeight}px)`,
			}}
		>
			{panes.map((pane, idx) => (
				<div
					key={pane.id}
					{...stylex.props(styles.gridCell)}
					data-terminal-grid-pane-id={pane.id}
					style={cellStyle(idx)}
					onPointerDownCapture={() => {
						interactionPaneIdRef.current = pane.id;
						setInteractionPaneId(pane.id);
						props.onSelectPane(pane.id);
					}}
					onDragOver={(e) => handleDragOver(e, idx)}
					onDrop={(e) => handleDrop(e, idx)}
					onDragLeave={() => setDragOverIndex(null)}
				>
					<TerminalPaneView
						{...paneViewProps(
							props,
							pane,
							idx,
							handleHeaderDragStart,
							handleHeaderDragEnd,
							pane.cwd ? (chatProjectMap.get(pane.cwd)?.branch ?? null) : null
						)}
						interactionEnabled={
							layoutMode !== "grid" || pane.id === interactionPaneId
						}
					/>
				</div>
			))}
		</div>
	);
});

const styles = stylex.create({
	rowScroller: {
		backgroundColor: color.background,
		display: "flex",
		height: "100%",
		overflowX: "auto",
		overscrollBehavior: "none",
	},
	rowCell: {
		borderRightStyle: "solid",
		borderRightWidth: 1,
		flexShrink: 0,
		height: "100%",
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, opacity",
	},
	gridScroller: {
		backgroundColor: color.background,
		display: "grid",
		height: "100%",
		overflowX: "hidden",
		overflowY: "auto",
		overscrollBehavior: "contain",
	},
	gridCell: {
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, opacity",
	},
});
