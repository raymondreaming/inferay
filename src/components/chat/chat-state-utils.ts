import { hasRole } from "../../lib/data.ts";

export type ChatStateMessage = {
	id: string;
	role: "user" | "assistant" | "tool" | "system" | "btw";
	content: string;
	isStreaming?: boolean;
};

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
		content: message.content + content,
	}));
}

export function mergeSyncedMessages(
	localMessages: ChatStateMessage[],
	serverMessages: ChatStateMessage[]
): ChatStateMessage[] {
	const serverWithLocalDisplayText = mergeUserDisplayText(
		localMessages,
		serverMessages
	);
	if (localMessages.length === 0) return serverWithLocalDisplayText;
	if (serverMessages.length === 0) return localMessages;

	const overlapStart = findServerOverlapStart(localMessages, serverMessages);
	if (overlapStart >= 0) {
		return [
			...localMessages.slice(0, overlapStart),
			...serverWithLocalDisplayText,
		];
	}

	return serverMessages.length < localMessages.length
		? localMessages
		: serverWithLocalDisplayText;
}

function mergeUserDisplayText(
	localMessages: ChatStateMessage[],
	serverMessages: ChatStateMessage[]
): ChatStateMessage[] {
	const localUserMsgs = localMessages.filter(hasRole.bind(null, "user"));
	const serverUserMsgs = serverMessages.filter(hasRole.bind(null, "user"));
	const displayTextMap = new Map<number, string>();

	for (let i = 0; i < serverUserMsgs.length && i < localUserMsgs.length; i++) {
		if (localUserMsgs[i]!.content.length < serverUserMsgs[i]!.content.length) {
			displayTextMap.set(i, localUserMsgs[i]!.content);
		}
	}

	let userIdx = 0;
	return serverMessages.map((message) => {
		if (message.role !== "user") return message;
		const displayText = displayTextMap.get(userIdx);
		userIdx++;
		return displayText ? { ...message, content: displayText } : message;
	});
}

function findServerOverlapStart(
	localMessages: ChatStateMessage[],
	serverMessages: ChatStateMessage[]
): number {
	let bestStart = -1;
	let bestLength = 0;

	for (let start = 0; start < localMessages.length; start += 1) {
		let length = 0;
		while (
			start + length < localMessages.length &&
			length < serverMessages.length &&
			messagesOverlap(localMessages[start + length]!, serverMessages[length]!)
		) {
			length += 1;
		}
		if (length > bestLength) {
			bestStart = start;
			bestLength = length;
		}
	}

	return bestLength > 0 ? bestStart : -1;
}

function messagesOverlap(
	localMessage: ChatStateMessage,
	serverMessage: ChatStateMessage
): boolean {
	if (localMessage.id === serverMessage.id) return true;
	if (localMessage.role !== serverMessage.role) return false;
	if (localMessage.role === "user") {
		const shorter =
			localMessage.content.length <= serverMessage.content.length
				? localMessage.content
				: serverMessage.content;
		const longer =
			localMessage.content.length > serverMessage.content.length
				? localMessage.content
				: serverMessage.content;
		return shorter.trim().length > 0 && longer.includes(shorter);
	}
	return localMessage.content === serverMessage.content;
}
