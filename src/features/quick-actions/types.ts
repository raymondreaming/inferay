import type { ChatAgentKind } from "../agents/agents.ts";

export interface QuickActionProfile {
	id: string;
	name: string;
	description: string;
	agentKind: ChatAgentKind;
	model: string;
	reasoningLevel?: string;
	cwd: string;
	prompt: string;
	tags: string[];
	useWorktree?: boolean;
	isBuiltIn?: boolean;
	createdAt: number;
	updatedAt: number;
	lastUsed?: number;
	launchCount: number;
}

export type QuickActionDraft = Pick<
	QuickActionProfile,
	| "name"
	| "description"
	| "agentKind"
	| "model"
	| "reasoningLevel"
	| "cwd"
	| "prompt"
	| "tags"
	| "useWorktree"
>;
