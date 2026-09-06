import {
	readStoredValue,
	removeStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import type { CheckpointInfo } from "./agent-chat-shared.ts";

const INPUT_KEY_PREFIX = "inferay-chat-input-";
const DEFAULT_CHAT_RUN_STATUS: ChatLoadingState = {
	isLoading: false,
	status: "idle",
	startTime: null,
};
export function loadStoredInput(paneId: string): string {
	return readStoredValue(INPUT_KEY_PREFIX + paneId, "") ?? "";
}
export function saveStoredInput(paneId: string, value: string) {
	if (value) writeStoredValue(INPUT_KEY_PREFIX + paneId, value);
	else removeStoredValue(INPUT_KEY_PREFIX + paneId);
}
export function clearAgentChatPaneState(paneId: string) {
	removeStoredValue(INPUT_KEY_PREFIX + paneId);
}

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import { postJson } from "../../../adapters/backend/http.ts";
import { getAgentIcon } from "../../agents/components/AgentIcon/index.tsx";
import {
	type WorkspaceModelAgentKind as AgentKind,
	changePaneAgentKind,
} from "../../workspace/model/workspace-model.ts";
export function useAgentChatSettings(paneId: string, agentKind: AgentKind) {
	const [selection, setSelection] = useState({ model: "", reasoningLevel: "" });
	const [configurationError, setConfigurationError] = useState<string | null>(
		null,
	);
	const requestRevision = useRef(0);
	const requests = useRef(Promise.resolve());
	const resolveSelection = useCallback(
		(patch: Partial<typeof selection> = {}) => {
			const revision = ++requestRevision.current;
			requests.current = requests.current.then(async () => {
				try {
					const resolved = await postJson<typeof selection>(
						"/api/native/provider-config",
						{ paneId, agentKind, ...patch },
					);
					if (revision !== requestRevision.current) return;
					setSelection(resolved);
					setConfigurationError(null);
				} catch (error) {
					if (revision === requestRevision.current)
						setConfigurationError(
							`Could not update chat settings: ${String(error)}`,
						);
				}
			});
		},
		[paneId, agentKind],
	);
	useEffect(() => {
		resolveSelection();
		return () => {
			requestRevision.current++;
		};
	}, [resolveSelection]);
	const agentKindOptions = useMemo(
		() =>
			(["claude", "codex"] as const).map((id) => ({
				id,
				label: id === "claude" ? "Claude" : "Codex",
				icon: getAgentIcon(id, 11),
			})),
		[],
	);
	return {
		configurationError,
		agentKindOptions,
		effectiveSelectedModel: selection.model,
		selectedReasoningLevel: selection.reasoningLevel,
		handleAgentKindChange: (kind: AgentKind) =>
			changePaneAgentKind(paneId, kind),
		handleModelChange: (model: string) => resolveSelection({ model }),
		handleReasoningLevelChange: (reasoningLevel: string) =>
			resolveSelection({ reasoningLevel }),
	};
}

import { listenWindowEvent } from "../../../shared/lib/data.ts";
import type { ChatVirtualizerControls } from "../components/ChatMessageList/index.tsx";
export function useChatViewport(
	input: string,
	isSelected?: boolean,
	isVisible = true,
) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const chatVirtualizerRef = useRef<ChatVirtualizerControls | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const highlightOverlayRef = useRef<HTMLDivElement | null>(null);
	const scrollSnapshotRef = useRef({ atBottom: true, fromBottom: 0, top: 0 });
	const restoreFrameRef = useRef(0);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setIsAtBottom(
			chatVirtualizerRef.current?.isAtEnd() ??
				el.scrollHeight - el.scrollTop - el.clientHeight < 48,
		);
	}, []);
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el) return;
		if (chatVirtualizerRef.current)
			chatVirtualizerRef.current.scrollToEnd(behavior);
		else el.scrollTo({ top: el.scrollHeight, behavior });
		setIsAtBottom(true);
	}, []);
	const scheduleScrollToBottom = useCallback(
		(behavior: ScrollBehavior = "auto") => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => scrollToBottom(behavior));
			});
		},
		[scrollToBottom],
	);
	const cancelScrollRestore = useCallback(() => {
		cancelAnimationFrame(restoreFrameRef.current);
		restoreFrameRef.current = 0;
	}, []);
	useLayoutEffect(() => {
		if (!isVisible) return;
		const snapshot = scrollSnapshotRef.current;
		let passes = 3;
		const restore = () => {
			const el = scrollRef.current;
			if (!el) return;
			const max = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = snapshot.atBottom
				? Math.max(0, max - snapshot.fromBottom)
				: Math.min(snapshot.top, max);
			setIsAtBottom(snapshot.atBottom);
			if (--passes) restoreFrameRef.current = requestAnimationFrame(restore);
		};
		restore();
		return () => {
			cancelScrollRestore();
			const el = scrollRef.current;
			if (!el) return;
			const fromBottom = Math.max(
				0,
				el.scrollHeight - el.scrollTop - el.clientHeight,
			);
			scrollSnapshotRef.current = {
				atBottom: fromBottom < 48,
				fromBottom,
				top: el.scrollTop,
			};
		};
	}, [cancelScrollRestore, isVisible]);
	useEffect(() => {
		if (!isVisible) return;
		const ta = textareaRef.current;
		if (!ta) return;
		if (!input) {
			ta.style.height = "20px";
		} else {
			ta.style.height = "20px";
			ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 20), 120)}px`;
		}
		if (highlightOverlayRef.current) {
			highlightOverlayRef.current.style.transform = `translateY(-${ta.scrollTop}px)`;
		}
	}, [input, isVisible]);
	const handleWindowKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key !== "ArrowDown") return;
			const active = document.activeElement;
			if (
				active &&
				(active.tagName === "TEXTAREA" || active.tagName === "INPUT")
			)
				return;
			if (!isAtBottom) {
				e.preventDefault();
				scrollToBottom();
			}
		},
		[isAtBottom, scrollToBottom],
	);
	useEffect(() => {
		if (!isSelected || !isVisible) return;
		return listenWindowEvent("keydown", handleWindowKeyDown);
	}, [handleWindowKeyDown, isSelected, isVisible]);
	return {
		chatVirtualizerRef,
		cancelScrollRestore,
		handleScroll,
		highlightOverlayRef,
		isAtBottom,
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	};
}
export function usePendingChatWorkspace(
	paneId: string,
	cwd: string | undefined,
	nativePaths: string[] | undefined,
) {
	const [pendingWorkspacePaths, setPendingWorkspacePaths] = useState(
		nativePaths ?? [],
	);
	useEffect(() => setPendingWorkspacePaths(nativePaths ?? []), [nativePaths]);
	const visibleCwd = cwd ?? pendingWorkspacePaths[0];
	const savePendingWorkspaceSelection = useCallback(
		(paths: string[]) => {
			const nextPaths = paths.filter(Boolean);
			setPendingWorkspacePaths(nextPaths);
			wsClient.send({ type: "chat:workspace", paneId, paths: nextPaths });
		},
		[paneId],
	);
	return {
		savePendingWorkspaceSelection,
		visibleCwd,
	};
}

import { loadCanonicalAgentState } from "../../workspace/model/workspace-model.ts";
export function useStableCallback<Args extends unknown[], Return>(
	callback: (...args: Args) => Return,
): (...args: Args) => Return {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;
	return useCallback((...args: Args) => callbackRef.current(...args), []);
}

import { wsClient } from "../../../adapters/backend/http.ts";
import type { AgentKind as UseChatConnectionAgentKind } from "../../agents/model/agents.ts";
import {
	appendSystemMessage,
	applyNativeTranscriptUpdate,
	type ChatLoadingState,
	type AgentChatSharedChatMessage as ChatMessage,
	isChatServerMessage,
	mergeNativeTranscript,
	type QueuedMessageInfo,
} from "./agent-chat-shared.ts";

// Rendering every protocol fragment makes words repeatedly reflow while the
// browser is still laying out the previous fragment. A short fixed cadence
// keeps first-token latency effectively unchanged while presenting coherent
// text chunks and cutting Markdown/layout work roughly in half.
const STREAM_RENDER_INTERVAL_MS = 32;
export function useChatConnection({
	enabled = true,
	agentKind,
	cwd,
	paneId,
	onExit,
	replaceQueuedMessages,
	resolveSteeringMessage,
	stageSteeringMessage,
}: {
	enabled?: boolean;
	agentKind: UseChatConnectionAgentKind;
	cwd?: string;
	paneId: string;
	onExit?: () => void;
	replaceQueuedMessages: (messages: QueuedMessageInfo[]) => void;
	resolveSteeringMessage?: (id: string) => void;
	stageSteeringMessage?: (message: QueuedMessageInfo) => void;
}) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
	const [runStatus, setRunStatus] = useState(DEFAULT_CHAT_RUN_STATUS);
	const [expandedTools, setExpandedTools] = useState(() => new Set<string>());
	const nativeTranscriptRef = useRef<{
		messages: ChatMessage[];
		revision: number;
		epoch?: string;
	} | null>(null);
	const nativeFrameRef = useRef<number | null>(null);
	const resyncPendingRef = useRef(false);
	const revertCheckpoint = useCallback(
		(checkpointId: string) => {
			wsClient.send({
				type: "checkpoint:revert",
				paneId,
				checkpointId,
			});
		},
		[paneId],
	);
	const flushNativeTranscript = useCallback(() => {
		if (nativeFrameRef.current !== null)
			window.clearTimeout(nativeFrameRef.current);
		nativeFrameRef.current = null;
		const native = nativeTranscriptRef.current;
		if (!native) return;
		setMessages((current) => mergeNativeTranscript(current, native.messages));
	}, [setMessages]);
	const clearChatState = useCallback(() => {
		if (nativeFrameRef.current !== null)
			window.clearTimeout(nativeFrameRef.current);
		nativeFrameRef.current = null;
		nativeTranscriptRef.current = null;
		resyncPendingRef.current = false;
		setMessages([]);
		setCheckpoints([]);
		setRunStatus(DEFAULT_CHAT_RUN_STATUS);
		setExpandedTools(new Set());
		replaceQueuedMessages([]);
	}, [replaceQueuedMessages]);
	useEffect(
		() => () => {
			if (nativeFrameRef.current !== null)
				window.clearTimeout(nativeFrameRef.current);
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
					wsClient.send({
						type: "chat:reconnect",
						paneId,
					});
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
				if (Array.isArray(msg.pendingSteers))
					for (const pending of msg.pendingSteers)
						if (pending && typeof pending.id === "string")
							stageSteeringMessage?.(pending as QueuedMessageInfo);
				flushNativeTranscript();
			} else if (msg.transcriptUpdate) {
				const next = applyNativeTranscriptUpdate(
					nativeTranscriptRef.current,
					msg.transcriptUpdate,
				);
				if (!next) {
					if (!resyncPendingRef.current) {
						resyncPendingRef.current = true;
						wsClient.send({
							type: "chat:reconnect",
							paneId,
						});
					}
					return;
				}
				if (next === nativeTranscriptRef.current) return;
				nativeTranscriptRef.current = next;
				if (nativeFrameRef.current === null)
					nativeFrameRef.current = window.setTimeout(
						flushNativeTranscript,
						STREAM_RENDER_INTERVAL_MS,
					);
			}
			if (msg.type === "chat:summary" || msg.type === "chat:workspace")
				void loadCanonicalAgentState();
			if (msg.type === "chat:control") {
				if (msg.action === "cleared") {
					clearChatState();
					clearAgentChatPaneState(paneId);
					setMessages((messages) =>
						appendSystemMessage(messages, "Chat cleared"),
					);
				} else if (msg.action === "exit") onExit?.();
				return;
			}
			if (msg.runStatus) setRunStatus(msg.runStatus);
			if (Array.isArray(msg.checkpoints)) setCheckpoints(msg.checkpoints);
			if (msg.type === "chat:done") {
				flushNativeTranscript();
				setMessages((current) => {
					const updated = current.map((message) =>
						message.isStreaming ? { ...message, isStreaming: false } : message,
					);
					const ids = new Set(updated.map((message) => message.id));
					setExpandedTools((previous) => {
						const next = new Set([...previous].filter((id) => ids.has(id)));
						return next.size === previous.size ? previous : next;
					});
					return updated;
				});
			} else if (
				msg.type === "chat:steer_pending" &&
				msg.message &&
				typeof msg.message.id === "string"
			) {
				stageSteeringMessage?.(msg.message as QueuedMessageInfo);
			} else if (msg.type === "chat:steered") {
				if (typeof msg.messageId === "string")
					resolveSteeringMessage?.(msg.messageId);
			} else if (msg.type === "chat:error") {
				if (msg.modelVersion !== 1)
					setMessages((messages) =>
						appendSystemMessage(messages, String(msg.error ?? "Chat failed")),
					);
				if (!msg.runStatus)
					setRunStatus({ isLoading: false, status: "error", startTime: null });
			} else if (msg.type === "chat:queue" && Array.isArray(msg.queue)) {
				replaceQueuedMessages(msg.queue);
			} else if (msg.type === "checkpoint:reverted") {
				setMessages((prev) =>
					appendSystemMessage(
						prev,
						`Reverted ${msg.restoredFiles?.length ?? 0} file(s) to checkpoint`,
					),
				);
			} else if (msg.type === "checkpoint:error") {
				setMessages((prev) =>
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
			});
		};
		reconnectChat();
		const cleanupReconnect = wsClient.onReconnect(reconnectChat);
		return () => {
			if (nativeFrameRef.current !== null)
				window.clearTimeout(nativeFrameRef.current);
			nativeFrameRef.current = null;
			cleanupReconnect();
			cleanup();
		};
	}, [
		enabled,
		agentKind,
		cwd,
		paneId,
		flushNativeTranscript,
		clearChatState,
		onExit,
		replaceQueuedMessages,
		resolveSteeringMessage,
		setExpandedTools,
		setRunStatus,
		stageSteeringMessage,
	]);
	return {
		chatUiState: { ...runStatus, expandedTools },
		checkpoints,
		messages,
		revertCheckpoint,
		setMessages,
		setExpandedTools,
		setRunStatus,
	};
}
