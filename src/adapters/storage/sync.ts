import { noop } from "../../shared/lib/data.ts";
import { shouldSyncClientStorageKey } from "./keys.ts";

type StoredValue = string | null;

interface ClientStoragePayload {
	entries?: Record<string, StoredValue>;
}

let hydrating = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const pendingSync = new Map<string, StoredValue>();
const HYDRATION_TIMEOUT_MS = 5_000;
export const CLIENT_STORAGE_CHANGED_EVENT = "inferay-client-storage-change";

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

function shouldApplyServerValue(
	key: string,
	serverValue: StoredValue,
): boolean {
	let localValue: string | null = null;
	try {
		localValue = localStorage.getItem(key);
	} catch {
		return false;
	}
	if (serverValue === null) return localValue !== null;
	if (localValue === null) return true;
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
		}),
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
	window.dispatchEvent(
		new CustomEvent(CLIENT_STORAGE_CHANGED_EVENT, { detail: { key, value } }),
	);
	if (syncTimer) return;
	syncTimer = setTimeout(flushPendingSync, 250);
}

export function flushPendingClientStorageSync(): void {
	flushPendingSync();
}

async function syncAllStoredValues(): Promise<void> {
	await sendStoragePatch(readLocalEntries());
}

export async function hydrateStoredValues(): Promise<void> {
	if (typeof window === "undefined") return;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HYDRATION_TIMEOUT_MS);
	try {
		// Import and read share the native storage lock; no second preference table is maintained in JS.
		const response = await fetch("/api/client-storage", {
			method: "POST",
			signal: controller.signal,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				migrateChatPreferences: true,
				legacyPreferences: localStorage.getItem("inferay-db-preferences"),
			}),
		});
		if (!response.ok) throw new Error("Could not load saved preferences");
		const payload = (await response.json()) as ClientStoragePayload;
		if (!payload.entries) throw new Error("Missing saved preferences");
		hydrating = true;
		for (const [key, value] of Object.entries(payload.entries)) {
			if (
				!shouldSyncClientStorageKey(key) ||
				!shouldApplyServerValue(key, value)
			)
				continue;
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		}
	} finally {
		hydrating = false;
		clearTimeout(timeout);
	}
	// Browser-only UI preferences remain eligible for import; workspace initialization owns its own source.
	syncAllStoredValues().catch(noop);
}

if (typeof window !== "undefined") {
	window.addEventListener("pagehide", () => flushPendingSync(true));
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushPendingSync(true);
	});
}
