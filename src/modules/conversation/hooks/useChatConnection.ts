import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "octane";
import type { Dispatch, SetStateAction } from "react";
import { wsClient } from "../../../adapters/backend/websocket.ts";
import type { AgentKind } from "../../../modules/agents/model/agents.ts";
import {
	type ChatLoadingState,
	type ChatMessage,
	isChatServerMessage,
	type QueuedMessageInfo,
} from "../../../modules/conversation/model/agent-chat-shared.ts";
import {
	getChatCheckpointReadModel,
	getProviderSessionId,
	setProviderSessionId,
} from "../../../modules/conversation/model/chat-session-store.ts";
import {
	clearCompletedChatUiState,
	markRespondingState,
	markToolState,
} from "../model/chat-agent-utils.ts";
import {
	appendSystemMessage,
	applyNativeTranscriptUpdate,
	mergeNativeTranscript,
} from "../model/chat-state-utils.ts";

interface ChatMessageMutationModel {
	get: () => ChatMessage[];
	settle: (messages: ChatMessage[]) => ChatMessage[];
	set: (
		update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
	) => void;
}

type ChatActivityUiState = {
	expandedTools: Set<string>;
};

// Rendering every protocol fragment makes words repeatedly reflow while the
// browser is still laying out the previous fragment. A short fixed cadence
// keeps first-token latency effectively unchanged while presenting coherent
// text chunks and cutting Markdown/layout work roughly in half.
const STREAM_RENDER_INTERVAL_MS = 32;

function scheduleFrame(callback: () => void): number {
	return setTimeout(callback, STREAM_RENDER_INTERVAL_MS) as unknown as number;
}

function cancelFrame(id: number) {
	clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

export function useChatConnection({
	enabled = true,
	agentKind,
	cwd,
	messageReadModel,
	paneId,
	replaceQueuedMessages,
	resolveSteeringMessage,
	stageSteeringMessage,
	setChatUiState,
	setRunStatus,
}: {
	enabled?: boolean;
	agentKind: AgentKind;
	cwd?: string;
	messageReadModel: ChatMessageMutationModel;
	paneId: string;
	replaceQueuedMessages: (messages: QueuedMessageInfo[]) => void;
	resolveSteeringMessage?: (id: string) => void;
	stageSteeringMessage?: (message: QueuedMessageInfo) => void;
	setChatUiState: Dispatch<SetStateAction<ChatActivityUiState>>;
	setRunStatus: (
		value: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState),
	) => void;
}) {
	const nativeTranscriptRef = useRef<{
		messages: ChatMessage[];
		revision: number;
		epoch?: string;
	} | null>(null);
	const nativeFrameRef = useRef<number | null>(null);
	const resyncPendingRef = useRef(false);
	const checkpointReadModel = useMemo(
		() => getChatCheckpointReadModel(paneId),
		[paneId],
	);
	const checkpoints = useSyncExternalStore(
		checkpointReadModel.subscribe,
		checkpointReadModel.getSnapshot,
		checkpointReadModel.getSnapshot,
	);
	const revertCheckpoint = useCallback(
		(checkpointId: string) => {
			wsClient.send({ type: "checkpoint:revert", paneId, checkpointId });
		},
		[paneId],
	);
	const flushNativeTranscript = useCallback(() => {
		if (nativeFrameRef.current !== null) cancelFrame(nativeFrameRef.current);
		nativeFrameRef.current = null;
		const native = nativeTranscriptRef.current;
		if (!native) return;
		messageReadModel.set((current) =>
			mergeNativeTranscript(current, native.messages),
		);
	}, [messageReadModel]);
	useEffect(
		() => () => {
			if (nativeFrameRef.current !== null) cancelFrame(nativeFrameRef.current);
		},
		[],
	);

	useEffect(() => {
		if (!enabled) return;
		const cleanup = wsClient.subscribe(paneId, (rawMessage) => {
			if (!isChatServerMessage(rawMessage)) return;
			const msg = rawMessage;
			if (
				msg.modelVersion === 1 &&
				msg.type === "chat:sync" &&
				Array.isArray(msg.messages) &&
				typeof msg.revision === "number"
			) {
				if (
					!resyncPendingRef.current &&
					nativeTranscriptRef.current &&
					nativeTranscriptRef.current.epoch !== msg.epoch
				) {
					resyncPendingRef.current = true;
					wsClient.send({ type: "chat:reconnect", paneId });
					return;
				}
				if (
					!resyncPendingRef.current &&
					nativeTranscriptRef.current &&
					nativeTranscriptRef.current.epoch === msg.epoch &&
					msg.revision < nativeTranscriptRef.current.revision
				)
					return;
				nativeTranscriptRef.current = {
					epoch: typeof msg.epoch === "string" ? msg.epoch : undefined,
					messages: msg.messages,
					revision: msg.revision,
				};
				resyncPendingRef.current = false;
				flushNativeTranscript();
			} else if (msg.transcriptUpdate) {
				const next = applyNativeTranscriptUpdate(
					nativeTranscriptRef.current,
					msg.transcriptUpdate,
				);
				if (!next) {
					if (!resyncPendingRef.current) {
						resyncPendingRef.current = true;
						wsClient.send({ type: "chat:reconnect", paneId });
					}
					return;
				}
				if (next === nativeTranscriptRef.current) return;
				nativeTranscriptRef.current = next;
				if (nativeFrameRef.current === null)
					nativeFrameRef.current = scheduleFrame(flushNativeTranscript);
			}
			if (msg.type === "chat:event") {
				if (
					msg.event?.type === "content_block_start" &&
					msg.event.content_block?.type === "tool_use"
				) {
					setRunStatus((prev) =>
						markToolState(msg.event.content_block.name, prev),
					);
				} else if (
					msg.event?.type === "content_block_delta" ||
					msg.event?.type === "assistant" ||
					msg.event?.type === "result"
				) {
					setRunStatus(markRespondingState);
				}
				if (msg.event?.session_id)
					setProviderSessionId(paneId, msg.event.session_id);
			} else if (msg.type === "chat:session") {
				if (msg.sessionId) setProviderSessionId(paneId, msg.sessionId);
			} else if (msg.type === "chat:done") {
				flushNativeTranscript();
				const updated = messageReadModel.settle(messageReadModel.get());
				messageReadModel.set(updated);
				const ids = new Set(updated.map((message) => message.id));
				setRunStatus({ isLoading: false, status: "idle", startTime: null });
				setChatUiState(clearCompletedChatUiState.bind(null, ids));
			} else if (
				msg.type === "chat:steer_pending" &&
				msg.message &&
				typeof msg.message.id === "string"
			) {
				stageSteeringMessage?.(msg.message as QueuedMessageInfo);
			} else if (msg.type === "chat:steered") {
				if (typeof msg.messageId === "string")
					resolveSteeringMessage?.(msg.messageId);
			} else if (msg.type === "chat:user_message") {
				setRunStatus((prev) => ({
					isLoading: true,
					status: "thinking",
					startTime: prev.startTime ?? Date.now(),
				}));
			} else if (msg.type === "chat:error") {
				if (msg.modelVersion !== 1)
					messageReadModel.set((prev) => appendSystemMessage(prev, msg.error));
				setRunStatus({ isLoading: false, status: "error", startTime: null });
			} else if (msg.type === "chat:system") {
				if (msg.modelVersion !== 1)
					messageReadModel.set((prev) =>
						appendSystemMessage(prev, msg.message),
					);
			} else if (msg.type === "chat:status") {
				setRunStatus((prev) => ({
					isLoading: msg.isLoading ?? prev.isLoading,
					status: msg.status ?? prev.status,
					startTime:
						msg.isLoading === false ? null : (prev.startTime ?? Date.now()),
				}));
			} else if (msg.type === "chat:sync" && msg.modelVersion === 1) {
				setRunStatus((prev) => ({
					isLoading: Boolean(msg.isStreaming),
					status: msg.isStreaming ? "responding" : "idle",
					startTime: msg.isStreaming ? (prev.startTime ?? Date.now()) : null,
				}));
				if (!msg.isStreaming) {
				}
			} else if (msg.type === "chat:queue" && Array.isArray(msg.queue)) {
				replaceQueuedMessages(msg.queue);
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
			resyncPendingRef.current = true;
			wsClient.send({
				type: "chat:reconnect",
				paneId,
				agentKind,
				cwd,
				sessionId: getProviderSessionId(paneId),
			});
		};
		reconnectChat();
		const cleanupReconnect = wsClient.onReconnect(reconnectChat);
		return () => {
			if (nativeFrameRef.current !== null) cancelFrame(nativeFrameRef.current);
			nativeFrameRef.current = null;
			cleanupReconnect();
			cleanup();
		};
	}, [
		checkpointReadModel,
		enabled,
		agentKind,
		cwd,
		messageReadModel,
		paneId,
		flushNativeTranscript,
		replaceQueuedMessages,
		resolveSteeringMessage,
		setChatUiState,
		setRunStatus,
		stageSteeringMessage,
	]);

	return {
		checkpoints,
		clearCheckpoints: checkpointReadModel.clear,
		revertCheckpoint,
	};
}
