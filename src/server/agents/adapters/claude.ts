import {
	createAgentEnv,
	resolveAgentBinary,
} from "../../../features/terminal/terminal-command.ts";
import type { AgentEvent } from "../events.ts";
import { summarizeToolInput } from "../events.ts";
import {
	drainStreamToString,
	flushNdjsonLeftover,
	parseNdjsonLines,
} from "../stream-utils.ts";
import type { AgentAdapter, AgentHandle, AgentRunContext } from "../types.ts";

function emitClaudeAgentEvent(event: any, ctx: AgentRunContext) {
	const normalized = normalizeClaudeEvent(event);
	if (normalized) ctx.emitAgentEvent(normalized);
}

function normalizeClaudeEvent(event: any): AgentEvent | null {
	if (!event?.type) return null;
	if (event.type === "content_block_start") {
		const block = event.content_block;
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
				toolCallId: String(event.index ?? block.id ?? `${toolName}:latest`),
				toolName,
				input,
				summary: summarizeToolInput(toolName, input),
			};
		}
	}
	if (event.type === "content_block_delta") {
		const delta = event.delta;
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
				toolCallId: String(event.index ?? "latest"),
				delta: delta.partial_json,
			};
		}
	}
	if (event.type === "result" && typeof event.result === "string") {
		return { type: "result", text: event.result };
	}
	if (event.type === "error" && typeof event.message === "string") {
		return { type: "error", message: event.message };
	}
	if (event.type === "system" && event.subtype === "init") {
		return {
			type: "raw",
			provider: "claude",
			eventType: event.type,
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
					const handleEvent = (event: any) => {
						if (event?.session_id) {
							const isNewSession = ctx.getSessionId() !== event.session_id;
							ctx.updateSessionId(event.session_id);
							if (isNewSession) {
								ctx.emitAgentEvent({
									type: "session",
									providerSessionId: event.session_id,
								});
							}
						}
						if (event?.type === "result" && typeof event.result === "string") {
							lastAssistantMessage = event.result;
						}
						emitClaudeAgentEvent(event, ctx);
						ctx.emitChatEvent(event);
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
