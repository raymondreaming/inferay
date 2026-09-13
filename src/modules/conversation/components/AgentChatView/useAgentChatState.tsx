import { bindImperativeRef } from "@shared/lib/dom.tsx";
import { loadDefaultChatSettings, wsClient } from "@shared/lib/native.tsx";
import { createMemo, merge } from "solid-js";
import {
	useAgentChatComposerState,
	usePendingChatWorkspace,
} from "../../hooks/useAgentChatComposerState.tsx";
import {
	useAgentChatMenus,
	useAgentChatSettings,
} from "../../hooks/useAgentChatMenus.tsx";
import { useChatDraft } from "../../hooks/useChatDraft.tsx";
import { useChatInputActions } from "../../hooks/useChatInputActions.tsx";
import { useSpeechToText } from "../../hooks/useSpeechToText.tsx";
import { useChatViewport } from "../ChatMessageList/useChatViewport.tsx";
import type { AgentChatViewProps } from "./types.ts";
import {
	appendSystemMessage,
	useChatConnection,
} from "./useChatConnection.tsx";
import { useComposerHighlight } from "./useComposerHighlight.ts";

/** Pane-owned state survives context/composer DOM replacement. Inputs read by field. */
export function useAgentChatState(props: AgentChatViewProps) {
	const visible = createMemo(() => props.isVisible ?? true);
	const agentKind = createMemo(
		() => props.agentKind ?? loadDefaultChatSettings().agentKind,
	);
	const settings = useAgentChatSettings(() => props.paneId, agentKind);
	const workspace = usePendingChatWorkspace(
		() => props.paneId,
		() => props.cwd,
		() => props.pendingWorkspacePaths,
	);
	const { input, setInput } = useChatDraft(() => props.paneId);
	const speechOptions = {
		get enabled() {
			return visible();
		},
		get value() {
			return input();
		},
		onChange: setInput,
	};
	const speech = useSpeechToText(() => speechOptions);
	const viewport = useChatViewport(
		() => props.isSelected,
		visible,
		() => props.paneId,
	);
	const highlight = useComposerHighlight(() => props.isSelected !== false);
	const composer = useAgentChatComposerState(() => props.paneId, visible);
	const menuOptions = {
		get agentKind() {
			return agentKind();
		},
		get cwd() {
			return props.cwd;
		},
		get enabled() {
			return visible();
		},
		get input() {
			return input();
		},
		setInput,
		textareaRef: viewport.textareaRef,
	};
	const menus = useAgentChatMenus(() => menuOptions);
	const connectionOptions = {
		get agentKind() {
			return agentKind();
		},
		get cwd() {
			return props.cwd;
		},
		get visible() {
			return visible();
		},
		get paneId() {
			return props.paneId;
		},
		onExit: () => props.onClose?.(props.paneId),
		replaceQueuedMessages: composer.replaceQueuedMessages,
		resolveSteeringMessage: composer.resolveSteeringMessage,
		stageSteeringMessage: composer.stageSteeringMessage,
	};
	const connection = useChatConnection(() => connectionOptions);
	const actionOptions = merge(composer, menus, {
		get agentKind() {
			return agentKind();
		},
		get cwd() {
			return props.cwd;
		},
		get paneId() {
			return props.paneId;
		},
		get referencePaths() {
			return props.referencePaths;
		},
		get input() {
			return input();
		},
		get isLoading() {
			return connection.chatUiState.isLoading;
		},
		cancelSpeechListening: speech.cancelListening,
		onRunStart: connection.beginRun,
		onSendError: connection.failSend,
		onSendStart: () => viewport.scheduleScrollToBottom("auto"),
		setInput,
		setMessages: connection.setMessages,
		textareaRef: viewport.textareaRef,
	});
	const inputActions = useChatInputActions(() => actionOptions);
	const voiceInput = {
		get error() {
			return speech.error;
		},
		get isListening() {
			return speech.isListening;
		},
		get isSupported() {
			return speech.isSupported;
		},
		onToggleListening: speech.toggleListening,
	};
	const stopGeneration = () => {
		wsClient.send({ type: "chat:stop", paneId: props.paneId });
		connection.setRunStatus({
			isLoading: false,
			status: "idle",
			startTime: null,
		});
		connection.setMessages((previous) =>
			appendSystemMessage(previous, "Generation stopped"),
		);
		viewport.scheduleScrollToBottom("auto");
	};
	const toggleTool = (id: string) =>
		connection.setExpandedTools((previous) => {
			const next = new Set(previous);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	bindImperativeRef(
		() => props.ref,
		() => ({
			focusInput: (atEnd?: boolean) => {
				const element = viewport.textareaRef.current;
				if (!element) return;
				element.focus();
				if (atEnd)
					element.setSelectionRange(element.value.length, element.value.length);
			},
			highlightComposer: highlight.highlight,
		}),
	);
	return {
		visible,
		agentKind,
		settings,
		workspace,
		input,
		setInput,
		viewport,
		highlight,
		composer,
		menus,
		connection,
		inputActions,
		voiceInput,
		stopGeneration,
		toggleTool,
		sendMessage: (text: string) => inputActions.sendUserMessage({ text }),
	};
}
export type AgentChatState = ReturnType<typeof useAgentChatState>;
