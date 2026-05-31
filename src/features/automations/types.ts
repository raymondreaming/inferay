import type { ChatAgentKind } from "../agents/agents.ts";

export type AutomationStatus = "ready" | "scheduled" | "running";

export type AutomationNodeKind =
	| "input"
	| "prompt"
	| "research"
	| "image"
	| "code"
	| "condition"
	| "output"
	| "script"
	| "note"
	| "agent"
	| "web"
	| "shape";

export interface AutomationFlow {
	id: string;
	name: string;
	description: string;
	schedule: string;
	nextRun: string;
	status: AutomationStatus;
	primaryPath: string;
	referencePaths: string[];
	nodes: AutomationNode[];
	edges: Array<[string, string]>;
}

export interface AutomationNode {
	id: string;
	kind: AutomationNodeKind;
	title: string;
	description: string;
	x: number;
	y: number;
	file: string;
	contextPaths?: string[];
	body: string;
	output: string;
	execution?: AutomationNodeExecution;
}

export interface AutomationNodeExecution {
	source: "quick-action" | "prompt" | "manual";
	sourceId?: string;
	agentKind?: ChatAgentKind;
	model?: string;
	reasoningLevel?: string;
	useWorktree?: boolean;
}
