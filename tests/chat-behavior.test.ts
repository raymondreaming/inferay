import { describe, expect, test } from "bun:test";
import {
	appendTrimmedMessage,
	CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
	type ChatMessage,
	trimMessages,
	truncateChatContent,
} from "../src/modules/conversation/model/agent-chat-shared.ts";
import { clearCompletedChatUiState } from "../src/modules/conversation/model/chat-agent-utils.ts";
import { windowChatMessagesForRender } from "../src/modules/conversation/model/chat-state-utils.ts";

function message(
	id: string,
	content: string,
	role: ChatMessage["role"] = "user",
) {
	return { id, role, content };
}

describe("chat data behavior", () => {
	/*
	 * This protects chat history compaction before messages are stored or sent
	 * back through the app. The behavior keeps the newest context and also trims
	 * oversized payloads, which matters for long-running agent sessions.
	 */
	test("keeps long short-message transcripts before the durable row cap", () => {
		const messages = Array.from({ length: 4_500 }, (_, index) =>
			message(`short-${index}`, `message ${index}`),
		);

		expect(trimMessages(messages)).toBe(messages);
		expect(
			appendTrimmedMessage(message("short-4500", "next"), messages),
		).toHaveLength(4_501);
	});

	test("trims chat history by message count and total character budget", () => {
		const shortMessages = Array.from({ length: 5_500 }, (_, index) =>
			message(`m${index}`, "short"),
		);
		const countTrimmed = trimMessages(shortMessages);

		expect(countTrimmed).toHaveLength(5_000);
		expect(countTrimmed[0]?.id).toBe("m500");
		expect(countTrimmed.at(-1)?.id).toBe("m5499");

		const messages = Array.from({ length: 600 }, (_, index) =>
			message(`m${index}`, `${index}:`.padEnd(2_000, "x")),
		);

		const trimmed = trimMessages(messages);

		expect(trimmed).toHaveLength(500);
		expect(trimmed[0]?.id).toBe("m100");
		expect(trimmed.at(-1)?.id).toBe("m599");
		expect(
			appendTrimmedMessage(message("m600", "next"), trimmed).at(-1)?.id,
		).toBe("m600");
	});

	test("bounds a single oversized message", () => {
		const oversized = `${"a".repeat(400_000)}${"z".repeat(400_000)}`;
		const [trimmed] = trimMessages([message("large", oversized)]);

		expect(trimmed?.content.length).toBe(CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
		expect(trimmed?.content.startsWith("a")).toBe(true);
		expect(trimmed?.content.endsWith("z")).toBe(true);
		expect(trimmed?.content).toContain("content truncated");

		expect(truncateChatContent("small", CHAT_SINGLE_MESSAGE_CHAR_LIMIT)).toBe(
			"small",
		);
	});

	/*
	 * This protects the visible chat render window. Long sessions stay durable in
	 * storage, but the active chat surface should render only the recent tail so
	 * switching panes and typing do not scale with full transcript length.
	 */
	test("windows long chat rendering by recent rows and character budget", () => {
		const shortMessages = Array.from({ length: 10 }, (_, index) =>
			message(`short-${index}`, "short"),
		);
		expect(windowChatMessagesForRender(shortMessages)).toBe(shortMessages);

		const largeContentMessages = Array.from({ length: 1_000 }, (_, index) =>
			message(`large-${index}`, `${index}:`.padEnd(2_000, "x")),
		);
		const largeWindow = windowChatMessagesForRender(largeContentMessages);
		expect(largeWindow).toHaveLength(250);
		expect(largeWindow[0]?.id).toBe("large-750");
		expect(largeWindow.at(-1)?.id).toBe("large-999");

		const tinyContentMessages = Array.from({ length: 1_000 }, (_, index) =>
			message(`tiny-${index}`, "x"),
		);
		const tinyWindow = windowChatMessagesForRender(tinyContentMessages);
		expect(tinyWindow).toHaveLength(1_000);
		expect(tinyWindow[0]?.id).toBe("tiny-0");
		expect(tinyWindow.at(-1)?.id).toBe("tiny-999");

		const manyTinyMessages = Array.from({ length: 3_000 }, (_, index) =>
			message(`many-tiny-${index}`, "x"),
		);
		const manyTinyWindow = windowChatMessagesForRender(manyTinyMessages);
		expect(manyTinyWindow).toHaveLength(2_000);
		expect(manyTinyWindow[0]?.id).toBe("many-tiny-1000");
		expect(manyTinyWindow.at(-1)?.id).toBe("many-tiny-2999");
	});

	test("prunes expansion state for completed messages", () => {
		const initial = { expandedTools: new Set(["kept", "removed"]) };
		const completed = clearCompletedChatUiState(new Set(["kept"]), initial);
		expect([...completed.expandedTools]).toEqual(["kept"]);
		expect(
			clearCompletedChatUiState(new Set(["kept"]), completed).expandedTools,
		).toBe(completed.expandedTools);
	});

	/*
	 * This protects local/server chat sync behavior after reconnects. Server
	 * messages can contain expanded slash-command prompts, while local messages
	 * often contain the shorter display text the user typed; the merge keeps the
	 * readable local text only where it is a shorter counterpart.
	 */
});
