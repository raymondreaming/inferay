import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createRoot, useImperativeHandle } from "octane";
import type { Octane } from "octane/jsx-runtime";
import { expect, test, vi } from "vitest";
import type {
	AgentTheme,
	PaneId,
} from "../src/modules/workspace/model/workspace-model.ts";
import { stylexTestTypes } from "./stylex-test-mock.ts";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

mock.module("@octanejs/stylex", () => ({
	create: <T extends Record<string, unknown>>(styles: T) => styles,
	createTheme: (_vars: unknown, values: unknown) => values,
	defineConsts: <T extends Record<string, string>>(values: T) => values,
	defineVars: <T extends Record<string, string>>(values: T) => values,
	types: stylexTestTypes,
	keyframes: () => "test-keyframes",
	props: () => ({ className: "" }),
}));

const chatHandle = {};

class MockResizeObserver {
	private readonly callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}

	observe(target: Element) {
		this.callback(
			[
				{
					contentRect: { height: 600 } as DOMRectReadOnly,
					target,
				} as ResizeObserverEntry,
			],
			this as unknown as ResizeObserver,
		);
	}

	disconnect() {}
}

mock.module("../src/modules/conversation/components/AgentChatView.tsx", () => ({
	AgentChatView: function MockAgentChatView({
		ref,
		onDragStart,
	}: {
		ref?: Octane.Ref<unknown>;
		onDragStart?: (event: PointerEvent) => void;
	}) {
		useImperativeHandle(ref, () => chatHandle, []);
		return (
			<div data-testid="agent-chat">
				<span data-testid="agent-dock-handle" onPointerDown={onDragStart} />
				<div
					data-testid="agent-chat-scroll"
					style={{ overflowY: "auto", height: 100 }}
				/>
			</div>
		);
	},
}));

mock.module("../src/modules/repository/hooks/useGitStatus.tsx", () => ({
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
	Object.defineProperty(globalThis, "Node", {
		configurable: true,
		value: dom.window.Node,
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
	metrics: { clientHeight: number; scrollHeight: number },
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
	metrics: { clientWidth: number; scrollWidth: number },
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

test("legacy terminal panes are restored as chats", async () => {
	const { root } = setupDom();
	const { PaneView } = await import(
		"../src/modules/workspace/components/PaneView.tsx"
	);
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
			<PaneView
				pane={pane}
				isSelected
				isVisible
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelect={() => {}}
				onClose={() => {}}
				chatRef={() => {}}
			/>,
		);
		await tick();
		expect(
			document.querySelectorAll('[data-testid="agent-chat"]'),
		).toHaveLength(1);
	} finally {
		root.unmount();
	}
});

test("chat pane refs stay attached across parent rerenders", async () => {
	const { root } = setupDom();
	const { PaneView } = await import(
		"../src/modules/workspace/components/PaneView.tsx"
	);
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
			<PaneView
				pane={pane}
				isSelected
				isVisible
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelect={noop}
				onClose={noop}
				chatRef={chatRef}
			/>,
		);
		await tick();
		expect(chatRef).toHaveBeenCalledTimes(1);
		const calls = chatRef.mock.calls as unknown as Array<[string, unknown]>;
		expect(calls[0]).toEqual(["chat-pane", chatHandle]);

		root.render(
			<PaneView
				pane={pane}
				isSelected
				isVisible
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelect={noop}
				onClose={noop}
				chatRef={chatRef}
			/>,
		);
		await tick();
		expect(chatRef).toHaveBeenCalledTimes(1);
	} finally {
		root.unmount();
	}
});

test("grid layout scrolls vertically when panes exceed visible rows", async () => {
	const { root } = setupDom();
	const { WorkspaceCanvas } = await import(
		"../src/modules/workspace/components/WorkspaceCanvas.tsx"
	);
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
			<WorkspaceCanvas
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
			/>,
		);
		await tick();

		expect(
			document.querySelectorAll('[data-testid="agent-chat"]'),
		).toHaveLength(8);
		const source = readFileSync(
			"src/modules/workspace/components/WorkspaceCanvas.tsx",
			"utf8",
		);
		expect(source).toContain('overflowY: "auto"');
		expect(source).toContain('overflowX: "hidden"');
	} finally {
		root.unmount();
	}
});

test("dock handle reorders a row from the first pointer gesture", async () => {
	const { root } = setupDom();
	const { WorkspaceCanvas } = await import(
		"../src/modules/workspace/components/WorkspaceCanvas.tsx"
	);
	const panes = Array.from({ length: 2 }, (_, index) => ({
		id: `drag-pane-${index}` as PaneId,
		title: `Codex ${index + 1}`,
		agentKind: "codex" as const,
		isClaude: false,
		paneType: "codex" as const,
		cwd: "/tmp/project",
	}));
	const reorder = vi.fn();
	const noop = () => {};

	try {
		root.render(
			<WorkspaceCanvas
				panes={panes}
				selectedPaneId={panes[0]!.id}
				columns={2}
				rows={1}
				layoutMode="rows"
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelectPane={noop}
				onClosePane={noop}
				onDirectorySelect={noop}
				onDirectoryCancel={noop}
				onChatRef={noop}
				onReorderPanes={reorder}
			/>,
		);
		await tick();

		const handles = document.querySelectorAll<HTMLElement>(
			'[data-testid="agent-dock-handle"]',
		);
		const rows = document.querySelectorAll<HTMLElement>(
			"[data-agent-row-pane-id]",
		);
		if (!handles[0] || !rows[1]) throw new Error("Missing dock test elements");
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => rows[1],
		});

		const pointerDownAccepted = handles[0].dispatchEvent(
			new window.MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
				clientX: 10,
				clientY: 10,
			}),
		);
		expect(pointerDownAccepted).toBe(false);
		expect(document.body.style.userSelect).toBe("none");
		expect(document.documentElement.style.userSelect).toBe("none");
		window.dispatchEvent(
			new window.MouseEvent("pointermove", {
				bubbles: true,
				button: 0,
				clientX: 30,
				clientY: 10,
			}),
		);
		window.dispatchEvent(
			new window.MouseEvent("pointerup", {
				bubbles: true,
				button: 0,
				clientX: 30,
				clientY: 10,
			}),
		);

		expect(document.body.style.userSelect).toBe("");
		expect(document.documentElement.style.userSelect).toBe("");
		expect(reorder).toHaveBeenCalledTimes(1);
		expect(reorder).toHaveBeenCalledWith(0, 1);
	} finally {
		root.unmount();
	}
});

test("grid layout owns wheel scrolling until a chat pane is clicked", async () => {
	const { root } = setupDom();
	const { WorkspaceCanvas } = await import(
		"../src/modules/workspace/components/WorkspaceCanvas.tsx"
	);
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
			<WorkspaceCanvas
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
			/>,
		);
		await tick();

		const grid = document.querySelector<HTMLElement>(
			"[data-agent-grid-scroll-area]",
		);
		const firstChat = document.querySelector<HTMLElement>(
			'[data-testid="agent-chat"]',
		);
		const secondChat = document.querySelectorAll<HTMLElement>(
			'[data-testid="agent-chat"]',
		)[1];
		const firstChatScroll = document.querySelector<HTMLElement>(
			'[data-testid="agent-chat-scroll"]',
		);
		const secondChatScroll = document.querySelectorAll<HTMLElement>(
			'[data-testid="agent-chat-scroll"]',
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
			}),
		);
		expect(grid.scrollTop).toBe(120);

		firstChat.dispatchEvent(
			new window.Event("pointerdown", {
				bubbles: true,
				cancelable: true,
			}),
		);
		const firstChatWheelWasNotCancelled = firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			}),
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
			}),
		);
		expect(secondChatWheelWasNotCancelled).toBe(false);
		expect(grid.scrollTop).toBe(240);
		expect(secondChatScroll.scrollTop).toBe(0);

		secondChat.dispatchEvent(
			new window.Event("pointerdown", {
				bubbles: true,
				cancelable: true,
			}),
		);
		firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			}),
		);
		expect(grid.scrollTop).toBe(360);
		expect(firstChatScroll.scrollTop).toBe(0);

		firstChat.dispatchEvent(
			new window.Event("pointerdown", {
				bubbles: true,
				cancelable: true,
			}),
		);

		firstChatScroll.scrollTop = 300;
		const firstBoundaryDownWasNotCancelled = firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			}),
		);
		expect(firstBoundaryDownWasNotCancelled).toBe(false);
		expect(grid.scrollTop).toBe(480);

		firstChatScroll.scrollTop = 0;
		const firstBoundaryUpWasNotCancelled = firstChat.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: -120,
			}),
		);
		expect(firstBoundaryUpWasNotCancelled).toBe(false);
		expect(grid.scrollTop).toBe(360);
	} finally {
		root.unmount();
	}
});

test("file panes scroll internally only after they are activated", async () => {
	const { root } = setupDom();
	const { WorkspaceCanvas } = await import(
		"../src/modules/workspace/components/WorkspaceCanvas.tsx"
	);
	const pane = {
		id: "chat-with-file" as PaneId,
		title: "Codex",
		agentKind: "codex" as const,
		isClaude: false,
		paneType: "codex" as const,
		cwd: "/tmp/project",
	};
	const selectFile = vi.fn();
	const noop = () => {};

	try {
		root.render(
			<WorkspaceCanvas
				panes={[pane]}
				selectedPaneId={pane.id}
				columns={2}
				rows={1}
				layoutMode="grid"
				theme={testTheme}
				fontSize={13}
				fontFamily="SF Mono"
				onSelectPane={noop}
				onClosePane={noop}
				onDirectorySelect={noop}
				onDirectoryCancel={noop}
				onChatRef={noop}
				auxiliaryPanels={[
					{
						id: "workspace-file",
						onSelect: selectFile,
						render: () => (
							<div data-testid="workspace-file-pane">
								<div
									data-testid="workspace-file-scroll"
									style={{ overflowY: "auto", height: 100 }}
								/>
							</div>
						),
					},
				]}
			/>,
		);
		await tick();

		const grid = document.querySelector<HTMLElement>(
			"[data-agent-grid-scroll-area]",
		);
		const filePane = document.querySelector<HTMLElement>(
			'[data-agent-grid-pane-id="workspace-file"]',
		);
		const fileScroll = document.querySelector<HTMLElement>(
			'[data-testid="workspace-file-scroll"]',
		);
		if (!grid || !filePane || !fileScroll) {
			throw new Error("Missing file pane scroll test elements");
		}
		setScrollMetrics(grid, { clientHeight: 600, scrollHeight: 1200 });
		setScrollMetrics(fileScroll, { clientHeight: 100, scrollHeight: 400 });

		const inactiveWheel = fileScroll.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			}),
		);
		expect(inactiveWheel).toBe(false);
		expect(grid.scrollTop).toBe(120);

		filePane.dispatchEvent(
			new window.Event("pointerdown", { bubbles: true, cancelable: true }),
		);
		const activeWheel = fileScroll.dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			}),
		);
		expect(selectFile).toHaveBeenCalledTimes(1);
		expect(activeWheel).toBe(true);
		expect(grid.scrollTop).toBe(120);
	} finally {
		root.unmount();
	}
});

test("row layout glides horizontally over inactive chat bodies", async () => {
	const { root } = setupDom();
	const { WorkspaceCanvas } = await import(
		"../src/modules/workspace/components/WorkspaceCanvas.tsx"
	);
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
			<WorkspaceCanvas
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
			/>,
		);
		await tick();

		const row = document.querySelector<HTMLElement>(
			"[data-agent-row-scroll-area]",
		);
		const chats = document.querySelectorAll<HTMLElement>(
			'[data-testid="agent-chat"]',
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
			}),
		);
		expect(horizontalWasNotCancelled).toBe(false);
		expect(row.scrollLeft).toBe(120);

		const inactiveVerticalWasNotCancelled = chats[1].dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			}),
		);
		expect(inactiveVerticalWasNotCancelled).toBe(true);
		expect(row.scrollLeft).toBe(120);

		const activeVerticalWasNotCancelled = chats[0].dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: 120,
			}),
		);
		expect(activeVerticalWasNotCancelled).toBe(true);
		expect(row.scrollLeft).toBe(120);

		const activeHorizontalWasNotCancelled = chats[0].dispatchEvent(
			new window.WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaX: 120,
			}),
		);
		expect(activeHorizontalWasNotCancelled).toBe(false);
		expect(row.scrollLeft).toBe(120);
	} finally {
		root.unmount();
	}
});
