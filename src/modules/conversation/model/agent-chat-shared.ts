export type ChatMessage = RenderChatMessage;
export type TokenRange = { start: number; end: number };
export function findDecoratedTokenRanges(
	text: string,
	slashCommandNames?: readonly string[],
): TokenRange[] {
	if (!text) return [];
	const ranges: TokenRange[] = [];
	const slashRegex = /(^|\s)(\/[a-zA-Z][\w-]*)/g;
	const fileRegex = /(^|\s)(@[^\s]+)/g;
	const knownSlashCommands = slashCommandNames
		? new Set(slashCommandNames.map((name) => name.toLowerCase()))
		: null;
	for (
		let match = slashRegex.exec(text);
		match;
		match = slashRegex.exec(text)
	) {
		const prefix = match[1]!;
		const token = match[2]!;
		if (!knownSlashCommands?.has(token.slice(1).toLowerCase())) continue;
		const start = match.index + prefix.length;
		ranges.push({
			start,
			end: start + token.length,
		});
	}
	for (let match = fileRegex.exec(text); match; match = fileRegex.exec(text)) {
		const prefix = match[1]!;
		const token = match[2]!;
		const start = match.index + prefix.length;
		ranges.push({
			start,
			end: start + token.length,
		});
	}
	ranges.sort((a, b) => a.start - b.start);
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
export type ChatMessagePart =
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
export interface NativeToolDisplay {
	label: string;
	detail?: string;
}
export interface NativeToolSummary {
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
export type GoalSystemStatus =
	| "active"
	| "paused"
	| "complete"
	| "cleared"
	| "empty";
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
	toolInput: Record<string, unknown> | null;
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
export interface ChatTranscriptUpdate {
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
export type ChatUiState = ChatLoadingState & { expandedTools: Set<string> };
export interface SlashCommand {
	id?: string;
	name: string;
	description: string;
	action: "local" | "send";
	category?: string;
	isLocalCommand?: boolean;
	isFromLibrary?: boolean;
}
export type ChatServerMessage = {
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
const CHAT_MESSAGE_RETAIN_LIMIT = 5_000;
const CHAT_MESSAGE_CHAR_LIMIT = 1_000_000;
export const CHAT_SINGLE_MESSAGE_CHAR_LIMIT = 256_000;
const CHAT_TRUNCATION_MARKER =
	"\n\n[… content truncated to keep Inferay responsive …]\n\n";
let msgId = 0;
export function nextId() {
	return `c${++msgId}-${Date.now().toString(36)}`;
}
export function truncateChatContent(
	content: string,
	maxChars = CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
): string {
	if (content.length <= maxChars) return content;
	if (maxChars <= CHAT_TRUNCATION_MARKER.length) {
		return content.slice(-Math.max(0, maxChars));
	}
	const prefixLength = Math.min(
		Math.floor(maxChars / 4),
		maxChars - CHAT_TRUNCATION_MARKER.length,
	);
	const suffixLength = maxChars - CHAT_TRUNCATION_MARKER.length - prefixLength;
	if (suffixLength <= 0) {
		return (content.slice(0, prefixLength) + CHAT_TRUNCATION_MARKER).slice(
			0,
			maxChars,
		);
	}
	return (
		content.slice(0, prefixLength) +
		CHAT_TRUNCATION_MARKER +
		content.slice(-suffixLength)
	);
}
export function trimMessages<T extends { content: string }>(msgs: T[]): T[] {
	const retained: T[] = [];
	let totalChars = 0;
	let changed = false;
	for (
		let index = msgs.length - 1;
		index >= Math.max(0, msgs.length - CHAT_MESSAGE_RETAIN_LIMIT);
		index--
	) {
		const message = msgs[index]!;
		const content = truncateChatContent(message.content);
		if (
			retained.length &&
			totalChars + content.length > CHAT_MESSAGE_CHAR_LIMIT
		)
			break;
		totalChars += content.length;
		changed ||= content !== message.content;
		retained.push(
			content === message.content
				? message
				: {
						...message,
						content,
					},
		);
	}
	return !changed && retained.length === msgs.length
		? msgs
		: retained.reverse();
}
export function appendTrimmedMessage(
	msg: AgentChatSharedChatMessage,
	msgs: AgentChatSharedChatMessage[],
): AgentChatSharedChatMessage[] {
	return trimMessages([...msgs, msg]);
}
function transcriptDuplicateKey(
	message:
		| Pick<AgentChatSharedChatMessage, "content" | "isStreaming" | "role">
		| undefined,
) {
	if (!message?.content || message.isStreaming) return null;
	if (message.role === "assistant") return `assistant:${message.content}`;
	if (message.role === "system") return `system:${message.content}`;
	return null;
}
export function compactAdjacentDuplicateTranscriptMessages<
	T extends Pick<
		AgentChatSharedChatMessage,
		"content" | "isStreaming" | "role"
	>,
>(messages: T[]): T[] {
	let compacted: T[] | null = null;
	let previousKey: string | null = null;
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!;
		const key = transcriptDuplicateKey(message);
		if (key && key === previousKey) {
			compacted ??= messages.slice(0, index);
			continue;
		}
		previousKey = key;
		if (compacted) compacted.push(message);
	}
	return compacted ?? messages;
}
type ChatActivityUiState = { expandedTools: Set<string> };
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
export function markRespondingState<S extends { status: string }>(state: S): S {
	return {
		...state,
		status: "responding",
	};
}
export function clearCompletedChatUiState(
	messageIds: Set<string>,
	state: ChatActivityUiState,
): ChatActivityUiState {
	const pruned = new Set<string>();
	for (const id of state.expandedTools) if (messageIds.has(id)) pruned.add(id);
	return {
		...state,
		expandedTools:
			pruned.size === state.expandedTools.size ? state.expandedTools : pruned,
	};
}
export function markToolState(
	toolName: string,
	state: ChatLoadingState,
): ChatLoadingState {
	return {
		...state,
		status: `tool:${toolName}`,
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
export type RenderItem =
	| { type: "message"; message: RenderChatMessage }
	| { type: "edit-group"; filePath: string; edits: RenderChatMessage[] }
	| { type: "tool-group"; tools: RenderChatMessage[] };
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
export function getEditToolPayload(parsed?: Record<string, unknown> | null): {
	filePath: string;
	oldString: string;
	newString: string;
} | null {
	if (
		typeof parsed?.file_path === "string" &&
		typeof parsed.old_string === "string" &&
		typeof parsed.new_string === "string"
	) {
		return {
			filePath: parsed.file_path,
			oldString: parsed.old_string,
			newString: parsed.new_string,
		};
	}
	return null;
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
export function buildRenderItems(messages: RenderChatMessage[]): RenderItem[] {
	const items: RenderItem[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]!;
		if (msg.render?.version === 1) {
			if (msg.render.hidden) continue;
			const group = [msg];
			if (msg.render.kind !== "message") {
				while (
					i + 1 < messages.length &&
					messages[i + 1]?.render?.groupId === msg.render.groupId
				) {
					const next = messages[++i]!;
					if (!next.render?.hidden) group.push(next);
				}
			}
			items.push(
				msg.render.kind === "tool-group"
					? {
							type: "tool-group",
							tools: group,
						}
					: msg.render.kind === "edit-group" &&
							group.length > 1 &&
							msg.render.filePath
						? {
								type: "edit-group",
								filePath: msg.render.filePath,
								edits: group,
							}
						: {
								type: "message",
								message: msg,
							},
			);
			continue;
		}
		const previousMessage = messages[i - 1];
		if (
			previousMessage &&
			previousMessage.role === msg.role &&
			previousMessage.toolName === msg.toolName &&
			previousMessage.content === msg.content
		) {
			continue;
		}
		const isTimelineTool =
			msg.role === "tool" &&
			msg.toolName !== "Edit" &&
			msg.toolName !== "AskUserQuestion";
		if (isTimelineTool) {
			const tools = [msg];
			let j = i + 1;
			while (j < messages.length) {
				const next = messages[j]!;
				if (
					next.role !== "tool" ||
					next.toolName === "Edit" ||
					next.toolName === "AskUserQuestion"
				)
					break;
				const previous = tools.at(-1)!;
				if (
					next.toolName !== previous.toolName ||
					next.content !== previous.content
				) {
					tools.push(next);
				}
				j++;
			}
			items.push({
				type: "tool-group",
				tools,
			});
			i = j - 1;
			continue;
		}
		items.push({
			type: "message",
			message: msg,
		});
	}
	return items;
}
type ChatStateMessage = Pick<
	AgentChatSharedChatMessage,
	"id" | "role" | "content" | "parts" | "isStreaming"
>;
const CHAT_RENDER_CHAR_WINDOW = 500_000;
const CHAT_RENDER_MIN_MESSAGES = 30;
const CHAT_RENDER_MAX_MESSAGES = 2_000;
export function windowChatMessagesForRender<T extends { content: string }>(
	messages: T[],
): T[] {
	if (messages.length <= CHAT_RENDER_MIN_MESSAGES) return messages;
	let totalChars = 0;
	let start = messages.length;
	while (start > 0) {
		const next = messages[start - 1]!;
		const nextTotal = totalChars + next.content.length;
		const selectedCount = messages.length - start;
		if (
			selectedCount >= CHAT_RENDER_MIN_MESSAGES &&
			(nextTotal > CHAT_RENDER_CHAR_WINDOW ||
				selectedCount >= CHAT_RENDER_MAX_MESSAGES)
		) {
			break;
		}
		totalChars = nextTotal;
		start--;
	}
	return start <= 0 ? messages : messages.slice(start);
}
export function appendSystemMessage(
	messages: ChatStateMessage[],
	content: string,
	render?: AgentChatSharedChatMessage["render"],
): ChatStateMessage[] {
	const next = [
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
	const compacted = compactAdjacentDuplicateTranscriptMessages(next);
	return compacted === next ? trimMessages(next) : messages;
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
	if (
		update.version !== 1 ||
		!Number.isSafeInteger(update.revision) ||
		!Number.isSafeInteger(update.start) ||
		!Number.isSafeInteger(update.deleteCount) ||
		!Array.isArray(update.messages)
	)
		return null;
	if (current && current.epoch !== update.epoch) return null;
	if (current && update.revision <= current.revision) return current;
	if (!update.reset && (!current || current.revision !== update.baseRevision))
		return null;
	const before = update.reset ? [] : current!.messages;
	if (
		update.start < 0 ||
		update.start > before.length ||
		update.deleteCount < 0 ||
		(!update.reset && update.start + update.deleteCount > before.length)
	)
		return null;
	const inserted: AgentChatSharedChatMessage[] = [];
	for (let index = 0; index < update.messages.length; index++) {
		const change = update.messages[index];
		if (
			!change?.message ||
			typeof change.message.id !== "string" ||
			!["user", "assistant", "tool", "system", "btw"].includes(
				change.message.role,
			)
		)
			return null;
		const previous = before[update.start + index];
		let content = change.message.content;
		if (change.appendContent !== undefined) {
			if (
				typeof change.appendContent !== "string" ||
				!previous ||
				previous.id !== change.message.id
			)
				return null;
			content = previous.content + change.appendContent;
		}
		if (typeof content !== "string") return null;
		inserted.push({
			...change.message,
			content,
		});
	}
	return {
		messages: [
			...before.slice(0, update.start),
			...inserted,
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
