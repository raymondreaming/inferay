import { JSDOM } from "jsdom";
import { createRoot, memo } from "octane";
import { expect, test, vi } from "vitest";
import { stylexTestTypes } from "./stylex-test-mock.ts";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});
const sendMock = mock(() => {});

mock.module("@octanejs/stylex", () => ({
	create: <T extends Record<string, unknown>>(styles: T) => styles,
	createTheme: (_vars: unknown, values: unknown) => values,
	defineConsts: <T extends Record<string, string>>(values: T) => values,
	defineVars: <T extends Record<string, string>>(values: T) => values,
	types: stylexTestTypes,
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

mock.module("../src/adapters/backend/websocket.ts", () => ({
	wsClient: {
		onMessage: mock(() => () => {}),
		onReconnect: mock(() => () => {}),
		send: sendMock,
		subscribe: mock(() => () => {}),
	},
}));

let chatMessageListRenderCount = 0;

mock.module(
	"../src/modules/conversation/components/ChatMessageList/index.tsx",
	() => ({
		ChatMessageList: memo(
			({ messages }: { messages: Array<{ content: string }> }) => {
				chatMessageListRenderCount++;
				return (
					<div data-testid="message-list">
						{messages.map((message) => message.content).join("|")}
					</div>
				);
			},
		),
	}),
);

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
	dom.window.HTMLElement.prototype.scrollTo = () => {};
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
		const { AgentChatView } = await import(
			"../src/modules/conversation/components/AgentChatView/index.tsx"
		);
		localStorage.setItem(
			"inferay-chat-pane-deferred-visible-load",
			JSON.stringify([
				{ id: "m1", role: "assistant", content: "old transcript" },
			]),
		);

		root.render(
			<AgentChatView
				paneId="pane-deferred-visible-load"
				cwd="/tmp/project"
				agentKind="codex"
				isVisible={false}
			/>,
		);
		await tick();
		localStorage.setItem(
			"inferay-chat-pane-deferred-visible-load",
			JSON.stringify([
				{ id: "m1", role: "assistant", content: "new transcript" },
			]),
		);

		root.render(
			<AgentChatView
				paneId="pane-deferred-visible-load"
				cwd="/tmp/project"
				agentKind="codex"
				isVisible
			/>,
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
		const { getChatMessageReadModel } = await import(
			"../src/modules/conversation/model/chat-session-store.ts"
		);
		const { AgentChatView } = await import(
			"../src/modules/conversation/components/AgentChatView/index.tsx"
		);
		const paneId = "pane-long-draft-performance";
		getChatMessageReadModel(paneId).set(
			Array.from({ length: 1_200 }, (_, index) => ({
				id: `m${index}`,
				role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
				content: `message ${index}`,
			})),
		);

		root.render(
			<AgentChatView
				paneId={paneId}
				cwd="/tmp/project"
				agentKind="codex"
				isVisible
			/>,
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

test("sending a message keeps the chat pane mounted", async () => {
	const previousFetch = globalThis.fetch;
	globalThis.fetch = mock((input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("/api/prompts")) return Promise.resolve(Response.json([]));
		if (url.includes("/api/chat-queues/")) {
			return Promise.resolve(Response.json({ queue: [] }));
		}
		return Promise.resolve(Response.json({ ok: true }));
	}) as unknown as typeof fetch;
	sendMock.mockClear();
	const { root, rootElement } = setupDom();
	try {
		const { AgentChatView } = await import(
			"../src/modules/conversation/components/AgentChatView/index.tsx"
		);
		root.render(
			<AgentChatView
				paneId="pane-send-render"
				cwd="/tmp/project"
				agentKind="codex"
				isVisible
			/>,
		);
		await tick(50);
		const textarea = rootElement.querySelector("textarea");
		if (!textarea) throw new Error("Missing chat textarea");

		textarea.value = "hello from octane";
		textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
		textarea.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				bubbles: true,
				key: "Enter",
			}),
		);
		await tick(50);

		expect(rootElement.querySelector("textarea")).not.toBeNull();
		expect(rootElement.textContent).toContain("hello from octane");
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "chat:send",
				paneId: "pane-send-render",
				text: "hello from octane",
			}),
		);
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});
