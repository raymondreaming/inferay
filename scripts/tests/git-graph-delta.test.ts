import { expect, spyOn, test } from "bun:test";
import type { GraphData } from "@contracts";
import { loadGitGraph } from "../../src/modules/repository/services/gitApi.ts";

test("graph updates preserve unchanged identities and require the exact base", async () => {
	const previous = {
		commits: [{ id: "a" }, { id: "b" }],
		rows: [],
		revision: "before",
		stateError: "old error",
	} as unknown as GraphData;
	const input = {
		cwd: "/fixture",
		limit: 1000,
		query: "",
		preferences: { hiddenRefs: [], soloRefs: [], pinnedRefs: [] },
		etag: '"before"',
		previous,
	};
	let response = Response.json(
		{
			fields: { revision: "after" },
			removed: ["stateError"],
			commits: { start: 0, delete: 1, items: [{ id: "changed" }] },
		},
		{
			status: 226,
			headers: {
				im: "inferay-graph",
				"delta-base": '"before"',
				etag: '"after"',
			},
		},
	);
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_url: RequestInfo | URL, init?: RequestInit) => {
				expect(new Headers(init?.headers).get("a-im")).toBe("inferay-graph");
				return response;
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	try {
		const result = await loadGitGraph(input);
		expect(result.data?.commits.map((c) => c.id)).toEqual(["changed", "b"]);
		expect(result.data?.commits[1]).toBe(previous.commits[1]);
		expect(result.data?.rows).toBe(previous.rows);
		expect(result.data?.stateError).toBeUndefined();
		expect(previous.stateError).toBe("old error");
		expect(previous.commits[0].id).toBe("a");
		expect(result.etag).toBe('"after"');
		response = new Response(null, { status: 304 });
		expect((await loadGitGraph(input)).notModified).toBe(true);
		response = Response.json(
			{},
			{
				status: 226,
				headers: { im: "inferay-graph", "delta-base": '"wrong"' },
			},
		);
		await expect(loadGitGraph(input)).rejects.toThrow("matching base");
		response = Response.json(
			{ fields: {}, removed: [], commits: { start: 3, delete: 1, items: [] } },
			{
				status: 226,
				headers: { im: "inferay-graph", "delta-base": '"before"' },
			},
		);
		await expect(loadGitGraph(input)).rejects.toThrow("invalid commit range");
		response = Response.json({ error: "unavailable" }, { status: 503 });
		await expect(loadGitGraph(input)).rejects.toThrow("unavailable");
		response = Response.json(previous, { headers: { etag: '"full"' } });
		expect((await loadGitGraph(input)).data).toEqual(previous);
	} finally {
		fetch.mockRestore();
	}
});
