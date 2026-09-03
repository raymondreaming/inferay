import { JSDOM } from "jsdom";
import { createRoot, type Root } from "octane";
import { describe, expect, test, vi } from "vitest";
import {
	type HunkDiff,
	useGitDiff,
} from "../src/modules/repository/useGitDiff.tsx";
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
	props: (
		...styles: Array<Record<string, unknown> | false | null | undefined>
	) => ({
		className: styles
			.filter(Boolean)
			.map((_, index) => `sx-${index}`)
			.join(" "),
	}),
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
	Object.defineProperty(globalThis, "HTMLElement", {
		configurable: true,
		value: dom.window.HTMLElement,
	});
	Object.defineProperty(globalThis, "SVGElement", {
		configurable: true,
		value: dom.window.SVGElement,
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

	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	Object.defineProperty(rootElement, "clientHeight", {
		configurable: true,
		value: 600,
	});
	return { root: createRoot(rootElement), rootElement };
}

async function renderDiff(
	root: Root,
	rootElement: HTMLElement,
	diff: HunkDiff,
) {
	const { DiffViewer } = await import(
		"../src/modules/workbench/diff/DiffViewer.tsx"
	);
	root.render(
		<DiffViewer
			diff={diff}
			filePath="src/very-long.ts"
			staged={false}
			loading={false}
			hideHeader
			hideToolbar
			onClose={() => {}}
		/>,
	);
	await new Promise((resolve) => setTimeout(resolve, 30));
	return rootElement;
}

describe("DiffViewer custom renderer", () => {
	test("loads one diff when equivalent request objects rerender", async () => {
		const { root, rootElement } = setupDom();
		const previousFetch = globalThis.fetch;
		let fetchCount = 0;
		globalThis.fetch = vi.fn(async () => {
			fetchCount++;
			await new Promise((resolve) => setTimeout(resolve, 15));
			return {
				ok: true,
				json: async () => ({
					oldLines: [],
					newLines: [],
					compactLines: [
						{ number: 1, content: "const value = 1;", type: "add" },
					],
					isBinary: false,
					isNew: true,
				}),
			} as Response;
		});

		function DiffLoader({ revision }: { revision: number }) {
			const { diff } = useGitDiff({
				cwd: "/tmp/inferay-request-identity-test",
				file: "request-identity.ts",
				staged: false,
				view: "review",
			});
			return (
				<div data-revision={revision}>{diff?.compactLines?.[0]?.content}</div>
			);
		}

		try {
			root.render(<DiffLoader revision={0} />);
			await new Promise((resolve) => setTimeout(resolve, 5));
			root.render(<DiffLoader revision={1} />);
			await new Promise((resolve) => setTimeout(resolve, 40));

			expect(fetchCount).toBe(1);
			expect(rootElement.textContent).toContain("const value = 1;");
		} finally {
			root.unmount();
			globalThis.fetch = previousFetch;
		}
	});

	test("uses one vertical scroll owner while keeping horizontal panes independent", async () => {
		const { root, rootElement } = setupDom();
		try {
			const diff: HunkDiff = {
				oldLines: [
					{ number: 1, content: "const oldValue = true;", type: "remove" },
					{ number: 2, content: "x".repeat(400), type: "context" },
				],
				newLines: [
					{ number: 1, content: "const newValue = true;", type: "add" },
					{ number: 2, content: "y".repeat(400), type: "context" },
				],
				isBinary: false,
				isNew: false,
			};

			await renderDiff(root, rootElement, diff);

			const left = rootElement.querySelector<HTMLElement>(
				'[data-diff-scroll-side="left"]',
			);
			const right = rootElement.querySelector<HTMLElement>(
				'[data-diff-scroll-side="right"]',
			);
			expect(left).toBeTruthy();
			expect(right).toBeTruthy();
			expect(
				rootElement.querySelectorAll(".diff-row").length,
			).toBeGreaterThanOrEqual(4);
			expect(
				rootElement.querySelector('[data-diff-minimap-change="left:remove"]'),
			).toBeTruthy();
			expect(
				rootElement.querySelector('[data-diff-minimap-change="right:add"]'),
			).toBeTruthy();

			right!.scrollLeft = 72;
			right!.scrollTop = 48;
			right!.dispatchEvent(new window.Event("scroll"));
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(left!.scrollTop).toBe(48);
			expect(left!.scrollLeft).toBe(0);

			left!.dispatchEvent(
				new window.WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
					deltaY: 30,
				}),
			);
			expect(right!.scrollTop).toBe(78);
			expect(left!.scrollTop).toBe(78);
		} finally {
			root.unmount();
		}
	});

	test("renders deleted files without crashing on spacer-only new panes", async () => {
		const { root, rootElement } = setupDom();
		try {
			const removedLines = Array.from({ length: 104 }, (_, index) => ({
				number: index + 1,
				content: `const value${index} = ${index};`,
				type: "remove" as const,
			}));
			const diff: HunkDiff = {
				oldLines: removedLines,
				newLines: removedLines.map(() => ({
					number: null,
					content: "",
					type: "spacer" as const,
				})),
				isBinary: false,
				isNew: false,
				rawPatch:
					"diff --git a/src/__tests__/keyboardHelpers.test.ts b/src/__tests__/keyboardHelpers.test.ts\ndeleted file mode 100644",
			};

			await renderDiff(root, rootElement, diff);

			expect(rootElement.textContent).toContain("const value0 = 0;");
			expect(rootElement.querySelectorAll(".diff-row").length).toBeGreaterThan(
				0,
			);
		} finally {
			root.unmount();
		}
	});

	test("keeps large split diffs windowed instead of rendering every row", async () => {
		const { root, rootElement } = setupDom();
		try {
			const oldLines = Array.from({ length: 4_000 }, (_, index) => ({
				number: index + 1,
				content: `const oldValue${index} = ${index};`,
				type: index % 25 === 0 ? ("remove" as const) : ("context" as const),
			}));
			const newLines = oldLines.map((line, index) => ({
				number: index + 1,
				content:
					line.type === "remove"
						? `const newValue${index} = ${index + 1};`
						: line.content,
				type: line.type === "remove" ? ("add" as const) : ("context" as const),
			}));
			const diff: HunkDiff = {
				oldLines,
				newLines,
				isBinary: false,
				isNew: false,
			};

			await renderDiff(root, rootElement, diff);

			const renderedRows = rootElement.querySelectorAll(".diff-row").length;
			expect(renderedRows).toBeGreaterThan(0);
			expect(renderedRows).toBeLessThan(250);
			expect(rootElement.textContent).toContain("const oldValue0 = 0;");
			expect(rootElement.textContent).not.toContain(
				"const oldValue3999 = 3999;",
			);
		} finally {
			root.unmount();
		}
	});

	test("renders Rust-compacted review rows in split mode", async () => {
		const { root, rootElement } = setupDom();
		try {
			const diff: HunkDiff = {
				oldLines: [
					{
						number: null,
						content: "... 200 unchanged lines hidden ...",
						type: "hunk",
					},
					{ number: 101, content: "const oldValue = 1;", type: "remove" },
				],
				newLines: [
					{
						number: null,
						content: "... 200 unchanged lines hidden ...",
						type: "hunk",
					},
					{ number: 101, content: "const newValue = 2;", type: "add" },
				],
				compactLines: [
					{
						number: null,
						content: "... 200 unchanged lines hidden ...",
						type: "hunk",
					},
					{ number: 101, content: "const oldValue = 1;", type: "remove" },
					{ number: 101, content: "const newValue = 2;", type: "add" },
				],
				isBinary: false,
				isNew: false,
			};

			await renderDiff(root, rootElement, diff);

			expect(rootElement.textContent).toContain("const oldValue = 1;");
			expect(rootElement.textContent).toContain("const newValue = 2;");
			expect(rootElement.textContent).toContain("200 unchanged lines hidden");
			expect(
				rootElement.querySelector('[data-diff-scroll-side="left"]'),
			).toBeTruthy();
			expect(
				rootElement.querySelector('[data-diff-scroll-side="right"]'),
			).toBeTruthy();
		} finally {
			root.unmount();
		}
	});
});
