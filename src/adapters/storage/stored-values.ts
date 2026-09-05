export const AGENT_STATE_STORAGE_KEY = "inferay-agent-state";
const AGENT_LAYOUT_MODE_STORAGE_KEY = "agent-layout-mode";
const EDITOR_SELECTED_PANE_STORAGE_KEY = "editor-selected-pane";
const MAIN_SIDEBAR_WIDTH_STORAGE_KEY = "main-sidebar-width";
export const ONBOARDING_DONE_STORAGE_KEY = "inferay-onboarding-done";
export const APP_THEME_STORAGE_KEY = "inferay-app-theme-id";
export const APP_BACKGROUND_STORAGE_KEY = "inferay-app-background";
export const APP_FONT_STORAGE_KEY = "inferay-app-font";
const CHAT_MESSAGES_STORAGE_KEY_PREFIX = "inferay-chat-";
const CHAT_SESSION_KEY_PREFIX = "inferay-chat-session-";
const CHAT_INPUT_KEY_PREFIX = "inferay-chat-input-";
const CHAT_CHECKPOINT_KEY_PREFIX = "inferay-checkpoints-";
const CHAT_MODEL_KEY_PREFIX = "inferay-chat-model-";
const CHAT_REASONING_KEY_PREFIX = "inferay-chat-reasoning-";
const CHAT_PENDING_SEND_KEY_PREFIX = "inferay-chat-pending-send-";
const CHAT_SUMMARY_KEY_PREFIX = "inferay-chat-summary-";
const CHAT_PENDING_WORKSPACE_KEY_PREFIX = "inferay-chat-pending-workspace-";
export const CHAT_QUEUE_KEY_PREFIX = "inferay-chat-queue-";
const CHAT_LOADING_STATE_KEY_PREFIX = "inferay-chat-loading-";
const CHAT_COMPOSER_CONTEXT_KEY_PREFIX = "inferay-chat-composer-context-";
const CHAT_WORKTREE_INFO_KEY_PREFIX = "inferay-chat-worktree-";
const CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES = [
	CHAT_SESSION_KEY_PREFIX,
	CHAT_INPUT_KEY_PREFIX,
	CHAT_CHECKPOINT_KEY_PREFIX,
	CHAT_MODEL_KEY_PREFIX,
	CHAT_REASONING_KEY_PREFIX,
	CHAT_PENDING_SEND_KEY_PREFIX,
	CHAT_SUMMARY_KEY_PREFIX,
	CHAT_PENDING_WORKSPACE_KEY_PREFIX,
	CHAT_QUEUE_KEY_PREFIX,
	CHAT_LOADING_STATE_KEY_PREFIX,
	CHAT_COMPOSER_CONTEXT_KEY_PREFIX,
	CHAT_WORKTREE_INFO_KEY_PREFIX,
] as const;
export function isChatMessageStorageKey(key: string): boolean {
	return (
		key.startsWith(CHAT_MESSAGES_STORAGE_KEY_PREFIX) &&
		!CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES.some((prefix) =>
			key.startsWith(prefix),
		)
	);
}
const SYNCED_STORAGE_KEYS = new Set([
	AGENT_STATE_STORAGE_KEY,
	"commit-graph-columns-v5",
	EDITOR_SELECTED_PANE_STORAGE_KEY,
	MAIN_SIDEBAR_WIDTH_STORAGE_KEY,
	"sidebar-collapsed",
	"agent-editor-zen",
	AGENT_LAYOUT_MODE_STORAGE_KEY,
]);
const SYNCED_STORAGE_PREFIXES = [
	"agent-workspace-",
	"git-change-checkpoint:",
	"inferay-",
	"inferay.",
];
export function shouldSyncClientStorageKey(key: string): boolean {
	if (key === AGENT_STATE_STORAGE_KEY) return false;
	if (isChatMessageStorageKey(key)) return false;
	if (key.startsWith(CHAT_QUEUE_KEY_PREFIX)) return false;
	if (key.startsWith(CHAT_LOADING_STATE_KEY_PREFIX)) return false;
	return (
		SYNCED_STORAGE_KEYS.has(key) ||
		SYNCED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
	);
}

import { noop } from "../../shared/lib/data.ts";

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
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			entries,
		}),
	});
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
	window.dispatchEvent(
		new CustomEvent(CLIENT_STORAGE_CHANGED_EVENT, {
			detail: {
				key,
				value,
			},
		}),
	);
	if (syncTimer) return;
	syncTimer = setTimeout(flushPendingSync, 250);
}
async function syncAllStoredValues(): Promise<void> {
	await sendStoragePatch(readLocalEntries());
}
export async function hydrateStoredValues(): Promise<void> {
	if (typeof window === "undefined") return;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HYDRATION_TIMEOUT_MS);
	try {
		const response = await fetch("/api/client-storage", {
			signal: controller.signal,
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
		const stored = JSON.stringify(value);
		if (localStorage.getItem(key) === stored) return;
		localStorage.setItem(key, stored);
		syncStoredValue(key, stored);
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
