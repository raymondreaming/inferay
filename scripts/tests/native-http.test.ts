import { afterEach, expect, test } from "bun:test";
import { fetchJson, postJson } from "@shared/lib/native.tsx";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function respond(body: string, status = 200) {
	globalThis.fetch = (async () =>
		new Response(body, { status })) as unknown as typeof fetch;
}

test("JSON requests preserve service errors and tolerate non-JSON failure bodies", async () => {
	respond("upstream unavailable", 502);
	await expect(
		fetchJson("/test", undefined, {
			message: "Could not load workspace state",
		}),
	).rejects.toThrow("Could not load workspace state");
	await expect(
		postJson("/test", {}, undefined, {
			server: true,
			message: (status) => `Diff request failed (${status})`,
		}),
	).rejects.toThrow("Diff request failed (502)");
	respond('{"error":"Revision conflict"}', 409);
	await expect(
		postJson("/test", {}, undefined, { server: true }),
	).rejects.toThrow("Revision conflict");
	await expect(fetchJson("/test")).rejects.toThrow("Request failed: 409");
});

test("successful JSON requests retain bodies, methods, and cancellation", async () => {
	const controller = new AbortController();
	globalThis.fetch = (async (_url, init) => {
		expect(init?.method).toBe("PATCH");
		expect(init?.body).toBe('{"value":1}');
		expect(init?.signal?.aborted).toBe(false);
		controller.abort();
		expect(init?.signal?.aborted).toBe(true);
		return Response.json({ saved: true });
	}) as typeof fetch;
	await expect(
		postJson(
			"/test",
			{ value: 1 },
			{ method: "PATCH", signal: controller.signal },
		),
	).resolves.toEqual({ saved: true });
});
