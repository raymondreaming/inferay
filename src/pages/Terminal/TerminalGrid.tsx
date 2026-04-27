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
	TerminalPaneModel,
	TerminalTheme,
} from "../../lib/terminal-utils.ts";
import { TerminalPaneView } from "./TerminalPaneView.tsx";

interface TerminalGridProps {
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
	onDragEnd: () => void
) => ({
	pane,
	isSelected: pane.id === p.selectedPaneId,
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
	const [containerHeight, setContainerHeight] = useState(0);
	const dragIndexRef = useRef<number | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const clearDragState = useCallback(() => {
		dragIndexRef.current = null;
		setDragIndex(null);
		setDragOverIndex(null);
	}, []);

	useLayoutEffect(() => {
		const el = containerRef.current?.parentElement;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) =>
			setContainerHeight(entry.contentRect.height)
		);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

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

	const cellStyle = (idx: number): React.CSSProperties =>
		({
			"--tw-ring-color":
				dragOverIndex === idx && dragIndex !== idx
					? (theme.cursor ?? "#d6ff00")
					: theme.separator,
			opacity: dragIndex === idx ? 0.4 : 1,
		}) as React.CSSProperties;

	if (layoutMode === "rows") {
		return (
			<div
				ref={containerRef}
				className="flex bg-inferay-black h-full overflow-x-auto overscroll-none"
			>
				{panes.map((pane, idx) => (
					<div
						key={pane.id}
						className="shrink-0 h-full overflow-hidden border-r border-inferay-gray-border transition-all"
						style={{ width: 400, ...cellStyle(idx) }}
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
								handleHeaderDragEnd
							)}
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
			className="grid bg-inferay-black"
			style={{
				gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
				gridTemplateRows: `repeat(${totalGridRows}, ${rowHeight}px)`,
			}}
		>
			{panes.map((pane, idx) => (
				<div
					key={pane.id}
					className="overflow-hidden border-r border-b border-inferay-gray-border transition-all"
					style={cellStyle(idx)}
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
							handleHeaderDragEnd
						)}
					/>
				</div>
			))}
		</div>
	);
});
