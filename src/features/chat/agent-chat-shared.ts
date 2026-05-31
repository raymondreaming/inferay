import type { AgentKind } from "../terminal/terminal-utils.ts";

export interface AgentChatSession {
	paneId: string;
	cwd?: string;
	agentKind: AgentKind;
}

export interface QueuedMessageInfo {
	id: string;
	text: string;
	displayText: string;
	images?: string[];
}

export interface AttachedImageInfo {
	name: string;
	path: string;
	previewUrl: string;
}

export type MessageIntent =
	| "plan"
	| "fix"
	| "refactor"
	| "explain"
	| "test"
	| "review"
	| "docs";

export type ComposerContextSource =
	| "diff"
	| "terminal"
	| "file"
	| "handover"
	| "artifact";

export interface ComposerContextBlock {
	id: string;
	source: ComposerContextSource;
	title: string;
	subtitle?: string;
	path?: string;
	lineStart?: number;
	lineEnd?: number;
	content: string;
	createdAt: number;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "tool" | "system" | "btw";
	content: string;
	toolName?: string;
	isStreaming?: boolean;
	btwQuestion?: string;
	images?: string[];
	intent?: MessageIntent;
	contextBlocks?: ComposerContextBlock[];
}

export interface CheckpointInfo {
	id: string;
	timestamp: number;
	changedFileCount: number;
	changedFiles: { path: string; action: "created" | "modified" | "deleted" }[];
	reverted: boolean;
	afterMessageId: string | null;
}

export interface WorktreeLaunchInfo {
	branchName: string;
	basePath: string;
	worktreePath: string;
	createdAt: number;
}

export interface SlashCommand {
	id?: string;
	name: string;
	description: string;
	action: "local" | "send";
	promptTemplate?: string;
	category?: string;
	isLocalCommand?: boolean;
	isFromLibrary?: boolean;
}

let msgId = 0;

export function nextId() {
	return `c${++msgId}-${Date.now().toString(36)}`;
}

export function trimMessages(msgs: ChatMessage[]): ChatMessage[] {
	return msgs;
}

export function appendMessage(
	msg: ChatMessage,
	msgs: ChatMessage[]
): ChatMessage[] {
	return [...msgs, msg];
}

export function appendTrimmedMessage(
	msg: ChatMessage,
	msgs: ChatMessage[]
): ChatMessage[] {
	return trimMessages([...msgs, msg]);
}
