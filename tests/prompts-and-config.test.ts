import { describe, expect, test } from "bun:test";
import { deepMergeRecords } from "../src/server/services/config-manager.ts";
import { mergePrompts } from "../src/server/services/prompts.ts";

function prompt(overrides = {}) {
	return {
		_id: "prompt-1",
		name: "Explain",
		description: "Explain code",
		command: "explain",
		promptTemplate: "Explain {args}",
		tags: [],
		isBuiltIn: true,
		executionCount: 0,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("prompt and config merge behavior", () => {
	/*
	 * This protects the prompt catalog's merge priority. Built-in prompts are
	 * shipped with the app, but user-local usage stats must survive upgrades and
	 * command migrations so ranking and recency do not reset after a release.
	 */
	test("keeps bundled built-ins while carrying forward local usage by id or command", () => {
		const bundled = [
			prompt({ _id: "builtin-current", command: "explain", executionCount: 0 }),
			prompt({
				_id: "custom-bundled",
				command: "ship",
				isBuiltIn: false,
				name: "Bundled custom",
			}),
		];
		const local = [
			prompt({
				_id: "builtin-old",
				command: "explain",
				executionCount: 9,
				lastUsed: 123,
			}),
			prompt({
				_id: "custom-local",
				command: "review",
				isBuiltIn: false,
				name: "Local custom",
			}),
			prompt({
				_id: "custom-conflicts-with-built-in-command",
				command: "explain",
				isBuiltIn: false,
			}),
		];

		expect(mergePrompts(bundled, local)).toEqual([
			expect.objectContaining({
				_id: "builtin-current",
				command: "explain",
				isBuiltIn: true,
				executionCount: 9,
				lastUsed: 123,
			}),
			expect.objectContaining({
				_id: "custom-bundled",
				command: "ship",
			}),
			expect.objectContaining({
				_id: "custom-local",
				command: "review",
			}),
		]);
	});

	/*
	 * This protects config sync semantics shared by base and local config files.
	 * Nested provider settings should merge without losing sibling keys, while
	 * arrays and primitive values should replace wholesale to avoid stale local
	 * search paths or model selections lingering after an update.
	 */
	test("deep-merges records but replaces arrays and primitive values", () => {
		expect(
			deepMergeRecords(
				{
					openai: { api_key: "old", model: "gpt-5.4" },
					search_folders: ["~/Desktop"],
					build_agent: "claude",
				},
				{
					openai: { model: "gpt-5.5" },
					search_folders: ["~/Code"],
					build_agent: "codex",
				}
			)
		).toEqual({
			openai: { api_key: "old", model: "gpt-5.5" },
			search_folders: ["~/Code"],
			build_agent: "codex",
		});
	});
});
