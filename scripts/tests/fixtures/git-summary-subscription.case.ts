import { expect, spyOn, test } from "bun:test";
import type { GitStatusResult, GraphData } from "@contracts";
import { QueryObserver } from "@tanstack/query-core";
import { createRoot, flush } from "solid-js";
import { useGitGraph } from "../../../src/modules/repository/hooks/useGitGraph.tsx";
import {
	useGitStatus,
	useGitSummaries,
} from "../../../src/modules/repository/hooks/useGitStatus.tsx";
import { queryClient } from "../../../src/shared/lib/dom.tsx";
import { project } from "../../../src/shared/lib/native.tsx";

test("active graph totals update directly, with independent reads after failure or closure", async () => {
	const requests: string[][] = [];
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				const { cwds } = JSON.parse(String(init?.body)) as { cwds: string[] };
				requests.push(cwds);
				return Response.json(
					Object.fromEntries(
						cwds.map((cwd) => [cwd, { files: 1, additions: 99, deletions: 0 }]),
					),
				);
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	const key = ["git", "graph", "/graph"];
	const graph: GraphData = {
		...project<GraphData>("emptyGitGraph", null),
		revision: "ready",
		state: "ready",
		worktrees: [
			{
				path: "/graph",
				head: "",
				branch: "main",
				isCurrent: true,
				bare: false,
				locked: false,
				changeSummary: { files: 1, additions: 4, deletions: 2 },
			},
		],
	};
	const options = {
		queryKey: key,
		queryFn: async () => graph,
		initialData: graph,
		staleTime: Infinity,
		retry: false as const,
	};
	const observer = new QueryObserver(queryClient, options);
	const unsubscribe = observer.subscribe(() => {});
	let dispose = () => {};
	const totals = createRoot((cleanup) => {
		dispose = cleanup;
		return useGitSummaries(
			() => ["/graph", "/other"],
			() => true,
		);
	});
	const settle = async () => {
		flush();
		await Bun.sleep(10);
		flush();
	};
	try {
		await settle();
		expect(totals()["/graph"]).toEqual({
			files: 1,
			additions: 4,
			deletions: 2,
		});
		expect(totals()["/other"]?.additions).toBe(99);
		expect(requests).toEqual([["/other"]]);

		queryClient.setQueryData(key, {
			...graph,
			worktrees: [
				{
					...graph.worktrees[0],
					changeSummary: { files: 0, additions: 0, deletions: 0 },
				},
			],
		});
		await settle();
		expect(totals()["/graph"]?.additions).toBe(0);
		expect(requests).toEqual([["/other"]]);

		observer.setOptions({
			...options,
			queryFn: async () => {
				throw new Error("unavailable");
			},
		});
		await observer.refetch();
		await settle();
		expect(totals()["/graph"]?.additions).toBe(99);
		expect(requests.at(-1)).toEqual(["/graph", "/other"]);

		queryClient.setQueryData(key, { ...graph, state: "commandFailed" });
		await settle();
		expect(totals()["/graph"]?.additions).toBe(99);

		observer.setOptions(options);
		await observer.refetch();
		await settle();
		expect(totals()["/graph"]?.additions).toBe(4);
		unsubscribe();
		await settle();
		expect(totals()["/graph"]?.additions).toBe(99);
	} finally {
		dispose();
		unsubscribe();
		queryClient.clear();
		fetch.mockRestore();
	}
});

test("the initial graph owns status until success or failure, while unrelated paths load", async () => {
	for (const failed of [false, true]) {
		queryClient.setQueryDefaults(["git"], { retry: false });
		const pending = Promise.withResolvers<Response>();
		const requested: string[][] = [];
		const status = (cwd: string): GitStatusResult => ({
			revision: "fixture",
			cwd,
			name: cwd,
			branch: "main",
			upstream: null,
			ahead: 0,
			behind: 0,
			files: [],
			fileGroups: { staged: [], modified: [], untracked: [] },
		});
		const fetch = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (input: RequestInfo | URL, init?: RequestInit) => {
					if (String(input).includes("/api/git/graph")) return pending.promise;
					const { cwds } = JSON.parse(String(init?.body)) as { cwds: string[] };
					requested.push(cwds);
					return Response.json(cwds.map(status));
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		);
		let dispose = () => {};
		const result = createRoot((cleanup) => {
			dispose = cleanup;
			const graph = useGitGraph(() => "/graph");
			return useGitStatus(
				() => ["/graph", "/other"],
				() => ({ enabled: true, graph }),
			);
		});
		const settle = async () => {
			flush();
			await Bun.sleep(10);
			flush();
		};
		try {
			await settle();
			expect(result.loaded).toBe(false);
			expect(result.projectMap.has("/other")).toBe(true);
			expect(requested).toEqual([["/other"]]);
			pending.resolve(
				failed
					? new Response("unavailable", { status: 500 })
					: Response.json({
							...project<GraphData>("emptyGitGraph", null),
							revision: "ready",
							state: "ready",
							worktrees: [
								{
									path: "/graph",
									head: "",
									branch: "main",
									isCurrent: true,
									bare: false,
									locked: false,
									status: status("/graph"),
								},
							],
						}),
			);
			await settle();
			await settle();
			expect(result.loaded).toBe(true);
			expect(result.projectMap.has("/graph")).toBe(true);
			expect(requested).toEqual(
				failed ? [["/other"], ["/graph", "/other"]] : [["/other"]],
			);
		} finally {
			dispose();
			queryClient.clear();
			queryClient.setQueryDefaults(["git"], {});
			fetch.mockRestore();
		}
	}
});
