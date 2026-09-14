import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { TranscriptAdmission } from "@contracts";
import {
	ChatReplica,
	initSync,
} from "../../build/presentation/presentation.js";
import type { ChatMessage } from "../../src/modules/conversation/components/AgentChatView/types.ts";
import { admittedTranscriptMessages } from "../../src/modules/conversation/components/AgentChatView/useChatConnection.tsx";

initSync({
	module: readFileSync(
		new URL("../../build/presentation/presentation_bg.wasm", import.meta.url),
	),
});
const replicas: ChatReplica[] = [];
afterEach(() => {
	for (const replica of replicas.splice(0)) replica.free();
});

function client() {
	const replica = new ChatReplica();
	replicas.push(replica);
	let messages: ChatMessage[] = [];
	return {
		replica,
		get messages() {
			return messages;
		},
		receive(event: object) {
			const { admission }: { admission: TranscriptAdmission } = JSON.parse(
				replica.receive(
					JSON.stringify({ type: "chat:delta", paneId: "pane", ...event }),
					"pane",
					"null",
				),
			);
			if (admission.kind === "sync" || admission.kind === "patch") {
				const inserted = admittedTranscriptMessages(admission, messages, event);
				messages = messages.slice();
				messages.splice(admission.start, admission.deleteCount, ...inserted);
			}
			return admission;
		},
	};
}
const sync = (messages: ChatMessage[], revision = 1, epoch = "one") => ({
	type: "chat:sync",
	modelVersion: 1,
	epoch,
	revision,
	messages,
});
const patch = (
	revision: number,
	messages: object[],
	start = 1,
	deleteCount = 1,
) => ({
	transcriptUpdate: {
		version: 1,
		epoch: "one",
		revision,
		baseRevision: revision - 1,
		start,
		deleteCount,
		messages,
	},
});

test("admitted append reuses history, replaces metadata and retains exact Unicode content", () => {
	const c = client();
	const previous: ChatMessage[] = [
		{ id: "u", role: "user", content: "question" },
		{ id: "a", role: "assistant", content: "hello 🦀", isStreaming: true },
	];
	expect(c.receive(sync(previous))).toEqual({
		kind: "sync",
		start: 0,
		deleteCount: 0,
	});
	expect(c.messages[0]).toBe(previous[0]);
	const snapshot = c.messages;
	expect(
		c.receive(
			patch(2, [
				{
					message: { id: "a", role: "assistant", isStreaming: false },
					appendContent: "\n世界",
				},
			]),
		),
	).toEqual({ kind: "patch", start: 1, deleteCount: 1 });
	expect(c.messages[0]).toBe(snapshot[0]);
	expect(snapshot[1].content).toBe("hello 🦀");
	expect(c.messages[1]).toEqual({
		id: "a",
		role: "assistant",
		content: "hello 🦀\n世界",
		isStreaming: false,
	});
});

test("gaps, wrong IDs and malformed appends never mutate the displayed transcript or cursor", () => {
	const c = client();
	c.receive(sync([{ id: "a", role: "assistant", content: "safe" }]));
	const before = c.messages;
	const cursor = c.replica.cursor();
	for (const event of [
		patch(
			3,
			[{ message: { id: "a", role: "assistant" }, appendContent: "gap" }],
			0,
		),
		patch(
			2,
			[{ message: { id: "wrong", role: "assistant" }, appendContent: "wrong" }],
			0,
		),
		patch(
			2,
			[{ message: { id: "a", role: "assistant" }, appendContent: null }],
			0,
		),
	]) {
		expect(c.receive(event).kind).toBe("resync");
		expect(c.messages).toBe(before);
		expect(c.replica.cursor()).toBe(cursor);
	}
	c.receive(
		patch(
			2,
			[{ message: { id: "a", role: "assistant" }, appendContent: " next" }],
			0,
		),
	);
	expect(c.messages[0].content).toBe("safe next");
});

test("multiple appends use the original targets, deletion and reset preserve wire semantics", () => {
	const c = client();
	c.receive(
		sync([
			{ id: "a", role: "assistant", content: "A" },
			{ id: "b", role: "tool", content: "B" },
		]),
	);
	c.receive(
		patch(
			2,
			[
				{ message: { id: "a", role: "assistant" }, appendContent: "1" },
				{ message: { id: "b", role: "tool" }, appendContent: "2" },
			],
			0,
			2,
		),
	);
	expect(c.messages.map((m) => m.content)).toEqual(["A1", "B2"]);
	c.receive(patch(3, [], 0));
	expect(c.messages.map((m) => m.id)).toEqual(["b"]);
	const reset = patch(
		4,
		[{ message: { id: "new", role: "system", content: "reset" } }],
		0,
		0,
	);
	c.receive({ transcriptUpdate: { ...reset.transcriptUpdate, reset: true } });
	expect(c.messages).toEqual([{ id: "new", role: "system", content: "reset" }]);
});

test("unchanged reconnect retains objects; stale revisions ignore; full reconnect replaces history", () => {
	const c = client();
	c.receive(sync([{ id: "a", role: "assistant", content: "retained" }], 5));
	const before = c.messages;
	c.replica.reconnect();
	expect(
		c.receive({
			type: "chat:sync",
			modelVersion: 1,
			epoch: "one",
			revision: 5,
			unchanged: true,
		}).kind,
	).toBe("none");
	expect(c.messages).toBe(before);
	expect(c.receive(patch(5, [], 0)).kind).toBe("ignore");
	c.replica.reconnect();
	c.receive(
		sync([{ id: "b", role: "assistant", content: "replacement" }], 1, "two"),
	);
	expect(c.messages.map((m) => m.content)).toEqual(["replacement"]);
});
