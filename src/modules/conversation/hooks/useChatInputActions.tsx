import type {
	ChatKeyAction,
	CompletionMenuState,
	WorkspaceAgentKind,
} from "@contracts";
import type { RefCell } from "@shared/lib/dom.tsx";
import { project as rustProject, wsClient } from "@shared/lib/native.tsx";
import type { Accessor } from "solid-js";
import type { ChatMessage } from "../components/AgentChatView/useChatConnection.tsx";
import { nextId } from "../components/AgentChatView/useChatConnection.tsx";
import type { useAgentChatComposerState } from "./useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "./useAgentChatMenus.tsx";
import { hideMenuState } from "./useAgentChatMenus.tsx";

export function useChatInputActions(
	_options: Accessor<
		ReturnType<typeof useAgentChatComposerState> &
			ReturnType<typeof useAgentChatMenus> & {
				agentKind: WorkspaceAgentKind;
				cancelSpeechListening: () => void;
				cwd?: string;
				input: string;
				isLoading: boolean;
				onSendStart?: () => void;
				onRunStart?: () => void;
				onSendError?: (error: unknown, messageId?: string) => void;
				paneId: string;
				referencePaths?: string[];
				setInput: (value: string) => void;
				setMessages: (
					update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
				) => void;
				textareaRef: RefCell<HTMLTextAreaElement | null>;
			}
	>,
) {
	const sendUserMessage = ({
		text,
		images = [],
		expandCommands = false,
	}: {
		text: string;
		images?: string[];
		expandCommands?: boolean;
	}) => {
		const _optionsValue = _options();
		const prepared = rustProject<{
			request: Record<string, unknown>;
			optimistic: ChatMessage | null;
			startsRun: boolean;
		} | null>("prepareChatSend", {
			text,
			images,
			expandCommands,
			id: nextId(),
			paneId: _optionsValue.paneId,
			agentKind: _optionsValue.agentKind,
			cwd: _optionsValue.cwd,
			referencePaths: _optionsValue.referencePaths,
			isLoading: _optionsValue.isLoading,
		});
		if (!prepared) return false;
		if (prepared.startsRun) _optionsValue.onRunStart?.();
		if (prepared.optimistic) {
			const message = prepared.optimistic;
			_optionsValue.setMessages((previous) => [...previous, message]);
		}
		_optionsValue.onSendStart?.();
		try {
			wsClient.send(prepared.request);
			return true;
		} catch (error) {
			_optionsValue.onSendError?.(error, prepared.optimistic?.id);
			return false;
		}
	};
	const sendMessage = () => {
		const _optionsValue2 = _options();
		if (
			!sendUserMessage({
				text: _optionsValue2.textareaRef.current?.value ?? _optionsValue2.input,
				images: _optionsValue2.attachedImages.map((image) => image.path),
				expandCommands: true,
			})
		)
			return;
		_optionsValue2.cancelSpeechListening();
		_optionsValue2.setInput("");
		_optionsValue2.setSlashMenu(hideMenuState);
		_optionsValue2.setFileMenu(hideMenuState);
		_optionsValue2.clearAttachedImages();
		if (_optionsValue2.textareaRef.current) {
			_optionsValue2.textareaRef.current.value = "";
			_optionsValue2.textareaRef.current.style.height = "20px";
		}
	};
	const handleKeyDown = (event: KeyboardEvent) => {
		const options = _options();
		const action = rustProject<ChatKeyAction | null>("chatInputKey", {
			key: event.key,
			composing: event.isComposing,
			keyCode: event.keyCode,
			shift: event.shiftKey,
			repeat: event.repeat,
			file: options.fileMenu,
			files: options.fileResults.length,
			command: options.slashMenu,
			commands: options.filteredCommands.length,
		});
		if (!action) return;
		event.preventDefault();
		if (action.type === "send") sendMessage();
		else if (action.type === "select")
			(action.menu === "file" ? options.selectFile : options.selectCommand)(
				action.index,
			);
		else if (action.type === "move" || action.type === "hide") {
			const setMenu =
				action.menu === "file" ? options.setFileMenu : options.setSlashMenu;
			setMenu((state) =>
				action.type === "hide"
					? hideMenuState(state)
					: rustProject<CompletionMenuState>("completionMenuStep", {
							state,
							count: action.count,
							delta: action.delta,
						}),
			);
		}
	};

	return {
		handleKeyDown,
		sendUserMessage,
	};
}
