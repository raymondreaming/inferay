import { dispatchWindowEvent } from "../../shared/lib/data.ts";
import { sendJson } from "../backend/http.ts";
export const ONBOARDING_DONE_STORAGE_KEY = "inferay-onboarding-done";
export const APP_THEME_STORAGE_KEY = "inferay-app-theme-id";
export const APP_BACKGROUND_STORAGE_KEY = "inferay-app-background";
export const APP_FONT_STORAGE_KEY = "inferay-app-font";
let storageKeyPattern: RegExp | undefined;
function shouldSyncClientStorageKey(key: string): boolean {
	return storageKeyPattern?.test(key) ?? false;
}

import { noop } from "../../shared/lib/data.ts";

type StoredValue = string | null;
interface ClientStoragePayload {
	storageKeyPattern: string;
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
	try {
		return localStorage.getItem(key) !== serverValue;
	} catch {
		return false;
	}
}
async function sendStoragePatch(entries: Record<string, StoredValue>) {
	await sendJson("/api/client-storage", { entries }, { method: "PUT" });
}

function sendStorageBeacon(entries: Record<string, StoredValue>): boolean {
	if (typeof navigator === "undefined" || !navigator.sendBeacon) return false;
	return navigator.sendBeacon(
		"/api/client-storage",
		new Blob(
			[
				JSON.stringify({
					entries,
				}),
			],
			{
				type: "application/json",
			},
		),
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
	dispatchWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, {
		key,
		value,
	});
	if (syncTimer) return;
	syncTimer = setTimeout(flushPendingSync, 250);
}
async function syncAllStoredValues(): Promise<void> {
	await sendStoragePatch(readLocalEntries());
}
export async function hydrateStoredValues(): Promise<void> {
	if (typeof window === "undefined") return;
	try {
		const response = await fetch("/api/client-storage", {
			signal: AbortSignal.timeout(HYDRATION_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error("Could not load saved preferences");
		const payload = (await response.json()) as ClientStoragePayload;
		if (!payload.entries) throw new Error("Missing saved preferences");
		if (!payload.storageKeyPattern)
			throw new Error("Missing native storage policy");
		storageKeyPattern = new RegExp(payload.storageKeyPattern);
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
export function readStoredJson<T>(key: string, fallback: T): T {
	try {
		const stored = localStorage.getItem(key);
		return stored ? (JSON.parse(stored) as T) : fallback;
	} catch {
		return fallback;
	}
}
export function writeStoredJson<T>(key: string, value: T) {
	try {
		writeStoredValue(key, JSON.stringify(value));
	} catch {}
}
export function readStoredValue(
	key: string,
	fallback: string | null = null,
): string | null {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeStoredValue(key: string, value: string): void {
	try {
		if (localStorage.getItem(key) === value) return;
		localStorage.setItem(key, value);
		syncStoredValue(key, value);
	} catch {}
}
export function removeStoredValue(key: string): void {
	try {
		if (localStorage.getItem(key) === null) return;
		localStorage.removeItem(key);
		syncStoredValue(key, null);
	} catch {}
}
export function readStoredBoolean(key: string, fallback = false): boolean {
	const stored = readStoredValue(key);
	if (stored === null) return fallback;
	return stored === "true";
}
