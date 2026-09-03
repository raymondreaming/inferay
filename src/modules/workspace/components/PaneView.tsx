import * as stylex from "@octanejs/stylex";
import { memo, useCallback, useRef } from "octane";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../../modules/agents/model/agents.ts";
import type { AgentChatHandle } from "../../../modules/conversation/components/AgentChatView.tsx";
import { AgentChatView } from "../../../modules/conversation/components/AgentChatView.tsx";
import { ChatPaneBoundary } from "../../../modules/conversation/components/ChatPaneBoundary.tsx";
import type {
	AgentKind,
	AgentPaneModel,
	AgentTheme,
} from "../../../modules/workspace/model/workspace-model.ts";
import { controlSize } from "../../../tokens.stylex.ts";

interface PaneViewProps {
	pane: AgentPaneModel;
	isSelected: boolean;
	isVisible?: boolean;
	theme: AgentTheme;
	fontSize: number;
	fontFamily: string;
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
	onHeaderDragStart?: (e: PointerEvent, index: number) => void;
	onHeaderDragEnd?: () => void;
	onAddPane?: (agentKind: AgentKind) => void;
	onSetPaneAgentKind?: (paneId: string, agentKind: AgentKind) => void;
}

export const PaneView = memo(function PaneView({
	pane,
	isSelected,
	isVisible = true,
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
}: PaneViewProps) {
	const chatHandleRef = useRef<AgentChatHandle | null>(null);
	const viewAgentKind = isChatAgentKind(pane.agentKind)
		? pane.agentKind
		: loadDefaultChatSettings().agentKind;
	const handlePaneDragStart = useCallback(
		(e: PointerEvent) => {
			if (paneIndex == null || !onHeaderDragStart) return;
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
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
		position: "relative",
	},
	agentPane: {
		display: "flex",
		flex: 1,
		flexDirection: "column",
		width: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
		position: "relative",
	},
});
