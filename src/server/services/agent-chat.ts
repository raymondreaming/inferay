import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ServerWebSocket } from "bun";
import type { ChatAgentKind } from "../../features/agents/agents.ts";
import type {
	ChatServerMessage,
	QueuedMessageInfo,
} from "../../features/chat/agent-chat-shared.ts";
import {
	type GoalSystemMessage,
	serializeGoalSystemMessage,
} from "../../features/chat/goal-system-message.ts";
import {
	getToolBlockInitialContent,
	isChatStreamEvent,
	prepareTranscriptForStorage,
	trimMessages,
} from "../../features/chat/agent-chat-shared.ts";
import {
	createAgentEnv,
	resolveAgentBinary,
} from "../../features/agent/agent-command.ts";
import { readJson, writeJson } from "../../lib/route-helpers.ts";
import { userDataPath } from "../../lib/user-data.ts";
import {
	type AgentEvent,
	type AgentHandle,
	type AgentRunContext,
	drainStreamToString,
	flushNdjsonLeftover,
	parseNdjsonLines,
} from "../agents/events.ts";
import { getAgentAdapter, resolveAgentModel } from "../agents/registry.ts";
import { resolveAllowedLocalPath } from "../security.ts";
import { CheckpointService } from "./checkpoint.ts";

const DISCONNECTED_SESSION_TTL_MS = 5 * 60 * 1000;
const TRANSCRIPT_PERSIST_DEBOUNCE_MS = 250;
const GOAL_MAX_TURNS = 20;
const CHAT_EVENTS_DIR = "chat-events";
const CHAT_QUEUE_DIR = userDataPath("chat-queues");
const CHAT_TRANSCRIPTS_DIR = "chat-transcripts";
const CODEX_WORKFLOW_INSTRUCTIONS = `<inferay-workflow-instructions>
For coding tasks, inspect the relevant repository context before concluding that information is missing. Continue through implementation and proportionate verification unless blocked or the user asked only for analysis.
During substantial work, provide brief progress updates before tool work and after meaningful findings. Keep updates factual and do not claim checks that were not run.
Lead the final response with the outcome, then include changed files, verification actually run, and any remaining limitation.
Do not run formatters with write mode as a routine chat-completion step. In this project, do not run \`bunx biome check --write ...\` unless the user explicitly asks for Biome formatting.
Do not run \`bun run build:renderer\` at the end of every chat. Run builds/tests only when the user requests verification or when the change genuinely needs that specific check.
If formatting is needed, prefer the project's intended formatting or commit-hook flow and keep formatting-only churn out of unrelated edits.
</inferay-workflow-instructions>`;
const GOAL_COMPLETE_MARKER = "[[GOAL_COMPLETE]]";
const GOAL_NEEDS_INPUT_MARKER = "[[GOAL_NEEDS_INPUT]]";
const GENERATION_STOPPED_MESSAGE = "Generation stopped";
const FINAL_SUMMARY_RECOVERY_PROMPT = `<inferay-final-summary-recovery>
The previous turn ended after a tool call without a final user-facing response. Provide the final summary now. Lead with the outcome, then state changed files, verification actually run, and any remaining limitation. Do not run more tools unless required to avoid an inaccurate claim.
</inferay-final-summary-recovery>`;

let serverMsgId = 0;

export interface ChatEventLogEntry {
	paneId: string;
	sequence: number;
	timestamp: number;
	type: string;
	payload: unknown;
}

export interface ChatTranscriptMessage {
	id: string;
	role: "user" | "assistant" | "tool" | "system";
	content: string;
	images?: string[];
	toolName?: string;
	isStreaming?: boolean;
}

// Goal command parsing and user-facing goal activity projection.
type GoalStatus = "active" | "paused";
type GoalResultStatus = GoalStatus | "complete";

interface GoalState {
	objective: string;
	status: GoalStatus;
	turns: number;
	startedAt: number;
}

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

function goalResultStatus(text?: string): GoalResultStatus {
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

function firstUsefulLine(text: string, max = 140): string {
	const line =
		text
			.split("\n")
			.map((item) => item.trim())
			.find(Boolean) ?? "";
	return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

function deriveGoalView(session: {
	goal: GoalState | null;
	currentHandle: unknown;
	agentEvents: AgentEvent[];
	messageBuffer: { getMessages(): ChatTranscriptMessage[] };
}) {
	const messages = session.messageBuffer.getMessages();
	const latestSystem = [...messages]
		.reverse()
		.find((message) => message.role === "system" && message.content.trim());
	const activity: Array<Record<string, string | null>> = [];
	const pushActivity = (
		id: string,
		type: string,
		label: string,
		detail: string | null,
		state: string
	) => {
		activity.push({ id, type, label, detail, state });
		if (activity.length > 30) activity.shift();
	};
	for (const [index, event] of session.agentEvents.entries()) {
		if (event.type === "status") {
			pushActivity(
				`status-${index}`,
				"status",
				event.label ?? event.status,
				null,
				event.status === "error"
					? "error"
					: event.status === "idle"
						? "complete"
						: "running"
			);
		} else if (event.type === "tool-call-start") {
			pushActivity(
				event.toolCallId,
				"tool",
				event.toolName,
				event.summary ?? null,
				"running"
			);
		} else if (event.type === "tool-call-end") {
			pushActivity(
				`${event.toolCallId}-end`,
				"tool",
				event.error ? "Tool failed" : "Tool finished",
				event.error ?? null,
				event.error ? "error" : "complete"
			);
		} else if (event.type === "result") {
			pushActivity(
				`result-${index}`,
				"result",
				"Result",
				firstUsefulLine(event.text),
				"complete"
			);
		} else if (event.type === "error") {
			pushActivity(`error-${index}`, "error", "Error", event.message, "error");
		}
	}
	if (latestSystem?.content) {
		pushActivity(
			`system-${activity.length}`,
			"system",
			"System",
			firstUsefulLine(latestSystem.content),
			session.goal?.status === "paused" ? "paused" : "complete"
		);
	}
	return { activity };
}

// In-memory transcript buffer used by live sessions and event-log replay.
class ChatMessageBuffer {
	private messages: ChatTranscriptMessage[] = [];
	private currentAssistantIdx = -1;
	private lastAssistantIdx = -1;
	private currentToolIdx = -1;
	private hasStreamed = false;
	private revision = 0;

	private push(
		role: ChatTranscriptMessage["role"],
		content: string,
		extra?: Partial<ChatTranscriptMessage>
	) {
		this.messages.push({ id: `s${++serverMsgId}`, role, content, ...extra });
		this.revision++;
		this.trim();
	}

	pushUser(text: string, images?: string[]) {
		this.push("user", text, { images: images?.length ? images : undefined });
	}

	pushSystem(text: string) {
		this.push("system", text);
	}

	private appendAssistant(content: string, isStreaming: boolean) {
		this.currentAssistantIdx = this.messages.length;
		this.lastAssistantIdx = this.currentAssistantIdx;
		this.push("assistant", content, { isStreaming });
	}

	private appendTool(name: string, content: string) {
		this.currentAssistantIdx = -1;
		this.currentToolIdx = this.messages.length;
		this.push("tool", content, { toolName: name, isStreaming: true });
	}

	private patchCurrent(
		key: "currentAssistantIdx" | "currentToolIdx",
		patch: Partial<ChatTranscriptMessage>
	) {
		const idx = this[key];
		if (idx < 0 || idx >= this.messages.length) return false;
		this.messages[idx] = { ...this.messages[idx]!, ...patch };
		this.revision++;
		return true;
	}

	applyEvent(event: unknown) {
		if (!isChatStreamEvent(event)) return;
		if (event.type === "assistant") {
			const msg = event.message;
			if (!msg?.content || this.hasStreamed) return;
			for (const block of msg.content) {
				if (block.type === "text" && block.text) {
					if (
						!this.patchCurrent("currentAssistantIdx", {
							content: block.text,
							isStreaming: !msg.stop_reason,
						})
					)
						this.appendAssistant(block.text, !msg.stop_reason);
					else this.lastAssistantIdx = this.currentAssistantIdx;
				} else if (block.type === "tool_use") {
					this.appendTool(
						block.name,
						typeof block.input === "string"
							? block.input
							: JSON.stringify(block.input, null, 2)
					);
				}
			}
		} else if (event.type === "content_block_start") {
			this.hasStreamed = true;
			const block = event.content_block;
			if (block?.type === "text") {
				this.appendAssistant(block.text || "", true);
			} else if (block?.type === "tool_use") {
				this.appendTool(block.name, getToolBlockInitialContent(block));
			}
		} else if (event.type === "content_block_delta") {
			const delta = event.delta;
			if (
				delta?.type === "text_delta" &&
				delta.text &&
				this.currentAssistantIdx >= 0
			) {
				this.messages[this.currentAssistantIdx]!.content += delta.text;
				this.revision++;
			} else if (
				delta?.type === "input_json_delta" &&
				delta.partial_json &&
				this.currentToolIdx >= 0
			) {
				this.messages[this.currentToolIdx]!.content += delta.partial_json;
				this.revision++;
			}
		} else if (event.type === "content_block_stop") {
			this.patchCurrent("currentAssistantIdx", { isStreaming: false });
			this.patchCurrent("currentToolIdx", { isStreaming: false });
			this.currentAssistantIdx = -1;
			this.currentToolIdx = -1;
		} else if (event.type === "result" && event.result) {
			const assistantIdx =
				this.currentAssistantIdx >= 0
					? this.currentAssistantIdx
					: this.lastAssistantIdx;
			if (assistantIdx >= 0 && assistantIdx < this.messages.length) {
				this.messages[assistantIdx] = {
					...this.messages[assistantIdx]!,
					content: event.result,
					isStreaming: false,
				};
				this.revision++;
				this.currentAssistantIdx = -1;
				this.lastAssistantIdx = -1;
			} else {
				this.push("assistant", event.result);
			}
		}
	}

	finalize() {
		let changed = false;
		for (const message of this.messages) {
			if (message.isStreaming) changed = true;
			message.isStreaming = false;
		}
		this.currentAssistantIdx = -1;
		this.lastAssistantIdx = -1;
		this.currentToolIdx = -1;
		this.hasStreamed = false;
		if (changed) this.revision++;
		this.trim();
	}

	replaceInAssistantMessages(replacer: (content: string) => string) {
		for (const message of this.messages) {
			if (message.role !== "assistant") continue;
			const nextContent = replacer(message.content);
			if (nextContent === message.content) continue;
			message.content = nextContent;
			this.revision++;
		}
	}

	getMessages(): ChatTranscriptMessage[] {
		return this.messages;
	}

	getRevision(): number {
		return this.revision;
	}

	get streaming(): boolean {
		return this.currentAssistantIdx >= 0 || this.currentToolIdx >= 0;
	}

	replaceMessages(messages: ChatTranscriptMessage[]) {
		this.messages = messages.map((message) => ({
			...message,
			isStreaming: false,
		}));
		this.currentAssistantIdx = -1;
		this.lastAssistantIdx = -1;
		this.currentToolIdx = -1;
		this.hasStreamed = false;
		this.revision++;
		this.trim();
	}

	private trim() {
		const previous = this.messages;
		this.messages = trimMessages(this.messages);
		const drop = previous.length - this.messages.length;
		if (drop <= 0) return;
		this.revision++;
		this.currentAssistantIdx =
			this.currentAssistantIdx >= drop ? this.currentAssistantIdx - drop : -1;
		this.lastAssistantIdx =
			this.lastAssistantIdx >= drop ? this.lastAssistantIdx - drop : -1;
		this.currentToolIdx =
			this.currentToolIdx >= drop ? this.currentToolIdx - drop : -1;
	}
}

// Authoritative chat event log: append-only runtime history and replay.
const eventSequenceByPane = new Map<string, number>();
const pendingEventWrites = new Map<string, Promise<void>>();

function eventPath(paneId: string): string {
	return userDataPath(CHAT_EVENTS_DIR, `${paneId}.jsonl`);
}

function nextEventSequence(paneId: string): number {
	const floor = Date.now() * 1000;
	const previous = eventSequenceByPane.get(paneId) ?? 0;
	const next = Math.max(floor, previous + 1);
	eventSequenceByPane.set(paneId, next);
	return next;
}

function appendChatEvent(
	paneId: string,
	type: string,
	payload: unknown
): number {
	const sequence = nextEventSequence(paneId);
	const entry: ChatEventLogEntry = {
		paneId,
		sequence,
		timestamp: Date.now(),
		type,
		payload,
	};
	const path = eventPath(paneId);
	const previous = pendingEventWrites.get(paneId) ?? Promise.resolve();
	const nextWrite = previous
		.catch(() => {})
		.then(async () => {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(entry)}\n`);
		})
		.catch((error) => {
			console.error("[ChatEvents] Failed to append chat event:", error);
		});
	pendingEventWrites.set(paneId, nextWrite);
	return sequence;
}

function queueEventPayload(queue: unknown[]) {
	return {
		count: queue.length,
		messageIds: queue
			.map((item) =>
				item && typeof item === "object"
					? (item as { id?: unknown }).id
					: undefined
			)
			.filter((id): id is string => typeof id === "string"),
	};
}

async function readChatEvents(
	paneId: string,
	afterSequence = 0,
	limit = 500
): Promise<ChatEventLogEntry[]> {
	await pendingEventWrites.get(paneId)?.catch(() => {});
	const file = Bun.file(eventPath(paneId));
	if (!(await file.exists())) return [];
	const text = await file.text();
	const events: ChatEventLogEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as ChatEventLogEntry;
			if (
				entry.paneId === paneId &&
				entry.sequence > afterSequence &&
				events.length < limit
			) {
				events.push(entry);
			}
		} catch {}
	}
	return events;
}

function eventPayloadRecord(entry: ChatEventLogEntry): Record<string, unknown> {
	return entry.payload && typeof entry.payload === "object"
		? (entry.payload as Record<string, unknown>)
		: {};
}

function replayChatEvent(
	buffer: ChatMessageBuffer,
	entry: ChatEventLogEntry
): boolean {
	const payload = eventPayloadRecord(entry);
	if (entry.type === "user_message") {
		const text =
			typeof payload.displayText === "string"
				? payload.displayText
				: typeof payload.text === "string"
					? payload.text
					: "";
		const images = Array.isArray(payload.images)
			? payload.images.filter(
					(image): image is string => typeof image === "string"
				)
			: undefined;
		if (text || images?.length) {
			buffer.pushUser(text, images);
			return true;
		}
	} else if (entry.type === "system_message") {
		if (typeof payload.message === "string") {
			buffer.pushSystem(payload.message);
			return true;
		}
	} else if (entry.type === "agent_event") {
		const previousRevision = buffer.getRevision();
		buffer.applyEvent(entry.payload);
		return buffer.getRevision() !== previousRevision;
	}
	return false;
}

async function readEventLogTranscript(
	paneId: string
): Promise<ChatTranscriptMessage[] | null> {
	const events = await readChatEvents(paneId, 0, 10_000);
	if (events.length === 0) return null;
	const buffer = new ChatMessageBuffer();
	let hasTranscriptEvent = false;
	for (const event of events) {
		hasTranscriptEvent = replayChatEvent(buffer, event) || hasTranscriptEvent;
	}
	if (!hasTranscriptEvent) return null;
	buffer.finalize();
	return buffer.getMessages().map((message) => ({ ...message }));
}

async function readAuthoritativeTranscript(
	paneId: string
): Promise<ChatTranscriptMessage[] | null> {
	const fromEventLog = await readEventLogTranscript(paneId);
	if (fromEventLog) return fromEventLog;
	return readChatTranscript(paneId);
}

async function listEventLogPaneIds(): Promise<string[]> {
	return (await readdir(userDataPath(CHAT_EVENTS_DIR)).catch(() => [])).flatMap(
		(file) => (file.endsWith(".jsonl") ? [file.slice(0, -".jsonl".length)] : [])
	);
}

// Transcript snapshots are a fast cache; event replay is the restore authority.
const transcriptCache = new Map<string, ChatTranscriptMessage[] | null>();

function cloneTranscript(
	messages: ChatTranscriptMessage[] | null
): ChatTranscriptMessage[] | null {
	return messages?.map((message) => ({ ...message })) ?? null;
}

export async function readChatTranscript(
	paneId: string
): Promise<ChatTranscriptMessage[] | null> {
	if (transcriptCache.has(paneId)) {
		return cloneTranscript(transcriptCache.get(paneId) ?? null);
	}
	const transcript = await readJson<unknown>(
		userDataPath(CHAT_TRANSCRIPTS_DIR, `${paneId}.json`),
		null
	);
	const messages = isChatTranscript(transcript) ? transcript : null;
	transcriptCache.set(paneId, cloneTranscript(messages));
	return cloneTranscript(messages);
}

export async function writeChatTranscript(
	paneId: string,
	messages: ChatTranscriptMessage[]
): Promise<void> {
	const stored = prepareTranscriptForStorage(messages);
	transcriptCache.set(paneId, cloneTranscript(stored));
	await writeJson(userDataPath(CHAT_TRANSCRIPTS_DIR, `${paneId}.json`), stored);
}

function isChatTranscript(value: unknown): value is ChatTranscriptMessage[] {
	return (
		Array.isArray(value) &&
		value.every((message) => {
			if (typeof message !== "object" || message === null) return false;
			const candidate = message as Partial<ChatTranscriptMessage>;
			return (
				typeof candidate.id === "string" &&
				isChatRole(candidate.role) &&
				typeof candidate.content === "string" &&
				(candidate.images === undefined ||
					(Array.isArray(candidate.images) &&
						candidate.images.every((image) => typeof image === "string")))
			);
		})
	);
}

function isChatRole(value: unknown): value is ChatTranscriptMessage["role"] {
	return (
		value === "user" ||
		value === "assistant" ||
		value === "tool" ||
		value === "system"
	);
}

// Session and queue file state owned by the chat runtime.
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
	transcriptPersistTimer: ReturnType<typeof setTimeout> | null;
	cancelled: boolean;
	goal: GoalState | null;
	agentEvents: AgentEvent[];
}

interface ChatQueueFile {
	queue: unknown[];
	updatedAt: number;
}

function safePaneId(paneId: string): string {
	if (/^[a-zA-Z0-9._:-]+$/.test(paneId)) return paneId;
	throw new Error("Invalid pane id");
}

function chatQueuePath(paneId: string): string {
	return join(CHAT_QUEUE_DIR, `${safePaneId(paneId)}.json`);
}

async function loadChatQueue(paneId: string): Promise<unknown[]> {
	const stored = await readJson<ChatQueueFile>(chatQueuePath(paneId), {
		queue: [],
		updatedAt: 0,
	});
	return Array.isArray(stored.queue) ? stored.queue : [];
}

async function saveChatQueue(paneId: string, queue: unknown[]): Promise<void> {
	await writeJson(chatQueuePath(paneId), {
		queue,
		updatedAt: Date.now(),
	});
}

async function deleteChatQueue(paneId: string): Promise<void> {
	await rm(chatQueuePath(paneId), { force: true });
}

const _g = globalThis as any;
if (!_g.__inferay_chatSessions) {
	_g.__inferay_chatSessions = new Map<string, ChatSession>();
}
const sessions: Map<string, ChatSession> = _g.__inferay_chatSessions;

// Live session registry, websocket fanout, transcript flushing, and cleanup.
const chatRuntime = {
	async ensureSession(
		paneId: string,
		ws: ServerWebSocket<any> | undefined,
		agentKind: ChatAgentKind,
		cwd: string,
		referencePaths: string[],
		sessionId: string | null,
		model?: string,
		reasoningLevel?: string
	): Promise<ChatSession> {
		let session = sessions.get(paneId);
		if (session) {
			this.clearCleanupTimer(session);
			if (ws) session.clients.add(ws);
			return session;
		}

		const messageBuffer = new ChatMessageBuffer();
		const transcript = await readAuthoritativeTranscript(paneId);
		if (transcript?.length) messageBuffer.replaceMessages(transcript);
		session = {
			paneId,
			agentKind,
			model,
			reasoningLevel,
			sessionId,
			clients: ws ? new Set([ws]) : new Set(),
			currentHandle: null,
			cwd,
			referencePaths,
			messageBuffer,
			cleanupTimer: null,
			transcriptPersistTimer: null,
			cancelled: false,
			goal: null,
			agentEvents: [],
		};
		sessions.set(paneId, session);
		return session;
	},

	getSession(paneId: string): ChatSession | undefined {
		return sessions.get(paneId);
	},

	deleteSession(paneId: string) {
		sessions.delete(paneId);
	},

	values(): IterableIterator<ChatSession> {
		return sessions.values();
	},

	clear() {
		sessions.clear();
	},

	send(
		target: ServerWebSocket<any> | ChatSession,
		msg: ChatServerMessage,
		exclude?: ServerWebSocket<any>
	) {
		const json = JSON.stringify(msg);
		if ("clients" in target) {
			for (const ws of target.clients) {
				if (ws !== exclude && ws.readyState === 1) ws.send(json);
			}
		} else if (target.readyState === 1) {
			target.send(json);
		}
	},

	persistTranscript(session: ChatSession, paneId = session.paneId): void {
		if (session.transcriptPersistTimer) {
			clearTimeout(session.transcriptPersistTimer);
			session.transcriptPersistTimer = null;
		}
		writeChatTranscript(paneId, session.messageBuffer.getMessages()).catch(
			(error) => {
				console.error(
					"[ChatService] Failed to persist chat transcript:",
					error
				);
			}
		);
	},

	scheduleTranscriptPersist(
		session: ChatSession,
		paneId = session.paneId
	): void {
		if (session.transcriptPersistTimer) return;
		session.transcriptPersistTimer = setTimeout(() => {
			session.transcriptPersistTimer = null;
			this.persistTranscript(session, paneId);
		}, TRANSCRIPT_PERSIST_DEBOUNCE_MS);
	},

	clearCleanupTimer(session: ChatSession) {
		if (!session.cleanupTimer) return;
		clearTimeout(session.cleanupTimer);
		session.cleanupTimer = null;
	},

	scheduleCleanup(session: ChatSession) {
		this.clearCleanupTimer(session);
		if (session.currentHandle || session.clients.size > 0) return;
		session.cleanupTimer = setTimeout(() => {
			const current = sessions.get(session.paneId);
			if (!current || current.currentHandle || current.clients.size > 0) return;
			sessions.delete(session.paneId);
		}, DISCONNECTED_SESSION_TTL_MS);
	},

	updateSessionId(session: ChatSession, nextSessionId: string | null) {
		if (!nextSessionId || session.sessionId === nextSessionId) return;
		session.sessionId = nextSessionId;
		this.send(session, {
			type: "chat:session",
			paneId: session.paneId,
			sessionId: nextSessionId,
		});
	},

	finalizeTurn(session: ChatSession) {
		session.messageBuffer.finalize();
		this.persistTranscript(session);
		this.send(session, {
			type: "chat:sync",
			paneId: session.paneId,
			messages: session.messageBuffer.getMessages(),
			revision: session.messageBuffer.getRevision(),
			isStreaming: false,
		});
		this.send(session, { type: "chat:done", paneId: session.paneId });
		this.scheduleCleanup(session);
	},
};

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

type SendChatMessageInput = {
	agentKind?: ChatAgentKind;
	clientSessionId?: string | null;
	cwd?: string;
	model?: string;
	paneId: string;
	reasoningLevel?: string;
	referencePaths?: string[];
	displayText?: string;
	images?: string[];
	text: string;
	ws?: ServerWebSocket<any>;
};

type EmitChatMessage = (message: ChatServerMessage) => void;

export interface ChatReconnectSnapshot {
	queue: ChatServerMessage;
	status: ChatServerMessage;
	sync: ChatServerMessage;
}

let chatQueueIdCounter = 0;

// Request normalization, checkpoints, agent execution, and queue draining.
function isQueuedMessageInfo(value: unknown): value is QueuedMessageInfo {
	if (!value || typeof value !== "object") return false;
	const candidate = value as {
		id?: unknown;
		text?: unknown;
		displayText?: unknown;
		images?: unknown;
	};
	return (
		typeof candidate.id === "string" &&
		typeof candidate.text === "string" &&
		typeof candidate.displayText === "string" &&
		(candidate.images === undefined ||
			(Array.isArray(candidate.images) &&
				candidate.images.every((image) => typeof image === "string")))
	);
}

function nextChatQueueId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${++chatQueueIdCounter}`;
}

function normalizeChatReferencePaths(paths?: string[]): string[] {
	if (!Array.isArray(paths)) return [];
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const path of paths) {
		if (typeof path !== "string") continue;
		const trimmed = path.trim();
		if (!trimmed) continue;
		const resolved = resolveAllowedLocalPath(trimmed);
		if (!resolved || seen.has(resolved)) continue;
		seen.add(resolved);
		normalized.push(resolved);
	}
	return normalized;
}

function normalizeChatImagePaths(paths?: string[]): string[] {
	if (!Array.isArray(paths)) return [];
	return Array.from(
		new Set(
			paths.flatMap((path) => {
				if (typeof path !== "string") return [];
				const resolved = resolveAllowedLocalPath(path.trim());
				return resolved ? [resolved] : [];
			})
		)
	);
}

function normalizeChatCwd(cwd?: string): string {
	return (cwd ? resolveAllowedLocalPath(cwd) : null) ?? process.cwd();
}

async function createChatCheckpoint(
	paneId: string,
	cwd: string,
	text: string,
	emit: EmitChatMessage
): Promise<string | null> {
	try {
		const checkpointId = await CheckpointService.createCheckpoint(
			paneId,
			cwd,
			text
		);
		emit({ type: "checkpoint:created", paneId, checkpointId });
		appendChatEvent(paneId, "checkpoint_created", { checkpointId });
		return checkpointId;
	} catch (error) {
		console.error("[Checkpoint] Failed to create:", error);
		appendChatEvent(paneId, "checkpoint_failed", {
			stage: "create",
			message: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

async function finalizeChatCheckpoint(
	session: ChatSession,
	paneId: string,
	checkpointId: string | null,
	emit: EmitChatMessage
): Promise<number> {
	if (!checkpointId) {
		appendChatEvent(paneId, "checkpoint_skipped", { reason: "not_created" });
		return 0;
	}
	try {
		const messages = session.messageBuffer.getMessages();
		const lastUserIndex = messages.findLastIndex(
			(message) => message.role === "user"
		);
		const editedPaths: string[] = [];
		for (const message of messages.slice(lastUserIndex + 1)) {
			if (
				message.role !== "tool" ||
				!["edit", "write", "multiedit", "patch", "apply_patch"].includes(
					message.toolName?.toLowerCase() ?? ""
				)
			)
				continue;
			try {
				JSON.parse(message.content, (key, value: unknown) => {
					if (
						["path", "file", "file_path"].includes(key) &&
						typeof value === "string"
					)
						editedPaths.push(value);
					else if (["files", "changes"].includes(key) && Array.isArray(value))
						editedPaths.push(
							...value.filter((item) => typeof item === "string")
						);
					return value;
				});
			} catch {}
		}
		const cpMeta = await CheckpointService.finalizeCheckpoint(
			checkpointId,
			editedPaths
		);
		if (!cpMeta) {
			appendChatEvent(paneId, "checkpoint_skipped", {
				checkpointId,
				reason: "missing_metadata",
			});
			return 0;
		}
		if (cpMeta.changedFileCount === 0) {
			appendChatEvent(paneId, "checkpoint_unchanged", { checkpointId });
			return 0;
		}
		emit({
			type: "checkpoint:finalized",
			paneId,
			checkpointId,
			changedFileCount: cpMeta.changedFileCount,
			changedFiles: cpMeta.changedFiles,
		});
		appendChatEvent(paneId, "checkpoint_finalized", {
			checkpointId,
			changedFileCount: cpMeta.changedFileCount,
			changedFiles: cpMeta.changedFiles,
		});
		const existingEditPaths = new Set<string>();
		for (const message of session.messageBuffer.getMessages()) {
			if (message.role !== "tool" || message.toolName !== "Edit") continue;
			try {
				const parsed = JSON.parse(message.content) as { file_path?: unknown };
				if (typeof parsed.file_path === "string") {
					existingEditPaths.add(parsed.file_path);
				}
			} catch {}
		}
		for (const diff of await CheckpointService.getInlineDiffs(checkpointId)) {
			if (existingEditPaths.has(diff.path)) continue;
			const startEvent = {
				type: "content_block_start" as const,
				content_block: {
					type: "tool_use" as const,
					name: "Edit",
					input: {
						file_path: diff.path,
						old_string: diff.oldString,
						new_string: diff.newString,
					},
				},
			};
			const stopEvent = { type: "content_block_stop" as const };
			session.messageBuffer.applyEvent(startEvent);
			appendChatEvent(paneId, "agent_event", startEvent);
			emit({ type: "chat:event", paneId, event: startEvent });
			session.messageBuffer.applyEvent(stopEvent);
			appendChatEvent(paneId, "agent_event", stopEvent);
			emit({ type: "chat:event", paneId, event: stopEvent });
		}
		return cpMeta.changedFileCount;
	} catch (error) {
		console.error("[Checkpoint] Failed to finalize:", error);
		appendChatEvent(paneId, "checkpoint_failed", {
			checkpointId,
			stage: "finalize",
			message: error instanceof Error ? error.message : String(error),
		});
		return 0;
	}
}

function ensureVisibleTurnCompletion(
	session: ChatSession,
	paneId: string,
	changedFileCount: number,
	emit: EmitChatMessage
) {
	const messages = session.messageBuffer.getMessages();
	const last = messages[messages.length - 1];
	if (last?.role === "assistant" && last.content.trim()) return;
	if (changedFileCount <= 0 && last?.role !== "tool") return;
	const text =
		changedFileCount > 0
			? `Updated ${changedFileCount} file${changedFileCount === 1 ? "" : "s"}, but Codex did not provide a final summary.`
			: "The tool run completed, but Codex did not provide a final summary.";
	const event = { type: "result" as const, result: text };
	session.messageBuffer.applyEvent(event);
	appendChatEvent(paneId, "agent_event", event);
	emit({ type: "chat:event", paneId, event });
}

async function runBtwChatMessage(
	paneId: string,
	text: string,
	cwd: string | undefined,
	emit: EmitChatMessage
) {
	const effectiveCwd = normalizeChatCwd(cwd);
	const claudeCmd = resolveAgentBinary("claude");
	let fullText = "";

	emit({ type: "chat:btw:start", paneId, question: text });

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

		const handleBtwEvent = (event: unknown) => {
			if (!isChatStreamEvent(event)) return;
			if (
				event.type === "content_block_delta" &&
				event.delta?.type === "text_delta" &&
				typeof event.delta.text === "string"
			) {
				fullText += event.delta.text;
				emit({ type: "chat:btw:delta", paneId, text: event.delta.text });
			} else if (
				event.type === "content_block_start" &&
				event.content_block?.type === "text" &&
				typeof event.content_block.text === "string" &&
				event.content_block.text
			) {
				fullText += event.content_block.text;
				emit({
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
		if (!fullText && stderrText) fullText = stderrText;
	} catch (err) {
		if (!fullText) fullText = err instanceof Error ? err.message : "(error)";
	}

	emit({
		type: "chat:btw:done",
		paneId,
		answer: fullText || "(no response)",
	});
}

async function runAgent(
	session: ChatSession,
	paneId: string,
	text: string,
	emitDone = true,
	images?: readonly string[]
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
		images,
		model: session.model,
		reasoningLevel: session.reasoningLevel,
		getSessionId: () => session.sessionId,
		isCancelled: () => session.cancelled,
		updateSessionId: (nextSessionId) =>
			chatRuntime.updateSessionId(session, nextSessionId),
		emitChatEvent: (event) => {
			appendChatEvent(paneId, "agent_event", event);
			chatRuntime.send(session, { type: "chat:event", paneId, event });
			session.messageBuffer.applyEvent(event);
			chatRuntime.scheduleTranscriptPersist(session, paneId);
		},
		emitAgentEvent: (event) => {
			session.agentEvents.push(event);
			if (session.agentEvents.length > 500) {
				session.agentEvents = session.agentEvents.slice(-500);
			}
			chatRuntime.send(session, {
				type: "chat:agent-event",
				paneId,
				event,
			});
		},
		emitStatus: (status, isLoading = true) =>
			sendChatStatus(session, paneId, status, isLoading),
		emitActivity: (activity) =>
			chatRuntime.send(session, {
				type: "chat:activity",
				paneId,
				activity,
			}),
		emitSystemMessage: (message) => {
			emitSystemMessage(session, paneId, message);
			chatRuntime.persistTranscript(session, paneId);
		},
	};
	const state = adapter.createState(ctx);
	const handle = adapter.createHandle(prompt, ctx, state);
	session.currentHandle = handle;

	try {
		return await handle.run();
	} finally {
		session.currentHandle = null;
		if (emitDone) chatRuntime.finalizeTurn(session);
	}
}

function getLastAssistantMessage(result: Awaited<ReturnType<typeof runAgent>>) {
	return result && typeof result === "object"
		? result.lastAssistantMessage
		: undefined;
}

async function runAgentTurnWithGoalLoop(
	session: ChatSession,
	paneId: string,
	prompt: string,
	images?: readonly string[]
): Promise<void> {
	const isGoalRun = session.goal?.status === "active";
	let result = await runAgent(session, paneId, prompt, false, images);
	const lastMessage = session.messageBuffer.getMessages().at(-1);
	if (!isGoalRun && !session.cancelled && lastMessage?.role === "tool") {
		result = await runAgent(
			session,
			paneId,
			FINAL_SUMMARY_RECOVERY_PROMPT,
			false
		);
	}
	if (isGoalRun && session.goal?.status === "active") {
		session.goal.turns += 1;
		let resultStatus = goalResultStatus(getLastAssistantMessage(result));
		while (
			!session.cancelled &&
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
			const message: GoalSystemMessage = {
				type: "inferay.goal",
				status: "complete",
				objective: session.goal.objective,
				turns: session.goal.turns,
				detail: "Goal achieved",
			};
			session.goal = null;
			emitGoalSystemMessage(session, paneId, message);
		} else if (session.goal && resultStatus === "paused") {
			session.messageBuffer.replaceInAssistantMessages(stripGoalMarkers);
			session.goal.status = "paused";
			emitGoalSystemMessage(session, paneId, {
				type: "inferay.goal",
				status: "paused",
				objective: session.goal.objective,
				turns: session.goal.turns,
				detail:
					"Codex needs input. Reply with the missing detail or use /goal resume.",
			});
		} else if (session.goal && session.goal.turns >= GOAL_MAX_TURNS) {
			session.goal.status = "paused";
			emitGoalSystemMessage(session, paneId, {
				type: "inferay.goal",
				status: "paused",
				objective: session.goal.objective,
				turns: session.goal.turns,
				detail: `Paused after ${GOAL_MAX_TURNS} turns`,
			});
		}
	}
}

function emitSystemMessage(
	session: ChatSession,
	paneId: string,
	message: string
) {
	session.messageBuffer.pushSystem(message);
	appendChatEvent(paneId, "system_message", { message });
	chatRuntime.send(session, { type: "chat:system", paneId, message });
}

function emitGoalSystemMessage(
	session: ChatSession,
	paneId: string,
	message: GoalSystemMessage
) {
	emitSystemMessage(session, paneId, serializeGoalSystemMessage(message));
}

function sendChatStatus(
	target: ServerWebSocket<any> | ChatSession,
	paneId: string,
	status: string,
	isLoading: boolean
) {
	chatRuntime.send(target, { type: "chat:status", paneId, status, isLoading });
}

export function shouldAppendGenerationStoppedMessage(
	messages: Pick<ChatTranscriptMessage, "content" | "role">[]
): boolean {
	const last = messages[messages.length - 1];
	return !(
		last?.role === "system" &&
		last.content.trim() === GENERATION_STOPPED_MESSAGE
	);
}

function emitGenerationStoppedMessage(session: ChatSession, paneId: string) {
	if (
		!shouldAppendGenerationStoppedMessage(session.messageBuffer.getMessages())
	)
		return;
	emitSystemMessage(session, paneId, GENERATION_STOPPED_MESSAGE);
}

async function createChatReconnectSnapshot(
	paneId: string,
	session?: ChatSession
): Promise<ChatReconnectSnapshot> {
	const queue = (await loadChatQueue(paneId)).filter(isQueuedMessageInfo);
	if (!session) {
		const transcript = await readAuthoritativeTranscript(paneId);
		return {
			sync: {
				type: "chat:sync",
				paneId,
				messages: transcript ?? [],
				revision: 0,
				isStreaming: false,
			},
			queue: { type: "chat:queue", paneId, queue },
			status: {
				type: "chat:status",
				paneId,
				status: "idle",
				isLoading: false,
			},
		};
	}

	const isStreaming = session.messageBuffer.streaming;
	return {
		sync: {
			type: "chat:sync",
			paneId,
			messages: session.messageBuffer.getMessages(),
			revision: session.messageBuffer.getRevision(),
			isStreaming,
		},
		queue: { type: "chat:queue", paneId, queue },
		status: {
			type: "chat:status",
			paneId,
			status: session.currentHandle
				? isStreaming
					? "responding"
					: "thinking"
				: "idle",
			isLoading: !!session.currentHandle,
		},
	};
}

export async function readPersistedChatReconnectSnapshot(
	paneId: string
): Promise<ChatReconnectSnapshot> {
	return createChatReconnectSnapshot(paneId);
}

async function saveAndBroadcastQueue(
	session: ChatSession,
	paneId: string,
	queue: QueuedMessageInfo[]
) {
	if (queue.length === 0) await deleteChatQueue(paneId);
	else await saveChatQueue(paneId, queue);
	appendChatEvent(paneId, "queue_persisted", {
		source: "runtime",
		...queueEventPayload(queue),
	});
	appendChatEvent(paneId, "queue_changed", { queue });
	chatRuntime.send(session, { type: "chat:queue", paneId, queue });
}

async function enqueueChatMessage(
	session: ChatSession,
	paneId: string,
	text: string,
	displayText?: string,
	images?: string[]
) {
	const queue = (await loadChatQueue(paneId)).filter(isQueuedMessageInfo);
	await saveAndBroadcastQueue(session, paneId, [
		...queue,
		{
			id: nextChatQueueId(),
			text,
			displayText: displayText || text,
			images: images?.length ? images : undefined,
		},
	]);
}

export function createQueuedDrainSendInput(
	session: Pick<
		ChatSession,
		| "agentKind"
		| "cwd"
		| "model"
		| "reasoningLevel"
		| "referencePaths"
		| "sessionId"
	>,
	paneId: string,
	message: QueuedMessageInfo
): SendChatMessageInput {
	return {
		agentKind: session.agentKind,
		clientSessionId: session.sessionId,
		cwd: session.cwd,
		model: session.model,
		paneId,
		reasoningLevel: session.reasoningLevel,
		referencePaths: session.referencePaths,
		displayText: message.displayText,
		images: message.images,
		text: message.text,
	};
}

async function drainNextQueuedMessage(session: ChatSession, paneId: string) {
	if (session.currentHandle) return;
	const queue = (await loadChatQueue(paneId)).filter(isQueuedMessageInfo);
	const [next, ...rest] = queue;
	if (!next) return;
	await saveAndBroadcastQueue(session, paneId, rest);
	appendChatEvent(paneId, "queue_drained", {
		messageId: next.id,
		remainingCount: rest.length,
	});
	void ChatService.sendMessage(
		createQueuedDrainSendInput(session, paneId, next)
	);
}

function createSystemPrefix(
	session: ChatSession,
	includeWorkspace: boolean,
	includePriorContext: boolean
) {
	const workspace =
		includeWorkspace && !session.sessionId
			? `<workspace-context>\n${[
					"You are working in a multi-directory workspace.",
					session.cwd
						? `Primary working directory (use this as the execution root unless the user says otherwise): ${session.cwd}`
						: null,
					session.referencePaths.length
						? `Additional reference directories available in this workspace:\n${session.referencePaths.map((path) => `- ${path}`).join("\n")}`
						: null,
					session.referencePaths.length
						? "The additional directories are supporting context. Read and reference them when relevant, but treat the primary working directory as the default root."
						: null,
				]
					.filter(Boolean)
					.join("\n\n")}\n</workspace-context>`
			: "";
	const contextLines = includePriorContext
		? session.messageBuffer
				.getMessages()
				.slice(-20)
				.flatMap((message) =>
					message.role === "user"
						? [`User: ${message.content.slice(0, 500)}`]
						: message.role === "assistant" && message.content
							? [`Assistant: ${message.content.slice(0, 500)}`]
							: []
				)
		: [];
	const prior = contextLines.length
		? `<prior-conversation-context>\nThe following is a summary of the prior conversation in this chat session (from a different model). Use it as context for the request below.\n\n${contextLines.join("\n\n")}\n</prior-conversation-context>`
		: "";
	return [workspace, prior].filter(Boolean).join("\n\n");
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
		emitGoalSystemMessage(session, paneId, {
			type: "inferay.goal",
			status: "active",
			objective: command.objective,
			turns: 0,
			detail: "Goal started",
		});
		return createGoalPrompt(command.objective);
	}

	if (command.action === "pause") {
		if (session.goal) session.goal.status = "paused";
		emitGoalSystemMessage(
			session,
			paneId,
			session.goal
				? {
						type: "inferay.goal",
						status: "paused",
						objective: session.goal.objective,
						turns: session.goal.turns,
						detail: "Goal paused",
					}
				: {
						type: "inferay.goal",
						status: "empty",
						detail: "No active goal",
					}
		);
		return null;
	}

	if (command.action === "resume") {
		if (!session.goal) {
			emitGoalSystemMessage(session, paneId, {
				type: "inferay.goal",
				status: "empty",
				detail: "No goal to resume",
			});
			return null;
		}
		session.goal.status = "active";
		emitGoalSystemMessage(session, paneId, {
			type: "inferay.goal",
			status: "active",
			objective: session.goal.objective,
			turns: session.goal.turns,
			detail: "Goal resumed",
		});
		return createGoalContinuationPrompt(session.goal);
	}

	if (command.action === "clear") {
		const previousGoal = session.goal;
		session.goal = null;
		emitGoalSystemMessage(session, paneId, {
			type: "inferay.goal",
			status: "cleared",
			objective: previousGoal?.objective,
			turns: previousGoal?.turns,
			detail: "Goal cleared",
		});
		return null;
	}

	emitGoalSystemMessage(
		session,
		paneId,
		session.goal
			? {
					type: "inferay.goal",
					status: session.goal.status,
					objective: session.goal.objective,
					turns: session.goal.turns,
				}
			: {
					type: "inferay.goal",
					status: "empty",
					detail: "No active goal",
				}
	);
	return null;
}

async function finalizeSuccessfulChatTurn(
	session: ChatSession,
	paneId: string,
	checkpointId: string | null,
	emit: EmitChatMessage
): Promise<void> {
	const changedFileCount = await finalizeChatCheckpoint(
		session,
		paneId,
		checkpointId,
		emit
	);
	ensureVisibleTurnCompletion(session, paneId, changedFileCount, emit);
	chatRuntime.finalizeTurn(session);
	await drainNextQueuedMessage(session, paneId);
}

async function finalizeFailedChatTurn(
	session: ChatSession,
	paneId: string,
	checkpointId: string | null,
	emit: EmitChatMessage,
	error: unknown
): Promise<void> {
	session.currentHandle = null;
	const errMsg =
		error instanceof Error
			? error.message
			: `Failed to run ${session.agentKind}`;
	emitSystemMessage(session, paneId, errMsg);
	session.messageBuffer.finalize();
	chatRuntime.persistTranscript(session, paneId);
	chatRuntime.send(session, {
		type: "chat:error",
		paneId,
		error: errMsg,
	});
	await finalizeChatCheckpoint(session, paneId, checkpointId, emit);
	chatRuntime.scheduleCleanup(session);
	await drainNextQueuedMessage(session, paneId);
}

// Public chat API used by websocket routes and HTTP route wrappers.
export const ChatService = {
	async sendMessage({
		agentKind = "claude",
		clientSessionId,
		cwd,
		model,
		paneId,
		reasoningLevel,
		referencePaths,
		displayText,
		images,
		text,
		ws,
	}: SendChatMessageInput) {
		const nextReferencePaths = normalizeChatReferencePaths(referencePaths);
		const nextImages = normalizeChatImagePaths(images);
		const nextCwd = normalizeChatCwd(cwd);
		const existingSession = chatRuntime.getSession(paneId);
		const session = await chatRuntime.ensureSession(
			paneId,
			ws ?? Array.from(existingSession?.clients ?? [])[0],
			agentKind,
			nextCwd,
			nextReferencePaths,
			clientSessionId || null,
			model,
			reasoningLevel
		);
		session.referencePaths ??= [];
		const agentKindChanged = session.agentKind !== agentKind;
		if (agentKindChanged) {
			session.sessionId = null; // clear when switching agent kinds
		}
		session.agentKind = agentKind;
		session.model = resolveAgentModel(agentKind, model);
		if (reasoningLevel !== undefined) session.reasoningLevel = reasoningLevel;
		if (ws) session.clients.add(ws);
		if (cwd) session.cwd = nextCwd;
		if (referencePaths) session.referencePaths = nextReferencePaths;
		if (!session.sessionId && clientSessionId)
			chatRuntime.updateSessionId(session, clientSessionId);
		const systemPrefix = createSystemPrefix(
			session,
			!!cwd || nextReferencePaths.length > 0,
			agentKindChanged
		);

		if (session.currentHandle) {
			await enqueueChatMessage(session, paneId, text, displayText, nextImages);
			return;
		}

		session.messageBuffer.pushUser(
			displayText || text,
			nextImages.length ? nextImages : undefined
		);
		appendChatEvent(paneId, "user_message", {
			text,
			displayText: displayText || text,
			images: nextImages.length ? nextImages : undefined,
		});
		chatRuntime.persistTranscript(session, paneId);
		chatRuntime.send(
			session,
			{
				type: "chat:user_message",
				paneId,
				text,
			},
			ws
		);
		session.cancelled = false;

		const goalCommand = agentKind === "codex" ? parseGoalCommand(text) : null;
		let prompt = text;
		if (goalCommand) {
			const goalPrompt = await handleGoalCommand(session, paneId, goalCommand);
			if (!goalPrompt) {
				chatRuntime.finalizeTurn(session);
				return;
			}
			prompt = goalPrompt;
		}
		if (systemPrefix) {
			prompt = `${systemPrefix}\n\n${prompt}`;
		}

		const emit = chatRuntime.send.bind(chatRuntime, session);
		const checkpointId = await createChatCheckpoint(
			paneId,
			session.cwd,
			text,
			emit
		);

		try {
			await runAgentTurnWithGoalLoop(session, paneId, prompt, nextImages);
			await finalizeSuccessfulChatTurn(session, paneId, checkpointId, emit);
		} catch (e) {
			await finalizeFailedChatTurn(session, paneId, checkpointId, emit, e);
		}
	},

	async sendBtwMessage(
		paneId: string,
		text: string,
		ws: ServerWebSocket<any>,
		cwd?: string
	) {
		await runBtwChatMessage(paneId, text, cwd, (message) =>
			chatRuntime.send(ws, message)
		);
	},

	stopGeneration(paneId: string) {
		const session = chatRuntime.getSession(paneId);
		if (session) {
			session.cancelled = true;
			session.goal = null;
		}
		if (session?.currentHandle) {
			try {
				session.currentHandle.stop();
			} catch {}
		}
		if (session) {
			session.currentHandle = null;
			emitGenerationStoppedMessage(session, paneId);
			chatRuntime.finalizeTurn(session);
			sendChatStatus(session, paneId, "idle", false);
		}
	},

	destroySession(paneId: string) {
		const session = chatRuntime.getSession(paneId);
		if (session) {
			session.cancelled = true;
			session.goal = null;
		}
		if (session?.currentHandle) {
			try {
				session.currentHandle.kill();
			} catch {}
		}
		if (session) {
			chatRuntime.clearCleanupTimer(session);
			chatRuntime.persistTranscript(session, paneId);
		}
		chatRuntime.deleteSession(paneId);
	},

	cleanupWs(ws: ServerWebSocket<any>) {
		for (const session of chatRuntime.values()) {
			session.clients.delete(ws);
			chatRuntime.scheduleCleanup(session);
		}
	},

	async reassignWs(paneId: string, ws: ServerWebSocket<any>) {
		const session = chatRuntime.getSession(paneId);
		if (!session) {
			const snapshot = await createChatReconnectSnapshot(paneId);
			chatRuntime.send(ws, snapshot.sync);
			chatRuntime.send(ws, snapshot.queue);
			chatRuntime.send(ws, snapshot.status);
			return;
		}
		chatRuntime.clearCleanupTimer(session);
		session.clients.add(ws);
		if (session.sessionId)
			chatRuntime.send(ws, {
				type: "chat:session",
				paneId,
				sessionId: session.sessionId,
			});
		const snapshot = await createChatReconnectSnapshot(paneId, session);
		chatRuntime.send(ws, snapshot.sync);
		chatRuntime.send(ws, snapshot.queue);
		chatRuntime.send(ws, snapshot.status);
	},

	listSessions(): AgentSessionInfo[] {
		return Array.from(chatRuntime.values()).flatMap((s) =>
			s.currentHandle || s.clients.size > 0
				? [
						{
							paneId: s.paneId,
							agentKind: s.agentKind,
							cwd: s.cwd,
							referencePaths: s.referencePaths,
							sessionId: s.sessionId,
							isRunning: !!s.currentHandle,
							clientCount: s.clients.size,
							messageCount: s.messageBuffer.getMessages().length,
						},
					]
				: []
		);
	},

	async readEvents(
		paneId: string,
		afterSequence = 0,
		limit = 500
	): Promise<ChatEventLogEntry[]> {
		return readChatEvents(paneId, afterSequence, limit);
	},

	async readRestoredMessages(paneId: string): Promise<ChatTranscriptMessage[]> {
		return (await readAuthoritativeTranscript(paneId)) ?? [];
	},

	async listPersistedEventPaneIds(): Promise<string[]> {
		return listEventLogPaneIds();
	},

	async readQueue(paneId: string): Promise<unknown[]> {
		return loadChatQueue(paneId);
	},

	async saveQueue(paneId: string, queue: unknown[]): Promise<void> {
		await saveChatQueue(paneId, queue);
		appendChatEvent(paneId, "queue_persisted", {
			source: "api",
			...queueEventPayload(queue),
		});
	},

	async deleteQueue(paneId: string): Promise<void> {
		await deleteChatQueue(paneId);
		appendChatEvent(paneId, "queue_persisted", {
			source: "api",
			count: 0,
			messageIds: [],
		});
	},

	listGoals() {
		const now = Date.now();
		return Array.from(chatRuntime.values()).flatMap((session) => {
			if (!session.goal) return [];
			const view = deriveGoalView(session);
			return [
				{
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
				},
			];
		});
	},

	destroyAll() {
		for (const session of chatRuntime.values()) {
			session.cancelled = true;
			session.goal = null;
			if (session.currentHandle) {
				try {
					session.currentHandle.kill();
				} catch {}
			}
			chatRuntime.clearCleanupTimer(session);
		}
		chatRuntime.clear();
	},
};
