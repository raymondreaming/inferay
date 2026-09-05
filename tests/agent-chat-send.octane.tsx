import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});
const sendMock = mock(() => {});

mock.module("../src/adapters/backend/websocket.ts", () => ({
	wsClient: {
		onMessage: mock(() => () => {}),
		onReconnect: mock(() => () => {}),
		send: sendMock,
		subscribe: mock(() => () => {}),
	},
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
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: dom.window },
		document: { configurable: true, value: dom.window.document },
		localStorage: { configurable: true, value: dom.window.localStorage },
		navigator: { configurable: true, value: dom.window.navigator },
		HTMLElement: { configurable: true, value: dom.window.HTMLElement },
		SVGElement: { configurable: true, value: dom.window.SVGElement },
		DOMException: { configurable: true, value: dom.window.DOMException },
		ResizeObserver: { configurable: true, value: TestResizeObserver },
		requestAnimationFrame: { configurable: true, value: raf },
		cancelAnimationFrame: { configurable: true, value: caf },
	});
	Object.assign(dom.window, {
		ResizeObserver: TestResizeObserver,
		requestAnimationFrame: raf,
		cancelAnimationFrame: caf,
	});
	dom.window.HTMLElement.prototype.scrollTo = () => {};
	Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => 720,
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
		configurable: true,
		get: () => 960,
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

test("sending an optimistic message renders the real virtualized list", async () => {
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
			"../src/modules/conversation/components/AgentChatView.tsx"
		);
		root.render(
			<AgentChatView
				paneId="pane-real-send-render"
				cwd="/tmp/project"
				agentKind="codex"
				isVisible
			/>,
		);
		await tick(50);
		expect(
			rootElement.querySelector('button[aria-label="Provider: Codex"]'),
		).not.toBeNull();
		rootElement
			.querySelector<HTMLButtonElement>('button[aria-label^="Model:"]')!
			.click();
		await tick();
		const modelMenu = rootElement.querySelector(
			'[role="menu"][aria-label="Model"]',
		)!;
		Array.from(modelMenu.querySelectorAll<HTMLButtonElement>("button"))
			.find((button) => button.textContent === "GPT-6 Astra")!
			.click();
		await tick();
		expect(
			rootElement.querySelector('button[aria-label="Model: Astra"]'),
		).not.toBeNull();
		expect(rootElement.querySelector('[role="menu"]')).toBeNull();
		rootElement
			.querySelector<HTMLButtonElement>('button[aria-label^="Reasoning:"]')!
			.click();
		await tick();
		const reasoningMenu = rootElement.querySelector(
			'[role="menu"][aria-label="Reasoning"]',
		)!;
		Array.from(reasoningMenu.querySelectorAll<HTMLButtonElement>("button"))
			.find((button) => button.textContent === "Low")!
			.click();
		await tick();
		expect(
			rootElement.querySelector('button[aria-label="Reasoning: Low"]'),
		).not.toBeNull();
		const textarea = rootElement.querySelector("textarea");
		if (!textarea) throw new Error("Missing chat textarea");

		textarea.value = "hello from the real list";
		textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
		textarea.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				bubbles: true,
				key: "Enter",
			}),
		);
		await tick(100);

		expect(rootElement.querySelector("textarea")).not.toBeNull();
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "chat:send",
				paneId: "pane-real-send-render",
				text: "hello from the real list",
				model: "gpt-6-astra",
				reasoningLevel: "low",
			}),
		);
	} finally {
		root.unmount();
		globalThis.fetch = previousFetch;
	}
});
