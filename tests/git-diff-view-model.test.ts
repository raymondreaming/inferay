import { describe, expect, test } from "bun:test";
import type {
	DiffLine,
	HunkDiff,
} from "../src/modules/repository/model/types.ts";
import {
	shouldDisableDiffTokenization,
	summarizeHunkDiff,
} from "../src/modules/workbench/diff/model/diff-lines.ts";
import { shouldDisableSnippetHighlighting } from "../src/shared/hooks/useShikiHighlighter.tsx";

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
	test("uses the native tokenization guard", () => {
		expect(
			shouldDisableDiffTokenization(
				diff({
					metadata: {
						stats: { added: 0, removed: 0, hunks: 0, lines: 1 },
						tokenizationDisabled: true,
						maxOldLineChars: 0,
						maxNewLineChars: 1001,
					},
				}),
			),
		).toBe(true);
	});

	test("bounds whole-file snippet highlighting for generated stylesheets", () => {
		expect(shouldDisableSnippetHighlighting([".button { color: red; }"])).toBe(
			false,
		);
		expect(
			shouldDisableSnippetHighlighting([`.generated{${"x".repeat(4_100)}`]),
		).toBe(true);
		expect(
			shouldDisableSnippetHighlighting(
				Array.from({ length: 2_001 }, (_, index) => `.rule-${index}{}`),
			),
		).toBe(true);
	});

	test("summarizes Rust-compacted review diffs without full-file arrays", () => {
		expect(
			summarizeHunkDiff(
				diff({
					metadata: {
						stats: { added: 1, removed: 1, hunks: 1, lines: 5 },
						tokenizationDisabled: false,
						maxOldLineChars: 3,
						maxNewLineChars: 3,
					},
					compactLines: [
						line("hunk", "... 40 unchanged lines hidden ..."),
						line("context", "before"),
						line("remove", "old"),
						line("add", "new"),
						line("context", "after", 2),
					],
				}),
			),
		).toEqual({ added: 1, removed: 1, hunks: 1, lines: 5 });
	});
});
