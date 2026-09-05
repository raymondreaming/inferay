import { expect, test } from "bun:test";
import { shouldDisableSnippetHighlighting } from "../src/shared/hooks/useShikiHighlighter.tsx";

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
