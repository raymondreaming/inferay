import type {
	AskUserQuestion,
	McpElicitation,
	SkillProposal,
	SkillRead,
	ToolDisplayInfo,
	ToolOutputSummary,
	WorkspaceAgentKind,
} from "@contracts";
import type { CommandSystemMessage } from "../ChatMessageList/CommandSystemCard.tsx";
import type { GoalSystemMessage } from "../ChatMessageList/GoalSystemCard.tsx";
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
export type ChatLoadingState = {
	isLoading: boolean;
	status: string;
	startTime: number | null;
};

export interface NativeChatRender {
	version: 1;
	kind: "message" | "edit-group" | "tool-group";
	groupEnd?: number;
	groupLeader?: boolean;
	hidden: boolean;
	continuesAfter?: boolean;
	rowId?: string;
	filePath?: string;
	edit?: { file_path: string; old_string: string; new_string: string };
	outputStart?: number;
	display?: ToolDisplayInfo;
	summary?: ToolOutputSummary | null;
	questions?: AskUserQuestion[] | null;
	elicitation?: McpElicitation | null;
	command?: CommandSystemMessage;
	goal?: GoalSystemMessage;
	skillProposal?: SkillProposal;
	skillRead?: SkillRead;
	skillParts?: Array<
		| { start: number; end: number }
		| { proposal: SkillProposal; index: number }
		| { pending: true }
	>;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "tool" | "system" | "btw";
	content: string;
	toolName?: string;
	render?: NativeChatRender;
	optimistic?: boolean;
	localOnly?: boolean;
	isStreaming?: boolean;
	btwQuestion?: string;
	images?: string[];
}
