import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import type React from "react";
import { fetchJsonOr } from "../../../adapters/backend/http.ts";
import { getAgentDefinition } from "../../../modules/agents/model/agents.ts";
import type { SlashCommand } from "../../../modules/conversation/model/agent-chat-shared.ts";
import { useSkills } from "../../../modules/skills/hooks/useSkills.tsx";
import type { AgentKind } from "../../../modules/workspace/model/workspace-model.ts";
import {
	findTriggerAtCursor,
	hideMenuState,
} from "../model/chat-agent-utils.ts";

function applyInlineCompletion(
	input: string,
	cursorPos: number,
	triggerIndex: number,
	replacement: string,
) {
	const before = input.slice(0, triggerIndex);
	const after = input.slice(cursorPos);
	return {
		nextValue: `${before}${replacement}${after || " "}`,
		nextCursor: before.length + replacement.length + (after ? 0 : 1),
	};
}

export interface FileMenuState {
	show: boolean;
	selectedIdx: number;
	query: string;
	atIndex: number;
}

export interface SlashMenuState {
	show: boolean;
	selectedIdx: number;
	query: string;
	slashIndex: number;
}

export interface FileSearchResult {
	name: string;
	path: string;
	isDir: boolean;
}

interface UseAgentChatMenusOptions {
	agentKind: AgentKind;
	cwd?: string;
	enabled?: boolean;
	input: string;
	setInput: (value: string) => void;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function areFileResultsEqual(
	prev: FileSearchResult[],
	next: FileSearchResult[],
) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (a.name !== b.name || a.path !== b.path || a.isDir !== b.isDir) {
			return false;
		}
	}
	return true;
}

export function useAgentChatMenus({
	agentKind,
	cwd,
	enabled = true,
	input,
	setInput,
	textareaRef,
}: UseAgentChatMenusOptions) {
	const { skills: localSkills } = useSkills(enabled);
	const [fileMenu, setFileMenu] = useState<FileMenuState>({
		show: false,
		selectedIdx: 0,
		query: "",
		atIndex: -1,
	});
	const [slashMenu, setSlashMenu] = useState<SlashMenuState>({
		show: false,
		selectedIdx: 0,
		query: "",
		slashIndex: -1,
	});
	const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
	const fileSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fileSearchRequestRef = useRef(0);
	const allCommands = useMemo<SlashCommand[]>(() => {
		const deduped = new Map<string, SlashCommand>();
		for (const command of [
			{
				name: "exit",
				description: "Close this chat pane",
				action: "local" as const,
				isLocalCommand: true,
			},
			{
				name: "clear",
				description: "Clear all messages",
				action: "local" as const,
				isLocalCommand: true,
			},
			{
				name: "help",
				description: "Show available commands",
				action: "local" as const,
				isLocalCommand: true,
			},
			...localSkills.map((skill) => ({
				id: skill._id,
				name: skill.command,
				description: skill.description,
				action: "send" as const,
				category: skill.category,
				isFromLibrary: true,
			})),
			...getAgentDefinition(agentKind).nativeSlashCommands.map((command) => ({
				name: command.name,
				description: command.description,
				action: "send" as const,
				isLocalCommand: true,
			})),
		]) {
			const key = command.name.toLowerCase();
			if (!deduped.has(key)) deduped.set(key, command);
		}
		return [...deduped.values()];
	}, [agentKind, localSkills]);
	const slashCommandNames = useMemo(
		() => allCommands.map((command) => command.name),
		[allCommands],
	);

	const slashCommandInfo = useMemo(() => {
		if (!slashMenu.show || slashMenu.slashIndex === -1) {
			return { filtered: [] as SlashCommand[] };
		}
		const query = slashMenu.query.toLowerCase();
		const filtered = allCommands.filter((cmd) =>
			cmd.name.toLowerCase().startsWith(query),
		);
		return { filtered };
	}, [allCommands, slashMenu.query, slashMenu.show, slashMenu.slashIndex]);

	const filteredCommands = slashCommandInfo.filtered;
	const visibleFileMenu = enabled ? fileMenu : hideMenuState(fileMenu);
	const visibleSlashMenu = enabled ? slashMenu : hideMenuState(slashMenu);
	const showCommands = enabled && visibleSlashMenu.show;

	useEffect(() => {
		if (enabled) return;
		fileSearchRequestRef.current++;
		if (fileSearchTimerRef.current) {
			clearTimeout(fileSearchTimerRef.current);
			fileSearchTimerRef.current = null;
		}
	}, [enabled]);

	useEffect(
		() => () => {
			if (fileSearchTimerRef.current) clearTimeout(fileSearchTimerRef.current);
		},
		[],
	);

	const handleInputForSlashMenu = useCallback(
		(value: string, cursorPos: number) => {
			if (!enabled) return;
			const trigger = findTriggerAtCursor(value, cursorPos, "/");
			if (!trigger) {
				setSlashMenu((prev) => (prev.show ? hideMenuState(prev) : prev));
				return;
			}

			setSlashMenu((prev) => {
				if (
					prev.show &&
					prev.selectedIdx === 0 &&
					prev.query === trigger.query &&
					prev.slashIndex === trigger.index
				) {
					return prev;
				}
				return {
					show: true,
					selectedIdx: 0,
					query: trigger.query,
					slashIndex: trigger.index,
				};
			});
		},
		[enabled],
	);

	const handleInputForFileMenu = useCallback(
		(value: string, cursorPos: number) => {
			if (!enabled) return;
			const trigger = findTriggerAtCursor(value, cursorPos, "@");
			if (!trigger) {
				fileSearchRequestRef.current++;
				if (fileSearchTimerRef.current) {
					clearTimeout(fileSearchTimerRef.current);
					fileSearchTimerRef.current = null;
				}
				setFileMenu((prev) => (prev.show ? hideMenuState(prev) : prev));
				return;
			}

			setFileMenu((prev) => {
				if (
					prev.show &&
					prev.selectedIdx === 0 &&
					prev.query === trigger.query &&
					prev.atIndex === trigger.index
				) {
					return prev;
				}
				return {
					show: true,
					selectedIdx: 0,
					query: trigger.query,
					atIndex: trigger.index,
				};
			});

			if (fileSearchTimerRef.current) clearTimeout(fileSearchTimerRef.current);
			const requestId = ++fileSearchRequestRef.current;
			fileSearchTimerRef.current = setTimeout(async () => {
				const params = new URLSearchParams({
					q: trigger.query,
					limit: "15",
				});
				if (cwd) params.set("cwd", cwd);
				if (requestId !== fileSearchRequestRef.current) return;
				const data = await fetchJsonOr<{ results?: FileSearchResult[] }>(
					`/api/files/search?${params}`,
					{},
				);
				if (requestId === fileSearchRequestRef.current) {
					const next = data.results || [];
					setFileResults((prev) =>
						areFileResultsEqual(prev, next) ? prev : next,
					);
				}
			}, 150);
		},
		[cwd, enabled],
	);

	const selectCommand = useCallback(
		(idx: number) => {
			const cmd = filteredCommands[idx];
			if (!cmd) return;
			const cursorPos = textareaRef.current?.selectionStart ?? input.length;
			const { nextValue, nextCursor } = applyInlineCompletion(
				input,
				cursorPos,
				slashMenu.slashIndex,
				`/${cmd.name}`,
			);
			setInput(nextValue);
			setSlashMenu(hideMenuState);
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) return;
				textarea.focus();
				textarea.setSelectionRange(nextCursor, nextCursor);
			});
		},
		[filteredCommands, input, setInput, slashMenu.slashIndex, textareaRef],
	);

	const selectFile = useCallback(
		(idx: number) => {
			const file = fileResults[idx];
			if (!file) return;
			const cursorPos = textareaRef.current?.selectionStart ?? input.length;
			const { nextValue, nextCursor } = applyInlineCompletion(
				input,
				cursorPos,
				fileMenu.atIndex,
				`@${file.path}`,
			);
			setInput(nextValue);
			setFileMenu(hideMenuState);
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) return;
				textarea.focus();
				textarea.setSelectionRange(nextCursor, nextCursor);
			});
		},
		[fileMenu.atIndex, fileResults, input, setInput, textareaRef],
	);

	return {
		allCommands,
		fileMenu: visibleFileMenu,
		setFileMenu,
		fileResults,
		slashMenu: visibleSlashMenu,
		setSlashMenu,
		filteredCommands,
		showCommands,
		slashCommandNames,
		handleInputForFileMenu,
		handleInputForSlashMenu,
		selectCommand,
		selectFile,
	};
}
