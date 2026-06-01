import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind } from "../../features/terminal/terminal-utils.ts";
import type { ChatMessage } from "../../features/chat/agent-chat-shared.ts";
import { trimMessages } from "../../features/chat/agent-chat-shared.ts";
import {
	loadStoredMessages,
	loadStoredSummary,
	loadFileBackedMessages,
	saveFileBackedMessages,
	saveStoredMessages,
	saveStoredSummary,
	upsertSessionLibraryEntry,
} from "../../features/chat/chat-session-store.ts";
import { flushPendingClientStorageSync } from "../../lib/client-storage-sync.ts";
import { hasRole, noop } from "../../lib/data.ts";
import { postJson } from "../../lib/fetch-json.ts";
import { dispatchTerminalShellChange } from "../../lib/terminal-shell-events.ts";

const MESSAGE_SAVE_INTERVAL_MS = 1000;

interface StoredChatWorkspace {
	cwd: string | null;
	referencePaths: string[];
}

interface UseStoredChatMessagesOptions {
	paneId: string;
	agentKind: AgentKind;
	model: string;
	reasoningLevel: string;
	getWorkspace: () => StoredChatWorkspace;
}

export function prepareMessagesForStorage(messages: ChatMessage[]) {
	return trimMessages(messages).map((message) =>
		message.isStreaming ? { ...message, isStreaming: false } : message
	);
}

function getLastSessionMessage(messages: ChatMessage[]): string | null {
	const message = [...messages]
		.reverse()
		.find((item) => item.role === "user" || item.role === "assistant");
	if (!message?.content) return null;
	const text = message.content.trim().replace(/\s+/g, " ");
	return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function messageStorageScore(messages: ChatMessage[]): number {
	return messages.reduce(
		(score, message) => score + 1 + (message.content?.length ?? 0),
		0
	);
}

export function useStoredChatMessages({
	paneId,
	agentKind,
	model,
	reasoningLevel,
	getWorkspace,
}: UseStoredChatMessagesOptions) {
	const [messages, setMessagesRaw] = useState<ChatMessage[]>(() =>
		loadStoredMessages<ChatMessage>(paneId).map((message) => ({
			...message,
			isStreaming: false,
		}))
	);
	const messagesRef = useRef(messages);
	messagesRef.current = messages;
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingMessageSaveRef = useRef<ChatMessage[] | null>(null);
	const summaryRef = useRef<string | null>(loadStoredSummary(paneId));
	const titleRequestedRef = useRef(false);

	const writeSessionSnapshot = useCallback(
		(storedMessages: ChatMessage[]) => {
			saveStoredMessages(paneId, storedMessages);
			saveFileBackedMessages(paneId, storedMessages);
			const workspace = getWorkspace();
			upsertSessionLibraryEntry(paneId, {
				agentKind,
				cwd: workspace.cwd,
				referencePaths: workspace.referencePaths,
				model,
				reasoningLevel,
				summary: summaryRef.current,
				lastMessage: getLastSessionMessage(storedMessages),
				messageCount: storedMessages.length,
			});
		},
		[agentKind, getWorkspace, model, paneId, reasoningLevel]
	);

	useEffect(() => {
		let cancelled = false;
		loadFileBackedMessages<ChatMessage>(paneId)
			.then((fileMessages) => {
				if (cancelled) return;
				if (fileMessages.length === 0) {
					const currentMessages = prepareMessagesForStorage(
						messagesRef.current
					);
					if (currentMessages.length > 0) {
						saveFileBackedMessages(paneId, currentMessages);
					}
					return;
				}
				setMessagesRaw((prev) => {
					const fileScore = messageStorageScore(fileMessages);
					const prevScore = messageStorageScore(prev);
					if (fileScore <= prevScore) {
						if (prevScore > fileScore) {
							saveFileBackedMessages(paneId, prepareMessagesForStorage(prev));
						}
						return prev;
					}
					const storedMessages = prepareMessagesForStorage(fileMessages);
					messagesRef.current = storedMessages;
					saveStoredMessages(paneId, storedMessages);
					return storedMessages;
				});
			})
			.catch(noop);
		return () => {
			cancelled = true;
		};
	}, [paneId]);

	const flushPendingMessageSave = useCallback(() => {
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
		if (pendingMessageSaveRef.current) {
			writeSessionSnapshot(pendingMessageSaveRef.current);
			pendingMessageSaveRef.current = null;
		}
	}, [writeSessionSnapshot]);

	const scheduleMessageSave = useCallback(
		(nextMessages: ChatMessage[]) => {
			const storedMessages = prepareMessagesForStorage(nextMessages);
			pendingMessageSaveRef.current = storedMessages;
			if (!summaryRef.current && !titleRequestedRef.current) {
				const firstUser = nextMessages.find(hasRole.bind(null, "user"));
				if (firstUser?.content) {
					titleRequestedRef.current = true;
					postJson<{ title?: string }>("/api/generate-title", {
						message: firstUser.content,
					})
						.then((data) => {
							const title = data?.title?.trim();
							if (title) {
								summaryRef.current = title;
								saveStoredSummary(paneId, title);
								dispatchTerminalShellChange({
									source: "local",
									reason: "chat-title",
								});
							}
						})
						.catch(noop);
				}
			}
			if (!nextMessages.some((message) => message.isStreaming)) {
				flushPendingMessageSave();
				return;
			}
			if (saveTimerRef.current) return;
			saveTimerRef.current = setTimeout(() => {
				flushPendingMessageSave();
			}, MESSAGE_SAVE_INTERVAL_MS);
		},
		[flushPendingMessageSave, paneId]
	);

	const setMessages = useCallback(
		(update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
			setMessagesRaw((prev) => {
				const next =
					typeof update === "function"
						? (update as (prev: ChatMessage[]) => ChatMessage[])(prev)
						: update;
				messagesRef.current = next;
				scheduleMessageSave(next);
				return next;
			});
		},
		[scheduleMessageSave]
	);

	useEffect(
		() => () => {
			flushPendingMessageSave();
		},
		[flushPendingMessageSave]
	);

	useEffect(() => {
		const flushCurrentMessages = () => {
			const storedMessages = prepareMessagesForStorage(messagesRef.current);
			writeSessionSnapshot(storedMessages);
			pendingMessageSaveRef.current = null;
			flushPendingClientStorageSync(true);
		};
		const flushWhenHidden = () => {
			if (document.visibilityState === "hidden") flushCurrentMessages();
		};
		window.addEventListener("beforeunload", flushCurrentMessages);
		window.addEventListener("pagehide", flushCurrentMessages);
		document.addEventListener("visibilitychange", flushWhenHidden);
		return () => {
			window.removeEventListener("beforeunload", flushCurrentMessages);
			window.removeEventListener("pagehide", flushCurrentMessages);
			document.removeEventListener("visibilitychange", flushWhenHidden);
		};
	}, [writeSessionSnapshot]);

	return {
		messages,
		setMessages,
		setMessagesRaw,
		messagesRef,
		summaryRef,
	};
}
