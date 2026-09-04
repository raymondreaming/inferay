import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { describe, expect, test, vi } from "vitest";
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

function setupDom() {
	const dom = new JSDOM('<div id="root"></div>', {
		pretendToBeVisual: true,
		url: "http://localhost/#/agent",
	});
	Object.defineProperty(dom.window, "matchMedia", {
		configurable: true,
		value: () => ({
			addEventListener() {},
			matches: false,
			removeEventListener() {},
		}),
	});
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: dom.window },
		document: { configurable: true, value: dom.window.document },
		navigator: { configurable: true, value: dom.window.navigator },
		Element: { configurable: true, value: dom.window.Element },
		HTMLElement: { configurable: true, value: dom.window.HTMLElement },
		SVGElement: { configurable: true, value: dom.window.SVGElement },
		Node: { configurable: true, value: dom.window.Node },
		MutationObserver: {
			configurable: true,
			value: dom.window.MutationObserver,
		},
		getComputedStyle: {
			configurable: true,
			value: dom.window.getComputedStyle.bind(dom.window),
		},
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { root: createRoot(rootElement), rootElement };
}

describe("Border beam overlay", () => {
	test("mounts the React beam inside an Octane composer overlay", async () => {
		const { BorderBeamOverlay } = await import(
			"../src/shared/ui/BorderBeamOverlay.tsx"
		);
		const { root, rootElement } = setupDom();
		try {
			root.render(<BorderBeamOverlay active />);
			await new Promise((resolve) => setTimeout(resolve, 40));

			const beam = rootElement.querySelector<HTMLElement>("[data-beam]");
			expect(beam).not.toBeNull();
			expect(beam?.hasAttribute("data-active")).toBe(true);
			expect(beam?.style.getPropertyValue("--beam-strength")).toBe("0.7");
			expect(beam?.querySelector("[data-beam-bloom]")).not.toBeNull();
			expect(rootElement.querySelector("style")?.textContent).toContain("2.5s");
		} finally {
			root.unmount();
		}
	});
});
