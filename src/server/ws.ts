import type { ServerWebSocket } from "bun";
import { TerminalService } from "./routes/terminal.ts";
import { ChatService } from "./services/agent-chat.ts";
import { CheckpointService } from "./services/checkpoint.ts";

interface WSData {
	subscriptions: Set<string>;
}

const g = globalThis as unknown as {
	__inferay_wsClients?: Set<ServerWebSocket<WSData>>;
};
if (!g.__inferay_wsClients)
	g.__inferay_wsClients = new Set<ServerWebSocket<WSData>>();

const clients: Set<ServerWebSocket<WSData>> = g.__inferay_wsClients;

export function broadcastAll(message: string) {
	for (const ws of clients) {
		if (ws.readyState === 1) {
			ws.send(message);
		}
	}
}

export const websocketHandler = {
	open(ws: ServerWebSocket<WSData>) {
		ws.data = { subscriptions: new Set() };
		clients.add(ws);
	},
	async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
		try {
			const msg = JSON.parse(
				typeof message === "string" ? message : message.toString()
			);

			// Script output subscriptions
			if (msg.type === "subscribe" && msg.runId) {
				ws.data.subscriptions.add(msg.runId);
			} else if (msg.type === "unsubscribe" && msg.runId) {
				ws.data.subscriptions.delete(msg.runId);
			}

			// Terminal lifecycle
			else if (msg.type === "terminal:create") {
				TerminalService.createPane(
					msg.paneId,
					msg.agentKind ?? (msg.isClaude ? "claude" : "terminal"),
					ws,
					msg.cols ?? 80,
					msg.rows ?? 24,
					msg.cwd
				).then((result) => {
					if (ws.readyState === 1) {
						ws.send(
							JSON.stringify({
								type: "terminal:created",
								paneId: msg.paneId,
								...result,
							})
						);
					}
				});
			} else if (msg.type === "terminal:input") {
				TerminalService.write(msg.paneId, msg.data);
			} else if (msg.type === "terminal:resize") {
				TerminalService.resize(msg.paneId, msg.cols, msg.rows);
			} else if (msg.type === "terminal:destroy") {
				TerminalService.destroyPane(msg.paneId);
				ChatService.destroySession(msg.paneId);
			} else if (msg.type === "terminal:reconnect") {
				const result = TerminalService.reassignWs(msg.paneId, ws);
				ChatService.reassignWs(msg.paneId, ws);
				ws.send(
					JSON.stringify({
						type: "terminal:reconnected",
						paneId: msg.paneId,
						ok: result.ok,
						buffer: result.buffer,
					})
				);
			}

			// Chat protocol
			else if (msg.type === "chat:send") {
				ChatService.sendMessage(
					msg.paneId,
					msg.text,
					ws,
					msg.cwd,
					msg.referencePaths,
					msg.sessionId,
					msg.agentKind ?? "codex",
					msg.model,
					msg.reasoningLevel,
					msg.systemPrefix
				);
			} else if (msg.type === "chat:reconnect") {
				ChatService.reassignWs(msg.paneId, ws);
			} else if (msg.type === "chat:btw") {
				ChatService.sendBtwMessage(msg.paneId, msg.text, ws, msg.cwd);
			} else if (msg.type === "chat:stop") {
				ChatService.stopGeneration(msg.paneId);
			}

			// Checkpoint protocol
			else if (msg.type === "checkpoint:revert") {
				const result = await CheckpointService.revertToCheckpoint(
					msg.checkpointId,
					msg.paneId
				);
				ws.send(
					JSON.stringify({
						type: result.ok ? "checkpoint:reverted" : "checkpoint:error",
						paneId: msg.paneId,
						checkpointId: msg.checkpointId,
						...(result.ok
							? { restoredFiles: result.restoredFiles }
							: { error: result.error }),
					})
				);
			}
		} catch (e) {
			console.error("[WS] Error handling message:", e);
		}
	},
	close(ws: ServerWebSocket<WSData>) {
		clients.delete(ws);
		TerminalService.cleanupWs(ws);
		ChatService.cleanupWs(ws);
	},
};
