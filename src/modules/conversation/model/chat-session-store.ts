import { replaceEqualDeep } from "@tanstack/query-core";
import { sendJson } from "../../../adapters/backend/http.ts";
import {
	readStoredJson,
	readStoredValue,
	removeStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";
import { isString } from "../../../shared/lib/data.ts";
import type { CheckpointInfo } from "./agent-chat-shared.ts";

const INPUT_KEY_PREFIX = "inferay-chat-input-";
const CHECKPOINT_KEY_PREFIX = "inferay-checkpoints-";
const MODEL_KEY_PREFIX = "inferay-chat-model-";
const REASONING_KEY_PREFIX = "inferay-chat-reasoning-";
const SUMMARY_KEY_PREFIX = "inferay-chat-summary-";
const PENDING_WORKSPACE_KEY_PREFIX = "inferay-chat-pending-workspace-";
const DEFAULT_CHAT_RUN_STATUS: ChatLoadingState = {
	isLoading: false,
	status: "idle",
	startTime: null,
};
type ReadModelListener = () => void;
function subscriptions() {
	const listeners = new Set<ReadModelListener>();
	return {
		notify: () => {
			for (const listener of listeners) listener();
		},
		subscribe: (listener: ReadModelListener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
function perPane<T>(create: (paneId: string) => T) {
	const models = new Map<string, T>();
	const get = (paneId: string): T => {
		if (!models.has(paneId)) models.set(paneId, create(paneId));
		return models.get(paneId)!;
	};
	return Object.assign(get, {
		delete: (paneId: string) => models.delete(paneId),
		peek: (paneId: string) => models.get(paneId),
	});
}
function snapshot<T>(initial: T, equal = Object.is) {
	let value = initial;
	const events = subscriptions();
	const get = () => value;
	return {
		get,
		getSnapshot: get,
		subscribe: events.subscribe,
		set(update: T | ((previous: T) => T)) {
			const next =
				typeof update === "function"
					? (update as (previous: T) => T)(value)
					: update;
			if (!equal(value, next)) {
				value = next;
				events.notify();
			}
			return value;
		},
	};
}
function writePaneValue(prefix: string, paneId: string, value: string | null) {
	if (value) writeStoredValue(prefix + paneId, value);
	else removeStoredValue(prefix + paneId);
}
function createChatMessageReadModel() {
	return {
		...snapshot<ChatMessage[]>([]),
		settle: (messages: ChatMessage[]) =>
			messages.map((message) =>
				message.isStreaming ? { ...message, isStreaming: false } : message,
			),
	};
}
export const getChatMessageReadModel = perPane(createChatMessageReadModel);
export function loadStoredInput(paneId: string): string {
	return readStoredValue(INPUT_KEY_PREFIX + paneId, "") ?? "";
}
export function saveStoredInput(paneId: string, value: string) {
	writePaneValue(INPUT_KEY_PREFIX, paneId, value);
}
export const getChatCheckpointReadModel = perPane(() => {
	const model = snapshot<CheckpointInfo[]>([]);
	return { ...model, clear: () => model.set([]) };
});
export function loadStoredModel(paneId: string): string | null {
	return readStoredValue(MODEL_KEY_PREFIX + paneId);
}
export function saveStoredModel(paneId: string, modelId: string) {
	writePaneValue(MODEL_KEY_PREFIX, paneId, modelId);
}
export function loadStoredReasoningLevel(paneId: string): string | null {
	return readStoredValue(REASONING_KEY_PREFIX + paneId);
}
export function saveStoredReasoningLevel(
	paneId: string,
	reasoningLevel: string,
) {
	writePaneValue(REASONING_KEY_PREFIX, paneId, reasoningLevel);
}
export function loadPendingWorkspacePaths(paneId: string): string[] {
	const parsed = readStoredJson<unknown>(
		PENDING_WORKSPACE_KEY_PREFIX + paneId,
		[],
	);
	return Array.isArray(parsed) ? parsed.filter(isString) : [];
}
export function savePendingWorkspacePaths(paneId: string, paths: string[]) {
	if (paths.length === 0)
		removeStoredValue(PENDING_WORKSPACE_KEY_PREFIX + paneId);
	else writeStoredJson(PENDING_WORKSPACE_KEY_PREFIX + paneId, paths);
}
function createChatQueueReadModel(paneId: string) {
	let queue: QueuedMessageInfo[] = [];
	let revision = 0;
	const { notify, subscribe } = subscriptions();
	const setSnapshot = (next: QueuedMessageInfo[]) => {
		const shared = replaceEqualDeep(queue, next);
		if (queue === shared) return;
		revision++;
		queue = shared;
		notify();
	};
	let mutationChain = Promise.resolve();
	const mutate = (action: "edit" | "remove", id: string, text?: string) => {
		const result = mutationChain
			.catch(() => undefined)
			.then(async () => {
				const before = ++revision;
				const response = await sendJson(
					`/api/chat-queues/${encodeURIComponent(paneId)}`,
					{ action, id, text },
					{ method: "PATCH" },
				);
				if (!response.ok)
					throw new Error("Could not update queued message. Please retry.");
				const payload = (await response.json()) as {
					queue: QueuedMessageInfo[];
				};
				if (revision === before)
					setSnapshot([
						...payload.queue,
						...queue.filter((item) => item.transient),
					]);
			});
		mutationChain = result;
		return result;
	};
	return {
		get: () => queue,
		getSnapshot: () => queue,
		replaceFromServer: (messages: QueuedMessageInfo[]) => {
			// Even unchanged authoritative content supersedes an older HTTP response.
			revision++;
			setSnapshot(messages);
		},
		mutate,
		subscribe,
	};
}
export const getChatQueueReadModel = perPane(createChatQueueReadModel);
function createChatRunStatusReadModel() {
	const model = snapshot(
		DEFAULT_CHAT_RUN_STATUS,
		(previous: ChatLoadingState, next: ChatLoadingState) =>
			previous.isLoading === next.isLoading &&
			previous.status === next.status &&
			previous.startTime === next.startTime,
	);
	return {
		...model,
		clear: () => model.set(DEFAULT_CHAT_RUN_STATUS),
	};
}
export const getChatRunStatusReadModel = perPane(createChatRunStatusReadModel);
export function clearAgentChatPaneState(paneId: string) {
	getChatMessageReadModel.delete(paneId);
	getChatCheckpointReadModel.delete(paneId);
	getChatQueueReadModel.delete(paneId);
	getChatRunStatusReadModel.peek(paneId)?.clear();
	getChatRunStatusReadModel.delete(paneId);
	for (const prefix of [
		INPUT_KEY_PREFIX,
		CHECKPOINT_KEY_PREFIX,
		SUMMARY_KEY_PREFIX,
		PENDING_WORKSPACE_KEY_PREFIX,
	]) {
		removeStoredValue(prefix + paneId);
	}
}

import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { getAgentIcon } from "../../agents/components/AgentIcon/index.tsx";
import {
	loadDefaultChatSettings,
	resolveChatSettings,
} from "../../agents/model/agents.ts";
import {
	type WorkspaceModelAgentKind as AgentKind,
	changePaneAgentKind,
} from "../../workspace/model/workspace-model.ts";
export function useAgentChatSettings(paneId: string, agentKind: AgentKind) {
	const [selection, setSelection] = useState(() => ({
		model: loadStoredModel(paneId) ?? "",
		reasoningLevel: loadStoredReasoningLevel(paneId) ?? "",
	}));
	const pendingSelection = useRef<{
		model: string | null;
		reasoningLevel: string | null;
	}>(selection);
	const [configurationError, setConfigurationError] = useState<string | null>(
		null,
	);
	const requestRevision = useRef(0);
	const resolveSelection = useCallback(
		async (
			kind: AgentKind,
			model: string | null,
			reasoningLevel: string | null,
		) => {
			const revision = ++requestRevision.current;
			pendingSelection.current = {
				model,
				reasoningLevel,
			};
			try {
				const resolved = await resolveChatSettings({
					agentKind: kind,
					model,
					reasoningLevel,
					defaults: loadDefaultChatSettings(),
				});
				if (revision !== requestRevision.current) return;
				setSelection(resolved);
				pendingSelection.current = resolved;
				saveStoredModel(paneId, resolved.model);
				saveStoredReasoningLevel(paneId, resolved.reasoningLevel);
				setConfigurationError(null);
			} catch (error) {
				if (revision === requestRevision.current)
					setConfigurationError(
						`Could not update chat settings: ${error instanceof Error ? error.message : String(error)}`,
					);
			}
		},
		[paneId],
	);
	useEffect(() => {
		void resolveSelection(
			agentKind,
			loadStoredModel(paneId),
			loadStoredReasoningLevel(paneId),
		);
		return () => {
			requestRevision.current++;
		};
	}, [agentKind, paneId, resolveSelection]);
	const agentKindOptions = useMemo(
		() => [
			{
				id: "claude" as const,
				label: "Claude",
				icon: getAgentIcon("claude", 11),
			},
			{
				id: "codex" as const,
				label: "Codex",
				icon: getAgentIcon("codex", 11),
			},
		],
		[],
	);
	return {
		configurationError,
		agentKindOptions,
		effectiveSelectedModel: selection.model,
		selectedReasoningLevel: selection.reasoningLevel,
		handleAgentKindChange: (kind: AgentKind) => {
			changePaneAgentKind(paneId, kind);
		},
		handleModelChange: (model: string) => {
			void resolveSelection(
				agentKind,
				model,
				pendingSelection.current.reasoningLevel,
			);
		},
		handleReasoningLevelChange: (reasoning: string) => {
			void resolveSelection(
				agentKind,
				pendingSelection.current.model,
				reasoning,
			);
		},
	};
}

import { useSyncExternalStore } from "octane";
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
	const [expandedTools, setExpandedTools] = useState(() => new Set<string>());
	const chatUiState = useMemo(
		() => ({ ...runStatus, expandedTools }),
		[expandedTools, runStatus],
	);
	return {
		chatUiState,
		setExpandedTools,
		setRunStatus: runStatusReadModel.set,
	};
}

import { useLayoutEffect } from "octane";
import { listenWindowEvent } from "../../../shared/lib/data.ts";
import type { ChatVirtualizerControls } from "../components/ChatMessageList/index.tsx";
export function useChatViewport(
	input: string,
	isSelected?: boolean,
	isVisible = true,
) {
	type ScrollSnapshot = {
		atBottom: boolean;
		fromBottom: number;
		top: number;
	};
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const chatVirtualizerRef = useRef<ChatVirtualizerControls | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const highlightOverlayRef = useRef<HTMLDivElement | null>(null);
	const wasSelectedRef = useRef(isSelected);
	const activationRestoreFrameRef = useRef(0);
	const scrollSnapshotRef = useRef<ScrollSnapshot>({
		atBottom: true,
		fromBottom: 0,
		top: 0,
	});
	const [isAtBottom, setIsAtBottom] = useState(true);
	const captureScrollSnapshot = useCallback(() => {
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
	}, []);
	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const nextIsAtBottom =
			chatVirtualizerRef.current?.isAtEnd() ??
			el.scrollHeight - el.scrollTop - el.clientHeight < 48;
		setIsAtBottom(nextIsAtBottom);
		if (!isSelected) captureScrollSnapshot();
	}, [captureScrollSnapshot, isSelected]);
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el) return;
		if (chatVirtualizerRef.current) {
			chatVirtualizerRef.current.scrollToEnd(behavior);
		} else {
			el.scrollTo({
				top: el.scrollHeight,
				behavior,
			});
		}
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
	useLayoutEffect(() => {
		const wasSelected = wasSelectedRef.current;
		wasSelectedRef.current = isSelected;
		if (wasSelected && !isSelected) {
			captureScrollSnapshot();
			return;
		}
		if (wasSelected || !isSelected || !isVisible) return;
		const el = scrollRef.current;
		if (!el) return;
		const snapshot = scrollSnapshotRef.current;
		let passes = 6;
		const restoreViewport = () => {
			const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = snapshot.atBottom
				? Math.max(0, maxScrollTop - snapshot.fromBottom)
				: Math.min(snapshot.top, maxScrollTop);
			setIsAtBottom(snapshot.atBottom);
			passes -= 1;
			if (passes > 0) {
				activationRestoreFrameRef.current =
					requestAnimationFrame(restoreViewport);
			} else {
				activationRestoreFrameRef.current = 0;
			}
		};
		restoreViewport();
		return () => {
			if (activationRestoreFrameRef.current) {
				cancelAnimationFrame(activationRestoreFrameRef.current);
				activationRestoreFrameRef.current = 0;
			}
		};
	}, [captureScrollSnapshot, isSelected, isVisible]);
	const cancelActivationRestore = useCallback(() => {
		if (!activationRestoreFrameRef.current) return;
		cancelAnimationFrame(activationRestoreFrameRef.current);
		activationRestoreFrameRef.current = 0;
	}, []);
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
		handleScroll,
		highlightOverlayRef,
		isAtBottom,
		cancelActivationRestore,
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	};
}
export function usePendingChatWorkspace(
	paneId: string,
	cwd: string | undefined,
	onDirectoryChange:
		| ((paneId: string, cwd: string, referencePaths?: string[]) => void)
		| undefined,
) {
	const pendingWorkspacePathsRef = useRef<string[]>([]);
	const [pendingWorkspacePaths, setPendingWorkspacePaths] = useState(() =>
		loadPendingWorkspacePaths(paneId).filter(Boolean),
	);
	const visibleCwd = cwd ?? pendingWorkspacePaths[0];
	const savePendingWorkspaceSelection = useCallback(
		(paths: string[]) => {
			const nextPaths = paths.filter(Boolean);
			pendingWorkspacePathsRef.current = nextPaths;
			setPendingWorkspacePaths(nextPaths);
			savePendingWorkspacePaths(paneId, nextPaths);
		},
		[paneId],
	);
	const consumePendingWorkspace = useCallback(() => {
		const paths = (
			pendingWorkspacePathsRef.current.length > 0
				? pendingWorkspacePathsRef.current
				: loadPendingWorkspacePaths(paneId)
		).filter(Boolean);
		if (cwd || !paths[0]) return;
		const selectedWorkspace = { cwd: paths[0], referencePaths: paths.slice(1) };
		onDirectoryChange?.(
			paneId,
			selectedWorkspace.cwd,
			selectedWorkspace.referencePaths,
		);
		savePendingWorkspaceSelection([]);
		return selectedWorkspace;
	}, [savePendingWorkspaceSelection, cwd, onDirectoryChange, paneId]);

	return {
		consumePendingWorkspace,
		savePendingWorkspaceSelection,
		visibleCwd,
	};
}

import { loadCanonicalAgentState } from "../../workspace/model/workspace-model.ts";
export function usePersistentChatMessages(paneId: string) {
	const messageReadModel = useMemo(
		() => getChatMessageReadModel(paneId),
		[paneId],
	);
	const messages = useSyncExternalStore(
		messageReadModel.subscribe,
		messageReadModel.getSnapshot,
		messageReadModel.getSnapshot,
	);
	return {
		messageReadModel,
		messages,
		setMessages: messageReadModel.set,
	};
}
export function useStableCallback<Args extends unknown[], Return>(
	callback: (...args: Args) => Return,
): (...args: Args) => Return {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;
	return useCallback((...args: Args) => callbackRef.current(...args), []);
}

import type { Dispatch, SetStateAction } from "react";
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
	messageReadModel,
	paneId,
	replaceQueuedMessages,
	resolveSteeringMessage,
	stageSteeringMessage,
	setExpandedTools,
	setRunStatus,
}: {
	enabled?: boolean;
	agentKind: UseChatConnectionAgentKind;
	cwd?: string;
	messageReadModel: ReturnType<typeof getChatMessageReadModel>;
	paneId: string;
	replaceQueuedMessages: (messages: QueuedMessageInfo[]) => void;
	resolveSteeringMessage?: (id: string) => void;
	stageSteeringMessage?: (message: QueuedMessageInfo) => void;
	setExpandedTools: Dispatch<SetStateAction<Set<string>>>;
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
		messageReadModel.set((current) =>
			mergeNativeTranscript(current, native.messages),
		);
	}, [messageReadModel]);
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
			if (msg.type === "chat:summary") void loadCanonicalAgentState();
			if (msg.runStatus) setRunStatus(msg.runStatus);
			if (Array.isArray(msg.checkpoints))
				checkpointReadModel.set(msg.checkpoints);
			if (msg.type === "chat:done") {
				flushNativeTranscript();
				const updated = messageReadModel.settle(messageReadModel.get());
				messageReadModel.set(updated);
				const ids = new Set(updated.map((message) => message.id));
				setExpandedTools((previous) => {
					const next = new Set([...previous].filter((id) => ids.has(id)));
					return next.size === previous.size ? previous : next;
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
					messageReadModel.set((prev) => appendSystemMessage(prev, msg.error));
				if (!msg.runStatus)
					setRunStatus({ isLoading: false, status: "error", startTime: null });
			} else if (msg.type === "chat:system") {
				if (msg.modelVersion !== 1)
					messageReadModel.set((prev) =>
						appendSystemMessage(prev, msg.message),
					);
			} else if (msg.type === "chat:queue" && Array.isArray(msg.queue)) {
				replaceQueuedMessages(msg.queue);
			} else if (msg.type === "checkpoint:reverted") {
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
		checkpointReadModel,
		enabled,
		agentKind,
		cwd,
		messageReadModel,
		paneId,
		flushNativeTranscript,
		replaceQueuedMessages,
		resolveSteeringMessage,
		setExpandedTools,
		setRunStatus,
		stageSteeringMessage,
	]);
	return {
		checkpoints,
		clearCheckpoints: checkpointReadModel.clear,
		revertCheckpoint,
	};
}
