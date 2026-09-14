import type { AgentWorkspaceAction, WorkspaceAgentKind } from "@contracts";
import type { AgentChatHandle } from "@conversation/components/AgentChatView/index.tsx";

export type AgentPaneActionsArgs = {
	readonly chatRefs: Map<string, AgentChatHandle>;
	readonly cleanupPane: (paneId: string) => void;
	readonly dispatchAgentGroupAction: (action: AgentWorkspaceAction) => void;
	readonly groups: import("@contracts").AgentSavedState["groups"];
	readonly selectedGroupId: string | null;
};

export type AgentPaneActions = {
	handleAddPane: (agentKind: WorkspaceAgentKind) => void;
	reorderPanes: (fromIndex: number, toIndex: number) => void;
	handleSetPaneAgentKind: (
		paneId: string,
		agentKind: WorkspaceAgentKind,
	) => void;
	handleDirectorySelected: (
		paneId: string,
		path: string | null,
		referencePaths?: string[],
	) => void;
	selectPane: (paneId: string) => void;
	handleChatRef: (id: string, handle: AgentChatHandle | null) => void;
	removePane: (paneId: string) => void;
};
