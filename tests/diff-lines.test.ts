import { describe, expect, test } from "bun:test";
import type { DiffLine } from "../src/modules/repository/hooks/useGitDiff.tsx";
import {
	alignDiffLines,
	buildInlineHunkLines,
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

	test("builds compact context and preserves removal-before-addition order", () => {
		const oldLines = Array.from(
			{ length: 12 },
			(_, index): DiffLine => ({
				number: index + 1,
				content: index === 6 ? "old" : `line ${index}`,
				type: index === 6 ? "remove" : "context",
			}),
		);
		const newLines = oldLines.map(
			(line, index): DiffLine => ({
				...line,
				content: index === 6 ? "new" : line.content,
				type: index === 6 ? "add" : "context",
			}),
		);
		const result = buildInlineHunkLines(oldLines, newLines);
		expect(result.some((line) => line.type === "hunk")).toBe(true);
		expect(result.findIndex((line) => line.content === "old")).toBeLessThan(
			result.findIndex((line) => line.content === "new"),
		);
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
