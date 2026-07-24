import { isChatStreamEvent } from "../../features/chat/agent-chat-shared.ts";
import {
	createAgentEnv,
	resolveAgentBinary,
} from "../../features/agent/agent-command.ts";
import {
	type AgentAdapter,
	type AgentEvent,
	type AgentHandle,
	type AgentRunContext,
	drainStreamToString,
	flushNdjsonLeftover,
	parseNdjsonLines,
	summarizeToolInput,
} from "./events.ts";

function emitClaudeAgentEvent(event: unknown, ctx: AgentRunContext) {
	const normalized = normalizeClaudeEvent(event);
	if (!normalized) return;
	ctx.emitAgentEvent(normalized);
	if (normalized.type === "tool-call-start") {
		ctx.emitActivity({
			toolName: normalized.toolName,
			summary:
				normalized.summary ?? summarizeToolInput(normalized.toolName, {}),
			isStreaming: true,
		});
	}
}

function normalizeClaudeEvent(event: unknown): AgentEvent | null {
	if (!event || typeof event !== "object") return null;
	const data = event as Record<string, any>;
	if (!data.type) return null;
	if (data.type === "content_block_start") {
		const block = data.content_block;
		if (
			block?.type === "text" &&
			typeof block.text === "string" &&
			block.text
		) {
			return { type: "text-delta", text: block.text };
		}
		if (block?.type === "tool_use") {
			const toolName = String(block.name ?? "tool");
			const input = block.input ?? {};
			return {
				type: "tool-call-start",
				toolCallId: String(data.index ?? block.id ?? `${toolName}:latest`),
				toolName,
				input,
				summary: summarizeToolInput(toolName, input),
			};
		}
	}
	if (data.type === "content_block_delta") {
		const delta = data.delta;
		if (delta?.type === "text_delta" && typeof delta.text === "string") {
			return { type: "text-delta", text: delta.text };
		}
		if (
			delta?.type === "thinking_delta" &&
			typeof delta.thinking === "string"
		) {
			return { type: "thinking-delta", text: delta.thinking };
		}
		if (
			delta?.type === "input_json_delta" &&
			typeof delta.partial_json === "string"
		) {
			return {
				type: "tool-call-delta",
				toolCallId: String(data.index ?? "latest"),
				delta: delta.partial_json,
			};
		}
	}
	if (data.type === "result" && typeof data.result === "string") {
		return { type: "result", text: data.result };
	}
	if (data.type === "error" && typeof data.message === "string") {
		return { type: "error", message: data.message };
	}
	if (data.type === "system" && data.subtype === "init") {
		return {
			type: "raw",
			provider: "claude",
			eventType: data.type,
			event,
		};
	}
	return null;
}

export const claudeAdapter: AgentAdapter<undefined> = {
	kind: "claude",
	displayName: "Claude",

	createState() {
		return undefined;
	},

	createHandle(prompt, ctx): AgentHandle {
		const sessionId = ctx.getSessionId();
		let proc: ReturnType<typeof Bun.spawn> | null = null;

		return {
			async run() {
				try {
					let lastAssistantMessage = "";
					const handleEvent = (event: unknown) => {
						const sessionId =
							event && typeof event === "object"
								? (event as { session_id?: unknown }).session_id
								: undefined;
						if (typeof sessionId === "string") {
							const isNewSession = ctx.getSessionId() !== sessionId;
							ctx.updateSessionId(sessionId);
							if (isNewSession) {
								ctx.emitAgentEvent({
									type: "session",
									providerSessionId: sessionId,
								});
							}
						}
						if (
							event &&
							typeof event === "object" &&
							(event as { type?: unknown }).type === "result" &&
							typeof (event as { result?: unknown }).result === "string"
						) {
							lastAssistantMessage = (event as { result: string }).result;
						}
						emitClaudeAgentEvent(event, ctx);
						if (isChatStreamEvent(event)) ctx.emitChatEvent(event);
					};
					const args = [
						resolveAgentBinary("claude"),
						"-p",
						prompt,
						"--dangerously-skip-permissions",
						"--output-format",
						"stream-json",
						"--verbose",
					];
					if (ctx.model) {
						args.push("--model", ctx.model);
					}
					if (sessionId) {
						args.push("--resume", sessionId);
					}
					proc = Bun.spawn(args, {
						stdout: "pipe",
						stderr: "pipe",
						cwd: ctx.cwd,
						env: createAgentEnv("claude"),
					});

					const stderrPromise = drainStreamToString(
						proc.stderr as ReadableStream<Uint8Array>
					);
					const reader = (
						proc.stdout as ReadableStream<Uint8Array>
					).getReader();
					const decoder = new TextDecoder();
					let leftover = "";

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						leftover += decoder.decode(value, { stream: true });
						leftover = parseNdjsonLines(leftover, handleEvent);
					}

					flushNdjsonLeftover(leftover, handleEvent);

					const exitCode = await proc.exited;
					proc = null;
					const stderrText = (await stderrPromise).trim();
					if (exitCode !== 0 && stderrText && !ctx.isCancelled()) {
						ctx.emitAgentEvent({ type: "error", message: stderrText });
						ctx.emitSystemMessage(stderrText);
					}
					const finishReason = ctx.isCancelled()
						? "cancelled"
						: exitCode === 0
							? "completed"
							: `exit:${exitCode}`;
					ctx.emitAgentEvent({ type: "finish", reason: finishReason });
					return lastAssistantMessage ? { lastAssistantMessage } : undefined;
				} catch (err: any) {
					if (ctx.isCancelled()) return undefined;
					const msg = err.message || "Claude encountered an error";
					ctx.emitAgentEvent({ type: "error", message: msg });
					ctx.emitSystemMessage(msg);
					return undefined;
				}
			},

			stop() {
				try {
					proc?.kill("SIGINT");
					setTimeout(() => {
						try {
							proc?.kill("SIGINT");
						} catch {}
					}, 150);
				} catch {}
			},

			kill() {
				try {
					proc?.kill();
				} catch {}
			},
		};
	},
};
