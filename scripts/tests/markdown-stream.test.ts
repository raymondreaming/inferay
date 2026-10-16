import { expect, test } from "bun:test";
import type { MdBlock } from "../../build/presentation/contracts/MdBlock.ts";
import { nativeMarkdownStream } from "../../src/shared/services/markdownApi.ts";

const block = (content: string): MdBlock => ({
	type: "paragraph",
	content,
	tokens: [{ type: "text", text: content }],
});
const reply = (
	reset: boolean,
	revision: number,
	blocks: MdBlock[],
	start = 0,
	deleteCount = 0,
) => Response.json({ version: 2, reset, revision, start, deleteCount, blocks });

test("an old request resolving after a replacement cannot overwrite the current cursor", async () => {
	const late = Promise.withResolvers<Response>();
	const requests: any[] = [];
	const client = nativeMarkdownStream(async (request) => {
		requests.push(request);
		if (requests.length === 1) return late.promise;
		return request.text !== undefined
			? reply(true, 1, [block(request.text)])
			: reply(false, 2, [block("replacement!")], 0, 1);
	});
	const old = client.prepare("old", true, true, new AbortController().signal);
	await client.prepare("replacement", true, true, new AbortController().signal);
	late.resolve(reply(true, 1, [block("old")]));
	await old;
	await client.prepare(
		"replacement!",
		true,
		true,
		new AbortController().signal,
	);
	expect(requests[2].append).toBe("!");
	expect(requests[2].streamId).toBe(requests[1].streamId);
});

test("cancellation after native completion cannot commit an unobserved cursor", async () => {
	const late = Promise.withResolvers<Response>();
	const requests: any[] = [];
	const client = nativeMarkdownStream(async (request) => {
		requests.push(request);
		return requests.length === 1
			? late.promise
			: reply(true, 1, [block(request.text!)]);
	});
	const abort = new AbortController();
	const pending = client.prepare("lost", true, true, abort.signal);
	abort.abort();
	late.resolve(reply(true, 1, [block("lost")]));
	await expect(pending).rejects.toThrow();
	await client.prepare(
		"lost and found",
		true,
		true,
		new AbortController().signal,
	);
	expect(requests[1].text).toBe("lost and found");
	expect(requests[1].streamId).not.toBe(requests[0].streamId);
});

test("code appends retain earlier blocks and finalize with a normal replacement", async () => {
	const heading = block("heading");
	const code: MdBlock = { type: "code", content: "a", lang: "rust" };
	let calls = 0;
	const client = nativeMarkdownStream(async () => {
		calls++;
		if (calls === 1) return reply(true, 1, [heading, code]);
		if (calls === 2)
			return Response.json({
				version: 2,
				reset: false,
				revision: 2,
				start: 1,
				deleteCount: 1,
				blocks: [],
				appendCode: "🙂",
			});
		return reply(false, 3, [{ ...code, content: "a🙂" }], 1, 1);
	});
	const signal = new AbortController().signal;
	const initial = await client.prepare("```rust\na", true, true, signal);
	const appended = await client.prepare("```rust\na🙂", true, true, signal);
	expect(appended.blocks[0]).toBe(initial.blocks[0]);
	expect(appended.blocks[1].content).toBe("a🙂");
	expect(initial.blocks[1].content).toBe("a");
	const final = await client.prepare("```rust\na🙂\n```", false, true, signal);
	expect(final.blocks).toEqual(appended.blocks);
	expect(client.active).toBe(false);
});
