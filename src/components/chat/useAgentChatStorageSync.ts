import { useEffect, type RefObject } from "react";
import type {
	ChatMessage,
	ComposerContextBlock,
} from "../../features/chat/agent-chat-shared.ts";
import { trimMessages } from "../../features/chat/agent-chat-shared.ts";
import {
	loadStoredComposerContextBlocks,
	loadStoredInput,
	loadStoredLoadingState,
	loadStoredMessages,
	loadStoredModel,
	loadStoredReasoningLevel,
	loadStoredSummary,
} from "../../features/chat/chat-session-store.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import {
	CHAT_COMPOSER_CONTEXT_KEY_PREFIX,
	CHAT_INPUT_KEY_PREFIX,
	CHAT_LOADING_STATE_KEY_PREFIX,
	CHAT_MESSAGES_STORAGE_KEY_PREFIX,
	CHAT_MODEL_KEY_PREFIX,
	CHAT_REASONING_KEY_PREFIX,
	CHAT_SUMMARY_KEY_PREFIX,
} from "../../lib/client-storage-keys.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { mergeSyncedMessages } from "./chat-state-utils.ts";
import type { LoadingState } from "./useAgentChatUiState.ts";

export function useAgentChatStorageSync({
	paneId,
	textareaRef,
	messagesRef,
	summaryRef,
	selectedModelRef,
	selectedReasoningLevelRef,
	setMessagesRaw,
	setInputRaw,
	setLoadingState,
	setSelectedModel,
	setSelectedReasoningLevel,
	setComposerContextBlocks,
}: {
	paneId: string;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	messagesRef: RefObject<ChatMessage[]>;
	summaryRef: RefObject<string | null>;
	selectedModelRef: RefObject<string>;
	selectedReasoningLevelRef: RefObject<string>;
	setMessagesRaw: (
		update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
	) => void;
	setInputRaw: (value: string) => void;
	setLoadingState: (
		value: LoadingState | ((prev: LoadingState) => LoadingState)
	) => void;
	setSelectedModel: (value: string) => void;
	setSelectedReasoningLevel: (value: string) => void;
	setComposerContextBlocks: (value: ComposerContextBlock[]) => void;
}) {
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const detail = (
					event as CustomEvent<{ key?: string; value?: string | null }>
				).detail;
				const key = detail?.key;
				if (!key) return;

				if (key === `${CHAT_MESSAGES_STORAGE_KEY_PREFIX}${paneId}`) {
					const storedMessages = loadStoredMessages<ChatMessage>(paneId);
					setMessagesRaw((prev) => {
						const next = trimMessages(
							mergeSyncedMessages(prev, storedMessages)
						);
						messagesRef.current = next;
						return next;
					});
					return;
				}

				if (
					key === `${CHAT_INPUT_KEY_PREFIX}${paneId}` &&
					document.activeElement !== textareaRef.current
				) {
					setInputRaw(loadStoredInput(paneId));
					return;
				}

				if (key === `${CHAT_LOADING_STATE_KEY_PREFIX}${paneId}`) {
					const storedLoading = loadStoredLoadingState(paneId);
					setLoadingState(
						storedLoading ?? {
							isLoading: false,
							status: "idle",
							startTime: null,
						}
					);
					return;
				}

				if (key === `${CHAT_MODEL_KEY_PREFIX}${paneId}`) {
					const storedModel = loadStoredModel(paneId);
					if (storedModel) {
						selectedModelRef.current = storedModel;
						setSelectedModel(storedModel);
					}
					return;
				}

				if (key === `${CHAT_REASONING_KEY_PREFIX}${paneId}`) {
					const storedReasoning = loadStoredReasoningLevel(paneId);
					if (storedReasoning) {
						selectedReasoningLevelRef.current = storedReasoning;
						setSelectedReasoningLevel(storedReasoning);
					}
					return;
				}

				if (key === `${CHAT_SUMMARY_KEY_PREFIX}${paneId}`) {
					summaryRef.current = loadStoredSummary(paneId);
					return;
				}

				if (key === `${CHAT_COMPOSER_CONTEXT_KEY_PREFIX}${paneId}`) {
					setComposerContextBlocks(
						loadStoredComposerContextBlocks<ComposerContextBlock>(paneId)
					);
				}
			}),
		[
			messagesRef,
			paneId,
			selectedModelRef,
			selectedReasoningLevelRef,
			setComposerContextBlocks,
			setInputRaw,
			setLoadingState,
			setMessagesRaw,
			setSelectedModel,
			setSelectedReasoningLevel,
			summaryRef,
			textareaRef,
		]
	);
}
