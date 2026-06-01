import { isString, noop } from "../../lib/data.ts";
import { fetchJsonOr, sendJson } from "../../lib/fetch-json.ts";
import {
	CHAT_CHECKPOINT_KEY_PREFIX,
	CHAT_COMPOSER_CONTEXT_KEY_PREFIX,
	CHAT_INPUT_KEY_PREFIX,
	CHAT_LOADING_STATE_KEY_PREFIX,
	CHAT_MESSAGES_STORAGE_KEY_PREFIX,
	CHAT_MODEL_KEY_PREFIX,
	CHAT_PENDING_SEND_KEY_PREFIX,
	CHAT_PENDING_WORKSPACE_KEY_PREFIX,
	CHAT_QUEUE_KEY_PREFIX,
	CHAT_REASONING_KEY_PREFIX,
	CHAT_SESSION_INDEX_STORAGE_KEY,
	CHAT_SESSION_KEY_PREFIX,
	CHAT_SUMMARY_KEY_PREFIX,
	CHAT_WORKTREE_INFO_KEY_PREFIX,
} from "../../lib/client-storage-keys.ts";
import { flushPendingClientStorageSync } from "../../lib/client-storage-sync.ts";
import {
	readStoredJson,
	readStoredValue,
	removeStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../lib/stored-json.ts";

const LOADING_STATE_TTL_MS = 6 * 60 * 60 * 1000;

export interface StoredLoadingState {
	isLoading: boolean;
	status: string;
	startTime: number | null;
}

export interface StoredChatSession {
	paneId: string;
	agentKind: string;
	cwd: string | null;
	referencePaths: string[];
	sessionId: string | null;
	model: string | null;
	reasoningLevel: string | null;
	summary: string | null;
	lastMessage: string | null;
	messageCount: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredWorktreeLaunchInfo {
	branchName: string;
	basePath: string;
	worktreePath: string;
	createdAt: number;
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
	fallback: string | null = null
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

function messageRole(value: unknown): string | null {
	return typeof value === "object" &&
		value !== null &&
		typeof (value as { role?: unknown }).role === "string"
		? (value as { role: string }).role
		: null;
}

function messageContentLength(value: unknown): number {
	return typeof value === "object" &&
		value !== null &&
		typeof (value as { content?: unknown }).content === "string"
		? (value as { content: string }).content.length
		: 0;
}

function messageHistoryScore(messages: unknown[]): number {
	return messages.reduce<number>((score, message) => {
		const role = messageRole(message);
		if (!role) return score;
		return score + 1 + messageContentLength(message);
	}, 0);
}

function hasAssistantSideHistory(messages: unknown[]): boolean {
	return messages.some((message) => {
		const role = messageRole(message);
		return role === "assistant" || role === "tool" || role === "system";
	});
}

export function loadStoredMessages<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(
		CHAT_MESSAGES_STORAGE_KEY_PREFIX,
		paneId,
		[]
	);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export async function loadFileBackedMessages<T>(paneId: string): Promise<T[]> {
	const payload = await fetchJsonOr<{ messages?: unknown }>(
		chatTranscriptUrl(paneId),
		{ messages: [] }
	);
	return Array.isArray(payload.messages) ? (payload.messages as T[]) : [];
}

export function saveFileBackedMessages<T>(paneId: string, messages: T[]) {
	try {
		sendJson(chatTranscriptUrl(paneId), { messages }, { method: "PUT" }).catch(
			noop
		);
	} catch {}
}

export function clearFileBackedMessages(paneId: string) {
	try {
		fetch(chatTranscriptUrl(paneId), {
			method: "DELETE",
		}).catch(noop);
	} catch {}
}

function chatTranscriptUrl(paneId: string): string {
	return `/api/chat-transcripts/${encodeURIComponent(paneId)}`;
}

export function loadStoredChatPaneIds(): string[] {
	try {
		const ids = new Set<string>();
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (!key?.startsWith(CHAT_MESSAGES_STORAGE_KEY_PREFIX)) continue;
			const paneId = key.slice(CHAT_MESSAGES_STORAGE_KEY_PREFIX.length);
			if (paneId) ids.add(paneId);
		}
		return [...ids];
	} catch {
		return [];
	}
}

export function saveStoredMessages<T>(paneId: string, messages: T[]) {
	const current = loadStoredMessages<unknown>(paneId);
	if (
		hasAssistantSideHistory(current) &&
		!hasAssistantSideHistory(messages) &&
		messageHistoryScore(current) > messageHistoryScore(messages)
	) {
		return;
	}
	writePaneJson(CHAT_MESSAGES_STORAGE_KEY_PREFIX, paneId, messages);
}

export function loadSessionLibrary(): StoredChatSession[] {
	const sessions = readStoredJson<unknown>(CHAT_SESSION_INDEX_STORAGE_KEY, []);
	if (!Array.isArray(sessions)) return [];
	return [...sessions]
		.filter(
			(session): session is StoredChatSession =>
				typeof session === "object" &&
				session !== null &&
				typeof (session as StoredChatSession).paneId === "string"
		)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadStoredChatSession(
	paneId: string
): StoredChatSession | null {
	return (
		loadSessionLibrary().find((session) => session.paneId === paneId) ?? null
	);
}

export function saveSessionLibrary(sessions: StoredChatSession[]) {
	writeStoredJson(CHAT_SESSION_INDEX_STORAGE_KEY, sessions);
}

export function upsertSessionLibraryEntry(
	paneId: string,
	patch: Partial<Omit<StoredChatSession, "paneId" | "createdAt" | "updatedAt">>
) {
	const now = Date.now();
	const sessions = loadSessionLibrary();
	const current = sessions.find((session) => session.paneId === paneId);
	const next: StoredChatSession = {
		paneId,
		agentKind: current?.agentKind ?? "codex",
		cwd: current?.cwd ?? null,
		referencePaths: current?.referencePaths ?? [],
		sessionId: current?.sessionId ?? null,
		model: current?.model ?? null,
		reasoningLevel: current?.reasoningLevel ?? null,
		summary: current?.summary ?? null,
		lastMessage: current?.lastMessage ?? null,
		messageCount: current?.messageCount ?? 0,
		createdAt: current?.createdAt ?? now,
		updatedAt: now,
		...patch,
	};
	saveSessionLibrary([
		next,
		...sessions.filter((session) => session.paneId !== paneId),
	]);
}

export function removeSessionLibraryEntry(paneId: string) {
	saveSessionLibrary(
		loadSessionLibrary().filter((session) => session.paneId !== paneId)
	);
}

export function loadStoredInput(paneId: string): string {
	return readPaneValue(CHAT_INPUT_KEY_PREFIX, paneId, "") ?? "";
}

export function saveStoredInput(paneId: string, value: string) {
	writePaneValue(CHAT_INPUT_KEY_PREFIX, paneId, value);
}

export function loadPendingSend(paneId: string): string {
	return readPaneValue(CHAT_PENDING_SEND_KEY_PREFIX, paneId, "") ?? "";
}

export function savePendingSend(paneId: string, value: string) {
	writePaneValue(CHAT_PENDING_SEND_KEY_PREFIX, paneId, value);
}

export function clearPendingSend(paneId: string) {
	removePaneValue(CHAT_PENDING_SEND_KEY_PREFIX, paneId);
}

export function loadStoredCheckpoints<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(CHAT_CHECKPOINT_KEY_PREFIX, paneId, []);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function saveStoredCheckpoints<T>(paneId: string, checkpoints: T[]) {
	writePaneJson(CHAT_CHECKPOINT_KEY_PREFIX, paneId, checkpoints);
}

export function clearStoredCheckpoints(paneId: string) {
	removePaneValue(CHAT_CHECKPOINT_KEY_PREFIX, paneId);
}

export function loadStoredSessionId(paneId: string): string | null {
	return readPaneValue(CHAT_SESSION_KEY_PREFIX, paneId);
}

export function saveStoredSessionId(paneId: string, sessionId: string) {
	writePaneValue(CHAT_SESSION_KEY_PREFIX, paneId, sessionId);
	upsertSessionLibraryEntry(paneId, { sessionId });
}

export function clearStoredSessionId(paneId: string) {
	removePaneValue(CHAT_SESSION_KEY_PREFIX, paneId);
}

export function loadStoredModel(paneId: string): string | null {
	return readPaneValue(CHAT_MODEL_KEY_PREFIX, paneId);
}

export function saveStoredModel(paneId: string, modelId: string) {
	writePaneValue(CHAT_MODEL_KEY_PREFIX, paneId, modelId);
	upsertSessionLibraryEntry(paneId, { model: modelId });
}

export function loadStoredReasoningLevel(paneId: string): string | null {
	return readPaneValue(CHAT_REASONING_KEY_PREFIX, paneId);
}

export function saveStoredReasoningLevel(
	paneId: string,
	reasoningLevel: string
) {
	writePaneValue(CHAT_REASONING_KEY_PREFIX, paneId, reasoningLevel);
	upsertSessionLibraryEntry(paneId, { reasoningLevel });
}

export function loadStoredSummary(paneId: string): string | null {
	return readPaneValue(CHAT_SUMMARY_KEY_PREFIX, paneId);
}

export function saveStoredSummary(paneId: string, summary: string) {
	writePaneValue(CHAT_SUMMARY_KEY_PREFIX, paneId, summary);
	upsertSessionLibraryEntry(paneId, { summary });
}

export function loadPendingWorkspacePaths(paneId: string): string[] {
	const parsed = readPaneJson<unknown>(
		CHAT_PENDING_WORKSPACE_KEY_PREFIX,
		paneId,
		[]
	);
	return Array.isArray(parsed) ? parsed.filter(isString) : [];
}

export function savePendingWorkspacePaths(paneId: string, paths: string[]) {
	if (paths.length === 0)
		removePaneValue(CHAT_PENDING_WORKSPACE_KEY_PREFIX, paneId);
	else writePaneJson(CHAT_PENDING_WORKSPACE_KEY_PREFIX, paneId, paths);
}

export function loadStoredQueue<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(CHAT_QUEUE_KEY_PREFIX, paneId, []);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function saveStoredQueue<T>(paneId: string, queue: T[]) {
	if (queue.length === 0) removePaneValue(CHAT_QUEUE_KEY_PREFIX, paneId);
	else writePaneJson(CHAT_QUEUE_KEY_PREFIX, paneId, queue);
	flushPendingClientStorageSync();
}

export function loadStoredComposerContextBlocks<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(
		CHAT_COMPOSER_CONTEXT_KEY_PREFIX,
		paneId,
		[]
	);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function saveStoredComposerContextBlocks<T>(
	paneId: string,
	blocks: T[]
) {
	if (blocks.length === 0)
		removePaneValue(CHAT_COMPOSER_CONTEXT_KEY_PREFIX, paneId);
	else writePaneJson(CHAT_COMPOSER_CONTEXT_KEY_PREFIX, paneId, blocks);
}

function isStoredWorktreeLaunchInfo(
	value: unknown
): value is StoredWorktreeLaunchInfo {
	if (!value || typeof value !== "object") return false;
	const info = value as Partial<StoredWorktreeLaunchInfo>;
	return (
		typeof info.branchName === "string" &&
		typeof info.basePath === "string" &&
		typeof info.worktreePath === "string" &&
		typeof info.createdAt === "number"
	);
}

export function loadStoredWorktreeInfo(
	paneId: string
): StoredWorktreeLaunchInfo | null {
	const parsed = readPaneJson<unknown>(
		CHAT_WORKTREE_INFO_KEY_PREFIX,
		paneId,
		null
	);
	return isStoredWorktreeLaunchInfo(parsed) ? parsed : null;
}

export function saveStoredWorktreeInfo(
	paneId: string,
	info: StoredWorktreeLaunchInfo
) {
	writePaneJson(CHAT_WORKTREE_INFO_KEY_PREFIX, paneId, info);
}

export function clearStoredWorktreeInfo(paneId: string) {
	removePaneValue(CHAT_WORKTREE_INFO_KEY_PREFIX, paneId);
}

export function loadStoredLoadingState(
	paneId: string
): StoredLoadingState | null {
	const parsed = readPaneJson<Partial<StoredLoadingState> | null>(
		CHAT_LOADING_STATE_KEY_PREFIX,
		paneId,
		null
	);
	if (!parsed?.isLoading || typeof parsed.status !== "string") return null;
	if (
		typeof parsed.startTime !== "number" ||
		Date.now() - parsed.startTime > LOADING_STATE_TTL_MS
	) {
		return null;
	}
	return {
		isLoading: true,
		status: parsed.status,
		startTime: parsed.startTime,
	};
}

export function saveStoredLoadingState(
	paneId: string,
	state: StoredLoadingState
) {
	if (!state.isLoading || !state.startTime) {
		removePaneValue(CHAT_LOADING_STATE_KEY_PREFIX, paneId);
		return;
	}
	writePaneJson(CHAT_LOADING_STATE_KEY_PREFIX, paneId, state);
}

export function clearStoredLoadingState(paneId: string) {
	removePaneValue(CHAT_LOADING_STATE_KEY_PREFIX, paneId);
}

export function clearAgentChatMessages(paneId: string) {
	for (const prefix of [
		CHAT_MESSAGES_STORAGE_KEY_PREFIX,
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
	]) {
		removePaneValue(prefix, paneId);
	}
	removeSessionLibraryEntry(paneId);
	clearFileBackedMessages(paneId);
}
