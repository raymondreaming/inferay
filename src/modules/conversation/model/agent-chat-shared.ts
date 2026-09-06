export type ChatMessage = RenderChatMessage;
type TokenRange = { start: number; end: number };
export function findDecoratedTokenRanges(
	text: string,
	slashCommandNames?: readonly string[],
): TokenRange[] {
	if (!text) return [];
	const ranges: TokenRange[] = [];
	const knownSlashCommands = slashCommandNames
		? new Set(slashCommandNames.map((name) => name.toLowerCase()))
		: null;
	for (const match of text.matchAll(/(^|\s)(\/[a-zA-Z][\w-]*|@[^\s]+)/g)) {
		const token = match[2]!;
		if (
			token.startsWith("/") &&
			!knownSlashCommands?.has(token.slice(1).toLowerCase())
		)
			continue;
		const start = match.index + match[1]!.length;
		ranges.push({ start, end: start + token.length });
	}
	return ranges;
}

import type {
	SkillProposal,
	SkillRead,
} from "../../skills/model/skill-library.ts";
export interface QueuedMessageInfo {
	id: string;
	text: string;
	displayText: string;
	images?: string[];
	transient?: boolean;
}
export interface AttachedImageInfo {
	name: string;
	path: string;
	previewUrl: string;
}
type ChatMessagePart =
	| { type: "text"; content: string }
	| { type: "thinking"; content: string }
	| {
			type: "tool";
			id: string;
			name: string;
			input?: unknown;
			output?: unknown;
			error?: string;
	  };
interface NativeToolDisplay {
	label: string;
	detail?: string;
}
interface NativeToolSummary {
	type: string;
	value: string;
	fileName?: string;
}
export interface AskUserQuestion {
	question: string;
	header?: string;
	options?: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
}
export type CommandSystemMessage = {
	type: "inferay.command";
	name: string;
	description?: string;
	args?: string;
};
type GoalSystemStatus = "active" | "paused" | "complete" | "cleared" | "empty";
export type GoalSystemMessage = {
	type: "inferay.goal";
	status: GoalSystemStatus;
	objective?: string;
	turns?: number;
	detail?: string;
};
export interface NativeChatRender {
	version: 1;
	kind: "message" | "edit-group" | "tool-group";
	groupId: string;
	hidden: boolean;
	filePath?: string;
	edit?: { file_path: string; old_string: string; new_string: string };
	trailingOutput?: string;
	display?: NativeToolDisplay;
	summary?: NativeToolSummary | null;
	questions?: AskUserQuestion[] | null;
	command?: CommandSystemMessage;
	goal?: GoalSystemMessage;
	skillProposal?: SkillProposal;
	skillRead?: SkillRead;
	skillParts?: Array<
		| { start: number; end: number }
		| { proposal: SkillProposal; index: number }
		| { pending: true }
	>;
}
interface ChatTranscriptUpdate {
	version: 1;
	epoch?: string;
	baseRevision: number;
	revision: number;
	reset: boolean;
	start: number;
	deleteCount: number;
	messages: Array<{
		message: Omit<AgentChatSharedChatMessage, "content"> & { content?: string };
		appendContent?: string;
	}>;
}
export interface AgentChatSharedChatMessage {
	id: string;
	role: "user" | "assistant" | "tool" | "system" | "btw";
	content: string;
	toolName?: string;
	render?: NativeChatRender;
	/** Browser-only pending send; removed when native acknowledges this ID. */
	optimistic?: boolean;
	/** UI interaction notice absent from the authoritative transcript. */
	localOnly?: boolean;
	parts?: ChatMessagePart[];
	isStreaming?: boolean;
	btwQuestion?: string;
	images?: string[];
}
export interface CheckpointInfo {
	id: string;
	timestamp: number;
	changedFileCount: number;
	changedFiles: { path: string; action: "created" | "modified" | "deleted" }[];
	reverted: boolean;
	afterMessageId: string | null;
}
export type ChatLoadingState = {
	isLoading: boolean;
	status: string;
	startTime: number | null;
};
export interface SlashCommand {
	id?: string;
	name: string;
	description: string;
	action: "local" | "send";
	isLocalCommand?: boolean;
	isFromLibrary?: boolean;
}
type ChatServerMessage = {
	paneId: string;
	type: string;
	[key: string]: any;
};
export function isChatServerMessage(
	value: unknown,
): value is ChatServerMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Record<string, unknown>;
	return (
		typeof message.paneId === "string" &&
		typeof message.type === "string" &&
		(message.type.startsWith("chat:") || message.type.startsWith("checkpoint:"))
	);
}
let msgId = 0;
export function nextId() {
	return `c${++msgId}-${Date.now().toString(36)}`;
}
const LOCAL_RENDER_LIMIT = 256_000;
export function localChatContent(content: string) {
	return content.length <= LOCAL_RENDER_LIMIT
		? content
		: `${content.slice(0, LOCAL_RENDER_LIMIT)}\n\n[… pending message truncated for display …]`;
}
export function findTriggerAtCursor(
	value: string,
	cursorPos: number,
	trigger: "/" | "@",
): { index: number; query: string } | null {
	let triggerIdx = -1;
	for (let i = cursorPos - 1; i >= 0; i--) {
		if (value[i] === trigger) {
			if (i === 0 || /\s/.test(value[i - 1]!)) {
				triggerIdx = i;
			}
			break;
		}
		if (/\s/.test(value[i]!)) break;
	}
	if (triggerIdx === -1) return null;
	return {
		index: triggerIdx,
		query: value.slice(triggerIdx + 1, cursorPos),
	};
}
export function hideMenuState<S extends { show: boolean }>(state: S): S {
	return {
		...state,
		show: false,
	};
}
export type RenderChatMessage = Pick<
	AgentChatSharedChatMessage,
	| "btwQuestion"
	| "content"
	| "id"
	| "images"
	| "isStreaming"
	| "role"
	| "toolName"
	| "render"
>;
type RenderItem =
	| { type: "message"; message: RenderChatMessage }
	| { type: "edit-group"; filePath: string; edits: RenderChatMessage[] }
	| {
			type: "tool-group";
			tools: [RenderChatMessage];
			continuesAfter: boolean;
	  };
export function getRenderRowKey(row: RenderItem | undefined, index: number) {
	if (!row) return `row-${index}`;
	if (row.type === "edit-group")
		return `edit-group:${row.edits[0]?.render?.groupId ?? row.edits[0]?.id}`;
	if (row.type === "tool-group") return `tool-group:${row.tools[0]?.id}`;
	return row.message.id;
}

export function calculateChatOffsets(
	rows: RenderItem[],
	heights: ReadonlyMap<string, number>,
) {
	const offsets = [0];
	for (let index = 0; index < rows.length; index++)
		offsets.push(
			offsets[index]! +
				(heights.get(getRenderRowKey(rows[index], index)) ?? 160),
		);
	return offsets;
}

export function calculateChatWindow(
	rows: RenderItem[],
	offsets: number[],
	scrollOffset: number | null,
	viewportHeight: number,
) {
	if (rows.length <= 60)
		return { firstVisible: 0, offsets, start: 0, end: rows.length };
	let firstVisible = Math.max(0, rows.length - 24);
	if (scrollOffset !== null) {
		let low = 0;
		let high = rows.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (offsets[middle + 1]! <= scrollOffset) low = middle + 1;
			else high = middle;
		}
		firstVisible = Math.min(low, rows.length - 1);
	}
	const start = Math.max(0, firstVisible - 8);
	const viewportBottom =
		(scrollOffset ?? offsets[firstVisible]!) + (viewportHeight || 800);
	let low = firstVisible;
	let high = rows.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (offsets[middle]! < viewportBottom) low = middle + 1;
		else high = middle;
	}
	return {
		firstVisible,
		offsets,
		start,
		end: Math.min(rows.length, Math.max(start + 48, low + 8)),
	};
}

export function indexCheckpoints(checkpoints: CheckpointInfo[]) {
	const result = new Map<string, CheckpointInfo>();
	for (const checkpoint of checkpoints)
		if (checkpoint.afterMessageId)
			result.set(checkpoint.afterMessageId, checkpoint);
	return result;
}

export function getUserMessagePresentation(
	message: RenderChatMessage,
	slashCommandNames: readonly string[],
) {
	if (message.role !== "user") return null;
	const command = message.content.match(/^\/([a-zA-Z0-9_-]+)(\s|$)/)?.[1];
	if (
		command &&
		slashCommandNames.some(
			(name) => name.toLowerCase() === command.toLowerCase(),
		)
	)
		return null;
	let imagePaths = message.images ?? [];
	let content = message.content;
	if (
		!imagePaths.length &&
		content.includes("Here are the images at these paths:")
	) {
		const [visible = "", paths = ""] = content.split(
			"Here are the images at these paths:\n",
		);
		content = visible.trim();
		imagePaths = paths
			.split("\n")
			.filter((path) => path.trim() && path.includes("/.tmp/"));
	}
	return { content, imagePaths };
}
export function formatAskUserAnswer(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>,
) {
	const parts: string[] = [];
	for (let qi = 0; qi < questions.length; qi++) {
		const question = questions[qi]!;
		const selected = selections.get(qi);
		if (!selected?.size) continue;
		const labels = Array.from(selected)
			.sort()
			.flatMap((oi) => {
				const label = question.options?.[oi]?.label;
				return label ? [label] : [];
			});
		if (question.header)
			parts.push(`**${question.header}**: ${labels.join(", ")}`);
		else parts.push(labels.join(", "));
	}
	return parts.join("\n");
}
export function hasAskUserSelections(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>,
) {
	return questions.every((_, qi) => !!selections.get(qi)?.size);
}
/** Native descriptors own interpretation; unhydrated saved chats remain readable. */
export function getToolOutputSummary(
	content: string,
	nativeSummary?: NativeToolSummary | null,
): NativeToolSummary {
	return (
		nativeSummary ?? {
			type: "text",
			value: content,
		}
	);
}
export function getToolDisplayInfo(
	toolName: string | undefined,
	nativeDisplay?: NativeToolDisplay,
): NativeToolDisplay {
	return (
		nativeDisplay ?? {
			label: toolName ? `Using ${toolName}` : "Running tool",
		}
	);
}
export function buildRenderRows(messages: RenderChatMessage[]): RenderItem[] {
	const items: RenderItem[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]!;
		const render = msg.render;
		if (render?.hidden) continue;
		if (render?.kind === "edit-group" && render.filePath) {
			const edits = [msg];
			while (messages[i + 1]?.render?.groupId === render.groupId) {
				const next = messages[++i]!;
				if (!next.render?.hidden) edits.push(next);
			}
			items.push(
				edits.length > 1
					? { type: "edit-group", filePath: render.filePath, edits }
					: { type: "message", message: msg },
			);
			continue;
		}
		if (render?.kind === "tool-group") {
			let next = i + 1;
			while (messages[next]?.render?.groupId === render.groupId) {
				if (!messages[next]?.render?.hidden) break;
				next++;
			}
			items.push({
				type: "tool-group",
				tools: [msg],
				continuesAfter: messages[next]?.render?.groupId === render.groupId,
			});
			continue;
		}
		items.push({ type: "message", message: msg });
	}
	return items;
}
type ChatStateMessage = Pick<
	AgentChatSharedChatMessage,
	"id" | "role" | "content" | "parts" | "isStreaming" | "localOnly" | "render"
>;
export function appendSystemMessage(
	messages: ChatStateMessage[],
	content: string,
	render?: AgentChatSharedChatMessage["render"],
): ChatStateMessage[] {
	content = localChatContent(content);
	const previous = messages.at(-1);
	if (
		content &&
		previous?.role === "system" &&
		!previous.isStreaming &&
		previous.content === content
	)
		return messages;
	return [
		...messages,
		{
			id: nextId(),
			role: "system" as const,
			content,
			localOnly: true,
			...(render
				? {
						render,
					}
				: {}),
		},
	];
}

/** Apply native transport changes without interpreting provider events. Null
 * requests a full resync: never apply a delta against a different revision. */
export function applyNativeTranscriptUpdate(
	current: {
		messages: AgentChatSharedChatMessage[];
		revision: number;
		epoch?: string;
	} | null,
	update: ChatTranscriptUpdate,
): {
	messages: AgentChatSharedChatMessage[];
	revision: number;
	epoch?: string;
} | null {
	const validInteger = (value: number) =>
		Number.isSafeInteger(value) && value >= 0;
	if (
		update.version !== 1 ||
		!validInteger(update.revision) ||
		!validInteger(update.start) ||
		!validInteger(update.deleteCount) ||
		!Array.isArray(update.messages)
	)
		return null;
	if (current && current.epoch !== update.epoch) return null;
	if (current && update.revision <= current.revision) return current;
	if (!update.reset && (!current || current.revision !== update.baseRevision))
		return null;
	const before = update.reset ? [] : current!.messages;
	if (
		update.start > before.length ||
		(!update.reset && update.start + update.deleteCount > before.length)
	)
		return null;
	const inserted = update.messages.map((change, index) => {
		if (
			!change?.message ||
			typeof change.message.id !== "string" ||
			!["user", "assistant", "tool", "system", "btw"].includes(
				change.message.role,
			)
		)
			return null;
		const previous = before[update.start + index];
		if (
			change.appendContent === undefined &&
			typeof change.message.content === "string"
		)
			return change.message as AgentChatSharedChatMessage;
		if (typeof change.appendContent !== "string") return null;
		if (!previous || previous.id !== change.message.id) return null;
		return {
			...change.message,
			content: previous.content + change.appendContent,
		} as AgentChatSharedChatMessage;
	});
	if (inserted.some((message) => message === null)) return null;
	return {
		messages: [
			...before.slice(0, update.start),
			...(inserted as AgentChatSharedChatMessage[]),
			...before.slice(update.start + update.deleteCount),
		],
		revision: update.revision,
		epoch: update.epoch,
	};
}

/** Native messages are authoritative; only unacknowledged local sends survive
 * a splice/reset. Unlike the legacy reader this never aligns users by index. */
export function mergeNativeTranscript(
	local: AgentChatSharedChatMessage[],
	server: AgentChatSharedChatMessage[],
): AgentChatSharedChatMessage[] {
	const ids = new Set(server.map((message) => message.id));
	const merged = [...server];
	for (let index = 0; index < local.length; index++) {
		const message = local[index]!;
		const browserOwned =
			(message.optimistic && message.role === "user") ||
			message.localOnly ||
			message.role === "btw";
		if (!browserOwned || ids.has(message.id)) continue;
		if (
			message.localOnly &&
			server.some(
				(candidate) =>
					candidate.role === message.role &&
					candidate.content === message.content,
			)
		)
			continue;
		let insertion = merged.length;
		for (let anchor = index - 1; anchor >= 0; anchor--) {
			const position = merged.findIndex(
				(candidate) => candidate.id === local[anchor]!.id,
			);
			if (position >= 0) {
				insertion = position + 1;
				break;
			}
		}
		merged.splice(insertion, 0, message);
	}
	return merged;
}
