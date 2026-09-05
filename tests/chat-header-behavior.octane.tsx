import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { expect, test, vi } from "vitest";
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
	Object.defineProperty(globalThis, "SVGElement", {
		configurable: true,
		value: dom.window.SVGElement,
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
		configurable: true,
		value: () => {},
	});
	Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
		configurable: true,
		value: () => {},
	});
	Object.defineProperty(dom.window, "innerHeight", {
		configurable: true,
		value: 800,
	});
	Object.defineProperty(dom.window, "innerWidth", {
		configurable: true,
		value: 1200,
	});

	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { dom, root: createRoot(rootElement), rootElement };
}

test("workspace control shows the directory and opens its context", async () => {
	const { dom, root, rootElement } = setupDom();
	try {
		const { AgentWorkspaceControl } = await import(
			"../src/modules/conversation/components/AgentChatHeader/index.tsx"
		);
		const openContext = vi.fn();
		root.render(
			<AgentWorkspaceControl cwd="/tmp/inferay" onAgentContext={openContext} />,
		);

		await new Promise((resolve) => setTimeout(resolve, 20));

		rootElement
			.querySelector("button")!
			.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(rootElement.textContent).toContain("inferay");
		expect(rootElement.querySelector("button")?.title).toBe("/tmp/inferay");
		expect(openContext).toHaveBeenCalledTimes(1);
		root.render(<AgentWorkspaceControl />);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(rootElement.querySelector("button")).toBeNull();
	} finally {
		root.unmount();
	}
});
