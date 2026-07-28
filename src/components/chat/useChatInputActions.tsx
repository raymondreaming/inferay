import { useCallback, useEffect, useRef } from "octane";
import type React from "react";
import type { AgentKind } from "../../features/agent/agent-utils.ts";
import {
	appendTrimmedMessage,
	type ChatLoadingState,
	type ChatMessage,
	nextId,
	type SlashCommand,
	trimMessages,
} from "../../features/chat/agent-chat-shared.ts";
import {
	clearAgentChatPaneState,
	clearPendingSend,
	loadPendingSend,
	loadStoredSessionId,
} from "../../features/chat/chat-session-store.ts";
import { serializeCommandSystemMessage } from "../../features/chat/command-system-message.ts";
import { noop } from "../../lib/data.ts";
import { wsClient } from "../../lib/websocket.ts";
import { hideMenuState } from "./chat-agent-utils.ts";
import {
	expandInlineCommandPrompts,
	getCommandDisplayText,
	getCommandPrompt,
} from "./chat-command-utils.ts";
import { appendSystemMessage } from "./chat-state-utils.ts";
import type {
	FileMenuState,
	FileSearchResult,
	SlashMenuState,
} from "./useAgentChatMenus.tsx";

type MenuState = { show: boolean; selectedIdx: number };
type AttachedImage = { path: string };
type ChatWorkspaceOverride = { cwd?: string; referencePaths?: string[] };

function handleMenuKey<S extends MenuState>(
	e: KeyboardEvent,
	count: number,
	setMenu: React.Dispatch<React.SetStateAction<S>>,
	selectIdx: number,
	onSelect: (idx: number) => void
) {
	const delta = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
	if (delta) {
		e.preventDefault();
		setMenu((prev) => ({
			...prev,
			selectedIdx: (prev.selectedIdx + delta + count) % count,
		}));
		return true;
	}
	if (e.key !== "Tab" && (e.key !== "Enter" || e.shiftKey)) {
		if (e.key !== "Escape") return false;
		setMenu(hideMenuState);
	} else {
		onSelect(selectIdx);
	}
	e.preventDefault();
	return true;
}

export function useChatInputActions({
	agentKind,
	allCommands,
	attachedImages,
	cancelSpeechListening,
	clearAttachedImages,
	clearCheckpoints,
	composerOnly,
	consumePendingWorkspace,
	cwd,
	effectiveSelectedModel,
	enabled = true,
	fileMenu,
	fileResults,
	filteredCommands,
	incrementUsage,
	input,
	isLoading,
	onSendStart,
	onExitComposerOnly,
	paneId,
	referencePaths,
	selectCommand,
	selectFile,
	selectedReasoningLevel,
	setFileMenu,
	setInput,
	setMessages,
	setRunStatus,
	setSlashMenu,
	showCommands,
	slashMenu,
	textareaRef,
}: {
	agentKind: AgentKind;
	allCommands: SlashCommand[];
	attachedImages: AttachedImage[];
	cancelSpeechListening: () => void;
	clearAttachedImages: () => void;
	clearCheckpoints: () => void;
	composerOnly: boolean;
	consumePendingWorkspace: () => ChatWorkspaceOverride | undefined;
	cwd?: string;
	effectiveSelectedModel: string;
	enabled?: boolean;
	fileMenu: FileMenuState;
	fileResults: FileSearchResult[];
	filteredCommands: SlashCommand[];
	incrementUsage: (id: string) => Promise<unknown>;
	input: string;
	isLoading: boolean;
	onSendStart?: () => void;
	onExitComposerOnly?: () => void;
	paneId: string;
	referencePaths?: string[];
	selectCommand: (idx: number) => void;
	selectFile: (idx: number) => void;
	selectedReasoningLevel: string;
	setFileMenu: React.Dispatch<React.SetStateAction<FileMenuState>>;
	setInput: (value: string) => void;
	setMessages: (
		update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
	) => void;
	setRunStatus: (
		state: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState)
	) => void;
	setSlashMenu: React.Dispatch<React.SetStateAction<SlashMenuState>>;
	showCommands: boolean;
	slashMenu: SlashMenuState;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
	const pendingSendConsumedRef = useRef(false);

	const appendLocalMessage = useCallback(
		(message: Pick<ChatMessage, "role" | "content" | "images">) => {
			setMessages((prev) =>
				trimMessages([
					...prev,
					{
						id: nextId(),
						role: message.role,
						content: message.content,
						images: message.images,
					},
				])
			);
		},
		[setMessages]
	);

	const sendToServer = useCallback(
		(
			text: string,
			workspaceOverride?: ChatWorkspaceOverride,
			displayText?: string,
			images?: string[]
		) => {
			onSendStart?.();
			setRunStatus({
				isLoading: true,
				status: "thinking",
				startTime: Date.now(),
			});

			wsClient.send({
				type: "chat:send",
				paneId,
				text,
				cwd: workspaceOverride?.cwd ?? cwd,
				referencePaths: workspaceOverride?.referencePaths ?? referencePaths,
				sessionId: loadStoredSessionId(paneId),
				agentKind,
				model: effectiveSelectedModel,
				reasoningLevel:
					agentKind === "codex" ? selectedReasoningLevel : undefined,
				displayText,
				images,
			});
		},
		[
			agentKind,
			cwd,
			effectiveSelectedModel,
			onSendStart,
			paneId,
			referencePaths,
			selectedReasoningLevel,
			setRunStatus,
		]
	);

	const sendUserMessage = useCallback(
		({
			displayText,
			images,
			systemMessage,
			text,
			workspaceOverride,
		}: {
			displayText?: string;
			images?: string[];
			systemMessage?: string;
			text: string;
			workspaceOverride?: ChatWorkspaceOverride;
		}) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			const visibleText = displayText ?? trimmed;
			if (isLoading) {
				sendToServer(trimmed, workspaceOverride, visibleText, images);
				return;
			}
			appendLocalMessage({ role: "user", content: visibleText, images });
			if (systemMessage) {
				setMessages((prev) => appendSystemMessage(prev, systemMessage));
			}
			sendToServer(trimmed, workspaceOverride, visibleText, images);
		},
		[appendLocalMessage, isLoading, sendToServer, setMessages]
	);

	const executeCommand = useCallback(
		(cmd: SlashCommand, args?: string) => {
			setInput("");
			if (cmd.name === "btw") {
				const question = (args || "").trim();
				setMessages(
					question
						? appendTrimmedMessage.bind(null, {
								id: nextId(),
								role: "user",
								content: `/btw ${question}`,
							})
						: (prev) => appendSystemMessage(prev, "Usage: /btw <question>")
				);
				if (question)
					wsClient.send({
						type: "chat:btw",
						paneId,
						text: question,
						cwd,
					});
				return;
			}

			if (cmd.action === "local") {
				if (cmd.name === "clear") {
					setMessages([]);
					clearAgentChatPaneState(paneId);
					clearCheckpoints();
					setMessages((prev) => appendSystemMessage(prev, "Chat cleared"));
				} else if (cmd.name === "help") {
					setMessages((prev) =>
						appendSystemMessage(
							prev,
							allCommands
								.map((command) => `/${command.name} - ${command.description}`)
								.join("\n")
						)
					);
				}
				return;
			}

			const prompt = getCommandPrompt(cmd, args);
			const displayText = getCommandDisplayText(cmd, args);
			if (cmd.id) incrementUsage(cmd.id).catch(noop);
			sendUserMessage({
				displayText,
				systemMessage: serializeCommandSystemMessage({
					type: "inferay.command",
					name: cmd.name,
					description: cmd.description,
					args: args?.trim() || undefined,
				}),
				text: prompt,
			});
		},
		[
			allCommands,
			clearCheckpoints,
			cwd,
			incrementUsage,
			paneId,
			sendUserMessage,
			setInput,
			setMessages,
		]
	);

	const sendMessage = useCallback(() => {
		const rawInput = textareaRef.current?.value ?? input;
		const text = rawInput.trim();
		if (!text && attachedImages.length === 0) return;
		cancelSpeechListening();
		if (text.startsWith("/") && !text.includes(" ")) {
			const cmd = allCommands.find(
				(command) => command.name.toLowerCase() === text.slice(1).toLowerCase()
			);
			if (cmd) {
				executeCommand(cmd);
				return;
			}
		}

		const imagePaths = attachedImages.map((image) => image.path);
		const { expandedText, usedCommandIds } = expandInlineCommandPrompts(
			text,
			allCommands
		);
		usedCommandIds.forEach((id) => {
			incrementUsage(id).catch(noop);
		});
		const displayText =
			text || `Attached image${attachedImages.length > 1 ? "s" : ""}`;
		const fullText =
			imagePaths.length > 0
				? `${expandedText}${expandedText ? "\n\n" : ""}Here are the images at these paths:\n${imagePaths.join("\n")}`
				: expandedText;

		setInput("");
		setSlashMenu(hideMenuState);
		setFileMenu(hideMenuState);
		clearAttachedImages();
		if (textareaRef.current) {
			textareaRef.current.value = "";
			textareaRef.current.style.height = "20px";
		}
		sendUserMessage({
			displayText,
			images: imagePaths.length > 0 ? imagePaths : undefined,
			text: fullText,
			workspaceOverride: consumePendingWorkspace(),
		});
	}, [
		allCommands,
		attachedImages,
		cancelSpeechListening,
		clearAttachedImages,
		consumePendingWorkspace,
		executeCommand,
		incrementUsage,
		input,
		sendUserMessage,
		setFileMenu,
		setInput,
		setSlashMenu,
		textareaRef,
	]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (
				fileMenu.show &&
				fileResults.length > 0 &&
				handleMenuKey(
					e,
					fileResults.length,
					setFileMenu,
					fileMenu.selectedIdx,
					selectFile
				)
			)
				return;
			if (
				showCommands &&
				filteredCommands.length > 0 &&
				handleMenuKey(
					e,
					filteredCommands.length,
					setSlashMenu,
					slashMenu.selectedIdx,
					selectCommand
				)
			)
				return;
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			} else if (composerOnly && e.key === "Escape") {
				e.preventDefault();
				onExitComposerOnly?.();
			}
		},
		[
			composerOnly,
			fileMenu,
			fileResults.length,
			filteredCommands.length,
			onExitComposerOnly,
			selectCommand,
			selectFile,
			sendMessage,
			setFileMenu,
			setSlashMenu,
			showCommands,
			slashMenu.selectedIdx,
		]
	);

	useEffect(() => {
		if (!enabled || pendingSendConsumedRef.current || isLoading) return;
		const pending = loadPendingSend(paneId).trim();
		if (!pending) return;
		pendingSendConsumedRef.current = true;
		clearPendingSend(paneId);
		setInput("");
		setMessages((prev) =>
			trimMessages([...prev, { id: nextId(), role: "user", content: pending }])
		);
		sendToServer(pending);
	}, [enabled, isLoading, paneId, sendToServer, setInput, setMessages]);

	return {
		handleKeyDown,
		sendUserMessage,
	};
}
