type StoredValue = string | null;

function parseMessages(value: StoredValue): unknown[] | null {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function messageId(value: unknown): string | null {
	return typeof value === "object" &&
		value !== null &&
		typeof (value as { id?: unknown }).id === "string"
		? (value as { id: string }).id
		: null;
}

function messageRole(value: unknown): string | null {
	return typeof value === "object" &&
		value !== null &&
		typeof (value as { role?: unknown }).role === "string"
		? (value as { role: string }).role
		: null;
}

function messageScore(value: unknown): number {
	if (typeof value !== "object" || value === null) return 0;
	const content = (value as { content?: unknown }).content;
	const images = (value as { images?: unknown }).images;
	return (
		1 +
		(typeof content === "string" ? content.length : 0) +
		(Array.isArray(images) ? images.length : 0)
	);
}

export function chatMessagesScore(value: StoredValue): number {
	const messages = parseMessages(value);
	if (!messages) return 0;
	return messages.reduce<number>((score, message) => {
		if (!messageRole(message)) return score;
		return score + messageScore(message);
	}, 0);
}

export function chatMessagesContainUnseenIds(
	incomingValue: StoredValue,
	existingValue: StoredValue
): boolean {
	const incoming = parseMessages(incomingValue);
	const existing = parseMessages(existingValue);
	if (!incoming || !existing) return false;
	const existingIds = new Set(existing.map(messageId).filter(Boolean));
	return incoming.some((message) => {
		const id = messageId(message);
		return id && !existingIds.has(id);
	});
}

export function mergeChatMessageStorageValues(
	existingValue: StoredValue,
	incomingValue: StoredValue
): StoredValue {
	if (incomingValue === null) return null;
	const incoming = parseMessages(incomingValue);
	if (!incoming) return existingValue;
	const existing = parseMessages(existingValue);
	if (!existing) return incomingValue;

	const merged: unknown[] = [];
	const indexById = new Map<string, number>();
	const pushOrMerge = (message: unknown) => {
		const id = messageId(message);
		if (!id) {
			merged.push(message);
			return;
		}
		const existingIndex = indexById.get(id);
		if (existingIndex === undefined) {
			indexById.set(id, merged.length);
			merged.push(message);
			return;
		}
		const current = merged[existingIndex];
		if (messageScore(message) >= messageScore(current)) {
			merged[existingIndex] = message;
		}
	};

	existing.forEach(pushOrMerge);
	incoming.forEach(pushOrMerge);
	return JSON.stringify(merged);
}
