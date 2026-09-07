import type { CheckpointMeta } from "../../../../build/presentation/contracts/CheckpointMeta.ts";
import type { QueuedMessageInfo } from "../../../../build/presentation/contracts/QueuedMessageInfo.ts";

export type QueuedChatMessage = QueuedMessageInfo & { transient?: boolean };

import type { AskUserQuestion } from "../../../../build/presentation/contracts/AskUserQuestion.ts";
import type { ToolDisplayInfo } from "../../../../build/presentation/contracts/ToolDisplayInfo.ts";
import type { ToolOutputSummary } from "../../../../build/presentation/contracts/ToolOutputSummary.ts";

import { project as rustProject } from "../../../adapters/presentation/model.ts";
export type ChatMessage = RenderChatMessage;
type TokenRange = { start: number; end: number };
export function findDecoratedTokenRanges(
	text: string,
	slashCommandNames?: readonly string[],
): TokenRange[] {
	return rustProject("decoratedTokens", { text, commands: slashCommandNames });
}

import type { SkillProposal } from "../../../../build/presentation/contracts/SkillProposal.ts";
import type { SkillRead } from "../../../../build/presentation/contracts/SkillRead.ts";

export interface AttachedImageInfo {
	name: string;
	path: string;
	previewUrl: string;
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
	groupEnd?: number;
	groupLeader?: boolean;
	hidden: boolean;
	continuesAfter?: boolean;
	rowId?: string;
	filePath?: string;
	edit?: { file_path: string; old_string: string; new_string: string };
	trailingOutput?: string;
	display?: ToolDisplayInfo;
	summary?: ToolOutputSummary | null;
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
	isStreaming?: boolean;
	btwQuestion?: string;
	images?: string[];
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
	const match = rustProject<{ index: number } | null>("trigger", {
		value,
		cursorPos,
		trigger,
	});
	return match
		? { index: match.index, query: value.slice(match.index + 1, cursorPos) }
		: null;
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
	const message =
		row.type === "message"
			? row.message
			: row.type === "edit-group"
				? row.edits[0]
				: row.tools[0];
	return message?.render?.rowId ?? message?.id ?? `row-${index}`;
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

export function indexCheckpoints(checkpoints: CheckpointMeta[]) {
	const result = new Map<string, CheckpointMeta>();
	for (const checkpoint of checkpoints)
		if (checkpoint.afterMessageId)
			result.set(checkpoint.afterMessageId, checkpoint);
	return result;
}

export function getUserMessagePresentation(
	message: RenderChatMessage,
	slashCommandNames: readonly string[],
): { content: string; imagePaths: string[] } | null {
	return rustProject("userMessage", { message, commands: slashCommandNames });
}
export function formatAskUserAnswer(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>,
): string {
	return rustProject("askAnswer", {
		questions,
		selections: Object.fromEntries(
			[...selections].map(([key, indexes]) => [key, [...indexes]]),
		),
	});
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
	nativeSummary?: ToolOutputSummary | null,
): ToolOutputSummary {
	return (
		nativeSummary ?? {
			type: "text",
			value: content,
		}
	);
}
export function getToolDisplayInfo(
	toolName: string | undefined,
	nativeDisplay?: ToolDisplayInfo,
): ToolDisplayInfo {
	return (
		nativeDisplay ?? {
			label: toolName ? `Using ${toolName}` : "Running tool",
		}
	);
}
export function buildRenderRows(messages: RenderChatMessage[]): RenderItem[] {
	return messages.flatMap((msg, index): RenderItem[] => {
		const render = msg.render;
		if (
			render?.hidden ||
			(render?.kind === "edit-group" && !render.groupLeader)
		)
			return [];
		if (render?.kind === "edit-group" && render.filePath) {
			const edits = messages.slice(index, render.groupEnd ?? index + 1);
			return [
				edits.length > 1
					? { type: "edit-group", filePath: render.filePath, edits }
					: { type: "message", message: msg },
			];
		}
		if (render?.kind === "tool-group")
			return [
				{
					type: "tool-group",
					tools: [msg],
					continuesAfter: render.continuesAfter === true,
				},
			];
		return [{ type: "message", message: msg }];
	});
}
type ChatStateMessage = Pick<
	AgentChatSharedChatMessage,
	"id" | "role" | "content" | "isStreaming" | "localOnly" | "render"
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
/** Native messages are authoritative; only unacknowledged local sends survive
 * a splice/reset. Unlike the legacy reader this never aligns users by index. */
export function mergeNativeTranscript(
	local: AgentChatSharedChatMessage[],
	server: AgentChatSharedChatMessage[],
): AgentChatSharedChatMessage[] {
	const describe = (message: AgentChatSharedChatMessage) => ({
		id: message.id,
		role: message.role,
		optimistic: message.optimistic,
		localOnly: message.localOnly,
		content: message.localOnly ? message.content : undefined,
	});
	const hasNotices = local.some((message) => message.localOnly);
	const order = rustProject<Array<[boolean, number]>>("mergeTranscriptOrder", {
		local: local.map(describe),
		server: server.map((message) => ({
			...describe(message),
			content: hasNotices ? message.content : undefined,
		})),
	});
	return order.map(([browser, index]) => (browser ? local : server)[index]!);
}
