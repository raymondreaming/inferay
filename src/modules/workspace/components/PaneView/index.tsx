import * as stylex from "@octanejs/stylex";
import { memo, useCallback } from "octane";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../../agents/model/agents.ts";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import { AgentChatView } from "../../../conversation/components/AgentChatView/index.tsx";
import { ChatPaneBoundary } from "../../../conversation/components/ChatPaneBoundary/index.tsx";
import type {
	AgentKind,
	AgentPaneModel,
	AgentTheme,
} from "../../model/workspace-model.ts";
import { styles } from "./styles.ts";

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
	paneIndex?: number;
	onHeaderDragStart?: (e: PointerEvent, index: number) => void;
	onHeaderDragEnd?: () => void;
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
	paneIndex,
	onHeaderDragStart,
	onHeaderDragEnd,
	onSetPaneAgentKind,
}: PaneViewProps) {
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
						onClose={onClose}
						isSelected={isSelected}
						isVisible={isVisible}
						onDirectoryChange={handleDirectoryChange}
						onDirectoryCancel={onDirectoryCancel}
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
