import { type Accessor, createEffect, createSignal, onSettled } from "solid-js";
import type { AskUserQuestion } from "../../../../../build/presentation/contracts/AskUserQuestion.ts";
import type { CheckpointMeta } from "../../../../../build/presentation/contracts/CheckpointMeta.ts";
import type { SkillProposal } from "../../../../../build/presentation/contracts/SkillProposal.ts";
import type { SkillRead } from "../../../../../build/presentation/contracts/SkillRead.ts";
import type { ToolDisplayInfo } from "../../../../../build/presentation/contracts/ToolDisplayInfo.ts";
import type { ToolOutputSummary } from "../../../../../build/presentation/contracts/ToolOutputSummary.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import {
	ChatReplica,
	clearAgentChatPaneState,
	project as rustProject,
	wsClient,
} from "../../../../shared/lib/native.tsx";
import { loadCanonicalAgentState } from "../../../workspace/hooks/useWorkspaceState.tsx";
import type { QueuedChatMessage } from "../../hooks/useAgentChatComposerState.tsx";
import type { CommandSystemMessage } from "../ChatMessageList/CommandSystemCard.tsx";
import type { GoalSystemMessage } from "../ChatMessageList/GoalSystemCard.tsx";
import type { ChatLoadingState } from "./index.tsx";

const DEFAULT_CHAT_RUN_STATUS: ChatLoadingState = {
	isLoading: false,
	status: "idle",
	startTime: null,
};
const STREAM_RENDER_INTERVAL_MS = 32;
export function useChatConnection(
	_options: Accessor<{
		enabled?: boolean;
		agentKind: WorkspaceAgentKind;
		cwd?: string;
		paneId: string;
		onExit?: () => void;
		replaceQueuedMessages: (messages: QueuedChatMessage[]) => void;
		resolveSteeringMessage?: (id: string) => void;
		stageSteeringMessage?: (message: QueuedChatMessage) => void;
	}>,
) {
	const [messages, setMessages] = createSignal<ChatMessage[]>([]);
	const [checkpoints, setCheckpoints] = createSignal<CheckpointMeta[]>([]);
	const [runStatus, setRunStatus] = createSignal(DEFAULT_CHAT_RUN_STATUS);
	const [expandedTools, setExpandedTools] = createSignal(
		(() => new Set<string>())(),
	);
	const replicaRef = {
		current: null,
	} as {
		current: ChatReplica | null;
	};
	if (!replicaRef.current) replicaRef.current = new ChatReplica();
	const nativeTranscriptRef = {
		current: null,
	} as {
		current: ChatMessage[] | null;
	};
	const nativeFrameRef = {
		current: null,
	} as {
		current: number | null;
	};
	const revertCheckpoint = (checkpointId: string) => {
		wsClient.send({
			type: "checkpoint:revert",
			paneId: _options().paneId,
			checkpointId,
		});
	};
	let nativeTranscriptShared = false;
	const flushNativeTranscript = () => {
		if (nativeFrameRef.current !== null)
			window.clearTimeout(nativeFrameRef.current);
		nativeFrameRef.current = null;
		const native = nativeTranscriptRef.current;
		if (!native) return;
		setMessages((current) => mergeNativeTranscript(current, native));
		nativeTranscriptShared = true;
	};
	const resetTranscript = () => {
		if (nativeFrameRef.current !== null)
			window.clearTimeout(nativeFrameRef.current);
		nativeFrameRef.current = null;
		nativeTranscriptRef.current = null;
		replicaRef.current!.clear();
		setMessages([]);
		setCheckpoints([]);
		setRunStatus(DEFAULT_CHAT_RUN_STATUS);
		setExpandedTools(new Set<string>());
	};
	const clearChatState = () => {
		resetTranscript();
		_options().replaceQueuedMessages([]);
	};
	onSettled(() => () => {
		if (nativeFrameRef.current !== null)
			window.clearTimeout(nativeFrameRef.current);
		replicaRef.current?.free();
		replicaRef.current = null;
	});
	let transcriptIdentity: string | undefined;
	createEffect(
		() => {
			const _optionsValue = _options();
			// Callback changes do not change the native chat subscription.
			return JSON.stringify([
				_optionsValue.enabled ?? true,
				_optionsValue.agentKind,
				_optionsValue.cwd,
				_optionsValue.paneId,
			]);
		},
		(key) => {
			const [enabled, agentKind, cwd, paneId] = JSON.parse(key) as [
				boolean,
				WorkspaceAgentKind,
				string | null,
				string,
			];
			const identity = JSON.stringify([agentKind, cwd, paneId]);
			if (transcriptIdentity !== undefined && transcriptIdentity !== identity)
				resetTranscript();
			transcriptIdentity = identity;
			if (!enabled) return;
			let subscribed = true;
			const cleanup = wsClient.subscribe(paneId, (rawMessage, serialized) => {
				const _optionsValue2 = _options();
				if (
					!subscribed ||
					!isChatServerMessage(rawMessage) ||
					rawMessage.paneId !== paneId
				)
					return;
				const msg = rawMessage;
				const update:
					| { kind: "none" | "ignore" | "resync"; reconnect?: boolean }
					| {
							kind: "sync" | "patch";
							start: number;
							deleteCount: number;
							messages: ChatMessage[];
					  } =
					msg.type === "chat:sync" || msg.transcriptUpdate
						? JSON.parse(replicaRef.current!.receive(serialized))
						: { kind: "none" };
				if (update.kind === "resync") {
					if (update.reconnect)
						wsClient.send({
							type: "chat:reconnect",
							paneId,
						});
					return;
				}
				if (update.kind === "ignore") return;
				if (update.kind === "sync" || update.kind === "patch") {
					const before = nativeTranscriptRef.current ?? [];
					const pending = nativeTranscriptShared ? before.slice() : before;
					pending.splice(update.start, update.deleteCount, ...update.messages);
					nativeTranscriptRef.current = pending;
					nativeTranscriptShared = false;
					if (update.kind === "sync") {
						for (const pending of msg.pendingSteers ?? [])
							if (typeof pending?.id === "string")
								_optionsValue2.stageSteeringMessage?.(pending);
						flushNativeTranscript();
					} else if (nativeFrameRef.current === null) {
						nativeFrameRef.current = window.setTimeout(
							flushNativeTranscript,
							STREAM_RENDER_INTERVAL_MS,
						);
					}
				}
				if (msg.type === "chat:summary" || msg.type === "chat:workspace")
					void loadCanonicalAgentState();
				if (msg.type === "chat:control") {
					if (msg.action === "cleared") {
						clearChatState();
						clearAgentChatPaneState(_optionsValue2.paneId);
						setMessages((messages) =>
							appendSystemMessage(messages, "Chat cleared"),
						);
					} else if (msg.action === "exit") _optionsValue2.onExit?.();
					return;
				}
				if (msg.runStatus) setRunStatus(msg.runStatus);
				if (Array.isArray(msg.checkpoints)) setCheckpoints(msg.checkpoints);
				if (msg.type === "chat:done") {
					flushNativeTranscript();
					setMessages((current) => {
						const updated = current.map((message) =>
							message.isStreaming
								? {
										...message,
										isStreaming: false,
									}
								: message,
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
					_optionsValue2.stageSteeringMessage?.(
						msg.message as QueuedChatMessage,
					);
				} else if (msg.type === "chat:steered") {
					if (typeof msg.messageId === "string")
						_optionsValue2.resolveSteeringMessage?.(msg.messageId);
				} else if (msg.type === "chat:error") {
					if (msg.modelVersion !== 1)
						setMessages((messages) =>
							appendSystemMessage(messages, String(msg.error ?? "Chat failed")),
						);
					if (!msg.runStatus)
						setRunStatus({
							isLoading: false,
							status: "error",
							startTime: null,
						});
				} else if (msg.type === "chat:queue" && Array.isArray(msg.queue)) {
					_optionsValue2.replaceQueuedMessages(msg.queue);
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
				if (!subscribed) return;
				replicaRef.current!.reconnect();
				wsClient.send({
					type: "chat:reconnect",
					paneId,
					agentKind,
					cwd: cwd ?? undefined,
				});
			};
			reconnectChat();
			const cleanupReconnect = wsClient.onReconnect(reconnectChat);
			return () => {
				subscribed = false;
				if (nativeFrameRef.current !== null)
					window.clearTimeout(nativeFrameRef.current);
				nativeFrameRef.current = null;
				cleanupReconnect();
				cleanup();
				wsClient.send({ type: "chat:unsubscribe", paneId });
			};
		},
	);
	return {
		get chatUiState() {
			return {
				...runStatus(),
				expandedTools: expandedTools(),
			};
		},
		get checkpoints() {
			return checkpoints();
		},
		get messages() {
			return messages();
		},
		get revertCheckpoint() {
			return revertCheckpoint;
		},
		get setMessages() {
			return setMessages;
		},
		get setExpandedTools() {
			return setExpandedTools;
		},
		get setRunStatus() {
			return setRunStatus;
		},
	};
}
export interface NativeChatRender {
	version: 1;
	kind: "message" | "edit-group" | "tool-group";
	groupEnd?: number;
	groupLeader?: boolean;
	hidden: boolean;
	continuesAfter?: boolean;
	rowId?: string;
	filePath?: string;
	edit?: {
		file_path: string;
		old_string: string;
		new_string: string;
	};
	outputStart?: number;
	display?: ToolDisplayInfo;
	summary?: ToolOutputSummary | null;
	questions?: AskUserQuestion[] | null;
	command?: CommandSystemMessage;
	goal?: GoalSystemMessage;
	skillProposal?: SkillProposal;
	skillRead?: SkillRead;
	skillParts?: Array<
		| {
				start: number;
				end: number;
		  }
		| {
				proposal: SkillProposal;
				index: number;
		  }
		| {
				pending: true;
		  }
	>;
}
export interface ChatMessage {
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
type ChatStateMessage = Pick<
	ChatMessage,
	"id" | "role" | "content" | "isStreaming" | "localOnly" | "render"
>;
export function appendSystemMessage(
	messages: ChatStateMessage[],
	content: string,
	render?: ChatMessage["render"],
): ChatStateMessage[] {
	const last = messages.at(-1);
	const notice = rustProject<ChatStateMessage | null>("systemNotice", {
		id: nextId(),
		content,
		render,
		previous: last
			? {
					role: last.role,
					isStreaming: last.isStreaming,
					content: last.role === "system" ? last.content : undefined,
				}
			: null,
	});
	return notice ? [...messages, notice] : messages;
}
export function mergeNativeTranscript(
	local: ChatMessage[],
	server: ChatMessage[],
): ChatMessage[] {
	// Native order is already authoritative unless browser-only entries must survive.
	// Avoid serializing the entire history across the WASM boundary on each token batch.
	if (
		!local.some(
			(message) =>
				(message.optimistic && message.role === "user") ||
				message.localOnly ||
				message.role === "btw",
		)
	)
		return server;
	const describe = (message: ChatMessage) => ({
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
