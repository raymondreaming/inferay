import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import {
	applyAppBackgroundSurfaces,
	DEFAULT_APP_BACKGROUND_SETTINGS,
	getAppBackgroundSurfaces,
} from "../src/app/model/background.ts";
import { APP_THEMES } from "../src/app/model/theme.ts";

describe("application appearance", () => {
	test("defaults to 7px blur and 17 percent window transparency", () => {
		expect(DEFAULT_APP_BACKGROUND_SETTINGS.glassBlur).toBe(7);
		expect(100 - DEFAULT_APP_BACKGROUND_SETTINGS.glassOpacity).toBe(17);
	});

	test("derives one coherent surface hierarchy for every background mode", () => {
		const solid = getAppBackgroundSurfaces("solid");
		const scene = getAppBackgroundSurfaces("scene");
		const glass = getAppBackgroundSurfaces("glass");

		expect(solid.base).toBe("var(--color-inferay-black)");
		expect(scene.base).toContain("46%");
		expect(scene.raised).toContain("64%");
		expect(scene.canvas).toContain("38%");
		expect(glass.base).toBe("transparent");
		expect(glass.canvas).toBe("transparent");
		expect(glass.raised).toContain("42%");
	});

	test("applies the surface hierarchy where registered color tokens resolve", () => {
		const dom = new JSDOM("<!doctype html><html><body></body></html>");
		const previousDocument = globalThis.document;
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: dom.window.document,
		});

		try {
			applyAppBackgroundSurfaces("glass");

			expect(
				document.documentElement.style.getPropertyValue(
					"--inferay-surface-base",
				),
			).toBe("transparent");
			expect(
				document.documentElement.style.getPropertyValue(
					"--inferay-surface-canvas",
				),
			).toBe("transparent");
			expect(
				document.documentElement.style.getPropertyValue(
					"--inferay-surface-raised",
				),
			).toContain("42%");
		} finally {
			Object.defineProperty(globalThis, "document", {
				configurable: true,
				value: previousDocument,
			});
			dom.window.close();
		}
	});

	test("keeps Midnight on a neutral graphite ramp", () => {
		const midnight = APP_THEMES.find((theme) => theme.id === "midnight");

		expect(midnight?.colors.black).toBe("#0d0e0f");
		expect(midnight?.colors.darkGray).toBe("#151617");
		expect(midnight?.colors.gray).toBe("#1e1f21");
		expect(midnight?.colors.lightGray).toBe("#2a2c2f");
	});
});
