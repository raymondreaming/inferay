export type AgentContextMode = "inherit" | "replace";

export interface AgentContextLayer {
	instructions: string;
	mode: AgentContextMode;
	updatedAt: number;
}

export interface EffectiveAgentContext {
	global: AgentContextLayer;
	project: AgentContextLayer | null;
	chat: AgentContextLayer | null;
	effectiveInstructions: string;
	scope: "global" | "project" | "chat";
	skillCount: number;
	skillManifest: string;
	activatedSkills: Array<{
		name: string;
		command: string;
		instructions: string;
	}>;
}

export interface AgentContextUpdate {
	scope: "global" | "project" | "chat";
	cwd?: string;
	paneId?: string;
	instructions: string;
	mode?: AgentContextMode;
}
