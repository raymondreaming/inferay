import { useCallback, useMemo, useState, useSyncExternalStore } from "octane";

import type {
	ChatLoadingState,
	ChatUiState,
} from "../../model/agent-chat-shared.ts";
import { getChatRunStatusReadModel } from "../../model/chat-session-store.ts";

export function useChatUiState(
	paneId: string,
	onStatusChange?: (paneId: string, status: string) => void,
) {
	const runStatusReadModel = useMemo(
		() => getChatRunStatusReadModel(paneId),
		[paneId],
	);
	const runStatus = useSyncExternalStore(
		runStatusReadModel.subscribe,
		runStatusReadModel.getSnapshot,
		runStatusReadModel.getSnapshot,
	);
	const [chatUiControls, setChatUiControls] = useState<
		Pick<ChatUiState, "expandedTools" | "liveActivities">
	>(() => ({
		expandedTools: new Set(),
		liveActivities: [],
	}));
	const chatUiState = useMemo(
		() => ({
			...runStatus,
			...chatUiControls,
		}),
		[chatUiControls, runStatus],
	);
	const setRunStatus = useCallback(
		(
			value: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState),
		) => {
			const prev = runStatusReadModel.get();
			const next = runStatusReadModel.set(value);
			if (prev.status !== next.status) onStatusChange?.(paneId, next.status);
		},
		[onStatusChange, paneId, runStatusReadModel],
	);
	const setExpandedTools = useCallback(
		(value: Set<string> | ((prev: Set<string>) => Set<string>)) => {
			setChatUiControls((prev) => {
				const expandedTools =
					typeof value === "function" ? value(prev.expandedTools) : value;
				if (prev.expandedTools === expandedTools) return prev;
				return { ...prev, expandedTools };
			});
		},
		[],
	);

	return {
		chatUiState,
		setChatUiState: setChatUiControls,
		setExpandedTools,
		setRunStatus,
	};
}
