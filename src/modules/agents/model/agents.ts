import type { SlashCommand } from "../../conversation/model/agent-chat-shared.ts";
export type AgentAccountHealth = "ready" | "needs-login" | "missing-cli";
export interface AgentAccountProviderStatus {
	kind: ChatAgentKind;
	health: AgentAccountHealth;
}

import { fetchJson, postJson } from "../../../adapters/backend/http.ts";
export type ChatAgentKind = "claude" | "codex";
export type AgentKind = "agent" | ChatAgentKind;
export type AgentIconKey = "agent" | "anthropic" | "openai";
export interface ModelOption {
	readonly id: string;
	readonly label: string;
	readonly shortLabel?: string;
	readonly detail?: string;
}
export interface ReasoningLevel {
	readonly id: string;
	readonly label: string;
	readonly detail: string;
}
export interface AgentDefinition {
	readonly kind: AgentKind;
	readonly label: string;
	readonly iconKey: AgentIconKey;
	readonly commands: SlashCommand[];
	readonly models: readonly ModelOption[];
	readonly defaultModel: string;
	readonly reasoningLevels: readonly ReasoningLevel[];
}
let catalog: Record<AgentKind, AgentDefinition> | undefined;

/** Loaded before client hydration; the server owns model/capability data. */
export async function initializeAgentCatalog() {
	const response = await fetchJson<{
		agents: Record<AgentKind, AgentDefinition>;
		defaults: DefaultChatSettings;
	}>("/api/native/provider-config");
	catalog = response.agents;
	defaultSettings = response.defaults;
}
export function isChatAgentKind(kind: AgentKind): kind is ChatAgentKind {
	return kind === "claude" || kind === "codex";
}
export function getAgentDefinition(kind: AgentKind): AgentDefinition {
	// Prerendering has no native connection; only neutral presentation is needed.
	return (
		catalog?.[kind] ?? {
			kind,
			label:
				kind === "codex" ? "Codex" : kind === "claude" ? "Claude" : "Agent",
			iconKey:
				kind === "codex" ? "openai" : kind === "claude" ? "anthropic" : "agent",
			commands: [],
			models: [],
			defaultModel: "",
			reasoningLevels: [],
		}
	);
}
export interface DefaultChatSettings {
	readonly agentKind: ChatAgentKind;
	readonly model: string;
	readonly reasoningLevel: string;
}
let defaultSettings: DefaultChatSettings = {
	agentKind: "codex",
	model: "",
	reasoningLevel: "",
};
export function loadDefaultChatSettings(): DefaultChatSettings {
	return defaultSettings;
}
export async function saveDefaultChatSettings(settings: DefaultChatSettings) {
	defaultSettings = await postJson<DefaultChatSettings>(
		"/api/native/provider-config",
		settings,
	);
	return defaultSettings;
}
