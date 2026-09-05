import { JSDOM } from "jsdom";
import { createRoot, useMemo, useState } from "octane";
import { expect, test, vi } from "vitest";
import type {
	ChatLoadingState,
	ChatMessage,
} from "../src/modules/conversation/model/agent-chat-shared.ts";

type ChatActivityUiState = {
	expandedTools: Set<string>;
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
		"../src/modules/conversation/hooks/useChatConnection.ts"
	);

	function Harness({ enabled }: { enabled: boolean }) {
		const [, setUiState] = useState<ChatActivityUiState>({
			expandedTools: new Set(),
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

async function mountNativeChat(paneId: string, initial: ChatMessage[] = []) {
	subscribe.mockClear();
	send.mockClear();
	const { root } = setupDom();
	const { useChatConnection } = await import(
		"../src/modules/conversation/hooks/useChatConnection.ts"
	);
	let receive: (message: unknown) => void = () => {};
	let messages = initial;
	const staged: string[] = [];
	const resolved: string[] = [];
	const model = {
		get: () => messages,
		settle: (value: ChatMessage[]) => value,
		set: (
			update: ChatMessage[] | ((value: ChatMessage[]) => ChatMessage[]),
		) => {
			messages = typeof update === "function" ? update(messages) : update;
		},
	};
	subscribe.mockImplementationOnce((_paneId, callback) => {
		receive = callback;
		return subscribeCleanup;
	});
	const replaceQueuedMessages = () => {};
	let status: ChatLoadingState = {
		isLoading: false,
		status: "idle",
		startTime: null,
	};
	const setRunStatus = (
		update:
			| ChatLoadingState
			| ((previous: ChatLoadingState) => ChatLoadingState),
	) => {
		status = typeof update === "function" ? update(status) : update;
	};
	const stageSteeringMessage = (message: { id: string }) =>
		staged.push(message.id);
	const resolveSteeringMessage = (id: string) => resolved.push(id);
	function Harness() {
		const [, setChatUiState] = useState<ChatActivityUiState>({
			expandedTools: new Set(),
		});
		useChatConnection({
			paneId,
			agentKind: "claude",
			messageReadModel: model,
			replaceQueuedMessages,
			setRunStatus,
			setChatUiState,
			stageSteeringMessage,
			resolveSteeringMessage,
		});
		return null;
	}
	root.render(<Harness />);
	await tick();
	return {
		root,
		staged,
		resolved,
		get: () => messages,
		getStatus: () => status,
		receive: (message: Record<string, unknown>) =>
			receive({ paneId, modelVersion: 1, ...message }),
	};
}

test("native transcript deltas keep stable IDs and finish without a redundant reconnect", async () => {
	const chat = await mountNativeChat("native-turn", [
		{ id: "local", role: "user", content: "hello" },
	]);
	try {
		chat.receive({
			type: "chat:sync",
			revision: 1,
			isStreaming: true,
			messages: [{ id: "u1", role: "user", content: "hello" }],
		});
		chat.receive({
			type: "chat:event",
			event: {
				type: "content_block_start",
				content_block: {
					type: "text",
					text: "duplicate provider representation",
				},
			},
			transcriptUpdate: {
				version: 1,
				baseRevision: 1,
				revision: 2,
				reset: false,
				start: 1,
				deleteCount: 0,
				messages: [
					{
						message: {
							id: "a1",
							role: "assistant",
							content: "draft",
							isStreaming: true,
						},
					},
				],
			},
		});
		chat.receive({
			type: "chat:model",
			transcriptUpdate: {
				version: 1,
				baseRevision: 2,
				revision: 3,
				reset: false,
				start: 1,
				deleteCount: 1,
				messages: [
					{
						message: { id: "a1", role: "assistant", isStreaming: true },
						appendContent: " more",
					},
				],
			},
		});
		await tick();
		expect(chat.get().at(-1)).toMatchObject({
			id: "a1",
			content: "draft more",
		});
		chat.receive({
			type: "chat:done",
			transcriptUpdate: {
				version: 1,
				baseRevision: 1,
				revision: 2,
				reset: false,
				start: 1,
				deleteCount: 0,
				messages: [],
			},
		});
		expect(chat.getStatus().status).toBe("responding");
		chat.receive({
			type: "chat:model",
			transcriptUpdate: {
				version: 1,
				baseRevision: 3,
				revision: 4,
				reset: false,
				start: 1,
				deleteCount: 1,
				messages: [
					{
						message: {
							id: "a1",
							role: "assistant",
							content: "final",
							isStreaming: false,
						},
					},
				],
			},
		});
		chat.receive({ type: "chat:done" });
		await tick();
		expect(chat.get()).toEqual([
			{ id: "u1", role: "user", content: "hello" },
			{ id: "a1", role: "assistant", content: "final", isStreaming: false },
		]);
		expect(send).toHaveBeenCalledTimes(1);
	} finally {
		chat.root.unmount();
	}
});

test("revision gaps request one full resync and recover before applying more deltas", async () => {
	const chat = await mountNativeChat("native-gap");
	try {
		chat.receive({
			type: "chat:sync",
			revision: 1,
			isStreaming: true,
			messages: [
				{ id: "a1", role: "assistant", content: "old", isStreaming: true },
			],
		});
		const gap = {
			version: 1,
			baseRevision: 3,
			revision: 4,
			reset: false,
			start: 0,
			deleteCount: 1,
			messages: [
				{
					message: { id: "a1", role: "assistant", isStreaming: true },
					appendContent: " skipped",
				},
			],
		};
		chat.receive({ type: "chat:model", transcriptUpdate: gap });
		chat.receive({ type: "chat:model", transcriptUpdate: gap });
		expect(send).toHaveBeenCalledTimes(2);
		expect(chat.get()[0]?.content).toBe("old");
		chat.receive({
			type: "chat:sync",
			revision: 4,
			isStreaming: true,
			messages: [
				{
					id: "a1",
					role: "assistant",
					content: "recovered",
					isStreaming: true,
				},
			],
		});
		chat.receive({
			type: "chat:model",
			transcriptUpdate: {
				...gap,
				baseRevision: 4,
				revision: 5,
				messages: [
					{
						message: { id: "a1", role: "assistant", isStreaming: true },
						appendContent: "!",
					},
				],
			},
		});
		await tick();
		expect(chat.get()[0]?.content).toBe("recovered!");
		chat.receive({
			type: "chat:sync",
			revision: 2,
			isStreaming: true,
			messages: [],
		});
		expect(chat.get()[0]?.content).toBe("recovered!");
		chat.receive({
			type: "chat:model",
			transcriptUpdate: {
				...gap,
				epoch: "new-session",
				revision: 1,
				reset: true,
			},
		});
		expect(send).toHaveBeenCalledTimes(3);
		chat.receive({
			type: "chat:sync",
			epoch: "new-session",
			revision: 1,
			isStreaming: false,
			messages: [{ id: "new", role: "user", content: "fresh session" }],
		});
		expect(chat.get()[0]?.content).toBe("fresh session");
		chat.receive({
			type: "chat:sync",
			epoch: "retired-session",
			revision: 100,
			isStreaming: false,
			messages: [],
		});
		expect(chat.get()[0]?.content).toBe("fresh session");
		expect(send).toHaveBeenCalledTimes(4);
	} finally {
		chat.root.unmount();
	}
});

test("native steering resolves pending UI without replacing the streaming assistant", async () => {
	const chat = await mountNativeChat("native-steer");
	try {
		chat.receive({
			type: "chat:sync",
			revision: 1,
			isStreaming: true,
			messages: [
				{ id: "a1", role: "assistant", content: "working", isStreaming: true },
			],
		});
		chat.receive({
			type: "chat:steer_pending",
			message: { id: "steer-1", text: "change", displayText: "change" },
		});
		chat.receive({
			type: "chat:steered",
			messageId: "steer-1",
			displayText: "change",
			transcriptUpdate: {
				version: 1,
				baseRevision: 1,
				revision: 2,
				reset: false,
				start: 1,
				deleteCount: 0,
				messages: [
					{ message: { id: "steer-1", role: "user", content: "change" } },
				],
			},
		});
		await tick();
		expect(chat.staged).toEqual(["steer-1"]);
		expect(chat.resolved).toEqual(["steer-1"]);
		expect(chat.get()).toEqual([
			{ id: "a1", role: "assistant", content: "working", isStreaming: true },
			{ id: "steer-1", role: "user", content: "change" },
		]);
	} finally {
		chat.root.unmount();
	}
});
