import { describe, expect, test } from "bun:test";
import type { DiffLine } from "../src/modules/repository/model/types.ts";
import {
	alignDiffLines,
	buildMinimapSegments,
} from "../src/modules/workbench/diff/model/diff-lines.ts";

describe("diff line model", () => {
	test("aligns panes without changing existing rows", () => {
		const line: DiffLine = { number: 1, content: "old", type: "remove" };
		expect(alignDiffLines([line], 2)).toEqual([
			line,
			{ number: null, content: "", type: "spacer" },
		]);
	});

	test("keeps left removals and right additions as separate minimap segments", () => {
		const removed: DiffLine[] = [{ number: 1, content: "old", type: "remove" }];
		const added: DiffLine[] = [{ number: 1, content: "new", type: "add" }];
		expect([
			...buildMinimapSegments(removed, "left"),
			...buildMinimapSegments(added, "right"),
		]).toMatchObject([
			{ type: "remove", side: "left" },
			{ type: "add", side: "right" },
		]);
	});
});
