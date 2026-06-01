import {
	chatMessagesContainUnseenIds,
	chatMessagesScore,
	mergeChatMessageStorageValues,
} from "./chat-message-storage.ts";
import {
	isChatMessagesStorageKey,
	isChatQueueStorageKey,
	shouldSyncClientStorageKey,
	TERMINAL_LAYOUT_MODE_STORAGE_KEY,
	TERMINAL_MAIN_VIEW_STORAGE_KEY,
	TERMINAL_STATE_STORAGE_KEY,
} from "./client-storage-keys.ts";
import { noop } from "./data.ts";
import { dispatchTerminalShellChange } from "./terminal-shell-events.ts";

type StoredValue = string | null;

interface ClientStoragePayload {
	entries?: Record<string, StoredValue>;
}

interface SyncedTerminalPane {
	id?: unknown;
}

interface SyncedTerminalGroup {
	id?: unknown;
	selectedPaneId?: unknown;
	panes?: SyncedTerminalPane[];
}

interface SyncedTerminalState {
	selectedGroupId?: unknown;
	groups?: SyncedTerminalGroup[];
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
	TERMINAL_LAYOUT_MODE_STORAGE_KEY,
	TERMINAL_MAIN_VIEW_STORAGE_KEY,
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

function storedArrayScore(value: string | null): number {
	if (!value) return 0;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return 0;
		return parsed.reduce((score, item) => {
			if (typeof item !== "object" || item === null) return score + 1;
			const text =
				typeof (item as { text?: unknown }).text === "string"
					? (item as { text: string }).text
					: "";
			return score + 1 + text.length;
		}, 0);
	} catch {
		return 0;
	}
}

function parseSyncedTerminalState(
	value: string | null
): SyncedTerminalState | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!Array.isArray((parsed as SyncedTerminalState).groups)
		) {
			return null;
		}
		return parsed as SyncedTerminalState;
	} catch {
		return null;
	}
}

function hasGroupId(
	groups: readonly SyncedTerminalGroup[],
	groupId: unknown
): boolean {
	return (
		typeof groupId === "string" && groups.some((group) => group.id === groupId)
	);
}

function hasPaneId(group: SyncedTerminalGroup, paneId: unknown): boolean {
	return (
		typeof paneId === "string" &&
		Array.isArray(group.panes) &&
		group.panes.some((pane) => pane.id === paneId)
	);
}

function collectTerminalShellIds(state: SyncedTerminalState): {
	groupIds: Set<string>;
	paneIds: Set<string>;
} {
	const groupIds = new Set<string>();
	const paneIds = new Set<string>();
	for (const group of state.groups ?? []) {
		if (typeof group.id === "string") groupIds.add(group.id);
		for (const pane of group.panes ?? []) {
			if (typeof pane.id === "string") paneIds.add(pane.id);
		}
	}
	return { groupIds, paneIds };
}

export function remoteTerminalStateRemovesLocalShell(
	remoteValue: string | null,
	localValue: string | null
): boolean {
	const remoteState = parseSyncedTerminalState(remoteValue);
	const localState = parseSyncedTerminalState(localValue);
	if (!remoteState || !localState) return false;

	const remoteIds = collectTerminalShellIds(remoteState);
	const localIds = collectTerminalShellIds(localState);
	const hasSharedShellId =
		[...localIds.groupIds].some((id) => remoteIds.groupIds.has(id)) ||
		[...localIds.paneIds].some((id) => remoteIds.paneIds.has(id));
	if (!hasSharedShellId) return false;

	return (
		[...localIds.groupIds].some((id) => !remoteIds.groupIds.has(id)) ||
		[...localIds.paneIds].some((id) => !remoteIds.paneIds.has(id))
	);
}

export function mergeRemoteTerminalStatePreservingLocalSelection(
	remoteValue: string | null,
	localValue: string | null
): string | null {
	const remoteState = parseSyncedTerminalState(remoteValue);
	const localState = parseSyncedTerminalState(localValue);
	if (
		!remoteState ||
		!localState ||
		!remoteState.groups ||
		!localState.groups
	) {
		return remoteValue;
	}

	const localGroupsById = new Map(
		localState.groups
			.filter((group) => typeof group.id === "string")
			.map((group) => [group.id as string, group])
	);
	const nextGroups = remoteState.groups.map((remoteGroup) => {
		if (typeof remoteGroup.id !== "string") return remoteGroup;
		const localGroup = localGroupsById.get(remoteGroup.id);
		if (!localGroup || !hasPaneId(remoteGroup, localGroup.selectedPaneId)) {
			return remoteGroup;
		}
		return {
			...remoteGroup,
			selectedPaneId: localGroup.selectedPaneId,
		};
	});
	const nextSelectedGroupId = hasGroupId(
		remoteState.groups,
		localState.selectedGroupId
	)
		? localState.selectedGroupId
		: remoteState.selectedGroupId;

	return JSON.stringify({
		...remoteState,
		groups: nextGroups,
		selectedGroupId: nextSelectedGroupId,
	});
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
	const isRemoteTerminalRemoval =
		key === TERMINAL_STATE_STORAGE_KEY &&
		remoteTerminalStateRemovesLocalShell(serverValue, localValue);
	const localWriteAt = localWriteTimes.get(key);
	if (
		localWriteAt &&
		Date.now() - localWriteAt < LOCAL_WRITE_PROTECT_MS &&
		localWriteValues.get(key) === localValue &&
		!isRemoteTerminalRemoval
	) {
		return false;
	}
	if (isChatMessagesStorageKey(key)) {
		const serverScore = chatMessagesScore(serverValue);
		const localScore = chatMessagesScore(localValue);
		if (
			localScore > 0 &&
			localScore > serverScore &&
			!chatMessagesContainUnseenIds(serverValue, localValue)
		) {
			return false;
		}
	}
	if (isChatQueueStorageKey(key)) {
		const serverScore = storedArrayScore(serverValue);
		const localScore = storedArrayScore(localValue);
		if (localScore > 0 && localScore > serverScore) return false;
	}
	if (serverValue === null) return localValue !== null;
	if (localValue === null) return true;
	if (key === TERMINAL_STATE_STORAGE_KEY) {
		const serverScore = terminalStateScore(serverValue);
		const localScore = terminalStateScore(localValue);
		if (serverScore <= 1 && localScore > serverScore) {
			return isRemoteTerminalRemoval;
		}
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

export function flushPendingClientStorageSync(useBeacon = false): void {
	flushPendingSync(useBeacon);
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
			const currentValue = localStorage.getItem(key);
			const nextValue = isChatMessagesStorageKey(key)
				? mergeChatMessageStorageValues(currentValue, value)
				: key === TERMINAL_STATE_STORAGE_KEY
					? mergeRemoteTerminalStatePreservingLocalSelection(
							value,
							currentValue
						)
					: value;
			if (nextValue === currentValue) continue;
			try {
				if (nextValue === null) localStorage.removeItem(key);
				else localStorage.setItem(key, nextValue);
				changedKeys.push(key);
				dispatchStorageChanged(key, nextValue);
			} catch {}
		}
	} finally {
		hydrating = false;
	}
	if (changedKeys.some((key) => TERMINAL_SYNC_KEYS.has(key))) {
		dispatchTerminalShellChange({ source: "client-storage", changedKeys });
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
