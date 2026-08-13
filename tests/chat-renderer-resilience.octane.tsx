import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

let connectionStatus = "connected";
const connectionListeners = new Set<() => void>();

mock.module("../src/lib/websocket.ts", () => ({
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
			"../src/components/chat/AgentChatStatusBar.tsx"
		);
		root.render(
			<div>
				<div data-testid="workspace">Workspace remains mounted</div>
				<AgentChatStatusBar isLoading={false} status="idle" onStop={() => {}} />
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

test("active status keeps elapsed time and activity in one inline strip", async () => {
	connectionStatus = "connected";
	connectionListeners.clear();
	const { root, rootElement } = setupDom();
	try {
		const { AgentChatStatusBar } = await import(
			"../src/components/chat/AgentChatStatusBar.tsx"
		);
		root.render(
			<AgentChatStatusBar
				isLoading
				startTime={Date.now() - 5_000}
				status="tool:exec"
				liveActivities={[
					{
						id: "exec-1",
						toolName: "exec",
						isStreaming: true,
						summary: "Running command: cargo test --workspace",
					},
				]}
				onStop={() => {}}
			/>,
		);
		await tick();
		expect(rootElement.textContent).toContain("5s");
		expect(rootElement.textContent).toContain(
			"Running command: cargo test --workspace",
		);
		expect(
			rootElement.querySelectorAll('output[aria-live="polite"]'),
		).toHaveLength(1);
	} finally {
		root.unmount();
	}
});

test("a chat render failure stays inside its pane boundary", async () => {
	const { root, rootElement } = setupDom();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const { ChatPaneBoundary } = await import(
			"../src/components/chat/ChatPaneBoundary.tsx"
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
