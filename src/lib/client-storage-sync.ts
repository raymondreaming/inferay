import {
	shouldSyncClientStorageKey,
	TERMINAL_STATE_STORAGE_KEY,
} from "./client-storage-keys.ts";
import { noop } from "./data.ts";

type StoredValue = string | null;

interface ClientStoragePayload {
	entries?: Record<string, StoredValue>;
}

let hydrating = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const pendingSync = new Map<string, StoredValue>();
const HYDRATION_TIMEOUT_MS = 800;

function readLocalEntries(): Record<string, string> {
	const entries: Record<string, string> = {};
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !shouldSyncClientStorageKey(key)) continue;
			const value = localStorage.getItem(key);
			if (value !== null) entries[key] = value;
		}
	} catch {}
	return entries;
}

function terminalStateScore(value: string | null): number {
	if (!value) return 0;
	try {
		const parsed = JSON.parse(value) as {
			groups?: Array<{ panes?: Array<{ cwd?: string; pendingCwd?: boolean }> }>;
		};
		return (parsed.groups ?? []).reduce((score, group) => {
			const panes = group.panes ?? [];
			return (
				score +
				panes.length +
				panes.filter((pane) => pane.cwd || pane.pendingCwd === false).length
			);
		}, 0);
	} catch {
		return 0;
	}
}

function shouldApplyServerValue(
	key: string,
	serverValue: StoredValue
): boolean {
	if (serverValue === null) return false;
	let localValue: string | null = null;
	try {
		localValue = localStorage.getItem(key);
	} catch {
		return false;
	}
	if (localValue === null) return true;
	if (key === TERMINAL_STATE_STORAGE_KEY) {
		const serverScore = terminalStateScore(serverValue);
		const localScore = terminalStateScore(localValue);
		if (serverScore <= 1 && localScore > serverScore) return false;
		return serverValue !== localValue;
	}
	return serverValue !== localValue;
}

async function sendStoragePatch(entries: Record<string, StoredValue>) {
	await fetch("/api/client-storage", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ entries }),
	});
}

function sendStorageBeacon(entries: Record<string, StoredValue>): boolean {
	if (typeof navigator === "undefined" || !navigator.sendBeacon) return false;
	return navigator.sendBeacon(
		"/api/client-storage",
		new Blob([JSON.stringify({ entries })], {
			type: "application/json",
		})
	);
}

function flushPendingSync(useBeacon = false) {
	if (syncTimer) {
		clearTimeout(syncTimer);
		syncTimer = null;
	}
	if (pendingSync.size === 0) return;
	const entries = Object.fromEntries(pendingSync);
	pendingSync.clear();
	if (useBeacon && sendStorageBeacon(entries)) return;
	sendStoragePatch(entries).catch(noop);
}

export function syncStoredValue(key: string, value: StoredValue): void {
	if (hydrating || !shouldSyncClientStorageKey(key)) return;
	pendingSync.set(key, value);
	if (syncTimer) return;
	syncTimer = setTimeout(flushPendingSync, 250);
}

export async function syncAllStoredValues(): Promise<void> {
	await sendStoragePatch(readLocalEntries());
}

export async function hydrateStoredValues(): Promise<void> {
	if (typeof window === "undefined") return;
	let entries: Record<string, StoredValue> = {};
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HYDRATION_TIMEOUT_MS);
	try {
		const response = await fetch("/api/client-storage", {
			signal: controller.signal,
		});
		if (response.ok) {
			const payload = (await response.json()) as ClientStoragePayload;
			entries = payload.entries ?? {};
		}
	} catch {}
	clearTimeout(timeout);

	hydrating = true;
	try {
		for (const [key, value] of Object.entries(entries)) {
			if (!shouldSyncClientStorageKey(key)) continue;
			if (!shouldApplyServerValue(key, value)) continue;
			try {
				if (value === null) localStorage.removeItem(key);
				else localStorage.setItem(key, value);
			} catch {}
		}
	} finally {
		hydrating = false;
	}

	syncAllStoredValues().catch(noop);
}

if (typeof window !== "undefined") {
	window.addEventListener("pagehide", () => flushPendingSync(true));
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushPendingSync(true);
	});
}
