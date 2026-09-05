import { postJson } from "../../../adapters/backend/http.ts";
import {
	readStoredJson,
	readStoredValue,
	removeStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import { hasRole, isString, noop } from "../../../shared/lib/data.ts";
import {
	loadAgentState,
	setPaneProviderSession,
} from "../../workspace/model/workspace-model.ts";
import type {
	ChatLoadingState,
	ChatMessage,
	CheckpointInfo,
	QueuedMessageInfo,
} from "./agent-chat-shared.ts";

const INPUT_KEY_PREFIX = "inferay-chat-input-";
const CHECKPOINT_KEY_PREFIX = "inferay-checkpoints-";
const MODEL_KEY_PREFIX = "inferay-chat-model-";
const REASONING_KEY_PREFIX = "inferay-chat-reasoning-";
const SUMMARY_KEY_PREFIX = "inferay-chat-summary-";
const PENDING_WORKSPACE_KEY_PREFIX = "inferay-chat-pending-workspace-";
const DEFAULT_CHAT_RUN_STATUS: ChatLoadingState = {
	isLoading: false,
	status: "idle",
	startTime: null,
};
const pendingSummaryRequests = new Set<string>();
const providerSessionIds = new Map<string, string>();

type ReadModelListener = () => void;

function subscriptions() {
	const listeners = new Set<ReadModelListener>();
	return {
		notify: () => {
			for (const listener of listeners) listener();
		},
		subscribe: (listener: ReadModelListener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

function perPane<T>(create: (paneId: string) => T) {
	const models = new Map<string, T>();
	const get = (paneId: string): T => {
		if (!models.has(paneId)) models.set(paneId, create(paneId));
		return models.get(paneId)!;
	};
	return Object.assign(get, {
		delete: (paneId: string) => models.delete(paneId),
		peek: (paneId: string) => models.get(paneId),
	});
}

function snapshot<T>(
	initial: T,
	changed?: (value: T) => void,
	equal = Object.is,
) {
	let value = initial;
	const events = subscriptions();
	const get = () => value;
	return {
		get,
		getSnapshot: get,
		subscribe: events.subscribe,
		set(update: T | ((previous: T) => T)) {
			const next =
				typeof update === "function"
					? (update as (previous: T) => T)(value)
					: update;
			if (!equal(value, next)) {
				value = next;
				changed?.(next);
				events.notify();
			}
			return value;
		},
	};
}

function writePaneValue(prefix: string, paneId: string, value: string | null) {
	if (value) writeStoredValue(prefix + paneId, value);
	else removeStoredValue(prefix + paneId);
}

function createChatMessageReadModel(paneId: string) {
	let _summary: string | null = null;
	let summaryChangeCallback = noop;
	return {
		...snapshot<ChatMessage[]>([], (next) => {
			// Native snapshots own retention and deduplication.
			_summary ??= deriveStoredSummary(paneId, next, summaryChangeCallback);
		}),
		settle: (messages: ChatMessage[]) =>
			messages.map((message) =>
				message.isStreaming ? { ...message, isStreaming: false } : message,
			),
		setSummaryChangeCallback: (callback: () => void) => {
			summaryChangeCallback = callback;
		},
	};
}

export const getChatMessageReadModel = perPane(createChatMessageReadModel);

export function loadStoredInput(paneId: string): string {
	return readStoredValue(INPUT_KEY_PREFIX + paneId, "") ?? "";
}

export function saveStoredInput(paneId: string, value: string) {
	writePaneValue(INPUT_KEY_PREFIX, paneId, value);
}

export function loadStoredCheckpoints<T>(paneId: string): T[] {
	return readStoredJson(CHECKPOINT_KEY_PREFIX + paneId, []);
}

export function saveStoredCheckpoints<T>(paneId: string, checkpoints: T[]) {
	writeStoredJson(CHECKPOINT_KEY_PREFIX + paneId, checkpoints);
}

function createChatCheckpointReadModel(paneId: string) {
	const model = snapshot(
		loadStoredCheckpoints<CheckpointInfo>(paneId),
		(next) => saveStoredCheckpoints(paneId, next),
	);
	const { set } = model;
	return {
		clear: () => set([]),
		...model,
		markReverted: (checkpointId: string) => {
			set((prev) =>
				prev.map((checkpoint) =>
					checkpoint.id === checkpointId
						? { ...checkpoint, reverted: true }
						: checkpoint,
				),
			);
		},
		recordFinalized: (
			event: {
				checkpointId: string;
				changedFileCount: number;
				changedFiles: CheckpointInfo["changedFiles"];
				timestamp?: number;
			},
			messages: readonly ChatMessage[],
		) => {
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
	};
}

export const getChatCheckpointReadModel = perPane(
	createChatCheckpointReadModel,
);

export function getProviderSessionId(paneId: string): string | null {
	const current = providerSessionIds.get(paneId);
	if (current) return current;
	const paneSessionId = loadAgentState()
		?.groups.flatMap((group) => group.panes)
		.find((pane) => pane.id === paneId)?.providerSessionId;
	if (paneSessionId) {
		providerSessionIds.set(paneId, paneSessionId);
		return paneSessionId;
	}
	return null;
}

export function setProviderSessionId(paneId: string, sessionId: string) {
	if (providerSessionIds.get(paneId) === sessionId) return;
	providerSessionIds.set(paneId, sessionId);
	setPaneProviderSession(paneId, sessionId);
}

export function clearProviderSessionId(paneId: string) {
	providerSessionIds.delete(paneId);
	setPaneProviderSession(paneId, null);
}

export function loadStoredModel(paneId: string): string | null {
	return readStoredValue(MODEL_KEY_PREFIX + paneId);
}

export function saveStoredModel(paneId: string, modelId: string) {
	writePaneValue(MODEL_KEY_PREFIX, paneId, modelId);
}

export function loadStoredReasoningLevel(paneId: string): string | null {
	return readStoredValue(REASONING_KEY_PREFIX + paneId);
}

export function saveStoredReasoningLevel(
	paneId: string,
	reasoningLevel: string,
) {
	writePaneValue(REASONING_KEY_PREFIX, paneId, reasoningLevel);
}

function loadStoredSummary(paneId: string): string | null {
	return readStoredValue(SUMMARY_KEY_PREFIX + paneId);
}

function saveStoredSummary(paneId: string, summary: string) {
	writePaneValue(SUMMARY_KEY_PREFIX, paneId, summary);
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
	const parsed = readStoredJson<unknown>(
		PENDING_WORKSPACE_KEY_PREFIX + paneId,
		[],
	);
	return Array.isArray(parsed) ? parsed.filter(isString) : [];
}

export function savePendingWorkspacePaths(paneId: string, paths: string[]) {
	if (paths.length === 0)
		removeStoredValue(PENDING_WORKSPACE_KEY_PREFIX + paneId);
	else writeStoredJson(PENDING_WORKSPACE_KEY_PREFIX + paneId, paths);
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

function createChatQueueReadModel(paneId: string) {
	let queue: QueuedMessageInfo[] = [];
	let revision = 0;
	const { notify, subscribe } = subscriptions();
	const setSnapshot = (next: QueuedMessageInfo[]) => {
		if (areQueuedMessagesEqual(queue, next)) return;
		revision++;
		queue = next;
		notify();
	};
	let mutationChain = Promise.resolve();
	const mutate = (action: "edit" | "remove", id: string, text?: string) => {
		const result = mutationChain
			.catch(() => undefined)
			.then(async () => {
				const before = ++revision;
				const response = await fetch(
					`/api/chat-queues/${encodeURIComponent(paneId)}`,
					{
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ action, id, text }),
					},
				);
				if (!response.ok)
					throw new Error("Could not update queued message. Please retry.");
				const payload = (await response.json()) as {
					queue: QueuedMessageInfo[];
				};
				if (revision === before)
					setSnapshot([
						...payload.queue,
						...queue.filter((item) => item.transient),
					]);
			});
		mutationChain = result;
		return result;
	};
	return {
		get: () => queue,
		getSnapshot: () => queue,
		replaceFromServer: (messages: QueuedMessageInfo[]) => {
			// Even unchanged authoritative content supersedes an older HTTP response.
			revision++;
			setSnapshot(messages);
		},
		mutate,
		subscribe,
	};
}

export const getChatQueueReadModel = perPane(createChatQueueReadModel);

function createChatRunStatusReadModel() {
	const model = snapshot(
		DEFAULT_CHAT_RUN_STATUS,
		undefined,
		(previous: ChatLoadingState, next: ChatLoadingState) =>
			previous.isLoading === next.isLoading &&
			previous.status === next.status &&
			previous.startTime === next.startTime,
	);
	return { ...model, clear: () => model.set(DEFAULT_CHAT_RUN_STATUS) };
}

export const getChatRunStatusReadModel = perPane(createChatRunStatusReadModel);

export function clearAgentChatPaneState(paneId: string) {
	providerSessionIds.delete(paneId);
	getChatMessageReadModel.delete(paneId);
	getChatCheckpointReadModel.delete(paneId);
	getChatQueueReadModel.delete(paneId);
	getChatRunStatusReadModel.peek(paneId)?.clear();
	getChatRunStatusReadModel.delete(paneId);
	for (const prefix of [
		INPUT_KEY_PREFIX,
		CHECKPOINT_KEY_PREFIX,
		SUMMARY_KEY_PREFIX,
		PENDING_WORKSPACE_KEY_PREFIX,
	]) {
		removeStoredValue(prefix + paneId);
	}
	void fetch(`/api/chat-queues/${encodeURIComponent(paneId)}`, {
		method: "DELETE",
	}).catch(noop);
}
