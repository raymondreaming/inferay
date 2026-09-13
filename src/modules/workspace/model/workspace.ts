import type { AgentSavedState, AgentWorkspaceAction } from "@contracts";

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
