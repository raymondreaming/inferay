import { describe, expect, test } from "bun:test";
import {
	APP_REGION_DRAG_CLASS,
	APP_REGION_NO_DRAG_CLASS,
} from "../src/lib/app-theme.ts";

describe("desktop drag region compatibility", () => {
	test("preserves the established renderer class names", () => {
		expect(APP_REGION_DRAG_CLASS).toBe("electrobun-webkit-app-region-drag");
		expect(APP_REGION_NO_DRAG_CLASS).toBe(
			"electrobun-webkit-app-region-no-drag"
		);
	});
});
