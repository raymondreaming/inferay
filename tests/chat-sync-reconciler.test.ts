import { expect, test } from "bun:test";
import type { ChatMessage } from "../src/modules/conversation/agent-chat-shared.ts";
import { reconcileChatSync } from "../src/modules/conversation/chat-state-utils.ts";

test("chat sync reconciler skips duplicate completed revisions", () => {
	const currentMessages: ChatMessage[] = [
		{ id: "m1", role: "user", content: "hello" },
	];

	const result = reconcileChatSync({
		currentMessages,
		isStreaming: false,
		previousRevision: 9,
		revision: 9,
		serverMessages: [{ id: "m2", role: "assistant", content: "duplicate" }],
	});

	expect(result).toMatchObject({
		mergedMessages: currentMessages,
		nextRevision: 9,
		shouldPersist: false,
		shouldSkip: true,
		shouldUpdateMessages: false,
	});
});

test("chat sync reconciler preserves shorter local user display text", () => {
	const result = reconcileChatSync({
		currentMessages: [{ id: "u1", role: "user", content: "short prompt" }],
		isStreaming: false,
		previousRevision: 1,
		revision: 2,
		serverMessages: [
			{
				id: "u1-server",
				role: "user",
				content: "short prompt plus expanded context",
			},
			{ id: "a1", role: "assistant", content: "done" },
		],
	});

	expect(result).toMatchObject({
		nextRevision: 2,
		shouldPersist: true,
		shouldSkip: false,
		shouldUpdateMessages: true,
	});
	expect(result.mergedMessages).toEqual([
		{ id: "u1-server", role: "user", content: "short prompt" },
		{ id: "a1", role: "assistant", content: "done" },
	]);
});

test("chat sync reconciler exposes streaming assistant and tool ids", () => {
	const result = reconcileChatSync({
		currentMessages: [],
		isStreaming: true,
		previousRevision: null,
		revision: 3,
		serverMessages: [
			{ id: "a1", role: "assistant", content: "partial", isStreaming: true },
			{
				id: "t1",
				role: "tool",
				content: "{",
				isStreaming: true,
				toolName: "Read",
			},
		],
	});

	expect(result).toMatchObject({
		nextRevision: 3,
		shouldPersist: false,
		shouldSkip: false,
		shouldUpdateMessages: true,
		streamingAssistantId: "a1",
		streamingToolId: "t1",
	});
});

test("chat sync reconciler preserves local streaming rows during stale streaming sync", () => {
	const currentMessages: ChatMessage[] = [
		{ id: "u1", role: "user", content: "build the app" },
		{
			id: "local-a1",
			role: "assistant",
			content: "local streamed text that is ahead",
			isStreaming: true,
		},
	];

	const result = reconcileChatSync({
		currentMessages,
		isStreaming: true,
		previousRevision: 3,
		revision: 4,
		serverMessages: [
			{ id: "u1", role: "user", content: "build the app" },
			{
				id: "server-a1",
				role: "assistant",
				content: "older partial",
				isStreaming: true,
			},
		],
	});

	expect(result).toMatchObject({
		mergedMessages: currentMessages,
		nextRevision: 4,
		shouldPersist: false,
		shouldSkip: false,
		shouldUpdateMessages: false,
		streamingAssistantId: "local-a1",
	});
});

test("chat sync reconciler hydrates streaming rows when no local stream exists", () => {
	const result = reconcileChatSync({
		currentMessages: [{ id: "u1", role: "user", content: "build the app" }],
		isStreaming: true,
		previousRevision: 3,
		revision: 4,
		serverMessages: [
			{ id: "u1", role: "user", content: "build the app" },
			{
				id: "server-a1",
				role: "assistant",
				content: "server partial",
				isStreaming: true,
			},
		],
	});

	expect(result).toMatchObject({
		nextRevision: 4,
		shouldPersist: false,
		shouldSkip: false,
		shouldUpdateMessages: true,
		streamingAssistantId: "server-a1",
	});
	expect(result.mergedMessages.at(-1)?.content).toBe("server partial");
});

test("chat sync reconciler skips stale completed sync that is only a local prefix", () => {
	const currentMessages: ChatMessage[] = [
		{ id: "u1", role: "user", content: "first prompt" },
		{ id: "a1", role: "assistant", content: "first answer" },
		{ id: "u2", role: "user", content: "follow-up prompt" },
		{ id: "a2", role: "assistant", content: "follow-up answer" },
	];

	const result = reconcileChatSync({
		currentMessages,
		isStreaming: false,
		previousRevision: 4,
		revision: 5,
		serverMessages: [
			{ id: "u1", role: "user", content: "first prompt" },
			{ id: "a1", role: "assistant", content: "first answer" },
		],
	});

	expect(result).toMatchObject({
		mergedMessages: currentMessages,
		nextRevision: 5,
		shouldPersist: false,
		shouldSkip: true,
		shouldUpdateMessages: false,
	});
});

test("chat sync reconciler still accepts shorter completed sync with new server output", () => {
	const result = reconcileChatSync({
		currentMessages: [
			{ id: "u1", role: "user", content: "first prompt" },
			{ id: "a1", role: "assistant", content: "first answer" },
			{ id: "local-u2", role: "user", content: "follow-up prompt" },
		],
		isStreaming: false,
		previousRevision: 4,
		revision: 5,
		serverMessages: [
			{ id: "u1", role: "user", content: "first prompt" },
			{ id: "a1", role: "assistant", content: "first answer" },
			{ id: "server-a2", role: "assistant", content: "follow-up answer" },
		],
	});

	expect(result).toMatchObject({
		nextRevision: 5,
		shouldPersist: true,
		shouldSkip: false,
		shouldUpdateMessages: true,
	});
	expect(result.mergedMessages).toEqual([
		{ id: "u1", role: "user", content: "first prompt" },
		{ id: "a1", role: "assistant", content: "first answer" },
		{ id: "local-u2", role: "user", content: "follow-up prompt" },
		{ id: "server-a2", role: "assistant", content: "follow-up answer" },
	]);
});
