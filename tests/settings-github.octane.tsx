import { JSDOM } from "jsdom";
import { createRoot } from "octane";
import { describe, expect, test, vi } from "vitest";
import type { ForgeAccount } from "../src/modules/repository/adapters/types.ts";
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
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: dom.window },
		document: { configurable: true, value: dom.window.document },
		navigator: { configurable: true, value: dom.window.navigator },
		Element: { configurable: true, value: dom.window.Element },
		HTMLElement: { configurable: true, value: dom.window.HTMLElement },
		SVGElement: { configurable: true, value: dom.window.SVGElement },
		Node: { configurable: true, value: dom.window.Node },
		MouseEvent: { configurable: true, value: dom.window.MouseEvent },
		CustomEvent: { configurable: true, value: dom.window.CustomEvent },
		MutationObserver: {
			configurable: true,
			value: dom.window.MutationObserver,
		},
	});
	const rootElement = dom.window.document.getElementById("root");
	if (!rootElement) throw new Error("Missing root element");
	return { dom, root: createRoot(rootElement), rootElement };
}

describe("GitHub settings", () => {
	test("carries the requested section through the settings event seam", async () => {
		const { OPEN_SETTINGS_MODAL_EVENT, openSettingsModal } = await import(
			"../src/modules/settings/model/settings-events.ts"
		);
		const { dom } = setupDom();
		let requestedSection: string | undefined;
		dom.window.addEventListener(OPEN_SETTINGS_MODAL_EVENT, (event) => {
			requestedSection = (event as CustomEvent<{ section?: string }>).detail
				?.section;
		});

		openSettingsModal("github");

		expect(requestedSection).toBe("github");
	});

	test("renders the connected GitHub identity", async () => {
		const { SettingsGithubAccount } = await import(
			"../src/modules/settings/components/SettingsGithub/index.tsx"
		);
		const account: ForgeAccount = {
			provider: "github",
			host: "github.com",
			login: "raymondreaming",
			name: "Raymond",
			avatarUrl: "https://avatars.example/raymondreaming.png",
			email: "raymond@example.com",
			active: true,
		};
		const { root, rootElement } = setupDom();
		try {
			root.render(<SettingsGithubAccount account={account} />);
			await new Promise((resolve) => setTimeout(resolve, 20));

			const accountRow = rootElement.querySelector(
				'[data-settings-github-account="raymondreaming"]',
			);
			expect(accountRow?.textContent).toContain("Raymond");
			expect(accountRow?.textContent).toContain("@raymondreaming · github.com");
			expect(accountRow?.textContent).toContain("raymond@example.com");
			expect(accountRow?.textContent).toContain("Active");
			expect(accountRow?.querySelector("img")?.getAttribute("src")).toBe(
				account.avatarUrl,
			);
			expect(accountRow?.querySelector("a")?.getAttribute("href")).toBe(
				"https://github.com/raymondreaming",
			);
		} finally {
			root.unmount();
		}
	});
});
