import { expect, test } from "bun:test";
import { createHighlighter } from "shiki";
import {
	highlightDocumentRange,
	registerHighlightDocument,
} from "../src/shared/lib/highlight-engine.ts";

test("grammar checkpoints preserve long multiline comments and cached ranges", async () => {
	const lines = [
		"/*",
		...Array.from({ length: 300 }, () => "const stillComment = 1;"),
		"*/",
		"const activeCode = 2;",
	];
	registerHighlightDocument(
		"long-comment-fixture",
		lines,
		"typescript",
		"github-dark-high-contrast",
	);
	const actual = await highlightDocumentRange("long-comment-fixture", 280, 303);
	const hl = await createHighlighter({
		langs: ["typescript"],
		themes: ["github-dark-high-contrast"],
	});
	const expected = hl.codeToTokensBase(lines.join("\n"), {
		lang: "typescript",
		theme: "github-dark-high-contrast",
	});
	for (const [index, tokens] of actual!) {
		expect(tokens.map((token) => token.content).join("")).toBe(lines[index]);
		expect(tokens[0]?.color).toBe(expected[index]?.[0]?.color);
	}
	expect(
		await highlightDocumentRange("long-comment-fixture", 280, 303),
	).toEqual(actual);
	const cancelled = new AbortController();
	cancelled.abort();
	await expect(
		highlightDocumentRange("long-comment-fixture", 0, 30, cancelled.signal),
	).rejects.toThrow("Cancelled");
	hl.dispose();
}, 10000);
