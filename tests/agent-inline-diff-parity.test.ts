import { describe, expect, test } from "bun:test";
import {
	applyEditsSequentially,
	computeDiffHunks,
	summarizeHunks,
} from "../src/components/chat/chat-edit-diff-utils.ts";
import {
	buildRenderItems,
	getEditFilePath,
	type RenderChatMessage as ChatMessage,
} from "../src/components/chat/chat-message-render-utils.ts";
import { getToolBlockInitialContent } from "../src/features/chat/chat-stream-events.ts";

type FakeStreamEvent =
	| {
			type: "content_block_start";
			content_block: {
				type: "tool_use";
				name: string;
				input?: unknown;
			};
	  }
	| {
			type: "content_block_delta";
			delta: { type: "input_json_delta"; partial_json: string };
	  }
	| { type: "content_block_stop" };

function editPayload() {
	return {
		file_path: "src/example.ts",
		old_string: "export const answer = 41;\n",
		new_string: "export const answer = 42;\n",
	};
}

function toolMessageFromEvents(events: FakeStreamEvent[]): ChatMessage {
	const message: ChatMessage = {
		id: "tool-1",
		role: "tool",
		toolName: "Edit",
		content: "",
		isStreaming: false,
	};

	for (const event of events) {
		if (event.type === "content_block_start") {
			message.toolName = event.content_block.name;
			message.content = getToolBlockInitialContent(event.content_block);
			message.isStreaming = true;
		} else if (event.type === "content_block_delta") {
			message.content += event.delta.partial_json;
		} else if (event.type === "content_block_stop") {
			message.isStreaming = false;
		}
	}

	return message;
}

describe("Claude and Codex inline edit diff parity", () => {
	/*
	 * This protects the exact Codex regression where a synthetic Edit tool
	 * arrived as a complete input object on content_block_start and then stopped
	 * without input_json_delta chunks. The resulting tool message must contain
	 * parseable edit JSON so the inline diff card has real changed lines.
	 */
	test("Codex-style immediate Edit input renders as an inline diff candidate", () => {
		const message = toolMessageFromEvents([
			{
				type: "content_block_start",
				content_block: {
					type: "tool_use",
					name: "Edit",
					input: editPayload(),
				},
			},
			{ type: "content_block_stop" },
		]);

		expect(message.content).toBe(JSON.stringify(editPayload(), null, 2));
		expect(getEditFilePath(message)).toBe("src/example.ts");
		expect(buildRenderItems([message])).toEqual([{ type: "message", message }]);

		const parsed = JSON.parse(message.content);
		const diff = summarizeHunks(
			computeDiffHunks(parsed.old_string, parsed.new_string, 1)
		);
		expect(diff.stats).toEqual({ added: 1, removed: 1 });
		expect(diff.allLines).toEqual([
			"export const answer = 41;",
			"export const answer = 42;",
			"",
		]);
	});

	/*
	 * This protects parity with Claude-style streams, where the tool starts with
	 * no input and receives the edit JSON as streamed input_json_delta content.
	 * Both providers should end with the same parseable Edit message contract.
	 */
	test("Claude-style streamed Edit input reaches the same diff contract", () => {
		const payload = JSON.stringify(editPayload(), null, 2);
		const message = toolMessageFromEvents([
			{
				type: "content_block_start",
				content_block: { type: "tool_use", name: "Edit" },
			},
			{
				type: "content_block_delta",
				delta: {
					type: "input_json_delta",
					partial_json: payload.slice(0, 30),
				},
			},
			{
				type: "content_block_delta",
				delta: {
					type: "input_json_delta",
					partial_json: payload.slice(30),
				},
			},
			{ type: "content_block_stop" },
		]);

		expect(message.content).toBe(payload);
		expect(getEditFilePath(message)).toBe("src/example.ts");
		expect(summarizeHunks(computeDiffHunks("a\n", "b\n", 1)).stats).toEqual({
			added: 1,
			removed: 1,
		});
	});

	test("orders replacement hunks as removed block followed by added block", () => {
		const diff = computeDiffHunks(
			["const config = {", "\tlineHeight: 19,", "\tfontSize: 12,", "};"].join(
				"\n"
			),
			["const config = {", "\tlineHeight: 15,", "\tfontSize: 10,", "};"].join(
				"\n"
			),
			1
		);

		expect(
			diff.flatMap((hunk) =>
				hunk.filter((line) => line.type !== "context").map((line) => line.type)
			)
		).toEqual(["removed", "removed", "added", "added"]);
	});

	/*
	 * This protects grouped edit rendering. Adjacent edits for the same file should
	 * collapse into one edit group, and sequential edit application should show
	 * the final file text instead of an empty or single-step placeholder.
	 */
	test("groups adjacent Edit messages and applies their changes sequentially", () => {
		const first = {
			file_path: "src/example.ts",
			old_string: "one\ntwo\n",
			new_string: "one\n2\n",
		};
		const second = {
			file_path: "src/example.ts",
			old_string: "2\n",
			new_string: "two\nthree\n",
		};
		const messages: ChatMessage[] = [
			{
				id: "edit-1",
				role: "tool",
				toolName: "Edit",
				content: JSON.stringify(first),
			},
			{
				id: "edit-2",
				role: "tool",
				toolName: "Edit",
				content: JSON.stringify(second),
			},
		];

		expect(buildRenderItems(messages)).toEqual([
			{
				type: "edit-group",
				filePath: "src/example.ts",
				edits: [messages[0]!, messages[1]!],
			},
		]);
		expect(applyEditsSequentially([first, second])).toEqual({
			originalText: "one\ntwo\n",
			finalText: "one\ntwo\nthree\n",
		});
	});

	test("does not combine Edit messages across assistant text", () => {
		const first = {
			file_path: "src/example.ts",
			old_string: "one\n",
			new_string: "1\n",
		};
		const second = {
			file_path: "src/example.ts",
			old_string: "two\n",
			new_string: "2\n",
		};
		const messages: ChatMessage[] = [
			{
				id: "edit-1",
				role: "tool",
				toolName: "Edit",
				content: JSON.stringify(first),
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: "Updated the file.",
			},
			{
				id: "edit-2",
				role: "tool",
				toolName: "Edit",
				content: JSON.stringify(second),
			},
		];

		expect(buildRenderItems(messages)).toEqual([
			{ type: "message", message: messages[0]! },
			{ type: "message", message: messages[1]! },
			{ type: "message", message: messages[2]! },
		]);
	});
});
