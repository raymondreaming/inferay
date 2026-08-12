import { isChatMessageStorageKey } from "../../lib/client-storage-keys.ts";
import { hasRole, isString, noop } from "../../lib/data.ts";
import { postJson, sendJson } from "../../lib/fetch-json.ts";
import {
	readStoredJson,
	readStoredValue,
	removeStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../lib/stored-json.ts";
import {
	type ChatLoadingState,
	type ChatMessage,
	type CheckpointInfo,
	compactAdjacentDuplicateTranscriptMessages,
	prepareTranscriptForStorage,
	type QueuedMessageInfo,
	trimMessages,
} from "./agent-chat-shared.ts";

const LEGACY_MESSAGES_KEY_PREFIX = "inferay-chat-";
const MESSAGE_SAVE_INTERVAL_MS = 2500;
const SESSION_KEY_PREFIX = "inferay-chat-session-";
const INPUT_KEY_PREFIX = "inferay-chat-input-";
const CHECKPOINT_KEY_PREFIX = "inferay-checkpoints-";
const MODEL_KEY_PREFIX = "inferay-chat-model-";
const REASONING_KEY_PREFIX = "inferay-chat-reasoning-";
const PENDING_SEND_KEY_PREFIX = "inferay-chat-pending-send-";
const SUMMARY_KEY_PREFIX = "inferay-chat-summary-";
const PENDING_WORKSPACE_KEY_PREFIX = "inferay-chat-pending-workspace-";
const QUEUE_KEY_PREFIX = "inferay-chat-queue-";
const PREFERENCES_STORAGE_KEY = "inferay-db-preferences";
const STALE_CHAT_DB_STORAGE_KEYS = [
	"inferay-db-conversations",
	"inferay-db-messages",
] as const;
const DEFAULT_CHAT_RUN_STATUS: ChatLoadingState = {
	isLoading: false,
	status: "idle",
	startTime: null,
};
const CHAT_CACHE_DB = "inferay-chat-cache";
const CHAT_CONVERSATIONS_STORE = "conversations";
const CHAT_MESSAGES_STORE = "messages";
const pendingSummaryRequests = new Set<string>();
const pendingQueueFileSaves = new Map<
	string,
	{ queue: unknown[]; inFlight: boolean }
>();
const chatMessageReadModels = new Map<string, ChatMessageReadModel>();
const chatCheckpointReadModels = new Map<string, ChatCheckpointReadModel>();
const chatQueueReadModels = new Map<string, ChatQueueReadModel>();
const chatRunStatusReadModels = new Map<string, ChatRunStatusReadModel>();
let chatCacheDbPromise: Promise<IDBDatabase | null> | null = null;
let messageLifecycleFlushRegistered = false;

type DbPreference = {
	id: string;
	valueJson: string;
	updatedAt: number;
};

type ChatMessageReadModelListener = () => void;
type ChatCheckpointReadModelListener = () => void;
type ChatQueueReadModelListener = () => void;
type ChatRunStatusReadModelListener = () => void;

export interface ChatMessageReadModel {
	flush: () => void;
	get: () => ChatMessage[];
	getSnapshot: () => ChatMessage[];
	loadAsync: () => Promise<void>;
	saveNow: (messages: ChatMessage[]) => ChatMessage[];
	set: (
		update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
	) => void;
	setSummaryChangeCallback: (callback: () => void) => void;
	subscribe: (listener: ChatMessageReadModelListener) => () => void;
}

export interface ChatCheckpointReadModel {
	clear: () => void;
	getSnapshot: () => CheckpointInfo[];
	recordFinalized: (
		event: {
			checkpointId: string;
			changedFileCount: number;
			changedFiles: CheckpointInfo["changedFiles"];
			timestamp?: number;
		},
		messages: readonly ChatMessage[],
	) => void;
	markReverted: (checkpointId: string) => void;
	set: (
		update: CheckpointInfo[] | ((prev: CheckpointInfo[]) => CheckpointInfo[]),
	) => void;
	subscribe: (listener: ChatCheckpointReadModelListener) => () => void;
}

export interface ChatQueueReadModel {
	get: () => QueuedMessageInfo[];
	getSnapshot: () => QueuedMessageInfo[];
	loadAsync: () => Promise<void>;
	replaceFromServer: (messages: QueuedMessageInfo[]) => void;
	setLocal: (
		update:
			| QueuedMessageInfo[]
			| ((prev: QueuedMessageInfo[]) => QueuedMessageInfo[]),
	) => void;
	subscribe: (listener: ChatQueueReadModelListener) => () => void;
}

export interface ChatRunStatusReadModel {
	clear: () => ChatLoadingState;
	get: () => ChatLoadingState;
	getSnapshot: () => ChatLoadingState;
	set: (
		update: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState),
	) => ChatLoadingState;
	subscribe: (listener: ChatRunStatusReadModelListener) => () => void;
}

function openChatCacheDb(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") return Promise.resolve(null);
	chatCacheDbPromise ??= new Promise((resolve) => {
		const request = indexedDB.open(CHAT_CACHE_DB, 2);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(CHAT_CONVERSATIONS_STORE)) {
				db.createObjectStore(CHAT_CONVERSATIONS_STORE, { keyPath: "paneId" });
			}
			if (!db.objectStoreNames.contains(CHAT_MESSAGES_STORE)) {
				const messages = db.createObjectStore(CHAT_MESSAGES_STORE, {
					keyPath: "storageId",
				});
				messages.createIndex("paneOrder", ["paneId", "order"]);
				messages.createIndex("paneId", "paneId");
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
	});
	return chatCacheDbPromise;
}

async function readIndexedChatMessages<T>(paneId: string): Promise<T[]> {
	const db = await openChatCacheDb();
	if (!db) return [];
	return new Promise((resolve) => {
		const tx = db.transaction(CHAT_MESSAGES_STORE, "readonly");
		const index = tx.objectStore(CHAT_MESSAGES_STORE).index("paneOrder");
		const range = IDBKeyRange.bound([paneId, -Infinity], [paneId, Infinity]);
		const request = index.getAll(range);
		request.onsuccess = () => {
			const rows = Array.isArray(request.result) ? request.result : [];
			resolve(rows.map((row) => (row as { message: T }).message));
		};
		request.onerror = () => resolve([]);
	});
}

async function writeIndexedChatMessages<T>(
	paneId: string,
	messages: T[],
): Promise<void> {
	const db = await openChatCacheDb();
	if (!db) return;
	await new Promise<void>((resolve) => {
		const tx = db.transaction(
			[CHAT_CONVERSATIONS_STORE, CHAT_MESSAGES_STORE],
			"readwrite",
		);
		tx.objectStore(CHAT_CONVERSATIONS_STORE).put({
			paneId,
			messageCount: messages.length,
			updatedAt: Date.now(),
		});
		const messageStore = tx.objectStore(CHAT_MESSAGES_STORE);
		const paneIndex = messageStore.index("paneId");
		const existingRequest = paneIndex.getAllKeys(paneId);
		existingRequest.onsuccess = () => {
			const nextIds = new Set<string>();
			for (let order = 0; order < messages.length; order++) {
				const message = messages[order] as { id?: unknown };
				if (typeof message.id !== "string") continue;
				const storageId = `${paneId}:${message.id}`;
				nextIds.add(storageId);
				messageStore.put({
					storageId,
					paneId,
					messageId: message.id,
					order,
					message,
				});
			}
			for (const key of existingRequest.result) {
				if (typeof key === "string" && !nextIds.has(key)) {
					messageStore.delete(key);
				}
			}
		};
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
		tx.onabort = () => resolve();
	});
}

async function deleteIndexedChatMessages(paneId: string): Promise<void> {
	const db = await openChatCacheDb();
	if (!db) return;
	await new Promise<void>((resolve) => {
		const tx = db.transaction(
			[CHAT_CONVERSATIONS_STORE, CHAT_MESSAGES_STORE],
			"readwrite",
		);
		tx.objectStore(CHAT_CONVERSATIONS_STORE).delete(paneId);
		const messageStore = tx.objectStore(CHAT_MESSAGES_STORE);
		const request = messageStore.index("paneId").getAllKeys(paneId);
		request.onsuccess = () => {
			for (const key of request.result) messageStore.delete(key);
		};
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
		tx.onabort = () => resolve();
	});
}

function storageKey(prefix: string, paneId: string): string {
	return prefix + paneId;
}

function readPaneJson<T>(prefix: string, paneId: string, fallback: T): T {
	return readStoredJson(storageKey(prefix, paneId), fallback);
}

function writePaneJson<T>(prefix: string, paneId: string, value: T) {
	writeStoredJson(storageKey(prefix, paneId), value);
}

function readPaneValue(
	prefix: string,
	paneId: string,
	fallback: string | null = null,
): string | null {
	return readStoredValue(storageKey(prefix, paneId), fallback);
}

function writePaneValue(prefix: string, paneId: string, value: string | null) {
	if (value) writeStoredValue(storageKey(prefix, paneId), value);
	else removePaneValue(prefix, paneId);
}

function removePaneValue(prefix: string, paneId: string) {
	removeStoredValue(storageKey(prefix, paneId));
}

function readPreferenceRows(): DbPreference[] {
	const rows = readStoredJson<unknown>(PREFERENCES_STORAGE_KEY, []);
	if (!Array.isArray(rows)) return [];
	return rows.filter(
		(row): row is DbPreference =>
			!!row &&
			typeof row === "object" &&
			typeof (row as DbPreference).id === "string" &&
			typeof (row as DbPreference).valueJson === "string" &&
			typeof (row as DbPreference).updatedAt === "number",
	);
}

function loadPreference<T>(id: string, fallback: T): T {
	const value = readPreferenceRows().find((row) => row.id === id)?.valueJson;
	return value ? JSON.parse(value) : fallback;
}

function savePreference(id: string, value: unknown) {
	const valueJson = JSON.stringify(value);
	const rows = readPreferenceRows();
	const index = rows.findIndex((row) => row.id === id);
	if (index >= 0 && rows[index]?.valueJson === valueJson) return;
	const row = { id, valueJson, updatedAt: Date.now() };
	if (index >= 0) rows[index] = row;
	else rows.push(row);
	writeStoredJson(PREFERENCES_STORAGE_KEY, rows);
}

function removePreference(id: string) {
	const rows = readPreferenceRows();
	const next = rows.filter((row) => row.id !== id);
	if (next.length === rows.length) return;
	if (next.length === 0) removeStoredValue(PREFERENCES_STORAGE_KEY);
	else writeStoredJson(PREFERENCES_STORAGE_KEY, next);
}

function listLocalStorageKeys(): string[] {
	try {
		return Array.from({ length: localStorage.length }, (_, index) =>
			localStorage.key(index),
		).filter(isString);
	} catch {
		return [];
	}
}

function isStaleChatPreferenceId(id: string): boolean {
	return isChatMessageStorageKey(id) || id.startsWith(QUEUE_KEY_PREFIX);
}

function cleanupStalePreferenceRows() {
	const rows = readPreferenceRows();
	const kept = rows.filter((row) => !isStaleChatPreferenceId(row.id));
	if (kept.length === rows.length) return;
	if (kept.length === 0) removeStoredValue(PREFERENCES_STORAGE_KEY);
	else writeStoredJson(PREFERENCES_STORAGE_KEY, kept);
}

export function cleanupStaleChatClientStorage() {
	for (const staleChatDbKey of STALE_CHAT_DB_STORAGE_KEYS) {
		removeStoredValue(staleChatDbKey);
	}
	for (const key of listLocalStorageKeys()) {
		if (isChatMessageStorageKey(key) || key.startsWith(QUEUE_KEY_PREFIX)) {
			removeStoredValue(key);
		}
	}
	cleanupStalePreferenceRows();
}

cleanupStaleChatClientStorage();

export function loadStoredMessages<T>(paneId: string): T[] {
	removePaneValue(LEGACY_MESSAGES_KEY_PREFIX, paneId);
	return [];
}

export function loadStoredMessagesAsync<T>(paneId: string): Promise<T[]> {
	return readIndexedChatMessages<T>(paneId);
}

export function saveStoredMessages<T>(paneId: string, messages: T[]) {
	removePaneValue(LEGACY_MESSAGES_KEY_PREFIX, paneId);
	void writeIndexedChatMessages(paneId, messages);
}

function dedupeStoredChatMessages<T extends { id: string }>(
	messages: T[],
): T[] {
	let hasDuplicate = false;
	const seen = new Set<string>();
	for (const message of messages) {
		if (seen.has(message.id)) {
			hasDuplicate = true;
			break;
		}
		seen.add(message.id);
	}
	if (!hasDuplicate) return messages;

	const byId = new Map<string, T>();
	for (const message of messages) {
		if (byId.has(message.id)) byId.delete(message.id);
		byId.set(message.id, message);
	}
	return [...byId.values()];
}

function prepareChatMessagesForStorage(messages: ChatMessage[]): ChatMessage[] {
	return prepareTranscriptForStorage(
		trimMessages(
			compactAdjacentDuplicateTranscriptMessages(
				dedupeStoredChatMessages(messages),
			),
		),
	) as ChatMessage[];
}

function loadInitialChatMessages(paneId: string): ChatMessage[] {
	return compactAdjacentDuplicateTranscriptMessages(
		dedupeStoredChatMessages(
			loadStoredMessages<ChatMessage>(paneId).map((message) => ({
				...message,
				isStreaming: false,
			})),
		),
	);
}

function registerMessageLifecycleFlush() {
	if (messageLifecycleFlushRegistered || typeof window === "undefined") return;
	messageLifecycleFlushRegistered = true;
	const flushAll = () => {
		for (const model of chatMessageReadModels.values()) model.flush();
	};
	window.addEventListener("beforeunload", flushAll);
	window.addEventListener("pagehide", flushAll);
}

function createChatMessageReadModel(paneId: string): ChatMessageReadModel {
	let messages = loadInitialChatMessages(paneId);
	const listeners = new Set<ChatMessageReadModelListener>();
	let loadStarted = false;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingSave: ChatMessage[] | null = null;
	let _summary: string | null = null;
	let summaryChangeCallback = noop;

	const notify = () => {
		for (const listener of listeners) listener();
	};
	const flush = () => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (!pendingSave) return;
		saveStoredMessages(paneId, prepareChatMessagesForStorage(pendingSave));
		pendingSave = null;
	};
	const saveNow = (nextMessages: ChatMessage[]) => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		const storedMessages = prepareChatMessagesForStorage(nextMessages);
		saveStoredMessages(paneId, storedMessages);
		pendingSave = null;
		return storedMessages;
	};
	const scheduleSave = (nextMessages: ChatMessage[]) => {
		pendingSave = nextMessages;
		_summary ??= deriveStoredSummary(
			paneId,
			nextMessages,
			summaryChangeCallback,
		);
		if (saveTimer) return;
		saveTimer = setTimeout(flush, MESSAGE_SAVE_INTERVAL_MS);
	};
	const set = (
		update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
	) => {
		const next =
			typeof update === "function"
				? (update as (prev: ChatMessage[]) => ChatMessage[])(messages)
				: update;
		const deduped = trimMessages(
			compactAdjacentDuplicateTranscriptMessages(
				dedupeStoredChatMessages(next),
			),
		);
		if (deduped === messages) return;
		messages = deduped;
		scheduleSave(deduped);
		notify();
	};
	const loadAsync = async () => {
		if (loadStarted) return;
		loadStarted = true;
		const cachedMessages = await loadStoredMessagesAsync<ChatMessage>(paneId);
		if (cachedMessages.length === 0 || messages.length > 0) return;
		const nextMessages = trimMessages(
			compactAdjacentDuplicateTranscriptMessages(
				dedupeStoredChatMessages(
					cachedMessages.map((message) => ({
						...message,
						isStreaming: false,
					})),
				),
			),
		);
		if (nextMessages.length === 0) return;
		messages = nextMessages;
		notify();
	};

	registerMessageLifecycleFlush();
	return {
		flush,
		get: () => messages,
		getSnapshot: () => messages,
		loadAsync,
		saveNow,
		set,
		setSummaryChangeCallback: (callback) => {
			summaryChangeCallback = callback;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export function getChatMessageReadModel(paneId: string): ChatMessageReadModel {
	let model = chatMessageReadModels.get(paneId);
	if (!model) {
		model = createChatMessageReadModel(paneId);
		chatMessageReadModels.set(paneId, model);
	}
	return model;
}

export function loadStoredInput(paneId: string): string {
	return loadPreference(
		storageKey(INPUT_KEY_PREFIX, paneId),
		readPaneValue(INPUT_KEY_PREFIX, paneId, "") ?? "",
	);
}

export function saveStoredInput(paneId: string, value: string) {
	writePaneValue(INPUT_KEY_PREFIX, paneId, value);
	savePreference(storageKey(INPUT_KEY_PREFIX, paneId), value);
}

export function loadPendingSend(paneId: string): string {
	return loadPreference(
		storageKey(PENDING_SEND_KEY_PREFIX, paneId),
		readPaneValue(PENDING_SEND_KEY_PREFIX, paneId, "") ?? "",
	);
}

export function savePendingSend(paneId: string, value: string) {
	writePaneValue(PENDING_SEND_KEY_PREFIX, paneId, value);
	savePreference(storageKey(PENDING_SEND_KEY_PREFIX, paneId), value);
}

export function clearPendingSend(paneId: string) {
	removePaneValue(PENDING_SEND_KEY_PREFIX, paneId);
	removePreference(storageKey(PENDING_SEND_KEY_PREFIX, paneId));
}

export function loadStoredCheckpoints<T>(paneId: string): T[] {
	return loadPreference(
		storageKey(CHECKPOINT_KEY_PREFIX, paneId),
		readPaneJson(CHECKPOINT_KEY_PREFIX, paneId, []),
	);
}

export function saveStoredCheckpoints<T>(paneId: string, checkpoints: T[]) {
	writePaneJson(CHECKPOINT_KEY_PREFIX, paneId, checkpoints);
	savePreference(storageKey(CHECKPOINT_KEY_PREFIX, paneId), checkpoints);
}

function createChatCheckpointReadModel(
	paneId: string,
): ChatCheckpointReadModel {
	let checkpoints = loadStoredCheckpoints<CheckpointInfo>(paneId);
	const listeners = new Set<ChatCheckpointReadModelListener>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const set = (
		update: CheckpointInfo[] | ((prev: CheckpointInfo[]) => CheckpointInfo[]),
	) => {
		const next = typeof update === "function" ? update(checkpoints) : update;
		if (next === checkpoints) return;
		checkpoints = next;
		saveStoredCheckpoints(paneId, next);
		notify();
	};
	return {
		clear: () => set([]),
		getSnapshot: () => checkpoints,
		markReverted: (checkpointId) => {
			set((prev) =>
				prev.map((checkpoint) =>
					checkpoint.id === checkpointId
						? { ...checkpoint, reverted: true }
						: checkpoint,
				),
			);
		},
		recordFinalized: (event, messages) => {
			if (event.changedFileCount <= 0) return;
			const lastMessage =
				messages.findLast?.(
					(message) => message.role === "assistant" && !message.isStreaming,
				) ?? messages.findLast?.((message) => message.role === "assistant");
			if (!lastMessage) return;
			set((prev) => {
				if (
					prev.some(
						(checkpoint) => checkpoint.afterMessageId === lastMessage.id,
					)
				) {
					return prev;
				}
				return [
					...prev,
					{
						id: event.checkpointId,
						timestamp: event.timestamp ?? Date.now(),
						changedFileCount: event.changedFileCount,
						changedFiles: event.changedFiles,
						reverted: false,
						afterMessageId: lastMessage.id,
					},
				];
			});
		},
		set,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export function getChatCheckpointReadModel(
	paneId: string,
): ChatCheckpointReadModel {
	let model = chatCheckpointReadModels.get(paneId);
	if (!model) {
		model = createChatCheckpointReadModel(paneId);
		chatCheckpointReadModels.set(paneId, model);
	}
	return model;
}

export function loadStoredSessionId(paneId: string): string | null {
	return loadPreference(
		storageKey(SESSION_KEY_PREFIX, paneId),
		readPaneValue(SESSION_KEY_PREFIX, paneId),
	);
}

export function saveStoredSessionId(paneId: string, sessionId: string) {
	writePaneValue(SESSION_KEY_PREFIX, paneId, sessionId);
	savePreference(storageKey(SESSION_KEY_PREFIX, paneId), sessionId);
}

export function clearStoredSessionId(paneId: string) {
	removePaneValue(SESSION_KEY_PREFIX, paneId);
	removePreference(storageKey(SESSION_KEY_PREFIX, paneId));
}

export function loadStoredModel(paneId: string): string | null {
	return loadPreference(
		storageKey(MODEL_KEY_PREFIX, paneId),
		readPaneValue(MODEL_KEY_PREFIX, paneId),
	);
}

export function saveStoredModel(paneId: string, modelId: string) {
	writePaneValue(MODEL_KEY_PREFIX, paneId, modelId);
	savePreference(storageKey(MODEL_KEY_PREFIX, paneId), modelId);
}

export function loadStoredReasoningLevel(paneId: string): string | null {
	return loadPreference(
		storageKey(REASONING_KEY_PREFIX, paneId),
		readPaneValue(REASONING_KEY_PREFIX, paneId),
	);
}

export function saveStoredReasoningLevel(
	paneId: string,
	reasoningLevel: string,
) {
	writePaneValue(REASONING_KEY_PREFIX, paneId, reasoningLevel);
	savePreference(storageKey(REASONING_KEY_PREFIX, paneId), reasoningLevel);
}

function loadStoredSummary(paneId: string): string | null {
	return loadPreference(
		storageKey(SUMMARY_KEY_PREFIX, paneId),
		readPaneValue(SUMMARY_KEY_PREFIX, paneId),
	);
}

function saveStoredSummary(paneId: string, summary: string) {
	writePaneValue(SUMMARY_KEY_PREFIX, paneId, summary);
	savePreference(storageKey(SUMMARY_KEY_PREFIX, paneId), summary);
}

export function deriveStoredSummary(
	paneId: string,
	messages: { role: string; content: string }[] = [],
	onStored?: () => void,
): string | null {
	const existing = loadStoredSummary(paneId);
	if (existing) return existing;
	const firstUser = messages.find(hasRole.bind(null, "user"));
	if (!firstUser?.content) return null;
	if (!pendingSummaryRequests.has(paneId)) {
		pendingSummaryRequests.add(paneId);
		postJson<{ title?: string }>("/api/generate-title", {
			message: firstUser.content,
		})
			.then((data) => {
				const title = data?.title?.trim();
				if (!title) return;
				saveStoredSummary(paneId, title);
				onStored?.();
			})
			.catch(noop)
			.finally(() => pendingSummaryRequests.delete(paneId));
	}
	const text = firstUser.content.trim().split("\n")[0] ?? "";
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export function loadPendingWorkspacePaths(paneId: string): string[] {
	const parsed = readPaneJson<unknown>(
		PENDING_WORKSPACE_KEY_PREFIX,
		paneId,
		[],
	);
	return Array.isArray(parsed) ? parsed.filter(isString) : [];
}

export function savePendingWorkspacePaths(paneId: string, paths: string[]) {
	if (paths.length === 0) removePaneValue(PENDING_WORKSPACE_KEY_PREFIX, paneId);
	else writePaneJson(PENDING_WORKSPACE_KEY_PREFIX, paneId, paths);
	savePreference(storageKey(PENDING_WORKSPACE_KEY_PREFIX, paneId), paths);
}

export function loadStoredQueue<T>(paneId: string): T[] {
	removePaneValue(QUEUE_KEY_PREFIX, paneId);
	removePreference(storageKey(QUEUE_KEY_PREFIX, paneId));
	return [];
}

export async function loadFileBackedQueue<T>(
	paneId: string,
): Promise<T[] | null> {
	try {
		const response = await fetch(
			`/api/chat-queues/${encodeURIComponent(paneId)}`,
		);
		if (!response.ok) return null;
		const payload = (await response.json()) as { queue?: unknown };
		return Array.isArray(payload.queue) ? (payload.queue as T[]) : null;
	} catch {
		return null;
	}
}

async function saveFileBackedQueue<T>(
	paneId: string,
	queue: T[],
): Promise<void> {
	if (queue.length === 0) {
		await fetch(`/api/chat-queues/${encodeURIComponent(paneId)}`, {
			method: "DELETE",
		});
		return;
	}
	await sendJson(
		`/api/chat-queues/${encodeURIComponent(paneId)}`,
		{ queue },
		{ method: "PUT" },
	);
}

async function flushQueuedFileSave(
	paneId: string,
	state: { queue: unknown[]; inFlight: boolean },
) {
	state.inFlight = true;
	while (pendingQueueFileSaves.get(paneId) === state) {
		const queue = state.queue;
		try {
			await saveFileBackedQueue(paneId, queue);
		} catch {
			pendingQueueFileSaves.delete(paneId);
			break;
		}
		if (state.queue === queue) {
			pendingQueueFileSaves.delete(paneId);
			break;
		}
	}
	state.inFlight = false;
}

function saveLatestFileBackedQueue(paneId: string, queue: unknown[]) {
	const state = pendingQueueFileSaves.get(paneId) ?? {
		queue,
		inFlight: false,
	};
	state.queue = queue;
	pendingQueueFileSaves.set(paneId, state);
	if (!state.inFlight) void flushQueuedFileSave(paneId, state);
}

export function saveStoredQueue<T>(paneId: string, queue: T[]) {
	removePaneValue(QUEUE_KEY_PREFIX, paneId);
	removePreference(storageKey(QUEUE_KEY_PREFIX, paneId));
	saveLatestFileBackedQueue(paneId, queue);
}

function areQueuedMessagesEqual(
	prev: QueuedMessageInfo[],
	next: QueuedMessageInfo[],
) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.id !== b.id ||
			a.text !== b.text ||
			a.displayText !== b.displayText ||
			a.transient !== b.transient ||
			(a.images?.length ?? 0) !== (b.images?.length ?? 0)
		) {
			return false;
		}
		const imagesA = a.images ?? [];
		const imagesB = b.images ?? [];
		for (let j = 0; j < imagesA.length; j++) {
			if (imagesA[j] !== imagesB[j]) return false;
		}
	}
	return true;
}

function createChatQueueReadModel(paneId: string): ChatQueueReadModel {
	let queue = loadStoredQueue<QueuedMessageInfo>(paneId);
	let revision = 0;
	let loadStarted = false;
	const listeners = new Set<ChatQueueReadModelListener>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const setSnapshot = (
		next: QueuedMessageInfo[],
		options: { persist: boolean },
	) => {
		if (areQueuedMessagesEqual(queue, next)) return;
		revision++;
		queue = next;
		if (options.persist) saveStoredQueue(paneId, next);
		notify();
	};
	const setLocal = (
		update:
			| QueuedMessageInfo[]
			| ((prev: QueuedMessageInfo[]) => QueuedMessageInfo[]),
	) => {
		const next = typeof update === "function" ? update(queue) : update;
		setSnapshot(next, { persist: true });
	};
	const loadAsync = async () => {
		if (loadStarted) return;
		loadStarted = true;
		const revisionAtLoad = revision;
		const fileBackedQueue =
			await loadFileBackedQueue<QueuedMessageInfo>(paneId);
		if (fileBackedQueue === null || revision !== revisionAtLoad) return;
		setSnapshot(fileBackedQueue, { persist: false });
	};
	return {
		get: () => queue,
		getSnapshot: () => queue,
		loadAsync,
		replaceFromServer: (messages) => setSnapshot(messages, { persist: false }),
		setLocal,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export function getChatQueueReadModel(paneId: string): ChatQueueReadModel {
	let model = chatQueueReadModels.get(paneId);
	if (!model) {
		model = createChatQueueReadModel(paneId);
		chatQueueReadModels.set(paneId, model);
	}
	return model;
}

function createChatRunStatusReadModel(): ChatRunStatusReadModel {
	let runStatus = DEFAULT_CHAT_RUN_STATUS;
	const listeners = new Set<ChatRunStatusReadModelListener>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const set = (
		update: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState),
	) => {
		const next = typeof update === "function" ? update(runStatus) : update;
		if (
			runStatus.isLoading === next.isLoading &&
			runStatus.status === next.status &&
			runStatus.startTime === next.startTime
		) {
			return runStatus;
		}
		runStatus = next;
		notify();
		return runStatus;
	};
	return {
		clear: () => set(DEFAULT_CHAT_RUN_STATUS),
		get: () => runStatus,
		getSnapshot: () => runStatus,
		set,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export function getChatRunStatusReadModel(
	paneId: string,
): ChatRunStatusReadModel {
	let model = chatRunStatusReadModels.get(paneId);
	if (!model) {
		model = createChatRunStatusReadModel();
		chatRunStatusReadModels.set(paneId, model);
	}
	return model;
}

export function clearAgentChatPaneState(paneId: string) {
	chatMessageReadModels.get(paneId)?.flush();
	chatMessageReadModels.delete(paneId);
	chatCheckpointReadModels.delete(paneId);
	chatQueueReadModels.delete(paneId);
	chatRunStatusReadModels.get(paneId)?.clear();
	chatRunStatusReadModels.delete(paneId);
	for (const prefix of [
		LEGACY_MESSAGES_KEY_PREFIX,
		SESSION_KEY_PREFIX,
		INPUT_KEY_PREFIX,
		CHECKPOINT_KEY_PREFIX,
		SUMMARY_KEY_PREFIX,
		PENDING_WORKSPACE_KEY_PREFIX,
	]) {
		removePaneValue(prefix, paneId);
		removePreference(storageKey(prefix, paneId));
	}
	void deleteIndexedChatMessages(paneId);
	saveStoredQueue(paneId, []);
}
