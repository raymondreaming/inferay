import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useEffect, useRef } from "octane";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import { AgentChatView } from "../../components/chat/AgentChatView.tsx";
import { ChatPaneBoundary } from "../../components/chat/ChatPaneBoundary.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { IconAgent, IconX } from "../../components/ui/Icons.tsx";
import type {
	AgentKind,
	AgentPaneModel,
	AgentTheme,
} from "../../features/agent/agent-utils.ts";
import {
	getAgentDefinition,
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../features/agents/agents.ts";
import { useXtermAgent } from "../../hooks/useXtermAgent.tsx";
import { APP_REGION_NO_DRAG_CLASS } from "../../lib/app-theme.ts";
import { focusRef } from "../../lib/react-events.ts";
import { color, font } from "../../tokens.stylex.ts";

interface AgentPaneViewProps {
	pane: AgentPaneModel;
	isSelected: boolean;
	isVisible?: boolean;
	theme: AgentTheme;
	fontSize: number;
	fontFamily: string;
	gitBranch?: string | null;
	onSelect: (paneId: string) => void;
	onClose: (paneId: string, force?: boolean) => void;
	onDirectorySelect?: (
		paneId: string,
		path: string | null,
		referencePaths?: string[]
	) => void;
	onDirectoryCancel?: (paneId: string) => void;
	chatRef: (paneId: string, handle: AgentChatHandle | null) => void;
	onAgentStatusChange?: (paneId: string, status: string) => void;
	paneIndex?: number;
	interactionEnabled?: boolean;
	onHeaderDragStart?: (e: DragEvent, index: number) => void;
	onHeaderDragEnd?: () => void;
	onAddPane?: (agentKind: AgentKind) => void;
	onSetPaneAgentKind?: (paneId: string, agentKind: AgentKind) => void;
}

export const AgentPaneView = memo(function AgentPaneView({
	pane,
	isSelected,
	isVisible = true,
	theme,
	fontSize,
	fontFamily,
	gitBranch,
	onSelect,
	onClose,
	onDirectorySelect,
	onDirectoryCancel,
	chatRef,
	onAgentStatusChange,
	paneIndex,
	interactionEnabled = true,
	onHeaderDragStart,
	onHeaderDragEnd,
	onAddPane,
	onSetPaneAgentKind,
}: AgentPaneViewProps) {
	const chatHandleRef = useRef<AgentChatHandle | null>(null);
	const viewAgentKind: AgentKind =
		pane.pendingCwd && !isChatAgentKind(pane.agentKind)
			? "claude"
			: pane.agentKind;
	const isAgentChatPane = isChatAgentKind(viewAgentKind);
	const paneLabel = getAgentDefinition(viewAgentKind).label;
	const { containerRef, termRef, refit } = useXtermAgent({
		enabled: isVisible && !isAgentChatPane && !pane.pendingCwd,
		paneId: pane.id,
		agentKind: pane.agentKind,
		isClaude: pane.isClaude,
		cwd: pane.cwd,
		theme,
		fontSize,
		fontFamily,
	});

	useEffect(() => {
		if (isVisible && isSelected && !isAgentChatPane) refit();
	}, [isAgentChatPane, isSelected, isVisible, refit]);

	const handlePaneDragStart = useCallback(
		(e: DragEvent) => {
			if (paneIndex == null || !onHeaderDragStart) return;
			const transfer = e.dataTransfer;
			if (!transfer) return;
			transfer.setData("text/plain", pane.id);
			const img = new Image();
			img.src =
				"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
			transfer.setDragImage(img, 0, 0);
			onHeaderDragStart(e, paneIndex);
		},
		[onHeaderDragStart, pane.id, paneIndex]
	);
	const handleSelect = useCallback(() => {
		onSelect(pane.id);
	}, [onSelect, pane.id]);
	const handleCloseClick = useCallback(
		(event: Event) => {
			event.stopPropagation();
			onClose(pane.id);
		},
		[onClose, pane.id]
	);
	const focusAgent = useCallback(() => {
		focusRef(termRef);
	}, [termRef]);
	const handleDirectoryChange = useCallback(
		(pid: string, cwd: string | null, refs?: string[]) => {
			if (pane.pendingCwd && !isChatAgentKind(pane.agentKind)) {
				onSetPaneAgentKind?.(pid, loadDefaultChatSettings().agentKind);
			}
			onDirectorySelect?.(pid, cwd, refs);
		},
		[onDirectorySelect, onSetPaneAgentKind, pane.agentKind, pane.pendingCwd]
	);
	const handleChatRef = useCallback(
		(handle: AgentChatHandle | null) => {
			chatHandleRef.current = handle;
			chatRef(pane.id, handle);
		},
		[chatRef, pane.id]
	);

	return (
		<div
			{...stylex.props(styles.root)}
			style={isAgentChatPane ? undefined : { backgroundColor: theme.bg }}
		>
			{!isAgentChatPane && (
				<div
					className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.header).className ?? ""}`}
					style={{
						borderColor: theme.separator,
						backgroundColor: theme.bg,
					}}
					draggable={paneIndex != null && !!onHeaderDragStart}
					onDragStart={handlePaneDragStart}
					onDragEnd={onHeaderDragEnd}
				>
					<button
						type="button"
						onClick={handleSelect}
						{...stylex.props(styles.headerSelectButton)}
					>
						<span
							{...stylex.props(
								styles.agentIcon,
								isSelected && styles.activeAccent
							)}
						>
							<IconAgent size={10} />
						</span>
						<span
							{...stylex.props(
								styles.paneLabel,
								isSelected && styles.selectedLabel
							)}
						>
							{paneLabel}
						</span>
						{pane.cwd && (
							<>
								<span {...stylex.props(styles.breadcrumbSep)}>›</span>
								<span
									{...stylex.props(
										styles.cwdLabel,
										isSelected && styles.selectedCwd
									)}
									title={pane.cwd}
								>
									{pane.cwd.split("/").pop() || pane.cwd}
								</span>
							</>
						)}
					</button>
					<span {...stylex.props(styles.spacer)} />
					{isSelected && <div {...stylex.props(styles.selectedDot)} />}
					<IconButton
						type="button"
						onClick={handleCloseClick}
						className={APP_REGION_NO_DRAG_CLASS}
						variant="danger"
						size="xs"
						title="Close pane"
					>
						<IconX size={8} />
					</IconButton>
				</div>
			)}
			<div
				ref={containerRef}
				{...stylex.props(styles.termContainer)}
				style={{
					display: isAgentChatPane ? "none" : undefined,
					pointerEvents: isSelected ? "auto" : "none",
					overflow: "hidden",
					padding: 0,
				}}
				onPointerDown={focusAgent}
				role="application"
				aria-label={pane.title || "Agent"}
			/>
			{isAgentChatPane && (
				<div
					{...stylex.props(
						styles.agentPane,
						!interactionEnabled && styles.agentPaneDisabled
					)}
				>
					<ChatPaneBoundary key={pane.id}>
						<AgentChatView
							paneId={pane.id}
							cwd={pane.cwd}
							referencePaths={pane.referencePaths}
							gitBranch={gitBranch}
							agentKind={viewAgentKind}
							onStatusChange={onAgentStatusChange}
							onClose={onClose}
							isSelected={isSelected}
							isVisible={isVisible}
							onDirectoryChange={handleDirectoryChange}
							onDirectoryCancel={onDirectoryCancel}
							onAddPane={onAddPane}
							draggable={paneIndex != null && !!onHeaderDragStart}
							onDragStart={handlePaneDragStart}
							onDragEnd={onHeaderDragEnd}
							ref={handleChatRef}
						/>
					</ChatPaneBoundary>
				</div>
			)}
		</div>
	);
});

const styles = stylex.create({
	root: {
		position: "relative",
		display: "flex",
		height: "100%",
		minHeight: 0,
		flexDirection: "column",
		overflow: "hidden",
	},
	header: {
		display: "flex",
		flexShrink: 0,
		cursor: "grab",
		userSelect: "none",
		alignItems: "center",
		gap: "0.5rem",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		paddingBlock: "0.375rem",
		paddingInline: "0.75rem",
		":active": {
			cursor: "grabbing",
		},
	},
	headerSelectButton: {
		alignItems: "center",
		borderWidth: 0,
		color: "inherit",
		display: "flex",
		flex: 1,
		font: "inherit",
		gap: "0.5rem",
		minWidth: 0,
		padding: 0,
		textAlign: "left",
	},
	agentIcon: {
		color: color.textMuted,
	},
	activeAccent: {
		color: "var(--color-inferay-accent)",
	},
	paneLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	selectedLabel: {
		color: color.textSoft,
	},
	breadcrumbSep: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	cwdLabel: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	selectedCwd: {
		color: color.textMain,
	},
	spacer: {
		flex: 1,
	},
	selectedDot: {
		width: "0.375rem",
		height: "0.375rem",
		borderRadius: "999px",
		backgroundColor: "var(--color-inferay-accent)",
	},
	termContainer: {
		minHeight: 0,
		flex: 1,
	},
	agentPane: {
		display: "flex",
		minHeight: 0,
		flex: 1,
		flexDirection: "column",
		overflow: "hidden",
		position: "relative",
	},
	agentPaneDisabled: {
		pointerEvents: "none",
	},
});
