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
	previous: FileSearchResult[],
	next: FileSearchResult[],
) {
	return (
		previous.length === next.length &&
		previous.every((file, index) => {
			const other = next[index]!;
			return (
				file.name === other.name &&
				file.path === other.path &&
				file.isDir === other.isDir
			);
		})
	);
}

function showCompletion<Key extends "atIndex" | "slashIndex">(
	previous: { show: boolean; selectedIdx: number; query: string } & Record<
		Key,
		number
	>,
	key: Key,
	trigger: { index: number; query: string },
) {
	return previous.show &&
		previous.selectedIdx === 0 &&
		previous.query === trigger.query &&
		previous[key] === trigger.index
		? previous
		: {
				...previous,
				show: true,
				selectedIdx: 0,
				query: trigger.query,
				[key]: trigger.index,
			};
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

	const filteredCommands = useMemo(() => {
		if (!slashMenu.show || slashMenu.slashIndex === -1) {
			return [] as SlashCommand[];
		}
		const query = slashMenu.query.toLowerCase();
		return allCommands.filter((cmd) =>
			cmd.name.toLowerCase().startsWith(query),
		);
	}, [allCommands, slashMenu.query, slashMenu.show, slashMenu.slashIndex]);

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

			setSlashMenu((previous) =>
				showCompletion(previous, "slashIndex", trigger),
			);
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

			setFileMenu((previous) => showCompletion(previous, "atIndex", trigger));

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

	const complete = useCallback(
		(index: number, replacement: string, hide: () => void) => {
			const cursor = textareaRef.current?.selectionStart ?? input.length;
			const { nextValue, nextCursor } = applyInlineCompletion(
				input,
				cursor,
				index,
				replacement,
			);
			setInput(nextValue);
			hide();
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) return;
				textarea.focus();
				textarea.setSelectionRange(nextCursor, nextCursor);
			});
		},
		[input, setInput, textareaRef],
	);
	const selectCommand = useCallback(
		(index: number) => {
			const command = filteredCommands[index];
			if (command)
				complete(slashMenu.slashIndex, `/${command.name}`, () =>
					setSlashMenu(hideMenuState),
				);
		},
		[complete, filteredCommands, slashMenu.slashIndex],
	);
	const selectFile = useCallback(
		(index: number) => {
			const file = fileResults[index];
			if (file)
				complete(fileMenu.atIndex, `@${file.path}`, () =>
					setFileMenu(hideMenuState),
				);
		},
		[complete, fileResults, fileMenu.atIndex],
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
