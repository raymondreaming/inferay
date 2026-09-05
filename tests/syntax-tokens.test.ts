import { expect, test } from "bun:test";
import { tokenizeLine } from "../src/shared/lib/syntax-tokens.ts";

test("decorators and at-signs make progress without losing source text", () => {
	const source = '@decorate("a@b")';
	const tokens = tokenizeLine(source, "ts");
	expect(tokens.map((token) => token.text).join("")).toBe(source);
	expect(tokens[0]).toEqual({ text: "@", type: "punctuation" });
	expect(tokens.find((token) => token.type === "string")?.text).toBe('"a@b"');
});

test("quotes protect comment markers and escaped quotes", () => {
	const tokens = tokenizeLine('"not // a comment\\"" // actual comment', "ts");
	expect(tokens).toEqual([
		{ text: '"not // a comment\\""', type: "string" },
		{ text: " ", type: "default" },
		{ text: "// actual comment", type: "comment" },
	]);
});

test("fallback highlighting keeps language-specific keywords and hash handling", () => {
	expect(tokenizeLine("def", "py")[0]?.type).toBe("keyword");
	expect(tokenizeLine("def", "ts")[0]?.type).toBe("default");
	expect(tokenizeLine("impl", "rs")[0]?.type).toBe("keyword");
	expect(tokenizeLine("defer", "go")[0]?.type).toBe("keyword");
	expect(tokenizeLine("#112233", "css")[0]?.type).toBe("default");
	expect(tokenizeLine("#112233", "py")[0]?.type).toBe("comment");
	expect(tokenizeLine("<div", "tsx")[0]?.type).toBe("tag");
});
