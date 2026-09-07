import { useCallback, useEffect, useRef, useState } from "octane";
import type { AskUserQuestion } from "../../../../../build/presentation/contracts/AskUserQuestion.ts";
import type { CheckpointMeta } from "../../../../../build/presentation/contracts/CheckpointMeta.ts";
import type { SkillProposal } from "../../../../../build/presentation/contracts/SkillProposal.ts";
import type { SkillRead } from "../../../../../build/presentation/contracts/SkillRead.ts";
import type { ToolDisplayInfo } from "../../../../../build/presentation/contracts/ToolDisplayInfo.ts";
import type { ToolOutputSummary } from "../../../../../build/presentation/contracts/ToolOutputSummary.ts";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import { wsClient } from "../../../../adapters/backend/http.ts";
import {
	ChatReplica,
	project as rustProject,
} from "../../../../adapters/presentation/model.ts";
import { clearAgentChatPaneState } from "../../../../adapters/storage/stored-values.ts";
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
	agentKind: WorkspaceAgentKind;
	cwd?: string;
	paneId: string;
	onExit?: () => void;
	replaceQueuedMessages: (messages: QueuedChatMessage[]) => void;
	resolveSteeringMessage?: (id: string) => void;
	stageSteeringMessage?: (message: QueuedChatMessage) => void;
}) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([]);
	const [runStatus, setRunStatus] = useState(DEFAULT_CHAT_RUN_STATUS);
	const [expandedTools, setExpandedTools] = useState(() => new Set<string>());
	const replicaRef = useRef<ChatReplica | null>(null);
	if (!replicaRef.current) replicaRef.current = new ChatReplica();
	const nativeTranscriptRef = useRef<ChatMessage[] | null>(null);
	const nativeFrameRef = useRef<number | null>(null);
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
		setMessages((current) => mergeNativeTranscript(current, native));
	}, [setMessages]);
	const clearChatState = useCallback(() => {
		if (nativeFrameRef.current !== null)
			window.clearTimeout(nativeFrameRef.current);
		nativeFrameRef.current = null;
		nativeTranscriptRef.current = null;
		replicaRef.current!.clear();
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
			replicaRef.current?.free();
			replicaRef.current = null;
		},
		[],
	);

	useEffect(() => {
		if (!enabled) return;
		const cleanup = wsClient.subscribe(paneId, (rawMessage) => {
			if (!isChatServerMessage(rawMessage)) return;
			const msg = rawMessage;
			const update = JSON.parse(
				replicaRef.current!.receive(JSON.stringify(msg)),
			) as {
				kind: "none" | "ignore" | "resync" | "sync" | "patch";
				reconnect?: boolean;
				start: number;
				deleteCount: number;
				messages: ChatMessage[];
			};
			if (update.kind === "resync") {
				if (update.reconnect) wsClient.send({ type: "chat:reconnect", paneId });
				return;
			}
			if (update.kind === "ignore") return;
			if (update.kind === "sync" || update.kind === "patch") {
				const before = nativeTranscriptRef.current ?? [];
				nativeTranscriptRef.current = [
					...before.slice(0, update.start),
					...update.messages,
					...before.slice(update.start + update.deleteCount),
				];
				if (update.kind === "sync") {
					for (const pending of msg.pendingSteers ?? [])
						if (typeof pending?.id === "string")
							stageSteeringMessage?.(pending);
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
				stageSteeringMessage?.(msg.message as QueuedChatMessage);
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
			replicaRef.current!.reconnect();
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

export interface NativeChatRender {
	version: 1;
	kind: "message" | "edit-group" | "tool-group";
	groupEnd?: number;
	groupLeader?: boolean;
	hidden: boolean;
	continuesAfter?: boolean;
	rowId?: string;
	filePath?: string;
	edit?: { file_path: string; old_string: string; new_string: string };
	trailingOutput?: string;
	display?: ToolDisplayInfo;
	summary?: ToolOutputSummary | null;
	questions?: AskUserQuestion[] | null;
	command?: CommandSystemMessage;
	goal?: GoalSystemMessage;
	skillProposal?: SkillProposal;
	skillRead?: SkillRead;
	skillParts?: Array<
		| { start: number; end: number }
		| { proposal: SkillProposal; index: number }
		| { pending: true }
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
const LOCAL_RENDER_LIMIT = 256_000;
export function localChatContent(content: string) {
	return content.length <= LOCAL_RENDER_LIMIT
		? content
		: `${content.slice(0, LOCAL_RENDER_LIMIT)}\n\n[… pending message truncated for display …]`;
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
	content = localChatContent(content);
	const previous = messages.at(-1);
	if (
		content &&
		previous?.role === "system" &&
		!previous.isStreaming &&
		previous.content === content
	)
		return messages;
	return [
		...messages,
		{
			id: nextId(),
			role: "system" as const,
			content,
			localOnly: true,
			...(render
				? {
						render,
					}
				: {}),
		},
	];
}
export function mergeNativeTranscript(
	local: ChatMessage[],
	server: ChatMessage[],
): ChatMessage[] {
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
