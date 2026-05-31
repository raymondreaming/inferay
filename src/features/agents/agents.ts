import { hasId } from "../../lib/data.ts";
import { readStoredJson, writeStoredJson } from "../../lib/stored-json.ts";

export type ChatAgentKind = "claude" | "codex";
export type AgentKind = "terminal" | ChatAgentKind;
export type AgentIconKey = "terminal" | "anthropic" | "openai";

export interface NativeSlashCommand {
	readonly name: string;
	readonly description: string;
}

export interface ModelOption {
	readonly id: string;
	readonly label: string;
	readonly detail?: string;
}

export interface ReasoningLevel {
	readonly id: string;
	readonly label: string;
	readonly detail?: string;
}

export const CODEX_REASONING_LEVELS: readonly ReasoningLevel[] = [
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
	{ id: "xhigh", label: "Extra High" },
] as const;

export interface AgentDefinition {
	readonly kind: AgentKind;
	readonly label: string;
	readonly paneTitle: string;
	readonly description: string;
	readonly iconKey: AgentIconKey;
	readonly supportsChat: boolean;
	readonly supportsInteractiveTerminal: boolean;
	readonly supportsResume: boolean;
	readonly nativeSlashCommands: readonly NativeSlashCommand[];
	readonly models: readonly ModelOption[];
	readonly defaultModel: string;
}

const CLAUDE_NATIVE_COMMANDS = [
	{
		name: "btw",
		description: "Ask a side question without adding to conversation",
	},
	{ name: "bug", description: "Report bugs or issues" },
	{ name: "compact", description: "Compact conversation history" },
	{ name: "config", description: "Open config panel" },
	{ name: "cost", description: "Show token usage and costs" },
	{ name: "doctor", description: "Check Claude Code health" },
	{ name: "init", description: "Initialize project with CLAUDE.md" },
	{ name: "login", description: "Switch accounts or login" },
	{ name: "logout", description: "Logout from current account" },
	{ name: "memory", description: "Edit CLAUDE.md memory file" },
	{ name: "model", description: "Switch AI model" },
	{ name: "pr-comments", description: "View PR comments" },
	{ name: "review", description: "Review code changes" },
	{ name: "terminal-setup", description: "Setup terminal integration" },
	{ name: "vim", description: "Toggle vim mode" },
] as const satisfies readonly NativeSlashCommand[];

const CLAUDE_MODELS: readonly ModelOption[] = [
	{ id: "claude-opus-4-7", label: "Opus 4.7", detail: "★ Most capable" },
	{ id: "claude-opus-4-6", label: "Opus 4.6", detail: "Previous Opus" },
	{ id: "claude-sonnet-4-6", label: "Sonnet 4.6", detail: "Best value" },
	{ id: "claude-haiku-4-5", label: "Haiku 4.5", detail: "Fastest" },
] as const;

const CODEX_MODELS: readonly ModelOption[] = [
	{ id: "gpt-5.5", label: "GPT-5.5", detail: "Frontier model" },
	{ id: "gpt-5.4", label: "GPT-5.4", detail: "Everyday coding" },
	{ id: "gpt-5.2-codex", label: "GPT-5.2 Codex", detail: "★ Frontier agentic" },
	{
		id: "gpt-5.1-codex-max",
		label: "GPT-5.1 Codex Max",
		detail: "Deep reasoning",
	},
	{ id: "gpt-5.4-mini", label: "GPT-5.4 Mini", detail: "Fast & cheap" },
	{ id: "gpt-5.3-codex", label: "GPT-5.3 Codex", detail: "Coding-optimized" },
	{ id: "gpt-5.3-codex-spark", label: "GPT-5.3 Spark", detail: "Ultra-fast" },
	{ id: "gpt-5.2", label: "GPT-5.2", detail: "Long-running agents" },
	{ id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", detail: "Cheapest" },
] as const;

const CODEX_NATIVE_COMMANDS = [
	{
		name: "goal",
		description: "Start, pause, resume, clear, or inspect a Codex objective",
	},
] as const satisfies readonly NativeSlashCommand[];

const AGENT_DEFINITIONS: Record<AgentKind, AgentDefinition> = {
	terminal: {
		kind: "terminal",
		label: "Terminal",
		paneTitle: "Terminal",
		description: "Interactive shell session",
		iconKey: "terminal",
		supportsChat: false,
		supportsInteractiveTerminal: true,
		supportsResume: false,
		nativeSlashCommands: [],
		models: [],
		defaultModel: "",
	},
	claude: {
		kind: "claude",
		label: "Claude",
		paneTitle: "Claude",
		description: "Anthropic Claude Code CLI",
		iconKey: "anthropic",
		supportsChat: true,
		supportsInteractiveTerminal: true,
		supportsResume: true,
		nativeSlashCommands: CLAUDE_NATIVE_COMMANDS,
		models: CLAUDE_MODELS,
		defaultModel: "claude-opus-4-7",
	},
	codex: {
		kind: "codex",
		label: "Codex",
		paneTitle: "Codex",
		description: "OpenAI Codex CLI",
		iconKey: "openai",
		supportsChat: true,
		supportsInteractiveTerminal: true,
		supportsResume: true,
		nativeSlashCommands: CODEX_NATIVE_COMMANDS,
		models: CODEX_MODELS,
		defaultModel: "gpt-5.5",
	},
} as const;

export const NEW_PANE_AGENT_KINDS = [
	"claude",
	"codex",
] as const satisfies readonly AgentKind[];

export function isChatAgentKind(kind: AgentKind): kind is ChatAgentKind {
	return kind === "claude" || kind === "codex";
}

export function getAgentDefinition(kind: AgentKind): AgentDefinition {
	return AGENT_DEFINITIONS[kind];
}

export interface DefaultChatSettings {
	readonly agentKind: ChatAgentKind;
	readonly model: string;
	readonly reasoningLevel: string;
}

export const DEFAULT_CHAT_SETTINGS_KEY = "inferay-default-chat-settings";
const DEFAULT_CHAT_AGENT_KIND: ChatAgentKind = "codex";
const DEFAULT_REASONING_LEVEL = CODEX_REASONING_LEVELS[0]!.id;

export function normalizeDefaultChatSettings(
	settings: Partial<DefaultChatSettings> | null | undefined
): DefaultChatSettings {
	const agentKind: ChatAgentKind =
		settings?.agentKind === "claude" || settings?.agentKind === "codex"
			? settings.agentKind
			: DEFAULT_CHAT_AGENT_KIND;
	const definition = getAgentDefinition(agentKind);
	const model = definition.models.some(hasId.bind(null, settings?.model))
		? settings!.model!
		: definition.defaultModel;
	const reasoningLevel = CODEX_REASONING_LEVELS.some(
		hasId.bind(null, settings?.reasoningLevel)
	)
		? settings!.reasoningLevel!
		: DEFAULT_REASONING_LEVEL;
	return { agentKind, model, reasoningLevel };
}

export function loadDefaultChatSettings(): DefaultChatSettings {
	return normalizeDefaultChatSettings(
		readStoredJson<Partial<DefaultChatSettings> | null>(
			DEFAULT_CHAT_SETTINGS_KEY,
			null
		)
	);
}

export function saveDefaultChatSettings(settings: DefaultChatSettings) {
	writeStoredJson(
		DEFAULT_CHAT_SETTINGS_KEY,
		normalizeDefaultChatSettings(settings)
	);
}
