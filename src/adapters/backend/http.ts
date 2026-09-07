import type { ProviderCatalog } from "../../../build/presentation/contracts/ProviderCatalog.ts";
import type { ProviderSettings } from "../../../build/presentation/contracts/ProviderSettings.ts";
import type { WorkspaceAgentKind } from "../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import providerCatalog from "../../../build/presentation/provider-catalog.json";
export async function fetchJson<T>(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(input, init);
	if (!response.ok) {
		throw new Error(`Request failed: ${response.status}`);
	}
	return response.json() as Promise<T>;
}
export async function fetchJsonOr<T>(
	input: RequestInfo | URL,
	fallback: T,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(input, init);
	if (!response.ok) {
		return fallback;
	}
	return response.json() as Promise<T>;
}
export async function postJson<TResponse>(
	input: RequestInfo | URL,
	body?: unknown,
	init?: RequestInit,
): Promise<TResponse> {
	const response = await sendJson(input, body, init);
	if (!response.ok) throw new Error(`Request failed: ${response.status}`);
	return response.json() as Promise<TResponse>;
}
export async function sendJson(
	input: RequestInfo | URL,
	body?: unknown,
	init?: RequestInit,
): Promise<Response> {
	return fetch(input, {
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
type MessageHandler = (data: WSMessage) => void;
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
						for (const handler of paneListeners) handler(msg);
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
	const payload = await fetchJsonOr<{ folder: string | null }>(
		"/api/config/pick-folder",
		{ folder: null },
		{ method: "POST" },
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
