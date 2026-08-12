import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "octane";
import type { Dispatch, SetStateAction } from "react";
import {
	appendTrimmedMessage,
	type ChatLoadingState,
	type ChatMessage,
	type ChatStreamEvent,
	getToolBlockInitialContent,
	isChatServerMessage,
	nextId,
	type QueuedMessageInfo,
	type ToolActivity,
	truncateChatContent,
} from "../../features/chat/agent-chat-shared.ts";
import {
	getChatCheckpointReadModel,
	saveStoredSessionId,
} from "../../features/chat/chat-session-store.ts";
import { wsClient } from "../../lib/websocket.ts";
import {
	appendLiveToolActivity,
	clearCompletedChatUiState,
	clearLiveActivities,
	markRespondingState,
	markToolState,
} from "./chat-agent-utils.ts";
import {
	appendBtwQuestionMessage,
	appendSystemMessage,
	applyAssistantResultMessage,
	applyPendingMessageContent,
	createBtwQuestionMessage,
	finishBtwMessage,
	finishStreamingMessages,
	patchMessageById,
	reconcileChatSync,
} from "./chat-state-utils.ts";

interface ChatMessageMutationModel {
	get: () => ChatMessage[];
	saveNow: (messages: ChatMessage[]) => ChatMessage[];
	set: (
		update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
	) => void;
}

type ChatActivityUiState = {
	expandedTools: Set<string>;
	liveActivities: ToolActivity[];
};

function scheduleFrame(callback: () => void): number {
	if (typeof window !== "undefined" && window.requestAnimationFrame) {
		return window.requestAnimationFrame(callback);
	}
	return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(id: number) {
	if (typeof window !== "undefined" && window.cancelAnimationFrame) {
		window.cancelAnimationFrame(id);
		return;
	}
	clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

export function useChatConnection({
	enabled = true,
	messageReadModel,
	paneId,
	replaceQueuedMessages,
	setChatUiState,
	setRunStatus,
}: {
	enabled?: boolean;
	messageReadModel: ChatMessageMutationModel;
	paneId: string;
	replaceQueuedMessages: (messages: QueuedMessageInfo[]) => void;
	setChatUiState: Dispatch<SetStateAction<ChatActivityUiState>>;
	setRunStatus: (
		value: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState),
	) => void;
}) {
	const currentAssistantRef = useRef<string | null>(null);
	const lastAssistantRef = useRef<string | null>(null);
	const currentBtwRef = useRef<string | null>(null);
	const currentToolRef = useRef<string | null>(null);
	const hasStreamedRef = useRef(false);
	const transcriptRevisionRef = useRef<number | null>(null);
	const pendingContentRef = useRef<Map<string, string>>(
		undefined as unknown as Map<string, string>,
	);
	if (!pendingContentRef.current) {
		pendingContentRef.current = new Map();
	}
	const flushFrameRef = useRef<number | null>(null);
	const checkpointReadModel = useMemo(
		() => getChatCheckpointReadModel(paneId),
		[paneId],
	);
	const checkpoints = useSyncExternalStore(
		checkpointReadModel.subscribe,
		checkpointReadModel.getSnapshot,
		checkpointReadModel.getSnapshot,
	);
	const applyPendingContent = useCallback(
		(messages: ChatMessage[], pending: Map<string, string>) => {
			return applyPendingMessageContent(messages, pending);
		},
		[],
	);
	const flushPendingContent = useCallback(() => {
		if (flushFrameRef.current !== null) {
			cancelFrame(flushFrameRef.current);
			flushFrameRef.current = null;
		}
		const pending = pendingContentRef.current;
		if (pending.size === 0) return messageReadModel.get();
		pendingContentRef.current = new Map();
		const next = applyPendingContent(messageReadModel.get(), pending);
		messageReadModel.set(next);
		return next;
	}, [applyPendingContent, messageReadModel]);
	const clearPendingContent = useCallback(() => {
		if (flushFrameRef.current !== null) {
			cancelFrame(flushFrameRef.current);
			flushFrameRef.current = null;
		}
		pendingContentRef.current = new Map();
	}, []);
	const queueMessageContent = useCallback(
		(targetId: string, content: string) => {
			if (!content) return;
			const pending = pendingContentRef.current;
			pending.set(targetId, (pending.get(targetId) ?? "") + content);
			if (flushFrameRef.current !== null) return;
			flushFrameRef.current = scheduleFrame(() => {
				flushFrameRef.current = null;
				const queued = pendingContentRef.current;
				if (queued.size === 0) return;
				pendingContentRef.current = new Map();
				messageReadModel.set((prev) => applyPendingContent(prev, queued));
			});
		},
		[applyPendingContent, messageReadModel],
	);
	const resetStreamState = useCallback(() => {
		flushPendingContent();
		currentAssistantRef.current = null;
		lastAssistantRef.current = null;
		currentToolRef.current = null;
		hasStreamedRef.current = false;
	}, [flushPendingContent]);
	const clearCheckpoints = useCallback(() => {
		checkpointReadModel.clear();
	}, [checkpointReadModel]);
	const revertCheckpoint = useCallback(
		(checkpointId: string) => {
			wsClient.send({ type: "checkpoint:revert", paneId, checkpointId });
		},
		[paneId],
	);
	function appendAssistant(content: string, isStreaming: boolean) {
		const id = nextId();
		currentAssistantRef.current = id;
		lastAssistantRef.current = id;
		setRunStatus(markRespondingState);
		messageReadModel.set(
			appendTrimmedMessage.bind(null, {
				id,
				role: "assistant",
				content: truncateChatContent(content),
				isStreaming,
			}),
		);
	}
	function appendTool(toolName: string, content: string) {
		const id = nextId();
		currentAssistantRef.current = null;
		currentToolRef.current = id;
		setRunStatus(markToolState.bind(null, toolName));
		messageReadModel.set(
			appendTrimmedMessage.bind(null, {
				id,
				role: "tool",
				content: truncateChatContent(content),
				toolName,
				isStreaming: true,
			}),
		);
	}
	function handleChatEvent(event: ChatStreamEvent) {
		if (event.type === "assistant") {
			const msg = event.message;
			if (!msg?.content || hasStreamedRef.current) return;
			for (const block of msg.content) {
				if (block.type === "text" && block.text) {
					setRunStatus(markRespondingState);
					if (currentAssistantRef.current) {
						const targetId = currentAssistantRef.current;
						lastAssistantRef.current = targetId;
						messageReadModel.set((prev) =>
							patchMessageById(
								prev,
								targetId,
								{
									content: block.text,
									isStreaming: !msg.stop_reason,
								},
								false,
							),
						);
					} else {
						appendAssistant(block.text, !msg.stop_reason);
					}
				} else if (block.type === "tool_use") {
					appendTool(
						block.name,
						typeof block.input === "string"
							? block.input
							: JSON.stringify(block.input, null, 2),
					);
				}
			}
		} else if (event.type === "content_block_start") {
			hasStreamedRef.current = true;
			const block = event.content_block;
			if (block?.type === "text") {
				appendAssistant(block.text || "", true);
			} else if (block?.type === "tool_use") {
				appendTool(block.name, getToolBlockInitialContent(block));
			}
		} else if (event.type === "content_block_delta") {
			const delta = event.delta;
			if (
				delta?.type === "text_delta" &&
				delta.text &&
				currentAssistantRef.current
			) {
				const targetId = currentAssistantRef.current;
				const text = delta.text;
				queueMessageContent(targetId, text);
			} else if (
				delta?.type === "input_json_delta" &&
				delta.partial_json &&
				currentToolRef.current
			) {
				const targetId = currentToolRef.current;
				const partialJson = delta.partial_json;
				queueMessageContent(targetId, partialJson);
			}
		} else if (event.type === "content_block_stop") {
			flushPendingContent();
			const assistantId = currentAssistantRef.current;
			const toolId = currentToolRef.current;
			messageReadModel.set((prev) => {
				return finishStreamingMessages(prev, { assistantId, toolId });
			});
			currentAssistantRef.current = null;
			currentToolRef.current = null;
			// hasStreamedRef stays true for the rest of the turn so that any
			// trailing `assistant` finalize event (codex emits the full message
			// after streaming) is ignored instead of appended as a duplicate.
		} else if (event.type === "result" && event.result) {
			flushPendingContent();
			const result = event.result;
			setRunStatus(markRespondingState);
			const assistantId =
				currentAssistantRef.current ?? lastAssistantRef.current;
			messageReadModel.set((prev) =>
				applyAssistantResultMessage(prev, assistantId, result),
			);
			currentAssistantRef.current = null;
			lastAssistantRef.current = null;
		}
	}
	const handleChatEventRef = useRef(handleChatEvent);
	handleChatEventRef.current = handleChatEvent;

	useEffect(() => {
		if (!enabled) {
			clearPendingContent();
			return;
		}
		const cleanup = wsClient.subscribe(paneId, (rawMessage) => {
			if (!isChatServerMessage(rawMessage)) return;
			const msg = rawMessage;
			if (msg.type === "chat:event") {
				handleChatEventRef.current(msg.event);
				if (msg.event?.session_id)
					saveStoredSessionId(paneId, msg.event.session_id);
			} else if (msg.type === "chat:session") {
				if (msg.sessionId) saveStoredSessionId(paneId, msg.sessionId);
			} else if (msg.type === "chat:done") {
				const flushedMessages = flushPendingContent();
				const updated = messageReadModel.saveNow(flushedMessages);
				messageReadModel.set(updated);
				const ids = new Set(updated.map((message) => message.id));
				setRunStatus({ isLoading: false, status: "idle", startTime: null });
				setChatUiState(clearCompletedChatUiState.bind(null, ids));
				resetStreamState();
				wsClient.send({ type: "chat:reconnect", paneId });
			} else if (msg.type === "chat:steered") {
				const content =
					typeof msg.displayText === "string"
						? msg.displayText
						: typeof msg.text === "string"
							? msg.text
							: "";
				if (content) {
					messageReadModel.set((prev) =>
						appendTrimmedMessage(
							{
								id: nextId(),
								role: "user",
								content,
								images: Array.isArray(msg.images) ? msg.images : undefined,
							},
							prev,
						),
					);
				}
			} else if (msg.type === "chat:user_message") {
				setChatUiState(clearLiveActivities);
				setRunStatus((prev) => ({
					isLoading: true,
					status: "thinking",
					startTime: prev.startTime ?? Date.now(),
				}));
				resetStreamState();
			} else if (msg.type === "chat:error") {
				flushPendingContent();
				messageReadModel.set((prev) => appendSystemMessage(prev, msg.error));
				setRunStatus({ isLoading: false, status: "error", startTime: null });
			} else if (msg.type === "chat:system") {
				messageReadModel.set((prev) => appendSystemMessage(prev, msg.message));
			} else if (msg.type === "chat:status") {
				setRunStatus((prev) => ({
					isLoading: msg.isLoading ?? prev.isLoading,
					status: msg.status ?? prev.status,
					startTime:
						msg.isLoading === false ? null : (prev.startTime ?? Date.now()),
				}));
			} else if (msg.type === "chat:activity" && msg.activity) {
				setChatUiState(appendLiveToolActivity.bind(null, msg.activity));
			} else if (msg.type === "chat:sync") {
				flushPendingContent();
				const revision = typeof msg.revision === "number" ? msg.revision : null;
				const serverMessagesInput: ChatMessage[] = Array.isArray(msg.messages)
					? msg.messages
					: [];
				const syncResult = reconcileChatSync({
					currentMessages: messageReadModel.get(),
					isStreaming: Boolean(msg.isStreaming),
					previousRevision: transcriptRevisionRef.current,
					revision,
					serverMessages: serverMessagesInput,
				});
				if (syncResult.shouldSkip) {
					setRunStatus({
						isLoading: false,
						status: "idle",
						startTime: null,
					});
					setChatUiState(clearLiveActivities);
					resetStreamState();
					return;
				}
				if (syncResult.shouldUpdateMessages) {
					messageReadModel.set(syncResult.mergedMessages);
					if (syncResult.shouldPersist)
						messageReadModel.saveNow(syncResult.mergedMessages);
				}
				if (msg.isStreaming) {
					transcriptRevisionRef.current = syncResult.nextRevision;
					const latestAssistantId = syncResult.mergedMessages.findLast?.(
						(message) => message.role === "assistant",
					)?.id;
					setRunStatus((prev) => ({
						isLoading: true,
						status: "responding",
						startTime: prev.startTime ?? Date.now(),
					}));
					if (syncResult.streamingAssistantId) {
						currentAssistantRef.current = syncResult.streamingAssistantId;
					}
					lastAssistantRef.current =
						syncResult.streamingAssistantId ?? latestAssistantId ?? null;
					if (syncResult.streamingToolId) {
						currentToolRef.current = syncResult.streamingToolId;
					}
				} else {
					transcriptRevisionRef.current = syncResult.nextRevision;
					setRunStatus({
						isLoading: false,
						status: "idle",
						startTime: null,
					});
					setChatUiState(clearLiveActivities);
					resetStreamState();
				}
			} else if (msg.type === "chat:queue" && Array.isArray(msg.queue)) {
				replaceQueuedMessages(msg.queue);
			} else if (msg.type === "chat:btw:start") {
				const btwMessage = createBtwQuestionMessage(msg.question);
				currentBtwRef.current = btwMessage.id;
				messageReadModel.set((prev) =>
					appendBtwQuestionMessage(prev, btwMessage),
				);
			} else if (msg.type === "chat:btw:delta") {
				const targetId = currentBtwRef.current;
				if (targetId) {
					queueMessageContent(targetId, msg.text);
				}
			} else if (msg.type === "chat:btw:done") {
				flushPendingContent();
				const targetId = currentBtwRef.current;
				currentBtwRef.current = null;
				if (targetId) {
					messageReadModel.set((prev) =>
						finishBtwMessage(prev, targetId, msg.answer),
					);
				}
			} else if (msg.type === "checkpoint:finalized") {
				checkpointReadModel.recordFinalized(
					{
						checkpointId: msg.checkpointId,
						changedFileCount: msg.changedFileCount,
						changedFiles: msg.changedFiles,
					},
					messageReadModel.get(),
				);
			} else if (msg.type === "checkpoint:reverted") {
				checkpointReadModel.markReverted(msg.checkpointId);
				messageReadModel.set((prev) =>
					appendSystemMessage(
						prev,
						`Reverted ${msg.restoredFiles?.length ?? 0} file(s) to checkpoint`,
					),
				);
			} else if (msg.type === "checkpoint:error") {
				messageReadModel.set((prev) =>
					appendSystemMessage(prev, `Revert failed: ${msg.error}`),
				);
			}
		});
		const reconnectChat = () => {
			wsClient.send({ type: "chat:reconnect", paneId });
		};
		reconnectChat();
		const cleanupReconnect = wsClient.onReconnect(reconnectChat);
		return () => {
			clearPendingContent();
			cleanupReconnect();
			cleanup();
		};
	}, [
		checkpointReadModel,
		clearPendingContent,
		enabled,
		messageReadModel,
		paneId,
		flushPendingContent,
		queueMessageContent,
		replaceQueuedMessages,
		resetStreamState,
		setChatUiState,
		setRunStatus,
	]);

	return { checkpoints, clearCheckpoints, resetStreamState, revertCheckpoint };
}
