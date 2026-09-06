const DEFAULT_SERVER_ORIGIN = "http://127.0.0.1:4001";
const SERVER_ORIGIN_QUERY_PARAM = "serverOrigin";
function isLoopbackHost(value: string): boolean {
	const raw = value.toLowerCase();
	const host = raw.startsWith("[")
		? (raw.match(/^\[([^\]]+)\]/)?.[1] ?? raw)
		: (raw.split(":")[0] ?? raw);
	return (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host.endsWith(".localhost")
	);
}
function isAllowedServerOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			isLoopbackHost(url.host)
		);
	} catch {
		return false;
	}
}
export function getServerOrigin(): string {
	if (typeof window === "undefined") {
		return DEFAULT_SERVER_ORIGIN;
	}
	if (
		window.location.protocol === "http:" ||
		window.location.protocol === "https:"
	) {
		return window.location.origin;
	}
	const embeddedServerOrigin = new URLSearchParams(window.location.search).get(
		SERVER_ORIGIN_QUERY_PARAM,
	);
	if (embeddedServerOrigin && isAllowedServerOrigin(embeddedServerOrigin)) {
		return embeddedServerOrigin;
	}
	return DEFAULT_SERVER_ORIGIN;
}
export function resolveServerUrl(path: string): string {
	return new URL(path, getServerOrigin()).toString();
}
export function getServerWebSocketUrl(path = "/ws"): string {
	const origin = new URL(getServerOrigin());
	const protocol = origin.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${origin.host}${path.startsWith("/") ? path : `/${path}`}`;
}
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
export async function sendJsonWithBusy(
	setBusy: (busy: boolean) => void,
	input: RequestInfo | URL,
	body?: unknown,
	init?: RequestInit,
): Promise<Response> {
	setBusy(true);
	try {
		return await sendJson(input, body, init);
	} finally {
		setBusy(false);
	}
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
	private url = getServerWebSocketUrl("/ws");
	connect() {
		if (
			this.ws?.readyState === WebSocket.OPEN ||
			this.ws?.readyState === WebSocket.CONNECTING
		)
			return;
		this.ws = new WebSocket(this.url);
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
