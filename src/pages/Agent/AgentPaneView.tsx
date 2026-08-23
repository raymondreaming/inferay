import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useRef } from "octane";
import type { AgentChatHandle } from "../../components/chat/AgentChatView.tsx";
import { AgentChatView } from "../../components/chat/AgentChatView.tsx";
import { ChatPaneBoundary } from "../../components/chat/ChatPaneBoundary.tsx";
import type {
	AgentKind,
	AgentPaneModel,
	AgentTheme,
} from "../../features/agent/agent-utils.ts";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../features/agents/agents.ts";

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
		referencePaths?: string[],
	) => void;
	onDirectoryCancel?: (paneId: string) => void;
	chatRef: (paneId: string, handle: AgentChatHandle | null) => void;
	onAgentStatusChange?: (paneId: string, status: string) => void;
	paneIndex?: number;
	onHeaderDragStart?: (e: DragEvent, index: number) => void;
	onHeaderDragEnd?: () => void;
	onAddPane?: (agentKind: AgentKind) => void;
	onSetPaneAgentKind?: (paneId: string, agentKind: AgentKind) => void;
}

export const AgentPaneView = memo(function AgentPaneView({
	pane,
	isSelected,
	isVisible = true,
	gitBranch,
	onClose,
	onDirectorySelect,
	onDirectoryCancel,
	chatRef,
	onAgentStatusChange,
	paneIndex,
	onHeaderDragStart,
	onHeaderDragEnd,
	onAddPane,
	onSetPaneAgentKind,
}: AgentPaneViewProps) {
	const chatHandleRef = useRef<AgentChatHandle | null>(null);
	const viewAgentKind = isChatAgentKind(pane.agentKind)
		? pane.agentKind
		: loadDefaultChatSettings().agentKind;
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
		[onHeaderDragStart, pane.id, paneIndex],
	);
	const handleDirectoryChange = useCallback(
		(pid: string, cwd: string | null, refs?: string[]) => {
			if (!isChatAgentKind(pane.agentKind)) {
				onSetPaneAgentKind?.(pid, viewAgentKind);
			}
			onDirectorySelect?.(pid, cwd, refs);
		},
		[onDirectorySelect, onSetPaneAgentKind, pane.agentKind, viewAgentKind],
	);
	const handleChatRef = useCallback(
		(handle: AgentChatHandle | null) => {
			chatHandleRef.current = handle;
			chatRef(pane.id, handle);
		},
		[chatRef, pane.id],
	);

	return (
		<div {...stylex.props(styles.root)}>
			<div {...stylex.props(styles.agentPane)}>
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
		</div>
	);
});

const styles = stylex.create({
	root: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		height: "100%",
		width: "100%",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
		position: "relative",
	},
	agentPane: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		width: "100%",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
		position: "relative",
	},
});
