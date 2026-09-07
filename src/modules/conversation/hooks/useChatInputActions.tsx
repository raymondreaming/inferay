import { useCallback } from "octane";
import type React from "react";
import { wsClient } from "../../../adapters/backend/http.ts";
import type { AgentKind } from "../../agents/model/agents.ts";
import {
	type AgentChatSharedChatMessage as ChatMessage,
	hideMenuState,
	localChatContent,
	nextId,
} from "../model/agent-chat-shared.ts";
import type { useAgentChatComposerState } from "./useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "./useAgentChatMenus.tsx";

type MenuState = {
	show: boolean;
	selectedIdx: number;
};
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
	attachedImages,
	cancelSpeechListening,
	clearAttachedImages,
	cwd,
	fileMenu,
	fileResults,
	filteredCommands,
	input,
	isLoading,
	onSendStart,
	paneId,
	referencePaths,
	selectCommand,
	selectFile,
	setFileMenu,
	setInput,
	setMessages,
	setSlashMenu,
	showCommands,
	slashMenu,
	textareaRef,
}: ReturnType<typeof useAgentChatComposerState> &
	ReturnType<typeof useAgentChatMenus> & {
		agentKind: AgentKind;
		cancelSpeechListening: () => void;
		cwd?: string;
		input: string;
		isLoading: boolean;
		onSendStart?: () => void;
		paneId: string;
		referencePaths?: string[];
		setInput: (value: string) => void;
		setMessages: (
			update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
		) => void;
		textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	}) {
	const sendToServer = useCallback(
		(
			text: string,
			displayText?: string,
			images?: string[],
			messageId?: string,
			command?: {
				expandCommands?: boolean;
				commandId?: string;
				commandArgs?: string;
			},
		) => {
			onSendStart?.();
			wsClient.send({
				type: "chat:send",
				messageId,
				...command,
				paneId,
				text,
				cwd,
				referencePaths,
				agentKind,
				displayText,
				images,
			});
		},
		[agentKind, cwd, isLoading, onSendStart, paneId, referencePaths],
	);
	const sendUserMessage = useCallback(
		({
			displayText,
			images,
			text,
			command,
		}: {
			displayText?: string;
			images?: string[];
			text: string;
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
				sendToServer(trimmed, visibleText, images, undefined, command);
				return;
			}
			const message = {
				id: nextId(),
				optimistic: true as const,
				role: "user" as const,
				content: localChatContent(visibleText),
				images,
			};
			setMessages((previous) => [...previous, message]);
			sendToServer(trimmed, visibleText, images, message.id, command);
		},
		[isLoading, sendToServer, setMessages],
	);
	const sendMessage = useCallback(() => {
		const rawInput = textareaRef.current?.value ?? input;
		const text = rawInput.trim();
		if (!text && attachedImages.length === 0) return;
		const images = attachedImages.length
			? attachedImages.map((image) => image.path)
			: undefined;
		cancelSpeechListening();
		setInput("");
		setSlashMenu(hideMenuState);
		setFileMenu(hideMenuState);
		clearAttachedImages();
		if (textareaRef.current) {
			textareaRef.current.value = "";
			textareaRef.current.style.height = "20px";
		}
		sendUserMessage({
			displayText:
				text || `Attached image${attachedImages.length > 1 ? "s" : ""}`,
			images,
			text,
			command: {
				expandCommands: true,
			},
		});
	}, [
		attachedImages,
		cancelSpeechListening,
		clearAttachedImages,
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
			}
		},
		[
			fileMenu,
			fileResults.length,
			filteredCommands.length,
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
