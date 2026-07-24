import { expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
	ChatLoadingState,
	ChatMessage,
	ToolActivity,
} from "../src/features/chat/agent-chat-shared.ts";

type ChatActivityUiState = {
	expandedTools: Set<string>;
	liveActivities: ToolActivity[];
};

const subscribeCleanup = mock(() => {});
const reconnectCleanup = mock(() => {});
const subscribe = mock(
	(_paneId: string, _callback: (message: unknown) => void) => subscribeCleanup
);
const onReconnect = mock((_callback: () => void) => reconnectCleanup);
const send = mock(() => {});

mock.module("../src/lib/websocket.ts", () => ({
	wsClient: {
		onReconnect,
		send,
		subscribe,
	},
}));

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: dom.window,
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: dom.window.document,
	});
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: dom.window.localStorage,
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement) };
}

function tick() {
	return new Promise((resolve) => setTimeout(resolve, 20));
}

test("hidden chat views do not own websocket reconnects", async () => {
	subscribe.mockClear();
	subscribeCleanup.mockClear();
	onReconnect.mockClear();
	reconnectCleanup.mockClear();
	send.mockClear();
	const { root } = setupDom();
	const { useChatConnection } =
		await import("../src/components/chat/useChatConnection.ts");

	function Harness({ enabled }: { enabled: boolean }) {
		const [, setUiState] = useState<ChatActivityUiState>({
			expandedTools: new Set(),
			liveActivities: [],
		});
		const messageReadModel = useMemo(
			() => ({
				get: () => [],
				saveNow: (messages: ChatMessage[]) => messages,
				set: () => {},
			}),
			[]
		);
		useChatConnection({
			enabled,
			messageReadModel,
			paneId: "pane-hidden",
			replaceQueuedMessages: () => {},
			setChatUiState: setUiState,
			setRunStatus: () => {},
		});
		return null;
	}

	try {
		root.render(<Harness enabled={false} />);
		await tick();
		expect(subscribe).toHaveBeenCalledTimes(0);
		expect(onReconnect).toHaveBeenCalledTimes(0);
		expect(send).toHaveBeenCalledTimes(0);

		root.render(<Harness enabled />);
		await tick();
		expect(subscribe).toHaveBeenCalledTimes(1);
		expect(onReconnect).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith({
			type: "chat:reconnect",
			paneId: "pane-hidden",
		});

		root.render(<Harness enabled={false} />);
		await tick();
		expect(subscribeCleanup).toHaveBeenCalledTimes(1);
		expect(reconnectCleanup).toHaveBeenCalledTimes(1);
	} finally {
		root.unmount();
	}
});

test("live turn completion persists sync and reconnects after done", async () => {
	subscribe.mockClear();
	send.mockClear();
	const { root } = setupDom();
	const { useChatConnection } =
		await import("../src/components/chat/useChatConnection.ts");
	let handleMessage: ((message: unknown) => void) | undefined;
	let latestMessages: ChatMessage[] = [];
	subscribe.mockImplementationOnce((_paneId, callback) => {
		handleMessage = callback;
		return subscribeCleanup;
	});

	function Harness() {
		const [, setUiState] = useState<ChatActivityUiState>({
			expandedTools: new Set(),
			liveActivities: [],
		});
		const runStatusRef = useRef<ChatLoadingState>({
			isLoading: true,
			startTime: Date.now(),
			status: "responding",
		});
		const messagesRef = useRef<ChatMessage[]>([
			{ id: "m1", role: "user", content: "first" },
		]);
		latestMessages = messagesRef.current;
		const saveMessagesNow = useCallback(
			(messages: ChatMessage[]) => messages,
			[]
		);
		const setMessages = useCallback(
			(
				update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
			) => {
				messagesRef.current =
					typeof update === "function" ? update(messagesRef.current) : update;
				latestMessages = messagesRef.current;
			},
			[]
		);
		const messageReadModel = useMemo(
			() => ({
				get: () => messagesRef.current,
				saveNow: saveMessagesNow,
				set: setMessages,
			}),
			[saveMessagesNow, setMessages]
		);
		const setRunStatus = useCallback(
			(
				value: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState)
			) =>
				(runStatusRef.current =
					typeof value === "function" ? value(runStatusRef.current) : value),
			[]
		);
		useChatConnection({
			enabled: true,
			messageReadModel,
			paneId: "pane-drain-once",
			replaceQueuedMessages: () => {},
			setChatUiState: setUiState,
			setRunStatus,
		});
		return null;
	}

	try {
		root.render(<Harness />);
		await tick();
		handleMessage?.({
			type: "chat:sync",
			paneId: "pane-drain-once",
			messages: [{ id: "m1", role: "user", content: "first" }],
			isStreaming: true,
		});
		await tick();

		handleMessage?.({
			type: "chat:sync",
			paneId: "pane-drain-once",
			messages: [
				{ id: "m1", role: "user", content: "first" },
				{ id: "m2", role: "assistant", content: "done" },
			],
			isStreaming: false,
		});
		handleMessage?.({ type: "chat:done", paneId: "pane-drain-once" });
		await tick();

		expect(latestMessages).toEqual([
			{ id: "m1", role: "user", content: "first" },
			{ id: "m2", role: "assistant", content: "done" },
		]);
		expect(send).toHaveBeenCalledWith({
			type: "chat:reconnect",
			paneId: "pane-drain-once",
		});
	} finally {
		root.unmount();
	}
});

test("stale streaming sync does not cut local in-flight assistant content", async () => {
	subscribe.mockClear();
	send.mockClear();
	const { root } = setupDom();
	const { useChatConnection } =
		await import("../src/components/chat/useChatConnection.ts");
	let handleMessage: ((message: unknown) => void) | undefined;
	let latestMessages: ChatMessage[] = [];
	subscribe.mockImplementationOnce((_paneId, callback) => {
		handleMessage = callback;
		return subscribeCleanup;
	});

	function Harness() {
		const [, setUiState] = useState<ChatActivityUiState>({
			expandedTools: new Set(),
			liveActivities: [],
		});
		const runStatusRef = useRef<ChatLoadingState>({
			isLoading: true,
			startTime: Date.now(),
			status: "responding",
		});
		const messagesRef = useRef<ChatMessage[]>([
			{ id: "u1", role: "user", content: "prompt" },
		]);
		latestMessages = messagesRef.current;
		const saveMessagesNow = useCallback(
			(messages: ChatMessage[]) => messages,
			[]
		);
		const setMessages = useCallback(
			(
				update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])
			) => {
				messagesRef.current =
					typeof update === "function" ? update(messagesRef.current) : update;
				latestMessages = messagesRef.current;
			},
			[]
		);
		const messageReadModel = useMemo(
			() => ({
				get: () => messagesRef.current,
				saveNow: saveMessagesNow,
				set: setMessages,
			}),
			[saveMessagesNow, setMessages]
		);
		const setRunStatus = useCallback(
			(
				value: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState)
			) =>
				(runStatusRef.current =
					typeof value === "function" ? value(runStatusRef.current) : value),
			[]
		);
		useChatConnection({
			enabled: true,
			messageReadModel,
			paneId: "pane-stale-stream",
			replaceQueuedMessages: () => {},
			setChatUiState: setUiState,
			setRunStatus,
		});
		return null;
	}

	try {
		root.render(<Harness />);
		await tick();
		handleMessage?.({
			type: "chat:event",
			paneId: "pane-stale-stream",
			event: {
				type: "content_block_start",
				content_block: { type: "text", text: "newer " },
			},
		});
		handleMessage?.({
			type: "chat:event",
			paneId: "pane-stale-stream",
			event: {
				type: "content_block_delta",
				delta: { type: "text_delta", text: "local stream" },
			},
		});
		await tick();

		handleMessage?.({
			type: "chat:sync",
			paneId: "pane-stale-stream",
			messages: [
				{ id: "u1", role: "user", content: "prompt" },
				{
					id: "server-a1",
					role: "assistant",
					content: "older",
					isStreaming: true,
				},
			],
			revision: 4,
			isStreaming: true,
		});
		await tick();

		expect(latestMessages).toHaveLength(2);
		expect(latestMessages.at(-1)).toMatchObject({
			role: "assistant",
			content: "newer local stream",
			isStreaming: true,
		});
	} finally {
		root.unmount();
	}
});
