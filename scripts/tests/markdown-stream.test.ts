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
) => Response.json({ version: 1, reset, revision, start, deleteCount, blocks });

test("successive requests send only suffixes and preserve stable block identity", async () => {
	const requests: any[] = [];
	const client = nativeMarkdownStream(async (request) => {
		requests.push(request);
		return requests.length === 1
			? reply(true, 1, [block("stable"), block("tail")])
			: reply(false, 2, [block("tail extended")], 1, 1);
	});
	const first = await client.prepare(
		"stable\n\ntail",
		true,
		true,
		new AbortController().signal,
	);
	const next = await client.prepare(
		"stable\n\ntail extended",
		true,
		true,
		new AbortController().signal,
	);
	expect(requests[1].append).toBe(" extended");
	expect(requests[1].text).toBeUndefined();
	expect(requests[1].streamId).toBe(requests[0].streamId);
	expect(next.blocks[0]).toBe(first.blocks[0]);
	expect(first.blocks[1].content).toBe("tail");
	expect(next.blocks[1].content).toBe("tail extended");
});

test("a stale cursor retries once with full text and a new stream identity", async () => {
	const requests: any[] = [];
	const client = nativeMarkdownStream(async (request) => {
		requests.push(request);
		if (requests.length === 2) return new Response("stale", { status: 409 });
		return reply(true, 1, [block(request.text!)]);
	});
	await client.prepare("a", true, true, new AbortController().signal);
	const next = await client.prepare(
		"ab",
		true,
		true,
		new AbortController().signal,
	);
	expect(requests).toHaveLength(3);
	expect(requests[2].text).toBe("ab");
	expect(requests[2].streamId).not.toBe(requests[0].streamId);
	expect(next.blocks[0].content).toBe("ab");
});

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

test("malformed replies fail without advancing the retained cursor", async () => {
	const requests: any[] = [];
	const client = nativeMarkdownStream(async (request) => {
		requests.push(request);
		if (requests.length === 1) return reply(true, 1, [block("a")]);
		if (requests.length === 2) return reply(false, 2, [block("bad")], 99, 1);
		return reply(false, 2, [block("ab")], 0, 1);
	});
	await client.prepare("a", true, true, new AbortController().signal);
	await expect(
		client.prepare("ab", true, true, new AbortController().signal),
	).rejects.toThrow("Unsupported");
	await client.prepare("ab", true, true, new AbortController().signal);
	expect(requests[2].baseRevision).toBe(1);
});
