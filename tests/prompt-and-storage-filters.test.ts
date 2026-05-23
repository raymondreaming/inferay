import { describe, expect, test } from "bun:test";
import { filterPrompts } from "../src/features/prompts/prompt-utils.ts";
import { normalizeEntries } from "../src/server/services/client-storage.ts";
import { TERMINAL_STATE_STORAGE_KEY } from "../src/lib/client-storage-keys.ts";

describe("prompt search and client storage sync filters", () => {
	/*
	 * This protects prompt library filtering across built-in, custom, category,
	 * and free-text search modes. These filters decide which commands users can
	 * discover and run, so the behavior should stay stable without rendering the
	 * prompt UI.
	 */
	test("filters prompts by source, category, and text query", () => {
		const prompts = [
			{
				name: "Code Review",
				command: "review",
				description: "Find bugs",
				category: "code",
				isBuiltIn: true,
			},
			{
				name: "Release Notes",
				command: "release",
				description: "Summarize changes",
				category: "writing",
				isBuiltIn: false,
			},
			{
				name: "Debug Help",
				command: "debug",
				description: "Trace runtime issues",
				category: "code",
				isBuiltIn: false,
			},
		];

		expect(filterPrompts(prompts, "builtin", "")).toEqual([prompts[0]]);
		expect(filterPrompts(prompts, "custom", "")).toEqual([
			prompts[1],
			prompts[2],
		]);
		expect(filterPrompts(prompts, "code", "runtime")).toEqual([prompts[2]]);
		expect(filterPrompts(prompts, "all", "REVIEW")).toEqual([prompts[0]]);
	});

	/*
	 * This protects the client-storage sync boundary. Only known safe keys and
	 * string/null values should be accepted from the renderer, because this route
	 * persists local UI state and should ignore unrelated or malformed payloads.
	 */
	test("normalizes client-storage sync entries to allowed keys and values", () => {
		expect(
			normalizeEntries({
				[TERMINAL_STATE_STORAGE_KEY]: '{"groups":[]}',
				"terminal-layout-mode": "grid",
				"unknown-key": "value",
				"terminal-main-view": 42,
				"inferay-custom-theme": null,
			})
		).toEqual({
			[TERMINAL_STATE_STORAGE_KEY]: '{"groups":[]}',
			"terminal-layout-mode": "grid",
			"inferay-custom-theme": null,
		});

		expect(normalizeEntries(null)).toEqual({});
		expect(normalizeEntries(["not", "an", "object"])).toEqual({});
	});
});
