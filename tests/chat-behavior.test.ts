import { describe, expect, test } from "bun:test";
import {
	appendTrimmedMessage,
	trimMessages,
	type ChatMessage,
} from "../src/features/chat/agent-chat-shared.ts";
import {
	applyInlineCompletion,
	expandInlineCommandPrompts,
	getCommandDisplayText,
	getCommandPrompt,
} from "../src/components/chat/chat-command-utils.ts";
import {
	appendMessageContent,
	mergeSyncedMessages,
	patchMessageById,
} from "../src/components/chat/chat-state-utils.ts";

function message(
	id: string,
	content: string,
	role: ChatMessage["role"] = "user"
) {
	return { id, role, content };
}

describe("chat data behavior", () => {
	/*
	 * This protects lossless chat history persistence. The renderer keeps the
	 * full local conversation and lets provider-specific send paths decide what
	 * context window to transmit.
	 */
	test("keeps chat history lossless when storing local messages", () => {
		const messages = Array.from({ length: 90 }, (_, index) =>
			message(`m${index}`, `${index}:`.padEnd(2_000, "x"))
		);

		const trimmed = trimMessages(messages);

		expect(trimmed).toHaveLength(90);
		expect(trimmed[0]?.id).toBe("m0");
		expect(trimmed.at(-1)?.id).toBe("m89");
		expect(
			appendTrimmedMessage(message("m90", "next"), trimmed).at(-1)?.id
		).toBe("m90");
	});

	/*
	 * This protects streamed message updates. Patching from the end updates the
	 * latest duplicate id, append operations preserve immutable arrays, and a
	 * missing id returns the original reference so React consumers avoid needless
	 * state churn.
	 */
	test("patches and appends chat message content predictably", () => {
		const messages = [
			message("same", "first"),
			message("other", "middle", "assistant"),
			message("same", "latest"),
		];

		expect(patchMessageById(messages, "same", { content: "patched" })).toEqual([
			message("same", "first"),
			message("other", "middle", "assistant"),
			message("same", "patched"),
		]);
		expect(appendMessageContent(messages, "other", " response")).toEqual([
			message("same", "first"),
			message("other", "middle response", "assistant"),
			message("same", "latest"),
		]);
		expect(patchMessageById(messages, "missing", { content: "ignored" })).toBe(
			messages
		);
	});

	/*
	 * This protects local/server chat sync behavior after reconnects. Server
	 * messages can contain expanded slash-command prompts, while local messages
	 * often contain the shorter display text the user typed; the merge keeps the
	 * readable local text only where it is a shorter counterpart.
	 */
	test("preserves shorter local user display text when merging synced messages", () => {
		const localMessages = [
			message("local-1", "/review src/app.ts"),
			message("local-2", "plain local message"),
		];
		const serverMessages = [
			message("server-1", "Review this code carefully: src/app.ts"),
			message("server-a", "assistant reply", "assistant"),
			message("server-2", "plain local message"),
		];

		expect(mergeSyncedMessages(localMessages, serverMessages)).toEqual([
			message("server-1", "/review src/app.ts"),
			message("server-a", "assistant reply", "assistant"),
			message("server-2", "plain local message"),
		]);
	});

	/*
	 * This protects slash-command expansion before prompts are sent to an agent.
	 * Commands must expand only whole slash tokens, preserve display text for
	 * explicit command sends, and place inline completions at the intended cursor.
	 */
	test("expands slash commands and applies inline completion replacements", () => {
		const commands = [
			{ id: "review-id", name: "review", promptTemplate: "Review: {args}" },
			{ id: "fix-id", name: "fix", promptTemplate: "Fix the issue" },
		];

		expect(getCommandDisplayText({ name: "review" }, "src/app.ts")).toBe(
			"/review src/app.ts"
		);
		expect(getCommandPrompt(commands[0]!, "src/app.ts")).toBe(
			"Review: src/app.ts"
		);
		expect(
			expandInlineCommandPrompts("Please /review and then /fix", commands)
		).toEqual({
			expandedText: "Please Review: and then Fix the issue",
			usedCommandIds: ["review-id", "fix-id"],
		});
		expect(applyInlineCompletion("run /re now", 7, 4, "/review")).toEqual({
			nextValue: "run /review now",
			nextCursor: 11,
		});
	});
});
