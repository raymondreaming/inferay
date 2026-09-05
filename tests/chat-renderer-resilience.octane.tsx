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

test("native Markdown renders nested tokens once per shared input", async () => {
	const { queryClient } = await import("../src/shared/lib/query-client.ts");
	queryClient.clear();
	const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
		Response.json({
			version: 1,
			blocks: [
				{
					type: "blockquote",
					content: "",
					children: [
						{
							type: "paragraph",
							content: "",
							tokens: [
								{
									type: "bold",
									text: "nested",
									children: [{ type: "italic", text: "nested" }],
								},
							],
						},
					],
				},
				{
					type: "table",
					content: "",
					rows: [
						[[{ type: "text", text: "Header" }]],
						[[{ type: "code", text: "Cell" }]],
					],
				},
				{
					type: "paragraph",
					content: "",
					tokens: [{ type: "markdown_path", text: "docs/guide.md" }],
				},
			],
		}),
	);
	const { root, rootElement } = setupDom();
	const openPath = vi.fn();
	try {
		const { Markdown } = await import(
			"../src/modules/conversation/components/ChatRichContent.tsx"
		);
		const { MarkdownPreview } = await import(
			"../src/modules/workbench/diff/components/MarkdownPreview.tsx"
		);
		root.render(
			<div>
				<Markdown text="shared-input" onMdFileClick={openPath} />
				<Markdown text="shared-input" />
				<MarkdownPreview content="shared-input" />
			</div>,
		);
		await vi.waitFor(() =>
			expect(rootElement.querySelectorAll("table")).toHaveLength(3),
		);
		expect(rootElement.querySelectorAll("strong em")).toHaveLength(3);
		expect(rootElement.querySelectorAll("td code")).toHaveLength(3);
		const pathButton = Array.from(rootElement.querySelectorAll("button")).find(
			(button) => button.textContent === "docs/guide.md",
		);
		pathButton?.click();
		expect(openPath).toHaveBeenCalledWith("docs/guide.md");
		// Chat and document interpretation differ, but identical chat readers share work.
		expect(fetchMock).toHaveBeenCalledTimes(2);
	} finally {
		root.unmount();
		queryClient.clear();
		fetchMock.mockRestore();
	}
});

test("document Markdown shows raw pending and failed input and rejects stale results", async () => {
	const { queryClient } = await import("../src/shared/lib/query-client.ts");
	queryClient.clear();
	const pending: Array<(response: Response) => void> = [];
	const fetchMock = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
	const { root, rootElement } = setupDom();
	try {
		const { MarkdownPreview } = await import(
			"../src/modules/workbench/diff/components/MarkdownPreview.tsx"
		);
		root.render(<MarkdownPreview content="**first document**" />);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		expect(rootElement.textContent).toContain("**first document**");
		expect(rootElement.querySelector("strong")).toBeNull();
		root.render(<MarkdownPreview content="**second document**" />);
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		pending[0]!(
			Response.json({
				version: 1,
				blocks: [
					{
						type: "paragraph",
						content: "",
						tokens: [{ type: "bold", text: "stale prepared document" }],
					},
				],
			}),
		);
		await tick();
		expect(rootElement.textContent).toContain("**second document**");
		expect(rootElement.textContent).not.toContain("stale prepared document");
		pending[1]!(
			Response.json({ error: "Preview size limit" }, { status: 422 }),
		);
		await vi.waitFor(() =>
			expect(rootElement.textContent).toContain(
				"Markdown preview unavailable.",
			),
		);
		expect(rootElement.textContent).toContain("**second document**");
		expect(rootElement.querySelector("strong")).toBeNull();
	} finally {
		root.unmount();
		queryClient.clear();
		fetchMock.mockRestore();
	}
});

test("streaming Markdown retains prepared output and bounds in-flight work until finalization", async () => {
	const { queryClient } = await import("../src/shared/lib/query-client.ts");
	queryClient.clear();
	const pending: Array<(response: Response) => void> = [];
	const fetchMock = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
	const prepared = (text: string) =>
		Response.json({
			version: 1,
			blocks: [
				{ type: "paragraph", content: "", tokens: [{ type: "bold", text }] },
			],
		});
	const { root, rootElement } = setupDom();
	try {
		const { Markdown } = await import(
			"../src/modules/conversation/components/ChatRichContent.tsx"
		);
		root.render(<Markdown text="one" streaming />);
		await vi.waitFor(() => expect(pending).toHaveLength(1));
		pending[0]!(prepared("prepared one"));
		await vi.waitFor(() =>
			expect(rootElement.querySelector("strong")?.textContent).toBe(
				"prepared one",
			),
		);
		root.render(<Markdown text="one two" streaming />);
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		expect(rootElement.querySelector("strong")?.textContent).toBe(
			"prepared one",
		);
		root.render(<Markdown text="one two three" streaming />);
		await tick(140);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(rootElement.querySelector("strong")?.textContent).toBe(
			"prepared one",
		);
		pending[1]!(prepared("prepared two"));
		await vi.waitFor(() =>
			expect(rootElement.querySelector("strong")?.textContent).toBe(
				"prepared two",
			),
		);
		root.render(<Markdown text="one two three final" />);
		await tick(20);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(
			JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
		).toMatchObject({ text: "one two three final", streaming: false });
		pending[2]!(prepared("prepared final"));
		await vi.waitFor(() =>
			expect(rootElement.querySelector("strong")?.textContent).toBe(
				"prepared final",
			),
		);
		root.render(
			<Markdown key="unchanged-final" text="unchanged final text" streaming />,
		);
		await vi.waitFor(() => expect(pending).toHaveLength(4));
		pending[3]!(prepared("prepared streaming ending"));
		await vi.waitFor(() =>
			expect(rootElement.querySelector("strong")?.textContent).toBe(
				"prepared streaming ending",
			),
		);
		root.render(<Markdown key="unchanged-final" text="unchanged final text" />);
		await vi.waitFor(() => expect(pending).toHaveLength(5));
		expect(rootElement.querySelector("strong")?.textContent).toBe(
			"prepared streaming ending",
		);
		expect(rootElement.textContent).not.toContain("unchanged final text");
		pending[4]!(prepared("prepared completed ending"));
		await vi.waitFor(() =>
			expect(rootElement.querySelector("strong")?.textContent).toBe(
				"prepared completed ending",
			),
		);
	} finally {
		root.unmount();
		queryClient.clear();
		fetchMock.mockRestore();
	}
});

test("tool rows and question controls consume native descriptors", async () => {
	const { root, rootElement } = setupDom();
	const send = vi.fn();
	try {
		const { ChatMessageList } = await import(
			"../src/modules/conversation/components/ChatMessageList.tsx"
		);
		const { AskUserQuestionCard } = await import(
			"../src/modules/conversation/components/ChatRichContent.tsx"
		);
		root.render(
			<>
				<ChatMessageList
					paneId="native-tool-descriptors"
					scrollElementRef={{ current: rootElement }}
					stickToBottom={false}
					messages={[
						{
							id: "native-tool",
							role: "tool",
							toolName: "exec",
							content: '{"command":"legacy command should not be interpreted"}',
							render: {
								version: 1,
								kind: "tool-group",
								groupId: "native-tool",
								hidden: false,
								toolInput: null,
								trailingOutput: "passed",
								display: { label: "Running Rust tests" },
								summary: { type: "command", value: "cargo test" },
							},
						},
					]}
					expandedTools={new Set(["native-tool"])}
					toggleTool={() => {}}
					checkpoints={[]}
					revertCheckpoint={() => {}}
					slashCommandNames={[]}
				/>
				<AskUserQuestionCard
					content="unparsed legacy question"
					nativeQuestions={[
						{
							question: "Choose a test target",
							header: "Target",
							options: [{ label: "Workspace" }],
						},
					]}
					onSendMessage={send}
				/>
			</>,
		);
		await tick();
		expect(rootElement.textContent).toContain("Running Rust tests");
		expect(rootElement.textContent).toContain("cargo test");
		expect(rootElement.textContent).not.toContain(
			"legacy command should not be interpreted",
		);
		expect(rootElement.textContent).toContain("Choose a test target");
		const buttons = Array.from(rootElement.querySelectorAll("button"));
		buttons
			.find((button) => button.textContent?.includes("Workspace"))!
			.click();
		await tick();
		rootElement.querySelectorAll("button").forEach((button) => {
			if (button.textContent?.includes("Send selections")) button.click();
		});
		expect(send).toHaveBeenCalledWith("**Target**: Workspace");
	} finally {
		root.unmount();
	}
});
