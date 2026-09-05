import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";

type TestQueueItem = { id: string; text: string; displayText: string };

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

const listeners = new Map<string, (message: unknown) => void>();
const queues = new Map<string, TestQueueItem[]>();
const reconnects: string[] = [];
const ignore = () => {};
mock.module("../src/adapters/backend/websocket.ts", () => ({
	wsClient: {
		onReconnect: () => () => {},
		subscribe: (pane: string, listener: (message: unknown) => void) => {
			listeners.set(pane, listener);
			return () => {
				listeners.delete(pane);
			};
		},
		send: (message: { type: string; paneId: string }) => {
			if (message.type !== "chat:reconnect") return;
			reconnects.push(message.paneId);
			listeners.get(message.paneId)?.({
				type: "chat:queue",
				paneId: message.paneId,
				queue: queues.get(message.paneId) ?? [],
			});
		},
	},
}));

async function connectedComposer() {
	const { useChatConnection } = await import(
		"../src/modules/conversation/hooks/useChatConnection.ts"
	);
	const { getChatMessageReadModel } = await import(
		"../src/modules/conversation/model/chat-session-store.ts"
	);
	const { useAgentChatComposerState } = await import(
		"../src/modules/conversation/hooks/useAgentChatComposerState.tsx"
	);
	return function useComposer(paneId: string, enabled = true) {
		const composer = useAgentChatComposerState(paneId, enabled);
		useChatConnection({
			...composer,
			paneId,
			enabled,
			agentKind: "codex",
			messageReadModel: getChatMessageReadModel(paneId),
			setChatUiState: ignore,
			setRunStatus: ignore,
		});
		return composer;
	};
}

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
	Object.defineProperty(globalThis, "crypto", {
		configurable: true,
		value: dom.window.crypto,
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement), rootElement };
}

function tick(ms = 0) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("queued messages restore through reconnect and ignore legacy localStorage", async () => {
	const previousFetch = globalThis.fetch;
	const fileBackedQueue = [{ id: "q1", text: "first", displayText: "first" }];
	queues.set("pane-stale", fileBackedQueue);
	globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("/api/chat-queues/") && !init?.method) {
			return Promise.resolve(Response.json({ queue: fileBackedQueue }));
		}
		return Promise.resolve(Response.json({ ok: true }));
	}) as unknown as typeof fetch;

	const { root, rootElement } = setupDom();
	try {
		localStorage.setItem(
			"inferay-chat-queue-pane-stale",
			JSON.stringify([{ id: "old", text: "old", displayText: "old" }]),
		);
		const useAgentChatComposerState = await connectedComposer();
		function Harness() {
			const state = useAgentChatComposerState("pane-stale");
			return (
				<div data-queue={state.queuedMessages.map((q) => q.text).join("|")} />
			);
		}

		root.render(<Harness />);
		await tick(20);
		expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe(
			"first",
		);
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});

test("hidden chats defer reconnect and visible chats avoid a duplicate queue fetch", async () => {
	const previousFetch = globalThis.fetch;
	let queueFetchCount = 0;
	globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("/api/chat-queues/") && !init?.method) {
			queueFetchCount++;
			return Promise.resolve(Response.json({ queue: [] }));
		}
		return Promise.resolve(Response.json({ ok: true }));
	}) as unknown as typeof fetch;

	const { root } = setupDom();
	try {
		const useAgentChatComposerState = await connectedComposer();
		function Harness({ enabled }: { enabled: boolean }) {
			useAgentChatComposerState("pane-hidden-queue", enabled);
			return <div />;
		}

		root.render(<Harness enabled={false} />);
		await tick(20);
		expect(queueFetchCount).toBe(0);

		root.render(<Harness enabled />);
		await tick(20);
		expect(queueFetchCount).toBe(0);
		expect(reconnects).toContain("pane-hidden-queue");
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});

test("reconnect queue updates retain pending steering until acknowledged", async () => {
	const { root, rootElement } = setupDom();
	const useComposer = await connectedComposer();
	let composer!: ReturnType<typeof useComposer>;
	function Harness() {
		composer = useComposer("pane-steering");
		return (
			<div
				data-queue={composer.queuedMessages
					.map((message) => message.text)
					.join("|")}
			/>
		);
	}
	try {
		root.render(<Harness />);
		await tick(20);
		composer.stageSteeringMessage({
			id: "steer",
			text: "pending",
			displayText: "pending",
		});
		listeners.get("pane-steering")!({
			type: "chat:queue",
			paneId: "pane-steering",
			queue: [{ id: "q1", text: "queued", displayText: "queued" }],
		});
		await vi.waitFor(() =>
			expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe(
				"queued|pending",
			),
		);
		listeners.get("pane-steering")!({
			type: "chat:steered",
			paneId: "pane-steering",
			messageId: "steer",
		});
		await vi.waitFor(() =>
			expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe(
				"queued",
			),
		);
	} finally {
		root.unmount();
	}
});

test("legacy queue storage events do not update server-owned queue mirror", async () => {
	const previousFetch = globalThis.fetch;
	globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("/api/chat-queues/") && !init?.method) {
			return Promise.resolve(Response.json({ queue: [] }));
		}
		return Promise.resolve(Response.json({ ok: true }));
	}) as unknown as typeof fetch;

	const { root, rootElement } = setupDom();
	try {
		const { useAgentChatComposerState } = await import(
			"../src/modules/conversation/hooks/useAgentChatComposerState.tsx"
		);
		function Harness() {
			const state = useAgentChatComposerState("pane-stale-preference");
			return (
				<div data-queue={state.queuedMessages.map((q) => q.text).join("|")} />
			);
		}

		root.render(<Harness />);
		await tick(20);

		localStorage.setItem(
			"inferay-chat-queue-pane-stale-preference",
			JSON.stringify([{ id: "q1", text: "first", displayText: "first" }]),
		);
		window.dispatchEvent(
			new window.CustomEvent("inferay-client-storage-change", {
				detail: {
					key: "inferay-chat-queue-pane-stale-preference",
					value: JSON.stringify([
						{ id: "q1", text: "first", displayText: "first" },
						{ id: "q2", text: "second", displayText: "second" },
					]),
				},
			}),
		);
		await tick(20);
		expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe("");
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});
