import type { SlashCommand } from "../../conversation/model/agent-chat-shared.ts";
export type AgentAccountHealth = "ready" | "needs-login" | "missing-cli";
export interface AgentAccountProviderStatus {
	kind: ChatAgentKind;
	health: AgentAccountHealth;
}

import { fetchJson, postJson } from "../../../adapters/backend/http.ts";
import {
	readStoredJson,
	writeStoredJson,
} from "../../../adapters/storage/stored-values.ts";
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
	}>("/api/native/provider-config");
	catalog = response.agents;
	const defaults = await resolveChatSettings({
		defaults: loadDefaultChatSettings(),
	});
	writeStoredJson(DEFAULT_CHAT_SETTINGS_KEY, defaults);
}
export function resolveChatSettings(input: {
	agentKind?: AgentKind;
	model?: string | null;
	reasoningLevel?: string | null;
	defaults?: Partial<DefaultChatSettings>;
}) {
	return postJson<DefaultChatSettings>("/api/native/provider-config", input);
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
const DEFAULT_CHAT_SETTINGS_KEY = "inferay-default-chat-settings";
export function loadDefaultChatSettings(): DefaultChatSettings {
	return readStoredJson<DefaultChatSettings>(DEFAULT_CHAT_SETTINGS_KEY, {
		agentKind: "codex",
		model: "",
		reasoningLevel: "",
	});
}
export async function saveDefaultChatSettings(settings: DefaultChatSettings) {
	const normalized = await resolveChatSettings(settings);
	writeStoredJson(DEFAULT_CHAT_SETTINGS_KEY, normalized);
	return normalized;
}
