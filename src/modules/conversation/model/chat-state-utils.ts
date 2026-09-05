import {
	type ChatMessage,
	type ChatTranscriptUpdate,
	compactAdjacentDuplicateTranscriptMessages,
	nextId,
	trimMessages,
} from "../../../modules/conversation/model/agent-chat-shared.ts";

type ChatStateMessage = Pick<
	ChatMessage,
	"id" | "role" | "content" | "parts" | "isStreaming"
>;

const CHAT_RENDER_CHAR_WINDOW = 500_000;
const CHAT_RENDER_MIN_MESSAGES = 30;
const CHAT_RENDER_MAX_MESSAGES = 2_000;

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
			!["user", "assistant", "tool", "system", "btw"].includes(
				change.message.role,
			)
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
	const ids = new Set(server.map((message) => message.id));
	const merged = [...server];
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
