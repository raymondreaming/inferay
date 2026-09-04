import type {
	ChatLoadingState,
	ChatMessage,
	ToolActivity,
} from "../../../modules/conversation/model/agent-chat-shared.ts";
import { trimText as trimSummary } from "../../../shared/lib/format.ts";
import { getToolOutputSummary } from "./chat-message-render-utils.ts";

const MAX_LIVE_ACTIVITIES = 500;

type ChatToolMessage = Pick<
	ChatMessage,
	"id" | "role" | "content" | "toolName" | "isStreaming"
>;

type ChatActivityUiState = {
	expandedTools: Set<string>;
	liveActivities: ToolActivity[];
};

type IncomingToolActivity = {
	isStreaming?: boolean;
	summary: string;
	toolName: string;
};

export function normalizeToolName(toolName: string): string {
	const name = toolName.trim().toLowerCase();
	if (name.startsWith("mcp__")) {
		const parts = name.split("__").filter(Boolean);
		return parts[parts.length - 1] || "mcp_tool";
	}
	if (name === "exec_command") return "exec";
	if (name === "websearch") return "web_search";
	if (name === "read_file" || name === "view") return "read";
	if (name === "apply_patch") return "patch";
	return name;
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
	return { ...state, show: false };
}

export function markRespondingState<S extends { status: string }>(state: S): S {
	return { ...state, status: "responding" };
}

export function clearLiveActivities<
	S extends { liveActivities: ToolActivity[] },
>(state: S): S {
	return { ...state, liveActivities: [] };
}

export function appendLiveToolActivity(
	activity: IncomingToolActivity,
	state: ChatActivityUiState,
): ChatActivityUiState {
	const last = state.liveActivities[state.liveActivities.length - 1];
	const lastSequence = Number(last?.id.match(/-(\d+)$/)?.[1] ?? -1);
	const nextActivity: ToolActivity = {
		id: `${activity.toolName}-${lastSequence + 1}`,
		toolName: activity.toolName,
		summary: activity.summary,
		isStreaming: activity.isStreaming ?? true,
	};
	if (
		last &&
		last.toolName === nextActivity.toolName &&
		last.summary === nextActivity.summary
	) {
		return state;
	}
	return {
		...state,
		liveActivities: [...state.liveActivities, nextActivity].slice(
			-MAX_LIVE_ACTIVITIES,
		),
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
		liveActivities: [],
	};
}

export function markToolState(
	toolName: string,
	state: ChatLoadingState,
): ChatLoadingState {
	return { ...state, status: `tool:${toolName}` };
}

export function extractToolActivities(
	messages: ChatToolMessage[],
): ToolActivity[] {
	const activities: ToolActivity[] = [];
	for (const msg of messages) {
		if (msg.role !== "tool" || !msg.toolName) continue;
		const toolName = normalizeToolName(msg.toolName);
		const outputSummary = getToolOutputSummary(msg.content);
		const summary =
			outputSummary.type === "edit" || outputSummary.type === "file-content"
				? outputSummary.fileName
				: outputSummary.type === "url"
					? trimSummary(outputSummary.value)
					: trimSummary(String(outputSummary.value || toolName));
		activities.push({
			id: msg.id,
			toolName,
			isStreaming: msg.isStreaming ?? false,
			summary: summary || toolName,
		});
	}
	return activities;
}
