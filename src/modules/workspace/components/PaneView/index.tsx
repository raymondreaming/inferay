import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { Pane } from "../../../../../build/presentation/contracts/Pane.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import {
	isChatAgentKind,
	loadDefaultChatSettings,
} from "../../../../shared/lib/native.tsx";
import type { AgentChatHandle } from "../../../conversation/components/AgentChatView/index.tsx";
import { AgentChatView } from "../../../conversation/components/AgentChatView/index.tsx";
import { ChatPaneBoundary } from "../../../conversation/components/ChatPaneBoundary/index.tsx";
import { styles } from "./styles.ts";

interface PaneViewProps {
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
}
export const PaneView = function PaneView(_props: PaneViewProps) {
	const viewAgentKind = createMemo(() =>
		isChatAgentKind(_props.pane.agentKind)
			? _props.pane.agentKind
			: loadDefaultChatSettings().agentKind,
	);
	const handlePaneDragStart = (e: PointerEvent) => {
		if (_props.paneIndex == null || !_props.onHeaderDragStart) return;
		_props.onHeaderDragStart(e, _props.paneIndex);
	};
	const handleDirectoryChange = (
		pid: string,
		cwd: string | null,
		refs?: string[],
	) => {
		if (!isChatAgentKind(_props.pane.agentKind)) {
			_props.onSetPaneAgentKind?.(pid, viewAgentKind());
		}
		_props.onDirectorySelect?.(pid, cwd, refs);
	};
	const handleChatRef = (handle: AgentChatHandle | null) => {
		_props.chatRef(_props.pane.id, handle);
	};
	return (
		<div {...stylex.attrs(styles.root)}>
			<div {...stylex.attrs(styles.agentPane)}>
				<ChatPaneBoundary>
					<AgentChatView
						paneId={_props.pane.id}
						cwd={_props.pane.cwd}
						referencePaths={_props.pane.referencePaths}
						pendingWorkspacePaths={_props.pane.pendingWorkspacePaths}
						agentKind={viewAgentKind()}
						onClose={_props.onClose}
						isSelected={_props.isSelected}
						isVisible={_props.isVisible === undefined ? true : _props.isVisible}
						onDirectoryChange={handleDirectoryChange}
						onDirectoryCancel={_props.onDirectoryCancel}
						draggable={_props.paneIndex != null && !!_props.onHeaderDragStart}
						onDragStart={handlePaneDragStart}
						onDragEnd={_props.onHeaderDragEnd}
						ref={handleChatRef}
					/>
				</ChatPaneBoundary>
			</div>
		</div>
	);
};
