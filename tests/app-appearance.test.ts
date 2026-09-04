import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
	APP_THEMES,
	applyAppBackgroundPalette,
	applyAppBackgroundSurfaces,
	applyAppTheme,
	DEFAULT_APP_BACKGROUND_SETTINGS,
} from "../src/app/model/appearance.ts";

// JSDOM does not process Tailwind directives. The rest is the production stylesheet.
const css = readFileSync(
	new URL("../src/design-system/styles.css", import.meta.url),
	"utf8",
)
	.replace(/^@import .*;\n/gm, "")
	.replace(/@theme \{([\s\S]*?)\n\}/, ":root {$1\n}");

describe("application appearance", () => {
	let dom: JSDOM;
	let previousDocument: typeof globalThis.document;
	beforeEach(() => {
		dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
		const style = dom.window.document.createElement("style");
		style.textContent = css;
		dom.window.document.head.append(style);
		previousDocument = globalThis.document;
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: dom.window.document,
		});
	});
	afterEach(() => {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: previousDocument,
		});
		dom.window.close();
	});
	const property = (name: string) =>
		dom.window
			.getComputedStyle(document.documentElement)
			.getPropertyValue(name)
			.trim();

	test("defaults to 7px blur and 17 percent window transparency", () => {
		expect(DEFAULT_APP_BACKGROUND_SETTINGS.glassBlur).toBe(7);
		expect(100 - DEFAULT_APP_BACKGROUND_SETTINGS.glassOpacity).toBe(17);
	});

	test("CSS supplies Black before startup, then switches without stale inline colors", () => {
		expect(property("--color-inferay-black")).toBe("#000000");
		expect(property("--inferay-panel-base-weight")).toBe("45%");
		const initialAccent = property("--color-inferay-accent");
		applyAppTheme("default");
		expect(property("--color-inferay-accent")).toBe(initialAccent);
		applyAppTheme("midnight");
		expect(property("--color-inferay-black")).toBe("#0d0e0f");
		expect(property("--color-inferay-dark-gray")).toBe("#151617");
		expect(property("--color-inferay-gray")).toBe("#1e1f21");
		expect(property("--inferay-panel-base-weight")).toBe("0%");
		applyAppTheme("default");
		expect(property("--inferay-panel-base-weight")).toBe("45%");
		expect(document.documentElement.style.length).toBe(0);
	});

	test("all background modes use CSS at the registered-token root", () => {
		applyAppBackgroundSurfaces("scene");
		expect(property("--inferay-surface-base")).toContain("46%");
		expect(property("--inferay-surface-raised")).toContain("64%");
		applyAppBackgroundSurfaces("glass");
		expect(property("--inferay-surface-base")).toBe("transparent");
		expect(property("--inferay-surface-raised")).toContain("42%");
		applyAppBackgroundSurfaces("solid");
		expect(property("--inferay-surface-base")).toBe(
			"var(--color-inferay-black)",
		);
		expect(document.documentElement.style.length).toBe(0);
	});

	test("custom image colors are cleared when switching to a built-in scene or theme", () => {
		applyAppBackgroundPalette(
			{
				black: "#010203",
				darkGray: "#101112",
				gray: "#202122",
				lightGray: "#303132",
				accent: "#abcdef",
				accentHover: "#bcdef0",
			},
			"custom",
		);
		expect(property("--color-inferay-black")).toBe("#010203");
		applyAppBackgroundPalette(null, "city");
		expect(property("--color-inferay-black")).toBe("#050506");
		expect(document.documentElement.style.length).toBe(0);
		applyAppTheme("midnight");
		expect(property("--color-inferay-black")).toBe("#0d0e0f");
		expect(document.documentElement.dataset.inferayScene).toBeUndefined();
	});

	test("theme previews use the same palette while the opposite theme is active", () => {
		for (const theme of APP_THEMES) {
			applyAppTheme(theme.id === "default" ? "midnight" : "default");
			const preview = document.createElement("div");
			preview.dataset.inferayTheme = theme.id;
			document.body.append(preview);
			expect(
				dom.window
					.getComputedStyle(preview)
					.getPropertyValue("--color-inferay-black")
					.trim(),
			).toBe(theme.id === "default" ? "#000000" : "#0d0e0f");
			preview.remove();
		}
	});
});
