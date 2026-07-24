import { describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { createRoot, type Root } from "react-dom/client";
import type { HunkDiff } from "../src/features/git/useGitDiff.ts";

mock.module("@stylexjs/stylex", () => ({
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
	diff: HunkDiff
) {
	const { GitDiffView } = await import("../src/pages/Agent/GitDiffView.tsx");
	root.render(
		<GitDiffView
			diff={diff}
			filePath="src/very-long.ts"
			staged={false}
			loading={false}
			hideHeader
			hideToolbar
			onClose={() => {}}
		/>
	);
	await new Promise((resolve) => setTimeout(resolve, 30));
	return rootElement;
}

describe("GitDiffView custom renderer", () => {
	test("renders independently scrollable split panes with synchronized axes", async () => {
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
				'[data-diff-scroll-side="left"]'
			);
			const right = rootElement.querySelector<HTMLElement>(
				'[data-diff-scroll-side="right"]'
			);
			expect(left).toBeTruthy();
			expect(right).toBeTruthy();
			expect(
				rootElement.querySelectorAll(".diff-row").length
			).toBeGreaterThanOrEqual(4);

			left!.scrollLeft = 180;
			left!.scrollTop = 24;
			left!.dispatchEvent(new window.Event("scroll"));
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(right!.scrollLeft).toBe(180);
			expect(right!.scrollTop).toBe(24);

			right!.scrollLeft = 72;
			right!.scrollTop = 48;
			right!.dispatchEvent(new window.Event("scroll"));
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(left!.scrollLeft).toBe(72);
			expect(left!.scrollTop).toBe(48);
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
				0
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
				"const oldValue3999 = 3999;"
			);
		} finally {
			root.unmount();
		}
	});
});

function domWindow() {
	return globalThis.window as Window & typeof globalThis;
}
