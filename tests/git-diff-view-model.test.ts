import { describe, expect, test } from "bun:test";
import {
	buildMergeConflictLines,
	buildSplitDiffRows,
	type DiffLine,
	type HunkDiff,
	hasLongPatchLine,
	shouldDisableDiffTokenization,
} from "../src/features/git/useGitDiff.ts";

function line(type: DiffLine["type"], content: string, number = 1): DiffLine {
	return {
		number: type === "spacer" || type === "hunk" ? null : number,
		content,
		type,
	};
}

function diff(overrides: Partial<HunkDiff> = {}): HunkDiff {
	return {
		oldLines: [],
		newLines: [],
		isBinary: false,
		isNew: false,
		...overrides,
	};
}

describe("git diff view model", () => {
	test("aligns split rows across old and new full-file panes", () => {
		const rows = buildSplitDiffRows(
			[line("remove", "old"), line("context", "same", 2)],
			[line("spacer", ""), line("add", "new", 2), line("context", "tail", 3)],
			new Map([[1, 0]]),
			0,
			3
		);

		expect(rows).toEqual([
			expect.objectContaining({
				index: 0,
				oldLine: expect.objectContaining({ type: "remove" }),
				newLine: expect.objectContaining({ type: "spacer" }),
				isChanged: true,
			}),
			expect.objectContaining({
				index: 1,
				changeIdx: 0,
				oldLine: expect.objectContaining({ type: "context" }),
				newLine: expect.objectContaining({ type: "add" }),
				isChanged: true,
			}),
			expect.objectContaining({
				index: 2,
				oldLine: expect.objectContaining({ type: "spacer" }),
				newLine: expect.objectContaining({ type: "context" }),
				isChanged: false,
			}),
		]);
	});

	test("represents hunk rows as a single split separator", () => {
		const rows = buildSplitDiffRows(
			[line("hunk", "@@ -1 +1 @@"), line("remove", "old", 1)],
			[line("spacer", ""), line("add", "new", 1)],
			undefined,
			0,
			2
		);

		expect(rows[0]).toEqual(
			expect.objectContaining({
				hunkLine: expect.objectContaining({ content: "@@ -1 +1 @@" }),
				isChanged: false,
			})
		);
		expect(rows[1]?.hunkLine).toBeNull();
	});

	test("converts merge conflict markers into themed diff rows", () => {
		expect(
			buildMergeConflictLines(
				"before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch\nafter"
			)
		).toEqual([
			line("context", "before"),
			line("hunk", "Current change: HEAD"),
			line("remove", "current", 2),
			line("hunk", "Incoming change"),
			line("add", "incoming", 3),
			line("hunk", "End conflict: branch"),
			line("context", "after", 4),
		]);
	});

	test("disables tokenization for long source or patch lines", () => {
		expect(hasLongPatchLine(`+${"x".repeat(1001)}`)).toBe(true);
		expect(
			shouldDisableDiffTokenization(
				diff({ newLines: [line("add", "x".repeat(1001))] })
			)
		).toBe(true);
		expect(
			shouldDisableDiffTokenization(
				diff({
					rawPatch: `diff --git a/file.ts b/file.ts\n+${"x".repeat(1001)}`,
				})
			)
		).toBe(true);
	});
});
