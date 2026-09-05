import type { ChatAgentKind } from "./agents.ts";

export type AgentAccountHealth = "ready" | "needs-login" | "missing-cli";

export interface AgentAccountProviderStatus {
	kind: ChatAgentKind;
	health: AgentAccountHealth;
}
