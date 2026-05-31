import {
	shouldSyncClientStorageKey,
	TERMINAL_STATE_STORAGE_KEY,
} from "../../lib/client-storage-keys.ts";
import { readJson, writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";
import { readTerminalState } from "./terminal-state.ts";

type StoredValue = string | null;
type ClientStorageSnapshot = Record<string, StoredValue>;

const CLIENT_STORAGE_PATH = userDataPath("client-storage.json");
const CHAT_MESSAGES_STORAGE_KEY_PREFIX = "inferay-chat-";
const CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES = [
	"inferay-chat-session-",
	"inferay-chat-input-",
	"inferay-chat-model-",
	"inferay-chat-reasoning-",
	"inferay-chat-pending-send-",
	"inferay-chat-summary-",
	"inferay-chat-pending-workspace-",
	"inferay-chat-queue-",
	"inferay-chat-loading-",
	"inferay-chat-composer-context-",
	"inferay-chat-worktree-",
] as const;

function isChatMessagesStorageKey(key: string): boolean {
	return (
		key.startsWith(CHAT_MESSAGES_STORAGE_KEY_PREFIX) &&
		!CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES.some((prefix) =>
			key.startsWith(prefix)
		)
	);
}

function readMessages(value: StoredValue): unknown[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function messageRole(value: unknown): string | null {
	return typeof value === "object" &&
		value !== null &&
		typeof (value as { role?: unknown }).role === "string"
		? (value as { role: string }).role
		: null;
}

function messageHistoryScore(messages: unknown[]): number {
	return messages.reduce<number>((score, message) => {
		const role = messageRole(message);
		if (!role) return score;
		const content = (message as { content?: unknown }).content;
		return score + 1 + (typeof content === "string" ? content.length : 0);
	}, 0);
}

function shouldApplyClientStorageEntry(
	key: string,
	currentValue: StoredValue,
	nextValue: StoredValue
): boolean {
	if (nextValue === null || !isChatMessagesStorageKey(key)) return true;
	const currentMessages = readMessages(currentValue);
	const nextMessages = readMessages(nextValue);
	return (
		messageHistoryScore(nextMessages) >= messageHistoryScore(currentMessages)
	);
}

export function normalizeEntries(value: unknown): Record<string, StoredValue> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const entries: Record<string, StoredValue> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (!shouldSyncClientStorageKey(key)) continue;
		if (typeof raw === "string" || raw === null) entries[key] = raw;
	}
	return entries;
}

export async function loadClientStorageEntries(): Promise<ClientStorageSnapshot> {
	const entries = await readJson<ClientStorageSnapshot>(
		CLIENT_STORAGE_PATH,
		{}
	);
	if (!entries[TERMINAL_STATE_STORAGE_KEY]) {
		const terminalState = await readTerminalState<unknown | null>(null);
		if (terminalState) {
			entries[TERMINAL_STATE_STORAGE_KEY] = JSON.stringify(terminalState);
		}
	}
	return entries;
}

export async function applyClientStorageEntries(
	entries: Record<string, StoredValue>
): Promise<void> {
	const snapshot = await readJson<ClientStorageSnapshot>(
		CLIENT_STORAGE_PATH,
		{}
	);
	for (const [key, value] of Object.entries(entries)) {
		if (!shouldApplyClientStorageEntry(key, snapshot[key] ?? null, value)) {
			continue;
		}
		snapshot[key] = value;
	}
	await writeJson(CLIENT_STORAGE_PATH, snapshot);
}
