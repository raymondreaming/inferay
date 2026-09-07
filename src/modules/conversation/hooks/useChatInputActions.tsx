import { useCallback } from "octane";
import type React from "react";
import type { WorkspaceAgentKind } from "../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { wsClient } from "../../../adapters/backend/http.ts";
import { project as rustProject } from "../../../adapters/presentation/model.ts";
import {
	type ChatMessage,
	nextId,
} from "../components/AgentChatView/useChatConnection.tsx";
import type { useAgentChatComposerState } from "./useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "./useAgentChatMenus.tsx";
import { hideMenuState } from "./useAgentChatMenus.tsx";

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
		agentKind: WorkspaceAgentKind;
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
	const sendUserMessage = useCallback(
		({
			text,
			images = [],
			expandCommands = false,
		}: {
			text: string;
			images?: string[];
			expandCommands?: boolean;
		}) => {
			const prepared = rustProject<{
				request: Record<string, unknown>;
				optimistic: ChatMessage | null;
			} | null>("prepareChatSend", {
				text,
				images,
				expandCommands,
				id: nextId(),
				paneId,
				agentKind,
				cwd,
				referencePaths,
				isLoading,
			});
			if (!prepared) return false;
			if (prepared.optimistic) {
				const message = prepared.optimistic;
				setMessages((previous) => [...previous, message]);
			}
			onSendStart?.();
			wsClient.send(prepared.request);
			return true;
		},
		[
			agentKind,
			cwd,
			isLoading,
			onSendStart,
			paneId,
			referencePaths,
			setMessages,
		],
	);
	const sendMessage = useCallback(() => {
		if (
			!sendUserMessage({
				text: textareaRef.current?.value ?? input,
				images: attachedImages.map((image) => image.path),
				expandCommands: true,
			})
		)
			return;
		cancelSpeechListening();
		setInput("");
		setSlashMenu(hideMenuState);
		setFileMenu(hideMenuState);
		clearAttachedImages();
		if (textareaRef.current) {
			textareaRef.current.value = "";
			textareaRef.current.style.height = "20px";
		}
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
