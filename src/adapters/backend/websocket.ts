import { getServerWebSocketUrl } from "./http.ts";

interface WSMessage {
	type: string;
	runId?: string;
	paneId?: string;
	data?: string;
	exitCode?: number;
	ok?: boolean;
	error?: string;
	[key: string]: unknown;
}

type MessageHandler = (data: WSMessage) => void;
type BinaryMessageHandler = (data: ArrayBuffer) => void;
export type WebSocketConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected";

class WebSocketClient {
	private ws: WebSocket | null = null;
	private listeners = new Map<string, Set<MessageHandler>>();
	private globalListeners = new Set<MessageHandler>();
	private binaryListeners = new Set<BinaryMessageHandler>();
	private reconnectCallbacks = new Set<() => void>();
	private connectionListeners = new Set<() => void>();
	private connectionStatus: WebSocketConnectionStatus = "connecting";
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingMessages: string[] = [];
	private url: string;
	constructor(host?: string) {
		if (host) {
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			this.url = `${protocol}//${host}/ws`;
			return;
		}
		this.url = getServerWebSocketUrl("/ws");
	}
	connect() {
		if (
			this.ws?.readyState === WebSocket.OPEN ||
			this.ws?.readyState === WebSocket.CONNECTING
		)
			return;
		this.setConnectionStatus("connecting");
		this.ws = new WebSocket(this.url);
		this.ws.binaryType = "arraybuffer";
		this.ws.onopen = () => {
			this.setConnectionStatus("connected");
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
			// Handle binary messages
			if (event.data instanceof ArrayBuffer) {
				for (const handler of this.binaryListeners) {
					try {
						handler(event.data);
					} catch {}
				}
				return;
			}
			// Handle JSON messages
			try {
				const msg: WSMessage = JSON.parse(event.data);
				if (msg.runId) {
					const runListeners = this.listeners.get(msg.runId);
					if (runListeners) {
						for (const handler of runListeners) handler(msg);
					}
				}
				if (msg.paneId) {
					const paneListeners = this.listeners.get(msg.paneId);
					if (paneListeners) {
						for (const handler of paneListeners) handler(msg);
					}
				}
				// Always fan out to global listeners
				for (const handler of this.globalListeners) handler(msg);
			} catch {}
		};
		this.ws.onclose = () => {
			this.setConnectionStatus("disconnected");
			this.reconnectTimer = setTimeout(() => this.connect(), 2000);
		};
	}
	private setConnectionStatus(status: WebSocketConnectionStatus) {
		if (this.connectionStatus === status) return;
		this.connectionStatus = status;
		for (const listener of this.connectionListeners) listener();
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
	onMessage(handler: MessageHandler) {
		this.globalListeners.add(handler);
		return () => {
			this.globalListeners.delete(handler);
		};
	}
	onReconnect(handler: () => void) {
		this.reconnectCallbacks.add(handler);
		return () => {
			this.reconnectCallbacks.delete(handler);
		};
	}
	onConnectionChange(handler: () => void) {
		this.connectionListeners.add(handler);
		return () => {
			this.connectionListeners.delete(handler);
		};
	}
	getConnectionStatus(): WebSocketConnectionStatus {
		return this.connectionStatus;
	}
	onBinaryMessage(handler: BinaryMessageHandler) {
		this.binaryListeners.add(handler);
		return () => {
			this.binaryListeners.delete(handler);
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
	isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}
	disconnect() {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.pendingMessages.length = 0;
		this.ws?.close();
		this.ws = null;
		this.setConnectionStatus("disconnected");
	}
}

export const wsClient = new WebSocketClient();
export const subscribeWebSocketStatus = (handler: () => void) =>
	wsClient.onConnectionChange(handler);
export const getWebSocketStatus = () => wsClient.getConnectionStatus();
