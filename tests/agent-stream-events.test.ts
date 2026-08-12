import { describe, expect, test } from "bun:test";
import { extractToolActivities } from "../src/components/chat/chat-agent-utils.ts";
import {
	getToolDisplayInfo,
	getToolOutputSummary,
	getToolTrailingOutput,
} from "../src/components/chat/chat-message-render-utils.ts";
import {
	getToolBlockInitialContent,
	stringifyToolInput,
} from "../src/features/chat/agent-chat-shared.ts";

describe("agent stream rendering", () => {
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

	test("keeps missing input empty and string input unchanged", () => {
		expect(getToolBlockInitialContent({ type: "tool_use", name: "Bash" })).toBe(
			""
		);
		expect(stringifyToolInput('{"command":"bun test"}')).toBe(
			'{"command":"bun test"}'
		);
		expect(stringifyToolInput(null)).toBe("");
	});

	test("summarizes command output following JSON input", () => {
		const content =
			'{"command":"bun test","cwd":"/tmp/project"}all tests passed\n';
		expect(getToolOutputSummary(content)).toEqual({
			type: "command",
			value: "bun test",
		});
		expect(getToolTrailingOutput(content)).toBe("all tests passed\n");
	});

	test("maps shell details to user-facing milestones", () => {
		expect(
			getToolDisplayInfo(
				"exec",
				JSON.stringify({ cmd: "/bin/zsh -lc 'git status --short'" })
			)
		).toEqual({ label: "Checking working tree" });
		expect(
			getToolDisplayInfo(
				"exec",
				JSON.stringify({ cmd: "git diff --cached -- src/app/actions.ts" })
			)
		).toEqual({ label: "Reviewing staged actions.ts" });
		expect(
			getToolDisplayInfo(
				"bash",
				JSON.stringify({ command: "npx tsc --noEmit" })
			)
		).toEqual({ label: "Type-checking project" });
		expect(
			getToolDisplayInfo(
				"bash",
				JSON.stringify({
					command: "npm test && npm run lint && npm run build",
				})
			)
		).toEqual({ label: "Running verification checks" });
	});
});
