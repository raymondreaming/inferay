import { JSDOM } from "jsdom";
import { createRoot, memo } from "octane";
import { expect, test, vi } from "vitest";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

mock.module("@octanejs/stylex", () => ({
	create: <T extends Record<string, unknown>>(styles: T) => styles,
	createTheme: (_vars: unknown, values: unknown) => values,
	defineVars: <T extends Record<string, string>>(values: T) => values,
	keyframes: () => "test-keyframes",
	props: (
		...styles: Array<Record<string, unknown> | false | null | undefined>
	) => ({
		className: styles
			.filter(Boolean)
			.map((_, index) => `sx-${index}`)
			.join(" "),
	}),
}));

mock.module("../src/lib/websocket.ts", () => ({
	wsClient: {
		onMessage: mock(() => () => {}),
		onReconnect: mock(() => () => {}),
		send: mock(() => {}),
		subscribe: mock(() => () => {}),
	},
}));

let chatMessageListRenderCount = 0;

mock.module("../src/components/chat/ChatMessageList.tsx", () => ({
	ChatMessageList: memo(
		({ messages }: { messages: Array<{ content: string }> }) => {
			chatMessageListRenderCount++;
			return (
				<div data-testid="message-list">
					{messages.map((message) => message.content).join("|")}
				</div>
			);
		}
	),
}));

class TestResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	const raf = (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 0) as unknown as number;
	const caf = (handle: number) => clearTimeout(handle);
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
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	Object.defineProperty(globalThis, "HTMLElement", {
		configurable: true,
		value: dom.window.HTMLElement,
	});
	Object.defineProperty(globalThis, "SVGElement", {
		configurable: true,
		value: dom.window.SVGElement,
	});
	Object.defineProperty(globalThis, "DOMException", {
		configurable: true,
		value: dom.window.DOMException,
	});
	Object.defineProperty(globalThis, "ResizeObserver", {
		configurable: true,
		value: TestResizeObserver,
	});
	Object.defineProperty(globalThis, "requestAnimationFrame", {
		configurable: true,
		value: raf,
	});
	Object.defineProperty(globalThis, "cancelAnimationFrame", {
		configurable: true,
		value: caf,
	});
	Object.assign(dom.window, {
		ResizeObserver: TestResizeObserver,
		requestAnimationFrame: raf,
		cancelAnimationFrame: caf,
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get() {
			return 720;
		},
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get() {
			return 960;
		},
	});
	dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
		bottom: 720,
		height: 720,
		left: 0,
		right: 960,
		top: 0,
		width: 960,
		x: 0,
		y: 0,
		toJSON: () => {},
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement), rootElement };
}

function tick(ms = 20) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("hidden chat panes do not restore legacy localStorage transcripts", async () => {
	const previousFetch = globalThis.fetch;
	globalThis.fetch = mock((input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("/api/prompts")) return Promise.resolve(Response.json([]));
		if (url.includes("/api/chat-queues/")) {
			return Promise.resolve(Response.json({ queue: [] }));
		}
		return Promise.resolve(Response.json({ ok: true }));
	}) as unknown as typeof fetch;
	const { root, rootElement } = setupDom();
	try {
		const { AgentChatView } =
			await import("../src/components/chat/AgentChatView.tsx");
		localStorage.setItem(
			"inferay-chat-pane-deferred-visible-load",
			JSON.stringify([
				{ id: "m1", role: "assistant", content: "old transcript" },
			])
		);

		root.render(
			<AgentChatView
				paneId="pane-deferred-visible-load"
				cwd="/tmp/project"
				gitBranch="main"
				agentKind="codex"
				isVisible={false}
			/>
		);
		await tick();
		localStorage.setItem(
			"inferay-chat-pane-deferred-visible-load",
			JSON.stringify([
				{ id: "m1", role: "assistant", content: "new transcript" },
			])
		);

		root.render(
			<AgentChatView
				paneId="pane-deferred-visible-load"
				cwd="/tmp/project"
				gitBranch="main"
				agentKind="codex"
				isVisible
			/>
		);
		await tick(50);

		expect(rootElement.textContent).not.toContain("new transcript");
		expect(rootElement.textContent).not.toContain("old transcript");
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});

test("draft typing does not re-render long chat message list", async () => {
	const previousFetch = globalThis.fetch;
	globalThis.fetch = mock((input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("/api/prompts")) return Promise.resolve(Response.json([]));
		if (url.includes("/api/chat-queues/")) {
			return Promise.resolve(Response.json({ queue: [] }));
		}
		return Promise.resolve(Response.json({ ok: true }));
	}) as unknown as typeof fetch;
	chatMessageListRenderCount = 0;
	const { root, rootElement } = setupDom();
	try {
		const { getChatMessageReadModel } =
			await import("../src/features/chat/chat-session-store.ts");
		const { AgentChatView } =
			await import("../src/components/chat/AgentChatView.tsx");
		const paneId = "pane-long-draft-performance";
		getChatMessageReadModel(paneId).set(
			Array.from({ length: 1_200 }, (_, index) => ({
				id: `m${index}`,
				role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
				content: `message ${index}`,
			}))
		);

		root.render(
			<AgentChatView
				paneId={paneId}
				cwd="/tmp/project"
				gitBranch="main"
				agentKind="codex"
				isVisible
			/>
		);
		await tick(50);
		const renderCountAfterMount = chatMessageListRenderCount;
		const textarea = rootElement.querySelector("textarea");
		if (!textarea) throw new Error("Missing chat textarea");

		textarea.value = "typing should stay local";
		textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
		await tick(50);

		expect(chatMessageListRenderCount).toBe(renderCountAfterMount);
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});
