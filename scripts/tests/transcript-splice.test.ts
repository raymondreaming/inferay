import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { TranscriptAdmission } from "@contracts";
import {
	ChatReplica,
	initSync,
} from "../../build/presentation/presentation.js";
import type { ChatMessage } from "../../src/modules/conversation/components/AgentChatView/useChatConnection.tsx";
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
