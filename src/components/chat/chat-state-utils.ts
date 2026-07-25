import {
	appendBoundedChatContent,
	type ChatMessage,
	compactAdjacentDuplicateTranscriptMessages,
	nextId,
	trimMessages,
	truncateChatContent,
} from "../../features/chat/agent-chat-shared.ts";
import { hasRole } from "../../lib/data.ts";

type ChatStateMessage = Pick<
	ChatMessage,
	"id" | "role" | "content" | "parts" | "isStreaming"
>;

const CHAT_RENDER_CHAR_WINDOW = 500_000;
const CHAT_RENDER_MIN_MESSAGES = 30;
const CHAT_RENDER_MAX_MESSAGES = 2_000;

export interface ChatSyncReconcileInput {
	currentMessages: ChatMessage[];
	isStreaming: boolean;
	previousRevision: number | null;
	revision: number | null;
	serverMessages: ChatMessage[];
}

export interface ChatSyncReconcileResult {
	mergedMessages: ChatMessage[];
	nextRevision: number | null;
	serverMessages: ChatMessage[];
	shouldPersist: boolean;
	shouldSkip: boolean;
	shouldUpdateMessages: boolean;
	streamingAssistantId: string | null;
	streamingToolId: string | null;
}

export function windowChatMessagesForRender<T extends { content: string }>(
	messages: T[]
): T[] {
	if (messages.length <= CHAT_RENDER_MIN_MESSAGES) return messages;
	let totalChars = 0;
	let start = messages.length;
	while (start > 0) {
		const next = messages[start - 1]!;
		const nextTotal = totalChars + next.content.length;
		const selectedCount = messages.length - start;
		if (
			selectedCount >= CHAT_RENDER_MIN_MESSAGES &&
			(nextTotal > CHAT_RENDER_CHAR_WINDOW ||
				selectedCount >= CHAT_RENDER_MAX_MESSAGES)
		) {
			break;
		}
		totalChars = nextTotal;
		start--;
	}
	return start <= 0 ? messages : messages.slice(start);
}

function dedupeChatMessagesById<T extends { id: string }>(messages: T[]): T[] {
	let hasDuplicate = false;
	const seen = new Set<string>();
	for (const message of messages) {
		if (seen.has(message.id)) {
			hasDuplicate = true;
			break;
		}
		seen.add(message.id);
	}
	if (!hasDuplicate) return messages;

	const byId = new Map<string, T>();
	for (const message of messages) {
		if (byId.has(message.id)) byId.delete(message.id);
		byId.set(message.id, message);
	}
	return [...byId.values()];
}

export function mergeSyncedMessages(
	localMessages: ChatMessage[],
	serverMessages: ChatMessage[]
): ChatMessage[] {
	const localUserMsgs = localMessages.filter(hasRole.bind(null, "user"));
	const uniqueServerMessages = dedupeChatMessagesById(serverMessages);
	const serverUserMsgs = uniqueServerMessages.filter(
		hasRole.bind(null, "user")
	);
	const displayTextMap = new Map<number, string>();

	for (let i = 0; i < serverUserMsgs.length && i < localUserMsgs.length; i++) {
		if (localUserMsgs[i]!.content.length < serverUserMsgs[i]!.content.length) {
			displayTextMap.set(i, localUserMsgs[i]!.content);
		}
	}

	let userIdx = 0;
	const mergedMessages = uniqueServerMessages.map((message) => {
		if (message.role !== "user") return message;
		const displayText = displayTextMap.get(userIdx);
		userIdx++;
		return displayText ? { ...message, content: displayText } : message;
	});
	const serverIds = new Set(uniqueServerMessages.map((message) => message.id));
	for (const localUserMessage of localUserMsgs.slice(serverUserMsgs.length)) {
		if (serverIds.has(localUserMessage.id)) continue;
		const localIndex = localMessages.findIndex(
			(message) => message.id === localUserMessage.id
		);
		const mergedIndexById = new Map(
			mergedMessages.map((message, index) => [message.id, index])
		);
		let insertIndex = mergedMessages.length;
		for (let i = localIndex - 1; i >= 0; i--) {
			const anchorIndex = mergedIndexById.get(localMessages[i]!.id);
			if (anchorIndex === undefined) continue;
			insertIndex = anchorIndex + 1;
			break;
		}
		mergedMessages.splice(insertIndex, 0, localUserMessage);
	}
	return compactAdjacentDuplicateTranscriptMessages(mergedMessages);
}

function isMessagePrefix<T extends { id: string }>(
	candidateMessages: T[],
	messages: T[]
): boolean {
	if (candidateMessages.length >= messages.length) return false;
	return candidateMessages.every(
		(message, index) => message.id === messages[index]?.id
	);
}

export function reconcileChatSync({
	currentMessages,
	isStreaming,
	previousRevision,
	revision,
	serverMessages: rawServerMessages,
}: ChatSyncReconcileInput): ChatSyncReconcileResult {
	if (revision !== null && previousRevision === revision && !isStreaming) {
		return {
			mergedMessages: currentMessages,
			nextRevision: previousRevision,
			serverMessages: [],
			shouldPersist: false,
			shouldSkip: true,
			shouldUpdateMessages: false,
			streamingAssistantId: null,
			streamingToolId: null,
		};
	}

	const serverMessages = dedupeChatMessagesById(rawServerMessages);
	if (!isStreaming && isMessagePrefix(serverMessages, currentMessages)) {
		return {
			mergedMessages: currentMessages,
			nextRevision: revision ?? previousRevision,
			serverMessages,
			shouldPersist: false,
			shouldSkip: true,
			shouldUpdateMessages: false,
			streamingAssistantId: null,
			streamingToolId: null,
		};
	}

	const localStreamingAssistantId =
		currentMessages.findLast?.(
			(message) => message.isStreaming && message.role === "assistant"
		)?.id ?? null;
	const localStreamingToolId =
		currentMessages.findLast?.(
			(message) => message.isStreaming && message.role === "tool"
		)?.id ?? null;
	const hasLocalStreamingRow =
		!!localStreamingAssistantId || !!localStreamingToolId;
	const shouldUpdateMessages =
		!isStreaming || (serverMessages.length > 0 && !hasLocalStreamingRow);
	const mergedMessages = shouldUpdateMessages
		? trimMessages(mergeSyncedMessages(currentMessages, serverMessages))
		: currentMessages;
	const streamingAssistantId =
		mergedMessages.findLast?.(
			(message) => message.isStreaming && message.role === "assistant"
		)?.id ?? null;
	const streamingToolId =
		mergedMessages.findLast?.(
			(message) => message.isStreaming && message.role === "tool"
		)?.id ?? null;

	return {
		mergedMessages,
		nextRevision: revision ?? previousRevision,
		serverMessages,
		shouldPersist: shouldUpdateMessages && !isStreaming,
		shouldSkip: false,
		shouldUpdateMessages,
		streamingAssistantId,
		streamingToolId,
	};
}

export function patchMessageById(
	messages: ChatStateMessage[],
	id: string,
	patch:
		| Partial<ChatStateMessage>
		| ((message: ChatStateMessage) => Partial<ChatStateMessage>),
	searchFromEnd = true
): ChatStateMessage[] {
	const updated = messages.slice();
	const start = searchFromEnd ? updated.length - 1 : 0;
	const end = searchFromEnd ? -1 : updated.length;
	const step = searchFromEnd ? -1 : 1;

	for (let i = start; i !== end; i += step) {
		if (updated[i]?.id !== id) continue;
		const nextPatch = typeof patch === "function" ? patch(updated[i]!) : patch;
		updated[i] = { ...updated[i]!, ...nextPatch };
		return updated;
	}

	return messages;
}

export function appendMessageContent(
	messages: ChatStateMessage[],
	id: string,
	content: string
): ChatStateMessage[] {
	return patchMessageById(messages, id, (message) => ({
		content: appendBoundedChatContent(message.content, content),
	}));
}

export function applyPendingMessageContent(
	messages: ChatMessage[],
	pending: Map<string, string>
): ChatMessage[] {
	let next = messages;
	for (const [targetId, content] of pending) {
		next = appendMessageContent(next, targetId, content) as ChatMessage[];
	}
	return next;
}

export function createBtwQuestionMessage(question: string): ChatMessage {
	return {
		id: nextId(),
		role: "btw",
		content: "",
		isStreaming: true,
		btwQuestion: question,
	};
}

export function appendBtwQuestionMessage(
	messages: ChatMessage[],
	message: ChatMessage
): ChatMessage[] {
	return trimMessages([...messages, message]);
}

export function finishBtwMessage(
	messages: ChatMessage[],
	id: string | null,
	answer: string
): ChatMessage[] {
	if (!id) return messages;
	return patchMessageById(messages, id, {
		content: truncateChatContent(answer),
		isStreaming: false,
	}) as ChatMessage[];
}

export function finishStreamingMessages(
	messages: ChatMessage[],
	streamingIds: {
		assistantId: string | null;
		toolId: string | null;
	}
): ChatMessage[] {
	let updated = messages;
	if (streamingIds.assistantId) {
		updated = patchMessageById(updated, streamingIds.assistantId, {
			isStreaming: false,
		}) as ChatMessage[];
	}
	if (streamingIds.toolId) {
		updated = patchMessageById(updated, streamingIds.toolId, {
			isStreaming: false,
		}) as ChatMessage[];
	}
	return updated === messages ? messages : trimMessages(updated);
}

export function applyAssistantResultMessage(
	messages: ChatMessage[],
	assistantId: string | null,
	result: string
): ChatMessage[] {
	if (assistantId) {
		const updated = patchMessageById(
			messages,
			assistantId,
			{ content: truncateChatContent(result), isStreaming: false },
			false
		) as ChatMessage[];
		if (updated !== messages) return updated;
		return trimMessages([
			...messages,
			{
				id: nextId(),
				role: "assistant",
				content: truncateChatContent(result),
			},
		]);
	}

	const last = messages[messages.length - 1];
	if (last?.role === "assistant" && last.content === result) return messages;
	const latestAssistantIndex = messages.findLastIndex?.(
		(message) => message.role === "assistant"
	);
	if (latestAssistantIndex !== undefined && latestAssistantIndex >= 0) {
		const latestAssistant = messages[latestAssistantIndex];
		if (latestAssistant?.content === result) return messages;
		if (
			latestAssistant?.isStreaming ||
			(result.startsWith(latestAssistant?.content ?? "") &&
				latestAssistantIndex >= messages.length - 3)
		) {
			const updated = messages.slice();
			updated[latestAssistantIndex] = {
				...latestAssistant!,
				content: truncateChatContent(result),
				isStreaming: false,
			};
			return trimMessages(updated);
		}
	}
	return trimMessages([
		...messages,
		{
			id: nextId(),
			role: "assistant",
			content: truncateChatContent(result),
		},
	]);
}

export function appendSystemMessage(
	messages: ChatStateMessage[],
	content: string
): ChatStateMessage[] {
	const next = [
		...messages,
		{ id: nextId(), role: "system" as const, content },
	];
	const compacted = compactAdjacentDuplicateTranscriptMessages(next);
	return compacted === next ? trimMessages(next) : messages;
}
