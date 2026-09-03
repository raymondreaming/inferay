import { noop } from "../../shared/lib/data.ts";
import {
	AGENT_STATE_STORAGE_KEY,
	CHAT_QUEUE_KEY_PREFIX,
	CHAT_SESSION_INDEX_STORAGE_KEY,
	isChatMessageStorageKey,
	ONBOARDING_DONE_STORAGE_KEY,
	shouldSyncClientStorageKey,
} from "./keys.ts";

type StoredValue = string | null;

interface ClientStoragePayload {
	entries?: Record<string, StoredValue>;
}

interface AgentStateEntryResult {
	ok: boolean;
	value: StoredValue;
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

async function fetchStoredEntries(
	signal: AbortSignal,
	key?: string,
): Promise<Record<string, StoredValue> | null> {
	const url = key
		? `/api/client-storage?key=${encodeURIComponent(key)}`
		: "/api/client-storage";
	const response = await fetch(url, { signal });
	if (!response.ok) return null;
	const payload = (await response.json()) as ClientStoragePayload;
	return payload.entries ?? {};
}

async function fetchAgentStateEntry(): Promise<AgentStateEntryResult> {
	try {
		const response = await fetch("/api/agent/state");
		if (!response.ok) return { ok: false, value: null };
		const state = await response.json();
		return { ok: true, value: state ? JSON.stringify(state) : null };
	} catch {
		return { ok: false, value: null };
	}
}

function isChatCacheKey(key: string): boolean {
	return (
		key === CHAT_SESSION_INDEX_STORAGE_KEY ||
		isChatMessageStorageKey(key) ||
		key.startsWith(CHAT_QUEUE_KEY_PREFIX)
	);
}

function collectAgentResetEntries(
	entries: Record<string, StoredValue>,
): Record<string, null> {
	const resetEntries: Record<string, null> = {
		[AGENT_STATE_STORAGE_KEY]: null,
		[CHAT_SESSION_INDEX_STORAGE_KEY]: null,
	};
	for (const key of Object.keys(entries)) {
		if (key === AGENT_STATE_STORAGE_KEY || isChatCacheKey(key)) {
			resetEntries[key] = null;
		}
	}
	try {
		const localKeys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key === AGENT_STATE_STORAGE_KEY || (key && isChatCacheKey(key)))
				localKeys.push(key);
		}
		for (const key of localKeys) resetEntries[key] = null;
	} catch {}
	return resetEntries;
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
	const entries: Record<string, StoredValue> = {};
	let hydrated = false;
	let resetEntries: Record<string, null> | null = null;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HYDRATION_TIMEOUT_MS);
	try {
		const criticalEntries = await fetchStoredEntries(
			controller.signal,
			ONBOARDING_DONE_STORAGE_KEY,
		);
		if (criticalEntries) {
			Object.assign(entries, criticalEntries);
			hydrated = true;
			const onboardingValue = criticalEntries[ONBOARDING_DONE_STORAGE_KEY];
			if (onboardingValue === null) {
				localStorage.removeItem(ONBOARDING_DONE_STORAGE_KEY);
			} else if (onboardingValue !== undefined) {
				localStorage.setItem(ONBOARDING_DONE_STORAGE_KEY, onboardingValue);
			}
		}
		const fetchedEntries = await fetchStoredEntries(controller.signal);
		if (fetchedEntries) {
			Object.assign(entries, fetchedEntries);
			hydrated = true;
		}
	} catch {}
	clearTimeout(timeout);

	const agentState = await fetchAgentStateEntry();
	hydrating = true;
	try {
		if (agentState.ok && agentState.value) {
			localStorage.setItem(AGENT_STATE_STORAGE_KEY, agentState.value);
		} else if (agentState.ok) {
			resetEntries = collectAgentResetEntries(entries);
			Object.assign(entries, resetEntries);
		}
	} catch {
	} finally {
		hydrating = false;
	}

	hydrating = true;
	try {
		for (const [key, value] of Object.entries(entries)) {
			if (key === AGENT_STATE_STORAGE_KEY && value === null) {
				try {
					localStorage.removeItem(key);
				} catch {}
				continue;
			}
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

	if (resetEntries) {
		sendStoragePatch(resetEntries).catch(noop);
	} else if (hydrated) {
		syncAllStoredValues().catch(noop);
	}
}

if (typeof window !== "undefined") {
	window.addEventListener("pagehide", () => flushPendingSync(true));
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushPendingSync(true);
	});
}
