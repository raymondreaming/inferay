import { basename } from "../../lib/format.ts";
import { readStoredJson, writeStoredJson } from "../../lib/stored-json.ts";
import {
	type ChatAgentKind,
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../agents/agents.ts";
import type { ChatMessage } from "../chat/agent-chat-shared.ts";
import type { StoredChatSession } from "../chat/chat-session-store.ts";
import type { QuickActionDraft } from "../quick-actions/types.ts";
import type {
	PromotedTask,
	TaskBoardCard,
	TaskBoardGoalSignal,
	TaskBoardInput,
	TaskBoardStatus,
} from "./types.ts";

const TASK_STATUS_OVERRIDES_KEY = "inferay-task-board-status-overrides";
const PROMOTED_TASKS_KEY = "inferay-promoted-task-board-cards";

export const TASK_BOARD_COLUMNS: readonly {
	readonly id: TaskBoardStatus;
	readonly label: string;
}[] = [
	{ id: "backlog", label: "Backlog" },
	{ id: "planning", label: "Planning" },
	{ id: "running", label: "Running" },
	{ id: "review", label: "Review" },
	{ id: "done", label: "Done" },
];

function isTaskBoardStatus(value: unknown): value is TaskBoardStatus {
	return (
		value === "backlog" ||
		value === "planning" ||
		value === "running" ||
		value === "review" ||
		value === "done"
	);
}

function notifyTaskBoardChanged() {
	try {
		window.dispatchEvent(new Event("inferay-task-board-change"));
	} catch {}
}

export function loadTaskStatusOverrides(): Record<string, TaskBoardStatus> {
	const parsed = readStoredJson<unknown>(TASK_STATUS_OVERRIDES_KEY, {});
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const entries = Object.entries(parsed).filter((entry) =>
		isTaskBoardStatus(entry[1])
	) as [string, TaskBoardStatus][];
	return Object.fromEntries(entries);
}

function saveTaskStatusOverrides(overrides: Record<string, TaskBoardStatus>) {
	writeStoredJson(TASK_STATUS_OVERRIDES_KEY, overrides);
	notifyTaskBoardChanged();
}

export function setTaskStatusOverride(id: string, status: TaskBoardStatus) {
	saveTaskStatusOverrides({ ...loadTaskStatusOverrides(), [id]: status });
}

export function clearTaskStatusOverride(id: string) {
	const overrides = loadTaskStatusOverrides();
	if (!(id in overrides)) return;
	const { [id]: _removed, ...next } = overrides;
	saveTaskStatusOverrides(next);
}

function compactLine(value: string, max = 96): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function normalizePromotedTask(value: unknown): PromotedTask | null {
	if (!value || typeof value !== "object") return null;
	const task = value as Partial<PromotedTask>;
	if (
		typeof task.id !== "string" ||
		typeof task.paneId !== "string" ||
		typeof task.messageId !== "string" ||
		typeof task.content !== "string"
	) {
		return null;
	}
	return {
		id: task.id,
		paneId: task.paneId,
		messageId: task.messageId,
		messageRole: task.messageRole ?? "message",
		agentKind: task.agentKind ?? "agent",
		cwd: task.cwd ?? null,
		title: task.title ?? compactLine(task.content),
		content: task.content,
		status: isTaskBoardStatus(task.status) ? task.status : "backlog",
		createdAt: typeof task.createdAt === "number" ? task.createdAt : 0,
		updatedAt: typeof task.updatedAt === "number" ? task.updatedAt : 0,
	};
}

export function loadPromotedTasks(): PromotedTask[] {
	const parsed = readStoredJson<unknown>(PROMOTED_TASKS_KEY, []);
	if (!Array.isArray(parsed)) return [];
	return parsed
		.map(normalizePromotedTask)
		.filter((task): task is PromotedTask => Boolean(task))
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

function savePromotedTasks(tasks: PromotedTask[]) {
	writeStoredJson(PROMOTED_TASKS_KEY, tasks);
	notifyTaskBoardChanged();
}

export function removePromotedTask(id: string) {
	savePromotedTasks(loadPromotedTasks().filter((task) => task.id !== id));
}

export function promoteChatMessageToTask(input: {
	paneId: string;
	message: Pick<ChatMessage, "id" | "role" | "content" | "intent">;
	agentKind: string;
	cwd?: string | null;
}): PromotedTask {
	const now = Date.now();
	const title =
		input.message.intent === "fix"
			? `Fix: ${compactLine(input.message.content)}`
			: input.message.intent === "test"
				? `Test: ${compactLine(input.message.content)}`
				: compactLine(input.message.content);
	const task: PromotedTask = {
		id: `promoted:${input.paneId}:${input.message.id}`,
		paneId: input.paneId,
		messageId: input.message.id,
		messageRole: input.message.role,
		agentKind: input.agentKind,
		cwd: input.cwd ?? null,
		title,
		content: input.message.content,
		status: input.message.intent === "plan" ? "planning" : "backlog",
		createdAt: now,
		updatedAt: now,
	};
	const tasks = loadPromotedTasks();
	savePromotedTasks([task, ...tasks.filter((item) => item.id !== task.id)]);
	return task;
}

function promotedTaskCard(task: PromotedTask): TaskBoardCard {
	const cwdName = task.cwd
		? basename(task.cwd.replace(/\/+$/, "")) || task.cwd
		: "No workspace";
	return {
		id: task.id,
		source: "promoted",
		status: task.status,
		title: task.title,
		subtitle: cwdName,
		paneId: task.paneId,
		agentKind: task.agentKind,
		cwd: task.cwd,
		updatedAt: task.updatedAt,
		messageCount: 1,
		promotedTask: task,
		signals: [task.messageRole, task.messageId],
	};
}

function textIncludesAny(text: string, words: readonly string[]): boolean {
	const lower = text.toLowerCase();
	return words.some((word) => lower.includes(word));
}

function inferSessionStatus(messages: ChatMessage[]): TaskBoardStatus {
	const recent = messages.slice(-8);
	const recentText = recent.map((message) => message.content).join("\n");
	if (
		recent.some((message) => message.intent === "plan") ||
		textIncludesAny(recentText, ["plan:", "next step", "approach"])
	) {
		return "planning";
	}
	if (
		recent.some((message) =>
			message.contextBlocks?.some((block) => block.source === "diff")
		) ||
		textIncludesAny(recentText, ["review", "remaining", "todo", "follow-up"])
	) {
		return "review";
	}
	if (
		textIncludesAny(recentText, [
			"implemented",
			"completed",
			"done",
			"fixed",
			"added",
			"updated",
			"verified",
		])
	) {
		return "done";
	}
	return messages.length > 0 ? "review" : "backlog";
}

function goalCard(goal: TaskBoardGoalSignal): TaskBoardCard {
	return {
		id: `goal:${goal.paneId}`,
		source: "goal",
		status: goal.isRunning ? "running" : "planning",
		title: goal.objective,
		subtitle: basename(goal.cwd.replace(/\/+$/, "")) || goal.cwd,
		paneId: goal.paneId,
		agentKind: goal.agentKind,
		cwd: goal.cwd,
		updatedAt: goal.updatedAt ?? Date.now(),
		messageCount: 0,
		goal,
		signals: [
			...(goal.files ?? []).slice(0, 3),
			...(goal.checks ?? []).slice(0, 2),
		],
	};
}

function sessionCard(
	session: StoredChatSession,
	messages: ChatMessage[]
): TaskBoardCard {
	const cwdName = session.cwd
		? basename(session.cwd.replace(/\/+$/, "")) || session.cwd
		: "No workspace";
	return {
		id: `session:${session.paneId}`,
		source: "session",
		status: inferSessionStatus(messages),
		title: session.summary ?? session.lastMessage ?? "Retained session",
		subtitle: cwdName,
		paneId: session.paneId,
		agentKind: session.agentKind,
		cwd: session.cwd,
		updatedAt: session.updatedAt,
		messageCount: session.messageCount,
		session,
		signals: [
			session.model ?? session.agentKind,
			session.reasoningLevel ? `reasoning:${session.reasoningLevel}` : "",
		].filter(Boolean),
	};
}

export function buildTaskBoardCards({
	goals,
	sessions,
	messagesByPaneId,
	promotedTasks = loadPromotedTasks(),
	statusOverrides = {},
}: TaskBoardInput): TaskBoardCard[] {
	const activeGoalPaneIds = new Set(goals.map((goal) => goal.paneId));
	const cards = [
		...goals.map(goalCard),
		...promotedTasks.map(promotedTaskCard),
		...sessions
			.filter((session) => !activeGoalPaneIds.has(session.paneId))
			.map((session) =>
				sessionCard(session, messagesByPaneId.get(session.paneId) ?? [])
			),
	];
	return cards
		.map((card) => ({
			...card,
			status: statusOverrides[card.id] ?? card.status,
		}))
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function buildTaskAgentPrompt(
	task: TaskBoardCard,
	recentMessages: ChatMessage[] = []
): string {
	const source =
		task.source === "goal"
			? "active goal"
			: task.source === "promoted"
				? "promoted chat message"
				: "retained session";
	const contextLines = recentMessages
		.slice(-6)
		.map((message) => `${message.role}: ${compactLine(message.content, 240)}`);
	return [
		"Act as an Inferay task agent.",
		`Task source: ${source}`,
		`Task id: ${task.id}`,
		`Status: ${task.status}`,
		`Workspace: ${task.cwd ?? "not set"}`,
		"",
		"## Task",
		task.title,
		task.subtitle ? `Context: ${task.subtitle}` : null,
		"",
		task.signals.length > 0
			? ["## Signals", ...task.signals.map((signal) => `- ${signal}`)].join(
					"\n"
				)
			: null,
		task.promotedTask
			? ["## Promoted Message", task.promotedTask.content].join("\n")
			: null,
		task.goal
			? [
					"## Goal Context",
					task.goal.objective,
					task.goal.files?.length
						? `Files: ${task.goal.files.join(", ")}`
						: null,
					task.goal.checks?.length
						? `Checks: ${task.goal.checks.join(", ")}`
						: null,
				]
					.filter(Boolean)
					.join("\n")
			: null,
		contextLines.length > 0
			? ["## Recent Session Context", ...contextLines].join("\n")
			: null,
		"",
		"## Instructions",
		"- Confirm the current task state before editing.",
		"- Identify the smallest next step that moves this card forward.",
		"- Preserve unrelated user changes.",
		"- End with validation performed and remaining follow-ups.",
	]
		.filter((section): section is string => Boolean(section))
		.join("\n\n");
}

function taskChatAgentKind(task: TaskBoardCard): ChatAgentKind {
	return task.agentKind === "claude" || task.agentKind === "codex"
		? task.agentKind
		: loadDefaultChatSettings().agentKind;
}

function taskActionModel(
	task: TaskBoardCard,
	agentKind: ChatAgentKind
): string {
	const definition = getAgentDefinition(agentKind);
	const model = task.session?.model;
	return model && definition.models.some((option) => option.id === model)
		? model
		: definition.defaultModel;
}

export function buildTaskQuickActionDraft(
	task: TaskBoardCard,
	recentMessages: ChatMessage[] = []
): QuickActionDraft {
	const defaults = loadDefaultChatSettings();
	const agentKind = taskChatAgentKind(task);
	return {
		name: `Task: ${compactLine(task.title, 72)}`,
		description: `Reusable launch profile for ${task.source} task ${task.id}.`,
		agentKind,
		model: taskActionModel(task, agentKind),
		reasoningLevel:
			agentKind === "codex"
				? (task.session?.reasoningLevel ?? defaults.reasoningLevel)
				: undefined,
		cwd: task.cwd ?? "",
		prompt: buildTaskAgentPrompt(task, recentMessages),
		tags: [
			"task-action",
			`task:${task.id}`,
			`source:${task.source}`,
			`status:${task.status}`,
			...task.signals.slice(0, 4),
		].filter(Boolean),
		useWorktree: task.status === "running" || task.status === "review",
	};
}
