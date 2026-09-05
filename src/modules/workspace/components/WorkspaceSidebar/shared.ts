import type { AgentPaneModel } from "../../model/workspace-model.ts";

export type SidebarUpdateStatus = "idle" | "updating" | "error";

interface SidebarWorkspaceGroup {
	id: string;
	name: string;
	panes: AgentPaneModel[];
	selectedPaneId?: string | null;
	columns: number;
	rows: number;
}

export interface SidebarWorkspaceState {
	groups: SidebarWorkspaceGroup[];
	selectedGroupId: string | null;
	key: string;
}
