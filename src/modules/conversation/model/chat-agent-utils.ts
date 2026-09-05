import type { ChatLoadingState } from "./agent-chat-shared.ts";

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
	return { ...state, show: false };
}

export function markRespondingState<S extends { status: string }>(state: S): S {
	return { ...state, status: "responding" };
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
	return { ...state, status: `tool:${toolName}` };
}
