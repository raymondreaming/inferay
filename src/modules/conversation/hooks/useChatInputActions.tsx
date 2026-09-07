import type { Accessor } from "solid-js";
import type { WorkspaceAgentKind } from "../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import type {
	Dispatch,
	RefCell,
	StateUpdate,
} from "../../../shared/lib/dom.tsx";
import {
	project as rustProject,
	wsClient,
} from "../../../shared/lib/native.tsx";
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
	setMenu: Dispatch<StateUpdate<S>>,
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
		if (prepared.optimistic) {
			const message = prepared.optimistic;
			_optionsValue.setMessages((previous) => [...previous, message]);
		}
		_optionsValue.onSendStart?.();
		wsClient.send(prepared.request);
		return true;
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
	const handleKeyDown = (e: KeyboardEvent) => {
		const _optionsValue3 = _options();
		if (
			_optionsValue3.fileMenu.show &&
			_optionsValue3.fileResults.length > 0 &&
			handleMenuKey(
				e,
				_optionsValue3.fileResults.length,
				_optionsValue3.setFileMenu,
				_optionsValue3.fileMenu.selectedIdx,
				_optionsValue3.selectFile,
			)
		)
			return;
		if (
			_optionsValue3.showCommands &&
			_optionsValue3.filteredCommands.length > 0 &&
			handleMenuKey(
				e,
				_optionsValue3.filteredCommands.length,
				_optionsValue3.setSlashMenu,
				_optionsValue3.slashMenu.selectedIdx,
				_optionsValue3.selectCommand,
			)
		)
			return;
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (e.repeat) return;
			sendMessage();
		}
	};
	return {
		get handleKeyDown() {
			return handleKeyDown;
		},
		get sendUserMessage() {
			return sendUserMessage;
		},
	};
}
