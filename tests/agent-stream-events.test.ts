import { describe, expect, test } from "bun:test";
import {
	getToolBlockInitialContent,
	stringifyToolInput,
} from "../src/features/chat/chat-stream-events.ts";
import { extractToolActivities } from "../src/components/chat/chat-agent-utils.ts";

describe("agent stream event normalization", () => {
	/*
	 * This protects parity between Claude and Codex tool streams. Claude often
	 * streams tool input through input_json_delta events, while Codex can emit a
	 * complete synthetic Edit tool input on content_block_start and then stop
	 * immediately. The initial block input must become message content or inline
	 * diff cards render as an empty "Edit" entry.
	 */
	test("preserves tool input included on content_block_start", () => {
		const block = {
			type: "tool_use",
			name: "Edit",
			input: {
				file_path: "src/app.ts",
				old_string: "const value = 1;\n",
				new_string: "const value = 2;\n",
			},
		};

		expect(getToolBlockInitialContent(block)).toBe(
			JSON.stringify(block.input, null, 2)
		);
		expect(
			extractToolActivities([
				{
					id: "tool-1",
					role: "tool",
					toolName: "Edit",
					content: getToolBlockInitialContent(block),
					isStreaming: false,
				},
			])
		).toEqual([
			{
				id: "tool-1",
				toolName: "edit",
				isStreaming: false,
				summary: "app.ts",
			},
		]);
	});

	/*
	 * This protects the other side of the same contract: streamed tools still
	 * start empty when the provider does not include initial input, and string
	 * inputs pass through unchanged so already-serialized provider payloads do
	 * not get double-encoded.
	 */
	test("keeps missing input empty and string input unchanged", () => {
		expect(getToolBlockInitialContent({ type: "tool_use", name: "Bash" })).toBe(
			""
		);
		expect(stringifyToolInput('{"command":"bun test"}')).toBe(
			'{"command":"bun test"}'
		);
		expect(stringifyToolInput(null)).toBe("");
	});
});
