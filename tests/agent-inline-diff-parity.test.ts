import { describe, expect, test } from "bun:test";
import {
	buildRenderItems,
	type RenderChatMessage as ChatMessage,
	getEditToolPayload,
} from "../src/modules/conversation/model/chat-message-render-utils.ts";

describe("native inline edit presentation", () => {
	/*
	 * This protects grouped edit rendering. Adjacent edits for the same file should
	 * collapse into one edit group, and sequential edit application should show
	 * the final file text instead of an empty or single-step placeholder.
	 */
	test("groups adjacent Edit messages for the native diff request", () => {
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

		for (const message of messages) {
			message.render = {
				version: 1,
				kind: "edit-group",
				groupId: "edit-1",
				hidden: false,
				filePath: "src/example.ts",
				toolInput: message.id === "edit-1" ? first : second,
			};
		}
		expect(getEditToolPayload(messages[0].render?.toolInput)).toEqual({
			filePath: "src/example.ts",
			oldString: first.old_string,
			newString: first.new_string,
		});

		expect(buildRenderItems(messages)).toEqual([
			{
				type: "edit-group",
				filePath: "src/example.ts",
				edits: [messages[0]!, messages[1]!],
			},
		]);
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

	test("keeps completed tool output visible between edit messages", () => {
		const first = {
			file_path: "src/example.ts",
			old_string: "one\n",
			new_string: "1\n",
		};
		const second = {
			file_path: "src/example.ts",
			old_string: "1\n",
			new_string: "one\n",
		};
		const messages: ChatMessage[] = [
			{
				id: "edit-1",
				role: "tool",
				toolName: "Edit",
				content: JSON.stringify(first),
			},
			{
				id: "read-1",
				role: "tool",
				toolName: "Read",
				content: "hidden read output",
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
			{ type: "tool-group", tools: [messages[1]!] },
			{ type: "message", message: messages[2]! },
		]);
	});

	test("groups consecutive execution milestones and removes duplicate events", () => {
		const status = {
			id: "tool-status-1",
			role: "tool",
			toolName: "exec",
			content: JSON.stringify({ cmd: "git status --short" }),
		} satisfies ChatMessage;
		const duplicateStatus = { ...status, id: "tool-status-2" };
		const diff = {
			id: "tool-diff",
			role: "tool",
			toolName: "exec",
			content: JSON.stringify({ cmd: "git diff --cached --stat" }),
		} satisfies ChatMessage;

		expect(buildRenderItems([status, duplicateStatus, diff])).toEqual([
			{ type: "tool-group", tools: [status, diff] },
		]);
	});

	test("renders a lone running command as a roadmap milestone", () => {
		const command = {
			id: "tool-command",
			role: "tool",
			toolName: "exec",
			content: JSON.stringify({
				command: "cargo test --workspace --all-targets --all-features --locked",
			}),
			isStreaming: true,
		} satisfies ChatMessage;

		expect(buildRenderItems([command])).toEqual([
			{ type: "tool-group", tools: [command] },
		]);
	});

	test("removes duplicate adjacent assistant commentary", () => {
		const first = {
			id: "assistant-1",
			role: "assistant",
			content: "I am reviewing the current changes.",
		} satisfies ChatMessage;
		const duplicate = { ...first, id: "assistant-2" };

		expect(buildRenderItems([first, duplicate])).toEqual([
			{ type: "message", message: first },
		]);
	});
});
