import type {
	GitFilePresentation,
	PanelSession,
	ProviderCatalog,
	ProviderSettings,
	WorkspaceAgentKind,
} from "@contracts";
import wasmUrl from "../../../build/presentation/bytes.js";
import {
	initSync,
	presentation,
} from "../../../build/presentation/presentation.js";
import providerCatalog from "../../../build/presentation/provider-catalog.json";
import type { AgentLayoutMode } from "../contracts/workspace.ts";
import {
	dispatchWindowEvent,
	listenWindowEvent,
	WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
	type WorkspaceSidebarCollapsedDetail,
} from "./dom.tsx";

export {
	ChatReplica,
	ChatSessionRetention,
	ChatViewportRetention,
	DockSession,
	DocumentReplica,
	MarkdownCursor,
	PanelReplica,
	RepositoryTabs,
	SkillDialogReplica,
	UiTimingRecorder,
	WorkspaceReplica,
} from "../../../build/presentation/presentation.js";
/** The only low-level browser HTTP seam. Every request has a finite deadline. */
export function request(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const timeout = AbortSignal.timeout(12_000);
	return fetch(input, {
		...init,
		signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
	});
}
export async function fetchJson<T>(
	input: RequestInfo | URL,
	init?: RequestInit,
	failure?: JsonFailure,
): Promise<T> {
	return readJson(await request(input, init), failure);
}
type JsonFailure = {
	message?: string | ((status: number) => string);
	server?: boolean;
};
async function readJson<T>(
	response: Response,
	failure?: JsonFailure,
): Promise<T> {
	if (!response.ok) {
		const body = failure?.server
			? await response.json().catch(() => null)
			: null;
		const message =
			typeof failure?.message === "function"
				? failure.message(response.status)
				: failure?.message;
		throw new Error(
			(typeof body?.error === "string" ? body.error : undefined) ??
				message ??
				`Request failed: ${response.status}`,
		);
	}
	return response.json() as Promise<T>;
}
export async function fetchJsonOr<T>(
	input: RequestInfo | URL,
	fallback: T,
	init?: RequestInit,
): Promise<T> {
	const response = await request(input, init);
	if (!response.ok) {
		return fallback;
	}
	return response.json() as Promise<T>;
}
export async function postJson<TResponse>(
	input: RequestInfo | URL,
	body?: unknown,
	init?: RequestInit,
	failure?: JsonFailure,
): Promise<TResponse> {
	return readJson(await sendJson(input, body, init), failure);
}
export async function sendJson(
	input: RequestInfo | URL,
	body?: unknown,
	init?: RequestInit,
): Promise<Response> {
	return request(input, {
		...init,
		method: init?.method ?? "POST",
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
		body: body === undefined ? init?.body : JSON.stringify(body),
	});
}
interface WSMessage {
	type: string;
	paneId?: string;
	[key: string]: unknown;
}
type MessageHandler = (data: WSMessage, serialized: string) => void;
class WebSocketClient {
	private ws: WebSocket | null = null;
	private listeners = new Map<string, Set<MessageHandler>>();
	private reconnectCallbacks = new Set<() => void>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingMessages: string[] = [];
	connect() {
		if (
			this.ws?.readyState === WebSocket.OPEN ||
			this.ws?.readyState === WebSocket.CONNECTING
		)
			return;
		const url = new URL("/ws", window.location.href);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		this.ws = new WebSocket(url);
		this.ws.onopen = () => {
			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer);
				this.reconnectTimer = null;
			}
			// Flush queued messages
			const queued = this.pendingMessages.splice(0);
			for (const msg of queued) {
				this.ws?.send(msg);
			}
			for (const cb of this.reconnectCallbacks) {
				try {
					cb();
				} catch {}
			}
		};
		this.ws.onmessage = (event) => {
			try {
				const msg: WSMessage = JSON.parse(event.data);
				if (msg.paneId) {
					const paneListeners = this.listeners.get(msg.paneId);
					if (paneListeners) {
						for (const handler of paneListeners) handler(msg, event.data);
					}
				}
			} catch {}
		};
		this.ws.onclose = () => {
			this.reconnectTimer = setTimeout(() => this.connect(), 2000);
		};
	}
	subscribe(runId: string, handler: MessageHandler) {
		if (!this.listeners.has(runId)) {
			this.listeners.set(runId, new Set());
		}
		this.listeners.get(runId)?.add(handler);
		return () => {
			this.listeners.get(runId)?.delete(handler);
			if (this.listeners.get(runId)?.size === 0) {
				this.listeners.delete(runId);
			}
		};
	}
	onReconnect(handler: () => void) {
		this.reconnectCallbacks.add(handler);
		return () => {
			this.reconnectCallbacks.delete(handler);
		};
	}
	send(data: unknown) {
		if (
			data &&
			typeof data === "object" &&
			"type" in data &&
			typeof data.type === "string"
		)
			traceUi(data.type);
		const json = JSON.stringify(data);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(json);
		} else {
			this.pendingMessages.push(json);
		}
	}
}
export const wsClient = new WebSocketClient();
export async function pickCloneDirectory() {
	const payload = await fetchJsonOr<{
		folder: string | null;
	}>(
		"/api/config/pick-folder",
		{
			folder: null,
		},
		{
			method: "POST",
		},
	);
	return payload.folder;
}

// The build and the native endpoint use the same Rust catalog serializer.
let catalog = providerCatalog as ProviderCatalog;
export async function initializeAgentCatalog() {
	catalog = await fetchJson<ProviderCatalog>("/api/native/provider-config");
}
export function getAgentDefinition(kind: WorkspaceAgentKind) {
	return catalog.agents[kind];
}
export function isChatAgentKind(
	kind: WorkspaceAgentKind,
): kind is "claude" | "codex" {
	return kind !== "agent";
}
export function loadDefaultChatSettings(): ProviderSettings {
	return catalog.defaults;
}
export async function saveDefaultChatSettings(settings: ProviderSettings) {
	catalog.defaults = await postJson<ProviderSettings>(
		"/api/native/provider-config",
		settings,
	);
	return catalog.defaults;
}

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
			{
				entries,
			},
			{
				method: "PUT",
				keepalive: true,
			},
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
	const response = await request("/api/client-storage", {
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
	dispatchWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, {
		key,
		value,
	});
	if (!timer) timer = setTimeout(flushPending, 250);
}
if (typeof window !== "undefined") {
	const flushOnHide = () => {
		if (!pending.size) return;
		if (
			navigator.sendBeacon?.(
				"/api/client-storage",
				new Blob(
					[
						JSON.stringify({
							entries: Object.fromEntries(pending),
						}),
					],
					{
						type: "application/json",
					},
				),
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
export function setWorkspaceSidebarCollapsed(collapsed: boolean) {
	writeStoredValue("sidebar-collapsed", String(collapsed));
	dispatchWindowEvent<WorkspaceSidebarCollapsedDetail>(
		WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
		{ collapsed },
	);
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
	readStoredValue("agent-layout-mode") === "rows" ? "rows" : "grid";
export const listenAgentLayoutMode = (set: (mode: AgentLayoutMode) => void) =>
	listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
		if (
			(
				event as CustomEvent<{
					key?: string;
				}>
			).detail?.key === "agent-layout-mode"
		)
			set(loadAgentLayoutMode());
	});
export function setAgentLayoutMode(mode: AgentLayoutMode) {
	writeStoredValue("agent-layout-mode", mode);
}
export const loadSidebarCollapsed = () =>
	readStoredBoolean("sidebar-collapsed");

// Both prerendering and the browser execute the same Rust models. Bundling the
// bytes also makes initialization independent of the desktop's loopback origin.
// Decoding through Uint8Array.from's callback ran one closure call per byte and
// measured 19ms for this 544KB module; writing the array directly is 2.2ms.
function wasmBytes(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}
initSync({ module: wasmBytes(wasmUrl) });
export function project<T>(operation: string, input: unknown): T {
	return JSON.parse(presentation(operation, JSON.stringify(input)));
}
export function adjacentGitFile<T>(
	files: readonly T[],
	isSelected: (file: T) => boolean,
	direction: -1 | 1,
	repeatBoundary = false,
): T | undefined {
	const index = project<number | null>("adjacentFile", {
		count: files.length,
		current: files.findIndex(isSelected),
		direction,
		repeatBoundary,
	});
	return index === null ? undefined : files[index];
}
export function visibleGitFiles<
	T extends {
		path: string;
	},
>(
	files: readonly T[],
	presentation: GitFilePresentation | undefined,
	mode: "path" | "tree",
): T[] {
	return project("visibleFiles", {
		files,
		presentation,
		mode,
	});
}
export function getFileSelectionAfterToggle<
	T extends {
		path: string;
		staged: boolean;
	},
>(
	files: readonly T[],
	selected: {
		path: string;
		staged: boolean;
	},
): T | null {
	return project("selectionAfterToggle", {
		files,
		selected,
	});
}
export function emptyGitWorkspacePanelSession(): PanelSession {
	return project("emptyPanels", null);
}

/** Installed only while the explicit performance recorder is open. */
export const uiTrace: { record?: (name: string) => void } = {};
export function traceUi(name: string) {
	uiTrace.record?.(name);
}
