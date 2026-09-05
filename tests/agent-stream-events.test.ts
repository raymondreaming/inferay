import { describe, expect, test } from "bun:test";
import {
	getToolDisplayInfo,
	getToolOutputSummary,
	getToolTrailingOutput,
} from "../src/modules/conversation/model/chat-message-render-utils.ts";

describe("agent stream rendering", () => {
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
				JSON.stringify({ cmd: "/bin/zsh -lc 'git status --short'" }),
			),
		).toEqual({ label: "Checking working tree" });
		expect(
			getToolDisplayInfo(
				"exec",
				JSON.stringify({ cmd: "git diff --cached -- src/app/actions.ts" }),
			),
		).toEqual({ label: "Reviewing staged actions.ts" });
		expect(
			getToolDisplayInfo(
				"bash",
				JSON.stringify({ command: "npx tsc --noEmit" }),
			),
		).toEqual({ label: "Type-checking project" });
		expect(
			getToolDisplayInfo(
				"bash",
				JSON.stringify({
					command: "npm test && npm run lint && npm run build",
				}),
			),
		).toEqual({ label: "Running verification checks" });
	});
});
