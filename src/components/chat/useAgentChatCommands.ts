import { useMemo } from "react";
import { getAgentDefinition } from "../../features/agents/agents.ts";
import type { SlashCommand } from "../../features/chat/agent-chat-shared.ts";
import { usePrompts } from "../../features/prompts/usePrompts.ts";
import type { AgentKind } from "../../features/terminal/terminal-utils.ts";

const LOCAL_COMMANDS: SlashCommand[] = [
	{
		name: "clear",
		description: "Clear all messages",
		action: "local",
		isLocalCommand: true,
	},
	{
		name: "help",
		description: "Show available commands",
		action: "local",
		isLocalCommand: true,
	},
];

export function useAgentChatCommands(agentKind: AgentKind) {
	const { prompts: localPrompts, incrementUsage: incrementLocalUsage } =
		usePrompts();
	const allCommands = useMemo<SlashCommand[]>(() => {
		const libraryCommands: SlashCommand[] = localPrompts.map((p) => ({
			id: p._id,
			name: p.command,
			description: p.description,
			action: "send" as const,
			promptTemplate: p.promptTemplate,
			category: p.category,
			isFromLibrary: true,
		}));
		const nativeCommands: SlashCommand[] = getAgentDefinition(
			agentKind
		).nativeSlashCommands.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			action: "send",
			isLocalCommand: true,
		}));
		const deduped = new Map<string, SlashCommand>();
		for (const cmd of [
			...LOCAL_COMMANDS,
			...libraryCommands,
			...nativeCommands,
		]) {
			const key = cmd.name.toLowerCase();
			if (!deduped.has(key)) deduped.set(key, cmd);
		}
		return [...deduped.values()];
	}, [agentKind, localPrompts]);
	const slashCommandNames = useMemo(
		() => allCommands.map((cmd) => cmd.name),
		[allCommands]
	);

	return { allCommands, incrementLocalUsage, slashCommandNames };
}
