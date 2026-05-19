import type { ServerWebSocket } from "bun";
import type { ChatAgentKind } from "../../features/agents/agents.ts";
import { getToolBlockInitialContent } from "../../features/chat/chat-stream-events.ts";
import {
	createAgentEnv,
	resolveAgentBinary,
} from "../../features/terminal/terminal-command.ts";
import type { AgentEvent } from "../agents/events.ts";
import { getAgentAdapter, resolveAgentModel } from "../agents/registry.ts";
import {
	drainStreamToString,
	flushNdjsonLeftover,
	parseNdjsonLines,
} from "../agents/stream-utils.ts";
import type { AgentHandle, AgentRunContext } from "../agents/types.ts";
import { resolveAllowedLocalPath } from "../security.ts";
import { CheckpointService } from "./checkpoint.ts";

interface ServerChatMessage {
	id: string;
	role: "user" | "assistant" | "tool" | "system";
	content: string;
	toolName?: string;
	isStreaming?: boolean;
}

const MAX_BUFFER_MESSAGES = 100;
const MAX_BUFFER_CHARS = 200_000;
const DISCONNECTED_SESSION_TTL_MS = 5 * 60 * 1000;

let serverMsgId = 0;

class ChatMessageBuffer {
	private messages: ServerChatMessage[] = [];
	private currentAssistantIdx = -1;
	private currentToolIdx = -1;
	private hasStreamed = false;

	private push(
		role: ServerChatMessage["role"],
		content: string,
		extra?: Partial<ServerChatMessage>
	) {
		this.messages.push({ id: `s${++serverMsgId}`, role, content, ...extra });
		this.trim();
	}

	pushUser(text: string) {
		this.push("user", text);
	}
	pushSystem(text: string) {
		this.push("system", text);
	}
	pushAssistant(text: string) {
		this.push("assistant", text);
	}

	applyEvent(event: any) {
		if (!event?.type) return;

		if (event.type === "assistant") {
			const msg = event.message;
			if (!msg?.content || this.hasStreamed) return;
			for (const block of msg.content) {
				if (block.type === "text" && block.text) {
					if (
						this.currentAssistantIdx >= 0 &&
						this.currentAssistantIdx < this.messages.length
					) {
						this.messages[this.currentAssistantIdx]!.content = block.text;
						this.messages[this.currentAssistantIdx]!.isStreaming =
							!msg.stop_reason;
					} else {
						this.currentAssistantIdx = this.messages.length;
						this.push("assistant", block.text, {
							isStreaming: !msg.stop_reason,
						});
					}
				} else if (block.type === "tool_use") {
					this.currentAssistantIdx = -1;
					this.currentToolIdx = this.messages.length;
					const inputStr =
						typeof block.input === "string"
							? block.input
							: JSON.stringify(block.input, null, 2);
					this.push("tool", inputStr, {
						toolName: block.name,
						isStreaming: true,
					});
				}
			}
		} else if (event.type === "content_block_start") {
			this.hasStreamed = true;
			const block = event.content_block;
			if (block?.type === "text") {
				this.currentAssistantIdx = this.messages.length;
				this.push("assistant", block.text || "", { isStreaming: true });
			} else if (block?.type === "tool_use") {
				this.currentAssistantIdx = -1;
				this.currentToolIdx = this.messages.length;
				this.push("tool", getToolBlockInitialContent(block), {
					toolName: block.name,
					isStreaming: true,
				});
			}
		} else if (event.type === "content_block_delta") {
			const delta = event.delta;
			if (
				delta?.type === "text_delta" &&
				delta.text &&
				this.currentAssistantIdx >= 0
			) {
				this.messages[this.currentAssistantIdx]!.content += delta.text;
			} else if (
				delta?.type === "input_json_delta" &&
				delta.partial_json &&
				this.currentToolIdx >= 0
			) {
				this.messages[this.currentToolIdx]!.content += delta.partial_json;
			}
		} else if (event.type === "content_block_stop") {
			if (
				this.currentAssistantIdx >= 0 &&
				this.currentAssistantIdx < this.messages.length
			) {
				this.messages[this.currentAssistantIdx]!.isStreaming = false;
				this.currentAssistantIdx = -1;
			}
			if (
				this.currentToolIdx >= 0 &&
				this.currentToolIdx < this.messages.length
			) {
				this.messages[this.currentToolIdx]!.isStreaming = false;
				this.currentToolIdx = -1;
			}
		} else if (event.type === "result" && event.result) {
			if (
				this.currentAssistantIdx >= 0 &&
				this.currentAssistantIdx < this.messages.length
			) {
				this.messages[this.currentAssistantIdx]!.content = event.result;
				this.messages[this.currentAssistantIdx]!.isStreaming = false;
				this.currentAssistantIdx = -1;
			} else {
				this.push("assistant", event.result);
			}
		}
	}

	finalize() {
		for (const m of this.messages) m.isStreaming = false;
		this.currentAssistantIdx = -1;
		this.currentToolIdx = -1;
		this.hasStreamed = false;
		this.trim();
	}

	replaceInAssistantMessages(replacer: (content: string) => string) {
		for (const message of this.messages) {
			if (message.role !== "assistant") continue;
			message.content = replacer(message.content);
		}
	}

	getMessages(): ServerChatMessage[] {
		return this.messages;
	}
	get streaming(): boolean {
		return this.currentAssistantIdx >= 0 || this.currentToolIdx >= 0;
	}

	private trim() {
		if (this.messages.length > MAX_BUFFER_MESSAGES) {
			const drop = this.messages.length - MAX_BUFFER_MESSAGES;
			this.messages = this.messages.slice(drop);
			this.currentAssistantIdx =
				this.currentAssistantIdx >= drop ? this.currentAssistantIdx - drop : -1;
			this.currentToolIdx =
				this.currentToolIdx >= drop ? this.currentToolIdx - drop : -1;
		}
		let totalChars = this.messages.reduce(
			(sum, m) => sum + m.content.length,
			0
		);
		while (totalChars > MAX_BUFFER_CHARS && this.messages.length > 1) {
			totalChars -= this.messages[0]?.content.length ?? 0;
			this.messages.shift();
			this.currentAssistantIdx =
				this.currentAssistantIdx >= 1 ? this.currentAssistantIdx - 1 : -1;
			this.currentToolIdx =
				this.currentToolIdx >= 1 ? this.currentToolIdx - 1 : -1;
		}
	}
}

interface ChatSession {
	paneId: string;
	agentKind: ChatAgentKind;
	model?: string;
	reasoningLevel?: string;
	sessionId: string | null;
	clients: Set<ServerWebSocket<any>>;
	currentHandle: AgentHandle | null;
	cwd: string;
	referencePaths: string[];
	messageBuffer: ChatMessageBuffer;
	cleanupTimer: ReturnType<typeof setTimeout> | null;
	goal: GoalState | null;
	agentEvents: AgentEvent[];
}

interface GoalState {
	objective: string;
	status: "active" | "paused";
	turns: number;
	startedAt: number;
}

interface GoalActivityInfo {
	id: string;
	type: "status" | "tool" | "result" | "system" | "error";
	label: string;
	detail: string | null;
	state: "running" | "complete" | "paused" | "error";
}

export interface AgentGoalInfo {
	paneId: string;
	agentKind: ChatAgentKind;
	cwd: string;
	sessionId: string | null;
	isRunning: boolean;
	clientCount: number;
	objective: string;
	status: "active" | "paused";
	turns: number;
	startedAt: number;
	elapsedMs: number;
	recentMessages: Array<{
		role: "assistant" | "system";
		content: string;
	}>;
	brief: {
		phase: string;
		currentStep: string;
		nextAction: string;
		blocker: string | null;
		lastResult: string | null;
	};
	activity: GoalActivityInfo[];
	files: string[];
	checks: string[];
}

interface AgentSessionInfo {
	paneId: string;
	agentKind: ChatAgentKind;
	cwd: string;
	referencePaths: string[];
	sessionId: string | null;
	isRunning: boolean;
	clientCount: number;
	messageCount: number;
}

const _g = globalThis as any;
if (!_g.__inferay_chatSessions)
	_g.__inferay_chatSessions = new Map<string, ChatSession>();
const sessions: Map<string, ChatSession> = _g.__inferay_chatSessions;

function sendTo(ws: ServerWebSocket<any>, msg: object) {
	if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(session: ChatSession, msg: object) {
	const json = JSON.stringify(msg);
	for (const ws of session.clients) if (ws.readyState === 1) ws.send(json);
}

function broadcastExcept(
	session: ChatSession,
	exclude: ServerWebSocket<any>,
	msg: object
) {
	const json = JSON.stringify(msg);
	for (const ws of session.clients)
		if (ws !== exclude && ws.readyState === 1) ws.send(json);
}

function clearCleanupTimer(session: ChatSession) {
	if (session.cleanupTimer) {
		clearTimeout(session.cleanupTimer);
		session.cleanupTimer = null;
	}
}

function scheduleSessionCleanup(session: ChatSession) {
	clearCleanupTimer(session);
	if (session.currentHandle || session.clients.size > 0) return;
	session.cleanupTimer = setTimeout(() => {
		const current = sessions.get(session.paneId);
		if (!current || current.currentHandle || current.clients.size > 0) return;
		sessions.delete(session.paneId);
	}, DISCONNECTED_SESSION_TTL_MS);
}

function updateSessionId(
	session: ChatSession,
	paneId: string,
	nextSessionId: string | null
) {
	if (!nextSessionId || session.sessionId === nextSessionId) return;
	session.sessionId = nextSessionId;
	broadcast(session, {
		type: "chat:session",
		paneId,
		sessionId: nextSessionId,
	});
}

function normalizeReferencePaths(paths?: string[]): string[] {
	if (!Array.isArray(paths)) return [];
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const path of paths) {
		if (typeof path !== "string") continue;
		const resolved = resolveAllowedLocalPath(path.trim());
		if (!resolved || seen.has(resolved)) continue;
		seen.add(resolved);
		normalized.push(resolved);
	}
	return normalized;
}

function normalizeCwd(cwd?: string): string {
	return (cwd ? resolveAllowedLocalPath(cwd) : null) ?? process.cwd();
}

async function finalizeCheckpoint(
	session: ChatSession,
	paneId: string,
	checkpointId: string | null
) {
	if (!checkpointId) return;
	try {
		const cpMeta = await CheckpointService.finalizeCheckpoint(checkpointId);
		if (cpMeta && cpMeta.changedFileCount > 0) {
			broadcast(session, {
				type: "checkpoint:finalized",
				paneId,
				checkpointId,
				changedFileCount: cpMeta.changedFileCount,
				changedFiles: cpMeta.changedFiles,
			});
		}
	} catch (e) {
		console.error("[Checkpoint] Failed to finalize:", e);
	}
}

function finalizeChatTurn(session: ChatSession, paneId: string) {
	session.messageBuffer.finalize();
	broadcast(session, {
		type: "chat:sync",
		paneId,
		messages: session.messageBuffer.getMessages(),
		isStreaming: false,
	});
	broadcast(session, { type: "chat:done", paneId });
	scheduleSessionCleanup(session);
}

async function runAgent(
	session: ChatSession,
	paneId: string,
	text: string,
	emitDone = true
) {
	const adapter = getAgentAdapter(session.agentKind);
	const prompt =
		session.agentKind === "codex"
			? `${CODEX_WORKFLOW_INSTRUCTIONS}\n\n${text}`
			: text;
	session.agentEvents ??= [];
	const ctx: AgentRunContext = {
		paneId,
		cwd: session.cwd,
		referencePaths: session.referencePaths,
		model: session.model,
		reasoningLevel: session.reasoningLevel,
		getSessionId: () => session.sessionId,
		updateSessionId: (nextSessionId) =>
			updateSessionId(session, paneId, nextSessionId),
		emitChatEvent: (event) => {
			broadcast(session, { type: "chat:event", paneId, event });
			session.messageBuffer.applyEvent(event);
		},
		emitAgentEvent: (event) => {
			session.agentEvents.push(event);
			if (session.agentEvents.length > 500) {
				session.agentEvents = session.agentEvents.slice(-500);
			}
			broadcast(session, { type: "chat:agent-event", paneId, event });
		},
		emitStatus: (status, isLoading = true) =>
			broadcast(session, { type: "chat:status", paneId, status, isLoading }),
		emitActivity: (activity) =>
			broadcast(session, { type: "chat:activity", paneId, activity }),
		emitSystemMessage: (message) => {
			session.messageBuffer.pushSystem(message);
			broadcast(session, { type: "chat:system", paneId, message });
		},
	};
	const state = adapter.createState(ctx);
	const handle = adapter.createHandle(prompt, ctx, state);
	session.currentHandle = handle;

	try {
		return await handle.run();
	} finally {
		session.currentHandle = null;
		if (emitDone) finalizeChatTurn(session, paneId);
	}
}

const GOAL_MAX_TURNS = 20;
const GOAL_COMPLETE_MARKER = "[[GOAL_COMPLETE]]";
const GOAL_NEEDS_INPUT_MARKER = "[[GOAL_NEEDS_INPUT]]";
const CODEX_WORKFLOW_INSTRUCTIONS = `<inferay-workflow-instructions>
Do not run formatters with write mode as a routine chat-completion step. In this project, do not run \`bunx biome check --write ...\` unless the user explicitly asks for Biome formatting.
Do not run \`bun run build:renderer\` at the end of every chat. Run builds/tests only when the user requests verification or when the change genuinely needs that specific check.
If formatting is needed, prefer the project's intended formatting or commit-hook flow and keep formatting-only churn out of unrelated edits.
</inferay-workflow-instructions>`;

function parseGoalCommand(
	text: string
):
	| { action: "start"; objective: string }
	| { action: "pause" | "resume" | "clear" | "status" }
	| null {
	const match = text.trim().match(/^\/goal(?:\s+([\s\S]*))?$/i);
	if (!match) return null;
	const args = (match[1] ?? "").trim();
	const subcommand = args.toLowerCase();
	if (subcommand === "pause") return { action: "pause" };
	if (subcommand === "resume") return { action: "resume" };
	if (subcommand === "clear" || subcommand === "stop")
		return { action: "clear" };
	if (subcommand === "status" || !args) return { action: "status" };
	return { action: "start", objective: args };
}

function createGoalPrompt(objective: string) {
	return `Start pursuing this goal until it is genuinely complete:\n\n${objective}\n\nWork autonomously. When the goal is fully achieved, include ${GOAL_COMPLETE_MARKER} in your final response. If you are blocked and need user input, include ${GOAL_NEEDS_INPUT_MARKER}.`;
}

function createGoalContinuationPrompt(goal: GoalState) {
	return `<goal-continuation>
Objective: ${goal.objective}
Turns used: ${goal.turns}
Elapsed milliseconds: ${Date.now() - goal.startedAt}

Continue working toward the objective. Do not ask for confirmation unless you are blocked. When the goal is fully achieved, include ${GOAL_COMPLETE_MARKER} in your final response. If you need user input to proceed, include ${GOAL_NEEDS_INPUT_MARKER}.
</goal-continuation>`;
}

function goalResultStatus(text?: string): "complete" | "paused" | "active" {
	if (!text) return "active";
	if (text.includes(GOAL_COMPLETE_MARKER)) return "complete";
	if (text.includes(GOAL_NEEDS_INPUT_MARKER)) return "paused";
	return "active";
}

function stripGoalMarkers(text: string): string {
	return text
		.replaceAll(GOAL_COMPLETE_MARKER, "")
		.replaceAll(GOAL_NEEDS_INPUT_MARKER, "")
		.trim();
}

function getLastAssistantMessage(result: Awaited<ReturnType<typeof runAgent>>) {
	return result && typeof result === "object"
		? result.lastAssistantMessage
		: undefined;
}

function firstUsefulLine(text: string, max = 140): string {
	const line =
		text
			.split("\n")
			.map((item) => item.trim())
			.find(Boolean) ?? "";
	return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

function collectStrings(value: unknown, keys: string[], output: Set<string>) {
	if (!value || typeof value !== "object") return;
	const payload = value as Record<string, unknown>;
	for (const key of keys) {
		const item = payload[key];
		if (typeof item === "string" && item.trim()) output.add(item.trim());
	}
	const changes = payload.changes ?? payload.files;
	if (Array.isArray(changes)) {
		for (const change of changes) {
			if (typeof change === "string" && change.trim()) {
				output.add(change.trim());
			} else if (change && typeof change === "object") {
				collectStrings(change, keys, output);
			}
		}
	}
}

function deriveGoalView(session: ChatSession) {
	const messages = session.messageBuffer.getMessages();
	const recentMessages = messages
		.filter(
			(message) =>
				(message.role === "assistant" || message.role === "system") &&
				message.content.trim()
		)
		.slice(-8)
		.map((message) => ({
			role: message.role as "assistant" | "system",
			content: message.content,
		}));
	const latestAssistant = [...messages]
		.reverse()
		.find((message) => message.role === "assistant" && message.content.trim());
	const latestSystem = [...messages]
		.reverse()
		.find((message) => message.role === "system" && message.content.trim());
	const latestEvent = [...session.agentEvents]
		.reverse()
		.find((event) => event.type !== "text-delta" && event.type !== "raw");
	const files = new Set<string>();
	const checks = new Set<string>();
	const activity: GoalActivityInfo[] = session.agentEvents
		.map((event, index) => {
			if (event.type === "status") {
				return {
					id: `status-${index}`,
					type: "status" as const,
					label: event.label ?? event.status,
					detail: null,
					state:
						event.status === "error"
							? ("error" as const)
							: event.status === "idle"
								? ("complete" as const)
								: ("running" as const),
				};
			}
			if (event.type === "tool-call-start") {
				collectStrings(event.input, ["path", "file", "file_path"], files);
				if (event.toolName === "exec" || event.toolName === "bash") {
					if (event.summary) checks.add(event.summary);
				}
				return {
					id: event.toolCallId,
					type: "tool" as const,
					label: event.toolName,
					detail: event.summary ?? null,
					state: "running" as const,
				};
			}
			if (event.type === "tool-call-end") {
				return {
					id: `${event.toolCallId}-end`,
					type: "tool" as const,
					label: event.error ? "Tool failed" : "Tool finished",
					detail: event.error ?? null,
					state: event.error ? ("error" as const) : ("complete" as const),
				};
			}
			if (event.type === "result") {
				return {
					id: `result-${index}`,
					type: "result" as const,
					label: "Result",
					detail: firstUsefulLine(event.text),
					state: "complete" as const,
				};
			}
			if (event.type === "error") {
				return {
					id: `error-${index}`,
					type: "error" as const,
					label: "Error",
					detail: event.message,
					state: "error" as const,
				};
			}
			return null;
		})
		.filter((event): event is NonNullable<typeof event> => !!event)
		.slice(-30);
	if (latestSystem?.content) {
		activity.push({
			id: `system-${activity.length}`,
			type: "system",
			label: "System",
			detail: firstUsefulLine(latestSystem.content),
			state: session.goal?.status === "paused" ? "paused" : "complete",
		});
	}
	const currentStep =
		latestEvent?.type === "tool-call-start"
			? `${latestEvent.toolName}${latestEvent.summary ? `: ${latestEvent.summary}` : ""}`
			: latestEvent?.type === "status"
				? (latestEvent.label ?? latestEvent.status)
				: session.currentHandle
					? "Working"
					: session.goal?.status === "paused"
						? "Paused"
						: "Waiting";
	const blocker =
		session.goal?.status === "paused"
			? latestSystem
				? firstUsefulLine(latestSystem.content)
				: "Paused"
			: null;
	return {
		recentMessages,
		brief: {
			phase: session.currentHandle
				? "Running"
				: session.goal?.status === "paused"
					? "Paused"
					: "Active",
			currentStep,
			nextAction:
				session.goal?.status === "paused"
					? "Resume when ready"
					: session.currentHandle
						? "Continue current turn"
						: "Continue goal loop",
			blocker,
			lastResult: latestAssistant
				? firstUsefulLine(latestAssistant.content)
				: null,
		},
		activity,
		files: [...files].slice(-12),
		checks: [...checks].slice(-8),
	};
}

async function handleGoalCommand(
	session: ChatSession,
	paneId: string,
	command: NonNullable<ReturnType<typeof parseGoalCommand>>
) {
	if (command.action === "start") {
		session.goal = {
			objective: command.objective,
			status: "active",
			turns: 0,
			startedAt: Date.now(),
		};
		session.messageBuffer.pushSystem(`Goal started: ${command.objective}`);
		broadcast(session, {
			type: "chat:system",
			paneId,
			message: `Goal started: ${command.objective}`,
		});
		return createGoalPrompt(command.objective);
	}

	if (command.action === "pause") {
		if (session.goal) session.goal.status = "paused";
		const message = session.goal ? "Goal paused" : "No active goal";
		session.messageBuffer.pushSystem(message);
		broadcast(session, { type: "chat:system", paneId, message });
		return null;
	}

	if (command.action === "resume") {
		if (!session.goal) {
			const message = "No goal to resume";
			session.messageBuffer.pushSystem(message);
			broadcast(session, { type: "chat:system", paneId, message });
			return null;
		}
		session.goal.status = "active";
		return createGoalContinuationPrompt(session.goal);
	}

	if (command.action === "clear") {
		session.goal = null;
		const message = "Goal cleared";
		session.messageBuffer.pushSystem(message);
		broadcast(session, { type: "chat:system", paneId, message });
		return null;
	}

	const message = session.goal
		? `Goal ${session.goal.status}: ${session.goal.objective} (${session.goal.turns} turns)`
		: "No active goal";
	session.messageBuffer.pushSystem(message);
	broadcast(session, { type: "chat:system", paneId, message });
	return null;
}

export const ChatService = {
	async sendMessage(
		paneId: string,
		text: string,
		ws: ServerWebSocket<any>,
		cwd?: string,
		referencePaths?: string[],
		clientSessionId?: string | null,
		agentKind: ChatAgentKind = "claude",
		model?: string,
		reasoningLevel?: string,
		systemPrefix?: string
	) {
		const nextReferencePaths = normalizeReferencePaths(referencePaths);
		const nextCwd = normalizeCwd(cwd);
		let session = sessions.get(paneId);
		if (!session) {
			session = {
				paneId,
				agentKind,
				model,
				reasoningLevel,
				sessionId: clientSessionId || null,
				clients: new Set([ws]),
				currentHandle: null,
				cwd: nextCwd,
				referencePaths: nextReferencePaths,
				messageBuffer: new ChatMessageBuffer(),
				cleanupTimer: null,
				goal: null,
				agentEvents: [],
			};
			sessions.set(paneId, session);
		}
		session.referencePaths ??= [];
		clearCleanupTimer(session);
		if (session.agentKind !== agentKind) {
			session.sessionId = null; // clear when switching agent kinds
		}
		session.agentKind = agentKind;
		session.model = resolveAgentModel(agentKind, model);
		if (reasoningLevel !== undefined) session.reasoningLevel = reasoningLevel;
		session.clients.add(ws);
		if (cwd) session.cwd = nextCwd;
		if (referencePaths) session.referencePaths = nextReferencePaths;
		if (!session.sessionId && clientSessionId)
			updateSessionId(session, paneId, clientSessionId);

		session.messageBuffer.pushUser(text);
		broadcastExcept(session, ws, { type: "chat:user_message", paneId, text });

		if (session.currentHandle) {
			sendTo(ws, {
				type: "chat:error",
				paneId,
				error: `${getAgentAdapter(session.agentKind).displayName} is still responding`,
			});
			return;
		}

		const goalCommand = agentKind === "codex" ? parseGoalCommand(text) : null;
		let prompt = text;
		if (goalCommand) {
			const goalPrompt = await handleGoalCommand(session, paneId, goalCommand);
			if (!goalPrompt) {
				finalizeChatTurn(session, paneId);
				return;
			}
			prompt = goalPrompt;
		}
		if (systemPrefix) {
			prompt = `${systemPrefix}\n\n${prompt}`;
		}

		let checkpointId: string | null = null;
		try {
			checkpointId = await CheckpointService.createCheckpoint(
				paneId,
				session.cwd,
				text
			);
			broadcast(session, { type: "checkpoint:created", paneId, checkpointId });
		} catch (e) {
			console.error("[Checkpoint] Failed to create:", e);
		}

		try {
			const isGoalRun = session.goal?.status === "active";
			let result = await runAgent(session, paneId, prompt, !isGoalRun);
			if (isGoalRun && session.goal?.status === "active") {
				session.goal.turns += 1;
				let resultStatus = goalResultStatus(getLastAssistantMessage(result));
				while (
					session.goal?.status === "active" &&
					resultStatus === "active" &&
					session.goal.turns < GOAL_MAX_TURNS
				) {
					const nextPrompt = createGoalContinuationPrompt(session.goal);
					result = await runAgent(session, paneId, nextPrompt, false);
					session.goal.turns += 1;
					resultStatus = goalResultStatus(getLastAssistantMessage(result));
				}

				if (session.goal && resultStatus === "complete") {
					session.messageBuffer.replaceInAssistantMessages(stripGoalMarkers);
					const message = `Goal achieved after ${session.goal.turns} turns`;
					session.goal = null;
					session.messageBuffer.pushSystem(message);
					broadcast(session, { type: "chat:system", paneId, message });
				} else if (session.goal && resultStatus === "paused") {
					session.messageBuffer.replaceInAssistantMessages(stripGoalMarkers);
					session.goal.status = "paused";
					const message =
						"Goal paused because Codex needs input. Reply with the missing detail or use /goal resume.";
					session.messageBuffer.pushSystem(message);
					broadcast(session, { type: "chat:system", paneId, message });
				} else if (session.goal && session.goal.turns >= GOAL_MAX_TURNS) {
					session.goal.status = "paused";
					const message = `Goal paused after ${GOAL_MAX_TURNS} turns`;
					session.messageBuffer.pushSystem(message);
					broadcast(session, { type: "chat:system", paneId, message });
				}
				finalizeChatTurn(session, paneId);
			}
			await finalizeCheckpoint(session, paneId, checkpointId);
		} catch (e) {
			session.currentHandle = null;
			const errMsg =
				e instanceof Error ? e.message : `Failed to run ${session.agentKind}`;
			session.messageBuffer.pushSystem(errMsg);
			session.messageBuffer.finalize();
			broadcast(session, { type: "chat:error", paneId, error: errMsg });
			await finalizeCheckpoint(session, paneId, checkpointId);
			scheduleSessionCleanup(session);
		}
	},

	async sendBtwMessage(
		paneId: string,
		text: string,
		ws: ServerWebSocket<any>,
		cwd?: string
	) {
		const effectiveCwd = normalizeCwd(cwd);
		const claudeCmd = resolveAgentBinary("claude");

		sendTo(ws, { type: "chat:btw:start", paneId, question: text });

		let fullText = "";

		try {
			const proc = Bun.spawn(
				[
					claudeCmd,
					"-p",
					text,
					"--dangerously-skip-permissions",
					"--output-format",
					"stream-json",
					"--verbose",
				],
				{
					stdout: "pipe",
					stderr: "pipe",
					cwd: effectiveCwd,
					env: createAgentEnv("claude"),
				}
			);
			const stderrPromise = drainStreamToString(
				proc.stderr as ReadableStream<Uint8Array>
			);
			const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
			const decoder = new TextDecoder();
			let leftover = "";

			const handleBtwEvent = (event: any) => {
				if (
					event.type === "content_block_delta" &&
					event.delta?.type === "text_delta"
				) {
					fullText += event.delta.text;
					sendTo(ws, {
						type: "chat:btw:delta",
						paneId,
						text: event.delta.text,
					});
				} else if (
					event.type === "content_block_start" &&
					event.content_block?.type === "text" &&
					event.content_block.text
				) {
					fullText += event.content_block.text;
					sendTo(ws, {
						type: "chat:btw:delta",
						paneId,
						text: event.content_block.text,
					});
				} else if (event.type === "result" && event.result && !fullText) {
					fullText = event.result;
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				leftover += decoder.decode(value, { stream: true });
				leftover = parseNdjsonLines(leftover, handleBtwEvent);
			}
			flushNdjsonLeftover(leftover, handleBtwEvent);
			await proc.exited;
			const stderrText = (await stderrPromise).trim();
			if (!fullText && stderrText) {
				fullText = stderrText;
			}
		} catch (err: any) {
			if (!fullText) {
				fullText = err.message || "(error)";
			}
		}

		sendTo(ws, {
			type: "chat:btw:done",
			paneId,
			answer: fullText || "(no response)",
		});
	},

	stopGeneration(paneId: string) {
		const session = sessions.get(paneId);
		if (session?.currentHandle) {
			try {
				session.currentHandle.stop();
			} catch {}
		}
	},

	destroySession(paneId: string) {
		const session = sessions.get(paneId);
		if (session?.currentHandle) {
			try {
				session.currentHandle.kill();
			} catch {}
		}
		if (session) clearCleanupTimer(session);
		sessions.delete(paneId);
	},

	cleanupWs(ws: ServerWebSocket<any>) {
		for (const session of sessions.values()) {
			session.clients.delete(ws);
			scheduleSessionCleanup(session);
		}
	},

	reassignWs(paneId: string, ws: ServerWebSocket<any>) {
		const session = sessions.get(paneId);
		if (!session) return;
		clearCleanupTimer(session);
		session.clients.add(ws);
		if (session.sessionId)
			sendTo(ws, {
				type: "chat:session",
				paneId,
				sessionId: session.sessionId,
			});
		const messages = session.messageBuffer.getMessages();
		if (messages.length > 0)
			sendTo(ws, {
				type: "chat:sync",
				paneId,
				messages,
				isStreaming: session.messageBuffer.streaming,
			});
		if (session.currentHandle)
			sendTo(ws, {
				type: "chat:status",
				paneId,
				status: session.messageBuffer.streaming ? "responding" : "thinking",
				isLoading: true,
			});
	},

	listSessions(): AgentSessionInfo[] {
		return Array.from(sessions.values())
			.filter((s) => s.currentHandle || s.clients.size > 0)
			.map((s) => ({
				paneId: s.paneId,
				agentKind: s.agentKind,
				cwd: s.cwd,
				referencePaths: s.referencePaths,
				sessionId: s.sessionId,
				isRunning: !!s.currentHandle,
				clientCount: s.clients.size,
				messageCount: s.messageBuffer.getMessages().length,
			}));
	},

	listGoals(): AgentGoalInfo[] {
		const now = Date.now();
		return Array.from(sessions.values())
			.filter((session) => !!session.goal)
			.map((session) => {
				const view = deriveGoalView(session);
				return {
					paneId: session.paneId,
					agentKind: session.agentKind,
					cwd: session.cwd,
					sessionId: session.sessionId,
					isRunning: !!session.currentHandle,
					clientCount: session.clients.size,
					objective: session.goal!.objective,
					status: session.goal!.status,
					turns: session.goal!.turns,
					startedAt: session.goal!.startedAt,
					elapsedMs: now - session.goal!.startedAt,
					...view,
				};
			});
	},

	destroyAll() {
		for (const [_, session] of sessions) {
			if (session.currentHandle) {
				try {
					session.currentHandle.kill();
				} catch {}
			}
			clearCleanupTimer(session);
		}
		sessions.clear();
	},
};
