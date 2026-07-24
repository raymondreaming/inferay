import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import type { PaneId, AgentTheme } from "../src/features/agent/agent-utils.ts";

mock.module("@stylexjs/stylex", () => ({
	create: <T extends Record<string, unknown>>(styles: T) => styles,
	createTheme: (_vars: unknown, values: unknown) => values,
	defineVars: <T extends Record<string, string>>(values: T) => values,
	keyframes: () => "test-keyframes",
	props: () => ({ className: "" }),
}));

const refit = mock(() => {});
const agentEnabledStates: boolean[] = [];
const chatHandle = {};

class MockResizeObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}

	observe(target: Element) {
		this.callback(
			[
				{
					contentRect: { height: 600 } as DOMRectReadOnly,
					target,
				} as ResizeObserverEntry,
			],
			this as unknown as ResizeObserver
		);
	}

	disconnect() {}
}

mock.module("../src/hooks/useXtermAgent.ts", () => ({
	useXtermAgent: mock(({ enabled }: { enabled: boolean }) => {
		agentEnabledStates.push(enabled);
		return {
			containerRef: React.createRef<HTMLDivElement>(),
			termRef: React.createRef<{ focus: () => void }>(),
			refit,
		};
	}),
}));

mock.module("../src/components/chat/AgentChatView.tsx", () => ({
	AgentChatView: function MockAgentChatView({
		ref,
	}: {
		ref?: React.Ref<unknown>;
	}) {
		React.useImperativeHandle(ref, () => chatHandle, []);
		return (
			<div data-testid="agent-chat">
				<div
					data-testid="agent-chat-scroll"
					style={{ overflowY: "auto", height: 100 }}
				/>
			</div>
		);
	},
}));

mock.module("../src/features/git/useGitStatus.ts", () => ({
	useGitStatus: () => ({ projectMap: new Map() }),
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
	Object.defineProperty(globalThis, "HTMLElement", {
		configurable: true,
		value: dom.window.HTMLElement,
	});
	Object.defineProperty(globalThis, "Element", {
		configurable: true,
		value: dom.window.Element,
	});
	Object.defineProperty(globalThis, "SVGElement", {
		configurable: true,
		value: dom.window.SVGElement,
	});
	Object.defineProperty(globalThis, "ResizeObserver", {
		configurable: true,
		value: MockResizeObserver,
	});
	Object.defineProperty(globalThis, "requestAnimationFrame", {
		configurable: true,
		value: (callback: FrameRequestCallback) =>
			dom.window.setTimeout(() => callback(Date.now()), 0),
	});
	Object.defineProperty(globalThis, "cancelAnimationFrame", {
		configurable: true,
		value: (handle: number) => dom.window.clearTimeout(handle),
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement) };
}

function tick() {
	return new Promise((resolve) => setTimeout(resolve, 20));
}

function setScrollMetrics(
	element: HTMLElement,
	metrics: { clientHeight: number; scrollHeight: number }
) {
	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		value: metrics.clientHeight,
	});
	Object.defineProperty(element, "scrollHeight", {
		configurable: true,
		value: metrics.scrollHeight,
	});
}

function setHorizontalScrollMetrics(
	element: HTMLElement,
	metrics: { clientWidth: number; scrollWidth: number }
) {
	Object.defineProperty(element, "clientWidth", {
		configurable: true,
		value: metrics.clientWidth,
	});
	Object.defineProperty(element, "scrollWidth", {
		configurable: true,
		value: metrics.scrollWidth,
	});
}

const testTheme: AgentTheme = {
	id: "default",
	name: "Test",
	bg: "#000",
	fg: "#fff",
	cursor: "#fff",
	separator: "#333",
};

test("agent panes do not keep xterm live while their surface is hidden", async () => {
	refit.mockClear();
	agentEnabledStates.length = 0;
	const { root } = setupDom();
	const { AgentPaneView } =
		await import("../src/pages/Agent/AgentPaneView.tsx");
	const pane = {
		id: "agent-pane" as PaneId,
		title: "Agent",
		agentKind: "agent" as const,
		isClaude: false,
		paneType: "agent" as const,
		cwd: "/tmp/project",
	};

	try {
		root.render(
			<AgentPaneView
				pane={pane}
				isSelected
				isVisible={false}
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelect={() => {}}
				onClose={() => {}}
				chatRef={() => {}}
			/>
		);
		await tick();
		expect(agentEnabledStates.at(-1)).toBe(false);
		expect(refit).toHaveBeenCalledTimes(0);

		root.render(
			<AgentPaneView
				pane={pane}
				isSelected
				isVisible
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelect={() => {}}
				onClose={() => {}}
				chatRef={() => {}}
			/>
		);
		await tick();
		expect(agentEnabledStates.at(-1)).toBe(true);
		expect(refit).toHaveBeenCalledTimes(1);
	} finally {
		root.unmount();
	}
});

test("chat pane refs stay attached across parent rerenders", async () => {
	const { root } = setupDom();
	const { AgentPaneView } =
		await import("../src/pages/Agent/AgentPaneView.tsx");
	const pane = {
		id: "chat-pane" as PaneId,
		title: "Codex",
		agentKind: "codex" as const,
		isClaude: false,
		paneType: "codex" as const,
		cwd: "/tmp/project",
	};
	const chatRef = mock(() => {});
	const noop = () => {};

	try {
		root.render(
			<AgentPaneView
				pane={pane}
				isSelected
				isVisible
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				gitBranch="main"
				onSelect={noop}
				onClose={noop}
				chatRef={chatRef}
			/>
		);
		await tick();
		expect(chatRef).toHaveBeenCalledTimes(1);
		const calls = chatRef.mock.calls as unknown as Array<[string, unknown]>;
		expect(calls[0]).toEqual(["chat-pane", chatHandle]);

		root.render(
			<AgentPaneView
				pane={pane}
				isSelected
				isVisible
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				gitBranch="feature"
				onSelect={noop}
				onClose={noop}
				chatRef={chatRef}
			/>
		);
		await tick();
		expect(chatRef).toHaveBeenCalledTimes(1);
	} finally {
		root.unmount();
	}
});

test("grid layout scrolls vertically when panes exceed visible rows", async () => {
	const { root } = setupDom();
	const { AgentGrid } = await import("../src/pages/Agent/AgentGrid.tsx");
	const panes = Array.from({ length: 8 }, (_, index) => ({
		id: `chat-pane-${index}` as PaneId,
		title: `Codex ${index + 1}`,
		agentKind: "codex" as const,
		isClaude: false,
		paneType: "codex" as const,
		cwd: "/tmp/project",
	}));
	const noop = () => {};

	try {
		root.render(
			<AgentGrid
				panes={panes}
				selectedPaneId={panes[0]!.id}
				columns={3}
				rows={2}
				layoutMode="grid"
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelectPane={noop}
				onClosePane={noop}
				onDirectorySelect={noop}
				onDirectoryCancel={noop}
				onChatRef={noop}
			/>
		);
		await tick();

		expect(
			document.querySelectorAll('[data-testid="agent-chat"]')
		).toHaveLength(8);
		const source = readFileSync("src/pages/Agent/AgentGrid.tsx", "utf8");
		expect(source).toContain('overflowY: "auto"');
		expect(source).toContain('overflowX: "hidden"');
	} finally {
		root.unmount();
	}
});

test("grid layout owns wheel scrolling until a chat pane is clicked", async () => {
	const { root } = setupDom();
	const { AgentGrid } = await import("../src/pages/Agent/AgentGrid.tsx");
	const panes = Array.from({ length: 8 }, (_, index) => ({
		id: `chat-pane-${index}` as PaneId,
		title: `Codex ${index + 1}`,
		agentKind: "codex" as const,
		isClaude: false,
		paneType: "codex" as const,
		cwd: "/tmp/project",
	}));
	const noop = () => {};

	try {
		root.render(
			<AgentGrid
				panes={panes}
				selectedPaneId={panes[0]!.id}
				columns={3}
				rows={2}
				layoutMode="grid"
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelectPane={noop}
				onClosePane={noop}
				onDirectorySelect={noop}
				onDirectoryCancel={noop}
				onChatRef={noop}
			/>
		);
		await tick();

		const grid = document.querySelector<HTMLElement>(
			"[data-agent-grid-scroll-area]"
		);
		const firstChat = document.querySelector<HTMLElement>(
			'[data-testid="agent-chat"]'
		);
		const secondChat = document.querySelectorAll<HTMLElement>(
			'[data-testid="agent-chat"]'
		)[1];
		const firstChatScroll = document.querySelector<HTMLElement>(
			'[data-testid="agent-chat-scroll"]'
		);
		const secondChatScroll = document.querySelectorAll<HTMLElement>(
			'[data-testid="agent-chat-scroll"]'
		)[1];
		if (
			!grid ||
			!firstChat ||
			!secondChat ||
			!firstChatScroll ||
			!secondChatScroll
		) {
			throw new Error("Missing grid test elements");
		}
		setScrollMetrics(grid, { clientHeight: 600, scrollHeight: 1200 });
		setScrollMetrics(firstChatScroll, { clientHeight: 100, scrollHeight: 400 });
		setScrollMetrics(secondChatScroll, {
			clientHeight: 100,
			scrollHeight: 400,
		});

		firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			})
		);
		expect(grid.scrollTop).toBe(120);

		firstChat.dispatchEvent(
			new window.Event("pointerdown", {
				bubbles: true,
				cancelable: true,
			})
		);
		const firstChatWheelWasNotCancelled = firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			})
		);
		expect(firstChatWheelWasNotCancelled).toBe(true);
		expect(grid.scrollTop).toBe(120);
		expect(firstChatScroll.scrollTop).toBe(0);
		expect(secondChatScroll.scrollTop).toBe(0);

		const secondChatWheelWasNotCancelled = secondChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			})
		);
		expect(secondChatWheelWasNotCancelled).toBe(false);
		expect(grid.scrollTop).toBe(240);
		expect(secondChatScroll.scrollTop).toBe(0);

		secondChat.dispatchEvent(
			new window.Event("pointerdown", {
				bubbles: true,
				cancelable: true,
			})
		);
		firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			})
		);
		expect(grid.scrollTop).toBe(360);
		expect(firstChatScroll.scrollTop).toBe(0);

		firstChat.dispatchEvent(
			new window.Event("pointerdown", {
				bubbles: true,
				cancelable: true,
			})
		);

		firstChatScroll.scrollTop = 300;
		const firstBoundaryDownWasNotCancelled = firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			})
		);
		expect(firstBoundaryDownWasNotCancelled).toBe(false);
		expect(grid.scrollTop).toBe(480);

		firstChatScroll.scrollTop = 0;
		const firstBoundaryUpWasNotCancelled = firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: -120,
			})
		);
		expect(firstBoundaryUpWasNotCancelled).toBe(false);
		expect(grid.scrollTop).toBe(360);
	} finally {
		root.unmount();
	}
});

test("row layout glides horizontally over inactive chat bodies", async () => {
	const { root } = setupDom();
	const { AgentGrid } = await import("../src/pages/Agent/AgentGrid.tsx");
	const panes = Array.from({ length: 3 }, (_, index) => ({
		id: `row-chat-pane-${index}` as PaneId,
		title: `Codex ${index + 1}`,
		agentKind: "codex" as const,
		isClaude: false,
		paneType: "codex" as const,
		cwd: "/tmp/project",
	}));
	const noop = () => {};

	try {
		root.render(
			<AgentGrid
				panes={panes}
				selectedPaneId={panes[0]!.id}
				columns={3}
				rows={2}
				layoutMode="rows"
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelectPane={noop}
				onClosePane={noop}
				onDirectorySelect={noop}
				onDirectoryCancel={noop}
				onChatRef={noop}
			/>
		);
		await tick();

		const row = document.querySelector<HTMLElement>(
			"[data-agent-row-scroll-area]"
		);
		const chats = document.querySelectorAll<HTMLElement>(
			'[data-testid="agent-chat"]'
		);
		if (!row || !chats[0] || !chats[1]) {
			throw new Error("Missing row layout test elements");
		}
		setHorizontalScrollMetrics(row, { clientWidth: 400, scrollWidth: 1200 });

		const horizontalWasNotCancelled = chats[1].dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaX: 120,
			})
		);
		expect(horizontalWasNotCancelled).toBe(false);
		expect(row.scrollLeft).toBe(120);

		const inactiveVerticalWasNotCancelled = chats[1].dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			})
		);
		expect(inactiveVerticalWasNotCancelled).toBe(true);
		expect(row.scrollLeft).toBe(120);

		const activeVerticalWasNotCancelled = chats[0].dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			})
		);
		expect(activeVerticalWasNotCancelled).toBe(true);
		expect(row.scrollLeft).toBe(120);

		const activeHorizontalWasNotCancelled = chats[0].dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaX: 120,
			})
		);
		expect(activeHorizontalWasNotCancelled).toBe(false);
		expect(row.scrollLeft).toBe(120);
	} finally {
		root.unmount();
	}
});
