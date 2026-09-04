import type { ChatAgentKind } from "./agents.ts";

export type AgentAccountHealth = "ready" | "needs-login" | "missing-cli";

export interface AgentAccountStatusInput {
	kind: ChatAgentKind;
	label: string;
	installed: boolean;
	binaryPath: string;
	version: string | null;
	authConfigPaths: string[];
	usageSignals: string[];
	checkedAt: number;
}

export interface AgentAccountProviderStatus extends AgentAccountStatusInput {
	health: AgentAccountHealth;
	summary: string;
}
