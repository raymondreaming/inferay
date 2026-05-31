import { isString } from "../../lib/data.ts";
import {
	readStoredJson,
	readStoredValue,
	removeStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../lib/stored-json.ts";

const STORAGE_KEY_PREFIX = "inferay-chat-";
const SESSION_KEY_PREFIX = "inferay-chat-session-";
const INPUT_KEY_PREFIX = "inferay-chat-input-";
const CHECKPOINT_KEY_PREFIX = "inferay-checkpoints-";
const MODEL_KEY_PREFIX = "inferay-chat-model-";
const REASONING_KEY_PREFIX = "inferay-chat-reasoning-";
const PENDING_SEND_KEY_PREFIX = "inferay-chat-pending-send-";
const SUMMARY_KEY_PREFIX = "inferay-chat-summary-";
const SESSION_INDEX_KEY = "inferay-session-library";
const PENDING_WORKSPACE_KEY_PREFIX = "inferay-chat-pending-workspace-";
const QUEUE_KEY_PREFIX = "inferay-chat-queue-";
const LOADING_STATE_KEY_PREFIX = "inferay-chat-loading-";
const COMPOSER_CONTEXT_KEY_PREFIX = "inferay-chat-composer-context-";
const WORKTREE_INFO_KEY_PREFIX = "inferay-chat-worktree-";
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

export function loadStoredMessages<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(STORAGE_KEY_PREFIX, paneId, []);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function loadStoredChatPaneIds(): string[] {
	try {
		const ids = new Set<string>();
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
			const paneId = key.slice(STORAGE_KEY_PREFIX.length);
			if (paneId) ids.add(paneId);
		}
		return [...ids];
	} catch {
		return [];
	}
}

export function saveStoredMessages<T>(paneId: string, messages: T[]) {
	writePaneJson(STORAGE_KEY_PREFIX, paneId, messages);
}

export function loadSessionLibrary(): StoredChatSession[] {
	const sessions = readStoredJson<unknown>(SESSION_INDEX_KEY, []);
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

export function saveSessionLibrary(sessions: StoredChatSession[]) {
	writeStoredJson(SESSION_INDEX_KEY, sessions);
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
	return readPaneValue(INPUT_KEY_PREFIX, paneId, "") ?? "";
}

export function saveStoredInput(paneId: string, value: string) {
	writePaneValue(INPUT_KEY_PREFIX, paneId, value);
}

export function loadPendingSend(paneId: string): string {
	return readPaneValue(PENDING_SEND_KEY_PREFIX, paneId, "") ?? "";
}

export function savePendingSend(paneId: string, value: string) {
	writePaneValue(PENDING_SEND_KEY_PREFIX, paneId, value);
}

export function clearPendingSend(paneId: string) {
	removePaneValue(PENDING_SEND_KEY_PREFIX, paneId);
}

export function loadStoredCheckpoints<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(CHECKPOINT_KEY_PREFIX, paneId, []);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function saveStoredCheckpoints<T>(paneId: string, checkpoints: T[]) {
	writePaneJson(CHECKPOINT_KEY_PREFIX, paneId, checkpoints);
}

export function clearStoredCheckpoints(paneId: string) {
	removePaneValue(CHECKPOINT_KEY_PREFIX, paneId);
}

export function loadStoredSessionId(paneId: string): string | null {
	return readPaneValue(SESSION_KEY_PREFIX, paneId);
}

export function saveStoredSessionId(paneId: string, sessionId: string) {
	writePaneValue(SESSION_KEY_PREFIX, paneId, sessionId);
	upsertSessionLibraryEntry(paneId, { sessionId });
}

export function clearStoredSessionId(paneId: string) {
	removePaneValue(SESSION_KEY_PREFIX, paneId);
}

export function loadStoredModel(paneId: string): string | null {
	return readPaneValue(MODEL_KEY_PREFIX, paneId);
}

export function saveStoredModel(paneId: string, modelId: string) {
	writePaneValue(MODEL_KEY_PREFIX, paneId, modelId);
	upsertSessionLibraryEntry(paneId, { model: modelId });
}

export function loadStoredReasoningLevel(paneId: string): string | null {
	return readPaneValue(REASONING_KEY_PREFIX, paneId);
}

export function saveStoredReasoningLevel(
	paneId: string,
	reasoningLevel: string
) {
	writePaneValue(REASONING_KEY_PREFIX, paneId, reasoningLevel);
	upsertSessionLibraryEntry(paneId, { reasoningLevel });
}

export function loadStoredSummary(paneId: string): string | null {
	return readPaneValue(SUMMARY_KEY_PREFIX, paneId);
}

export function saveStoredSummary(paneId: string, summary: string) {
	writePaneValue(SUMMARY_KEY_PREFIX, paneId, summary);
	upsertSessionLibraryEntry(paneId, { summary });
}

export function loadPendingWorkspacePaths(paneId: string): string[] {
	const parsed = readPaneJson<unknown>(
		PENDING_WORKSPACE_KEY_PREFIX,
		paneId,
		[]
	);
	return Array.isArray(parsed) ? parsed.filter(isString) : [];
}

export function savePendingWorkspacePaths(paneId: string, paths: string[]) {
	if (paths.length === 0) removePaneValue(PENDING_WORKSPACE_KEY_PREFIX, paneId);
	else writePaneJson(PENDING_WORKSPACE_KEY_PREFIX, paneId, paths);
}

export function loadStoredQueue<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(QUEUE_KEY_PREFIX, paneId, []);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function saveStoredQueue<T>(paneId: string, queue: T[]) {
	if (queue.length === 0) removePaneValue(QUEUE_KEY_PREFIX, paneId);
	else writePaneJson(QUEUE_KEY_PREFIX, paneId, queue);
}

export function loadStoredComposerContextBlocks<T>(paneId: string): T[] {
	const parsed = readPaneJson<unknown>(COMPOSER_CONTEXT_KEY_PREFIX, paneId, []);
	return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function saveStoredComposerContextBlocks<T>(
	paneId: string,
	blocks: T[]
) {
	if (blocks.length === 0) removePaneValue(COMPOSER_CONTEXT_KEY_PREFIX, paneId);
	else writePaneJson(COMPOSER_CONTEXT_KEY_PREFIX, paneId, blocks);
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
	const parsed = readPaneJson<unknown>(WORKTREE_INFO_KEY_PREFIX, paneId, null);
	return isStoredWorktreeLaunchInfo(parsed) ? parsed : null;
}

export function saveStoredWorktreeInfo(
	paneId: string,
	info: StoredWorktreeLaunchInfo
) {
	writePaneJson(WORKTREE_INFO_KEY_PREFIX, paneId, info);
}

export function clearStoredWorktreeInfo(paneId: string) {
	removePaneValue(WORKTREE_INFO_KEY_PREFIX, paneId);
}

export function loadStoredLoadingState(
	paneId: string
): StoredLoadingState | null {
	const parsed = readPaneJson<Partial<StoredLoadingState> | null>(
		LOADING_STATE_KEY_PREFIX,
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
		removePaneValue(LOADING_STATE_KEY_PREFIX, paneId);
		return;
	}
	writePaneJson(LOADING_STATE_KEY_PREFIX, paneId, state);
}

export function clearStoredLoadingState(paneId: string) {
	removePaneValue(LOADING_STATE_KEY_PREFIX, paneId);
}

export function clearAgentChatMessages(paneId: string) {
	for (const prefix of [
		STORAGE_KEY_PREFIX,
		SESSION_KEY_PREFIX,
		INPUT_KEY_PREFIX,
		SUMMARY_KEY_PREFIX,
		PENDING_WORKSPACE_KEY_PREFIX,
		QUEUE_KEY_PREFIX,
		LOADING_STATE_KEY_PREFIX,
		WORKTREE_INFO_KEY_PREFIX,
	]) {
		removePaneValue(prefix, paneId);
	}
	removeSessionLibraryEntry(paneId);
}
