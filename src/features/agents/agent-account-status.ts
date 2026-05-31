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

export function buildAgentAccountStatus(
	input: AgentAccountStatusInput
): AgentAccountProviderStatus {
	if (!input.installed) {
		return {
			...input,
			authConfigPaths: [],
			health: "missing-cli",
			summary: `${input.label} CLI was not found on this machine.`,
		};
	}

	if (input.authConfigPaths.length === 0) {
		return {
			...input,
			health: "needs-login",
			summary: `${input.label} CLI is installed, but Inferay did not find local auth config.`,
		};
	}

	return {
		...input,
		health: "ready",
		summary: `${input.label} CLI and local auth config detected.`,
	};
}
