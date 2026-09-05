import { getServerWebSocketUrl } from "./http.ts";

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
