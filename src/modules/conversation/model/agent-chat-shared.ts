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
		message: Omit<ChatMessage, "content"> & { content?: string };
		appendContent?: string;
	}>;
}

export interface ChatMessage {
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

export type ChatUiState = ChatLoadingState & {
	expandedTools: Set<string>;
};

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
			content === message.content ? message : { ...message, content },
		);
	}
	return !changed && retained.length === msgs.length
		? msgs
		: retained.reverse();
}

export function appendTrimmedMessage(
	msg: ChatMessage,
	msgs: ChatMessage[],
): ChatMessage[] {
	return trimMessages([...msgs, msg]);
}

function transcriptDuplicateKey(
	message: Pick<ChatMessage, "content" | "isStreaming" | "role"> | undefined,
) {
	if (!message?.content || message.isStreaming) return null;
	if (message.role === "assistant") return `assistant:${message.content}`;
	if (message.role === "system") return `system:${message.content}`;
	return null;
}

export function compactAdjacentDuplicateTranscriptMessages<
	T extends Pick<ChatMessage, "content" | "isStreaming" | "role">,
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
