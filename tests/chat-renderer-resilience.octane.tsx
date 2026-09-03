import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

let connectionStatus = "connected";
const connectionListeners = new Set<() => void>();

mock.module("../src/adapters/backend/websocket.ts", () => ({
	getWebSocketStatus: () => connectionStatus,
	subscribeWebSocketStatus: (listener: () => void) => {
		connectionListeners.add(listener);
		return () => connectionListeners.delete(listener);
	},
	wsClient: {},
}));

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: dom.window },
		document: { configurable: true, value: dom.window.document },
		HTMLElement: { configurable: true, value: dom.window.HTMLElement },
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement), rootElement };
}

function tick(ms = 20) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("socket loss renders a non-blocking inline status", async () => {
	connectionStatus = "disconnected";
	connectionListeners.clear();
	const { root, rootElement } = setupDom();
	try {
		const { AgentChatStatusBar } = await import(
			"../src/modules/conversation/components/AgentChatStatusBar.tsx"
		);
		root.render(
			<div>
				<div data-testid="workspace">Workspace remains mounted</div>
				<AgentChatStatusBar isLoading={false} onStop={() => {}} />
			</div>,
		);
		await tick();
		expect(rootElement.textContent).toContain("Workspace remains mounted");
		expect(rootElement.textContent).toContain("Offline — sends are queued");

		connectionStatus = "connected";
		for (const listener of connectionListeners) listener();
		await tick();
		expect(rootElement.textContent).not.toContain("Offline");
		expect(rootElement.textContent).toContain("Workspace remains mounted");
	} finally {
		root.unmount();
	}
});

test("active status keeps elapsed time and a compact stop control", async () => {
	connectionStatus = "connected";
	connectionListeners.clear();
	const { root, rootElement } = setupDom();
	try {
		const { AgentChatStatusBar } = await import(
			"../src/modules/conversation/components/AgentChatStatusBar.tsx"
		);
		root.render(
			<AgentChatStatusBar
				isLoading
				startTime={Date.now() - 5_000}
				onStop={() => {}}
			/>,
		);
		await tick();
		expect(rootElement.textContent).toContain("5s");
		expect(rootElement.textContent).not.toContain("Running command");
		expect(rootElement.textContent).not.toContain("Stop");
		expect(
			rootElement.querySelector('button[aria-label="Stop generation"]'),
		).not.toBeNull();
		expect(
			rootElement.querySelectorAll('output[aria-live="polite"]'),
		).toHaveLength(1);
	} finally {
		root.unmount();
	}
});

test("inline edits render only changed rows without hunk metadata", async () => {
	const { root, rootElement } = setupDom();
	try {
		const { MiniEditDiff } = await import(
			"../src/modules/conversation/components/ChatEditDiff.tsx"
		);
		root.render(
			<MiniEditDiff
				filePath="src/example.ts"
				oldStr={"const first = 1;\nconst value = 'old';\nconst last = 3;"}
				newStr={"const first = 1;\nconst value = 'new';\nconst last = 3;"}
			/>,
		);
		await tick();
		expect(rootElement.textContent).toContain("const value = 'old';");
		expect(rootElement.textContent).toContain("const value = 'new';");
		expect(rootElement.textContent).not.toContain("const first = 1;");
		expect(rootElement.textContent).not.toContain("unchanged lines hidden");
		expect(rootElement.textContent).not.toContain("hunk");
	} finally {
		root.unmount();
	}
});

test("a chat render failure stays inside its pane boundary", async () => {
	const { root, rootElement } = setupDom();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const { ChatPaneBoundary } = await import(
			"../src/modules/conversation/components/ChatPaneBoundary.tsx"
		);
		function BrokenChat(): never {
			throw new Error("test chat failure");
		}
		root.render(
			<div>
				<div data-testid="neighbor">Neighbor pane</div>
				<ChatPaneBoundary>
					<BrokenChat />
				</ChatPaneBoundary>
			</div>,
		);
		await tick();
		expect(rootElement.textContent).toContain("Neighbor pane");
		expect(rootElement.textContent).toContain("This chat pane hit a problem.");
		expect(rootElement.textContent).toContain("Reload pane");
	} finally {
		consoleError.mockRestore();
		root.unmount();
	}
});
