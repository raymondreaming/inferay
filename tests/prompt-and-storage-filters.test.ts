import { describe, expect, test } from "bun:test";
import { filterPrompts } from "../src/modules/prompts/prompt-utils.ts";

describe("prompt search filters", () => {
	/*
	 * This protects prompt library filtering across built-in, custom, category,
	 * and free-text search modes. These filters decide which commands users can
	 * discover and run, so the behavior should stay stable without rendering the
	 * prompt UI.
	 */
	test("filters prompts by source, category, and text query", () => {
		const reviewPrompt = {
			name: "Code Review",
			command: "review",
			description: "Find bugs",
			category: "code",
			isBuiltIn: true,
		};
		const releasePrompt = {
			name: "Release Notes",
			command: "release",
			description: "Summarize changes",
			category: "writing",
			isBuiltIn: false,
		};
		const debugPrompt = {
			name: "Debug Help",
			command: "debug",
			description: "Trace runtime issues",
			category: "code",
			isBuiltIn: false,
		};
		const prompts = [reviewPrompt, releasePrompt, debugPrompt];

		expect(filterPrompts(prompts, "builtin", "")).toEqual([reviewPrompt]);
		expect(filterPrompts(prompts, "custom", "")).toEqual([
			releasePrompt,
			debugPrompt,
		]);
		expect(filterPrompts(prompts, "code", "runtime")).toEqual([debugPrompt]);
		expect(filterPrompts(prompts, "all", "REVIEW")).toEqual([reviewPrompt]);
	});
});
