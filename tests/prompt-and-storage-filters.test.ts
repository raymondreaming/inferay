import { describe, expect, test } from "bun:test";
import { filterPrompts } from "../src/features/prompts/prompt-utils.ts";
import { AGENT_STATE_STORAGE_KEY } from "../src/lib/client-storage-keys.ts";
import { normalizeEntries } from "../src/server/routes/api.ts";

describe("prompt search and client storage sync filters", () => {
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

	/*
	 * This protects the client-storage sync boundary. Only known safe keys and
	 * string/null values should be accepted from the renderer, because this route
	 * persists local UI state and should ignore unrelated or malformed payloads.
	 */
	test("normalizes client-storage sync entries to allowed keys and values", () => {
		expect(
			normalizeEntries({
				[AGENT_STATE_STORAGE_KEY]: '{"groups":[]}',
				"agent-layout-mode": "grid",
				"unknown-key": "value",
				"agent-main-view": 42,
				"inferay-custom-theme": null,
			})
		).toEqual({
			"agent-layout-mode": "grid",
			"inferay-custom-theme": null,
		});

		expect(
			normalizeEntries({
				[AGENT_STATE_STORAGE_KEY]: null,
			})
		).toEqual({
			[AGENT_STATE_STORAGE_KEY]: null,
		});

		expect(normalizeEntries(null)).toEqual({});
		expect(normalizeEntries(["not", "an", "object"])).toEqual({});
	});
});
