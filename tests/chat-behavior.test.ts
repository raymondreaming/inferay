import { describe, expect, test } from "bun:test";
import {
	appendLiveToolActivity,
	clearCompletedChatUiState,
} from "../src/components/chat/chat-agent-utils.ts";
import {
	applyInlineCompletion,
	expandInlineCommandPrompts,
	getCommandDisplayText,
	getCommandPrompt,
} from "../src/components/chat/chat-command-utils.ts";
import {
	appendBtwQuestionMessage,
	appendMessageContent,
	appendSystemMessage,
	applyAssistantResultMessage,
	applyPendingMessageContent,
	createBtwQuestionMessage,
	finishBtwMessage,
	finishStreamingMessages,
	mergeSyncedMessages,
	patchMessageById,
	windowChatMessagesForRender,
} from "../src/components/chat/chat-state-utils.ts";
import { parseMarkdownBlocks } from "../src/components/chat/chat-text.ts";
import {
	appendBoundedChatContent,
	appendTrimmedMessage,
	CHAT_SINGLE_MESSAGE_CHAR_LIMIT,
	type ChatMessage,
	prepareTranscriptForStorage,
	type ToolActivity,
	trimMessages,
	truncateChatContent,
} from "../src/features/chat/agent-chat-shared.ts";
import {
	parseCommandSystemMessage,
	serializeCommandSystemMessage,
} from "../src/features/chat/command-system-message.ts";
import {
	parseGoalSystemMessage,
	serializeGoalSystemMessage,
} from "../src/features/chat/goal-system-message.ts";

function message(
	id: string,
	content: string,
	role: ChatMessage["role"] = "user",
) {
	return { id, role, content };
}

describe("chat data behavior", () => {
	test("keeps a streaming markdown table in table layout from its first row", () => {
		expect(parseMarkdownBlocks("| Name | Sta", true)).toEqual([
			{
				type: "table",
				headers: ["Name", "Sta"],
				rows: [],
			},
		]);
		expect(
			parseMarkdownBlocks(
				"| Name | Status |\n| --- | --- |\n| Chat | streaming",
				true,
			),
		).toEqual([
			{
				type: "table",
				headers: ["Name", "Status"],
				rows: [["Chat", "streaming"]],
			},
		]);
	});
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

	test("bounds a single oversized message and streamed appends", () => {
		const oversized = `${"a".repeat(400_000)}${"z".repeat(400_000)}`;
		const [trimmed] = trimMessages([message("large", oversized)]);

		expect(trimmed?.content.length).toBe(CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
		expect(trimmed?.content.startsWith("a")).toBe(true);
		expect(trimmed?.content.endsWith("z")).toBe(true);
		expect(trimmed?.content).toContain("content truncated");

		let streamed = "";
		for (let index = 0; index < 1_000; index++) {
			streamed = appendBoundedChatContent(streamed, "x".repeat(1_000));
		}
		expect(streamed.length).toBe(CHAT_SINGLE_MESSAGE_CHAR_LIMIT);
		expect(streamed).toContain("content truncated");
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
			messages,
		);
	});

	test("applies pending stream content and btw rows through chat state reducers", () => {
		const messages: ChatMessage[] = [
			{ id: "a1", role: "assistant", content: "hello" },
			{ id: "t1", role: "tool", content: "{" },
		];
		const pending = new Map([
			["a1", " world"],
			["t1", '"path"}'],
		]);

		expect(applyPendingMessageContent(messages, pending)).toEqual([
			{ id: "a1", role: "assistant", content: "hello world" },
			{ id: "t1", role: "tool", content: '{"path"}' },
		]);

		const btw = createBtwQuestionMessage("Use the new file?");
		expect(appendBtwQuestionMessage(messages, btw).at(-1)).toEqual(btw);
		expect(finishBtwMessage([btw], btw.id, "yes")).toEqual([
			{
				...btw,
				content: "yes",
				isStreaming: false,
			},
		]);
		expect(finishBtwMessage([btw], null, "ignored")).toEqual([btw]);
	});

	test("settles streaming assistant and tool rows by explicit stream ids", () => {
		const messages: ChatMessage[] = [
			{ id: "u1", role: "user", content: "prompt" },
			{ id: "a1", role: "assistant", content: "partial", isStreaming: true },
			{
				id: "t1",
				role: "tool",
				content: '{"path"',
				toolName: "Read",
				isStreaming: true,
			},
		];

		expect(
			finishStreamingMessages(messages, { assistantId: "a1", toolId: "t1" }),
		).toEqual([
			{ id: "u1", role: "user", content: "prompt" },
			{ id: "a1", role: "assistant", content: "partial", isStreaming: false },
			{
				id: "t1",
				role: "tool",
				content: '{"path"',
				toolName: "Read",
				isStreaming: false,
			},
		]);
		expect(
			finishStreamingMessages(messages, {
				assistantId: "missing",
				toolId: null,
			}),
		).toBe(messages);
	});

	test("applies final assistant result without duplicating settled output", () => {
		const streaming: ChatMessage[] = [
			{ id: "u1", role: "user", content: "prompt" },
			{ id: "a1", role: "assistant", content: "partial", isStreaming: true },
		];

		expect(applyAssistantResultMessage(streaming, "a1", "final")).toEqual([
			{ id: "u1", role: "user", content: "prompt" },
			{ id: "a1", role: "assistant", content: "final", isStreaming: false },
		]);

		const settled: ChatMessage[] = [
			{ id: "u1", role: "user", content: "prompt" },
			{ id: "a1", role: "assistant", content: "final" },
		];
		expect(applyAssistantResultMessage(settled, null, "final")).toBe(settled);

		const settledBeforeTool: ChatMessage[] = [
			{ id: "u1", role: "user", content: "prompt" },
			{ id: "a1", role: "assistant", content: "final" },
			{ id: "t1", role: "tool", toolName: "patch", content: "{}" },
		];
		expect(applyAssistantResultMessage(settledBeforeTool, null, "final")).toBe(
			settledBeforeTool,
		);

		expect(
			applyAssistantResultMessage(
				[
					{ id: "u1", role: "user", content: "prompt" },
					{ id: "a1", role: "assistant", content: "partial" },
					{ id: "t1", role: "tool", toolName: "patch", content: "{}" },
				],
				null,
				"partial response",
			),
		).toEqual([
			{ id: "u1", role: "user", content: "prompt" },
			{
				id: "a1",
				role: "assistant",
				content: "partial response",
				isStreaming: false,
			},
			{ id: "t1", role: "tool", toolName: "patch", content: "{}" },
		]);

		const appended = applyAssistantResultMessage(
			[{ id: "u1", role: "user", content: "prompt" }],
			null,
			"final",
		);
		expect(appended.at(-1)).toMatchObject({
			role: "assistant",
			content: "final",
		});
	});

	test("parses structured goal system messages", () => {
		const structured = serializeGoalSystemMessage({
			type: "inferay.goal",
			status: "active",
			objective: "Ship the feature",
			turns: 2,
			detail: "Goal resumed",
		});

		expect(parseGoalSystemMessage(structured)).toEqual({
			type: "inferay.goal",
			status: "active",
			objective: "Ship the feature",
			turns: 2,
			detail: "Goal resumed",
		});
		expect(parseGoalSystemMessage("Goal started: Fix checkout")).toBeNull();
		expect(parseGoalSystemMessage("ordinary system message")).toBeNull();
	});

	test("parses structured command system messages", () => {
		const structured = serializeCommandSystemMessage({
			type: "inferay.command",
			name: "commit",
			description: "Commit the current changes",
			args: "fix picker",
		});

		expect(parseCommandSystemMessage(structured)).toEqual({
			type: "inferay.command",
			name: "commit",
			description: "Commit the current changes",
			args: "fix picker",
		});
		expect(parseCommandSystemMessage('{"type":"inferay.command"}')).toBeNull();
		expect(parseCommandSystemMessage("Running /commit...")).toBeNull();
	});

	test("deduplicates adjacent identical goal system messages", () => {
		const goalStarted = serializeGoalSystemMessage({
			type: "inferay.goal",
			status: "active",
			objective: "fix all please",
			turns: 0,
			detail: "Goal started",
		});
		const serverMessages: ChatMessage[] = [
			{ id: "server-goal", role: "system", content: goalStarted },
			{ id: "server-goal-duplicate", role: "system", content: goalStarted },
		];
		const localMessages: ChatMessage[] = [
			{ id: "local-goal", role: "system", content: goalStarted },
		];

		expect(appendSystemMessage(localMessages, goalStarted)).toBe(localMessages);
		expect(mergeSyncedMessages(localMessages, serverMessages)).toEqual([
			{ id: "server-goal", role: "system", content: goalStarted },
		]);
	});

	test("deduplicates adjacent identical settled assistant messages", () => {
		const localMessages: ChatMessage[] = [
			{ id: "u1", role: "user", content: "please keep making it better" },
		];
		const serverMessages: ChatMessage[] = [
			{ id: "u1", role: "user", content: "please keep making it better" },
			{
				id: "a1",
				role: "assistant",
				content: "I'll remove the narrow regression test coverage.",
			},
			{
				id: "a2",
				role: "assistant",
				content: "I'll remove the narrow regression test coverage.",
			},
		];

		expect(mergeSyncedMessages(localMessages, serverMessages)).toEqual([
			{ id: "u1", role: "user", content: "please keep making it better" },
			{
				id: "a1",
				role: "assistant",
				content: "I'll remove the narrow regression test coverage.",
			},
		]);
	});

	test("projects live activity ui state without duplicating adjacent updates", () => {
		const initial: {
			expandedTools: Set<string>;
			liveActivities: ToolActivity[];
		} = {
			expandedTools: new Set(["kept", "removed"]),
			liveActivities: [],
		};
		const first = appendLiveToolActivity(
			{ toolName: "Read", summary: "src/app.ts" },
			initial,
		);
		expect(first.liveActivities).toEqual([
			{
				id: "Read-0",
				toolName: "Read",
				summary: "src/app.ts",
				isStreaming: true,
			},
		]);
		expect(
			appendLiveToolActivity(
				{ toolName: "Read", summary: "src/app.ts" },
				first,
			),
		).toBe(first);

		let cappedState: {
			expandedTools: Set<string>;
			liveActivities: ToolActivity[];
		} = { expandedTools: new Set(), liveActivities: [] };
		for (let index = 0; index < 501; index++) {
			cappedState = appendLiveToolActivity(
				{ toolName: "Tool", summary: `step ${index}` },
				cappedState,
			);
		}
		expect(cappedState.liveActivities).toHaveLength(500);
		expect(cappedState.liveActivities[0]?.summary).toBe("step 1");
		expect(cappedState.liveActivities.at(-1)?.id).toBe("Tool-500");

		const completed = clearCompletedChatUiState(new Set(["kept"]), first);
		expect([...completed.expandedTools]).toEqual(["kept"]);
		expect(completed.liveActivities).toEqual([]);
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

	test("preserves optimistic queued user messages missing from a stale sync", () => {
		const localMessages = [
			message("server-1", "first"),
			message("server-a", "assistant reply", "assistant"),
			message("local-queued", "queued follow-up"),
		];
		const serverMessages = [
			message("server-1", "first"),
			message("server-a", "assistant reply", "assistant"),
		];

		expect(mergeSyncedMessages(localMessages, serverMessages)).toEqual([
			message("server-1", "first"),
			message("server-a", "assistant reply", "assistant"),
			message("local-queued", "queued follow-up"),
		]);
	});

	test("keeps optimistic user message before server assistant response", () => {
		const localMessages = [
			message("server-1", "first"),
			message("server-a", "assistant reply", "assistant"),
			message("local-follow-up", "follow-up prompt"),
		];
		const serverMessages = [
			message("server-1", "first"),
			message("server-a", "assistant reply", "assistant"),
			message("server-new-a", "follow-up answer", "assistant"),
		];

		expect(mergeSyncedMessages(localMessages, serverMessages)).toEqual([
			message("server-1", "first"),
			message("server-a", "assistant reply", "assistant"),
			message("local-follow-up", "follow-up prompt"),
			message("server-new-a", "follow-up answer", "assistant"),
		]);
	});

	test("deduplicates repeated server message ids during sync", () => {
		const serverMessages = [
			message("s1", "older assistant", "assistant"),
			message("s2", "user prompt"),
			message("s1", "newer assistant", "assistant"),
			message("s2", "user prompt"),
		];

		expect(mergeSyncedMessages([], serverMessages)).toEqual([
			message("s1", "newer assistant", "assistant"),
			message("s2", "user prompt"),
		]);
	});

	/*
	 * This protects durable chat restore. A response can be streaming while the
	 * app is open, but the transcript saved to disk should reopen as settled
	 * content instead of making the old chat look like it is still running.
	 */
	test("stores durable transcripts without stale streaming state", () => {
		expect(
			prepareTranscriptForStorage([
				{
					id: "server-1",
					role: "assistant",
					content: "partial answer",
					isStreaming: true,
				},
			]),
		).toEqual([
			{
				id: "server-1",
				role: "assistant",
				content: "partial answer",
				isStreaming: false,
			},
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
			"/review src/app.ts",
		);
		expect(getCommandPrompt(commands[0]!, "src/app.ts")).toBe(
			"Review: src/app.ts",
		);
		expect(
			expandInlineCommandPrompts("Please /review and then /fix", commands),
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
