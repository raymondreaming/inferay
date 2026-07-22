import { existsSync, readFileSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	createAgentEnv,
	resolveAgentBinary,
} from "../../features/terminal/terminal-command.ts";
import { noop } from "../../lib/data.ts";
import { basename } from "../../lib/format.ts";
import { isWithinDirectory } from "../security.ts";
import { PidTracker } from "../services/pid-tracker.ts";
import {
	type AgentAdapter,
	type AgentHandle,
	type AgentRunContext,
	drainStreamToString,
	flushNdjsonLeftover,
	parseNdjsonLines,
	summarizeToolInput,
} from "./events.ts";

export function resolveCompletedCodexAssistantMessage(
	streamedText: string,
	completedText: string
): { mode: "skip" } | { mode: "delta"; text: string } | { mode: "replace" } {
	if (!completedText) return { mode: "skip" };
	if (!streamedText) return { mode: "delta", text: completedText };
	if (completedText === streamedText) return { mode: "skip" };
	if (completedText.startsWith(streamedText)) {
		return { mode: "delta", text: completedText.slice(streamedText.length) };
	}
	return { mode: "replace" };
}

export function shouldEmitCodexOutputFallback({
	outputText,
	lastAssistantMessage,
	hasFinalAssistantMessage,
	lastChatBlockRole,
}: {
	outputText: string;
	lastAssistantMessage: string;
	hasFinalAssistantMessage: boolean;
	lastChatBlockRole: "assistant" | "tool" | null;
}) {
	if (!outputText) return false;
	if (
		hasFinalAssistantMessage &&
		outputText.trim() === lastAssistantMessage.trim()
	)
		return false;
	return !hasFinalAssistantMessage || lastChatBlockRole !== "assistant";
}

interface CodexRunState {
	outputPath: string;
	debugLogPath: string;
	assistantOpen: boolean;
	toolOpen: boolean;
	sawAssistantStream: boolean;
	hasFinalAssistantMessage: boolean;
	completedFromEvent: boolean;
	lastAssistantMessage: string;
	lastChatBlockRole: "assistant" | "tool" | null;
	currentToolId: string | null;
	fileSnapshots: Map<string, string | null>;
	fileWatchers: Map<string, ReturnType<typeof setInterval>>;
	activePatchPaths: string[];
	commandOutputs: Map<string, string>;
}

const MAX_INLINE_DIFF_CHARS = 80_000;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function stringField(
	record: Record<string, unknown> | null,
	key: string
): string {
	const value = record?.[key];
	return typeof value === "string" ? value : "";
}

function firstString(record: Record<string, unknown> | null, keys: string[]) {
	for (const key of keys) {
		const value = stringField(record, key);
		if (value) return value;
	}
	return "";
}

function arrayField(
	record: Record<string, unknown> | null,
	key: string
): unknown[] {
	const value = record?.[key];
	return Array.isArray(value) ? value : [];
}

function extractText(value: unknown): string {
	if (!value) return "";
	if (typeof value === "string") return value;
	const record = asRecord(value);
	if (!record) return "";
	const text = firstString(record, [
		"text",
		"message",
		"content",
		"delta",
		"last_agent_message",
		"output_text",
	]);
	if (text) return text;
	const content = record.content;
	if (Array.isArray(content)) {
		return content
			.flatMap((item) => {
				const text = extractText(item);
				return text ? [text] : [];
			})
			.join("");
	}
	return "";
}

function getReferenceWorkspaceDir(path: string): string | null {
	const resolved = resolve(path);
	try {
		const stat = statSync(resolved);
		if (stat.isDirectory()) return resolved;
		if (stat.isFile()) return dirname(resolved);
		return null;
	} catch {
		return null;
	}
}

function getWorkspaceRoots(
	cwd: string,
	referencePaths?: readonly string[]
): string[] {
	const cwdRoot = resolve(cwd);
	const roots: string[] = [cwdRoot];
	for (const path of referencePaths ?? []) {
		if (typeof path !== "string" || !path.trim()) continue;
		const root = getReferenceWorkspaceDir(path.trim());
		if (!root || isWithinDirectory(root, cwdRoot)) continue;
		if (roots.some((existingRoot) => isWithinDirectory(root, existingRoot)))
			continue;
		roots.push(root);
	}
	return roots;
}

function getCodexWorkspaceArgs(ctx: AgentRunContext): string[] {
	const args = ["--cd", ctx.cwd];
	for (const root of getWorkspaceRoots(ctx.cwd, ctx.referencePaths).slice(1)) {
		args.push("--add-dir", root);
	}
	return args;
}

export function buildCodexInvocationArgs(
	prompt: string,
	ctx: AgentRunContext,
	outputPath: string
): string[] {
	const codexCmd = resolveAgentBinary("codex");
	const baseArgs = [
		"--json",
		"--skip-git-repo-check",
		"--dangerously-bypass-approvals-and-sandbox",
		"--output-last-message",
		outputPath,
	];
	if (ctx.model) baseArgs.push("--model", ctx.model);
	if (ctx.reasoningLevel) {
		const reasoningEffort =
			ctx.reasoningLevel === "extra_high" ? "xhigh" : ctx.reasoningLevel;
		baseArgs.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
	}
	for (const imagePath of ctx.images ?? []) {
		baseArgs.push("--image", imagePath);
	}
	const sessionId = ctx.getSessionId();
	const workspaceArgs = getCodexWorkspaceArgs(ctx);
	return sessionId
		? [
				codexCmd,
				...workspaceArgs,
				"exec",
				"resume",
				...baseArgs,
				sessionId,
				"--",
				prompt,
			]
		: [codexCmd, ...workspaceArgs, "exec", ...baseArgs, "--", prompt];
}

function isRelativeChild(pathname: string): boolean {
	return !!pathname && !pathname.startsWith("..") && !isAbsolute(pathname);
}

function resolveChangedPath(
	ctx: AgentRunContext,
	value: unknown
): string | null {
	if (typeof value !== "string" || !value) return null;
	const absolutePath = isAbsolute(value)
		? resolve(value)
		: resolve(ctx.cwd, value);
	return getWorkspaceRoots(ctx.cwd, ctx.referencePaths).some((root) =>
		isWithinDirectory(absolutePath, root)
	)
		? absolutePath
		: null;
}

function getDisplayPath(ctx: AgentRunContext, absolutePath: string): string {
	for (const root of getWorkspaceRoots(ctx.cwd, ctx.referencePaths)) {
		const relativePath = relative(root, absolutePath);
		if (!isRelativeChild(relativePath)) continue;
		return root === resolve(ctx.cwd)
			? relativePath
			: `${basename(root)}/${relativePath}`;
	}
	return absolutePath;
}

function readSnapshot(path: string): string | null {
	try {
		if (!existsSync(path)) return null;
		const stat = statSync(path);
		if (!stat.isFile() || stat.size > MAX_INLINE_DIFF_CHARS) return null;
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function getFileChangePaths(ctx: AgentRunContext, item: unknown): string[] {
	const record = asRecord(item);
	const candidates: unknown[] = [];
	for (const change of arrayField(record, "changes")) {
		if (typeof change === "string") {
			candidates.push(change);
		} else {
			const changeRecord = asRecord(change);
			candidates.push(firstString(changeRecord, ["path", "file_path", "file"]));
		}
	}
	for (const file of arrayField(record, "files")) {
		if (typeof file === "string") {
			candidates.push(file);
		} else {
			const fileRecord = asRecord(file);
			candidates.push(firstString(fileRecord, ["path", "file_path", "file"]));
		}
	}
	candidates.push(firstString(record, ["path", "file_path", "file"]));
	const paths = candidates
		.map((candidate) => resolveChangedPath(ctx, candidate))
		.filter((path: string | null): path is string => Boolean(path));
	return Array.from(new Set<string>(paths));
}

export function handleCodexEvent(
	ctx: AgentRunContext,
	state: CodexRunState,
	event: unknown
) {
	const closeTool = () => {
		if (!state.toolOpen) return;
		ctx.emitChatEvent({ type: "content_block_stop" });
		if (state.currentToolId) {
			ctx.emitAgentEvent({
				type: "tool-call-end",
				toolCallId: state.currentToolId,
			});
		}
		state.toolOpen = false;
		state.currentToolId = null;
	};
	const closeAssistant = () => {
		if (!state.assistantOpen) return;
		ctx.emitChatEvent({ type: "content_block_stop" });
		state.assistantOpen = false;
	};
	const startAssistant = () => {
		if (state.assistantOpen) return;
		closeTool();
		ctx.emitChatEvent({
			type: "content_block_start",
			content_block: { type: "text", text: "" },
		});
		state.assistantOpen = true;
		state.sawAssistantStream = true;
		state.lastChatBlockRole = "assistant";
	};
	const startTool = (name: string, input: unknown = {}) => {
		closeAssistant();
		closeTool();
		const toolCallId = `${name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
		ctx.emitChatEvent({
			type: "content_block_start",
			content_block: { type: "tool_use", name, input },
		});
		ctx.emitAgentEvent({
			type: "tool-call-start",
			toolCallId,
			toolName: name,
			input,
			summary: summarizeToolInput(name, input),
		});
		state.toolOpen = true;
		state.currentToolId = toolCallId;
		state.lastChatBlockRole = "tool";
	};
	const toolDelta = (textDelta: string) => {
		if (!state.toolOpen || !textDelta) return;
		ctx.emitChatEvent({
			type: "content_block_delta",
			delta: { type: "input_json_delta", partial_json: textDelta },
		});
		if (state.currentToolId) {
			ctx.emitAgentEvent({
				type: "tool-call-delta",
				toolCallId: state.currentToolId,
				delta: textDelta,
			});
		}
	};
	const assistantDelta = (textDelta: string) => {
		if (!textDelta) return;
		startAssistant();
		ctx.emitChatEvent({
			type: "content_block_delta",
			delta: { type: "text_delta", text: textDelta },
		});
		ctx.emitAgentEvent({ type: "text-delta", text: textDelta });
		state.lastAssistantMessage += textDelta;
		state.hasFinalAssistantMessage = true;
	};
	const completeAssistantMessage = (text: string) => {
		const completion = resolveCompletedCodexAssistantMessage(
			state.lastAssistantMessage,
			text
		);
		if (completion.mode === "delta") {
			assistantDelta(completion.text);
			closeAssistant();
		} else if (completion.mode === "replace") {
			closeAssistant();
			ctx.emitChatEvent({ type: "result", result: text });
			ctx.emitAgentEvent({ type: "result", text });
		} else {
			closeAssistant();
		}
		state.lastAssistantMessage = text;
		state.hasFinalAssistantMessage = true;
		state.lastChatBlockRole = "assistant";
	};
	const emitEditDiff = (
		absolutePath: string,
		before: string,
		after: string
	) => {
		if (before === after) return;
		if (before.length + after.length > MAX_INLINE_DIFF_CHARS) return;
		const input = {
			file_path: getDisplayPath(ctx, absolutePath),
			old_string: before,
			new_string: after,
		};
		startTool("Edit", input);
		closeTool();
	};
	const emitLiveDiffForPath = (path: string, keepWatching: boolean) => {
		const before = state.fileSnapshots.get(path);
		const after = readSnapshot(path);
		if (before !== null && before !== undefined && after !== null) {
			if (before !== after) {
				emitEditDiff(path, before, after);
				state.fileSnapshots.set(path, after);
			}
		}
		if (!keepWatching) {
			clearPathWatcher(path);
		}
	};
	const clearPathWatcher = (path: string) => {
		const watcher = state.fileWatchers.get(path);
		if (watcher) clearInterval(watcher);
		state.fileWatchers.delete(path);
		state.fileSnapshots.delete(path);
	};
	const watchPaths = (paths: readonly string[]) => {
		for (const path of paths) {
			if (state.fileWatchers.has(path)) continue;
			const watcher = setInterval(() => {
				emitLiveDiffForPath(path, true);
			}, 250);
			state.fileWatchers.set(path, watcher);
		}
	};
	const snapshotPaths = (paths: readonly string[]) => {
		for (const path of paths) {
			state.fileSnapshots.set(path, readSnapshot(path));
		}
		watchPaths(paths);
	};
	const emitDiffsForPaths = (paths: readonly string[]) => {
		for (const path of Array.from(new Set(paths))) {
			emitLiveDiffForPath(path, false);
		}
	};
	const emitCommandOutputDelta = (item: unknown) => {
		const itemRecord = asRecord(item);
		const nextOutput = stringField(itemRecord, "aggregated_output");
		if (!nextOutput) return;
		const itemId = stringField(itemRecord, "id") || "latest";
		const previousOutput = state.commandOutputs.get(itemId) ?? "";
		const delta = nextOutput.startsWith(previousOutput)
			? nextOutput.slice(previousOutput.length)
			: nextOutput;
		if (delta) toolDelta(delta);
		state.commandOutputs.set(itemId, nextOutput);
	};

	const data = asRecord(event);
	if (!data) return;
	const eventType = stringField(data, "type");
	const eventText = extractText(event);
	const item = data.item;
	const itemRecord = asRecord(item);

	if (eventType === "thread.started" && stringField(data, "thread_id")) {
		const threadId = stringField(data, "thread_id");
		ctx.updateSessionId(threadId);
		ctx.emitAgentEvent({ type: "session", providerSessionId: threadId });
	} else if (eventType === "turn.started") {
		ctx.emitStatus("thinking", true);
		ctx.emitAgentEvent({ type: "status", status: "thinking" });
	} else if (
		eventType === "item.started" &&
		itemRecord?.type === "command_execution"
	) {
		const payload = {
			command: stringField(itemRecord, "command"),
			cwd: ctx.cwd,
		};
		ctx.emitStatus("tool:exec", true);
		ctx.emitActivity({
			toolName: "exec",
			summary: summarizeToolInput("exec", payload),
			isStreaming: true,
		});
		const itemId = stringField(itemRecord, "id");
		if (itemId) {
			state.commandOutputs.set(
				itemId,
				stringField(itemRecord, "aggregated_output")
			);
		}
		startTool("exec", payload);
	} else if (
		eventType === "item.updated" &&
		itemRecord?.type === "command_execution"
	) {
		emitCommandOutputDelta(item);
	} else if (
		eventType === "item.completed" &&
		itemRecord?.type === "command_execution"
	) {
		emitCommandOutputDelta(item);
		const itemId = stringField(itemRecord, "id");
		if (itemId) state.commandOutputs.delete(itemId);
		closeTool();
	} else if (
		eventType === "item.started" &&
		itemRecord?.type === "file_change"
	) {
		const paths = getFileChangePaths(ctx, item);
		// `file_change` is provider-reported workspace state, not a scoped edit
		// operation. Do not snapshot and diff it; in multi-agent workspaces it can
		// include build artifacts or files touched by another process.
		const payload = { changes: itemRecord.changes ?? paths };
		ctx.emitStatus("tool:patch", true);
		ctx.emitActivity({
			toolName: "patch",
			summary: summarizeToolInput("patch", payload),
			isStreaming: true,
		});
		startTool("patch", payload);
	} else if (
		eventType === "item.completed" &&
		itemRecord?.type === "file_change"
	) {
		closeTool();
	} else if (
		eventType === "item.completed" &&
		itemRecord?.type === "agent_message"
	) {
		const text = stringField(itemRecord, "text") || extractText(item);
		if (text) completeAssistantMessage(text);
	} else if (eventType === "agent_message_delta") {
		assistantDelta(firstString(data, ["delta", "text", "content"]));
		ctx.emitStatus("responding", true);
		ctx.emitAgentEvent({ type: "status", status: "responding" });
	} else if (eventType === "agent_message") {
		const content = firstString(data, ["message", "content", "text"]);
		if (content) assistantDelta(content);
	} else if (eventType === "exec_command_begin") {
		const payload = {
			command: firstString(data, ["parsed_cmd", "command", "cmd"]),
			cwd: stringField(data, "cwd") || ctx.cwd,
		};
		ctx.emitStatus("tool:exec", true);
		ctx.emitActivity({
			toolName: "exec",
			summary: summarizeToolInput("exec", payload),
			isStreaming: true,
		});
		startTool("exec", payload);
	} else if (eventType === "exec_command_output_delta") {
		const encodedChunk = stringField(data, "chunk");
		const chunk = encodedChunk
			? Buffer.from(encodedChunk, "base64").toString("utf8")
			: "";
		toolDelta(chunk);
	} else if (eventType === "exec_command_end") {
		closeTool();
	} else if (eventType === "patch_apply_begin") {
		const paths = getFileChangePaths(ctx, event);
		state.activePatchPaths = paths;
		snapshotPaths(paths);
		const payload = {
			changes:
				arrayField(data, "changes").length > 0
					? arrayField(data, "changes")
					: arrayField(data, "files").length > 0
						? arrayField(data, "files")
						: paths,
		};
		ctx.emitStatus("tool:patch", true);
		ctx.emitActivity({
			toolName: "patch",
			summary: summarizeToolInput("patch", payload),
			isStreaming: true,
		});
		startTool("patch", payload);
	} else if (eventType === "patch_apply_end") {
		closeTool();
		const paths = getFileChangePaths(ctx, event);
		emitDiffsForPaths(paths.length > 0 ? paths : state.activePatchPaths);
		state.activePatchPaths = [];
	} else if (eventType === "web_search_begin") {
		const payload = { query: stringField(data, "query") };
		ctx.emitStatus("tool:web_search", true);
		ctx.emitActivity({
			toolName: "web_search",
			summary: summarizeToolInput("web_search", payload),
			isStreaming: true,
		});
		startTool("web_search", payload);
	} else if (eventType === "web_search_end") {
		const query = stringField(data, "query");
		if (query) toolDelta(query);
		closeTool();
	} else if (eventType === "mcp_tool_call_begin") {
		const invocation = asRecord(data.invocation);
		const toolName =
			firstString(invocation, ["tool"]) ||
			stringField(data, "tool") ||
			"mcp_tool";
		const payload = invocation?.arguments ?? data.arguments ?? {};
		ctx.emitStatus(`tool:${toolName}`, true);
		ctx.emitActivity({
			toolName,
			summary: summarizeToolInput(toolName, payload),
			isStreaming: true,
		});
		startTool(toolName, payload);
	} else if (eventType === "mcp_tool_call_end") {
		closeTool();
	} else if (
		eventType === "item.completed" &&
		itemRecord?.type === "error" &&
		stringField(itemRecord, "message")
	) {
		const message = stringField(itemRecord, "message");
		ctx.emitAgentEvent({ type: "error", message });
		ctx.emitSystemMessage(message);
	} else if (eventType === "item.completed" && item && extractText(item)) {
		const itemText = extractText(item);
		if (!state.sawAssistantStream && itemText) {
			ctx.emitChatEvent({ type: "result", result: itemText });
			ctx.emitAgentEvent({ type: "result", text: itemText });
			state.hasFinalAssistantMessage = true;
		}
	} else if (eventType === "error" && stringField(data, "message")) {
		const message = stringField(data, "message");
		ctx.emitAgentEvent({ type: "error", message });
		ctx.emitSystemMessage(message);
	} else if (eventType === "task_complete") {
		state.completedFromEvent = true;
		const finalText = stringField(data, "last_agent_message");
		if (finalText) {
			state.lastAssistantMessage = finalText;
		}
		if (finalText && !state.sawAssistantStream) {
			ctx.emitChatEvent({
				type: "result",
				result: finalText,
			});
			ctx.emitAgentEvent({ type: "result", text: finalText });
			state.hasFinalAssistantMessage = true;
		}
	} else if (
		eventText &&
		/message|assistant|output_text|text_delta/i.test(eventType) &&
		!/error|tool|exec_command|patch|web_search|mcp/i.test(eventType)
	) {
		assistantDelta(eventText);
		ctx.emitStatus("responding", true);
		ctx.emitAgentEvent({ type: "status", status: "responding" });
	}
}

export const codexAdapter: AgentAdapter<CodexRunState> = {
	kind: "codex",
	displayName: "Codex",

	createState(ctx) {
		const paneFileStem =
			ctx.paneId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "pane";
		return {
			outputPath: resolve(
				tmpdir(),
				`inferay-codex-${paneFileStem}-${Date.now()}.txt`
			),
			debugLogPath: "",
			assistantOpen: false,
			toolOpen: false,
			sawAssistantStream: false,
			hasFinalAssistantMessage: false,
			completedFromEvent: false,
			lastAssistantMessage: "",
			lastChatBlockRole: null,
			currentToolId: null,
			fileSnapshots: new Map(),
			fileWatchers: new Map(),
			activePatchPaths: [],
			commandOutputs: new Map(),
		};
	},

	createHandle(prompt, ctx, state): AgentHandle {
		let proc: ReturnType<typeof Bun.spawn> | null = null;
		const killProcess = () => {
			try {
				if (proc?.pid) PidTracker.killPid(proc.pid);
				else proc?.kill();
			} catch {}
		};

		return {
			async run() {
				const args = buildCodexInvocationArgs(prompt, ctx, state.outputPath);

				proc = Bun.spawn(args, {
					stdout: "pipe",
					stderr: "pipe",
					cwd: ctx.cwd,
					env: createAgentEnv("codex"),
				});
				if (proc.pid) PidTracker.trackPid(proc.pid);

				const stderrPromise = drainStreamToString(
					proc.stderr as ReadableStream<Uint8Array>
				);
				const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
				const decoder = new TextDecoder();
				let leftover = "";
				let completionStopRequested = false;
				const handleStdoutEvent = (event: unknown) => {
					const eventRecord = asRecord(event);
					const payload = asRecord(eventRecord?.payload);
					handleCodexEvent(
						ctx,
						state,
						eventRecord?.type === "event_msg" && payload?.type ? payload : event
					);
				};

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					leftover += decoder.decode(value, { stream: true });
					leftover = parseNdjsonLines(leftover, handleStdoutEvent);
					if (state.completedFromEvent && !completionStopRequested) {
						completionStopRequested = true;
						killProcess();
					}
				}
				flushNdjsonLeftover(leftover, handleStdoutEvent);

				const exitCode = await proc.exited;
				if (proc.pid) PidTracker.untrackPid(proc.pid);
				proc = null;
				const stderrText = (await stderrPromise).trim();
				for (const watcher of state.fileWatchers.values())
					clearInterval(watcher);
				state.fileWatchers.clear();

				// Finalize
				if (state.toolOpen || state.assistantOpen) {
					if (state.currentToolId) {
						ctx.emitAgentEvent({
							type: "tool-call-end",
							toolCallId: state.currentToolId,
						});
					}
					ctx.emitChatEvent({ type: "content_block_stop" });
					state.toolOpen = false;
					state.assistantOpen = false;
					state.currentToolId = null;
				}

				let assistantText = "";
				const outputFile = Bun.file(state.outputPath);
				try {
					if (await outputFile.exists()) {
						assistantText = (await outputFile.text()).trim();
					}
				} finally {
					await unlink(state.outputPath).catch(noop);
				}
				const shouldEmitOutputFallback = shouldEmitCodexOutputFallback({
					outputText: assistantText,
					lastAssistantMessage: state.lastAssistantMessage,
					hasFinalAssistantMessage: state.hasFinalAssistantMessage,
					lastChatBlockRole: state.lastChatBlockRole,
				});
				if (assistantText) state.lastAssistantMessage = assistantText;
				if (shouldEmitOutputFallback) {
					ctx.emitChatEvent({
						type: "result",
						result: assistantText,
					});
					ctx.emitAgentEvent({ type: "result", text: assistantText });
					state.hasFinalAssistantMessage = true;
					state.lastChatBlockRole = "assistant";
				} else if (
					exitCode !== 0 &&
					stderrText &&
					!state.completedFromEvent &&
					!ctx.isCancelled()
				) {
					ctx.emitAgentEvent({ type: "error", message: stderrText });
					ctx.emitSystemMessage(stderrText);
				}
				const finishReason = ctx.isCancelled()
					? "cancelled"
					: exitCode === 0 || state.completedFromEvent
						? "completed"
						: `exit:${exitCode}`;
				ctx.emitAgentEvent({ type: "finish", reason: finishReason });

				return { lastAssistantMessage: state.lastAssistantMessage };
			},

			stop: killProcess,
			kill: killProcess,
		};
	},
};
