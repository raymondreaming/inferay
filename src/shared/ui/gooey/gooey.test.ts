import { describe, expect, test } from "bun:test";
import { roundedRectPath } from "./geometry.ts";
import { parseShadow } from "./shadow.ts";

describe("gooey geometry", () => {
	test("builds a rounded silhouette in local coordinates", () => {
		expect(roundedRectPath(2, 3, 20, 10, [4, 4, 4, 4])).toBe(
			"M 6 3 H 18 A 4 4 0 0 1 22 7 V 9 A 4 4 0 0 1 18 13 H 6 A 4 4 0 0 1 2 9 V 7 A 4 4 0 0 1 6 3 Z",
		);
	});

	test("parses the supported outer shadow contract", () => {
		expect(parseShadow("0px 8px 24px rgba(0,0,0,.22)")).toEqual([
			{
				inset: false,
				x: 0,
				y: 8,
				blur: 24,
				spread: 0,
				color: "rgba(0,0,0,.22)",
			},
		]);
	});
});
