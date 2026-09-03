import { JSDOM } from "jsdom";
import { createRoot, useCallback, useMemo, useRef, useState } from "octane";
import { expect, test, vi } from "vitest";
import type {
	ChatLoadingState,
	ChatMessage,
	ToolActivity,
} from "../src/modules/conversation/agent-chat-shared.ts";

type ChatActivityUiState = {
	expandedTools: Set<string>;
	liveActivities: ToolActivity[];
};

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

const subscribeCleanup = mock(() => {});
const reconnectCleanup = mock(() => {});
const subscribe = mock(
	(_paneId: string, _callback: (message: unknown) => void) => subscribeCleanup,
);
const onReconnect = mock((_callback: () => void) => reconnectCleanup);
const send = mock(() => {});

mock.module("../src/adapters/backend/websocket.ts", () => ({
	getWebSocketStatus: () => "connected",
	subscribeWebSocketStatus: () => () => {},
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
	return new Promise((resolve) => setTimeout(resolve, 40));
}

test("hidden chat views do not own websocket reconnects", async () => {
	subscribe.mockClear();
	subscribeCleanup.mockClear();
	onReconnect.mockClear();
	reconnectCleanup.mockClear();
	send.mockClear();
	const { root } = setupDom();
	const { useChatConnection } = await import(
		"../src/modules/conversation/useChatConnection.tsx"
	);

	function Harness({ enabled }: { enabled: boolean }) {
		const [, setUiState] = useState<ChatActivityUiState>({
			expandedTools: new Set(),
			liveActivities: [],
		});
		const messageReadModel = useMemo(
			() => ({
				get: () => [],
				settle: (messages: ChatMessage[]) => messages,
				saveNow: (messages: ChatMessage[]) => messages,
				set: () => {},
			}),
			[],
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
			agentKind: undefined,
			cwd: undefined,
			sessionId: null,
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
	const { useChatConnection } = await import(
		"../src/modules/conversation/useChatConnection.tsx"
	);
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
			[],
		);
		const setMessages = useCallback(
			(
				update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[]),
			) => {
				messagesRef.current =
					typeof update === "function" ? update(messagesRef.current) : update;
				latestMessages = messagesRef.current;
			},
			[],
		);
		const messageReadModel = useMemo(
			() => ({
				get: () => messagesRef.current,
				settle: (messages: ChatMessage[]) => messages,
				saveNow: saveMessagesNow,
				set: setMessages,
			}),
			[saveMessagesNow, setMessages],
		);
		const setRunStatus = useCallback(
			(
				value:
					| ChatLoadingState
					| ((prev: ChatLoadingState) => ChatLoadingState),
			) =>
				(runStatusRef.current =
					typeof value === "function" ? value(runStatusRef.current) : value),
			[],
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
	const { useChatConnection } = await import(
		"../src/modules/conversation/useChatConnection.tsx"
	);
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
			[],
		);
		const setMessages = useCallback(
			(
				update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[]),
			) => {
				messagesRef.current =
					typeof update === "function" ? update(messagesRef.current) : update;
				latestMessages = messagesRef.current;
			},
			[],
		);
		const messageReadModel = useMemo(
			() => ({
				get: () => messagesRef.current,
				settle: (messages: ChatMessage[]) => messages,
				saveNow: saveMessagesNow,
				set: setMessages,
			}),
			[saveMessagesNow, setMessages],
		);
		const setRunStatus = useCallback(
			(
				value:
					| ChatLoadingState
					| ((prev: ChatLoadingState) => ChatLoadingState),
			) =>
				(runStatusRef.current =
					typeof value === "function" ? value(runStatusRef.current) : value),
			[],
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

test("active sync between blocks keeps result replay attached to its assistant", async () => {
	subscribe.mockClear();
	send.mockClear();
	const { root } = setupDom();
	const { useChatConnection } = await import(
		"../src/modules/conversation/useChatConnection.tsx"
	);
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
		const messagesRef = useRef<ChatMessage[]>([
			{ id: "u1", role: "user", content: "prompt" },
		]);
		latestMessages = messagesRef.current;
		const messageReadModel = useMemo(
			() => ({
				get: () => messagesRef.current,
				settle: (messages: ChatMessage[]) => messages,
				saveNow: (messages: ChatMessage[]) => messages,
				set: (
					update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[]),
				) => {
					messagesRef.current =
						typeof update === "function" ? update(messagesRef.current) : update;
					latestMessages = messagesRef.current;
				},
			}),
			[],
		);
		useChatConnection({
			enabled: true,
			messageReadModel,
			paneId: "pane-between-blocks",
			replaceQueuedMessages: () => {},
			setChatUiState: setUiState,
			setRunStatus: () => {},
		});
		return null;
	}

	try {
		root.render(<Harness />);
		await tick();
		handleMessage?.({
			type: "chat:event",
			paneId: "pane-between-blocks",
			event: {
				type: "content_block_start",
				content_block: { type: "text", text: "" },
			},
		});
		handleMessage?.({
			type: "chat:event",
			paneId: "pane-between-blocks",
			event: {
				type: "content_block_delta",
				delta: { type: "text_delta", text: "same progress" },
			},
		});
		handleMessage?.({
			type: "chat:event",
			paneId: "pane-between-blocks",
			event: { type: "content_block_stop" },
		});
		await tick();

		handleMessage?.({
			type: "chat:sync",
			paneId: "pane-between-blocks",
			messages: [
				{ id: "u1", role: "user", content: "prompt" },
				{ id: "server-a1", role: "assistant", content: "same progress" },
			],
			revision: 4,
			isStreaming: true,
		});
		handleMessage?.({
			type: "chat:event",
			paneId: "pane-between-blocks",
			event: { type: "result", result: "same progress" },
		});
		await tick();

		expect(latestMessages).toEqual([
			{ id: "u1", role: "user", content: "prompt" },
			{
				id: "server-a1",
				role: "assistant",
				content: "same progress",
				isStreaming: false,
			},
		]);
	} finally {
		root.unmount();
	}
});

test("accepted steering appears immediately without resetting the active assistant", async () => {
	subscribe.mockClear();
	const { root } = setupDom();
	const { useChatConnection } = await import(
		"../src/modules/conversation/useChatConnection.tsx"
	);
	let handleMessage: ((message: unknown) => void) | undefined;
	let latestMessages: ChatMessage[] = [];
	const stagedSteers: string[] = [];
	const resolvedSteers: string[] = [];
	subscribe.mockImplementationOnce((_paneId, callback) => {
		handleMessage = callback;
		return subscribeCleanup;
	});

	function Harness() {
		const [, setUiState] = useState<ChatActivityUiState>({
			expandedTools: new Set(),
			liveActivities: [],
		});
		const messagesRef = useRef<ChatMessage[]>([
			{ id: "u1", role: "user", content: "initial" },
			{
				id: "a1",
				role: "assistant",
				content: "working",
				isStreaming: true,
			},
		]);
		latestMessages = messagesRef.current;
		const messageReadModel = useMemo(
			() => ({
				get: () => messagesRef.current,
				settle: (messages: ChatMessage[]) => messages,
				saveNow: (messages: ChatMessage[]) => messages,
				set: (
					update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[]),
				) => {
					messagesRef.current =
						typeof update === "function" ? update(messagesRef.current) : update;
					latestMessages = messagesRef.current;
				},
			}),
			[],
		);
		useChatConnection({
			enabled: true,
			messageReadModel,
			paneId: "pane-steer",
			replaceQueuedMessages: () => {},
			stageSteeringMessage: (message) => stagedSteers.push(message.id),
			resolveSteeringMessage: (id) => resolvedSteers.push(id),
			setChatUiState: setUiState,
			setRunStatus: () => {},
		});
		return null;
	}

	try {
		root.render(<Harness />);
		await tick();
		handleMessage?.({
			type: "chat:steer_pending",
			paneId: "pane-steer",
			message: {
				id: "steer-1",
				text: "raw steering",
				displayText: "Change direction",
				transient: true,
			},
		});
		handleMessage?.({
			type: "chat:steered",
			paneId: "pane-steer",
			messageId: "steer-1",
			text: "raw steering",
			displayText: "Change direction",
			images: ["/tmp/reference.png"],
		});
		handleMessage?.({
			type: "chat:steered",
			paneId: "pane-steer",
			messageId: "steer-1",
			text: "raw steering",
			displayText: "Change direction",
			images: ["/tmp/reference.png"],
		});
		await tick();

		expect(stagedSteers).toEqual(["steer-1"]);
		expect(resolvedSteers).toEqual(["steer-1", "steer-1"]);
		expect(latestMessages).toHaveLength(3);
		expect(latestMessages[1]).toMatchObject({
			id: "a1",
			content: "working",
			isStreaming: true,
		});
		expect(latestMessages[2]).toMatchObject({
			id: "steer-1",
			role: "user",
			content: "Change direction",
			images: ["/tmp/reference.png"],
		});
	} finally {
		root.unmount();
	}
});
