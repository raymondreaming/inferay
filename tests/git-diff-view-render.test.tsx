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
	const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
	const raf = (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 0) as unknown as number;
	const caf = (handle: number) => clearTimeout(handle);

	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		SVGElement: dom.window.SVGElement,
		ResizeObserver: TestResizeObserver,
		requestAnimationFrame: raf,
		cancelAnimationFrame: caf,
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
	const { GitDiffView } = await import("../src/pages/Terminal/GitDiffView.tsx");
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
	test("renders split panes side by side and clips long code rows", async () => {
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

			const row = Array.from(rootElement.querySelectorAll("div")).find(
				(node) => {
					const children = Array.from(node.children);
					return (
						children.length === 2 &&
						children.every(
							(child) =>
								child instanceof domWindow().HTMLDivElement &&
								(child as HTMLElement).style.flexGrow === "1"
						)
					);
				}
			) as HTMLElement | undefined;
			expect(row).toBeTruthy();

			const panes = Array.from(row!.children) as HTMLElement[];
			expect(panes).toHaveLength(2);
			expect(panes[0]?.style.minWidth).toBe("0px");
			expect(panes[1]?.style.minWidth).toBe("0px");

			const codeRows = Array.from(
				row!.querySelectorAll(".diff-row")
			) as HTMLElement[];
			expect(codeRows.length).toBeGreaterThanOrEqual(2);
			expect(codeRows[0]?.style.width).toBe("100%");
			expect(
				(codeRows[0]!.lastElementChild as HTMLElement | null)?.style.minWidth
			).toBe("0px");
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
});

function domWindow() {
	return globalThis.window as Window & typeof globalThis;
}
