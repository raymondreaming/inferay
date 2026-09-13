import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChatMessage } from "../../src/modules/conversation/components/AgentChatView/useChatConnection.tsx";
import { project } from "../../src/shared/lib/native.tsx";

const source = readFileSync(
	new URL(
		"../../src/modules/conversation/components/AgentChatView/useChatConnection.tsx",
		import.meta.url,
	),
	"utf8",
);
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
	source
		.slice(source.indexOf("export function mergeNativeTranscript("))
		.replace("export ", ""),
);
function model() {
	let payload = "";
	const merge = new Function(
		"rustProject",
		`${code}\nreturn mergeNativeTranscript;`,
	)((operation: string, value: unknown) => {
		payload = JSON.stringify(value);
		return project(operation, value);
	}) as (local: ChatMessage[], server: ChatMessage[]) => ChatMessage[];
	return { merge, payload: () => payload };
}

test("notice deduplication keeps full-payload native ordering for every supported role", () => {
	for (const role of ["assistant", "user", "tool", "system", "btw"] as const) {
		const server: ChatMessage[] = [
			{ id: "anchor", role: "assistant", content: "a".repeat(200000) },
			{ id: "canonical", role, content: "duplicate" },
			{ id: "ack", role: "user", content: "sent" },
		];
		const local: ChatMessage[] = [
			server[0],
			{ id: "notice", role, localOnly: true, content: "unique" },
			{ id: "duplicate", role, localOnly: true, content: "duplicate" },
			{ id: "ack", role: "user", content: "sent", optimistic: true },
			{ id: "pending", role: "user", content: "pending", optimistic: true },
		];
		const order = project<Array<[boolean, number]>>("mergeTranscriptOrder", {
			local,
			server,
		});
		const expected = order.map(
			([browser, index]) => (browser ? local : server)[index],
		);
		const actual = model().merge(local, server);
		expect(actual).toEqual(expected);
		for (let i = 0; i < actual.length; i++) expect(actual[i]).toBe(expected[i]);
	}
});

test("system notices exclude assistant bodies from the merge boundary", () => {
	const server: ChatMessage[] = [
		{ id: "a", role: "assistant", content: "a".repeat(200000) },
	];
	const local: ChatMessage[] = [
		...server,
		{ id: "notice", role: "system", content: "Saved", localOnly: true },
	];
	const m = model();
	expect(m.merge(local, server).map((message) => message.id)).toEqual([
		"a",
		"notice",
	]);
	expect(m.payload().length).toBeLessThan(500);
	expect(JSON.parse(m.payload()).server[0].content).toBeUndefined();
	expect(m.merge(server, server)).toBe(server);
});
