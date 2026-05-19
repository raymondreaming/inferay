import {
	shouldSyncClientStorageKey,
	TERMINAL_STATE_STORAGE_KEY,
} from "../../lib/client-storage-keys.ts";
import { readJson, tryRoute, writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";
import { readTerminalState } from "../services/terminal-state.ts";

type StoredValue = string | null;
type ClientStorageSnapshot = Record<string, string>;

const CLIENT_STORAGE_PATH = userDataPath("client-storage.json");

export function normalizeEntries(value: unknown): Record<string, StoredValue> {
	if (typeof value !== "object" || value === null) return {};
	const entries: Record<string, StoredValue> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (!shouldSyncClientStorageKey(key)) continue;
		if (typeof raw === "string" || raw === null) entries[key] = raw;
	}
	return entries;
}

export function clientStorageRoutes() {
	return {
		"/api/client-storage": {
			GET: tryRoute(async () => {
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
				return Response.json({ entries });
			}),
			PUT: tryRoute(async (req) => {
				const body = await req.json();
				const entries = normalizeEntries(body?.entries);
				const snapshot = await readJson<ClientStorageSnapshot>(
					CLIENT_STORAGE_PATH,
					{}
				);
				for (const [key, value] of Object.entries(entries)) {
					if (value === null) delete snapshot[key];
					else snapshot[key] = value;
				}
				await writeJson(CLIENT_STORAGE_PATH, snapshot);
				return Response.json({ ok: true });
			}),
		},
	};
}
