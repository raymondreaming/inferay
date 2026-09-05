import { useCallback, useMemo, useState, useSyncExternalStore } from "octane";

import type { ChatUiState } from "../../model/agent-chat-shared.ts";
import { getChatRunStatusReadModel } from "../../model/chat-session-store.ts";

export function useChatUiState(paneId: string) {
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
		Pick<ChatUiState, "expandedTools">
	>(() => ({
		expandedTools: new Set(),
	}));
	const chatUiState = useMemo(
		() => ({
			...runStatus,
			...chatUiControls,
		}),
		[chatUiControls, runStatus],
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
		setRunStatus: runStatusReadModel.set,
	};
}
