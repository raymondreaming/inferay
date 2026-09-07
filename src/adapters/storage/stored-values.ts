import type { AgentLayoutMode } from "../../modules/workspace/components/WorkspaceCanvas/index.tsx";
import {
	dispatchWindowEvent,
	listenWindowEvent,
} from "../../shared/lib/data.ts";

import { sendJson } from "../backend/http.ts";
export const ONBOARDING_DONE_STORAGE_KEY = "inferay-onboarding-done";
export const APP_THEME_STORAGE_KEY = "inferay-app-theme-id";
export const APP_BACKGROUND_STORAGE_KEY = "inferay-app-background";
export const APP_FONT_STORAGE_KEY = "inferay-app-font";
export const CLIENT_STORAGE_CHANGED_EVENT = "inferay-client-storage-change";

type StoredValue = string | null;
let values: Record<string, StoredValue> = {};
let storageKeyPattern: RegExp | undefined;
const pending = new Map<string, StoredValue>();
let timer: ReturnType<typeof setTimeout> | undefined;
let writing = false;

async function flushPending() {
	clearTimeout(timer);
	timer = undefined;
	if (writing || !pending.size) return;
	const entries = Object.fromEntries(pending);
	pending.clear();
	writing = true;
	try {
		const response = await sendJson(
			"/api/client-storage",
			{ entries },
			{ method: "PUT", keepalive: true },
		);
		if (!response.ok) throw new Error("Could not save preferences");
	} catch {
		for (const [key, value] of Object.entries(entries))
			if (!pending.has(key)) pending.set(key, value);
	} finally {
		writing = false;
		if (pending.size) timer = setTimeout(flushPending, 2000);
	}
}
export async function hydrateStoredValues(): Promise<void> {
	const response = await fetch("/api/client-storage", {
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) throw new Error("Could not load saved preferences");
	const payload = await response.json();
	if (!payload.entries || !payload.storageKeyPattern)
		throw new Error("Missing native preferences or storage policy");
	values = payload.entries;
	storageKeyPattern = new RegExp(payload.storageKeyPattern);
}
function setStoredValue(key: string, value: StoredValue) {
	if (values[key] === value || !storageKeyPattern?.test(key)) return;
	values[key] = value;
	pending.set(key, value);
	dispatchWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, { key, value });
	if (!timer) timer = setTimeout(flushPending, 250);
}
if (typeof window !== "undefined") {
	const flushOnHide = () => {
		if (!pending.size) return;
		if (
			navigator.sendBeacon?.(
				"/api/client-storage",
				new Blob([JSON.stringify({ entries: Object.fromEntries(pending) })], {
					type: "application/json",
				}),
			)
		)
			pending.clear();
		else void flushPending();
	};
	window.addEventListener("pagehide", flushOnHide);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushOnHide();
	});
}
export function readStoredValue(
	key: string,
	fallback: string | null = null,
): string | null {
	return values[key] ?? fallback;
}
export function readStoredJson<T>(key: string, fallback: T): T {
	try {
		return JSON.parse(values[key] ?? "null") ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeStoredValue(key: string, value: string): void {
	setStoredValue(key, value);
}
export function removeStoredValue(key: string): void {
	setStoredValue(key, null);
}
export function writeStoredJson<T>(key: string, value: T) {
	writeStoredValue(key, JSON.stringify(value));
}
export function readStoredBoolean(key: string, fallback = false): boolean {
	const value = readStoredValue(key);
	return value === null ? fallback : value === "true";
}

const INPUT_KEY_PREFIX = "inferay-chat-input-";
export function loadStoredInput(paneId: string): string {
	return readStoredValue(INPUT_KEY_PREFIX + paneId, "") ?? "";
}
export function saveStoredInput(paneId: string, value: string) {
	if (value) writeStoredValue(INPUT_KEY_PREFIX + paneId, value);
	else removeStoredValue(INPUT_KEY_PREFIX + paneId);
}
export function clearAgentChatPaneState(paneId: string) {
	removeStoredValue(INPUT_KEY_PREFIX + paneId);
}

export const loadAgentLayoutMode = (): AgentLayoutMode =>
	readStoredValue("agent-layout-mode") === "grid" ? "grid" : "rows";
export const listenAgentLayoutMode = (set: (mode: AgentLayoutMode) => void) =>
	listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
		if (
			(event as CustomEvent<{ key?: string }>).detail?.key ===
			"agent-layout-mode"
		)
			set(loadAgentLayoutMode());
	});
export function setAgentLayoutMode(mode: AgentLayoutMode) {
	writeStoredValue("agent-layout-mode", mode);
}
export const loadSidebarCollapsed = () =>
	readStoredBoolean("sidebar-collapsed");
