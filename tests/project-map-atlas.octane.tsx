import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { describe, expect, test, vi } from "vitest";
import type { ProjectMapData } from "../src/components/graph/project-map-model.ts";
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

const data: ProjectMapData = {
	name: "inferay-test",
	cwd: "/inferay-test",
	totalFiles: 2,
	totalLines: 48,
	totalBytes: 480,
	directoryCount: 2,
	symbolCount: 2,
	languageCounts: { TypeScript: 2 },
	truncated: false,
	files: [
		{
			name: "main.ts",
			path: "src/app/main.ts",
			directory: "src/app",
			extension: "ts",
			language: "TypeScript",
			lines: 28,
			bytes: 280,
			symbols: [{ kind: "function", name: "main", line: 1 }],
		},
		{
			name: "View.tsx",
			path: "src/ui/View.tsx",
			directory: "src/ui",
			extension: "tsx",
			language: "TypeScript",
			lines: 20,
			bytes: 200,
			symbols: [{ kind: "component", name: "View", line: 2 }],
		},
	],
	edges: [{ source: "src/app/main.ts", target: "src/ui/View.tsx" }],
};

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: dom.window },
		document: { configurable: true, value: dom.window.document },
		Element: { configurable: true, value: dom.window.Element },
		HTMLElement: { configurable: true, value: dom.window.HTMLElement },
		SVGElement: { configurable: true, value: dom.window.SVGElement },
		Node: { configurable: true, value: dom.window.Node },
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { dom, root: createRoot(rootElement), rootElement };
}

describe("project map atlas", () => {
	test("renders the overview and drills into a real district", async () => {
		const { dom, root, rootElement } = setupDom();
		const { ProjectMapAtlas } = await import(
			"../src/components/graph/ProjectMapAtlas.tsx"
		);
		try {
			root.render(<ProjectMapAtlas data={data} project={null} />);
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(rootElement.textContent).toContain("System map");
			expect(rootElement.textContent).toContain("1 verified link");
			const firstDistrict = rootElement.querySelector("[data-atlas-node]");
			expect(firstDistrict).toBeTruthy();
			firstDistrict!.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(rootElement.textContent).toContain("District · APP");
			expect(rootElement.textContent).toContain("same scene");
			expect(rootElement.textContent).toContain("main");
			expect(rootElement.textContent).toContain("TS · 28L");
		} finally {
			root.unmount();
		}
	});
});
