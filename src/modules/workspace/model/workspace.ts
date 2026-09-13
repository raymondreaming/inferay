import type { AgentSavedState, WorkspaceAgentKind } from "@contracts";

export type AgentWorkspaceAction =
	| {
			type: "reorderRepository";
			cwd: string;
			beforeCwd: string | null;
	  }
	| {
			type: "selectWorkspace";
			groupId: string;
	  }
	| {
			type: "selectRepository";
			cwd: string;
	  }
	| {
			type: "selectPane";
			groupId: string;
			paneId: string;
	  }
	| {
			type: "addWorkspace";
	  }
	| {
			type: "removeWorkspace";
			groupId: string;
	  }
	| {
			type: "renameWorkspace";
			groupId: string;
			name: string;
	  }
	| {
			type: "addPane";
			groupId?: string;
			agentKind?: WorkspaceAgentKind;
			cwd?: string;
			referencePaths?: string[];
	  }
	| {
			type: "removePane";
			groupId: string;
			paneId: string;
	  }
	| {
			type: "directorySelected";
			groupId: string;
			paneId: string;
			path: string | null;
			referencePaths?: string[];
	  }
	| {
			type: "setPaneAgentKind";
			groupId: string;
			paneId: string;
			agentKind: WorkspaceAgentKind;
	  }
	| {
			type: "reorderPanes";
			groupId: string;
			fromIndex: number;
			toIndex: number;
	  }
	| {
			type: "setGridDimensions";
			groupId: string;
			columns?: number;
			rows?: number;
	  }
	| {
			type: "changePaneAgentKind";
			paneId: string;
			agentKind: WorkspaceAgentKind;
	  }
	| {
			type: "setTheme";
			themeId: string;
	  };
export type AgentGroupsAction = Exclude<
	AgentWorkspaceAction,
	{
		type: "addWorkspace" | "removeWorkspace" | "renameWorkspace";
	}
>;

export type WorkspaceSnapshot = {
	state: AgentSavedState | null;
	error: string | null;
};
