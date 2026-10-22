import type {
	ChatEventPlan,
	ChatLoadingState,
	ChatTranscriptMessage,
	CheckpointMeta,
	WorkspaceAgentKind,
} from "@contracts";
import {
	ChatReplica,
	ChatSessionRetention,
	clearAgentChatPaneState,
	project as rustProject,
	traceUi,
	wsClient,
} from "@shared/lib/native.tsx";
import { loadCanonicalAgentState } from "@workspace/hooks/useWorkspaceState.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";
import type { QueuedChatMessage } from "../../hooks/useAgentChatComposerState.tsx";

export type ChatMessage = ChatTranscriptMessage & {
	optimistic?: boolean;
	localOnly?: boolean;
};

/** A published view and the positions changed since its preceding revision. */
export type ChatSnapshot = {
	messages: ChatMessage[];
	revision: number;
	change?: { start: number; end: number };
};

export function admittedTranscriptMessages(
	admission: Extract<
		import("@contracts").TranscriptAdmission,
		{ kind: "sync" | "patch" }
	>,
	before: ChatMessage[],
	event: {
		messages?: import("@contracts").ChatTranscriptMessage[];
		transcriptUpdate?: import("@contracts").ChatTranscriptUpdate;
	},
): ChatMessage[] {
	if (admission.kind === "sync") return event.messages!;
	return event.transcriptUpdate!.messages.map((change, index) =>
		change.appendContent === undefined
			? { ...change.message, content: change.message.content! }
			: {
					...change.message,
					content:
						before[admission.start + index]!.content + change.appendContent,
				},
	);
}

type RetainedChatSession = {
	paneId: string;
	replica: ChatReplica;
	messages: ChatMessage[];
	nativeTranscript: ChatMessage[] | null;
	checkpoints: CheckpointMeta[];
	runStatus: ChatLoadingState;
	expandedTools: Set<string>;
};
const retention = new ChatSessionRetention(16, 64 * 1024 * 1024);
const retainedSessions = new Map<string, RetainedChatSession>();
export const chatSessionCache = {
	take(identity: string) {
		const session = retainedSessions.get(identity);
		if (!session) return;
		retention.take(identity);
		retainedSessions.delete(identity);
		return session;
	},
	retain(identity: string, session: RetainedChatSession) {
		const previous = retainedSessions.get(identity);
		retainedSessions.delete(identity);
		if (previous && previous.replica !== session.replica)
			previous.replica.free();
		const size =
			session.messages.reduce(
				(sum, message) => sum + message.content.length * 4 + 1024,
				0,
			) +
			session.checkpoints.length * 1024;
		const [kept, evicted] = JSON.parse(
			retention.retain(identity, session.paneId, size),
		) as [boolean, string[]];
		if (kept) retainedSessions.set(identity, session);
		else session.replica.free();
		for (const key of evicted) retainedSessions.get(key)?.replica.free();
		for (const key of evicted) retainedSessions.delete(key);
	},
	setPaneIds(ids: Iterable<string>) {
		const evicted = JSON.parse(
			retention.set_pane_ids(JSON.stringify([...ids])),
		) as string[];
		for (const key of evicted) retainedSessions.get(key)?.replica.free();
		for (const key of evicted) retainedSessions.delete(key);
	},
};

const DEFAULT_CHAT_RUN_STATUS: ChatLoadingState = {
	isLoading: false,
	status: "idle",
	startTime: null,
};
export function useChatConnection(
	_options: Accessor<{
		enabled?: boolean;
		visible?: boolean;
		agentKind: WorkspaceAgentKind;
		cwd?: string;
		paneId: string;
		onExit?: () => void;
		replaceQueuedMessages: (messages: QueuedChatMessage[]) => void;
		resolveSteeringMessage?: (id: string) => void;
		stageSteeringMessage?: (message: QueuedChatMessage) => void;
	}>,
) {
	const initialIdentity = untrack(() =>
		JSON.stringify([
			_options().agentKind,
			_options().cwd ?? null,
			_options().paneId,
		]),
	);
	const retained = chatSessionCache.take(initialIdentity);
	const [transcriptReady, setTranscriptReady] = createSignal(
		retained?.nativeTranscript != null,
	);
	const [transcript, setTranscript] = createSignal<ChatSnapshot>({
		messages: retained?.messages ?? [],
		revision: 0,
	});
	const messages = () => transcript().messages;
	const setMessages = (
		update: ChatMessage[] | ((before: ChatMessage[]) => ChatMessage[]),
		change?: ChatSnapshot["change"],
	) =>
		setTranscript((before) => {
			const next =
				typeof update === "function" ? update(before.messages) : update;
			return next === before.messages
				? before
				: { messages: next, revision: before.revision + 1, change };
		});
	const [checkpoints, setCheckpoints] = createSignal<CheckpointMeta[]>(
		retained?.checkpoints ?? [],
	);
	const [runStatus, setRunStatus] = createSignal(
		retained?.runStatus ?? DEFAULT_CHAT_RUN_STATUS,
	);
	const [expandedTools, setExpandedTools] = createSignal(
		retained?.expandedTools ?? new Set<string>(),
	);
	let replica: ChatReplica | null = retained?.replica ?? new ChatReplica();
	let nativeTranscript: ChatMessage[] | null =
		retained?.nativeTranscript ?? null;
	let nativeFrame: number | null = null;
	const revertCheckpoint = (checkpointId: string) => {
		wsClient.send({
			type: "checkpoint:revert",
			paneId: _options().paneId,
			checkpointId,
		});
	};
	let nativeTranscriptShared = !!retained;
	let publishedNative = nativeTranscript;
	let changedStart = 0;
	let changedEnd = Infinity;
	const flushNativeTranscript = () => {
		if (nativeFrame !== null) window.cancelAnimationFrame(nativeFrame);
		nativeFrame = null;
		const native = nativeTranscript;
		if (!native || _options().visible === false) return;
		const current = messages();
		const direct = current === publishedNative;
		setMessages(
			direct ? native : mergeNativeTranscript(current, native, replica!),
			direct ? { start: changedStart, end: changedEnd } : undefined,
		);
		publishedNative = native;
		changedStart = Infinity;
		changedEnd = 0;
		nativeTranscriptShared = true;
	};
	createEffect(
		() => _options().visible !== false,
		(visible) => {
			if (visible) flushNativeTranscript();
		},
	);
	const resetTranscript = () => {
		if (nativeFrame !== null) window.cancelAnimationFrame(nativeFrame);
		nativeFrame = null;
		nativeTranscript = publishedNative = null;
		changedStart = 0;
		changedEnd = Infinity;
		setTranscriptReady(false);
		replica!.clear();
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
		if (nativeFrame !== null) window.cancelAnimationFrame(nativeFrame);
		if (replica) {
			const native = nativeTranscript;
			chatSessionCache.retain(transcriptIdentity, {
				paneId: JSON.parse(transcriptIdentity)[2] as string,
				replica: replica,
				messages: native
					? mergeNativeTranscript(messages(), native, replica)
					: messages(),
				nativeTranscript: native,
				checkpoints: checkpoints(),
				runStatus: runStatus(),
				expandedTools: expandedTools(),
			});
		}
		replica = null;
	});
	let transcriptIdentity = initialIdentity;
	const subscriptionKey = createMemo(() => {
		const _optionsValue = _options();
		// Solid 2 effects rerun on dependency changes even when their computed
		// value is equal. Memoize identity so workspace object replacement,
		// selection and callback changes cannot tear down this subscription.
		return JSON.stringify([
			_optionsValue.enabled ?? true,
			_optionsValue.agentKind,
			_optionsValue.cwd,
			_optionsValue.paneId,
		]);
	});
	createEffect(subscriptionKey, (key) => {
		const [enabled, agentKind, cwd, paneId] = JSON.parse(key) as [
			boolean,
			WorkspaceAgentKind,
			string | null,
			string,
		];
		const identity = JSON.stringify([agentKind, cwd, paneId]);
		if (transcriptIdentity !== identity) resetTranscript();
		transcriptIdentity = identity;
		if (!enabled) return;
		let subscribed = true;
		const cleanup = wsClient.subscribe(paneId, (rawMessage, serialized) => {
			if (!subscribed) return;
			const plan: ChatEventPlan | null = JSON.parse(
				replica!.receive(serialized, paneId, JSON.stringify(runStatus())),
			);
			if (!plan) return;
			const _optionsValue2 = _options();
			const msg = rawMessage as {
				messages?: import("@contracts").ChatTranscriptMessage[];
				transcriptUpdate?: import("@contracts").ChatTranscriptUpdate;
				pendingSteers?: QueuedChatMessage[];
				message?: QueuedChatMessage;
				queue?: QueuedChatMessage[];
				checkpoints?: CheckpointMeta[];
			};
			const update = plan.admission;
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
				const before = nativeTranscript ?? [];
				const inserted = admittedTranscriptMessages(update, before, msg);
				// Equal-length replacements preserve positions across coalesced patches.
				// Membership changes invalidate the whole range, including shifted rows.
				const replacement = inserted.length === update.deleteCount;
				changedStart = Math.min(changedStart, replacement ? update.start : 0);
				changedEnd = Math.max(
					changedEnd,
					replacement ? update.start + inserted.length : Infinity,
				);
				if (update.kind === "sync") {
					nativeTranscript = inserted;
				} else {
					const pending = nativeTranscriptShared ? before.slice() : before;
					pending.splice(update.start, update.deleteCount, ...inserted);
					nativeTranscript = pending;
				}
				nativeTranscriptShared = false;
				if (update.kind === "sync") {
					flushNativeTranscript();
				} else if (_optionsValue2.visible !== false && nativeFrame === null) {
					nativeFrame = window.requestAnimationFrame(flushNativeTranscript);
				}
			}
			if (plan.ready) {
				setTranscriptReady(true);
				traceUi("transcript-ready");
				for (const index of plan.pendingSteers)
					_optionsValue2.stageSteeringMessage?.(msg.pendingSteers![index]!);
			}
			if (plan.refreshWorkspace) void loadCanonicalAgentState();
			if (plan.control) {
				if (plan.control === "cleared") {
					clearChatState();
					clearAgentChatPaneState(_optionsValue2.paneId);
					setMessages((messages) =>
						appendSystemMessage(messages, "Chat cleared"),
					);
				} else _optionsValue2.onExit?.();
				return;
			}
			if (plan.status) setRunStatus(plan.status);
			if (plan.checkpoints) setCheckpoints(msg.checkpoints!);
			if (plan.finish) {
				flushNativeTranscript();
				// The native finalization patch already clears streaming flags.
				if (expandedTools().size) {
					const ids = new Set(messages().map((message) => message.id));
					setExpandedTools((previous) => {
						const next = new Set([...previous].filter((id) => ids.has(id)));
						return next.size === previous.size ? previous : next;
					});
				}
			}
			if (plan.stageSteer) _optionsValue2.stageSteeringMessage?.(msg.message!);
			if (plan.resolveSteer)
				_optionsValue2.resolveSteeringMessage?.(plan.resolveSteer);
			if (plan.queue) _optionsValue2.replaceQueuedMessages(msg.queue!);
			if (plan.notice)
				setMessages((messages) => appendSystemMessage(messages, plan.notice!));
		});
		const reconnectChat = () => {
			if (!subscribed) return;
			replica!.reconnect();
			wsClient.send({
				type: "chat:reconnect",
				paneId,
				...JSON.parse(replica!.cursor()),
				agentKind,
				cwd: cwd ?? undefined,
			});
		};
		reconnectChat();
		const cleanupReconnect = wsClient.onReconnect(reconnectChat);
		return () => {
			subscribed = false;
			if (nativeFrame !== null) window.cancelAnimationFrame(nativeFrame);
			nativeFrame = null;
			cleanupReconnect();
			cleanup();
			wsClient.send({ type: "chat:unsubscribe", paneId });
		};
	});
	const beginRun = () =>
		setRunStatus((current) =>
			rustProject<ChatLoadingState>("chatRunStatus", {
				current,
				begin: true,
				now: Date.now(),
			}),
		);
	const failSend = (error: unknown, messageId?: string) => {
		setRunStatus({ isLoading: false, status: "error", startTime: null });
		setMessages((messages) =>
			appendSystemMessage(
				messages.filter(
					(message) => !(message.id === messageId && message.optimistic),
				),
				error instanceof Error
					? error.message
					: "Message could not be sent. Please retry.",
			),
		);
	};
	const chatUiState = {
		get isLoading() {
			return runStatus().isLoading;
		},
		get status() {
			return runStatus().status;
		},
		get transcriptReady() {
			return transcriptReady();
		},
		get startTime() {
			return runStatus().startTime;
		},
		get expandedTools() {
			return expandedTools();
		},
	};
	return {
		beginRun,
		failSend,
		chatUiState,
		get checkpoints() {
			return checkpoints();
		},
		get messages() {
			return messages();
		},
		get transcript() {
			return transcript();
		},
		revertCheckpoint,
		setMessages,
		setExpandedTools,
		setRunStatus,
	};
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
function mergeNativeTranscript(
	local: ChatMessage[],
	server: ChatMessage[],
	replica: ChatReplica,
): ChatMessage[] {
	const browser = (message: ChatMessage) =>
		(message.optimistic && message.role === "user") ||
		message.localOnly ||
		message.role === "btw";
	if (!local.some(browser)) return server;
	const noticeRoles = new Set(
		local.filter((message) => message.localOnly).map((message) => message.role),
	);
	const insertions: Array<[number, number]> = JSON.parse(
		replica.merge(
			JSON.stringify(
				local.map((message) =>
					browser(message)
						? {
								id: message.id,
								role: message.role,
								optimistic: message.optimistic,
								localOnly: message.localOnly,
								content: message.localOnly ? message.content : undefined,
							}
						: message.id,
				),
			),
			JSON.stringify(
				server
					.filter((message) => noticeRoles.has(message.role))
					.map((message) => [message.role, message.content]),
			),
		),
	);
	if (!insertions.length) return server;
	const merged = server.slice();
	for (const [position, index] of insertions)
		merged.splice(position, 0, local[index]!);
	return merged;
}
