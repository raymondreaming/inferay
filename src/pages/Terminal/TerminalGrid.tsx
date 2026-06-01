import type React from "react";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import type {
	AgentKind,
	TerminalLayoutMode,
	TerminalPaneModel,
	TerminalTheme,
} from "../../features/terminal/terminal-utils.ts";
import { TerminalPaneView } from "./TerminalPaneView.tsx";

interface TerminalGridProps {
	panes: TerminalPaneModel[];
	selectedPaneId: string | null;
	columns: number;
	rows: number;
	layoutMode: TerminalLayoutMode;
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
	highlightedPaneId: string | null,
	onDragStart: (e: React.DragEvent, i: number) => void,
	onDragEnd: () => void
) => ({
	pane,
	isSelected: pane.id === p.selectedPaneId,
	isHighlighted: pane.id === highlightedPaneId,
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

export const TerminalGrid = memo(function TerminalGrid(
	props: TerminalGridProps
) {
	const { panes, columns, rows, layoutMode, theme, onReorderPanes } = props;
	const containerRef = useRef<HTMLDivElement>(null);
	const [selectedCellNode, setSelectedCellNode] =
		useState<HTMLDivElement | null>(null);
	const [containerHeight, setContainerHeight] = useState(0);
	const dragIndexRef = useRef<number | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [highlightedPaneId, setHighlightedPaneId] = useState<string | null>(
		null
	);
	const clearDragState = useCallback(() => {
		dragIndexRef.current = null;
		setDragIndex(null);
		setDragOverIndex(null);
	}, []);
	const normalizedColumns = Math.max(1, columns);
	const normalizedRows = Math.max(1, rows);
	const totalGridRows = Math.max(
		normalizedRows,
		Math.ceil(panes.length / normalizedColumns)
	);
	const gridRowHeight =
		containerHeight > 0
			? Math.floor(containerHeight / normalizedRows)
			: `calc(100% / ${normalizedRows})`;

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const updateHeight = () => setContainerHeight(el.clientHeight);
		updateHeight();
		const ro = new ResizeObserver(updateHeight);
		ro.observe(el);
		return ro.disconnect.bind(ro);
	}, []);

	useLayoutEffect(() => {
		selectedCellNode?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [selectedCellNode]);

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
		setDragOverIndex(index);
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

	useEffect(() => {
		window.addEventListener("dragend", clearDragState);
		window.addEventListener("drop", clearDragState);
		return () => {
			window.removeEventListener("dragend", clearDragState);
			window.removeEventListener("drop", clearDragState);
		};
	}, [clearDragState]);

	useEffect(() => {
		const handleHighlight = (event: Event) => {
			const paneId =
				event instanceof CustomEvent && typeof event.detail?.paneId === "string"
					? event.detail.paneId
					: null;
			setHighlightedPaneId(paneId);
		};
		window.addEventListener("inferay:pane-focus-highlight", handleHighlight);
		return () =>
			window.removeEventListener(
				"inferay:pane-focus-highlight",
				handleHighlight
			);
	}, []);

	const cellStyle = (
		pane: TerminalPaneModel,
		idx: number
	): React.CSSProperties => {
		return {
			"--tw-ring-color":
				dragOverIndex === idx && dragIndex !== idx
					? (theme.cursor ?? "#d6ff00")
					: theme.separator,
			borderColor: "rgba(255,255,255,0.08)",
			opacity: dragIndex === idx ? 0.4 : 1,
		} as React.CSSProperties;
	};
	if (layoutMode === "rows") {
		return (
			<div
				ref={containerRef}
				className="electrobun-webkit-app-region-drag flex h-full min-h-0 w-full overflow-x-auto overflow-y-hidden overscroll-none bg-inferay-black"
			>
				{panes.map((pane, idx) => (
					<div
						key={pane.id}
						ref={
							pane.id === props.selectedPaneId ? setSelectedCellNode : undefined
						}
						className="electrobun-webkit-app-region-no-drag h-full min-h-0 min-w-0 shrink-0 overflow-hidden border-r border-inferay-gray-border transition-all"
						style={{ ...cellStyle(pane, idx), width: 400 }}
						onDragOver={(e) => handleDragOver(e, idx)}
						onDrop={(e) => handleDrop(e, idx)}
						onDragLeave={() => setDragOverIndex(null)}
					>
						<TerminalPaneView
							{...paneViewProps(
								props,
								pane,
								idx,
								highlightedPaneId,
								handleHeaderDragStart,
								handleHeaderDragEnd
							)}
						/>
					</div>
				))}
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="electrobun-webkit-app-region-drag grid h-full min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-none bg-inferay-black"
			style={{
				gridTemplateColumns: `repeat(${normalizedColumns}, minmax(0, 1fr))`,
				gridTemplateRows: `repeat(${totalGridRows}, ${typeof gridRowHeight === "number" ? `${gridRowHeight}px` : gridRowHeight})`,
			}}
		>
			{panes.map((pane, index) => (
				<div
					key={pane.id}
					ref={
						pane.id === props.selectedPaneId ? setSelectedCellNode : undefined
					}
					className="electrobun-webkit-app-region-no-drag min-h-0 min-w-0 overflow-hidden border-r border-b border-inferay-gray-border transition-all"
					style={cellStyle(pane, index)}
					onDragOver={(e) => handleDragOver(e, index)}
					onDrop={(e) => handleDrop(e, index)}
					onDragLeave={() => setDragOverIndex(null)}
				>
					<TerminalPaneView
						{...paneViewProps(
							props,
							pane,
							index,
							highlightedPaneId,
							handleHeaderDragStart,
							handleHeaderDragEnd
						)}
					/>
				</div>
			))}
		</div>
	);
});
