import { useCallback, useMemo, useState } from "octane";
import type React from "react";
import { fetchJson, fetchJsonOr } from "../../../adapters/backend/http.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import { getAgentDefinition } from "../../agents/model/agents.ts";
import type { WorkspaceModelAgentKind as AgentKind } from "../../workspace/model/workspace-model.ts";
import type { SlashCommand } from "../model/agent-chat-shared.ts";
import {
	findTriggerAtCursor,
	hideMenuState,
} from "../model/agent-chat-shared.ts";

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
	const { data: allCommands } = useQueryResource(
		(signal) =>
			fetchJson<SlashCommand[]>(`/api/agent/commands?kind=${agentKind}`, {
				signal,
			}),
		getAgentDefinition(agentKind).commands,
		{ queryKey: ["skills", "commands", agentKind], enabled },
	);
	const { data: fileResults } = useQueryResource(
		async (signal) => {
			await new Promise((resolve) => setTimeout(resolve, 150));
			signal?.throwIfAborted();
			const params = new URLSearchParams({ q: fileMenu.query, limit: "15" });
			if (cwd) params.set("cwd", cwd);
			const data = await fetchJsonOr<{ results?: FileSearchResult[] }>(
				`/api/files/search?${params}`,
				{},
				{ signal },
			);
			return data.results ?? [];
		},
		[] as FileSearchResult[],
		{
			queryKey: ["file-completion", cwd ?? "", fileMenu.query],
			enabled: enabled && fileMenu.show,
			gcTime: 0,
		},
	);
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
				setFileMenu((prev) => (prev.show ? hideMenuState(prev) : prev));
				return;
			}

			setFileMenu((previous) => showCompletion(previous, "atIndex", trigger));
		},
		[enabled],
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
