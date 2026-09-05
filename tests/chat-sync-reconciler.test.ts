import { expect, test } from "bun:test";
import type { ChatMessage } from "../src/modules/conversation/model/agent-chat-shared.ts";
import {
	applyNativeTranscriptUpdate,
	mergeNativeTranscript,
} from "../src/modules/conversation/model/chat-state-utils.ts";

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
		{ id: "pending", role: "user", content: "native display text" },
	]);
	expect(acknowledged).toEqual([
		...server,
		{ id: "pending", role: "user", content: "native display text" },
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
