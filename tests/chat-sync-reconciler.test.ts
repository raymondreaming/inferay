import { expect, test } from "bun:test";
import type { ChatMessage } from "../src/modules/conversation/model/agent-chat-shared.ts";
import {
	applyNativeTranscriptUpdate,
	mergeNativeTranscript,
	reconcileChatSync,
} from "../src/modules/conversation/model/chat-state-utils.ts";

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

test("native splice resets retention, rejects gaps, and ignores repeated append patches", () => {
	const initial = {
		revision: 4,
		messages: [
			{ id: "old", role: "user" as const, content: "before" },
			{ id: "a", role: "assistant" as const, content: "hello" },
		],
	};
	const patch = {
		version: 1 as const,
		baseRevision: 4,
		revision: 5,
		reset: false,
		start: 1,
		deleteCount: 1,
		messages: [
			{
				message: { id: "a", role: "assistant" as const },
				appendContent: " 😀",
			},
		],
	};
	const next = applyNativeTranscriptUpdate(initial, patch)!;
	expect(next.messages[0]).toBe(initial.messages[0]);
	expect(next.messages[1]?.content).toBe("hello 😀");
	expect(applyNativeTranscriptUpdate(next, patch)).toBe(next);
	expect(
		applyNativeTranscriptUpdate(next, { ...patch, reset: true, revision: 3 }),
	).toBe(next);
	expect(
		applyNativeTranscriptUpdate(initial, { ...patch, baseRevision: 3 }),
	).toBeNull();
	const reset = applyNativeTranscriptUpdate(next, {
		...patch,
		reset: true,
		start: 0,
		deleteCount: 2,
		revision: 6,
		messages: [
			{ message: { id: "a", role: "assistant", content: "retained" } },
		],
	});
	expect(reset?.messages).toEqual([
		{ id: "a", role: "assistant", content: "retained" },
	]);
});

test("native reconciliation preserves only pending sends and acknowledges by identity after retention", () => {
	const local: ChatMessage[] = [
		{ id: "evicted", role: "user", content: "old prompt" },
		{ id: "kept", role: "assistant", content: "answer" },
		{ id: "pending", role: "user", content: "short", optimistic: true },
	];
	const server: ChatMessage[] = [
		{ id: "kept", role: "assistant", content: "new answer" },
	];
	expect(mergeNativeTranscript(local, server)).toEqual([...server, local[2]!]);
	const acknowledged = mergeNativeTranscript(local, [
		...server,
		{ id: "pending", role: "user", content: "short with injected context" },
	]);
	expect(acknowledged).toEqual([
		...server,
		{ id: "pending", role: "user", content: "short" },
	]);
	expect(acknowledged[1]?.optimistic).toBeUndefined();
});

test("native updates preserve anchored local checkpoint notices and BTW answers", () => {
	const local: ChatMessage[] = [
		{ id: "a", role: "assistant", content: "working" },
		{
			id: "notice",
			role: "system",
			content: "Reverted 2 files",
			localOnly: true,
		},
		{ id: "btw", role: "btw", content: "Side answer" },
	];
	const server: ChatMessage[] = [
		{ id: "a", role: "assistant", content: "working more" },
	];
	expect(mergeNativeTranscript(local, server)).toEqual([
		...server,
		local[1]!,
		local[2]!,
	]);
});

test("a recreated native session requests a snapshot before applying its new epoch", () => {
	const current = {
		epoch: "old-session",
		revision: 50,
		messages: [{ id: "old", role: "user" as const, content: "old" }],
	};
	const update = {
		version: 1 as const,
		epoch: "new-session",
		baseRevision: 0,
		revision: 1,
		reset: true,
		start: 0,
		deleteCount: 0,
		messages: [
			{ message: { id: "new", role: "user" as const, content: "new" } },
		],
	};
	expect(applyNativeTranscriptUpdate(current, update)).toBeNull();
	expect(applyNativeTranscriptUpdate(null, update)?.messages[0]?.id).toBe(
		"new",
	);
});
