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

// Exercise the connection's actual publication preparation, including snapshot ownership.
const connectionSource = readFileSync(
	new URL(
		"../../src/modules/conversation/components/AgentChatView/useChatConnection.tsx",
		import.meta.url,
	),
	"utf8",
);
const updateStart = connectionSource.indexOf(
	'if (update.kind === "sync" || update.kind === "patch")',
);
const applyUpdate = new Function(
	"admittedTranscriptMessages",
	`return (update, msg, nativeTranscript) => {
    let nativeTranscriptShared = true, changedStart = Infinity, changedEnd = 0, nativeFrame = null;
    const _optionsValue2 = { visible: false };
    const flushNativeTranscript = () => {};
    ${new Bun.Transpiler({ loader: "ts" }).transformSync(connectionSource.slice(updateStart, connectionSource.indexOf("\n\t\t\tif (plan.ready)", updateStart)))}
    return nativeTranscript;
};`,
)(admittedTranscriptMessages) as (
	update: Extract<TranscriptAdmission, { kind: "sync" | "patch" }>,
	event: object,
	before: ChatMessage[],
) => ChatMessage[];

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
				messages = applyUpdate(admission, event, messages);
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

test("local notices survive streaming and native acknowledgements restore the canonical array", () => {
	const merge = new Function(
		`${new Bun.Transpiler({ loader: "ts" }).transformSync(connectionSource.slice(connectionSource.indexOf("function mergeNativeTranscript(")))}; return mergeNativeTranscript;`,
	)() as (
		local: ChatMessage[],
		server: ChatMessage[],
		replica: ChatReplica,
	) => ChatMessage[];
	const c = client();
	c.receive(sync([{ id: "a", role: "assistant", content: "first" }]));
	const notice: ChatMessage = {
		id: "notice",
		role: "system",
		content: "local",
		localOnly: true,
	};
	const local = [...c.messages, notice];
	c.receive(
		patch(
			2,
			[{ message: { id: "a", role: "assistant" }, appendContent: " update" }],
			0,
		),
	);
	const merged = merge(local, c.messages, c.replica);
	expect(merged[0]).toBe(c.messages[0]);
	expect(merged[0].content).toBe("first update");
	expect(merged[1]).toBe(notice);
	expect(local[0].content).toBe("first");
	c.receive(
		patch(
			3,
			[{ message: { id: "native-notice", role: "system", content: "local" } }],
			1,
			0,
		),
	);
	expect(merge(merged, c.messages, c.replica)).toBe(c.messages);
	const pending: ChatMessage = {
		id: "send",
		role: "user",
		content: "hello",
		optimistic: true,
	};
	c.receive(
		patch(
			4,
			[{ message: { id: "send", role: "user", content: "hello" } }],
			2,
			0,
		),
	);
	expect(merge([...merged, pending], c.messages, c.replica)).toBe(c.messages);
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

test("large complete snapshots replace the transcript without argument spreading and later patches preserve published rows", () => {
	const messages: ChatMessage[] = Array.from(
		{ length: 150_000 },
		(_, index) => ({ id: String(index), role: "assistant", content: "saved" }),
	);
	const replaced = applyUpdate(
		{ kind: "sync", start: 0, deleteCount: 1 } as Extract<
			TranscriptAdmission,
			{ kind: "sync" }
		>,
		{ messages },
		[{ id: "old", role: "user", content: "old" }],
	);
	expect(replaced).toBe(messages);
	const updated = applyUpdate(
		{ kind: "patch", start: 0, deleteCount: 1 } as Extract<
			TranscriptAdmission,
			{ kind: "patch" }
		>,
		{
			transcriptUpdate: {
				messages: [
					{ message: { id: "0", role: "assistant" }, appendContent: " next" },
				],
			},
		},
		replaced,
	);
	expect(updated).not.toBe(replaced);
	expect(updated[0].content).toBe("saved next");
	expect(replaced[0].content).toBe("saved");
	expect(updated.at(-1)).toBe(replaced.at(-1));
});
