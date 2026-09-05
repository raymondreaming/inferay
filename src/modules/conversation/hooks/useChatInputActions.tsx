import { useCallback } from "octane";
import type React from "react";
import { wsClient } from "../../../adapters/backend/websocket.ts";
import {
	appendTrimmedMessage,
	type ChatLoadingState,
	type ChatMessage,
	type CommandSystemMessage,
	nextId,
	type SlashCommand,
	trimMessages,
} from "../../../modules/conversation/model/agent-chat-shared.ts";
import {
	clearAgentChatPaneState,
	clearProviderSessionId,
	getProviderSessionId,
} from "../../../modules/conversation/model/chat-session-store.ts";
import type { AgentKind } from "../../../modules/workspace/model/workspace-model.ts";
import { hideMenuState } from "../model/chat-agent-utils.ts";
import { appendSystemMessage } from "../model/chat-state-utils.ts";
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
	onSelect: (idx: number) => void,
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
	fileMenu,
	fileResults,
	filteredCommands,
	input,
	isLoading,
	onSendStart,
	onExit,
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
	fileMenu: FileMenuState;
	fileResults: FileSearchResult[];
	filteredCommands: SlashCommand[];
	input: string;
	isLoading: boolean;
	onSendStart?: () => void;
	onExit?: () => void;
	onExitComposerOnly?: () => void;
	paneId: string;
	referencePaths?: string[];
	selectCommand: (idx: number) => void;
	selectFile: (idx: number) => void;
	selectedReasoningLevel: string;
	setFileMenu: React.Dispatch<React.SetStateAction<FileMenuState>>;
	setInput: (value: string) => void;
	setMessages: (
		update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
	) => void;
	setRunStatus: (
		state: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState),
	) => void;
	setSlashMenu: React.Dispatch<React.SetStateAction<SlashMenuState>>;
	showCommands: boolean;
	slashMenu: SlashMenuState;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
	const appendLocalMessage = useCallback(
		(message: Pick<ChatMessage, "role" | "content" | "images">) => {
			const id = nextId();
			setMessages((prev) =>
				trimMessages([
					...prev,
					{
						id,
						optimistic: true,
						role: message.role,
						content: message.content,
						images: message.images,
					},
				]),
			);
			return id;
		},
		[setMessages],
	);

	const sendToServer = useCallback(
		(
			text: string,
			workspaceOverride?: ChatWorkspaceOverride,
			displayText?: string,
			images?: string[],
			messageId?: string,
			command?: {
				expandCommands?: boolean;
				commandId?: string;
				commandArgs?: string;
			},
		) => {
			if (!isLoading) {
				onSendStart?.();
				setRunStatus({
					isLoading: true,
					status: "thinking",
					startTime: Date.now(),
				});
			}

			wsClient.send({
				type: "chat:send",
				messageId,
				...command,
				paneId,
				text,
				cwd: workspaceOverride?.cwd ?? cwd,
				referencePaths: workspaceOverride?.referencePaths ?? referencePaths,
				sessionId: getProviderSessionId(paneId),
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
			isLoading,
			onSendStart,
			paneId,
			referencePaths,
			selectedReasoningLevel,
			setRunStatus,
		],
	);

	const sendUserMessage = useCallback(
		({
			displayText,
			images,
			systemMessage,
			text,
			workspaceOverride,
			command,
		}: {
			displayText?: string;
			images?: string[];
			systemMessage?: CommandSystemMessage;
			text: string;
			workspaceOverride?: ChatWorkspaceOverride;
			command?: {
				expandCommands?: boolean;
				commandId?: string;
				commandArgs?: string;
			};
		}) => {
			const trimmed = text.trim();
			if (!trimmed && !images?.length) return;
			const visibleText = displayText ?? trimmed;
			if (isLoading) {
				sendToServer(
					trimmed,
					workspaceOverride,
					visibleText,
					images,
					undefined,
					command,
				);
				return;
			}
			const messageId = appendLocalMessage({
				role: "user",
				content: visibleText,
				images,
			});
			if (systemMessage) {
				setMessages((prev) =>
					appendSystemMessage(prev, JSON.stringify(systemMessage), {
						version: 1,
						kind: "message",
						groupId: nextId(),
						hidden: false,
						toolInput: null,
						command: systemMessage,
					}),
				);
			}
			sendToServer(
				trimmed,
				workspaceOverride,
				visibleText,
				images,
				messageId,
				command,
			);
		},
		[appendLocalMessage, isLoading, sendToServer, setMessages],
	);

	const executeCommand = useCallback(
		(cmd: SlashCommand, args?: string) => {
			setInput("");
			if (textareaRef.current) textareaRef.current.value = "";
			if (cmd.name === "btw") {
				const question = (args || "").trim();
				setMessages(
					question
						? appendTrimmedMessage.bind(null, {
								id: nextId(),
								role: "user",
								content: `/btw ${question}`,
							})
						: (prev) => appendSystemMessage(prev, "Usage: /btw <question>"),
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
				if (cmd.name === "exit") {
					onExit?.();
				} else if (cmd.name === "clear") {
					wsClient.send({ type: "chat:destroy", paneId });
					clearProviderSessionId(paneId);
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
								.join("\n"),
						),
					);
				}
				return;
			}

			const displayText = `/${cmd.name}${args ? ` ${args}` : ""}`;
			sendUserMessage({
				displayText,
				systemMessage: {
					type: "inferay.command",
					name: cmd.name,
					description: cmd.description,
					args: args?.trim() || undefined,
				},
				text: displayText,
				command: cmd.id
					? { expandCommands: true, commandId: cmd.id, commandArgs: args }
					: undefined,
			});
		},
		[
			allCommands,
			clearCheckpoints,
			cwd,
			onExit,
			paneId,
			sendUserMessage,
			setInput,
			setMessages,
			textareaRef,
		],
	);

	const sendMessage = useCallback(() => {
		const rawInput = textareaRef.current?.value ?? input;
		const text = rawInput.trim();
		if (!text && attachedImages.length === 0) return;
		cancelSpeechListening();
		if (text.startsWith("/") && !text.includes(" ")) {
			const cmd = allCommands.find(
				(command) => command.name.toLowerCase() === text.slice(1).toLowerCase(),
			);
			if (cmd) {
				executeCommand(cmd);
				return;
			}
		}

		const imagePaths = attachedImages.map((image) => image.path);
		const displayText =
			text || `Attached image${attachedImages.length > 1 ? "s" : ""}`;

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
			text,
			command: { expandCommands: true },
			workspaceOverride: consumePendingWorkspace(),
		});
	}, [
		allCommands,
		attachedImages,
		cancelSpeechListening,
		clearAttachedImages,
		consumePendingWorkspace,
		executeCommand,
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
					selectFile,
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
					selectCommand,
				)
			)
				return;
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				if (e.repeat) return;
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
		],
	);

	return {
		handleKeyDown,
		sendUserMessage,
	};
}
