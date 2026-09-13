import type { Pane, WorkspaceAgentKind } from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";
import { AgentChatView } from "@conversation/components/AgentChatView/index.tsx";
import { ChatPaneBoundary } from "@conversation/components/ChatPaneBoundary/index.tsx";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
} from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { styles } from "./styles.ts";

export const PaneView = function PaneView(props: {
	pane: Pane;
	isSelected: boolean;
	isVisible?: boolean;
	onClose: (paneId: string) => void;
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
	onSetPaneAgentKind?: (paneId: string, agentKind: WorkspaceAgentKind) => void;
}) {
	const viewAgentKind = createMemo(() =>
		isChatAgentKind(props.pane.agentKind)
			? props.pane.agentKind
			: loadDefaultChatSettings().agentKind,
	);
	const handlePaneDragStart = (e: PointerEvent) => {
		if (props.paneIndex == null || !props.onHeaderDragStart) return;
		props.onHeaderDragStart(e, props.paneIndex);
	};
	const handleDirectoryChange = (
		pid: string,
		cwd: string | null,
		refs?: string[],
	) => {
		if (!isChatAgentKind(props.pane.agentKind)) {
			props.onSetPaneAgentKind?.(pid, viewAgentKind());
		}
		props.onDirectorySelect?.(pid, cwd, refs);
	};
	const handleChatRef = (handle: AgentChatHandle | null) => {
		props.chatRef(props.pane.id, handle);
	};
	return (
		<div {...stylex.attrs(styles.root)}>
			<div {...stylex.attrs(styles.agentPane)}>
				<ChatPaneBoundary>
					<AgentChatView
						paneId={props.pane.id}
						cwd={props.pane.cwd}
						referencePaths={props.pane.referencePaths}
						pendingWorkspacePaths={props.pane.pendingWorkspacePaths}
						agentKind={viewAgentKind()}
						onClose={props.onClose}
						isSelected={props.isSelected}
						isVisible={props.isVisible === undefined ? true : props.isVisible}
						onDirectoryChange={handleDirectoryChange}
						onDirectoryCancel={props.onDirectoryCancel}
						draggable={props.paneIndex != null && !!props.onHeaderDragStart}
						onDragStart={handlePaneDragStart}
						onDragEnd={props.onHeaderDragEnd}
						ref={handleChatRef}
					/>
				</ChatPaneBoundary>
			</div>
		</div>
	);
};
