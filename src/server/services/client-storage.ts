import {
	shouldSyncClientStorageKey,
	TERMINAL_STATE_STORAGE_KEY,
} from "../../lib/client-storage-keys.ts";
import { readJson, writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";
import { readTerminalState } from "./terminal-state.ts";

type StoredValue = string | null;
type ClientStorageSnapshot = Record<string, string>;

const CLIENT_STORAGE_PATH = userDataPath("client-storage.json");

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
		if (value === null) delete snapshot[key];
		else snapshot[key] = value;
	}
	await writeJson(CLIENT_STORAGE_PATH, snapshot);
}
