import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";

const mock = Object.assign(vi.fn, {
	module: (path: string, factory: () => unknown) => vi.doMock(path, factory),
});

mock.module("../src/adapters/backend/websocket.ts", () => ({
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

test("idle status does not render an obsolete offline queue notice", async () => {
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
		expect(rootElement.textContent).not.toContain("Offline");
		expect(rootElement.textContent).not.toContain("sends are queued");
	} finally {
		root.unmount();
	}
});

test("active status keeps elapsed time and a compact stop control", async () => {
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
	const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			prepared: {
				hunks: [
					{
						oldStart: 2,
						oldCount: 1,
						newStart: 2,
						newCount: 1,
						lines: [
							{
								type: "removed",
								text: "const value = 'old';",
								oldLineNum: 2,
								segments: [
									{ text: "const value = '", changed: false },
									{ text: "old", changed: true },
									{ text: "';", changed: false },
								],
							},
							{ type: "added", text: "const value = 'new';", newLineNum: 2 },
						],
					},
				],
			},
		}),
	);
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
		fetchMock.mockRestore();
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

test("large inline edits mount a bounded window of changed rows", async () => {
	const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			prepared: {
				hunks: [
					{
						oldStart: 1,
						oldCount: 300,
						newStart: 1,
						newCount: 300,
						lines: [
							...Array.from({ length: 300 }, (_, i) => ({
								type: "removed",
								text: `before ${i}`,
								oldLineNum: i + 1,
							})),
							...Array.from({ length: 300 }, (_, i) => ({
								type: "added",
								text: `after ${i}`,
								newLineNum: i + 1,
							})),
						],
					},
				],
			},
		}),
	);
	const { root, rootElement } = setupDom();
	try {
		const { MiniEditDiff } = await import(
			"../src/modules/conversation/components/ChatEditDiff.tsx"
		);
		root.render(
			<MiniEditDiff
				filePath="large-window.txt"
				oldStr={Array.from({ length: 300 }, (_, i) => `before ${i}`).join("\n")}
				newStr={Array.from({ length: 300 }, (_, i) => `after ${i}`).join("\n")}
			/>,
		);
		await tick(80);
		const rows = rootElement.querySelectorAll("[data-edit-diff-line]");
		expect(rows.length).toBe(40);
		expect(rows[0]?.getAttribute("data-edit-diff-line")).toBe("0");
	} finally {
		root.unmount();
		fetchMock.mockRestore();
	}
});

test("native edit failures stay visible without running a frontend diff", async () => {
	const fetchMock = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(
			Response.json(
				{ error: "Edit diff exceeds the supported size" },
				{ status: 422 },
			),
		);
	const { root, rootElement } = setupDom();
	try {
		const { MiniEditDiff } = await import(
			"../src/modules/conversation/components/ChatEditDiff.tsx"
		);
		root.render(
			<MiniEditDiff filePath="error.txt" oldStr="a" newStr="b" isStreaming />,
		);
		await tick();
		expect(fetchMock).not.toHaveBeenCalled();
		root.render(<MiniEditDiff filePath="error.txt" oldStr="a" newStr="b" />);
		await vi.waitFor(() =>
			expect(rootElement.textContent).toContain(
				"Edit diff exceeds the supported size",
			),
		);
		expect(rootElement.querySelectorAll("[data-edit-diff-line]")).toHaveLength(
			0,
		);
	} finally {
		root.unmount();
		fetchMock.mockRestore();
	}
});

test("long transcripts mount a measured window and move it when scrolling", async () => {
	const { root, rootElement } = setupDom();
	const scrollElement = document.createElement("div");
	rootElement.parentElement!.append(scrollElement);
	scrollElement.append(rootElement);
	Object.defineProperties(scrollElement, {
		clientHeight: { value: 600 },
		scrollHeight: { value: 32_000 },
	});
	try {
		const { ChatMessageList } = await import(
			"../src/modules/conversation/components/ChatMessageList.tsx"
		);
		root.render(
			<ChatMessageList
				paneId="long-transcript"
				messages={Array.from({ length: 200 }, (_, index) => ({
					id: `message-${index}`,
					role: "user" as const,
					content: `Prompt ${index}`,
				}))}
				scrollElementRef={{ current: scrollElement }}
				expandedTools={new Set()}
				toggleTool={() => {}}
				checkpoints={[]}
				revertCheckpoint={() => {}}
				slashCommandNames={[]}
				stickToBottom={false}
			/>,
		);
		await tick(80);
		const list = rootElement.firstElementChild as HTMLElement;
		vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => ({
			top: -scrollElement.scrollTop,
			bottom: 32_000 - scrollElement.scrollTop,
			left: 0,
			right: 600,
			width: 600,
			height: 32_000,
			x: 0,
			y: -scrollElement.scrollTop,
			toJSON() {},
		}));
		expect(
			rootElement.querySelectorAll("[data-chat-row-key]").length,
		).toBeLessThanOrEqual(48);
		scrollElement.scrollTop = 16_000;
		scrollElement.dispatchEvent(new window.Event("scroll"));
		await tick(80);
		const rows = rootElement.querySelectorAll("[data-chat-row-index]");
		expect(rows.length).toBe(48);
		expect(Number(rows[0]?.getAttribute("data-chat-row-index"))).toBe(92);
		expect(rootElement.textContent).toContain("Prompt 100");
		expect(rootElement.textContent).not.toContain("Prompt 0");
	} finally {
		root.unmount();
	}
});

test("short tool milestones fill a tall viewport without mounting the whole timeline", async () => {
	const { root, rootElement } = setupDom();
	const scrollElement = document.createElement("div");
	rootElement.parentElement!.append(scrollElement);
	scrollElement.append(rootElement);
	Object.defineProperties(scrollElement, {
		clientHeight: { value: 1600 },
		scrollHeight: { value: 3200 },
	});
	const previousObserver = globalThis.ResizeObserver;
	class MeasuredObserver {
		private active = true;
		private callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback) {
			this.callback = callback;
		}
		observe(target: Element) {
			queueMicrotask(() => {
				if (this.active)
					this.callback(
						[{ target } as ResizeObserverEntry],
						this as unknown as ResizeObserver,
					);
			});
		}
		unobserve() {}
		disconnect() {
			this.active = false;
		}
	}
	Object.defineProperty(globalThis, "ResizeObserver", {
		configurable: true,
		writable: true,
		value: MeasuredObserver,
	});
	const rectangles = vi
		.spyOn(HTMLElement.prototype, "getBoundingClientRect")
		.mockImplementation(function (this: HTMLElement) {
			const top =
				this.parentElement === rootElement ? -scrollElement.scrollTop : 0;
			return {
				top,
				bottom: top + 16,
				left: 0,
				right: 600,
				width: 600,
				height: 16,
				x: 0,
				y: top,
				toJSON() {},
			};
		});
	try {
		const { ChatMessageList } = await import(
			"../src/modules/conversation/components/ChatMessageList.tsx"
		);
		root.render(
			<ChatMessageList
				paneId="short-tools"
				messages={Array.from({ length: 200 }, (_, index) => ({
					id: `tool-${index}`,
					role: "tool" as const,
					toolName: "Read",
					content: `File ${index}`,
					render: {
						version: 1 as const,
						kind: "tool-group" as const,
						groupId: "tool-0",
						hidden: false,
						toolInput: null,
					},
				}))}
				scrollElementRef={{ current: scrollElement }}
				expandedTools={new Set()}
				toggleTool={() => {}}
				checkpoints={[]}
				revertCheckpoint={() => {}}
				slashCommandNames={[]}
				stickToBottom={false}
			/>,
		);
		await tick(100);
		scrollElement.scrollTop = 0;
		scrollElement.dispatchEvent(new window.Event("scroll"));
		await vi.waitFor(() => {
			const rows = rootElement.querySelectorAll("[data-chat-row-key]");
			expect(rows.length).toBeGreaterThanOrEqual(100);
			expect(rows.length).toBeLessThan(140);
		});
	} finally {
		root.unmount();
		rectangles.mockRestore();
		Object.defineProperty(globalThis, "ResizeObserver", {
			configurable: true,
			writable: true,
			value: previousObserver,
		});
	}
});
