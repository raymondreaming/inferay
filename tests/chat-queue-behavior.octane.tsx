import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";

type TestQueueItem = { id: string; text: string; displayText: string };

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

mock.module("../src/lib/websocket.ts", () => ({
	wsClient: {
		onMessage: mock(() => () => {}),
		send: mock(() => {}),
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

test("queued messages hydrate from file-backed queue and ignore legacy localStorage", async () => {
	const previousFetch = globalThis.fetch;
	const fileBackedQueue = [{ id: "q1", text: "first", displayText: "first" }];
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
			JSON.stringify([{ id: "old", text: "old", displayText: "old" }])
		);
		const { useAgentChatComposerState } =
			await import("../src/components/chat/useAgentChatComposerState.tsx");
		function Harness() {
			const state = useAgentChatComposerState("pane-stale");
			return (
				<div data-queue={state.queuedMessages.map((q) => q.text).join("|")} />
			);
		}

		root.render(<Harness />);
		await tick(20);
		expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe(
			"first"
		);
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});

test("hidden composer state does not hydrate file-backed queues", async () => {
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
		const { useAgentChatComposerState } =
			await import("../src/components/chat/useAgentChatComposerState.tsx");
		function Harness({ enabled }: { enabled: boolean }) {
			useAgentChatComposerState("pane-hidden-queue", enabled);
			return <div />;
		}

		root.render(<Harness enabled={false} />);
		await tick(20);
		expect(queueFetchCount).toBe(0);

		root.render(<Harness enabled />);
		await tick(20);
		expect(queueFetchCount).toBe(1);
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});

test("visible composer keeps newer queue mirror while stale fetch resolves", async () => {
	const previousFetch = globalThis.fetch;
	let resolveQueueFetch: () => void = () => {
		throw new Error("Queue fetch was not started");
	};
	const staleQueue = [{ id: "q1", text: "first", displayText: "first" }];
	globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("/api/chat-queues/") && !init?.method) {
			return new Promise<Response>((resolve) => {
				resolveQueueFetch = () => resolve(Response.json({ queue: staleQueue }));
			});
		}
		return Promise.resolve(Response.json({ ok: true }));
	}) as unknown as typeof fetch;

	const { root, rootElement } = setupDom();
	try {
		const { useAgentChatComposerState } =
			await import("../src/components/chat/useAgentChatComposerState.tsx");
		let replaceQueuedMessages: (messages: TestQueueItem[]) => void = (
			_messages
		) => {
			throw new Error("replaceQueuedMessages was not initialized");
		};
		function Harness() {
			const state = useAgentChatComposerState("pane-visible-race");
			replaceQueuedMessages = state.replaceQueuedMessages;
			return (
				<div data-queue={state.queuedMessages.map((q) => q.text).join("|")} />
			);
		}

		root.render(<Harness />);
		await tick(20);
		replaceQueuedMessages([
			{ id: "q2", text: "second", displayText: "second" },
		]);
		await tick(20);
		expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe(
			"second"
		);

		resolveQueueFetch();
		await tick(20);
		expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe(
			"second"
		);
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
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
		const { useAgentChatComposerState } =
			await import("../src/components/chat/useAgentChatComposerState.tsx");
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
			JSON.stringify([{ id: "q1", text: "first", displayText: "first" }])
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
			})
		);
		await tick(20);
		expect(rootElement.firstElementChild?.getAttribute("data-queue")).toBe("");
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});
