import {
	appendBoundedChatContent,
	type ChatMessage,
	type ChatTranscriptUpdate,
	compactAdjacentDuplicateTranscriptMessages,
	nextId,
	trimMessages,
	truncateChatContent,
} from "../../../modules/conversation/model/agent-chat-shared.ts";
import { hasRole } from "../../../shared/lib/data.ts";

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
	messages: T[],
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
	serverMessages: ChatMessage[],
): ChatMessage[] {
	const localUserMsgs = localMessages.filter(hasRole.bind(null, "user"));
	const uniqueServerMessages = dedupeChatMessagesById(serverMessages);
	const serverUserMsgs = uniqueServerMessages.filter(
		hasRole.bind(null, "user"),
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
			(message) => message.id === localUserMessage.id,
		);
		const mergedIndexById = new Map(
			mergedMessages.map((message, index) => [message.id, index]),
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
	messages: T[],
): boolean {
	if (candidateMessages.length >= messages.length) return false;
	return candidateMessages.every(
		(message, index) => message.id === messages[index]?.id,
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
			(message) => message.isStreaming && message.role === "assistant",
		)?.id ?? null;
	const localStreamingToolId =
		currentMessages.findLast?.(
			(message) => message.isStreaming && message.role === "tool",
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
			(message) => message.isStreaming && message.role === "assistant",
		)?.id ?? null;
	const streamingToolId =
		mergedMessages.findLast?.(
			(message) => message.isStreaming && message.role === "tool",
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
	searchFromEnd = true,
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
	content: string,
): ChatStateMessage[] {
	return patchMessageById(messages, id, (message) => ({
		content: appendBoundedChatContent(message.content, content),
	}));
}

export function applyPendingMessageContent(
	messages: ChatMessage[],
	pending: Map<string, string>,
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
	message: ChatMessage,
): ChatMessage[] {
	return trimMessages([...messages, message]);
}

export function finishBtwMessage(
	messages: ChatMessage[],
	id: string | null,
	answer: string,
): ChatMessage[] {
	if (!id) return messages;
	return patchMessageById(messages, id, {
		content: truncateChatContent(answer),
		isStreaming: false,
	}) as ChatMessage[];
}

export function appendSystemMessage(
	messages: ChatStateMessage[],
	content: string,
	render?: ChatMessage["render"],
): ChatStateMessage[] {
	const next = [
		...messages,
		{
			id: nextId(),
			role: "system" as const,
			content,
			localOnly: true,
			...(render ? { render } : {}),
		},
	];
	const compacted = compactAdjacentDuplicateTranscriptMessages(next);
	return compacted === next ? trimMessages(next) : messages;
}

/** Apply native transport changes without interpreting provider events. Null
 * requests a full resync: never apply a delta against a different revision. */
export function applyNativeTranscriptUpdate(
	current: { messages: ChatMessage[]; revision: number; epoch?: string } | null,
	update: ChatTranscriptUpdate,
): { messages: ChatMessage[]; revision: number; epoch?: string } | null {
	if (
		update.version !== 1 ||
		!Number.isSafeInteger(update.revision) ||
		!Number.isSafeInteger(update.start) ||
		!Number.isSafeInteger(update.deleteCount) ||
		!Array.isArray(update.messages)
	)
		return null;
	if (current && current.epoch !== update.epoch) return null;
	if (current && update.revision <= current.revision) return current;
	if (!update.reset && (!current || current.revision !== update.baseRevision))
		return null;
	const before = update.reset ? [] : current!.messages;
	if (
		update.start < 0 ||
		update.start > before.length ||
		update.deleteCount < 0 ||
		(!update.reset && update.start + update.deleteCount > before.length)
	)
		return null;
	const inserted: ChatMessage[] = [];
	for (let index = 0; index < update.messages.length; index++) {
		const change = update.messages[index];
		if (
			!change?.message ||
			typeof change.message.id !== "string" ||
			!["user", "assistant", "tool", "system"].includes(change.message.role)
		)
			return null;
		const previous = before[update.start + index];
		let content = change.message.content;
		if (change.appendContent !== undefined) {
			if (
				typeof change.appendContent !== "string" ||
				!previous ||
				previous.id !== change.message.id
			)
				return null;
			content = previous.content + change.appendContent;
		}
		if (typeof content !== "string") return null;
		inserted.push({ ...change.message, content });
	}
	return {
		messages: [
			...before.slice(0, update.start),
			...inserted,
			...before.slice(update.start + update.deleteCount),
		],
		revision: update.revision,
		epoch: update.epoch,
	};
}

/** Native messages are authoritative; only unacknowledged local sends survive
 * a splice/reset. Unlike the legacy reader this never aligns users by index. */
export function mergeNativeTranscript(
	local: ChatMessage[],
	server: ChatMessage[],
): ChatMessage[] {
	const localById = new Map(local.map((message) => [message.id, message]));
	const ids = new Set(server.map((message) => message.id));
	const merged = server.map((message) => {
		const pending = localById.get(message.id);
		return message.role === "user" &&
			pending &&
			pending.content.length < message.content.length
			? { ...message, content: pending.content }
			: message;
	});
	for (let index = 0; index < local.length; index++) {
		const message = local[index]!;
		const browserOwned =
			(message.optimistic && message.role === "user") ||
			message.localOnly ||
			message.role === "btw";
		if (!browserOwned || ids.has(message.id)) continue;
		if (
			message.localOnly &&
			server.some(
				(candidate) =>
					candidate.role === message.role &&
					candidate.content === message.content,
			)
		)
			continue;
		let insertion = merged.length;
		for (let anchor = index - 1; anchor >= 0; anchor--) {
			const position = merged.findIndex(
				(candidate) => candidate.id === local[anchor]!.id,
			);
			if (position >= 0) {
				insertion = position + 1;
				break;
			}
		}
		merged.splice(insertion, 0, message);
	}
	return merged;
}
