import { useCallback, useRef, useState } from "react";
import {
	clearStoredLoadingState,
	loadStoredLoadingState,
	saveStoredLoadingState,
} from "../../features/chat/chat-session-store.ts";
import type { ToolActivity } from "./chat-agent-utils.ts";

export type LoadingState = {
	isLoading: boolean;
	status: string;
	startTime: number | null;
};

type ChatUiState = LoadingState & {
	expandedTools: Set<string>;
	liveActivities: ToolActivity[];
};

export function useAgentChatUiState({
	paneId,
	onStatusChange,
}: {
	paneId: string;
	onStatusChange?: (paneId: string, status: string) => void;
}) {
	const [chatUiState, setChatUiState] = useState<ChatUiState>(() => {
		const storedLoading = loadStoredLoadingState(paneId);
		return {
			isLoading: storedLoading?.isLoading ?? false,
			status: storedLoading?.status ?? "idle",
			startTime: storedLoading?.startTime ?? null,
			expandedTools: new Set(),
			liveActivities: [],
		};
	});
	const chatUiStateRef = useRef(chatUiState);
	chatUiStateRef.current = chatUiState;

	const setLoadingState = useCallback(
		(v: LoadingState | ((prev: LoadingState) => LoadingState)) => {
			const prev = chatUiStateRef.current;
			const patch = typeof v === "function" ? v(prev) : v;
			const next = { ...prev, ...patch };
			if (!next.isLoading) {
				next.liveActivities = [];
			}
			chatUiStateRef.current = next;
			setChatUiState(next);
			if (next.isLoading && next.startTime) {
				saveStoredLoadingState(paneId, {
					isLoading: next.isLoading,
					status: next.status,
					startTime: next.startTime,
				});
			} else {
				clearStoredLoadingState(paneId);
			}
			if (prev.status !== next.status) {
				onStatusChange?.(paneId, next.status);
			}
		},
		[onStatusChange, paneId]
	);

	const setExpandedTools = useCallback(
		(v: Set<string> | ((prev: Set<string>) => Set<string>)) => {
			setChatUiState((prev) => ({
				...prev,
				expandedTools: typeof v === "function" ? v(prev.expandedTools) : v,
			}));
		},
		[]
	);

	return {
		chatUiState,
		setChatUiState,
		setLoadingState,
		setExpandedTools,
	};
}
