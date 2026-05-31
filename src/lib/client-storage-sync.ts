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
const HYDRATION_TIMEOUT_MS = 2500;
const HYDRATION_RETRY_DELAYS_MS = [0, 200, 700] as const;
const STORAGE_POLL_INTERVAL_MS = 1000;
const LOCAL_WRITE_PROTECT_MS = 8000;
const TERMINAL_SYNC_KEYS = new Set([
	TERMINAL_STATE_STORAGE_KEY,
	"terminal-layout-mode",
	"terminal-main-view",
]);
export const CLIENT_STORAGE_CHANGED_EVENT = "inferay:client-storage-changed";
let pollTimer: ReturnType<typeof setInterval> | null = null;
const localWriteTimes = new Map<string, number>();
const localWriteValues = new Map<string, StoredValue>();

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
	let localValue: string | null = null;
	try {
		localValue = localStorage.getItem(key);
	} catch {
		return false;
	}
	if (serverValue === localValue) {
		localWriteTimes.delete(key);
		localWriteValues.delete(key);
		return false;
	}
	const localWriteAt = localWriteTimes.get(key);
	if (
		localWriteAt &&
		Date.now() - localWriteAt < LOCAL_WRITE_PROTECT_MS &&
		localWriteValues.get(key) === localValue
	) {
		return false;
	}
	if (serverValue === null) return localValue !== null;
	if (localValue === null) return true;
	if (key === TERMINAL_STATE_STORAGE_KEY) {
		const serverScore = terminalStateScore(serverValue);
		const localScore = terminalStateScore(localValue);
		if (serverScore <= 1 && localScore > serverScore) return false;
		return true;
	}
	return true;
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

function clearSyncedLocalWrites(entries: Record<string, StoredValue>) {
	for (const [key, value] of Object.entries(entries)) {
		let localValue: string | null = null;
		try {
			localValue = localStorage.getItem(key);
		} catch {
			continue;
		}
		const expectedValue = value === null ? null : value;
		if (
			localValue === expectedValue &&
			localWriteValues.get(key) === expectedValue
		) {
			localWriteTimes.delete(key);
			localWriteValues.delete(key);
		}
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
	sendStoragePatch(entries)
		.then(() => clearSyncedLocalWrites(entries))
		.catch(noop);
}

export function syncStoredValue(key: string, value: StoredValue): void {
	if (hydrating || !shouldSyncClientStorageKey(key)) return;
	localWriteTimes.set(key, Date.now());
	localWriteValues.set(key, value);
	pendingSync.set(key, value);
	if (syncTimer) return;
	syncTimer = setTimeout(flushPendingSync, 250);
}

export async function syncAllStoredValues(): Promise<void> {
	await sendStoragePatch(readLocalEntries());
}

async function fetchServerEntries(): Promise<Record<
	string,
	StoredValue
> | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HYDRATION_TIMEOUT_MS);
	try {
		const response = await fetch("/api/client-storage", {
			signal: controller.signal,
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as ClientStoragePayload;
		return payload.entries ?? {};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function dispatchStorageChanged(key: string, value: StoredValue) {
	window.dispatchEvent(
		new CustomEvent(CLIENT_STORAGE_CHANGED_EVENT, { detail: { key, value } })
	);
}

function applyServerEntries(entries: Record<string, StoredValue>): string[] {
	const changedKeys: string[] = [];
	hydrating = true;
	try {
		for (const [key, value] of Object.entries(entries)) {
			if (!shouldSyncClientStorageKey(key)) continue;
			if (!shouldApplyServerValue(key, value)) continue;
			try {
				if (value === null) localStorage.removeItem(key);
				else localStorage.setItem(key, value);
				changedKeys.push(key);
				dispatchStorageChanged(key, value);
			} catch {}
		}
	} finally {
		hydrating = false;
	}
	if (changedKeys.some((key) => TERMINAL_SYNC_KEYS.has(key))) {
		window.dispatchEvent(new Event("terminal-shell-change"));
	}
	return changedKeys;
}

function startStoragePolling() {
	if (pollTimer !== null) return;
	pollTimer = setInterval(() => {
		fetchServerEntries()
			.then((entries) => {
				if (entries !== null) applyServerEntries(entries);
			})
			.catch(noop);
	}, STORAGE_POLL_INTERVAL_MS);
}

export async function hydrateStoredValues(): Promise<void> {
	if (typeof window === "undefined") return;
	let entries: Record<string, StoredValue> | null = null;
	for (const delay of HYDRATION_RETRY_DELAYS_MS) {
		if (delay > 0) await wait(delay);
		entries = await fetchServerEntries();
		if (entries !== null) break;
	}

	if (entries !== null) applyServerEntries(entries);

	if (entries !== null) syncAllStoredValues().catch(noop);
	startStoragePolling();
}

if (typeof window !== "undefined") {
	window.addEventListener("pagehide", () => flushPendingSync(true));
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushPendingSync(true);
	});
}
