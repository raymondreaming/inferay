import type { ChatTranscriptMessage, WorkspaceAgentKind } from "@contracts";
export interface AgentChatHandle {
	focusInput: (atEnd?: boolean) => void;
	highlightComposer: () => void;
}
export interface AgentChatViewProps {
	paneId: string;
	cwd?: string;
	referencePaths?: string[];
	pendingWorkspacePaths?: string[];
	agentKind?: WorkspaceAgentKind;
	onClose?: (paneId: string) => void;
	isSelected?: boolean;
	isVisible?: boolean;
	draggable?: boolean;
	onDragStart?: (e: PointerEvent) => void;
	onDragEnd?: () => void;

	/** Called when user picks directories from empty state picker */
	onDirectoryChange?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[],
	) => void;
	onDirectoryCancel?: (paneId: string) => void;
	ref?: (handle: AgentChatHandle | null) => void;
}
export type { ChatLoadingState } from "@contracts";

export type ChatMessage = ChatTranscriptMessage & {
	optimistic?: boolean;
	localOnly?: boolean;
};
