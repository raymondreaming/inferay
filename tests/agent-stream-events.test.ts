import { describe, expect, test } from "bun:test";
import { getToolTrailingOutput } from "../src/modules/conversation/model/chat-message-render-utils.ts";

describe("legacy tool output compatibility", () => {
	test("keeps output following a JSON envelope before native hydration", () => {
		const content =
			'{"command":"bun test","cwd":"/tmp/project"}all tests passed\n';
		expect(getToolTrailingOutput(content)).toBe("all tests passed\n");
		expect(getToolTrailingOutput(content, "authoritative output")).toBe(
			"authoritative output",
		);
	});
});
