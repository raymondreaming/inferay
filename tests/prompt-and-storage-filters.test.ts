import { describe, expect, test } from "bun:test";
import { filterPrompts } from "../src/features/prompts/prompt-utils.ts";
import { normalizeEntries } from "../src/server/services/client-storage.ts";
import {
	CHAT_MESSAGES_STORAGE_KEY_PREFIX,
	CHAT_QUEUE_KEY_PREFIX,
	isChatMessagesStorageKey,
	isChatQueueStorageKey,
	TERMINAL_LAYOUT_MODE_STORAGE_KEY,
	TERMINAL_MAIN_VIEW_STORAGE_KEY,
	TERMINAL_STATE_STORAGE_KEY,
} from "../src/lib/client-storage-keys.ts";

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
		const [builtIn, releaseNotes, debugHelp] = prompts;
		if (!builtIn || !releaseNotes || !debugHelp) {
			throw new Error("Prompt fixtures failed to initialize.");
		}

		expect(filterPrompts(prompts, "builtin", "")).toEqual([builtIn]);
		expect(filterPrompts(prompts, "custom", "")).toEqual([
			releaseNotes,
			debugHelp,
		]);
		expect(filterPrompts(prompts, "code", "runtime")).toEqual([debugHelp]);
		expect(filterPrompts(prompts, "all", "REVIEW")).toEqual([builtIn]);
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
				[TERMINAL_LAYOUT_MODE_STORAGE_KEY]: "grid",
				"unknown-key": "value",
				[TERMINAL_MAIN_VIEW_STORAGE_KEY]: 42,
				"inferay-custom-theme": null,
			})
		).toEqual({
			[TERMINAL_STATE_STORAGE_KEY]: '{"groups":[]}',
			[TERMINAL_LAYOUT_MODE_STORAGE_KEY]: "grid",
			"inferay-custom-theme": null,
		});

		expect(normalizeEntries(null)).toEqual({});
		expect(normalizeEntries(["not", "an", "object"])).toEqual({});
	});

	test("distinguishes chat message history from other chat pane storage", () => {
		expect(
			isChatMessagesStorageKey(`${CHAT_MESSAGES_STORAGE_KEY_PREFIX}pane-1`)
		).toBe(true);
		expect(isChatMessagesStorageKey(`${CHAT_QUEUE_KEY_PREFIX}pane-1`)).toBe(
			false
		);
		expect(isChatQueueStorageKey(`${CHAT_QUEUE_KEY_PREFIX}pane-1`)).toBe(true);
	});
});
